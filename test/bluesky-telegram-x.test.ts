// Bluesky, Telegram and X against local fakes of their APIs.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppInfo, Context, LanguagePosts, Media, Posts } from "../scripts/lib/content.ts";
import * as bluesky from "../scripts/platforms/bluesky.ts";
import * as telegram from "../scripts/platforms/telegram.ts";
import * as x from "../scripts/platforms/x.ts";

const app: AppInfo = { name: "Cafe Menu", playStoreUrl: "", appStoreUrl: "", websiteUrl: "https://cafe.example.com", about: "" };
const lang: LanguagePosts = {
  language: "en",
  linkedin: "",
  hashtags: ["Flutter"],
  facebook: "Dark mode is here.",
  youtubeTitle: "",
  youtubeDescription: "",
  youtubeTags: [],
};
const ctx = { app, key: "v1.2.0", tag: "v1.2.0", title: "v1.2.0" } as Context;
const posts = {
  perLanguage: [lang],
  headline: "Dark mode arrives",
  bluesky: "Dark mode 🌙 is here https://cafe.example.com #Flutter",
  telegram: "Dark mode is here.\n\nWebsite: https://cafe.example.com",
  x: "Dark mode is here.\n\nhttps://cafe.example.com #Flutter",
} as Posts;
const noMedia: Media = { video: "", videoSource: "", image: "", imageSource: "" };

let server: Server;
let port = 0;
const calls: { method: string; url: string; body: string; headers: IncomingMessage["headers"] }[] = [];
const saved = { ...process.env };
let out = "";

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), "short-"));
  mkdirSync(path.join(out, "media"));
  writeFileSync(path.join(out, "media", "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(out, "media", "video.mp4"), Buffer.alloc(1024));
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => chunks.push(d));
    req.on("end", () => {
      const url = req.url ?? "";
      calls.push({ method: req.method ?? "", url, body: Buffer.concat(chunks).toString("utf8"), headers: req.headers });
      const json = (o: unknown, status = 200) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(o));
      };
      // Bluesky
      if (url === "/xrpc/com.atproto.server.createSession") {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { password: string };
        if (body.password !== "app-pass") return json({ error: "AuthenticationRequired", message: "Invalid identifier or password" }, 401);
        return json({ accessJwt: "jwt", did: "did:plc:abc", handle: "cafe.bsky.social" });
      }
      if (url === "/xrpc/com.atproto.repo.uploadBlob") return json({ blob: { $type: "blob", ref: { $link: "bafy" }, mimeType: "image/png", size: 4 } });
      if (url === "/xrpc/com.atproto.repo.createRecord") return json({ uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz", cid: "c" });
      // Telegram
      if (url.startsWith("/botTOKEN:1/getMe")) return json({ ok: true, result: { username: "cafe_bot" } });
      if (url.startsWith("/botTOKEN:1/getChat")) return json({ ok: true, result: { title: "Cafe news", username: "cafenews" } });
      if (url.startsWith("/botTOKEN:1/send")) return json({ ok: true, result: { message_id: 77, chat: { username: "cafenews" } } });
      if (url.startsWith("/botBAD")) return json({ ok: false, description: "Unauthorized" }, 401);
      // X
      if (url === "/2/users/me") return json({ data: { username: "cafemenu" } });
      if (url === "/2/tweets") return json({ data: { id: "1855" } }, 201);
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    BLUESKY_SERVICE: `http://127.0.0.1:${port}`,
    BLUESKY_HANDLE: "@cafe.bsky.social",
    BLUESKY_APP_PASSWORD: "app-pass",
    TELEGRAM_API_BASE: `http://127.0.0.1:${port}`,
    TELEGRAM_BOT_TOKEN: "TOKEN:1",
    TELEGRAM_CHAT_ID: "@cafenews",
    X_API_BASE: `http://127.0.0.1:${port}`,
    X_API_KEY: "k",
    X_API_SECRET: "s",
    X_ACCESS_TOKEN: "t",
    X_ACCESS_SECRET: "ts",
  });
});
afterAll(() => {
  server.close();
  process.env = saved;
});

describe("Bluesky", () => {
  it("marks links and hashtags by UTF-8 byte offsets", () => {
    const text = "الوضع 🌙 https://cafe.example.com #فلاتر";
    const [link, tag] = bluesky.facets(text);
    const bytes = Buffer.from(text);
    expect(bytes.subarray(link!.index.byteStart, link!.index.byteEnd).toString()).toBe("https://cafe.example.com");
    expect(bytes.subarray(tag!.index.byteStart, tag!.index.byteEnd).toString()).toBe("#فلاتر");
    expect(tag!.features[0]).toEqual({ $type: "app.bsky.richtext.facet#tag", tag: "فلاتر" });
  });

  it("doesn't take a trailing full stop into a link", () => {
    expect(bluesky.facets("See https://cafe.example.com.")[0]!.features[0]).toMatchObject({ uri: "https://cafe.example.com" });
  });

  it("posts with the image and its alt text", async () => {
    calls.length = 0;
    const result = await bluesky.publish(ctx, posts, { ...noMedia, image: "media/image.png", imageAlt: "The menu in dark mode" }, out);
    expect(result.status).toBe("posted");
    expect(result.links[0]!.url).toBe("https://bsky.app/profile/cafe.bsky.social/post/3kxyz");
    const record = JSON.parse(calls.find((c) => c.url.endsWith("createRecord"))!.body).record;
    expect(record.text).toBe(posts.bluesky);
    expect(record.embed.images[0].alt).toBe("The menu in dark mode");
    expect(record.facets).toHaveLength(2);
  });

  it("uses a link card without an image", async () => {
    calls.length = 0;
    await bluesky.publish(ctx, posts, noMedia, out);
    const record = JSON.parse(calls.find((c) => c.url.endsWith("createRecord"))!.body).record;
    expect(record.embed).toMatchObject({ $type: "app.bsky.embed.external", external: { uri: "https://cafe.example.com" } });
  });

  it("explains a wrong app password", async () => {
    process.env.BLUESKY_APP_PASSWORD = "nope";
    await expect(bluesky.preflight()).rejects.toThrow(/app password was refused/);
    process.env.BLUESKY_APP_PASSWORD = "app-pass";
  });
});

describe("Telegram", () => {
  it("checks the bot and the channel", async () => {
    expect(await telegram.preflight()).toBe("bot @cafe_bot → Cafe news");
  });

  it("sends the video with the caption, and links the message", async () => {
    calls.length = 0;
    const result = await telegram.publish(ctx, posts, { ...noMedia, video: "media/video.mp4" }, out);
    expect(calls[0]!.url).toBe("/botTOKEN:1/sendVideo");
    expect(calls[0]!.body).toContain(posts.telegram!.split("\n")[0]);
    expect(result.links[0]!.url).toBe("https://t.me/cafenews/77");
  });

  it("sends text when there is no media", async () => {
    calls.length = 0;
    await telegram.publish(ctx, posts, noMedia, out);
    expect(calls[0]!.url).toBe("/botTOKEN:1/sendMessage");
  });

  it("never puts the bot token in an error message", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "BAD:2";
    await expect(telegram.preflight()).rejects.toThrow(/TELEGRAM_BOT_TOKEN was refused/);
    await telegram.preflight().catch((err: Error) => expect(err.message).not.toContain("BAD:2"));
    process.env.TELEGRAM_BOT_TOKEN = "TOKEN:1";
  });
});

describe("X", () => {
  it("signs requests like the OAuth 1.0a reference example", () => {
    // Twitter's documented example ("Creating a signature").
    const header = x.oauthHeader(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21",
      {
        key: "xvz1evFS4wEEPTGEFPHBog",
        secret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      "1318622958",
    );
    expect(header).toContain(`oauth_signature="${x.percent("hCtSmYh+iHYCEqBWrE7C7hYmtUk=")}"`);
  });

  it("checks the account", async () => {
    expect(await x.preflight()).toBe("account @cafemenu");
  });

  it("posts the text once, signed", async () => {
    calls.length = 0;
    const result = await x.publish(ctx, posts);
    expect(result.links[0]!.url).toBe("https://x.com/i/web/status/1855");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.body)).toEqual({ text: posts.x });
    expect(String(calls[0]!.headers.authorization)).toMatch(/^OAuth oauth_consumer_key="k", .*oauth_signature="/);
  });
});
