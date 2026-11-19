// Step 1: work out what to post about and whether to post at all.
// Writes out/context.json and the outputs `skip` and `key`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type Context, hasSkipMarker, isoWeek, onlyInternalChanges } from "./lib/content.ts";
import { channels } from "./lib/channels.ts";
import { env, envBool, envList, notice, outPath, run, setOutput, summary, writeJson } from "./lib/env.ts";
import { getLatestRelease, getRelease, mergedPullRequestsSince, postedRef, type Release, refExists } from "./lib/github.ts";

const APP_DIR = env("APP_DIR", ".");
const LAST_POST_TAG = "social/last-post";

function git(...args: string[]): string {
  return execFileSync("git", ["-C", APP_DIR, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function tryGit(...args: string[]): string {
  try {
    return git(...args);
  } catch {
    return "";
  }
}

function commitSubjects(range: string): string[] {
  const out = tryGit("log", "--no-merges", "--format=%s", range);
  return out ? out.split("\n") : [];
}

/** The newest version tag before `tag`, for "what changed in this release". */
function previousVersionTag(tag: string): string {
  return tryGit("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", `${tag}^`);
}

async function main(): Promise<void> {
  const eventName = env("EVENT_NAME", env("GITHUB_EVENT_NAME", "workflow_dispatch"));
  const requestedTag = env("RELEASE_TAG");
  const force = envBool("FORCE");
  const platforms = envList("PLATFORMS", "facebook,linkedin,youtube");
  const languages = envList("LANGUAGES", "en");

  const ctx: Context = {
    repo: env("GITHUB_REPOSITORY"),
    app: {
      name: env("APP_NAME") || env("GITHUB_REPOSITORY").split("/").pop() || "app",
      playStoreUrl: env("PLAY_STORE_URL"),
      appStoreUrl: env("APP_STORE_URL"),
      websiteUrl: env("WEBSITE_URL"),
      about: env("ABOUT"),
    },
    mode: "release",
    key: "",
    tag: "",
    sha: "",
    title: "",
    notes: "",
    releaseUrl: "",
    commits: [],
    pullRequests: [],
    languages,
    skip: "",
  };

  const finish = async (skip = "") => {
    ctx.skip = skip;
    if (!skip && !force && ctx.key) {
      const all = platforms.flatMap(channels);
      const done = await Promise.all(all.map((c) => refExists(postedRef(ctx.key, c))));
      if (all.length && done.every(Boolean)) {
        ctx.skip = `Already posted "${ctx.key}" to ${platforms.join(", ")} (tags social/posted/${ctx.key}/*). Run with force: true to post again.`;
      }
    }
    writeJson(outPath("context.json"), ctx);
    setOutput("skip", ctx.skip ? "true" : "false");
    setOutput("key", ctx.key);
    setOutput("tag", ctx.tag);
    if (ctx.skip) {
      notice(`Not posting: ${ctx.skip}`);
      summary(`## 📣 Social posts: skipped\n\n${ctx.skip}`);
    } else {
      console.log(`Posting about ${ctx.mode === "release" ? `release ${ctx.tag}` : "recent changes"} (key ${ctx.key}).`);
    }
  };

  // Schedule: GitHub cron has no "every two weeks", so the caller runs weekly
  // and odd ISO weeks are skipped here.
  if (eventName === "schedule" && envBool("BIWEEKLY", true) && isoWeek(new Date()) % 2 === 1) {
    return finish(`Week ${isoWeek(new Date())} is an odd ISO week; the schedule posts every two weeks.`);
  }

  // --- Which release (if any) -------------------------------------------------
  let release: Release | undefined;
  if (eventName === "release") {
    const payload = JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8")) as { release?: Release };
    release = payload.release;
    if (!release) throw new Error("The release event has no release in its payload.");
  } else if (eventName !== "schedule" && requestedTag !== "changes") {
    release = requestedTag ? await getRelease(requestedTag) : await getLatestRelease();
    if (requestedTag && !release) throw new Error(`No GitHub release with the tag "${requestedTag}".`);
    if (!release) notice("This repo has no releases yet; posting about the changes since the last post instead.");
  }

  if (release) {
    if (release.draft) return finish(`Release ${release.tag_name} is a draft.`);
    if (release.prerelease && !envBool("INCLUDE_PRERELEASES")) {
      return finish(`Release ${release.tag_name} is a pre-release (set include_prereleases: true to post those).`);
    }
    ctx.mode = "release";
    ctx.tag = release.tag_name;
    ctx.key = release.tag_name;
    ctx.title = release.name || release.tag_name;
    ctx.notes = (release.body ?? "").trim();
    ctx.releaseUrl = release.html_url;
    ctx.sha = tryGit("rev-list", "-n", "1", release.tag_name) || tryGit("rev-parse", "HEAD");
    const previous = previousVersionTag(release.tag_name);
    ctx.commits = commitSubjects(previous ? `${previous}..${release.tag_name}` : release.tag_name).slice(0, 200);
    if (hasSkipMarker(`${ctx.title}\n${ctx.notes}`)) return finish("The release notes contain [skip social].");
    if (!ctx.notes && ctx.commits.length && onlyInternalChanges(ctx.commits)) {
      return finish("The release has only internal commits (chore, ci, refactor, test, docs, ...).");
    }
    return finish();
  }

  // --- Changes since the last post ----------------------------------------------
  ctx.mode = "changes";
  ctx.sha = git("rev-parse", "HEAD");
  ctx.key = `changes-${ctx.sha.slice(0, 7)}`;
  ctx.title = "Recent improvements";
  const base =
    tryGit("rev-list", "-n", "1", LAST_POST_TAG) ||
    tryGit("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "HEAD");
  const range = base ? `${base}..HEAD` : "--since=14.days";
  ctx.commits = commitSubjects(range).slice(0, 200);
  const sinceIso = base ? tryGit("show", "-s", "--format=%cI", base) : "";
  const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 14 * 86400000);
  ctx.pullRequests = (await mergedPullRequestsSince(since))
    .filter((pr) => !pr.labels.some((l) => /^(skip[- ]social|no[- ]social)$/i.test(l.name)))
    .map((pr) => ({ title: pr.title, body: (pr.body ?? "").slice(0, 1500) }));

  if (base && base === ctx.sha) return finish("Nothing changed since the last post.");
  if (ctx.commits.length === 0 && ctx.pullRequests.length === 0) {
    return finish(`No commits or merged PRs since ${since.toISOString().slice(0, 10)}.`);
  }
  const subjects = [...ctx.commits, ...ctx.pullRequests.map((p) => p.title)];
  if (onlyInternalChanges(subjects)) {
    return finish("Only internal changes since the last post (chore, ci, refactor, test, docs, ...).");
  }
  ctx.notes = ctx.pullRequests.map((p) => `- ${p.title}`).join("\n");
  return finish();
}

run(main);
