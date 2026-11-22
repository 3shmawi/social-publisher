// Try the TikTok upload from your own computer, without GitHub Actions:
//
//   TIKTOK_CLIENT_KEY=… TIKTOK_CLIENT_SECRET=… TIKTOK_TOKEN_FILE=~/.tiktok-token \
//     npx tsx scripts/tiktok-try.ts path/to/video.mp4
//
// The refresh token is read from TIKTOK_TOKEN_FILE (as written by
// get-tiktok-token.ts) and the new one written back there, so nothing secret
// appears on screen. Without the file, TIKTOK_REFRESH_TOKEN is used and the
// new token is printed.
//
// Uploads the video to the connected account's TikTok inbox as a draft,
// exactly as the workflow's TikTok job does, and prints each step (good for
// the sandbox test and the review's demo video). TikTok rotates the refresh
// token on use: after a run, copy the new one into shared.env and run
// tool/setup_secrets.sh, or the next workflow run fails.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Media, Posts } from "./lib/content.ts";
import * as tiktok from "./platforms/tiktok.ts";

async function main(): Promise<void> {
  const video = process.argv[2];
  if (!video) throw new Error("Usage: npx tsx scripts/tiktok-try.ts path/to/video.mp4");
  const tokenSource = process.env.TIKTOK_TOKEN_FILE ?? "";
  if (tokenSource) process.env.TIKTOK_REFRESH_TOKEN = readFileSync(tokenSource, "utf8").trim();
  const missing = tiktok.configured();
  if (missing) throw new Error(`TikTok: ${missing} (set them in the environment).`);

  const dir = mkdtempSync(path.join(tmpdir(), "tiktok-try-"));
  const tokenFile = path.join(dir, "token");
  process.env.TIKTOK_NEW_TOKEN_FILE = tokenFile;
  copyFileSync(video, path.join(dir, "video.mp4"));
  const media: Media = { video: "video.mp4", videoSource: video, image: "", imageSource: "" };
  const posts = { facebook: "Test upload from Social Publisher." } as Posts;

  console.log("1. Refreshing the TikTok access token…");
  console.log(`2. Uploading ${path.basename(video)} to the TikTok inbox (draft)…`);
  try {
    const result = await tiktok.publish(posts, media, dir);
    console.log(`3. ${result.detail}`);
  } finally {
    try {
      const token = readFileSync(tokenFile, "utf8");
      if (tokenSource) {
        writeFileSync(tokenSource, token, { mode: 0o600 });
        console.log(`\nTikTok issued a new refresh token; saved to ${tokenSource}.`);
      } else {
        console.log("\nTikTok issued a NEW refresh token (the old one no longer works). Save it as TIKTOK_REFRESH_TOKEN:\n");
        console.log(token);
      }
    } catch {
      // no refresh happened
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
