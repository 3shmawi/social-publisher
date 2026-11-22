// TikTok through the Content Posting API, "upload" flow: the release video
// goes to the creator's TikTok inbox as a draft (scope video.upload). The
// owner opens TikTok, adds a sound and the caption, and publishes. There is
// no caption field in this flow, so the result shows the suggested one.
//
// Tokens: TikTok refresh tokens ROTATE. Every refresh returns a new one
// (valid ~180 days) and the old one stops working at once. After a
// refresh this module writes the new token to $TIKTOK_NEW_TOKEN_FILE
// (outside out/, never uploaded); the workflow then saves it back to the
// TIKTOK_REFRESH_TOKEN secret with SOCIAL_SECRETS_TOKEN.
//
// Docs (checked 2026-11-22): oauth-user-access-token-management,
// content-posting-api-reference-upload-video,
// content-posting-api-media-transfer-guide,
// content-posting-api-reference-get-video-status.
import { writeFileSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { Media, PlatformResult, Posts } from "../lib/content.ts";
import { env, mask } from "../lib/env.ts";
import { HttpError, request, requestJson, truncate } from "../lib/http.ts";

const api = () => env("TIKTOK_API_BASE", "https://open.tiktokapis.com");

const MB = 1024 * 1024;
/** TikTok: chunks of 5–64 MB, the last up to 128 MB; under 5 MB, one chunk. */
const CHUNK = 10 * MB;

export function configured(): string {
  const missing = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"].filter((n) => !env(n));
  // In Actions the rotated refresh token must be saved back, or the next run
  // fails: without SOCIAL_SECRETS_TOKEN, don't refresh at all.
  if (env("GITHUB_ACTIONS") === "true" && !env("SOCIAL_SECRETS_TOKEN")) missing.push("SOCIAL_SECRETS_TOKEN");
  return missing.length ? `missing secrets ${missing.join(", ")}` : "";
}

export interface ChunkPlan {
  chunkSize: number;
  count: number;
  /** [start, endInclusive] byte ranges, in order. */
  ranges: [number, number][];
}

/**
 * TikTok's rule: total_chunk_count = floor(size / chunk_size), and the last
 * chunk takes the remainder (so it can be up to 2× chunk_size). A file
 * under 5 MB is one chunk of its own size.
 */
export function chunkPlan(size: number, chunk = CHUNK): ChunkPlan {
  if (size <= 0) throw new Error("Empty video.");
  if (size < 5 * MB || size <= chunk) return { chunkSize: size, count: 1, ranges: [[0, size - 1]] };
  const count = Math.floor(size / chunk);
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunk;
    const end = i === count - 1 ? size - 1 : start + chunk - 1;
    ranges.push([start, end]);
  }
  return { chunkSize: chunk, count, ranges };
}

let cachedToken = "";

/** Refresh → access token (2 h). Saves the rotated refresh token for the workflow. */
async function accessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  let res: { access_token?: string; refresh_token?: string; refresh_expires_in?: number; error?: string; error_description?: string };
  try {
    res = await requestJson(`${api()}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env("TIKTOK_CLIENT_KEY"),
        client_secret: env("TIKTOK_CLIENT_SECRET"),
        grant_type: "refresh_token",
        refresh_token: env("TIKTOK_REFRESH_TOKEN"),
      }),
      label: "TikTok token refresh",
      retries: 1,
    });
  } catch (err) {
    const body = err instanceof HttpError ? err.body : (err as Error).message;
    throw new Error(
      `TikTok: TIKTOK_REFRESH_TOKEN was rejected (${truncate(body, 200)}). It rotates on every refresh and lasts ~180 days; if a run couldn't save the new one, sign in again: npx tsx scripts/get-tiktok-token.ts.`,
    );
  }
  if (!res.access_token || !res.refresh_token) {
    throw new Error(`TikTok: token refresh failed (${res.error ?? "no token"}: ${res.error_description ?? ""}).`);
  }
  mask(res.access_token);
  mask(res.refresh_token);
  cachedToken = res.access_token;
  const file = env("TIKTOK_NEW_TOKEN_FILE");
  if (file) writeFileSync(file, res.refresh_token, { mode: 0o600 });
  return cachedToken;
}

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

async function tiktokJson<T>(url: string, token: string, body: unknown, label: string): Promise<T> {
  const response = await request(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
    label,
    retries: 1,
  });
  const text = await response.text();
  let parsed: TikTokEnvelope<T> = {};
  try {
    parsed = JSON.parse(text) as TikTokEnvelope<T>;
  } catch {
    // keep the raw text in the error below
  }
  const code = parsed.error?.code;
  if (!response.ok || (code && code !== "ok")) {
    throw new Error(`${label}: ${code ?? `HTTP ${response.status}`} ${parsed.error?.message ?? truncate(text, 200)}`);
  }
  return parsed.data as T;
}

export interface InboxStatus {
  status: string;
  fail_reason?: string;
}

export async function publish(posts: Posts, media: Media, outDir: string): Promise<PlatformResult> {
  if (!media.video) {
    return { platform: "tiktok", status: "skipped", detail: "No video for this update (TikTok posts are videos).", links: [] };
  }
  const file = path.join(outDir, media.video);
  const size = (await stat(file)).size;
  const plan = chunkPlan(size);
  const token = await accessToken();

  const init = await tiktokJson<{ publish_id: string; upload_url: string }>(
    `${api()}/v2/post/publish/inbox/video/init/`,
    token,
    {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.count,
      },
    },
    "TikTok upload start",
  );

  const handle = await open(file, "r");
  try {
    for (const [start, end] of plan.ranges) {
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      let attempt = 0;
      for (;;) {
        attempt++;
        const res = await fetch(init.upload_url, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(length),
            "Content-Range": `bytes ${start}-${end}/${size}`,
          },
          body: buffer,
        }).catch(() => undefined);
        if (res && (res.status === 201 || res.status === 206 || res.ok)) break;
        if (res && res.status < 500) {
          throw new Error(`TikTok upload: HTTP ${res.status} ${truncate(await res.text(), 200)}`);
        }
        if (attempt >= 3) throw new Error("TikTok upload: a chunk kept failing; giving up.");
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }
    }
  } finally {
    await handle.close();
  }

  // TikTok processes the upload, then sends it to the inbox.
  let status: InboxStatus = { status: "PROCESSING_UPLOAD" };
  const deadline = Date.now() + Number(env("TIKTOK_STATUS_TIMEOUT_MS", "180000"));
  while (status.status === "PROCESSING_UPLOAD" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Number(env("TIKTOK_STATUS_INTERVAL_MS", "5000"))));
    status = await tiktokJson<InboxStatus>(
      `${api()}/v2/post/publish/status/fetch/`,
      token,
      { publish_id: init.publish_id },
      "TikTok status",
    );
  }
  if (status.status === "FAILED") {
    throw new Error(`TikTok: the upload failed (${status.fail_reason ?? "no reason given"}).`);
  }
  const caption = posts.facebook.split("\n\n— — —\n\n")[0] ?? posts.facebook;
  const where =
    status.status === "PROCESSING_UPLOAD"
      ? "Uploaded; TikTok is still processing it and will send it to your inbox."
      : "In your TikTok inbox as a draft.";
  return {
    platform: "tiktok",
    status: "posted",
    detail: `${where} Open TikTok → Inbox → the upload notification, add a sound and this caption, then post: ${caption.replace(/\n+/g, " ")}`,
    links: [{ label: "TikTok inbox (open the app)", url: "https://www.tiktok.com/messages" }],
  };
}
