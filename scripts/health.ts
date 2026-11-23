// Weekly credential check (examples/social-health.yml → .github/workflows/
// health.yml): runs each enabled platform's read-only check, so an expired
// or revoked token shows up days before a release instead of on release
// day. Opens one issue (label social-credentials) while anything fails,
// updates it each week, and closes it once all is well.
// Threads: also refreshes the 60-day token so it never runs out (saved by
// the workflow with SOCIAL_SECRETS_TOKEN, like TikTok's).
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DEFAULT_PLATFORMS, type Platform } from "./lib/content.ts";
import { env, envBool, envList, error, mask, notice, run, summary, warning } from "./lib/env.ts";
import { closeIssue, createIssue, findOpenIssue, updateIssue } from "./lib/github.ts";
import * as bluesky from "./platforms/bluesky.ts";
import * as facebook from "./platforms/facebook.ts";
import * as instagram from "./platforms/instagram.ts";
import * as linkedin from "./platforms/linkedin.ts";
import * as telegram from "./platforms/telegram.ts";
import * as threads from "./platforms/threads.ts";
import * as tiktok from "./platforms/tiktok.ts";
import * as x from "./platforms/x.ts";
import * as youtube from "./platforms/youtube.ts";

export const LABEL = "social-credentials";
const TITLE = "Social posts: credentials need attention";

type Check = { platform: Platform; ok: boolean; detail: string };

const modules: Record<Platform, { configured(): string; preflight(): Promise<string> }> = {
  facebook,
  instagram,
  linkedin,
  youtube,
  // Checking TikTok's token would rotate it: the posting job does that.
  tiktok: { configured: tiktok.configured, preflight: async () => "set; checked when posting (a check would rotate the token)" },
  threads,
  bluesky,
  telegram,
  x,
};

/** Markdown for the issue / summary. */
export function report(checks: Check[], repoName: string): string {
  const rows = checks.map((c) => `| ${c.platform} | ${c.ok ? "✅" : "❌"} ${c.detail.replace(/\|/g, "\\|")} |`);
  const failed = checks.filter((c) => !c.ok);
  return [
    failed.length
      ? `**${failed.length} platform${failed.length > 1 ? "s" : ""} would fail to post** for ${repoName}. Fix ${failed.length > 1 ? "them" : "it"} before the next release — each message says how (docs/troubleshooting.md in social-publisher).`
      : `All credentials work for ${repoName}.`,
    "",
    "| Platform | Check |",
    "|---|---|",
    ...rows,
    "",
    `_Checked ${new Date().toISOString().slice(0, 10)} by the weekly credential check._`,
  ].join("\n");
}

async function main(): Promise<void> {
  const enabled = envList("PLATFORMS", DEFAULT_PLATFORMS) as Platform[];
  const checks: Check[] = [];
  for (const platform of enabled) {
    const mod = modules[platform];
    if (!mod) continue;
    const missing = mod.configured();
    if (missing) {
      checks.push({ platform, ok: false, detail: `not configured: ${missing}` });
      continue;
    }
    try {
      checks.push({ platform, ok: true, detail: await mod.preflight() });
    } catch (err) {
      checks.push({ platform, ok: false, detail: (err as Error).message });
    }
  }

  // Threads: a fresh 60-day token every week, saved by the workflow.
  const threadsCheck = checks.find((c) => c.platform === "threads");
  if (threadsCheck?.ok && env("THREADS_NEW_TOKEN_FILE")) {
    if (!env("SOCIAL_SECRETS_TOKEN")) {
      threadsCheck.detail += "; token not refreshed (no SOCIAL_SECRETS_TOKEN to save it — it lasts 60 days)";
    } else {
      try {
        const fresh = await threads.refreshToken();
        mask(fresh.token);
        writeFileSync(env("THREADS_NEW_TOKEN_FILE"), fresh.token, { mode: 0o600 });
        threadsCheck.detail += `; token refreshed (valid ${fresh.days} days)`;
      } catch (err) {
        threadsCheck.ok = false;
        threadsCheck.detail = `token refresh failed: ${(err as Error).message}`;
      }
    }
  }

  const repoName = env("GITHUB_REPOSITORY", "this repo");
  const body = report(checks, repoName);
  summary(`## 🔑 Weekly credential check\n\n${body}`);
  const failed = checks.filter((c) => !c.ok);
  for (const c of failed) error(`${c.platform}: ${c.detail}`);

  if (!envBool("OPEN_ISSUE", true)) return;
  try {
    const open = await findOpenIssue(LABEL);
    if (failed.length) {
      if (open) {
        await updateIssue(open.number, body);
        notice(`Updated ${open.html_url}`);
      } else {
        const issue = await createIssue(TITLE, body, [LABEL]);
        notice(`Opened ${issue.html_url}`);
      }
    } else if (open) {
      await closeIssue(open.number, `${body}\n\nClosing: everything works again.`);
      notice(`Closed ${open.html_url}`);
    }
  } catch (err) {
    warning(`Couldn't update the credentials issue: ${(err as Error).message}`);
  }
  if (failed.length) process.exitCode = 1;
}

// Run as a script (tests import report() without running it).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(main);
