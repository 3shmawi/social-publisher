// Shared types and the pure text rules (tested in test/content.test.ts).

export interface AppInfo {
  name: string;
  playStoreUrl: string;
  appStoreUrl: string;
  websiteUrl: string;
  /** Free text about the app and its audience, from the `about` input. */
  about: string;
}

export interface Context {
  repo: string;
  app: AppInfo;
  /** release: a GitHub Release. changes: commits and PRs since the last post. */
  mode: "release" | "changes";
  /** Identifies this update for "don't post twice": the tag, or changes-<sha>. */
  key: string;
  tag: string;
  sha: string;
  title: string;
  notes: string;
  releaseUrl: string;
  commits: string[];
  pullRequests: { title: string; body: string }[];
  languages: string[];
  /** Set when there is nothing to post; the reason is logged and shown. */
  skip: string;
}

export interface LanguagePosts {
  language: string;
  linkedin: string;
  hashtags: string[];
  facebook: string;
  youtubeTitle: string;
  youtubeDescription: string;
  youtubeTags: string[];
}

export interface YouTubeMeta {
  title: string;
  description: string;
  tags: string[];
  defaultLanguage: string;
  localizations: Record<string, { title: string; description: string }>;
}

export interface Posts {
  key: string;
  userFacing: boolean;
  skipReason: string;
  headline: string;
  model: string;
  perLanguage: LanguagePosts[];
  /** Final texts, links included, ready to publish. */
  linkedin: string;
  facebook: string;
  /** Reel caption (optional in posts.json written before Instagram existed). */
  instagram?: string;
  youtube: YouTubeMeta;
  /** Short posts (optional in posts.json written before these platforms). */
  threads?: string;
  bluesky?: string;
  telegram?: string;
  x?: string;
}

/** Media for this update; paths are relative to the out/ folder. */
export interface Media {
  video: string;
  videoSource: string;
  /** A public URL of the same video, when there is one (Instagram fetches it). */
  videoUrl?: string;
  image: string;
  imageSource: string;
  /** Describes the image for screen readers (Bluesky, LinkedIn, X, Instagram). */
  imageAlt?: string;
  /** Every image, in order (2–10 make a carousel); [image] is the first. */
  images?: string[];
  /** Public URLs of [images] ("" where there is none). */
  imageUrls?: string[];
  /** Alt text of each image ("" → a default from the app and headline). */
  imageAlts?: string[];
}

/**
 * Alt text for image [index]: the release asset's label (or a sidecar
 * .txt in marketing/images/), else "<app>: <headline>".
 */
export function imageAlt(media: Media, index: number, ctx: Pick<Context, "app" | "title">, posts: Pick<Posts, "headline">): string {
  const given = media.imageAlts?.[index] || (index === 0 ? media.imageAlt : "");
  const fallback = `${ctx.app.name}: ${posts.headline || ctx.title || "screenshot"}`;
  return clampChars(given || fallback, 1000);
}

/** Every platform, in the order jobs and the summary list them. */
export const ALL_PLATFORMS = [
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "tiktok",
  "threads",
  "bluesky",
  "telegram",
  "x",
] as const;

/** On unless the `platforms` input says otherwise (the newer ones are opt-in). */
export const DEFAULT_PLATFORMS = "facebook,instagram,linkedin,youtube,tiktok";

export type Platform = (typeof ALL_PLATFORMS)[number];

export interface PlatformResult {
  platform: Platform;
  status: "posted" | "skipped" | "failed" | "already-posted";
  detail: string;
  links: { label: string; url: string }[];
  /** The platform's id for the post(s), for the insights report. */
  ids?: string[];
}

// --- What counts as a user-facing change -------------------------------------

/** Conventional Commit types that never change what users see. */
const INTERNAL_TYPES = new Set(["chore", "ci", "build", "refactor", "test", "tests", "style", "docs", "revert"]);

const SKIP_MARKERS = /\[(skip social|no social|social skip)\]/i;

export function commitType(subject: string): string | undefined {
  const match = /^(\w+)(\([^)]*\))?!?:/.exec(subject.trim());
  return match?.[1]?.toLowerCase();
}

/**
 * True when every subject is an internal Conventional Commit (chore, ci,
 * refactor, ...). Subjects without a type count as user-facing: we can't
 * tell, so the model decides.
 */
export function onlyInternalChanges(subjects: string[]): boolean {
  const relevant = subjects.filter((s) => s.trim() && !/^Merge (pull request|branch)/.test(s));
  if (relevant.length === 0) return true;
  return relevant.every((s) => {
    const type = commitType(s);
    return type !== undefined && INTERNAL_TYPES.has(type);
  });
}

export function hasSkipMarker(text: string): boolean {
  return SKIP_MARKERS.test(text);
}

// --- Schedule: every two weeks -----------------------------------------------

export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// --- Store links ---------------------------------------------------------------

const LINK_LABELS: Record<string, { play: string; ios: string; web: string }> = {
  en: { play: "Google Play", ios: "App Store", web: "Website" },
  ar: { play: "جوجل بلاي", ios: "آب ستور", web: "الموقع" },
};

export function storeLinks(app: AppInfo, language: string): string[] {
  const labels = LINK_LABELS[language] ?? LINK_LABELS.en!;
  const lines: string[] = [];
  if (app.playStoreUrl) lines.push(`${labels.play}: ${app.playStoreUrl}`);
  if (app.appStoreUrl) lines.push(`${labels.ios}: ${app.appStoreUrl}`);
  if (app.websiteUrl) lines.push(`${labels.web}: ${app.websiteUrl}`);
  return lines;
}

/** The link to use where a platform takes one link (Facebook's link card). */
export function primaryLink(app: AppInfo): string {
  return app.websiteUrl || app.playStoreUrl || app.appStoreUrl;
}

const SEPARATOR = "\n\n— — —\n\n";

function withLinks(body: string, app: AppInfo, language: string): string {
  const links = storeLinks(app, language);
  return links.length ? `${body.trim()}\n\n${links.join("\n")}` : body.trim();
}

export function normalizeHashtag(tag: string): string {
  const word = tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return word ? `#${word}` : "";
}

export function buildLinkedIn(posts: LanguagePosts[], app: AppInfo): string {
  return posts
    .map((p) => {
      const tags = p.hashtags.map(normalizeHashtag).filter(Boolean).join(" ");
      return withLinks(tags ? `${p.linkedin.trim()}\n\n${tags}` : p.linkedin, app, p.language);
    })
    .join(SEPARATOR);
}

export function buildFacebook(posts: LanguagePosts[], app: AppInfo): string {
  return posts.map((p) => withLinks(p.facebook, app, p.language)).join(SEPARATOR);
}

/**
 * Instagram caption: the Facebook text and hashtags per language. Links
 * aren't clickable in captions but can still be copied, so they stay.
 * Instagram allows 2,200 characters and 30 hashtags.
 */
export function buildInstagram(posts: LanguagePosts[], app: AppInfo): string {
  const seen = new Set<string>();
  const tags = posts
    .flatMap((p) => p.hashtags.map(normalizeHashtag))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 30);
  const body = posts.map((p) => withLinks(p.facebook, app, p.language)).join(SEPARATOR);
  const tagLine = tags.join(" ");
  const room = 2200 - (tagLine ? [...tagLine].length + 2 : 0);
  return tagLine ? `${clampChars(body, room)}\n\n${tagLine}` : clampChars(body, 2200);
}

// --- YouTube limits ------------------------------------------------------------

/** YouTube rejects < and > in titles and descriptions. */
export function youtubeSafe(text: string): string {
  return text.replace(/</g, "‹").replace(/>/g, "›");
}

export function clampChars(text: string, max: number): string {
  const chars = [...text.trim()];
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** Tags: no duplicates, no commas or angle brackets, ≤ 500 characters in all. */
export function youtubeTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const raw of tags) {
    const tag = raw.replace(/[<>,"#]/g, "").trim().slice(0, 100);
    const lower = tag.toLowerCase();
    if (!tag || seen.has(lower)) continue;
    // YouTube counts a tag with spaces as if it were quoted (+2).
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (total + cost > 500) break;
    seen.add(lower);
    out.push(tag);
    total += cost;
  }
  return out;
}

export function buildYouTube(posts: LanguagePosts[], app: AppInfo, releaseUrl: string): YouTubeMeta {
  const meta = (p: LanguagePosts) => {
    const links = storeLinks(app, p.language);
    if (releaseUrl) links.push(`${p.language === "ar" ? "ملاحظات الإصدار" : "Release notes"}: ${releaseUrl}`);
    const description = [p.youtubeDescription.trim(), links.join("\n")].filter(Boolean).join("\n\n");
    return {
      title: clampChars(youtubeSafe(p.youtubeTitle), 100),
      // 5000 bytes is the limit; Arabic letters take 2 bytes, so count bytes.
      description: clampBytes(youtubeSafe(description), 4900),
    };
  };
  const [first, ...rest] = posts;
  if (!first) throw new Error("No posts to build YouTube metadata from.");
  const main = meta(first);
  return {
    ...main,
    tags: youtubeTags(posts.flatMap((p) => p.youtubeTags)),
    defaultLanguage: first.language,
    localizations: Object.fromEntries(rest.map((p) => [p.language, meta(p)])),
  };
}

export function clampBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let out = "";
  for (const ch of text) {
    if (Buffer.byteLength(out + ch) > maxBytes - 3) break;
    out += ch;
  }
  return `${out}…`;
}

// --- LinkedIn "little text" ------------------------------------------------------

/**
 * LinkedIn's Posts API reads `commentary` as "little text": these characters
 * must be escaped or the post is cut off or rejected. Hashtags become the
 * hashtag template so they stay clickable.
 * https://learn.microsoft.com/linkedin/marketing/community-management/shares/little-text-format
 */
export function toLittleText(text: string): string {
  const escaped = text.replace(/[\\|{}@[\]()<>#*_~]/g, (ch) => `\\${ch}`);
  return escaped.replace(/(^|[\s(])\\#([\p{L}\p{N}_]+)/gu, (_m, pre: string, tag: string) => `${pre}{hashtag|\\#|${tag}}`);
}

// --- Review page -------------------------------------------------------------------

export function postsMarkdown(ctx: Context, posts: Posts, dryRun: boolean): string {
  const fence = (text: string) => `\`\`\`text\n${text.replace(/```/g, "ˋˋˋ")}\n\`\`\``;
  const lines = [
    `## 📣 ${ctx.app.name}: ${posts.headline || ctx.title}`,
    "",
    `Source: **${ctx.mode === "release" ? `release ${ctx.tag}` : "changes since the last post"}** · key \`${ctx.key}\` · model \`${posts.model}\`${dryRun ? " · **dry run, nothing is published**" : ""}`,
    "",
    `### LinkedIn (${[...posts.linkedin].length} characters)`,
    fence(posts.linkedin),
    "",
    `### Facebook (${[...posts.facebook].length} characters)`,
    fence(posts.facebook),
    "",
    ...(posts.instagram ? [`### Instagram Reel caption (${[...posts.instagram].length} characters)`, fence(posts.instagram), ""] : []),
    ...(posts.threads ? [`### Threads (${threadsLength(posts.threads)}/${SHORT_LIMITS.threads})`, fence(posts.threads), ""] : []),
    ...(posts.bluesky ? [`### Bluesky (${graphemeCount(posts.bluesky)}/${SHORT_LIMITS.bluesky})`, fence(posts.bluesky), ""] : []),
    ...(posts.telegram ? [`### Telegram (${[...posts.telegram].length}/${SHORT_LIMITS.telegram})`, fence(posts.telegram), ""] : []),
    ...(posts.x ? [`### X (${xLength(posts.x)}/${SHORT_LIMITS.x})`, fence(posts.x), ""] : []),
    "### YouTube",
    `**Title:** ${posts.youtube.title}`,
    "",
    fence(posts.youtube.description),
    "",
    `**Tags:** ${posts.youtube.tags.join(", ") || "none"}`,
  ];
  for (const [lang, loc] of Object.entries(posts.youtube.localizations)) {
    lines.push("", `**${lang} title:** ${loc.title}`, "", fence(loc.description));
  }
  return lines.join("\n");
}

// --- Short posts (Threads, Bluesky, Telegram, X) -----------------------------------

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** User-perceived characters (an emoji with modifiers counts once). */
export function graphemeCount(text: string): number {
  return [...graphemes.segment(text)].length;
}

/**
 * X counts every URL as 23 characters, and CJK / emoji as 2; Latin and
 * Arabic letters count 1. Close enough to X's own counter for our texts.
 */
export function xLength(text: string): number {
  let length = 0;
  for (const part of text.split(/(https?:\/\/\S+)/)) {
    if (/^https?:\/\//.test(part)) {
      length += 23;
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      const code = segment.codePointAt(0) ?? 0;
      length += code > 0x2fff && !(code >= 0x0600 && code <= 0x06ff) ? 2 : 1;
    }
  }
  return length;
}

/**
 * [text] cut to fit [max] by [measure]: whole sentences first, then whole
 * words, then an ellipsis — never in the middle of a word.
 */
export function fitText(text: string, max: number, measure: (t: string) => number = graphemeCount): string {
  const clean = text.trim();
  if (measure(clean) <= max) return clean;
  const sentences = clean.match(/[^.!?؟\n]+[.!?؟]*\s*/g) ?? [clean];
  let out = "";
  for (const sentence of sentences) {
    if (measure(out + sentence) > max) break;
    out += sentence;
  }
  if (out.trim()) return out.trim();
  const words = clean.split(/\s+/);
  out = "";
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (measure(`${next}…`) > max) break;
    out = next;
  }
  return `${out}…`;
}

export interface ShortPostOptions {
  /** Longest post the platform takes, in its own unit ([measure]). */
  max: number;
  measure?: (text: string) => number;
  /** Add the main link (website, else a store) after the text. */
  link?: boolean;
  /** Hashtags to add when they fit. */
  hashtags?: number;
}

/**
 * A short post in the main language: the Facebook text, fitted with room
 * for one link and a few hashtags. Short platforms get one language —
 * two would leave no room for either.
 */
export function buildShortPost(posts: LanguagePosts[], app: AppInfo, options: ShortPostOptions): string {
  const main = posts[0];
  if (!main) throw new Error("No posts to build a short post from.");
  const measure = options.measure ?? graphemeCount;
  const link = options.link === false ? "" : primaryLink(app);
  const tags = main.hashtags
    .map(normalizeHashtag)
    .filter(Boolean)
    .slice(0, options.hashtags ?? 2)
    .join(" ");
  const tail = [link, tags].filter(Boolean).join("\n");
  const room = options.max - (tail ? measure(`\n\n${tail}`) : 0);
  if (room < 40) {
    // A very long link: drop the hashtags, keep the link.
    const body = fitText(main.facebook, options.max - (link ? measure(`\n\n${link}`) : 0), measure);
    return link ? `${body}\n\n${link}` : body;
  }
  const body = fitText(main.facebook, room, measure);
  return tail ? `${body}\n\n${tail}` : body;
}

/** Threads' 500-character limit; emoji counted by their UTF-8 size to be safe. */
export function threadsLength(text: string): number {
  let n = 0;
  for (const ch of text) n += (ch.codePointAt(0) ?? 0) > 0xffff ? Buffer.byteLength(ch) : 1;
  return n;
}

export const SHORT_LIMITS = {
  threads: 500,
  /** Bluesky: 300 graphemes. */
  bluesky: 300,
  /** Telegram: a media caption takes 1,024 characters. */
  telegram: 1024,
  x: 280,
} as const;

export interface ShortPosts {
  threads: string;
  bluesky: string;
  telegram: string;
  x: string;
}

/**
 * The short posts, written once in generate.ts so the review page shows
 * exactly what each platform will post. [xLinks]: X charges far more for
 * a post with a link, so it can be left out.
 */
export function buildShortPosts(posts: LanguagePosts[], app: AppInfo, options: { xLinks?: boolean } = {}): ShortPosts {
  return {
    threads: buildShortPost(posts, app, { max: SHORT_LIMITS.threads, measure: threadsLength, hashtags: 1 }),
    bluesky: buildShortPost(posts, app, { max: SHORT_LIMITS.bluesky, hashtags: 2 }),
    // Telegram channels read well in every language: the Facebook text.
    telegram: clampChars(buildFacebook(posts, app), SHORT_LIMITS.telegram),
    x: buildShortPost(posts, app, { max: SHORT_LIMITS.x, measure: xLength, hashtags: 2, link: options.xLinks !== false }),
  };
}
