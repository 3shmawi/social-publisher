// Tags a new version after each merge to main (.github/workflows/release.yml),
// from the Conventional Commit subjects since the last v* tag — the same rule
// the apps use: feat → minor, fix/perf/refactor/… → patch, `!` or
// BREAKING CHANGE → major; only chore/ci/docs/test/style/build → no release.
// App repos pin this workflow by commit with a `# vX.Y.Z` comment, and their
// Dependabot moves the pin when a new tag appears; flutter-project-kit's
// weekly job does the same for its templates.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { env, notice, run, setOutput, summary } from "./lib/env.ts";
import { putRef, refExists } from "./lib/github.ts";

export type Bump = "major" | "minor" | "patch" | "none";

const NO_RELEASE = new Set(["chore", "ci", "docs", "test", "tests", "style", "build"]);

/** The bump for one commit (subject + body). */
export function bumpFor(subject: string, body = ""): Bump {
  // A merge brings in commits that are counted on their own.
  if (/^Merge (pull request|branch|remote-tracking)/.test(subject)) return "none";
  const m = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject.trim());
  if (/^BREAKING[ -]CHANGE:/m.test(body) || m?.[3]) return "major";
  if (!m) return "patch"; // not conventional: assume it matters
  const type = m[1]!.toLowerCase();
  if (type === "feat") return "minor";
  if (NO_RELEASE.has(type)) return "none";
  return "patch";
}

const ORDER: Bump[] = ["none", "patch", "minor", "major"];

export function biggest(bumps: Bump[]): Bump {
  return bumps.reduce<Bump>((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), "none");
}

/** "v1.6.0" + minor → "v1.7.0"; no previous tag → v1.0.0. */
export function nextVersion(latest: string | undefined, bump: Bump): string | undefined {
  if (bump === "none") return undefined;
  if (!latest) return "v1.0.0";
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(latest);
  if (!m) throw new Error(`Latest tag ${latest} isn't vX.Y.Z`);
  let [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") [major, minor, patch] = [major + 1, 0, 0];
  else if (bump === "minor") [minor, patch] = [minor + 1, 0];
  else patch += 1;
  return `v${major}.${minor}.${patch}`;
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

async function main(): Promise<void> {
  const sha = env("GITHUB_SHA") || git("rev-parse", "HEAD");
  const tags = git("tag", "--list", "v*.*.*", "--sort=-v:refname").split("\n").filter(Boolean);
  const latest = tags[0];
  if (latest && git("rev-list", "-n", "1", latest) === sha) {
    notice(`${latest} already points at this commit.`);
    return;
  }
  // Subject and body of each commit since the last tag, NUL-separated.
  const range = latest ? `${latest}..${sha}` : sha;
  const commits = git("log", "--format=%s%x1f%b%x00", range)
    .split("\0")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [subject = "", body = ""] = c.split("\x1f");
      return { subject, body };
    });
  const bump = biggest(commits.map((c) => bumpFor(c.subject, c.body)));
  const version = nextVersion(latest, bump);
  if (!version) {
    notice(`No release: only chore/ci/docs/test changes since ${latest ?? "the start"}.`);
    return;
  }
  if (env("DRY_RUN") === "true") {
    console.log(`Would tag ${version} (${bump}) at ${sha}:\n${commits.map((c) => `  ${c.subject}`).join("\n")}`);
    return;
  }
  if (await refExists(`tags/${version}`)) throw new Error(`Tag ${version} already exists.`);
  await putRef(`tags/${version}`, sha);
  setOutput("version", version);
  summary(
    [`## 🏷️ ${version} (${bump})`, "", ...commits.map((c) => `- ${c.subject}`), "", `Pin it: \`3shmawi/social-publisher/.github/workflows/publish.yml@${sha} # ${version}\``].join("\n"),
  );
  notice(`Tagged ${version} at ${sha.slice(0, 7)} (${bump}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run(main);
