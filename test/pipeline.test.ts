// End to end against local fakes of the GitHub and Anthropic APIs: a release
// goes through collect → generate → media → post (dry run) → summary.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
let server: Server;
let base = "";
const anthropicRequests: Record<string, unknown>[] = [];
const createdRefs: string[] = [];
let modelAnswer: Record<string, unknown>;

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let s = "";
    req.on("data", (d) => (s += d)).on("end", () => resolve(s));
  });

const goodAnswer = {
  user_facing: true,
  skip_reason: "",
  headline: "Dark mode arrives",
  posts: [
    {
      language: "en",
      linkedin: "Cafe Menu now has dark mode. ".repeat(25).trim(),
      hashtags: ["Flutter", "#DarkMode", "MobileApps"],
      facebook: "Dark mode is here 🌙 Easier on your eyes at night.",
      youtube_title: "Cafe Menu 1.2: dark mode",
      youtube_description: "Dark mode is here.\n• Dark mode\n• Faster menu search",
      youtube_tags: ["cafe menu", "dark mode"],
    },
    {
      language: "ar",
      linkedin: "تطبيق قائمة المقهى يدعم الآن الوضع الليلي. ".repeat(20).trim(),
      hashtags: ["فلاتر"],
      facebook: "الوضع الليلي وصل 🌙",
      youtube_title: "الوضع الليلي في قائمة المقهى",
      youtube_description: "• الوضع الليلي",
      youtube_tags: ["الوضع الليلي"],
    },
  ],
};

// Async on purpose: a sync spawn would block the fake servers in this process.
function run(
  script: string,
  env: Record<string, string>,
  args: string[] = [],
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", `scripts/${script}.ts`, ...args], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GITHUB_API_URL: base,
        GITHUB_REPOSITORY: "me/cafe",
        GITHUB_TOKEN: "test-token",
        ANTHROPIC_BASE_URL: `${base}/anthropic`,
        ANTHROPIC_API_KEY: "test-key",
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

let appDir = "";
let out = "";

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = req.url ?? "";
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    };
    if (url.startsWith("/anthropic/v1/messages")) {
      anthropicRequests.push(JSON.parse(await body(req)));
      return json(200, {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: JSON.stringify(modelAnswer) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    }
    if (url === "/repos/me/cafe/releases/tags/v1.2.0" || url === "/repos/me/cafe/releases/latest") {
      return json(200, {
        tag_name: "v1.2.0",
        name: "v1.2.0 (12)",
        body: "## Features\n- Dark mode\n- Faster menu search",
        html_url: "https://github.com/me/cafe/releases/tag/v1.2.0",
        draft: false,
        prerelease: false,
        published_at: "2026-11-01T00:00:00Z",
        target_commitish: "main",
        assets: [],
      });
    }
    if (url.startsWith("/repos/me/cafe/git/ref/")) {
      const ref = decodeURIComponent(url.slice("/repos/me/cafe/git/ref/".length));
      return createdRefs.includes(ref) ? json(200, { ref }) : json(404, { message: "Not Found" });
    }
    if (url === "/repos/me/cafe/git/refs" && req.method === "POST") {
      const { ref } = JSON.parse(await body(req)) as { ref: string };
      createdRefs.push(ref.replace(/^refs\//, ""));
      return json(201, {});
    }
    if (url.startsWith("/repos/me/cafe/git/refs/") && req.method === "PATCH") return json(422, {});
    if (url.startsWith("/repos/me/cafe/pulls")) return json(200, []);
    return json(404, { message: `no fake for ${url}` });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  appDir = mkdtempSync(path.join(tmpdir(), "app-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", appDir, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "feat: dark mode");
  git("tag", "v1.2.0");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "feat: table booking");
  git("tag", "v1.3.0"); // a tag without a GitHub Release (Codemagic only pushes tags)
  out = mkdtempSync(path.join(tmpdir(), "out-"));
}, 30000);

afterAll(() => server?.close());

describe("pipeline", () => {
  const env = () => ({
    SOCIAL_OUT: out,
    APP_DIR: appDir,
    EVENT_NAME: "workflow_dispatch",
    APP_NAME: "Cafe Menu",
    PLAY_STORE_URL: "https://play.google.com/store/apps/details?id=com.me.cafe",
    LANGUAGES: "en,ar",
    PLATFORMS: "facebook,linkedin,youtube",
    LINKEDIN_AS: "both",
    DRY_RUN: "true",
  });

  it("collects the latest release", async () => {
    const r = await run("collect", env());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const ctx = JSON.parse(readFileSync(path.join(out, "context.json"), "utf8"));
    expect(ctx).toMatchObject({ mode: "release", key: "v1.2.0", tag: "v1.2.0", skip: "" });
    expect(ctx.sha).toMatch(/^[0-9a-f]{40}$/);
  }, 60000);

  it("writes the posts with Claude, structured, with fallbacks", async () => {
    modelAnswer = goodAnswer;
    const summaryFile = path.join(out, "summary.md");
    writeFileSync(summaryFile, "");
    const r = await run("generate", { ...env(), GITHUB_STEP_SUMMARY: summaryFile });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const request = anthropicRequests.at(-1)!;
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.fallbacks).toBe("default");
    expect((request.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(JSON.stringify(request.messages)).toContain("<update>");

    const posts = JSON.parse(readFileSync(path.join(out, "posts.json"), "utf8"));
    expect(posts.linkedin).toContain("#Flutter #DarkMode #MobileApps");
    expect(posts.linkedin).toContain("Google Play: https://play.google.com/store/apps/details?id=com.me.cafe");
    expect(posts.facebook).toContain("الوضع الليلي وصل");
    expect(posts.youtube.localizations.ar.title).toBe("الوضع الليلي في قائمة المقهى");
    const summary = readFileSync(summaryFile, "utf8");
    expect(summary).toContain("### LinkedIn");
    expect(summary).toContain("dry run");
  }, 60000);

  it("finds no video without failing", async () => {
    const r = await run("media", env());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(out, "media.json"), "utf8")).video).toBe("");
    expect(r.stdout).toContain("YouTube will be skipped");
  }, 60000);

  it("publishes nothing in a dry run", async () => {
    const r = await run("post", env(), ["linkedin"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(path.join(out, "results", "linkedin.json"), "utf8")).status).toBe("skipped");
    expect(createdRefs).toEqual([]);
  }, 60000);

  it("skips a platform that isn't configured, without failing", async () => {
    const r = await run("post", { ...env(), DRY_RUN: "false" }, ["facebook"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const result = JSON.parse(readFileSync(path.join(out, "results", "facebook.json"), "utf8"));
    expect(result).toMatchObject({ status: "skipped" });
    expect(result.detail).toContain("FB_PAGE_ID");
  }, 60000);

  it("skips a release that was already posted everywhere", async () => {
    createdRefs.push(
      ...["facebook", "linkedin-person", "linkedin-organization", "youtube"].map((c) => `tags/social/posted/v1.2.0/${c}`),
    );
    const r = await run("collect", env());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("Already posted");
    createdRefs.length = 0;
  }, 60000);

  it("posts about a pushed tag that has no GitHub Release", async () => {
    const r = await run("collect", { ...env(), EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.3.0", GITHUB_REF_NAME: "v1.3.0" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const ctx = JSON.parse(readFileSync(path.join(out, "context.json"), "utf8"));
    expect(ctx).toMatchObject({ mode: "release", key: "v1.3.0", skip: "", commits: ["feat: table booking"] });
  }, 60000);

  it("skips when Claude finds nothing user-facing", async () => {
    modelAnswer = { user_facing: false, skip_reason: "Only dependency updates.", headline: "", posts: [] };
    await run("collect", env());
    const r = await run("generate", env());
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("skip=true");
    expect(r.stdout).toContain("Only dependency updates.");
  }, 60000);
});
