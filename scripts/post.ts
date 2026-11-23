// Step 5 (after approval): publish to one platform.
//   npx tsx scripts/post.ts facebook|instagram|linkedin|youtube|tiktok
// Each place we post to ("channel": facebook, linkedin-person,
// linkedin-organization, youtube) gets the tag social/posted/<key>/<channel>
// once it's done, so a re-run never posts the same update there twice.
import { ALL_PLATFORMS, type Context, type Media, type Platform, type PlatformResult, type Posts } from "./lib/content.ts";
import { env, envBool, error, outPath, readJson, run, summary, warning, writeJson } from "./lib/env.ts";
import { postedRef, putRef, refExists } from "./lib/github.ts";
import * as facebook from "./platforms/facebook.ts";
import * as instagram from "./platforms/instagram.ts";
import * as linkedin from "./platforms/linkedin.ts";
import * as threads from "./platforms/threads.ts";
import * as tiktok from "./platforms/tiktok.ts";
import * as youtube from "./platforms/youtube.ts";

async function alreadyPosted(key: string, channel: string): Promise<boolean> {
  return !envBool("FORCE") && (await refExists(postedRef(key, channel)));
}

async function markPosted(key: string, channel: string, sha: string): Promise<void> {
  try {
    await putRef(postedRef(key, channel), sha);
  } catch (err) {
    warning(`Posted, but couldn't record it (${(err as Error).message}). A re-run would post again.`);
  }
}

async function publish(platform: Platform, ctx: Context, posts: Posts, media: Media): Promise<PlatformResult> {
  const out = outPath();
  if (platform === "linkedin") {
    const links: PlatformResult["links"] = [];
    const failures: string[] = [];
    let skipped = 0;
    for (const target of linkedin.targets()) {
      const channel = `linkedin-${target.kind}`;
      if (await alreadyPosted(ctx.key, channel)) {
        skipped++;
        continue;
      }
      try {
        links.push(await linkedin.publish(posts, target, media, out));
        await markPosted(ctx.key, channel, ctx.sha);
      } catch (err) {
        failures.push((err as Error).message);
      }
    }
    if (failures.length) {
      return { platform, status: "failed", detail: failures.join(" | "), links };
    }
    if (links.length === 0 && skipped) {
      return { platform, status: "already-posted", detail: `Already posted "${ctx.key}".`, links };
    }
    return {
      platform,
      status: "posted",
      detail: `Posted${media.video ? " with the video" : ""} as ${linkedin.targets().map((t) => t.kind).join(" and ")}.`,
      links,
    };
  }

  if (await alreadyPosted(ctx.key, platform)) {
    return { platform, status: "already-posted", detail: `Already posted "${ctx.key}".`, links: [] };
  }
  const publishers: Record<Exclude<Platform, "linkedin">, () => Promise<PlatformResult>> = {
    facebook: () => facebook.publish(ctx, posts, media, out),
    instagram: () => instagram.publish(ctx, posts, media, out),
    youtube: () => youtube.publish(posts, media, out),
    tiktok: () => tiktok.publish(posts, media, out),
    threads: () => threads.publish(ctx, posts, media),
  };
  const result = await publishers[platform]();
  if (result.status === "posted") await markPosted(ctx.key, platform, ctx.sha);
  return result;
}

async function main(): Promise<void> {
  const platform = process.argv[2] as Platform;
  const modules = { facebook, instagram, linkedin, youtube, tiktok, threads };
  if (!(platform in modules)) throw new Error(`Usage: post.ts ${ALL_PLATFORMS.join("|")}`);

  let result: PlatformResult;
  const ctx = readJson<Context>(outPath("context.json"));
  const posts = readJson<Posts>(outPath("posts.json"));
  const media = readJson<Media>(outPath("media.json"));
  const missing = modules[platform].configured();

  if (envBool("DRY_RUN", true)) {
    result = { platform, status: "skipped", detail: "Dry run.", links: [] };
  } else if (!posts.userFacing) {
    result = { platform, status: "skipped", detail: "No user-facing changes.", links: [] };
  } else if (missing) {
    result = { platform, status: "skipped", detail: `Not configured: ${missing}.`, links: [] };
    warning(`${platform}: ${result.detail}`);
  } else {
    try {
      result = await publish(platform, ctx, posts, media);
    } catch (err) {
      result = { platform, status: "failed", detail: (err as Error).message, links: [] };
    }
  }

  writeJson(outPath("results", `${platform}.json`), result);
  const links = result.links.map((l) => `[${l.label}](${l.url})`).join(" · ");
  summary(`### ${platform}: ${result.status}\n\n${result.detail}${links ? `\n\n${links}` : ""}`);
  if (result.status === "failed") {
    error(`${platform}: ${result.detail}`);
    process.exitCode = 1;
  } else {
    console.log(`${platform}: ${result.status}. ${result.detail} ${result.links.map((l) => l.url).join(" ")}`);
  }
  if (env("GITHUB_ACTIONS") !== "true") console.log(JSON.stringify(result, null, 2));
}

run(main);
