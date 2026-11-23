// Facebook Page through the Graph API, with a long-lived Page access token.
//   video → POST graph-video.facebook.com/{page}/videos
//   image → POST /{page}/photos
//   else  → POST /{page}/feed (text + link card)
import { openAsBlob } from "node:fs";
import path from "node:path";
import { type Context, type Media, type PlatformResult, type Posts, primaryLink } from "../lib/content.ts";
import { env, mask } from "../lib/env.ts";
import { HttpError, requestJson } from "../lib/http.ts";

const version = () => env("FB_GRAPH_VERSION", "v24.0");

export function configured(): string {
  const missing = ["FB_PAGE_ID", "FB_PAGE_TOKEN"].filter((n) => !env(n));
  return missing.length ? `missing secrets ${missing.join(", ")}` : "";
}

function explain(err: unknown): Error {
  if (!(err instanceof HttpError)) return err as Error;
  let code = 0;
  let message = err.message;
  try {
    const body = JSON.parse(err.body) as { error?: { code?: number; message?: string; error_subcode?: number } };
    code = body.error?.code ?? 0;
    message = body.error?.message ?? message;
  } catch {
    // keep the HTTP message
  }
  if (code === 190) {
    return new Error(
      `Facebook: FB_PAGE_TOKEN is expired or was revoked (${message}). Make a new long-lived Page token: docs/facebook.md, step 4, or run scripts/get-facebook-token.ts.`,
    );
  }
  if (code === 10 || code === 200 || err.status === 403) {
    return new Error(
      `Facebook: the token lacks a permission (${message}). The Page token needs pages_manage_posts, pages_read_engagement and pages_show_list.`,
    );
  }
  return new Error(`Facebook: ${message}`);
}

function auth(): Record<string, string> {
  const token = env("FB_PAGE_TOKEN");
  mask(token);
  return { Authorization: `Bearer ${token}` };
}

export async function preflight(): Promise<string> {
  const page = env("FB_PAGE_ID");
  try {
    const info = await requestJson<{ name?: string }>(
      `https://graph.facebook.com/${version()}/${encodeURIComponent(page)}?fields=name`,
      { headers: auth(), label: "Facebook page" },
    );
    return `page "${info.name ?? page}"`;
  } catch (err) {
    throw explain(err);
  }
}

export async function publish(ctx: Context, posts: Posts, media: Media, outDir: string): Promise<PlatformResult> {
  const page = env("FB_PAGE_ID");
  const graph = `https://graph.facebook.com/${version()}/${encodeURIComponent(page)}`;
  try {
    if (media.video) {
      const form = new FormData();
      form.append("source", await openAsBlob(path.join(outDir, media.video), { type: "video/mp4" }), "video.mp4");
      form.append("description", posts.facebook);
      form.append("title", posts.youtube.title);
      form.append("published", "true");
      const res = await requestJson<{ id: string }>(
        `https://graph-video.facebook.com/${version()}/${encodeURIComponent(page)}/videos`,
        { method: "POST", headers: auth(), body: form, label: "Facebook video upload", retries: 1 },
      );
      return result("video", [{ label: "Facebook video", url: `https://www.facebook.com/${page}/videos/${res.id}` }]);
    }
    if (media.image) {
      const form = new FormData();
      form.append("source", await openAsBlob(path.join(outDir, media.image)), path.basename(media.image));
      form.append("caption", posts.facebook);
      const res = await requestJson<{ id: string; post_id?: string }>(`${graph}/photos`, {
        method: "POST",
        headers: auth(),
        body: form,
        label: "Facebook photo",
        retries: 1,
      });
      return result("photo", [{ label: "Facebook post", url: `https://www.facebook.com/${res.post_id ?? res.id}` }]);
    }
    const body = new URLSearchParams({ message: posts.facebook });
    const link = primaryLink(ctx.app, "facebook");
    if (link) body.set("link", link);
    const res = await requestJson<{ id: string }>(`${graph}/feed`, {
      method: "POST",
      headers: auth(),
      body,
      label: "Facebook post",
      retries: 1,
    });
    return result("text post", [{ label: "Facebook post", url: `https://www.facebook.com/${res.id}` }]);
  } catch (err) {
    throw explain(err);
  }
}

function result(kind: string, links: PlatformResult["links"]): PlatformResult {
  return { platform: "facebook", status: "posted", detail: `Posted a ${kind} to the Page.`, links };
}
