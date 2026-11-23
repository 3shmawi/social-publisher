// YouTube thumbnail and captions against a local fake of the YouTube API.
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCaptions, addThumbnail } from "../scripts/platforms/youtube.ts";

let server: Server;
const calls: { url: string; type: string; body: string }[] = [];
let thumbStatus = 200;
let captionStatus = 200;
let captionBody = "{}";
const saved = { ...process.env };
let dir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "yt-"));
  writeFileSync(path.join(dir, "thumb.png"), Buffer.from([0x89, 0x50]));
  writeFileSync(path.join(dir, "big.jpg"), Buffer.alloc(3 * 1024 * 1024));
  writeFileSync(path.join(dir, "captions.en.srt"), "1\n00:00:00,000 --> 00:00:01,000\nDark mode\n");
  writeFileSync(path.join(dir, "captions.ar.srt"), "1\n00:00:00,000 --> 00:00:01,000\nالوضع الليلي\n");
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      calls.push({ url: req.url ?? "", type: String(req.headers["content-type"]), body });
      const isThumb = (req.url ?? "").includes("/thumbnails/set");
      res.writeHead(isThumb ? thumbStatus : captionStatus, { "Content-Type": "application/json" });
      res.end(isThumb ? "{}" : captionBody);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.YT_API_BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  server.close();
  process.env = saved;
});

describe("addThumbnail", () => {
  it("uploads the image for the video", async () => {
    calls.length = 0;
    expect(await addThumbnail("vid1", path.join(dir, "thumb.png"), "t")).toBe("Custom thumbnail set.");
    expect(calls[0]!.url).toContain("/upload/youtube/v3/thumbnails/set?videoId=vid1");
    expect(calls[0]!.type).toBe("image/png");
  });

  it("explains an unverified channel instead of failing", async () => {
    thumbStatus = 403;
    expect(await addThumbnail("vid1", path.join(dir, "thumb.png"), "t")).toContain("verify it with a phone number");
    thumbStatus = 200;
  });

  it("skips images over 2 MB", async () => {
    expect(await addThumbnail("vid1", path.join(dir, "big.jpg"), "t")).toContain("2 MB");
  });
});

describe("addCaptions", () => {
  const files = () => [
    { language: "en", file: path.join(dir, "captions.en.srt") },
    { language: "ar", file: path.join(dir, "captions.ar.srt") },
  ];

  it("uploads each language as a multipart request", async () => {
    calls.length = 0;
    expect(await addCaptions("vid1", files(), "t")).toBe("Captions: en, ar.");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.type).toMatch(/^multipart\/related; boundary=/);
    expect(calls[0]!.body).toContain('"videoId":"vid1"');
    expect(calls[1]!.body).toContain("الوضع الليلي");
  });

  it("says when the token lacks the captions scope", async () => {
    captionStatus = 403;
    captionBody = JSON.stringify({ error: { errors: [{ reason: "insufficientPermissions" }] } });
    expect(await addCaptions("vid1", files(), "t")).toContain("youtube.force-ssl");
    captionStatus = 200;
  });
});
