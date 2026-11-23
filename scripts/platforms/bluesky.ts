// Bluesky through the AT Protocol, signed in with an app password.
//   image → uploadBlob, then a post with app.bsky.embed.images (alt text)
//   else  → a post with a link card (app.bsky.embed.external)
// Links and hashtags become clickable through facets (byte offsets).
// https://docs.bsky.app/docs/advanced-guides/posts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Context, imageAlt, type Media, type PlatformResult, type Posts, buildShortPosts, primaryLink } from "../lib/content.ts";
import { env, mask } from "../lib/env.ts";
import { HttpError, requestJson } from "../lib/http.ts";

const service = () => env("BLUESKY_SERVICE", "https://bsky.social");

export function configured(): string {
  const missing = ["BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD"].filter((n) => !env(n));
  return missing.length ? `missing secrets ${missing.join(", ")}` : "";
}

function explain(err: unknown): Error {
  if (!(err instanceof HttpError)) return err as Error;
  let code = "";
  let message = err.message;
  try {
    const body = JSON.parse(err.body) as { error?: string; message?: string };
    code = body.error ?? "";
    message = body.message ?? message;
  } catch {
    // keep the HTTP message
  }
  if (code === "AuthenticationRequired" || err.status === 401) {
    return new Error(
      `Bluesky: the handle or app password was refused (${message}). Make a new app password: docs/bluesky.md, step 1.`,
    );
  }
  if (code === "RateLimitExceeded" || err.status === 429) return new Error(`Bluesky: rate limit (${message}). Re-run later.`);
  return new Error(`Bluesky: ${message}`);
}

interface Session {
  accessJwt: string;
  did: string;
  handle: string;
}

async function signIn(): Promise<Session> {
  const password = env("BLUESKY_APP_PASSWORD");
  mask(password);
  const session = await requestJson<Session>(`${service()}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: env("BLUESKY_HANDLE").replace(/^@/, ""), password }),
    label: "Bluesky sign-in",
    retries: 1,
  });
  mask(session.accessJwt);
  return session;
}

export async function preflight(): Promise<string> {
  try {
    return `account @${(await signIn()).handle}`;
  } catch (err) {
    throw explain(err);
  }
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: ({ $type: "app.bsky.richtext.facet#link"; uri: string } | { $type: "app.bsky.richtext.facet#tag"; tag: string })[];
}

/** Clickable links and hashtags: Bluesky marks them by UTF-8 byte ranges. */
export function facets(text: string): Facet[] {
  const out: Facet[] = [];
  const bytes = (s: string) => Buffer.byteLength(s);
  for (const m of text.matchAll(/https?:\/\/[^\s)]+[^\s).,!?]/g)) {
    const start = bytes(text.slice(0, m.index));
    out.push({
      index: { byteStart: start, byteEnd: start + bytes(m[0]) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }],
    });
  }
  for (const m of text.matchAll(/(^|\s)(#[\p{L}\p{N}_]+)/gu)) {
    const start = bytes(text.slice(0, (m.index ?? 0) + m[1]!.length));
    out.push({
      index: { byteStart: start, byteEnd: start + bytes(m[2]!) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2]!.slice(1) }],
    });
  }
  return out;
}

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

export async function publish(ctx: Context, posts: Posts, media: Media, outDir: string): Promise<PlatformResult> {
  const text = posts.bluesky || buildShortPosts(posts.perLanguage, ctx.app).bluesky;
  try {
    const session = await signIn();
    const headers = { Authorization: `Bearer ${session.accessJwt}`, "Content-Type": "application/json" };
    let embed: Record<string, unknown> | undefined;

    const image = media.image ? path.join(outDir, media.image) : "";
    if (image) {
      const data = await readFile(image);
      // Bluesky takes images up to 1 MB; larger ones go as a link card.
      if (data.length <= 1_000_000) {
        const blob = await requestJson<{ blob: unknown }>(`${service()}/xrpc/com.atproto.repo.uploadBlob`, {
          method: "POST",
          headers: { Authorization: headers.Authorization, "Content-Type": IMAGE_TYPES[path.extname(image).toLowerCase()] ?? "image/png" },
          body: data,
          label: "Bluesky image upload",
          retries: 1,
        });
        embed = {
          $type: "app.bsky.embed.images",
          images: [{ image: blob.blob, alt: imageAlt(media, 0, ctx, posts) }],
        };
      }
    }
    const link = primaryLink(ctx.app, "bluesky");
    if (!embed && link) {
      embed = {
        $type: "app.bsky.embed.external",
        external: { uri: link, title: ctx.app.name, description: posts.headline || ctx.title || "" },
      };
    }

    const record = {
      $type: "app.bsky.feed.post",
      text,
      facets: facets(text),
      langs: [posts.perLanguage[0]?.language ?? "en"],
      createdAt: new Date().toISOString(),
      ...(embed ? { embed } : {}),
    };
    const created = await requestJson<{ uri: string; cid: string }>(`${service()}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers,
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
      label: "Bluesky post",
      retries: 0,
    });
    const rkey = created.uri.split("/").pop();
    return {
      platform: "bluesky",
      status: "posted",
      detail: embed?.$type === "app.bsky.embed.images" ? "Posted with the image." : "Posted with a link card.",
      links: [{ label: "Bluesky post", url: `https://bsky.app/profile/${session.handle}/post/${rkey}` }],
      ids: [created.uri],
    };
  } catch (err) {
    throw explain(err);
  }
}
