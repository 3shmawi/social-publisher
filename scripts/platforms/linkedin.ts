// LinkedIn through the Posts API (POST /rest/posts, versioned by the
// LinkedIn-Version header). Posts as you (urn:li:person, w_member_social),
// as a company page (urn:li:organization, w_organization_social), or both.
//
// Access tokens last ~60 days. With LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET
// the preflight checks the expiry date; with LINKEDIN_REFRESH_TOKEN as well
// (Community Management API apps get one, valid ~1 year) a fresh access token
// is made on every run, so LINKEDIN_TOKEN never needs refreshing by hand.
//
// Video (Videos API, docs checked 2026-11-22, LinkedIn-Version up to
// 202611): POST /rest/videos?action=initializeUpload (owner = the post's
// author) → PUT each 4 MB part to its pre-signed uploadUrl, keep the ETags →
// POST ?action=finalizeUpload → GET /rest/videos/{urn} until AVAILABLE →
// the post gets content.media { title, id }. Up to 500 MB, 3 s to 30 min, MP4.
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { type Media, type PlatformResult, type Posts, toLittleText } from "../lib/content.ts";
import { env, mask, warning } from "../lib/env.ts";
import { HttpError, request, requestJson, truncate } from "../lib/http.ts";

const REFRESH_HELP =
  'Make a new token: docs/linkedin.md, step 5 (or run scripts/get-linkedin-token.ts), then update the LINKEDIN_TOKEN secret.';

export type Target = { kind: "person" | "organization"; urn: string; scope: string };

/**
 * Where to post. "both" posts wherever a URN is set, so an app without a
 * company page (no LINKEDIN_ORG_URN) still posts as you.
 */
export function targets(): Target[] {
  const as = env("LINKEDIN_AS", "person").toLowerCase();
  const person: Target = { kind: "person", urn: env("LINKEDIN_AUTHOR_URN"), scope: "w_member_social" };
  const org: Target = { kind: "organization", urn: env("LINKEDIN_ORG_URN"), scope: "w_organization_social" };
  if (as === "person") return [person];
  if (as === "organization") return [org];
  if (as === "both") {
    const set = [person, org].filter((t) => t.urn);
    return set.length ? set : [person, org];
  }
  return [];
}

export function configured(): string {
  const list = targets();
  if (list.length === 0) return "linkedin_as must be person, organization or both";
  const missing: string[] = [];
  if (!env("LINKEDIN_TOKEN") && !env("LINKEDIN_REFRESH_TOKEN")) missing.push("LINKEDIN_TOKEN");
  for (const t of list) {
    if (!t.urn) missing.push(t.kind === "person" ? "LINKEDIN_AUTHOR_URN" : "LINKEDIN_ORG_URN");
  }
  return missing.length ? `missing secrets ${missing.join(", ")}` : "";
}

let cachedToken = "";

async function accessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const id = env("LINKEDIN_CLIENT_ID");
  const secret = env("LINKEDIN_CLIENT_SECRET");
  const refresh = env("LINKEDIN_REFRESH_TOKEN");
  if (id && secret && refresh) {
    try {
      const res = await requestJson<{ access_token: string }>("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: id, client_secret: secret }),
        label: "LinkedIn token refresh",
      });
      mask(res.access_token);
      cachedToken = res.access_token;
      return cachedToken;
    } catch (err) {
      const detail = err instanceof HttpError ? truncate(err.body, 200) : (err as Error).message;
      if (!env("LINKEDIN_TOKEN")) {
        throw new Error(`LinkedIn: LINKEDIN_REFRESH_TOKEN was rejected (${detail}); it lasts ~1 year. ${REFRESH_HELP}`);
      }
      warning(`LinkedIn: LINKEDIN_REFRESH_TOKEN was rejected (${detail}); using LINKEDIN_TOKEN instead.`);
    }
  }
  cachedToken = env("LINKEDIN_TOKEN");
  mask(cachedToken);
  return cachedToken;
}

export async function preflight(): Promise<string> {
  const token = await accessToken();
  const id = env("LINKEDIN_CLIENT_ID");
  const secret = env("LINKEDIN_CLIENT_SECRET");
  const who = targets()
    .map((t) => t.urn)
    .join(" + ");
  for (const t of targets()) {
    const pattern = t.kind === "person" ? /^urn:li:person:[\w-]+$/ : /^urn:li:organization:\d+$/;
    if (!pattern.test(t.urn)) {
      throw new Error(
        `LinkedIn: ${t.kind === "person" ? "LINKEDIN_AUTHOR_URN" : "LINKEDIN_ORG_URN"} should look like ${t.kind === "person" ? "urn:li:person:AbC123" : "urn:li:organization:12345678"}.`,
      );
    }
  }
  if (!id || !secret) {
    return `${who}; token expiry not checked (add LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET to check it)`;
  }
  const info = await requestJson<{ active: boolean; expires_at?: number; scope?: string }>(
    "https://www.linkedin.com/oauth/v2/introspectToken",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, token }),
      label: "LinkedIn token check",
    },
  );
  if (!info.active) throw new Error(`LinkedIn: the access token has expired or was revoked. ${REFRESH_HELP}`);
  const scopes = (info.scope ?? "").split(/[ ,]+/);
  const missing = targets()
    .map((t) => t.scope)
    .filter((s) => info.scope && !scopes.includes(s));
  if (missing.length) {
    throw new Error(`LinkedIn: the token lacks the scope ${missing.join(", ")}. ${REFRESH_HELP}`);
  }
  if (info.expires_at) {
    const days = Math.floor((info.expires_at * 1000 - Date.now()) / 86400000);
    if (days < 0) throw new Error(`LinkedIn: the access token expired ${-days} days ago. ${REFRESH_HELP}`);
    if (days < 10 && !env("LINKEDIN_REFRESH_TOKEN")) {
      warning(`LinkedIn: the access token expires in ${days} days. ${REFRESH_HELP}`);
    }
    return `${who}; token valid for ${days} more days`;
  }
  return who;
}

const api = () => env("LINKEDIN_API_BASE", "https://api.linkedin.com");
const MAX_VIDEO = 500 * 1024 * 1024;

function restHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "LinkedIn-Version": env("LINKEDIN_VERSION", "202609"),
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

interface UploadInit {
  value: {
    video: string;
    uploadToken?: string;
    uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[];
  };
}

/** Upload the video for one author; returns its urn:li:video once LinkedIn can serve it. */
export async function uploadVideo(file: string, owner: string, token: string): Promise<string> {
  const size = (await stat(file)).size;
  const init = await requestJson<UploadInit>(`${api()}/rest/videos?action=initializeUpload`, {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify({
      initializeUploadRequest: { owner, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false },
    }),
    label: "LinkedIn video upload start",
    retries: 1,
  });

  const etags: string[] = [];
  const handle = await open(file, "r");
  try {
    for (const part of init.value.uploadInstructions) {
      const length = part.lastByte - part.firstByte + 1;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, part.firstByte);
      // Pre-signed URL: no Authorization header.
      const res = await request(part.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: buffer,
        label: "LinkedIn video part",
        retries: 3,
      });
      if (!res.ok) throw new Error(`LinkedIn video part: HTTP ${res.status} ${truncate(await res.text(), 200)}`);
      const etag = res.headers.get("etag");
      if (!etag) throw new Error("LinkedIn video part: no ETag in the response.");
      etags.push(etag);
    }
  } finally {
    await handle.close();
  }

  await request(`${api()}/rest/videos?action=finalizeUpload`, {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify({
      finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken ?? "", uploadedPartIds: etags },
    }),
    label: "LinkedIn video upload finish",
    retries: 1,
  }).then(async (res) => {
    if (!res.ok) throw new Error(`LinkedIn video upload finish: HTTP ${res.status} ${truncate(await res.text(), 200)}`);
  });

  const deadline = Date.now() + Number(env("LINKEDIN_VIDEO_TIMEOUT_MS", "900000"));
  const interval = Number(env("LINKEDIN_VIDEO_INTERVAL_MS", "10000"));
  for (;;) {
    const info = await requestJson<{ status?: string; processingFailureReason?: string }>(
      `${api()}/rest/videos/${encodeURIComponent(init.value.video)}`,
      { headers: restHeaders(token), label: "LinkedIn video status", retries: 2 },
    );
    if (info.status === "AVAILABLE") return init.value.video;
    if (info.status === "PROCESSING_FAILED") {
      throw new Error(`LinkedIn couldn't process the video (${info.processingFailureReason ?? "no reason given"}). It takes MP4, 3 s to 30 min.`);
    }
    if (Date.now() > deadline) throw new Error("LinkedIn: the video was still processing after 15 minutes; re-run the job.");
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Post to one author. post.ts calls this per target, so a re-run only retries the failed one. */
export async function publish(
  posts: Posts,
  target: Target,
  media?: Media,
  outDir = "",
): Promise<PlatformResult["links"][number]> {
  const token = await accessToken();
  const version = env("LINKEDIN_VERSION", "202609");
  let content: { media: { title: string; id: string } } | undefined;
  if (media?.video) {
    const file = path.join(outDir, media.video);
    if ((await stat(file)).size > MAX_VIDEO) {
      warning("LinkedIn: the video is over 500 MB; posting the text only.");
    } else {
      const id = await uploadVideo(file, target.urn, token);
      content = { media: { title: posts.youtube?.title || "Video", id } };
    }
  }
  const response = await request(`${api()}/rest/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": version,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: target.urn,
      commentary: toLittleText(posts.linkedin),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(content ? { content } : {}),
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
    label: `LinkedIn post as ${target.kind}`,
    retries: 1,
  });
  const body = await response.text();
  if (response.status === 201) {
    const urn = response.headers.get("x-restli-id") ?? "";
    return {
      label: `LinkedIn (${target.kind})`,
      url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : "https://www.linkedin.com/",
    };
  }
  let reason = `HTTP ${response.status} ${truncate(body, 300)}`;
  if (response.status === 401) reason = `the access token has expired or was revoked (tokens last ~60 days). ${REFRESH_HELP}`;
  if (response.status === 403) {
    reason = `not allowed (${truncate(body, 200)}). The token needs ${target.scope}${target.kind === "organization" ? ", and you must be an admin of the page" : ""}.`;
  }
  if (response.status === 426 || /version/i.test(body)) {
    reason += ` If LinkedIn-Version ${version} is no longer supported, set the input linkedin_version to a recent month (YYYYMM).`;
  }
  throw new Error(`LinkedIn as ${target.kind}: ${reason}`);
}
