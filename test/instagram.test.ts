// Instagram: the caption rules, and the Reel flow against a local fake of
// the Graph API (container → rupload → status → media_publish → permalink).
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppInfo, buildInstagram, type Context, type LanguagePosts, type Media, type Posts } from "../scripts/lib/content.ts";
import { configured, publish } from "../scripts/platforms/instagram.ts";

const app: AppInfo = { name: "Cafe Menu", playStoreUrl: "https://play.example/cafe", appStoreUrl: "", websiteUrl: "", about: "" };
const post = (language: string, extra: Partial<LanguagePosts> = {}): LanguagePosts => ({
  language,
  linkedin: "",
  hashtags: ["#Flutter", "MobileApps"],
  facebook: "Dark mode is here 🌙",
  youtubeTitle: "",
  youtubeDescription: "",
  youtubeTags: [],
  ...extra,
});

describe("buildInstagram", () => {
  it("joins the languages, keeps the links and ends with each hashtag once", () => {
    const caption = buildInstagram([post("en"), post("ar", { facebook: "الوضع الليلي وصل", hashtags: ["flutter", "فلاتر"] })], app);
    expect(caption).toContain("Dark mode is here 🌙\n\nGoogle Play: https://play.example/cafe");
    expect(caption).toContain("الوضع الليلي وصل");
    expect(caption.endsWith("#Flutter #MobileApps #فلاتر")).toBe(true);
  });

  it("stays within 2,200 characters and 30 hashtags", () => {
    const tags = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    const caption = buildInstagram([post("en", { facebook: "x".repeat(5000), hashtags: tags })], app);
    expect([...caption].length).toBeLessThanOrEqual(2200);
    expect(caption.match(/#tag\d+/g)).toHaveLength(30);
  });
});

describe("publish a Reel", () => {
  let server: Server;
  const calls: { method: string; url: string; headers: IncomingMessage["headers"]; body: string; size: number }[] = [];
  let polls = 0;
  const saved = { ...process.env };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (d: Buffer) => chunks.push(d));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        const url = req.url ?? "";
        calls.push({ method: req.method ?? "", url, headers: req.headers, body: url.startsWith("/ig-api-upload") ? "" : raw.toString(), size: raw.length });
        const json = (o: unknown) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(o));
        };
        const port = (server.address() as { port: number }).port;
        if (url === "/v24.0/1784/media") return json({ id: "c1", uri: `http://127.0.0.1:${port}/ig-api-upload/v24.0/c1` });
        if (url === "/release/video.mp4") {
          res.statusCode = 302;
          res.setHeader("Location", `http://127.0.0.1:${port}/signed/video.mp4?sig=abc`);
          return res.end();
        }
        if (url.startsWith("/ig-api-upload/")) return json({ success: true, message: "Upload successful." });
        if (url.startsWith("/v24.0/c1?")) return json({ status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED", id: "c1" });
        if (url === "/v24.0/1784/media_publish") return json({ id: "m9" });
        if (url.startsWith("/v24.0/m9?")) return json({ permalink: "https://www.instagram.com/reel/abc/" });
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });

  afterAll(() => {
    server.close();
    process.env = saved;
  });

  it("needs the Instagram account and the Page token", () => {
    delete process.env.IG_USER_ID;
    process.env.FB_PAGE_TOKEN = "page-token";
    expect(configured()).toContain("IG_USER_ID");
  });

  it("uploads the file, waits for processing, publishes and links the Reel", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ig-test-"));
    writeFileSync(path.join(dir, "video.mp4"), Buffer.alloc(4096, 7));
    Object.assign(process.env, {
      IG_GRAPH_BASE: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      IG_USER_ID: "1784",
      FB_PAGE_TOKEN: "page-token",
      IG_STATUS_INTERVAL_MS: "1",
    });
    const posts = { instagram: "Dark mode is here 🌙 #Flutter", perLanguage: [] } as unknown as Posts;
    const media: Media = { video: "video.mp4", videoSource: "x", image: "", imageSource: "" };

    const result = await publish({ app } as Context, posts, media, dir);

    expect(result.status).toBe("posted");
    expect(result.links[0]?.url).toBe("https://www.instagram.com/reel/abc/");

    const container = new URLSearchParams(calls[0]?.body);
    expect(container.get("media_type")).toBe("REELS");
    expect(container.get("upload_type")).toBe("resumable");
    expect(container.get("caption")).toBe("Dark mode is here 🌙 #Flutter");
    expect(calls[0]?.headers.authorization).toBe("Bearer page-token");

    const upload = calls.find((c) => c.url.startsWith("/ig-api-upload/"));
    expect(upload?.headers.authorization).toBe("OAuth page-token");
    expect(upload?.headers.offset).toBe("0");
    expect(upload?.headers.file_size).toBe("4096");
    expect(upload?.size).toBe(4096);

    expect(polls).toBe(2);
    expect(new URLSearchParams(calls.find((c) => c.url.endsWith("/media_publish"))?.body).get("creation_id")).toBe("c1");
  });

  it("lets Instagram fetch a public video (signed URL) instead of uploading it", async () => {
    calls.length = 0;
    const port = (server.address() as { port: number }).port;
    const dir = mkdtempSync(path.join(tmpdir(), "ig-test-"));
    writeFileSync(path.join(dir, "video.mp4"), Buffer.alloc(1024, 7));
    const media: Media = {
      video: "video.mp4",
      videoSource: "release asset demo.mp4",
      videoUrl: `http://127.0.0.1:${port}/release/video.mp4`,
      image: "",
      imageSource: "",
    };
    const posts = { instagram: "Reel", perLanguage: [] } as unknown as Posts;

    const result = await publish({ app } as Context, posts, media, dir);

    expect(result.status).toBe("posted");
    const container = new URLSearchParams(calls.find((c) => c.url === "/v24.0/1784/media")?.body);
    expect(container.get("video_url")).toBe(`http://127.0.0.1:${port}/signed/video.mp4?sig=abc`);
    expect(container.get("upload_type")).toBeNull();
    expect(calls.some((c) => c.url.startsWith("/ig-api-upload/"))).toBe(false);
  });

  it("skips an update without a video", async () => {
    const result = await publish({ app } as Context, { perLanguage: [] } as unknown as Posts, { video: "", videoSource: "", image: "", imageSource: "" }, tmpdir());
    expect(result.status).toBe("skipped");
  });
});
