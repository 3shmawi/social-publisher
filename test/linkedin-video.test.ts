// LinkedIn video: initializeUpload → PUT parts (ETags, no auth) →
// finalizeUpload → wait for AVAILABLE → post with content.media.
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Media, Posts } from "../scripts/lib/content.ts";
import { publish } from "../scripts/platforms/linkedin.ts";

describe("LinkedIn video post", () => {
  let server: Server;
  const calls: { method: string; url: string; headers: IncomingMessage["headers"]; body: string; size: number }[] = [];
  let polls = 0;
  const saved = { ...process.env };
  const size = 6 * 1024 * 1024 + 10; // two parts

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        const url = req.url ?? "";
        calls.push({ method: req.method ?? "", url, headers: req.headers, body: url.startsWith("/part") ? "" : raw.toString(), size: raw.length });
        const port = (server.address() as { port: number }).port;
        const json = (o: unknown, status = 200) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(o));
        };
        if (url === "/rest/videos?action=initializeUpload") {
          const split = 4194304;
          return json({
            value: {
              video: "urn:li:video:V1",
              uploadToken: "tok",
              uploadInstructions: [
                { uploadUrl: `http://127.0.0.1:${port}/part1`, firstByte: 0, lastByte: split - 1 },
                { uploadUrl: `http://127.0.0.1:${port}/part2`, firstByte: split, lastByte: size - 1 },
              ],
            },
          });
        }
        if (url.startsWith("/part")) {
          res.setHeader("etag", `etag-${url.slice(5)}`);
          return res.end();
        }
        if (url === "/rest/videos?action=finalizeUpload") return res.end();
        if (url === `/rest/videos/${encodeURIComponent("urn:li:video:V1")}`) {
          return json({ status: ++polls < 2 ? "PROCESSING" : "AVAILABLE" });
        }
        if (url === "/rest/posts") {
          res.statusCode = 201;
          res.setHeader("x-restli-id", "urn:li:share:42");
          return res.end();
        }
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    Object.assign(process.env, {
      LINKEDIN_API_BASE: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      LINKEDIN_TOKEN: "li-token",
      LINKEDIN_VIDEO_INTERVAL_MS: "1",
    });
    delete process.env.LINKEDIN_REFRESH_TOKEN;
  });

  afterAll(() => {
    server.close();
    process.env = saved;
  });

  it("uploads the parts in order and posts with the video", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "li-test-"));
    writeFileSync(path.join(dir, "video.mp4"), Buffer.alloc(size, 3));
    const media: Media = { video: "video.mp4", videoSource: "x", image: "", imageSource: "" };
    const posts = { linkedin: "New: dark mode.", youtube: { title: "Dark mode" } } as unknown as Posts;

    const link = await publish(posts, { kind: "person", urn: "urn:li:person:abc", scope: "w_member_social" }, media, dir);

    expect(link.url).toBe("https://www.linkedin.com/feed/update/urn:li:share:42/");
    const init = JSON.parse(calls[0]?.body ?? "{}");
    expect(init.initializeUploadRequest).toMatchObject({ owner: "urn:li:person:abc", fileSizeBytes: size });

    const parts = calls.filter((c) => c.method === "PUT");
    expect(parts.map((p) => p.url)).toEqual(["/part1", "/part2"]);
    expect(parts.map((p) => p.size)).toEqual([4194304, size - 4194304]);
    expect(parts[0]?.headers.authorization).toBeUndefined();

    const finalize = JSON.parse(calls.find((c) => c.url.endsWith("finalizeUpload"))?.body ?? "{}");
    expect(finalize.finalizeUploadRequest).toEqual({ video: "urn:li:video:V1", uploadToken: "tok", uploadedPartIds: ["etag-1", "etag-2"] });

    const post = JSON.parse(calls.find((c) => c.url === "/rest/posts")?.body ?? "{}");
    expect(post.content).toEqual({ media: { title: "Dark mode", id: "urn:li:video:V1" } });
    expect(post.author).toBe("urn:li:person:abc");
    expect(polls).toBe(2);
  });

  it("posts text only when there is no video", async () => {
    calls.length = 0;
    await publish({ linkedin: "Text" } as unknown as Posts, { kind: "person", urn: "urn:li:person:abc", scope: "w_member_social" });
    expect(calls.map((c) => c.url)).toEqual(["/rest/posts"]);
    expect(JSON.parse(calls[0]?.body ?? "{}").content).toBeUndefined();
  });
});
