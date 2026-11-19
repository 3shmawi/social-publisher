import { describe, expect, it } from "vitest";
import {
  type AppInfo,
  buildFacebook,
  buildLinkedIn,
  buildYouTube,
  clampBytes,
  commitType,
  hasSkipMarker,
  isoWeek,
  type LanguagePosts,
  normalizeHashtag,
  onlyInternalChanges,
  toLittleText,
  youtubeSafe,
  youtubeTags,
} from "../scripts/lib/content.ts";
import { nextOffset } from "../scripts/platforms/youtube.ts";

const app: AppInfo = {
  name: "Cafe Menu",
  playStoreUrl: "https://play.google.com/store/apps/details?id=com.example.cafe",
  appStoreUrl: "https://apps.apple.com/app/id123",
  websiteUrl: "",
  about: "",
};

const post = (language: string, extra: Partial<LanguagePosts> = {}): LanguagePosts => ({
  language,
  linkedin: "New: dark mode.",
  hashtags: ["#Flutter", "MobileApps", "#dark mode"],
  facebook: "Dark mode is here 🌙",
  youtubeTitle: "Cafe Menu: dark mode",
  youtubeDescription: "• Dark mode",
  youtubeTags: ["flutter", "Flutter", "dark mode"],
  ...extra,
});

describe("user-facing changes", () => {
  it("reads the Conventional Commit type", () => {
    expect(commitType("feat(menu): search")).toBe("feat");
    expect(commitType("fix!: crash")).toBe("fix");
    expect(commitType("Update README")).toBeUndefined();
  });

  it("treats chore/ci/refactor-only updates as internal", () => {
    expect(onlyInternalChanges(["chore(deps): bump", "ci: cache", "refactor: split"])).toBe(true);
    expect(onlyInternalChanges(["chore: x", "feat: dark mode"])).toBe(false);
    expect(onlyInternalChanges(["perf: faster start"])).toBe(false);
  });

  it("lets the model decide when a subject has no type", () => {
    expect(onlyInternalChanges(["Improve the menu"])).toBe(false);
  });

  it("ignores merge commits and treats nothing as internal", () => {
    expect(onlyInternalChanges(["Merge pull request #3 from x/y", "ci: x"])).toBe(true);
    expect(onlyInternalChanges([])).toBe(true);
  });

  it("finds the skip marker", () => {
    expect(hasSkipMarker("Fixes [skip social]")).toBe(true);
    expect(hasSkipMarker("[No Social]")).toBe(true);
    expect(hasSkipMarker("social")).toBe(false);
  });
});

describe("every two weeks", () => {
  it("computes ISO weeks, including year boundaries", () => {
    expect(isoWeek(new Date("2026-01-01T12:00:00Z"))).toBe(1);
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe(53);
    expect(isoWeek(new Date("2026-11-19T12:00:00Z"))).toBe(47);
  });
});

describe("post texts", () => {
  it("adds hashtags and store links to LinkedIn, per language", () => {
    const text = buildLinkedIn([post("en"), post("ar", { linkedin: "الوضع الليلي" })], app);
    expect(text).toContain("New: dark mode.\n\n#Flutter #MobileApps #darkmode\n\nGoogle Play: https://play.google.com");
    expect(text).toContain("App Store: https://apps.apple.com/app/id123");
    expect(text).toContain("— — —");
    expect(text).toContain("جوجل بلاي: https://play.google.com");
  });

  it("adds links to Facebook", () => {
    expect(buildFacebook([post("en")], app)).toBe(
      `Dark mode is here 🌙\n\nGoogle Play: ${app.playStoreUrl}\nApp Store: ${app.appStoreUrl}`,
    );
  });

  it("normalizes hashtags", () => {
    expect(normalizeHashtag("##Flutter Dev!")).toBe("#FlutterDev");
    expect(normalizeHashtag("تطبيقات")).toBe("#تطبيقات");
    expect(normalizeHashtag("!!")).toBe("");
  });
});

describe("LinkedIn little text", () => {
  it("escapes reserved characters", () => {
    expect(toLittleText("a (b) [c] @d *e* _f_ ~g~ <h> {i} | \\")).toBe(
      "a \\(b\\) \\[c\\] \\@d \\*e\\* \\_f\\_ \\~g\\~ \\<h\\> \\{i\\} \\| \\\\",
    );
  });

  it("keeps hashtags clickable", () => {
    expect(toLittleText("New #Flutter release #تطبيقات")).toBe(
      "New {hashtag|\\#|Flutter} release {hashtag|\\#|تطبيقات}",
    );
  });

  it("doesn't turn a # inside a word into a hashtag", () => {
    expect(toLittleText("C#")).toBe("C\\#");
  });
});

describe("YouTube", () => {
  it("removes angle brackets", () => {
    expect(youtubeSafe("<b>x</b>")).toBe("‹b›x‹/b›");
  });

  it("dedupes tags and keeps them under 500 characters", () => {
    expect(youtubeTags(["flutter", "Flutter", "a,b", "#x"])).toEqual(["flutter", "ab", "x"]);
    const many = Array.from({ length: 100 }, (_, i) => `tag number ${i}`);
    const kept = youtubeTags(many);
    const cost = kept.reduce((sum, t, i) => sum + t.length + 2 + (i ? 1 : 0), 0);
    expect(cost).toBeLessThanOrEqual(500);
  });

  it("builds the main language plus localizations, with links", () => {
    const meta = buildYouTube(
      [post("en"), post("ar", { youtubeTitle: "الوضع الليلي", youtubeDescription: "• وضع ليلي" })],
      app,
      "https://github.com/o/r/releases/tag/v1.2.0",
    );
    expect(meta.defaultLanguage).toBe("en");
    expect(meta.title).toBe("Cafe Menu: dark mode");
    expect(meta.description).toContain("Release notes: https://github.com/o/r/releases/tag/v1.2.0");
    expect(meta.localizations.ar?.description).toContain("ملاحظات الإصدار");
    expect(meta.tags).toEqual(["flutter", "dark mode"]);
  });

  it("caps the title at 100 characters", () => {
    const meta = buildYouTube([post("en", { youtubeTitle: "x".repeat(150) })], app, "");
    expect([...meta.title].length).toBe(100);
  });

  it("caps text by bytes, not characters", () => {
    const text = clampBytes("ع".repeat(4000), 4900);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4900);
  });

  it("resumes uploads from the Range header", () => {
    expect(nextOffset("bytes=0-8388607")).toBe(8388608);
    expect(nextOffset(null)).toBe(0);
  });
});
