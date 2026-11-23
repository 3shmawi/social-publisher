// X (Twitter) through the X API v2, signed with OAuth 1.0a (user context):
// a text post in the main language, fitted to 280 (X counts every link as
// 23). X bills every API call (pay-per-use) and a post with a link costs
// much more than one without, so `x_links: false` leaves the link out.
// No media: each upload is billed like an extra post. docs/x.md.
import { createHmac, randomBytes } from "node:crypto";
import { type Context, type PlatformResult, type Posts, buildShortPosts } from "../lib/content.ts";
import { env, envBool, mask } from "../lib/env.ts";
import { HttpError, requestJson } from "../lib/http.ts";

const base = () => env("X_API_BASE", "https://api.x.com");
const SECRETS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"] as const;

export function configured(): string {
  const missing = SECRETS.filter((n) => !env(n));
  return missing.length ? `missing secrets ${missing.join(", ")}` : "";
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
export function percent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The OAuth 1.0a Authorization header (HMAC-SHA1). JSON bodies are not
 * signed; query parameters are. [nonce]/[timestamp] are fixed in tests.
 */
export function oauthHeader(
  method: string,
  url: string,
  creds: { key: string; secret: string; token: string; tokenSecret: string },
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString(),
): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.key,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.token,
    oauth_version: "1.0",
  };
  const params = [...u.searchParams.entries(), ...Object.entries(oauth)]
    .map(([k, v]) => [percent(k), percent(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const baseString = [method.toUpperCase(), percent(`${u.origin}${u.pathname}`), percent(params)].join("&");
  const signature = createHmac("sha1", `${percent(creds.secret)}&${percent(creds.tokenSecret)}`)
    .update(baseString)
    .digest("base64");
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature })
    .map(([k, v]) => `${percent(k)}="${percent(v)}"`)
    .join(", ")}`;
}

function creds() {
  for (const name of SECRETS) mask(env(name));
  return {
    key: env("X_API_KEY"),
    secret: env("X_API_SECRET"),
    token: env("X_ACCESS_TOKEN"),
    tokenSecret: env("X_ACCESS_SECRET"),
  };
}

function explain(err: unknown): Error {
  if (!(err instanceof HttpError)) return err as Error;
  let message = err.message;
  try {
    const body = JSON.parse(err.body) as { title?: string; detail?: string; errors?: { message?: string }[] };
    message = body.detail ?? body.errors?.[0]?.message ?? body.title ?? message;
  } catch {
    // keep the HTTP message
  }
  if (err.status === 401) {
    return new Error(`X: the keys were refused (${message}). Regenerate the access token and secret (docs/x.md, step 3).`);
  }
  if (err.status === 402 || /credits|payment|usage cap/i.test(message)) {
    return new Error(`X: no API credit left (${message}). Add credit in the X Developer Console (docs/x.md).`);
  }
  if (err.status === 403) {
    return new Error(
      `X: not allowed (${message}). The app needs "Read and write" permission, and the access token must be made after setting it.`,
    );
  }
  if (err.status === 429) return new Error(`X: rate limit (${message}). Re-run later.`);
  return new Error(`X: ${message}`);
}

export async function preflight(): Promise<string> {
  const url = `${base()}/2/users/me`;
  try {
    const me = await requestJson<{ data?: { username?: string } }>(url, {
      headers: { Authorization: oauthHeader("GET", url, creds()) },
      label: "X account",
    });
    return `account @${me.data?.username ?? "?"}`;
  } catch (err) {
    throw explain(err);
  }
}

export async function publish(ctx: Context, posts: Posts): Promise<PlatformResult> {
  const text = posts.x || buildShortPosts(posts.perLanguage, ctx.app, { xLinks: envBool("X_LINKS", true) }).x;
  const url = `${base()}/2/tweets`;
  try {
    const created = await requestJson<{ data: { id: string } }>(url, {
      method: "POST",
      headers: { Authorization: oauthHeader("POST", url, creds()), "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      label: "X post",
      // Never retry a create: a retried post could go out twice (and costs twice).
      retries: 0,
    });
    return {
      platform: "x",
      status: "posted",
      detail: "Posted (text).",
      links: [{ label: "X post", url: `https://x.com/i/web/status/${created.data.id}` }],
      ids: [created.data.id],
    };
  } catch (err) {
    throw explain(err);
  }
}
