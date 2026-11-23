// Step 3: find the video (and an image) for this update, in this order:
//   1. a release asset matching *.mp4 (images: *.png / *.jpg)
//   2. marketing/videos/<tag>.mp4 in the app repo (images: marketing/images/<tag>.png|jpg)
// Copies them to out/media/. No video → YouTube is skipped, nothing fails.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Context, Media } from "./lib/content.ts";
import { env, envBool, notice, outPath, readJson, run, setOutput, warning, writeJson } from "./lib/env.ts";
import { downloadAsset, getRelease } from "./lib/github.ts";
import { hasFfmpeg, normalizeVideo } from "./lib/video.ts";

const APP_DIR = env("APP_DIR", ".");

/** The URL if anyone can download it (a public repo), else "". No token is sent. */
async function publicUrl(url: string | undefined): Promise<string> {
  if (!url) return "";
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return res.ok ? url : "";
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const ctx = readJson<Context>(outPath("context.json"));
  const media: Media = { video: "", videoSource: "", image: "", imageSource: "" };
  const dir = outPath("media");
  mkdirSync(dir, { recursive: true });

  const release = ctx.mode === "release" ? await getRelease(ctx.tag) : undefined;
  const assets = release?.assets ?? [];

  const video = assets.find((a) => /\.mp4$/i.test(a.name));
  if (video) {
    media.video = path.join(dir, "video.mp4");
    await downloadAsset(video, media.video);
    media.videoSource = `release asset ${video.name}`;
    media.videoUrl = await publicUrl(video.browser_download_url);
  } else if (ctx.tag) {
    const file = path.join(APP_DIR, "marketing", "videos", `${ctx.tag}.mp4`);
    if (existsSync(file)) {
      media.video = path.join(dir, "video.mp4");
      copyFileSync(file, media.video);
      media.videoSource = `marketing/videos/${ctx.tag}.mp4`;
      if (ctx.sha && ctx.repo) {
        media.videoUrl = await publicUrl(
          `https://raw.githubusercontent.com/${ctx.repo}/${ctx.sha}/marketing/videos/${encodeURIComponent(ctx.tag)}.mp4`,
        );
      }
    }
  }

  const image = assets.find((a) => /\.(png|jpe?g)$/i.test(a.name));
  if (image) {
    media.image = path.join(dir, `image${path.extname(image.name).toLowerCase()}`);
    await downloadAsset(image, media.image);
    media.imageSource = `release asset ${image.name}`;
  } else if (ctx.tag) {
    for (const ext of [".png", ".jpg", ".jpeg"]) {
      const file = path.join(APP_DIR, "marketing", "images", `${ctx.tag}${ext}`);
      if (existsSync(file)) {
        media.image = path.join(dir, `image${ext}`);
        copyFileSync(file, media.image);
        media.imageSource = `marketing/images/${ctx.tag}${ext}`;
        break;
      }
    }
  }

  // One copy every platform accepts (H.264 + AAC, ≤ 1080×1920, ≤ 60 fps).
  if (media.video && envBool("REENCODE", true)) {
    if (!hasFfmpeg()) {
      warning("ffmpeg isn't installed: the video is posted as it is (it may be refused if it isn't H.264 + AAC).");
    } else {
      try {
        const reasons = normalizeVideo(media.video);
        if (reasons.length) {
          media.videoSource += ` (re-encoded: ${reasons.join(", ")})`;
          // The public file is the original, which platforms would refuse:
          // Instagram uploads this copy instead; Threads posts text.
          media.videoUrl = "";
          notice(`Re-encoded the video for the platforms (${reasons.join(", ")}).`);
        }
      } catch (err) {
        warning(`Couldn't re-encode the video (${(err as Error).message}); posting the original.`);
      }
    }
  }

  if (media.video) {
    console.log(`Video: ${media.videoSource} (${(statSync(media.video).size / 1048576).toFixed(1)} MB)`);
  } else {
    notice(
      `No video for ${ctx.tag || "this update"} (no *.mp4 release asset, no marketing/videos/${ctx.tag || "<tag>"}.mp4): YouTube will be skipped.`,
    );
  }
  if (media.image) console.log(`Image: ${media.imageSource}`);

  // Paths relative to out/, so they still work after the artifact is downloaded elsewhere.
  const rel = (p: string) => (p ? path.relative(outPath(), p) : "");
  const stored = { ...media, video: rel(media.video), image: rel(media.image) };
  writeJson(outPath("media.json"), stored);
  setOutput("has_video", media.video ? "true" : "false");
}

run(main);
