// Step 4 (before approval): check each enabled platform's credentials, so an
// expired token shows up on the review page instead of after you approve.
import { DEFAULT_PLATFORMS } from "./lib/content.ts";
import { env, envBool, envList, error, run, summary, warning } from "./lib/env.ts";
import { environmentHasReviewers } from "./lib/github.ts";
import * as bluesky from "./platforms/bluesky.ts";
import * as facebook from "./platforms/facebook.ts";
import * as instagram from "./platforms/instagram.ts";
import * as linkedin from "./platforms/linkedin.ts";
import * as telegram from "./platforms/telegram.ts";
import * as threads from "./platforms/threads.ts";
import * as tiktok from "./platforms/tiktok.ts";
import * as x from "./platforms/x.ts";
import * as youtube from "./platforms/youtube.ts";

async function main(): Promise<void> {
  const enabled = envList("PLATFORMS", DEFAULT_PLATFORMS);
  // TikTok has no preflight: checking its token means refreshing it, and
  // TikTok rotates the refresh token on every refresh. The TikTok job does it.
  const modules = {
    facebook,
    instagram,
    linkedin,
    youtube,
    tiktok: { configured: tiktok.configured, preflight: async () => "set; checked when posting (a check would rotate the token)" },
    threads,
    bluesky,
    telegram,
    x,
  } as const;
  const rows: string[] = ["| Platform | Credentials |", "|---|---|"];

  for (const name of Object.keys(modules) as (keyof typeof modules)[]) {
    if (!enabled.includes(name)) {
      if (!DEFAULT_PLATFORMS.includes(name)) continue; // opt-in, not asked for
      rows.push(`| ${name} | ⏭️ turned off (platforms input) |`);
      continue;
    }
    const mod = modules[name];
    const missing = mod.configured();
    if (missing) {
      rows.push(`| ${name} | ⏭️ not configured: ${missing}, so it will be skipped |`);
      continue;
    }
    try {
      let detail = await mod.preflight();
      if (name === "youtube") detail += `; uploads as **${youtube.privacy()}**`;
      rows.push(`| ${name} | ✅ ${detail} |`);
    } catch (err) {
      const message = (err as Error).message;
      error(message);
      rows.push(`| ${name} | ❌ ${message.replace(/\|/g, "\\|")} |`);
    }
  }

  const notes: string[] = [];
  let approvalError = "";

  // Without required reviewers the "approve" job would run at once and post
  // unreviewed. GitHub creates a missing environment on the fly, with no rules.
  const environment = env("ENVIRONMENT", "social");
  if (!envBool("DRY_RUN", true) && envBool("REQUIRE_APPROVAL", true)) {
    const protectedEnv = await environmentHasReviewers(environment);
    if (protectedEnv === false) {
      approvalError = (
        `The "${environment}" environment has no required reviewers, so posts would go out without your approval. Settings → Environments → ${environment} → Required reviewers → add yourself (docs/app-repo.md, step 3). To post without approval on purpose, set require_approval: false.`
      );
      notes.push(`❌ ${approvalError}`);
    }
    if (protectedEnv === undefined) {
      warning(`Couldn't check that the "${environment}" environment requires a reviewer (the job needs "actions: read").`);
    } else {
      notes.push(`Approval: the \`${environment}\` environment requires a reviewer. ✅`);
    }
  }

  if (enabled.includes("youtube") && env("YT_AUDITED").toLowerCase() !== "true") {
    notes.push(
      "> **YouTube:** until your Google Cloud project passes YouTube's API audit, uploaded videos stay **private**. Make them public in YouTube Studio, or see docs/youtube.md, step 6.",
    );
  }
  summary(["## 🔑 Credentials", "", ...rows, "", ...notes].join("\n"));
  if (approvalError) throw new Error(approvalError);
}

run(main);
