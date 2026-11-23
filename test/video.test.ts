// The re-encode rules, and a real ffmpeg run when ffmpeg is installed.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasFfmpeg, normalizeVideo, probe, reencodeArgs, reencodeReasons, type VideoInfo } from "../scripts/lib/video.ts";

const good: VideoInfo = { videoCodec: "h264", pixFmt: "yuv420p", width: 1080, height: 1920, fps: 30, audioCodec: "aac", durationSec: 20 };

describe("reencodeReasons", () => {
  it("leaves a compliant file alone (sound or not)", () => {
    expect(reencodeReasons(good)).toEqual([]);
    expect(reencodeReasons({ ...good, audioCodec: "" })).toEqual([]);
    expect(reencodeReasons({ ...good, width: 1920, height: 1080 })).toEqual([]);
  });

  it("names everything a platform would refuse", () => {
    expect(
      reencodeReasons({ videoCodec: "hevc", pixFmt: "yuv444p", width: 1179, height: 2556, fps: 120, audioCodec: "opus", durationSec: 5 }),
    ).toEqual(["video codec hevc", "pixel format yuv444p", "audio codec opus", "size 1179×2556", "odd size 1179×2556", "120 fps"]);
  });
});

describe("reencodeArgs", () => {
  it("fits portrait videos in 1080×1920 and keeps sound as AAC", () => {
    const args = reencodeArgs("in.mov", "out.mp4", { ...good, width: 1179, height: 2556 }).join(" ");
    expect(args).toContain("min(1080,iw)");
    expect(args).toContain("min(1920,ih)");
    expect(args).toContain("-c:a aac");
    expect(args).toContain("+faststart");
  });

  it("drops the audio stream when there is none", () => {
    expect(reencodeArgs("in.mov", "out.mp4", { ...good, audioCodec: "" })).toContain("-an");
  });
});

describe.skipIf(!hasFfmpeg())("normalizeVideo (real ffmpeg)", () => {
  it("turns a 4:4:4, odd-sized, 90 fps clip into H.264 yuv420p", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "video-"));
    const file = path.join(dir, "video.mp4");
    execFileSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1281x2401:rate=90", "-f", "lavfi", "-i", "sine=frequency=440",
      "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv444p", "-c:a", "libopus", "-shortest", file,
    ]);
    const reasons = normalizeVideo(file);
    expect(reasons.length).toBeGreaterThan(0);
    const after = probe(file);
    expect(reencodeReasons(after)).toEqual([]);
    expect(after.height).toBeLessThanOrEqual(1920);
    expect(after.audioCodec).toBe("aac");
    // Already compliant: left untouched.
    expect(normalizeVideo(file)).toEqual([]);
  }, 60_000);
});
