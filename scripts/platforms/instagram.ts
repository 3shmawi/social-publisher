// Instagram (professional account linked to the Facebook Page) through the
// Instagram Platform API with Facebook Login, using the same Page token as
// Facebook (it needs instagram_basic and instagram_content_publish too).
// The release video is published as a Reel, from the local file:
//   1. POST /{ig-user}/media  media_type=REELS, upload_type=resumable → {id, uri}
//   2. POST {uri} (rupload.facebook.com)  Authorization: OAuth <token>, offset, file_size
//   3. GET  /{container}?fields=status_code  until FINISHED
//   4. POST /{ig-user}/media_publish  creation_id → media id → permalink
// Images need a public URL (image_url), which a run doesn't have, so an
// update without a video is skipped.
//
// Docs (checked 2026-11-22, latest version v27.0): instagram-platform/
// content-publishing, reference/ig-user/media, reference/ig-container.
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { buildInstagram, type Context, type Media, type PlatformResult, type Posts } from "../lib/content.ts";
import { env, mask } from "../lib/env.ts";
import { HttpError, requestJson } from "../lib/http.ts";

const version = () => env("FB_GRAPH_VERSION", "v24.0");
const graph = () => `${env("IG_GRAPH_BASE", "https://graph.facebook.com")}/${version()}`;

/** Reels: 3 s to 15 min, at most 300 MB. */
const MAX_BYTES = 300 * 1024 * 1024;

export function configured(): string {
  const missing = ["IG_USER_ID", "FB_PAGE_TOKEN"].filter((n) => !env(n));
  return missing.length ? `missing secrets ${missing.join(", ")}` : "";
}

function token(): string {
  const t = env("FB_PAGE_TOKEN");
  mask(t);
  return t;
}

function explain(err: unknown): Error {
  if (!(err instanceof HttpError)) return err as Error;
  let code = 0;
  let message = err.message;
  try {
    const body = JSON.parse(err.body) as { error?: { code?: number; message?: string; error_user_msg?: string } };
    code = body.error?.code ?? 0;
    message = body.error?.error_user_msg ?? body.error?.message ?? message;
  } catch {
    // keep the HTTP message
  }
  if (code === 190) {
    return new Error(`Instagram: FB_PAGE_TOKEN is expired or was revoked (${message}). Run scripts/get-facebook-token.ts again.`);
  }
  if (code === 10 || code === 200 || err.status === 403) {
    return new Error(
      `Instagram: the token lacks a permission (${message}). Make a new Page token with instagram_basic and instagram_content_publish added (README → "Instagram"), and set FB_PAGE_TOKEN.`,
    );
  }
  if (code === 100 && /IG|instagram|user/i.test(message)) {
    return new Error(`Instagram: ${message}. Check IG_USER_ID (README → "Instagram", step 2).`);
  }
  if (code === 9 || code === 4) {
    return new Error(`Instagram: rate limit (${message}). Re-run the job later.`);
  }
  return new Error(`Instagram: ${message}`);
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

export async function preflight(): Promise<string> {
  try {
    const info = await requestJson<{ username?: string }>(
      `${graph()}/${encodeURIComponent(env("IG_USER_ID"))}?fields=username`,
      { headers: auth(), label: "Instagram account" },
    );
    return `account @${info.username ?? env("IG_USER_ID")}`;
  } catch (err) {
    throw explain(err);
  }
}

export async function publish(ctx: Context, posts: Posts, media: Media, outDir: string): Promise<PlatformResult> {
  if (!media.video) {
    return {
      platform: "instagram",
      status: "skipped",
      detail: "No video for this update (Instagram gets the release video as a Reel).",
      links: [],
    };
  }
  const file = path.join(outDir, media.video);
  const size = (await stat(file)).size;
  if (size > MAX_BYTES) {
    throw new Error(`Instagram: the video is ${Math.round(size / 1048576)} MB; Reels take at most 300 MB.`);
  }
  const caption = posts.instagram || buildInstagram(posts.perLanguage, ctx.app);
  const user = encodeURIComponent(env("IG_USER_ID"));

  try {
    // 1. Container for a resumable upload.
    const container = await requestJson<{ id: string; uri: string }>(`${graph()}/${user}/media`, {
      method: "POST",
      headers: auth(),
      body: new URLSearchParams({
        media_type: "REELS",
        upload_type: "resumable",
        caption,
        share_to_feed: "true",
      }),
      label: "Instagram container",
      retries: 1,
    });

    // 2. The video bytes.
    await requestJson<{ success?: boolean }>(container.uri, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token()}`,
        offset: "0",
        file_size: String(size),
        "Content-Type": "application/octet-stream",
      },
      body: await openAsBlob(file),
      label: "Instagram upload",
      retries: 1,
    });

    // 3. Instagram processes the video; it can be published once FINISHED.
    const deadline = Date.now() + Number(env("IG_STATUS_TIMEOUT_MS", "600000"));
    const interval = Number(env("IG_STATUS_INTERVAL_MS", "20000"));
    let status = { status_code: "IN_PROGRESS", status: "" };
    while (status.status_code === "IN_PROGRESS" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      status = await requestJson(`${graph()}/${container.id}?fields=status_code,status`, {
        headers: auth(),
        label: "Instagram status",
        retries: 2,
      });
    }
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Instagram couldn't process the video (${status.status_code}: ${status.status || "no reason given"}). Reels need MP4/MOV, H.264 or HEVC, AAC audio, 3 s to 15 min.`);
    }
    if (status.status_code !== "FINISHED") {
      throw new Error("Instagram: the video was still processing after 10 minutes; re-run the job to try again.");
    }

    // 4. Publish, then read the public link.
    const published = await requestJson<{ id: string }>(`${graph()}/${user}/media_publish`, {
      method: "POST",
      headers: auth(),
      body: new URLSearchParams({ creation_id: container.id }),
      label: "Instagram publish",
      retries: 0, // a retry after a lost response could post twice
    });
    let url = "https://www.instagram.com/";
    try {
      const info = await requestJson<{ permalink?: string }>(`${graph()}/${published.id}?fields=permalink`, {
        headers: auth(),
        label: "Instagram permalink",
      });
      if (info.permalink) url = info.permalink;
    } catch {
      // posted; the link is a nice-to-have
    }
    return { platform: "instagram", status: "posted", detail: "Published as a Reel.", links: [{ label: "Instagram Reel", url }] };
  } catch (err) {
    throw explain(err);
  }
}
