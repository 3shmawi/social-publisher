// TikTok: the chunk rule, and the inbox upload against a local fake of
// TikTok's API (refresh → init → PUT chunks → status), including that the
// rotated refresh token is saved for the workflow.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Media, Posts } from "../scripts/lib/content.ts";
import { chunkPlan, configured, publish } from "../scripts/platforms/tiktok.ts";

const MB = 1024 * 1024;

describe("chunkPlan", () => {
  it("sends a small file as one chunk", () => {
    expect(chunkPlan(3 * MB)).toEqual({ chunkSize: 3 * MB, count: 1, ranges: [[0, 3 * MB - 1]] });
  });

  it("sends a file up to one chunk as one chunk", () => {
    expect(chunkPlan(10 * MB).count).toBe(1);
  });

  it("puts the remainder in the last chunk (count = floor(size / chunk))", () => {
    const size = 25 * MB + 123;
    const plan = chunkPlan(size);
    expect(plan.chunkSize).toBe(10 * MB);
    expect(plan.count).toBe(2);
    expect(plan.ranges).toEqual([
      [0, 10 * MB - 1],
      [10 * MB, size - 1],
    ]);
  });

  it("covers every byte exactly once", () => {
    const size = 97 * MB + 7;
    const { ranges } = chunkPlan(size);
    expect(ranges[0]?.[0]).toBe(0);
    expect(ranges.at(-1)?.[1]).toBe(size - 1);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]?.[0]).toBe((ranges[i - 1]?.[1] ?? 0) + 1);
    // The last chunk stays under TikTok's 128 MB limit.
    const last = ranges.at(-1) ?? [0, 0];
    expect(last[1] - last[0] + 1).toBeLessThan(128 * MB);
  });

  it("refuses an empty file", () => {
    expect(() => chunkPlan(0)).toThrow();
  });
});

describe("configured", () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = saved;
  });

  it("needs SOCIAL_SECRETS_TOKEN in Actions, so a rotated token is never lost", () => {
    Object.assign(process.env, { TIKTOK_CLIENT_KEY: "k", TIKTOK_CLIENT_SECRET: "s", TIKTOK_REFRESH_TOKEN: "r" });
    process.env.GITHUB_ACTIONS = "true";
    delete process.env.SOCIAL_SECRETS_TOKEN;
    expect(configured()).toContain("SOCIAL_SECRETS_TOKEN");
    process.env.SOCIAL_SECRETS_TOKEN = "gh";
    expect(configured()).toBe("");
    delete process.env.GITHUB_ACTIONS;
    delete process.env.SOCIAL_SECRETS_TOKEN;
    expect(configured()).toBe("");
  });
});

describe("publish to the inbox", () => {
  let server: Server;
  const calls: { method: string; url: string; headers: IncomingMessage["headers"]; body: string; size: number }[] = [];
  let statusCalls = 0;
  const saved = { ...process.env };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        const isUpload = req.url?.startsWith("/upload");
        calls.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: isUpload ? "" : raw.toString(), size: raw.length });
        const json = (o: unknown) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(o));
        };
        if (req.url === "/v2/oauth/token/") {
          return json({ access_token: "act.new", refresh_token: "rft.rotated", expires_in: 7200, refresh_expires_in: 15552000 });
        }
        if (req.url === "/v2/post/publish/inbox/video/init/") {
          const port = (server.address() as { port: number }).port;
          return json({ data: { publish_id: "v_inbox_1", upload_url: `http://127.0.0.1:${port}/upload/1` }, error: { code: "ok", message: "" } });
        }
        if (isUpload) {
          res.statusCode = 201;
          return res.end();
        }
        if (req.url === "/v2/post/publish/status/fetch/") {
          statusCalls++;
          return json({ data: { status: statusCalls < 2 ? "PROCESSING_UPLOAD" : "SEND_TO_USER_INBOX" }, error: { code: "ok" } });
        }
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });

  afterAll(() => {
    server.close();
    process.env = saved;
  });

  it("refreshes, uploads in order, waits for the inbox and saves the new token", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tiktok-test-"));
    const tokenFile = path.join(dir, "token");
    const size = 2 * MB + 5;
    writeFileSync(path.join(dir, "video.mp4"), Buffer.alloc(size, 1));
    Object.assign(process.env, {
      TIKTOK_API_BASE: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      TIKTOK_CLIENT_KEY: "key",
      TIKTOK_CLIENT_SECRET: "secret",
      TIKTOK_REFRESH_TOKEN: "rft.old",
      TIKTOK_NEW_TOKEN_FILE: tokenFile,
      TIKTOK_STATUS_INTERVAL_MS: "1",
    });
    const media: Media = { video: "video.mp4", videoSource: "x", image: "", imageSource: "" };
    const posts = { facebook: "Dark mode is here 🌙\n\n— — —\n\nالوضع الليلي وصل" } as Posts;

    const result = await publish(posts, media, dir);

    expect(result.status).toBe("posted");
    expect(result.detail).toContain("inbox");
    expect(result.detail).toContain("Dark mode is here");
    expect(result.detail).not.toContain("الوضع");

    const refresh = new URLSearchParams(calls[0]?.body);
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(refresh.get("refresh_token")).toBe("rft.old");

    const init = calls.find((c) => c.url.endsWith("/inbox/video/init/"));
    expect(init?.headers.authorization).toBe("Bearer act.new");
    expect(JSON.parse(init?.body ?? "{}").source_info).toEqual({
      source: "FILE_UPLOAD",
      video_size: size,
      chunk_size: size,
      total_chunk_count: 1,
    });

    const put = calls.find((c) => c.method === "PUT");
    expect(put?.headers["content-range"]).toBe(`bytes 0-${size - 1}/${size}`);
    expect(put?.size).toBe(size);
    expect(statusCalls).toBe(2);

    // The rotated token goes to the file the workflow saves back, not to out/.
    expect(readFileSync(tokenFile, "utf8")).toBe("rft.rotated");
  });

  it("skips an update without a video", async () => {
    const result = await publish({ facebook: "x" } as Posts, { video: "", videoSource: "", image: "", imageSource: "" }, tmpdir());
    expect(result.status).toBe("skipped");
  });
});
