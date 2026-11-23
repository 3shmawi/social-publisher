// YouTube Data API v3: videos.insert with a resumable, chunked upload.
// The OAuth refresh token is exchanged for a 1-hour access token each run.
//
// Until your Google Cloud project passes YouTube's API audit, every video it
// uploads is locked to private, whatever privacy you ask for. And while the
// OAuth consent screen is in "Testing", refresh tokens die after 7 days.
// docs/youtube.md explains both.
import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { Media, PlatformResult, Posts } from "../lib/content.ts";
import { env, mask } from "../lib/env.ts";
import { HttpError, request, requestJson, truncate } from "../lib/http.ts";

const CHUNK = 8 * 1024 * 1024; // a multiple of 256 KiB, as YouTube requires

export function configured(): string {
  const missing = ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"].filter((n) => !env(n));
  return missing.length ? `missing secrets ${missing.join(", ")}` : "";
}

export function privacy(): "private" | "unlisted" | "public" {
  const value = env("YT_PRIVACY", "private").toLowerCase();
  return value === "public" || value === "unlisted" ? value : "private";
}

let cachedToken = "";

async function accessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  try {
    const res = await requestJson<{ access_token: string }>("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("YT_CLIENT_ID"),
        client_secret: env("YT_CLIENT_SECRET"),
        refresh_token: env("YT_REFRESH_TOKEN"),
        grant_type: "refresh_token",
      }),
      label: "Google token",
    });
    mask(res.access_token);
    cachedToken = res.access_token;
    return cachedToken;
  } catch (err) {
    if (err instanceof HttpError && /invalid_grant/.test(err.body)) {
      throw new Error(
        'YouTube: YT_REFRESH_TOKEN was rejected (invalid_grant). If the OAuth consent screen is still in "Testing", refresh tokens expire after 7 days: publish the app (docs/youtube.md, step 4) and make a new token with scripts/get-youtube-token.ts.',
      );
    }
    if (err instanceof HttpError && /invalid_client/.test(err.body)) {
      throw new Error("YouTube: YT_CLIENT_ID / YT_CLIENT_SECRET are wrong (invalid_client).");
    }
    throw err;
  }
}

export async function preflight(): Promise<string> {
  const token = await accessToken();
  const response = await request("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${token}` },
    label: "YouTube channel",
  });
  if (!response.ok) return "token OK (channel name needs the youtube.readonly scope)";
  const data = (await response.json()) as { items?: { snippet?: { title?: string } }[] };
  const name = data.items?.[0]?.snippet?.title;
  return name ? `channel "${name}"` : "token OK, but this Google account has no YouTube channel";
}

interface UploadedVideo {
  id: string;
  status?: { privacyStatus?: string; uploadStatus?: string };
}

export async function publish(posts: Posts, media: Media, outDir: string): Promise<PlatformResult> {
  if (!media.video) {
    return { platform: "youtube", status: "skipped", detail: "No video for this update.", links: [] };
  }
  const file = path.join(outDir, media.video);
  const size = (await stat(file)).size;
  const token = await accessToken();
  const wanted = privacy();

  const metadata = {
    snippet: {
      title: posts.youtube.title,
      description: posts.youtube.description,
      tags: posts.youtube.tags,
      categoryId: env("YT_CATEGORY_ID", "28"), // Science & Technology
      defaultLanguage: posts.youtube.defaultLanguage,
    },
    status: { privacyStatus: wanted, selfDeclaredMadeForKids: false, embeddable: true },
    ...(Object.keys(posts.youtube.localizations).length ? { localizations: posts.youtube.localizations } : {}),
  };
  const parts = Object.keys(posts.youtube.localizations).length ? "snippet,status,localizations" : "snippet,status";

  const start = await request(
    `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=${parts}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(metadata),
      label: "YouTube upload start",
    },
  );
  const location = start.headers.get("location");
  if (!start.ok || !location) {
    const body = await start.text();
    if (/quotaExceeded/.test(body)) throw new Error("YouTube: the daily API quota is used up; try again tomorrow.");
    if (/uploadLimitExceeded/.test(body)) throw new Error("YouTube: the channel's daily upload limit is reached.");
    throw new Error(`YouTube upload start: HTTP ${start.status} ${truncate(body, 300)}`);
  }

  const video = await uploadChunks(location, file, size, token);
  const actual = video.status?.privacyStatus ?? wanted;
  const audited = env("YT_AUDITED").toLowerCase() === "true";
  let detail = `Uploaded ${(size / 1048576).toFixed(1)} MB as ${actual}.`;
  if (!audited) {
    detail +=
      " Videos from a Google Cloud project that hasn't passed YouTube's API audit stay private (locked) until you make them public in YouTube Studio, or until the audit passes (docs/youtube.md, step 6).";
  }
  return {
    platform: "youtube",
    status: "posted",
    detail,
    links: [{ label: `YouTube (${actual})`, url: `https://youtu.be/${video.id}` }],
  };
}

async function uploadChunks(location: string, file: string, size: number, token: string): Promise<UploadedVideo> {
  const handle = await open(file, "r");
  try {
    let offset = 0;
    let failures = 0;
    for (;;) {
      const length = Math.min(CHUNK, size - offset);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      let response: Response | undefined;
      try {
        response = await fetch(location, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Length": String(length),
            "Content-Range": `bytes ${offset}-${offset + length - 1}/${size}`,
          },
          body: buffer,
        });
      } catch {
        response = undefined;
      }
      if (response && (response.status === 200 || response.status === 201)) {
        return (await response.json()) as UploadedVideo;
      }
      if (response && response.status === 308) {
        offset = nextOffset(response.headers.get("range"));
        failures = 0;
        continue;
      }
      if (response && response.status < 500 && response.status !== 429) {
        throw new Error(`YouTube upload: HTTP ${response.status} ${truncate(await response.text(), 300)}`);
      }
      // Network error, 429 or 5xx: ask how far the upload got, then resume.
      if (++failures > 5) throw new Error("YouTube upload: too many failures; giving up.");
      await new Promise((resolve) => setTimeout(resolve, 2 ** failures * 1000));
      const status = await fetch(location, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Length": "0", "Content-Range": `bytes */${size}` },
      });
      if (status.status === 200 || status.status === 201) return (await status.json()) as UploadedVideo;
      if (status.status === 308) offset = nextOffset(status.headers.get("range"));
    }
  } finally {
    await handle.close();
  }
}

/** "bytes=0-1048575" → 1048576; no Range header → nothing stored yet → 0. */
export function nextOffset(range: string | null): number {
  const match = /bytes=\d+-(\d+)/.exec(range ?? "");
  return match ? Number(match[1]) + 1 : 0;
}
