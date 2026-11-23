// One video file every platform accepts: H.264 (High) + AAC in an MP4 with
// the index at the start, yuv420p, even dimensions, ≤ 1080×1920 (either
// way round), ≤ 60 fps. Instagram, Threads, TikTok, LinkedIn and YouTube all
// take that; many screen recordings and exports aren't it (HEVC, 4:4:4,
// 120 fps, odd sizes), which the platforms reject or re-process badly.
import { execFileSync } from "node:child_process";
import { renameSync } from "node:fs";

export interface VideoInfo {
  videoCodec: string;
  pixFmt: string;
  width: number;
  height: number;
  fps: number;
  /** "" when the video has no sound (allowed everywhere). */
  audioCodec: string;
  durationSec: number;
}

export function hasFfmpeg(): boolean {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function probe(file: string): VideoInfo {
  const raw = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate:format=duration", "-of", "json", file],
    { encoding: "utf8" },
  );
  const data = JSON.parse(raw) as {
    streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; avg_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const video = data.streams?.find((s) => s.codec_type === "video") ?? {};
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const [num = 0, den = 1] = (video.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    videoCodec: video.codec_name ?? "",
    pixFmt: video.pix_fmt ?? "",
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: den ? num / den : 0,
    audioCodec: audio?.codec_name ?? "",
    durationSec: Number(data.format?.duration ?? 0),
  };
}

/** Why the file needs re-encoding; empty when it's fine as it is. */
export function reencodeReasons(info: VideoInfo): string[] {
  const reasons: string[] = [];
  if (info.videoCodec !== "h264") reasons.push(`video codec ${info.videoCodec || "unknown"}`);
  if (info.pixFmt !== "yuv420p") reasons.push(`pixel format ${info.pixFmt || "unknown"}`);
  if (info.audioCodec && info.audioCodec !== "aac") reasons.push(`audio codec ${info.audioCodec}`);
  const long = Math.max(info.width, info.height);
  const short = Math.min(info.width, info.height);
  if (long > 1920 || short > 1080) reasons.push(`size ${info.width}×${info.height}`);
  if (info.width % 2 || info.height % 2) reasons.push(`odd size ${info.width}×${info.height}`);
  if (info.fps > 60.5) reasons.push(`${Math.round(info.fps)} fps`);
  return reasons;
}

/** ffmpeg arguments for the compliant copy (fit inside 1080×1920 either way round). */
export function reencodeArgs(input: string, output: string, info: VideoInfo): string[] {
  const portrait = info.height >= info.width;
  const [maxW, maxH] = portrait ? [1080, 1920] : [1920, 1080];
  const scale = `scale=w='min(${maxW},iw)':h='min(${maxH},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  return [
    "-y",
    "-v",
    "error",
    "-i",
    input,
    "-vf",
    `${scale},format=yuv420p`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-fpsmax",
    "60",
    ...(info.audioCodec ? ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"] : ["-an"]),
    "-movflags",
    "+faststart",
    output,
  ];
}

/**
 * Re-encodes [file] in place when it isn't compliant. Returns the reasons
 * (empty when the file was already fine and is left untouched).
 */
export function normalizeVideo(file: string): string[] {
  const info = probe(file);
  const reasons = reencodeReasons(info);
  if (reasons.length === 0) return [];
  const tmp = `${file}.normalized.mp4`;
  execFileSync("ffmpeg", reencodeArgs(file, tmp, info), { stdio: ["ignore", "inherit", "inherit"] });
  renameSync(tmp, file);
  return reasons;
}
