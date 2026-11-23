// How each post did, read from each platform a few days after posting
// (scripts/insights.ts). Best effort: a platform that doesn't share a
// number (or a token without the scope) gives "n/a" with the reason, never
// an error that stops the report.
import { env, envBool, mask } from "./env.ts";
import { requestJson } from "./http.ts";
import { oauthHeader } from "../platforms/x.ts";

export interface Metrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  /** Why some or all numbers are missing. */
  note?: string;
}

const graphVersion = () => env("FB_GRAPH_VERSION", "v24.0");

/** Meta's insights arrays: [{ name, values: [{ value }] } | { name, total_value: { value } }]. */
export function metaInsights(data: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of data) {
    const value = d.total_value?.value ?? d.values?.[0]?.value;
    if (typeof value === "number") out[d.name] = value;
  }
  return out;
}

async function facebook(id: string): Promise<Metrics> {
  const token = env("FB_PAGE_TOKEN");
  mask(token);
  const headers = { Authorization: `Bearer ${token}` };
  const base = `${env("FB_GRAPH_BASE", "https://graph.facebook.com")}/${graphVersion()}`;
  const [kind, raw] = id.includes(":") ? id.split(":", 2) : ["post", id];
  if (kind === "video") {
    const info = await requestJson<{ likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }>(
      `${base}/${raw}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0)`,
      { headers, label: "Facebook video stats" },
    );
    let views: number | undefined;
    try {
      const insights = await requestJson<{ data: { name: string; values?: { value?: number }[] }[] }>(
        `${base}/${raw}/video_insights?metric=total_video_views`,
        { headers, label: "Facebook video views" },
      );
      views = metaInsights(insights.data).total_video_views;
    } catch {
      // views need read_insights; the rest still counts
    }
    return { views, likes: info.likes?.summary?.total_count, comments: info.comments?.summary?.total_count };
  }
  const post = await requestJson<{
    reactions?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
    shares?: { count?: number };
  }>(`${base}/${raw}?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares`, {
    headers,
    label: "Facebook post stats",
  });
  return { likes: post.reactions?.summary?.total_count, comments: post.comments?.summary?.total_count, shares: post.shares?.count ?? 0 };
}

async function instagram(id: string): Promise<Metrics> {
  const token = env("FB_PAGE_TOKEN");
  mask(token);
  const base = `${env("IG_GRAPH_BASE", "https://graph.facebook.com")}/${graphVersion()}`;
  const res = await requestJson<{ data: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[] }>(
    `${base}/${id}/insights?metric=views,likes,comments,shares`,
    { headers: { Authorization: `Bearer ${token}` }, label: "Instagram insights" },
  );
  const m = metaInsights(res.data);
  return { views: m.views, likes: m.likes, comments: m.comments, shares: m.shares };
}

async function threads(id: string): Promise<Metrics> {
  const token = env("THREADS_TOKEN");
  mask(token);
  const res = await requestJson<{ data: { name: string; values?: { value?: number }[]; total_value?: { value?: number } }[] }>(
    `${env("THREADS_API_BASE", "https://graph.threads.net")}/v1.0/${id}/insights?metric=views,likes,replies,reposts,quotes`,
    { headers: { Authorization: `Bearer ${token}` }, label: "Threads insights" },
  );
  const m = metaInsights(res.data);
  return { views: m.views, likes: m.likes, comments: m.replies, shares: (m.reposts ?? 0) + (m.quotes ?? 0) };
}

async function youtube(id: string): Promise<Metrics> {
  const token = await requestJson<{ access_token: string }>(env("YT_TOKEN_URL", "https://oauth2.googleapis.com/token"), {
    method: "POST",
    body: new URLSearchParams({
      client_id: env("YT_CLIENT_ID"),
      client_secret: env("YT_CLIENT_SECRET"),
      refresh_token: env("YT_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
    label: "YouTube token",
  });
  mask(token.access_token);
  const res = await requestJson<{ items?: { statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
    `${env("YT_API_BASE", "https://www.googleapis.com")}/youtube/v3/videos?part=statistics&id=${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${token.access_token}` }, label: "YouTube stats" },
  );
  const s = res.items?.[0]?.statistics;
  if (!s) return { note: "video not found (deleted?)" };
  const n = (v?: string) => (v === undefined ? undefined : Number(v));
  return { views: n(s.viewCount), likes: n(s.likeCount), comments: n(s.commentCount) };
}

async function linkedin(urn: string): Promise<Metrics> {
  const token = env("LINKEDIN_TOKEN");
  mask(token);
  const res = await requestJson<{ likesSummary?: { totalLikes?: number }; commentsSummary?: { aggregatedTotalComments?: number } }>(
    `${env("LINKEDIN_API_BASE", "https://api.linkedin.com")}/rest/socialActions/${encodeURIComponent(urn)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "LinkedIn-Version": env("LINKEDIN_VERSION", "202609"),
        "X-Restli-Protocol-Version": "2.0.0",
      },
      label: "LinkedIn social actions",
    },
  );
  return { likes: res.likesSummary?.totalLikes, comments: res.commentsSummary?.aggregatedTotalComments };
}

async function bluesky(uri: string): Promise<Metrics> {
  const res = await requestJson<{ posts?: { likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }[] }>(
    `${env("BLUESKY_APPVIEW", "https://public.api.bsky.app")}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`,
    { label: "Bluesky post" },
  );
  const p = res.posts?.[0];
  if (!p) return { note: "post not found (deleted?)" };
  return { likes: p.likeCount, comments: p.replyCount, shares: (p.repostCount ?? 0) + (p.quoteCount ?? 0) };
}

async function x(id: string): Promise<Metrics> {
  // Every X read is billed: only when asked for.
  if (!envBool("X_INSIGHTS")) return { note: "off (x_insights: X bills each read)" };
  const url = `${env("X_API_BASE", "https://api.x.com")}/2/tweets/${encodeURIComponent(id)}?tweet.fields=public_metrics`;
  const creds = {
    key: env("X_API_KEY"),
    secret: env("X_API_SECRET"),
    token: env("X_ACCESS_TOKEN"),
    tokenSecret: env("X_ACCESS_SECRET"),
  };
  const res = await requestJson<{
    data?: { public_metrics?: { impression_count?: number; like_count?: number; reply_count?: number; retweet_count?: number; quote_count?: number } };
  }>(url, { headers: { Authorization: oauthHeader("GET", url, creds) }, label: "X post" });
  const m = res.data?.public_metrics ?? {};
  return { views: m.impression_count, likes: m.like_count, comments: m.reply_count, shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0) };
}

const readers: Record<string, (id: string) => Promise<Metrics>> = {
  facebook,
  instagram,
  threads,
  youtube,
  linkedin,
  bluesky,
  x,
};

const notShared: Record<string, string> = {
  tiktok: "a draft in your inbox — see TikTok Studio",
  telegram: "the Bot API doesn't share view counts — see the channel",
};

/** The numbers for one post; never throws. */
export async function metricsFor(platform: string, id: string): Promise<Metrics> {
  if (notShared[platform]) return { note: notShared[platform] };
  const read = readers[platform];
  if (!read || !id) return { note: "no post id recorded" };
  try {
    return await read(id);
  } catch (err) {
    return { note: (err as Error).message.slice(0, 160) };
  }
}
