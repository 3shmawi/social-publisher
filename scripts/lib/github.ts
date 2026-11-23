// The few GitHub REST calls the pipeline needs, against the app repo
// (GITHUB_REPOSITORY) with the job's GITHUB_TOKEN.
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { env } from "./env.ts";
import { HttpError, request, requestJson } from "./http.ts";

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  content_type: string;
  url: string;
  /** Public download link (works without a token only in a public repo). */
  browser_download_url?: string;
  /** The asset's label on the release page; used as an image's alt text. */
  label?: string | null;
}

export interface Release {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  target_commitish: string;
  assets: ReleaseAsset[];
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  merged_at: string | null;
  html_url: string;
  labels: { name: string }[];
}

const api = () => env("GITHUB_API_URL", "https://api.github.com");
const repo = () => {
  const value = env("GITHUB_REPOSITORY");
  if (!value) throw new Error("GITHUB_REPOSITORY is not set.");
  return value;
};

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = env("GITHUB_TOKEN");
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "social-publisher",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export async function getRelease(tag: string): Promise<Release | undefined> {
  try {
    return await requestJson<Release>(`${api()}/repos/${repo()}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: headers(),
      label: `GitHub release ${tag}`,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return undefined;
    throw err;
  }
}

export async function getLatestRelease(): Promise<Release | undefined> {
  try {
    return await requestJson<Release>(`${api()}/repos/${repo()}/releases/latest`, {
      headers: headers(),
      label: "GitHub latest release",
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return undefined;
    throw err;
  }
}

/** Pull requests merged after `since` (newest first, up to 100). */
export async function mergedPullRequestsSince(since: Date): Promise<PullRequest[]> {
  const prs = await requestJson<PullRequest[]>(
    `${api()}/repos/${repo()}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
    { headers: headers(), label: "GitHub pull requests" },
  );
  return prs.filter((pr) => pr.merged_at && new Date(pr.merged_at) > since);
}

/** The tag that records "this update was posted to this platform". */
export function postedRef(key: string, platform: string): string {
  return `tags/social/posted/${key}/${platform}`;
}

export const LAST_POST_REF = "tags/social/last-post";

/** True when refs/<ref> exists, e.g. "tags/social/posted/v1.2.0/facebook". */
export async function refExists(ref: string): Promise<boolean> {
  const response = await request(`${api()}/repos/${repo()}/git/ref/${ref}`, {
    headers: headers(),
    label: `GitHub ref ${ref}`,
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`GitHub ref ${ref}: HTTP ${response.status}`);
  return true;
}

/** Create refs/<ref> at sha, or move it there if it exists. */
export async function putRef(ref: string, sha: string): Promise<void> {
  const update = await request(`${api()}/repos/${repo()}/git/refs/${ref}`, {
    method: "PATCH",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ sha, force: true }),
    label: `GitHub update ref ${ref}`,
  });
  if (update.ok) return;
  if (update.status !== 422 && update.status !== 404) {
    throw new Error(
      `GitHub update ref ${ref}: HTTP ${update.status}. The caller workflow needs "permissions: contents: write".`,
    );
  }
  const create = await request(`${api()}/repos/${repo()}/git/refs`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ref: `refs/${ref}`, sha }),
    label: `GitHub create ref ${ref}`,
  });
  if (!create.ok) {
    throw new Error(
      `GitHub create ref ${ref}: HTTP ${create.status}. The caller workflow needs "permissions: contents: write".`,
    );
  }
}

/**
 * Whether a deployment environment makes someone approve each job.
 * undefined = couldn't tell (the token can't read environments).
 */
export async function environmentHasReviewers(name: string): Promise<boolean | undefined> {
  const response = await request(`${api()}/repos/${repo()}/environments/${encodeURIComponent(name)}`, {
    headers: headers(),
    label: `GitHub environment ${name}`,
  });
  if (response.status === 404) return false;
  if (!response.ok) return undefined;
  const data = (await response.json()) as { protection_rules?: { type: string; reviewers?: unknown[] }[] };
  return (data.protection_rules ?? []).some((r) => r.type === "required_reviewers" && (r.reviewers?.length ?? 0) > 0);
}

export async function downloadAsset(asset: ReleaseAsset, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const response = await request(asset.url, {
    headers: headers({ Accept: "application/octet-stream" }),
    label: `release asset ${asset.name}`,
  });
  if (!response.ok || !response.body) {
    throw new Error(`release asset ${asset.name}: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(dest));
}

// --- Issues (weekly credential check) --------------------------------------------

export interface Issue {
  number: number;
  html_url: string;
  title: string;
}

/** The open issue with [label], if any (pull requests excluded). */
export async function findOpenIssue(label: string): Promise<Issue | undefined> {
  const response = await request(
    `${api()}/repos/${repo()}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=10`,
    { headers: headers(), label: "GitHub issues" },
  );
  if (!response.ok) throw new Error(`GitHub issues: HTTP ${response.status}. The caller needs "permissions: issues: write".`);
  const issues = (await response.json()) as (Issue & { pull_request?: unknown })[];
  return issues.find((i) => !i.pull_request);
}

async function issueCall(method: string, urlPath: string, body: unknown, what: string): Promise<Issue> {
  const response = await request(`${api()}/repos/${repo()}${urlPath}`, {
    method,
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    label: what,
  });
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status}. The caller needs "permissions: issues: write".`);
  return (await response.json()) as Issue;
}

export const createIssue = (title: string, body: string, labels: string[]) =>
  issueCall("POST", "/issues", { title, body, labels }, "GitHub create issue");

export const updateIssue = (number: number, body: string) =>
  issueCall("PATCH", `/issues/${number}`, { body }, "GitHub update issue");

export async function closeIssue(number: number, comment: string): Promise<void> {
  await issueCall("POST", `/issues/${number}/comments`, { body: comment }, "GitHub comment");
  await issueCall("PATCH", `/issues/${number}`, { state: "closed", state_reason: "completed" }, "GitHub close issue");
}
