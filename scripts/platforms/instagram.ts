// Instagram (professional account linked to the Facebook Page) through the
// Instagram Platform API with Facebook Login, using the same Page token as
// Facebook (it needs instagram_basic and instagram_content_publish too).
// The release video is published as a Reel:
//   1. POST /{ig-user}/media  media_type=REELS and either
//        video_url=<public URL> (public repo: Instagram fetches the release
//        asset itself; works with a Page token), or
//        upload_type=resumable → {id, uri}, then POST {uri}
//        (rupload.facebook.com, Authorization: OAuth <token>, offset, file_size)
//   2. GET  /{container}?fields=status_code  until FINISHED
//   3. POST /{ig-user}/media_publish  creation_id → media id → permalink
// Seen live (2026-11-22): with a Page token the rupload step answered
// HTTP 400 ProcessingFailedError, so video_url is used whenever it can be.
// Images need a public URL (image_url), which a run doesn't have, so an
// update without a video is skipped.
//
// Docs (checked 2026-11-22, latest version v27.0): instagram-platform/
// content-publishing, reference/ig-user/media, reference/ig-container.
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { buildInstagram, type Context, imageAlt, type Media, type PlatformResult, type Posts } from "../lib/content.ts";
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
      `Instagram: the token lacks a permission (${message}). Make a new Page token with instagram_basic and instagram_content_publish added (docs/instagram.md), and set FB_PAGE_TOKEN.`,
    );
  }
  if (code === 100 && /IG|instagram|user/i.test(message)) {
    return new Error(`Instagram: ${message}. Check IG_USER_ID (docs/instagram.md, step 2).`);
  }
  if (code === 9 || code === 4) {
    return new Error(`Instagram: rate limit (${message}). Re-run the job later.`);
  }
  return new Error(`Instagram: ${message}`);
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

/**
 * GitHub's release download link redirects to a short-lived signed URL.
 * Hand Instagram that final URL, fetched right before it downloads.
 */
async function resolveRedirect(url: string | undefined): Promise<string> {
  if (!url) return "";
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) return new URL(location, url).toString();
    return res.ok ? url : "";
  } catch {
    return url;
  }
}

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
  if (!media.video) return publishImages(ctx, posts, media);
  const file = path.join(outDir, media.video);
  const size = (await stat(file)).size;
  if (size > MAX_BYTES) {
    throw new Error(`Instagram: the video is ${Math.round(size / 1048576)} MB; Reels take at most 300 MB.`);
  }
  const caption = posts.instagram || buildInstagram(posts.perLanguage, ctx.app);
  const user = encodeURIComponent(env("IG_USER_ID"));

  try {
    const videoUrl = await resolveRedirect(media.videoUrl);
    let container: { id: string; uri?: string };
    if (videoUrl) {
      // 1a. Instagram downloads the public video itself.
      container = await requestJson<{ id: string }>(`${graph()}/${user}/media`, {
        method: "POST",
        headers: auth(),
        body: new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true" }),
        label: "Instagram container",
        retries: 1,
      });
    } else {
      // 1b. No public URL (private repo): resumable upload of the local file.
      container = await requestJson<{ id: string; uri: string }>(`${graph()}/${user}/media`, {
        method: "POST",
        headers: auth(),
        body: new URLSearchParams({ media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true" }),
        label: "Instagram container",
        retries: 1,
      });
      try {
        await requestJson<{ success?: boolean }>(container.uri ?? "", {
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
      } catch (err) {
        if (err instanceof HttpError && /ProcessingFailed/i.test(err.body)) {
          throw new Error(
            "Instagram refused the direct upload (ProcessingFailedError). It can fetch the video from a public URL instead: attach the .mp4 to the GitHub Release of a public repo.",
          );
        }
        throw err;
      }
    }

    return await finish(user, container.id, "Reel");
  } catch (err) {
    throw explain(err);
  }
}

/** Waits until Instagram has processed [containerId], publishes it, reads its link. */
async function finish(user: string, containerId: string, kind: "Reel" | "image" | "carousel"): Promise<PlatformResult> {
  const deadline = Date.now() + Number(env("IG_STATUS_TIMEOUT_MS", "600000"));
  const interval = Number(env("IG_STATUS_INTERVAL_MS", "20000"));
  let status = { status_code: "IN_PROGRESS", status: "" };
  while (status.status_code === "IN_PROGRESS" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    status = await requestJson(`${graph()}/${containerId}?fields=status_code,status`, {
      headers: auth(),
      label: "Instagram status",
      retries: 2,
    });
  }
  if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
    throw new Error(
      kind === "Reel"
        ? `Instagram couldn't process the video (${status.status_code}: ${status.status || "no reason given"}). Reels need MP4/MOV, H.264 or HEVC, AAC audio, 3 s to 15 min.`
        : `Instagram couldn't process the images (${status.status_code}: ${status.status || "no reason given"}). Use JPEG or PNG, aspect ratio between 4:5 and 1.91:1.`,
    );
  }
  if (status.status_code !== "FINISHED") {
    throw new Error("Instagram: the post was still processing after 10 minutes; re-run the job to try again.");
  }
  const published = await requestJson<{ id: string }>(`${graph()}/${user}/media_publish`, {
    method: "POST",
    headers: auth(),
    body: new URLSearchParams({ creation_id: containerId }),
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
  const label = kind === "Reel" ? "Instagram Reel" : `Instagram ${kind}`;
  const detail = kind === "Reel" ? "Published as a Reel." : kind === "image" ? "Published the image." : "Published a carousel.";
  return { platform: "instagram", status: "posted", detail, links: [{ label, url }], ids: [published.id] };
}

/**
 * No video: the release images, as one image post or a carousel (2–10).
 * Instagram fetches images itself, so they need public URLs (release
 * assets of a public repo); each gets its alt text.
 */
async function publishImages(ctx: Context, posts: Posts, media: Media): Promise<PlatformResult> {
  const urls = (media.imageUrls ?? []).slice(0, 10);
  const usable = urls.map((url, i) => ({ url, alt: imageAlt(media, i, ctx, posts) })).filter((x) => x.url);
  if (usable.length === 0) {
    return {
      platform: "instagram",
      status: "skipped",
      detail: media.image
        ? "No video, and the images have no public URL (Instagram fetches them itself: attach them to the release of a public repo)."
        : "No video or image for this update.",
      links: [],
    };
  }
  const caption = posts.instagram || buildInstagram(posts.perLanguage, ctx.app);
  const user = encodeURIComponent(env("IG_USER_ID"));
  const create = (params: Record<string, string>, label: string) =>
    requestJson<{ id: string }>(`${graph()}/${user}/media`, {
      method: "POST",
      headers: auth(),
      body: new URLSearchParams(params),
      label,
      retries: 1,
    });
  try {
    if (usable.length === 1) {
      const one = usable[0]!;
      const container = await create({ image_url: one.url, caption, alt_text: one.alt }, "Instagram image");
      return await finish(user, container.id, "image");
    }
    const children: string[] = [];
    for (const item of usable) {
      const child = await create({ image_url: item.url, is_carousel_item: "true", alt_text: item.alt }, "Instagram carousel item");
      children.push(child.id);
    }
    const container = await create({ media_type: "CAROUSEL", children: children.join(","), caption }, "Instagram carousel");
    return await finish(user, container.id, "carousel");
  } catch (err) {
    throw explain(err);
  }
}
