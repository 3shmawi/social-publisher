// Step 3: find the video and images for this update, in this order:
//   1. release assets: *.mp4, and *.png / *.jpg (up to 10: a carousel)
//   2. marketing/videos/<tag>.mp4 in the app repo; images from
//      marketing/images/<tag>/ (a folder) or marketing/images/<tag>.png|jpg
// Copies them to out/media/. No video → YouTube is skipped, nothing fails.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
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

  // Images (a carousel when there are several; never the thumbnail):
  //   1. every *.png / *.jpg release asset — alt text = the asset's label
  //   2. marketing/images/<tag>/ (a folder) — alt text = <name>.txt next to it
  //   3. marketing/images/<tag>.png|jpg
  const isImage = (name: string) => /\.(png|jpe?g)$/i.test(name) && !/thumb/i.test(name);
  const found: { file: string; source: string; url: string; alt: string }[] = [];
  const imageAssets = assets.filter((a) => isImage(a.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10);
  for (const [i, asset] of imageAssets.entries()) {
    const file = path.join(dir, `image-${i + 1}${path.extname(asset.name).toLowerCase()}`);
    await downloadAsset(asset, file);
    found.push({ file, source: `release asset ${asset.name}`, url: await publicUrl(asset.browser_download_url), alt: asset.label ?? "" });
  }
  if (found.length === 0 && ctx.tag) {
    const folder = path.join(APP_DIR, "marketing", "images", ctx.tag);
    const raw = (rel: string) =>
      ctx.sha && ctx.repo ? `https://raw.githubusercontent.com/${ctx.repo}/${ctx.sha}/${rel.split("/").map(encodeURIComponent).join("/")}` : "";
    if (existsSync(folder) && statSync(folder).isDirectory()) {
      const names = readdirSync(folder).filter(isImage).sort().slice(0, 10);
      for (const [i, name] of names.entries()) {
        const file = path.join(dir, `image-${i + 1}${path.extname(name).toLowerCase()}`);
        copyFileSync(path.join(folder, name), file);
        const sidecar = path.join(folder, `${path.parse(name).name}.txt`);
        found.push({
          file,
          source: `marketing/images/${ctx.tag}/${name}`,
          url: await publicUrl(raw(`marketing/images/${ctx.tag}/${name}`)),
          alt: existsSync(sidecar) ? readFileSync(sidecar, "utf8").trim() : "",
        });
      }
    } else {
      for (const ext of [".png", ".jpg", ".jpeg"]) {
        const src = path.join(APP_DIR, "marketing", "images", `${ctx.tag}${ext}`);
        if (!existsSync(src)) continue;
        const file = path.join(dir, `image-1${ext}`);
        copyFileSync(src, file);
        const sidecar = path.join(APP_DIR, "marketing", "images", `${ctx.tag}.txt`);
        found.push({
          file,
          source: `marketing/images/${ctx.tag}${ext}`,
          url: await publicUrl(raw(`marketing/images/${ctx.tag}${ext}`)),
          alt: existsSync(sidecar) ? readFileSync(sidecar, "utf8").trim() : "",
        });
        break;
      }
    }
  }
  if (found.length) {
    media.image = found[0]!.file;
    media.imageSource = found.length > 1 ? `${found[0]!.source} (+${found.length - 1} more)` : found[0]!.source;
    media.imageAlt = found[0]!.alt;
    media.images = found.map((f) => f.file);
    media.imageUrls = found.map((f) => f.url);
    media.imageAlts = found.map((f) => f.alt);
  }

  // YouTube extras: a custom thumbnail and subtitle files.
  const thumbAsset = assets.find((a) => /thumb/i.test(a.name) && /\.(png|jpe?g)$/i.test(a.name));
  if (thumbAsset) {
    media.thumbnail = path.join(dir, `thumbnail${path.extname(thumbAsset.name).toLowerCase()}`);
    await downloadAsset(thumbAsset, media.thumbnail);
  } else if (ctx.tag) {
    for (const ext of [".png", ".jpg", ".jpeg"]) {
      const src = path.join(APP_DIR, "marketing", "thumbnails", `${ctx.tag}${ext}`);
      if (!existsSync(src)) continue;
      media.thumbnail = path.join(dir, `thumbnail${ext}`);
      copyFileSync(src, media.thumbnail);
      break;
    }
  }
  const CAPTION = /\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.(srt|vtt)$/;
  const captions: { language: string; file: string }[] = [];
  for (const asset of assets) {
    const m = CAPTION.exec(asset.name);
    if (!m) continue;
    const file = path.join(dir, `captions.${m[1]}.${m[2]}`);
    await downloadAsset(asset, file);
    captions.push({ language: m[1]!, file });
  }
  const captionDir = path.join(APP_DIR, "marketing", "captions");
  if (captions.length === 0 && ctx.tag && existsSync(captionDir)) {
    for (const name of readdirSync(captionDir).sort()) {
      if (!name.startsWith(`${ctx.tag}.`)) continue;
      const m = CAPTION.exec(name);
      if (!m) continue;
      const file = path.join(dir, `captions.${m[1]}.${m[2]}`);
      copyFileSync(path.join(captionDir, name), file);
      captions.push({ language: m[1]!, file });
    }
  }
  if (captions.length) media.captions = captions;

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
  if (media.image) console.log(`Images: ${media.imageSource}`);
  if (media.thumbnail) console.log("YouTube thumbnail: found");
  if (media.captions) console.log(`Captions: ${media.captions.map((c) => c.language).join(", ")}`);

  // Paths relative to out/, so they still work after the artifact is downloaded elsewhere.
  const rel = (p: string) => (p ? path.relative(outPath(), p) : "");
  const stored = {
    ...media,
    video: rel(media.video),
    image: rel(media.image),
    images: media.images?.map(rel),
    thumbnail: media.thumbnail ? rel(media.thumbnail) : undefined,
    captions: media.captions?.map((c) => ({ ...c, file: rel(c.file) })),
  };
  writeJson(outPath("media.json"), stored);
  setOutput("has_video", media.video ? "true" : "false");
}

run(main);
