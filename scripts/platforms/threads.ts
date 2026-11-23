// Threads (Meta) through the Threads API, with a long-lived Threads user
// access token (60 days; the weekly credential check refreshes it).
//   video with a public URL → container media_type=VIDEO, wait, publish
//   else                    → container media_type=TEXT, publish
// https://developers.facebook.com/docs/threads/posts
import { type Context, type Media, type PlatformResult, type Posts, buildShortPosts } from "../lib/content.ts";
import { env, mask } from "../lib/env.ts";
import { HttpError, requestJson } from "../lib/http.ts";

const base = () => `${env("THREADS_API_BASE", "https://graph.threads.net")}/v1.0`;

export function configured(): string {
  const missing = ["THREADS_USER_ID", "THREADS_TOKEN"].filter((n) => !env(n));
  return missing.length ? `missing secrets ${missing.join(", ")}` : "";
}

function token(): string {
  const t = env("THREADS_TOKEN");
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
    return new Error(
      `Threads: THREADS_TOKEN is expired or was revoked (${message}). Run scripts/get-threads-token.ts again (docs/threads.md).`,
    );
  }
  if (code === 10 || code === 200 || err.status === 403) {
    return new Error(`Threads: the token lacks a permission (${message}). It needs threads_basic and threads_content_publish.`);
  }
  return new Error(`Threads: ${message}`);
}

export function text(ctx: Context, posts: Posts): string {
  return posts.threads || buildShortPosts(posts.perLanguage, ctx.app).threads;
}

export async function preflight(): Promise<string> {
  try {
    const me = await requestJson<{ username?: string }>(`${base()}/me?fields=username`, {
      headers: { Authorization: `Bearer ${token()}` },
      label: "Threads account",
    });
    return `account @${me.username ?? env("THREADS_USER_ID")}`;
  } catch (err) {
    throw explain(err);
  }
}

/**
 * A new 60-day token for a still-valid one (Threads: th_refresh_token).
 * Used by the weekly credential check so the token never runs out.
 */
export async function refreshToken(): Promise<{ token: string; days: number }> {
  try {
    // Meta documents this call with the token in the query; the token is
    // masked in logs and fetch never prints URLs.
    const url = new URL(`${base().replace(/\/v1\.0$/, "")}/refresh_access_token`);
    url.search = new URLSearchParams({ grant_type: "th_refresh_token", access_token: token() }).toString();
    const res = await requestJson<{ access_token: string; expires_in: number }>(url.toString(), {
      label: "Threads token refresh",
    });
    mask(res.access_token);
    return { token: res.access_token, days: Math.round(res.expires_in / 86400) };
  } catch (err) {
    throw explain(err);
  }
}

export async function publish(ctx: Context, posts: Posts, media: Media): Promise<PlatformResult> {
  const user = encodeURIComponent(env("THREADS_USER_ID"));
  const headers = { Authorization: `Bearer ${token()}` };
  const params = new URLSearchParams({ text: text(ctx, posts) });
  const withVideo = Boolean(media.videoUrl);
  if (withVideo) {
    params.set("media_type", "VIDEO");
    params.set("video_url", media.videoUrl!);
  } else {
    params.set("media_type", "TEXT");
  }
  try {
    const container = await requestJson<{ id: string }>(`${base()}/${user}/threads`, {
      method: "POST",
      headers,
      body: params,
      label: "Threads container",
      retries: 1,
    });

    // Video containers process first; text ones are ready at once.
    if (withVideo) {
      const deadline = Date.now() + Number(env("THREADS_STATUS_TIMEOUT_MS", "600000"));
      const interval = Number(env("THREADS_STATUS_INTERVAL_MS", "15000"));
      for (;;) {
        const status = await requestJson<{ status?: string; error_message?: string }>(
          `${base()}/${container.id}?fields=status,error_message`,
          { headers, label: "Threads status", retries: 2 },
        );
        if (status.status === "FINISHED") break;
        if (status.status === "ERROR" || status.status === "EXPIRED") {
          throw new Error(`Threads couldn't process the video: ${status.error_message ?? status.status}`);
        }
        if (Date.now() > deadline) throw new Error("Threads: the video was still processing after 10 minutes.");
        await new Promise((r) => setTimeout(r, interval));
      }
    }

    const published = await requestJson<{ id: string }>(`${base()}/${user}/threads_publish`, {
      method: "POST",
      headers,
      body: new URLSearchParams({ creation_id: container.id }),
      label: "Threads publish",
      retries: 0,
    });
    let url = "";
    try {
      const info = await requestJson<{ permalink?: string }>(`${base()}/${published.id}?fields=permalink`, {
        headers,
        label: "Threads permalink",
      });
      url = info.permalink ?? "";
    } catch {
      // the post is up; only the link is missing
    }
    return {
      platform: "threads",
      status: "posted",
      detail: withVideo ? "Posted with the video." : "Posted (text).",
      links: url ? [{ label: "Threads post", url }] : [],
      ids: [published.id],
    };
  } catch (err) {
    throw explain(err);
  }
}
