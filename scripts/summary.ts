// Last step: one table with every platform's result and links. When anything
// was posted, moves the tag social/last-post to this update's commit, so the
// next scheduled run only looks at newer changes.
import { existsSync, readdirSync } from "node:fs";
import { ALL_PLATFORMS, type Context, DEFAULT_PLATFORMS, type PlatformResult } from "./lib/content.ts";
import { envBool, envList, outPath, readJson, readJsonIfExists, run, summary, warning } from "./lib/env.ts";
import { LAST_POST_REF, putRef } from "./lib/github.ts";

const ICON: Record<PlatformResult["status"], string> = {
  posted: "✅",
  "already-posted": "☑️",
  skipped: "⏭️",
  failed: "❌",
};

async function main(): Promise<void> {
  const ctx = readJsonIfExists<Context>(outPath("context.json"));
  const dryRun = envBool("DRY_RUN", true);
  const enabled = envList("PLATFORMS", DEFAULT_PLATFORMS);
  const dir = outPath("results");
  const results = new Map<string, PlatformResult>();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const r = readJson<PlatformResult>(`${dir}/${file}`);
      results.set(r.platform, r);
    }
  }

  const rows = ["| Platform | Result | Links |", "|---|---|---|"];
  for (const platform of ALL_PLATFORMS) {
    const r = results.get(platform);
    // Opt-in platforms (Threads, Bluesky, …) only show once they're on.
    if (!enabled.includes(platform) && !DEFAULT_PLATFORMS.includes(platform)) continue;
    if (!enabled.includes(platform)) {
      rows.push(`| ${platform} | ⏭️ turned off | |`);
    } else if (!r) {
      const why = dryRun ? "dry run: not published" : ctx?.skip ? "nothing to post" : "did not run (not approved, or skipped)";
      rows.push(`| ${platform} | ⏭️ ${why} | |`);
    } else {
      const links = r.links.map((l) => `[${l.label}](${l.url})`).join("<br>");
      rows.push(`| ${platform} | ${ICON[r.status]} ${r.status}: ${r.detail.replace(/\|/g, "\\|")} | ${links} |`);
    }
  }

  const title = ctx ? `## 📊 ${ctx.app.name}: ${ctx.mode === "release" ? ctx.tag : "recent changes"}` : "## 📊 Social posts";
  summary([title, "", dryRun ? "**Dry run**: posts were generated (see the Generate job), nothing was published.\n" : "", ...rows].join("\n"));

  const posted = [...results.values()].some((r) => r.status === "posted");
  if (posted && ctx?.sha && !dryRun) {
    try {
      await putRef(LAST_POST_REF, ctx.sha);
    } catch (err) {
      warning(`Couldn't move social/last-post: ${(err as Error).message}`);
    }
  }
  if ([...results.values()].some((r) => r.status === "failed")) {
    warning("At least one platform failed; the others were not affected. Fix it, then re-run the failed job.");
    // Turn the run red so GitHub notifies you; the other platforms already ran.
    process.exitCode = 1;
  }
}

run(main);
