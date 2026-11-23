// Campaign tags on links.
import { describe, expect, it } from "vitest";
import { type AppInfo, buildFacebook, buildShortPosts, type LanguagePosts, storeLinks, tracked, utmCampaign } from "../scripts/lib/content.ts";

const app: AppInfo = {
  name: "Cafe Menu",
  playStoreUrl: "https://play.google.com/store/apps/details?id=com.example.cafe",
  appStoreUrl: "https://apps.apple.com/app/id123456",
  websiteUrl: "https://cafe.example.com/",
  about: "",
  utmCampaign: "v1.2.0",
};
const post: LanguagePosts = {
  language: "en",
  linkedin: "",
  hashtags: [],
  facebook: "Dark mode is here.",
  youtubeTitle: "",
  youtubeDescription: "",
  youtubeTags: [],
};

describe("tracked", () => {
  it("tags website links with utm_*", () => {
    const url = new URL(tracked(app.websiteUrl, "linkedin", app));
    expect(url.searchParams.get("utm_source")).toBe("linkedin");
    expect(url.searchParams.get("utm_medium")).toBe("social");
    expect(url.searchParams.get("utm_campaign")).toBe("v1.2.0");
  });

  it("tags Play Store links through the install referrer", () => {
    const url = new URL(tracked(app.playStoreUrl, "facebook", app));
    expect(url.searchParams.get("id")).toBe("com.example.cafe");
    expect(url.searchParams.get("referrer")).toBe("utm_source=facebook&utm_medium=social&utm_campaign=v1.2.0");
  });

  it("tags App Store links only with a provider token", () => {
    expect(tracked(app.appStoreUrl, "x", app)).toBe(app.appStoreUrl);
    const url = new URL(tracked(app.appStoreUrl, "x", { ...app, appStoreProviderToken: "118000" }));
    expect(url.searchParams.get("pt")).toBe("118000");
    expect(url.searchParams.get("ct")).toBe("x-v1.2.0");
  });

  it("leaves links alone without a campaign, or when already tagged", () => {
    expect(tracked(app.websiteUrl, "x", { ...app, utmCampaign: "" })).toBe(app.websiteUrl);
    const already = "https://cafe.example.com/?utm_source=newsletter";
    expect(tracked(already, "x", app)).toBe(already);
    expect(tracked("not a url", "x", app)).toBe("not a url");
  });
});

describe("posts carry their own platform's tags", () => {
  it("in the Facebook post and the short posts", () => {
    expect(buildFacebook([post], app)).toContain("utm_source=facebook");
    const short = buildShortPosts([post], app);
    expect(short.bluesky).toContain("utm_source=bluesky");
    expect(short.threads).toContain("utm_source=threads");
    expect(short.telegram).toContain("utm_source%3Dtelegram");
  });

  it("store links in every language", () => {
    expect(storeLinks(app, "ar", "youtube").join("\n")).toContain("utm_source%3Dyoutube");
  });
});

describe("utmCampaign", () => {
  it("makes a clean campaign name from the update key", () => {
    expect(utmCampaign("v1.2.0")).toBe("v1.2.0");
    expect(utmCampaign("changes-abc123 / Weekly!")).toBe("changes-abc123-weekly");
  });
});
