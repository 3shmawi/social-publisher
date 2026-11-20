// Writes the posts without AI, from fixed templates.
//
// The "what's new" items come from, in order:
//   1. the app's store "What's new" text for that language at the release's
//      commit (store/android/<lang>/changelogs/default.txt or
//      store/ios/<locale>/release_notes.txt), unless it's still the template
//      placeholder
//   2. English only: bullet lines of the release notes, else feat/fix/perf
//      commit subjects ("feat(menu): add search" → "Add search")
// A language with no items is left out (we don't translate without AI).
import { execFileSync } from "node:child_process";
import { commitType, type Context, hasSkipMarker, type LanguagePosts } from "./content.ts";

const STORE_FILES: Record<string, string[]> = {
  en: ["store/android/en-US/changelogs/default.txt", "store/ios/en-US/release_notes.txt"],
  ar: ["store/android/ar/changelogs/default.txt", "store/ios/ar-SA/release_notes.txt"],
};

/** The kit's placeholders, and anything still marked TODO. */
const PLACEHOLDER = /TODO|اكتب هنا|Feature one:/i;

const USER_FACING = new Set(["feat", "fix", "perf"]);

function gitShow(appDir: string, ref: string, file: string): string {
  try {
    return execFileSync("git", ["-C", appDir, "show", `${ref}:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/** "• a\n- b\nc" → ["a", "b", "c"] */
export function splitItems(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*([-*•·▪]|\d+[.)])\s*/, "").trim())
    .filter((l) => l && !/^#/.test(l));
}

/** "feat(menu): add search (#12)" → "Add search"; non-user-facing types → "" */
export function cleanSubject(subject: string): string {
  const type = commitType(subject);
  if (type && !USER_FACING.has(type)) return "";
  const text = subject
    .replace(/^\w+(\([^)]*\))?!?:\s*/, "")
    .replace(/\s*\(#\d+\)$/, "")
    .trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "";
}

/** Bullet lines from release notes, without the "---" footer and section headings. */
export function notesItems(notes: string): string[] {
  const body = notes.split(/\n-{3,}\s*\n/)[0] ?? "";
  return body
    .split("\n")
    .filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))
    .map((l) => cleanSubject(splitItems(l)[0] ?? ""))
    .filter(Boolean);
}

export function itemsFor(language: string, ctx: Context, appDir: string): string[] {
  const ref = ctx.sha || "HEAD";
  for (const file of STORE_FILES[language] ?? []) {
    const text = gitShow(appDir, ref, file).trim();
    if (text && !PLACEHOLDER.test(text)) return splitItems(text).slice(0, 8);
  }
  if (language !== "en") return [];
  const fromNotes = notesItems(ctx.notes);
  if (fromNotes.length) return fromNotes.slice(0, 8);
  const fromWork = [...ctx.pullRequests.map((p) => p.title), ...ctx.commits].map(cleanSubject).filter(Boolean);
  return [...new Set(fromWork)].slice(0, 8);
}

const TEXT = {
  en: {
    out: (app: string, v: string) => (v ? `${app} ${v} is out!` : `New in ${app}`),
    whatsNew: "What's new:",
    update: "Update now and let me know what you think.",
    fbHead: (app: string, v: string) => (v ? `🎉 ${app} ${v} is here!` : `🎉 New in ${app}!`),
    fbTail: "Update now 👇",
    ytTitle: (app: string, v: string) => (v ? `${app} ${v}: what's new` : `${app}: what's new`),
    ytIntro: (app: string) => `Here's what's new in ${app}:`,
  },
  ar: {
    out: (app: string, v: string) => (v ? `نزل ${app} ${v}!` : `جديد ${app}`),
    whatsNew: "الجديد:",
    update: "حدّث التطبيق وقولّي رأيك.",
    fbHead: (app: string, v: string) => (v ? `🎉 ${app} ${v} نزل!` : `🎉 جديد ${app}!`),
    fbTail: "حدّث دلوقتي 👇",
    ytTitle: (app: string, v: string) => (v ? `${app} ${v}: الجديد` : `${app}: الجديد`),
    ytIntro: (app: string) => `الجديد في ${app}:`,
  },
};

export function version(ctx: Context): string {
  return /^v?\d+\.\d+/.test(ctx.tag) ? ctx.tag.replace(/^v/, "") : "";
}

export interface TemplateResult {
  userFacing: boolean;
  skipReason: string;
  headline: string;
  posts: LanguagePosts[];
  missing: string[];
}

export function templatePosts(ctx: Context, appDir: string, hashtags: string[]): TemplateResult {
  const v = version(ctx);
  const posts: LanguagePosts[] = [];
  const missing: string[] = [];
  for (const language of ctx.languages) {
    const items = itemsFor(language, ctx, appDir);
    if (items.length === 0) {
      missing.push(language);
      continue;
    }
    const t = TEXT[language as keyof typeof TEXT] ?? TEXT.en;
    const bullets = items.map((i) => `• ${i}`).join("\n");
    const about = ctx.app.about && language === "en" ? `\n\n${ctx.app.about}` : "";
    posts.push({
      language,
      linkedin: `${t.out(ctx.app.name, v)}\n\n${t.whatsNew}\n${bullets}${about}\n\n${t.update}`,
      hashtags,
      facebook: `${t.fbHead(ctx.app.name, v)}\n\n${items.map((i) => `✨ ${i}`).join("\n")}\n\n${t.fbTail}`,
      youtubeTitle: t.ytTitle(ctx.app.name, v),
      youtubeDescription: `${t.ytIntro(ctx.app.name)}\n${bullets}`,
      youtubeTags: [ctx.app.name, ...hashtags.map((h) => h.replace(/^#/, ""))],
    });
  }
  if (hasSkipMarker(ctx.notes)) {
    return { userFacing: false, skipReason: "The release notes contain [skip social].", headline: "", posts: [], missing };
  }
  if (posts.length === 0) {
    return {
      userFacing: false,
      skipReason: "No user-facing items (no store \"What's new\" text, no feat/fix/perf commits or note bullets).",
      headline: "",
      posts: [],
      missing,
    };
  }
  return { userFacing: true, skipReason: "", headline: TEXT.en.out(ctx.app.name, v), posts, missing };
}
