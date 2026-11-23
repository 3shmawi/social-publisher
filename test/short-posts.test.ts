// The short-post text rules (Threads, Bluesky, Telegram, X) and the Threads
// flow against a local fake of the Threads API.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AppInfo,
  buildShortPosts,
  type Context,
  fitText,
  graphemeCount,
  type LanguagePosts,
  type Posts,
  SHORT_LIMITS,
  threadsLength,
  xLength,
} from "../scripts/lib/content.ts";
import * as threads from "../scripts/platforms/threads.ts";

const app: AppInfo = {
  name: "Cafe Menu",
  playStoreUrl: "https://play.google.com/store/apps/details?id=com.example.cafe",
  appStoreUrl: "",
  websiteUrl: "https://cafe.example.com",
  about: "",
};
const post = (language: string, extra: Partial<LanguagePosts> = {}): LanguagePosts => ({
  language,
  linkedin: "",
  hashtags: ["Flutter", "#DarkMode", "MobileApps"],
  facebook: "Dark mode is here 🌙. Easier on your eyes at night. Menus load faster too.",
  youtubeTitle: "",
  youtubeDescription: "",
  youtubeTags: [],
  ...extra,
});

describe("fitText", () => {
  it("keeps short text as it is", () => {
    expect(fitText("Hello there.", 50)).toBe("Hello there.");
  });

  it("cuts at a sentence end when it can", () => {
    expect(fitText("First one. Second one is longer. Third.", 25)).toBe("First one.");
  });

  it("falls back to whole words and an ellipsis", () => {
    const out = fitText("one two three four five six seven", 16);
    expect(out).toBe("one two three…");
    expect(graphemeCount(out)).toBeLessThanOrEqual(16);
  });

  it("understands Arabic sentence ends", () => {
    expect(fitText("الوضع الليلي وصل؟ نعم وصل أخيرًا وبشكل رائع.", 20)).toBe("الوضع الليلي وصل؟");
  });
});

describe("lengths", () => {
  it("X counts links as 23 and wide characters as 2", () => {
    expect(xLength("hi https://example.com/a/very/long/path/that/goes/on")).toBe(3 + 23);
    expect(xLength("日本")).toBe(4);
    expect(xLength("مرحبا")).toBe(5);
  });

  it("Bluesky counts an emoji with modifiers once", () => {
    expect(graphemeCount("👍🏽ok")).toBe(3);
  });

  it("Threads counts emoji by their UTF-8 size (safe side)", () => {
    expect(threadsLength("a🌙")).toBe(5);
  });
});

describe("buildShortPosts", () => {
  const long = post("en", { facebook: `${"Dark mode is here and it is lovely. ".repeat(40)}` });

  it("fits every platform's limit, with the link", () => {
    const short = buildShortPosts([long, post("ar")], app);
    expect(threadsLength(short.threads)).toBeLessThanOrEqual(SHORT_LIMITS.threads);
    expect(graphemeCount(short.bluesky)).toBeLessThanOrEqual(SHORT_LIMITS.bluesky);
    expect([...short.telegram].length).toBeLessThanOrEqual(SHORT_LIMITS.telegram);
    expect(xLength(short.x)).toBeLessThanOrEqual(SHORT_LIMITS.x);
    for (const text of [short.threads, short.bluesky, short.x]) {
      expect(text).toContain("https://cafe.example.com");
    }
  });

  it("uses the main language only on the shortest platforms", () => {
    const short = buildShortPosts([post("en"), post("ar", { facebook: "الوضع الليلي وصل" })], app);
    expect(short.x).not.toContain("الوضع");
    expect(short.telegram).toContain("الوضع الليلي وصل");
  });

  it("leaves the link out of X when asked (links cost more there)", () => {
    const short = buildShortPosts([post("en")], app, { xLinks: false });
    expect(short.x).not.toContain("http");
    expect(short.x).toContain("#Flutter");
  });
});

describe("Threads", () => {
  let server: Server;
  const calls: { method: string; url: string; body: string; auth: string }[] = [];
  let polls = 0;
  const saved = { ...process.env };
  const ctx = { app, key: "v1.2.0", tag: "v1.2.0" } as Context;
  const posts = { perLanguage: [post("en")], threads: "Dark mode is here 🌙\n\nhttps://cafe.example.com" } as Posts;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const url = req.url ?? "";
        calls.push({ method: req.method ?? "", url, body, auth: String(req.headers.authorization) });
        const json = (o: unknown) => res.setHeader("Content-Type", "application/json").end(JSON.stringify(o));
        if (url.startsWith("/v1.0/me?")) return json({ username: "cafemenu" });
        if (url === "/v1.0/42/threads") return json({ id: "c1" });
        if (url.startsWith("/v1.0/c1?")) return json({ status: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" });
        if (url === "/v1.0/42/threads_publish") return json({ id: "p9" });
        if (url.startsWith("/v1.0/p9?")) return json({ permalink: "https://www.threads.net/@cafemenu/post/abc" });
        if (url.startsWith("/refresh_access_token?")) return json({ access_token: "new-token", expires_in: 5184000 });
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    Object.assign(process.env, {
      THREADS_API_BASE: `http://127.0.0.1:${port}`,
      THREADS_USER_ID: "42",
      THREADS_TOKEN: "secret-token",
      THREADS_STATUS_INTERVAL_MS: "1",
    });
  });
  afterAll(() => {
    server.close();
    process.env = saved;
  });

  it("needs both secrets", () => {
    const token = process.env.THREADS_TOKEN;
    delete process.env.THREADS_TOKEN;
    expect(threads.configured()).toContain("THREADS_TOKEN");
    process.env.THREADS_TOKEN = token;
    expect(threads.configured()).toBe("");
  });

  it("checks the account before approval", async () => {
    expect(await threads.preflight()).toBe("account @cafemenu");
  });

  it("posts text when there is no public video", async () => {
    calls.length = 0;
    const result = await threads.publish(ctx, posts, { video: "", videoSource: "", image: "", imageSource: "" });
    expect(result.status).toBe("posted");
    expect(result.links[0]?.url).toBe("https://www.threads.net/@cafemenu/post/abc");
    expect(result.ids).toEqual(["p9"]);
    const create = new URLSearchParams(calls.find((c) => c.url === "/v1.0/42/threads")!.body);
    expect(create.get("media_type")).toBe("TEXT");
    expect(create.get("text")).toBe(posts.threads);
    // The token travels in the header, never in the URL.
    expect(calls.every((c) => !c.url.includes("secret-token") && c.auth === "Bearer secret-token")).toBe(true);
  });

  it("posts the video when it has a public URL, after it processed", async () => {
    calls.length = 0;
    const result = await threads.publish(ctx, posts, {
      video: "media/video.mp4",
      videoSource: "release asset",
      videoUrl: "https://github.com/me/cafe/releases/download/v1.2.0/demo.mp4",
      image: "",
      imageSource: "",
    });
    expect(result.detail).toContain("video");
    const create = new URLSearchParams(calls.find((c) => c.url === "/v1.0/42/threads")!.body);
    expect(create.get("media_type")).toBe("VIDEO");
    expect(calls.filter((c) => c.url.startsWith("/v1.0/c1?")).length).toBeGreaterThanOrEqual(2);
  });

  it("refreshes the long-lived token", async () => {
    expect(await threads.refreshToken()).toEqual({ token: "new-token", days: 60 });
  });

  it("explains an expired token", async () => {
    process.env.THREADS_USER_ID = "7";
    await expect(threads.publish(ctx, posts, { video: "", videoSource: "", image: "", imageSource: "" })).rejects.toThrow(
      /THREADS_TOKEN is expired/,
    );
    process.env.THREADS_USER_ID = "42";
  });
});
