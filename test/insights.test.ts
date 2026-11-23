// Insights: posted records stored in annotated tags and read back, the
// 7-day window, and metrics from fakes of the Bluesky and Instagram APIs.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pick, table } from "../scripts/insights.ts";
import { type PostedRecord, postedRecords, putPostedTag } from "../scripts/lib/github.ts";
import { metaInsights, metricsFor } from "../scripts/lib/metrics.ts";

let server: Server;
const saved = { ...process.env };
const tags = new Map<string, { message: string }>();
const refs = new Map<string, { type: string; sha: string }>();

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const url = req.url ?? "";
      const json = (o: unknown, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(o));
      // GitHub git data
      if (req.method === "POST" && url === "/repos/me/cafe/git/tags") {
        const body = JSON.parse(raw) as { message: string };
        const sha = `tag${tags.size + 1}`;
        tags.set(sha, { message: body.message });
        return json({ sha }, 201);
      }
      const patch = /^\/repos\/me\/cafe\/git\/refs\/(.+)$/.exec(url);
      if (req.method === "PATCH" && patch) return json({}, 422);
      if (req.method === "POST" && url === "/repos/me/cafe/git/refs") {
        const body = JSON.parse(raw) as { ref: string; sha: string };
        refs.set(body.ref, { type: body.sha.startsWith("tag") ? "tag" : "commit", sha: body.sha });
        return json({}, 201);
      }
      if (url === "/repos/me/cafe/git/matching-refs/tags/social/posted/") {
        return json([...refs.entries()].map(([ref, object]) => ({ ref, object })));
      }
      const tag = /^\/repos\/me\/cafe\/git\/tags\/(.+)$/.exec(url);
      if (tag) return json(tags.get(tag[1]!) ?? {}, tags.has(tag[1]!) ? 200 : 404);
      // Bluesky AppView
      if (url.startsWith("/xrpc/app.bsky.feed.getPosts")) {
        return json({ posts: [{ likeCount: 12, repostCount: 3, quoteCount: 1, replyCount: 4 }] });
      }
      // Instagram
      if (url.startsWith("/v24.0/m1/insights")) {
        return json({ data: [{ name: "views", values: [{ value: 1500 }] }, { name: "likes", total_value: { value: 80 } }] });
      }
      res.writeHead(404).end(JSON.stringify({ error: { message: "nope" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  Object.assign(process.env, {
    GITHUB_API_URL: base,
    GITHUB_REPOSITORY: "me/cafe",
    GITHUB_TOKEN: "t",
    BLUESKY_APPVIEW: base,
    IG_GRAPH_BASE: base,
    FB_PAGE_TOKEN: "t",
  });
});
afterAll(() => {
  server.close();
  process.env = saved;
});

const record = (over: Partial<PostedRecord> = {}): PostedRecord => ({
  key: "v1.2.0",
  platform: "bluesky",
  channel: "bluesky",
  ids: ["at://did:plc:x/app.bsky.feed.post/1"],
  links: [{ label: "Bluesky post", url: "https://bsky.app/profile/x/post/1" }],
  postedAt: "2026-11-16T10:00:00.000Z",
  ...over,
});

describe("posted records", () => {
  it("are stored in an annotated tag and read back", async () => {
    await putPostedTag("tags/social/posted/v1.2.0/bluesky", "commit1", record());
    const back = await postedRecords();
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(record());
    expect(refs.get("refs/tags/social/posted/v1.2.0/bluesky")?.type).toBe("tag");
  });
});

describe("pick", () => {
  const now = new Date("2026-11-23T12:00:00.000Z");

  it("takes the posts from the day 7 days ago, so a daily run sees each once", () => {
    const records = [
      record({ postedAt: "2026-11-16T10:00:00.000Z" }),
      record({ postedAt: "2026-11-15T10:00:00.000Z" }),
      record({ postedAt: "2026-11-20T10:00:00.000Z" }),
    ];
    expect(pick(records, now, 7).map((r) => r.postedAt)).toEqual(["2026-11-16T10:00:00.000Z"]);
  });

  it("or every post of one update", () => {
    expect(pick([record(), record({ key: "v1.1.0" })], now, 7, "v1.1.0")).toHaveLength(1);
  });
});

describe("metrics", () => {
  it("reads Bluesky counts from the public AppView", async () => {
    expect(await metricsFor("bluesky", "at://x")).toEqual({ likes: 12, comments: 4, shares: 4 });
  });

  it("reads Instagram insights (values or total_value)", async () => {
    expect(await metricsFor("instagram", "m1")).toMatchObject({ views: 1500, likes: 80 });
    expect(metaInsights([{ name: "views", values: [{ value: 3 }] }])).toEqual({ views: 3 });
  });

  it("never throws: a failing platform becomes a note", async () => {
    const m = await metricsFor("instagram", "unknown");
    expect(m.note).toBeTruthy();
  });

  it("says why TikTok, Telegram and X (unless asked) have no numbers", async () => {
    expect((await metricsFor("tiktok", "p")).note).toContain("TikTok Studio");
    expect((await metricsFor("telegram", "1")).note).toContain("Bot API");
    expect((await metricsFor("x", "1")).note).toContain("x_insights");
  });
});

describe("table", () => {
  it("links each post and leaves missing numbers as –", () => {
    const md = table([{ record: record(), metrics: { likes: 1200, note: "a | b" } }]);
    expect(md).toContain("| v1.2.0 | [bluesky](https://bsky.app/profile/x/post/1) | – | 1,200 | – | – | a \\| b |");
  });
});
