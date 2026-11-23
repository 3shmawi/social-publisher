// Images without a video: Instagram image / carousel, LinkedIn multi-image,
// alt text — against local fakes of the Graph and LinkedIn APIs.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppInfo, type Context, imageAlt, type Media, type Posts } from "../scripts/lib/content.ts";
import * as instagram from "../scripts/platforms/instagram.ts";
import * as linkedin from "../scripts/platforms/linkedin.ts";

const app: AppInfo = { name: "Cafe Menu", playStoreUrl: "", appStoreUrl: "", websiteUrl: "https://cafe.example.com", about: "" };
const ctx = { app, key: "v1.2.0", tag: "v1.2.0", title: "v1.2.0" } as Context;
const posts = {
  perLanguage: [],
  headline: "Dark mode arrives",
  instagram: "Dark mode is here",
  linkedin: "Dark mode is here",
  youtube: { title: "", description: "", tags: [], defaultLanguage: "en", localizations: {} },
} as unknown as Posts;
const media = (n: number, publicUrls = true): Media => ({
  video: "",
  videoSource: "",
  image: "media/image-1.png",
  imageSource: "release asset 1.png",
  images: Array.from({ length: n }, (_, i) => `media/image-${i + 1}.png`),
  imageUrls: Array.from({ length: n }, (_, i) => (publicUrls ? `https://example.com/${i + 1}.png` : "")),
  imageAlts: Array.from({ length: n }, (_, i) => (i === 0 ? "The menu in dark mode" : "")),
});

let server: Server;
const calls: { method: string; url: string; body: string }[] = [];
const saved = { ...process.env };
let out = "";

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), "images-"));
  mkdirSync(path.join(out, "media"));
  for (let i = 1; i <= 3; i++) writeFileSync(path.join(out, "media", `image-${i}.png`), Buffer.from([0x89, 0x50, i]));
  let child = 0;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const url = req.url ?? "";
      calls.push({ method: req.method ?? "", url, body });
      const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers });
        res.end(JSON.stringify(o));
      };
      const port = (server.address() as { port: number }).port;
      // Instagram
      if (url === "/v24.0/1784/media") {
        const p = new URLSearchParams(body);
        return json({ id: p.get("media_type") === "CAROUSEL" ? "carousel" : p.get("is_carousel_item") ? `child${++child}` : "single" });
      }
      if (/^\/v24\.0\/(carousel|single)\?/.test(url)) return json({ status_code: "FINISHED" });
      if (url === "/v24.0/1784/media_publish") return json({ id: "m1" });
      if (url.startsWith("/v24.0/m1?")) return json({ permalink: "https://www.instagram.com/p/abc/" });
      // LinkedIn
      if (url === "/rest/images?action=initializeUpload") {
        return json({ value: { uploadUrl: `http://127.0.0.1:${port}/upload/${calls.length}`, image: `urn:li:image:${calls.length}` } });
      }
      if (url.startsWith("/upload/")) return json({}, 201);
      if (url === "/rest/posts") return json({}, 201, { "x-restli-id": "urn:li:share:9" });
      res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    IG_GRAPH_BASE: `http://127.0.0.1:${port}`,
    IG_USER_ID: "1784",
    FB_PAGE_TOKEN: "t",
    IG_STATUS_INTERVAL_MS: "1",
    LINKEDIN_API_BASE: `http://127.0.0.1:${port}`,
    LINKEDIN_TOKEN: "t",
    LINKEDIN_AUTHOR_URN: "urn:li:person:me",
    LINKEDIN_AS: "person",
  });
});
afterAll(() => {
  server.close();
  process.env = saved;
});

describe("imageAlt", () => {
  it("uses the given alt text, else the app and headline", () => {
    const m = media(2);
    expect(imageAlt(m, 0, ctx, posts)).toBe("The menu in dark mode");
    expect(imageAlt(m, 1, ctx, posts)).toBe("Cafe Menu: Dark mode arrives");
  });
});

describe("Instagram without a video", () => {
  it("posts one image with its alt text", async () => {
    calls.length = 0;
    const result = await instagram.publish(ctx, posts, media(1), out);
    expect(result.detail).toBe("Published the image.");
    const create = new URLSearchParams(calls.find((c) => c.url === "/v24.0/1784/media")!.body);
    expect(create.get("image_url")).toBe("https://example.com/1.png");
    expect(create.get("alt_text")).toBe("The menu in dark mode");
  });

  it("posts 2–10 images as a carousel", async () => {
    calls.length = 0;
    const result = await instagram.publish(ctx, posts, media(3), out);
    expect(result.detail).toBe("Published a carousel.");
    const creates = calls.filter((c) => c.url === "/v24.0/1784/media").map((c) => new URLSearchParams(c.body));
    expect(creates.filter((p) => p.get("is_carousel_item") === "true")).toHaveLength(3);
    const carousel = creates.find((p) => p.get("media_type") === "CAROUSEL")!;
    expect(carousel.get("children")?.split(",")).toHaveLength(3);
    expect(carousel.get("caption")).toBe("Dark mode is here");
  });

  it("skips when the images aren't public (Instagram fetches them itself)", async () => {
    const result = await instagram.publish(ctx, posts, media(2, false), out);
    expect(result.status).toBe("skipped");
    expect(result.detail).toContain("public URL");
  });
});

describe("LinkedIn without a video", () => {
  it("uploads the images and posts them together, with alt text", async () => {
    calls.length = 0;
    const link = await linkedin.publish(posts, linkedin.targets()[0]!, media(3), out, ctx);
    expect(link.url).toContain("urn:li:share:9");
    expect(calls.filter((c) => c.url === "/rest/images?action=initializeUpload")).toHaveLength(3);
    const post = JSON.parse(calls.find((c) => c.url === "/rest/posts")!.body);
    expect(post.content.multiImage.images).toHaveLength(3);
    expect(post.content.multiImage.images[0].altText).toBe("The menu in dark mode");
  });

  it("posts a single image as media", async () => {
    calls.length = 0;
    await linkedin.publish(posts, linkedin.targets()[0]!, media(1), out, ctx);
    const post = JSON.parse(calls.find((c) => c.url === "/rest/posts")!.body);
    expect(post.content.media.altText).toBe("The menu in dark mode");
  });
});
