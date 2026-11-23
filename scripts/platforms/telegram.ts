// Telegram channel (or group) through the Bot API: the bot must be an admin
// of the channel with "Post messages".
//   video ≤ 50 MB → sendVideo (caption)
//   image         → sendPhoto (caption)
//   else          → sendMessage (link preview)
// https://core.telegram.org/bots/api
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { type Context, type Media, type PlatformResult, type Posts, buildShortPosts, clampChars } from "../lib/content.ts";
import { env, mask } from "../lib/env.ts";
import { HttpError, requestJson } from "../lib/http.ts";

/** Bots upload files up to 50 MB. */
const MAX_UPLOAD = 50 * 1024 * 1024;

export function configured(): string {
  const missing = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"].filter((n) => !env(n));
  return missing.length ? `missing secrets ${missing.join(", ")}` : "";
}

/** The bot token is part of the URL (Telegram's design): mask it first. */
function api(method: string): string {
  const token = env("TELEGRAM_BOT_TOKEN");
  mask(token);
  return `${env("TELEGRAM_API_BASE", "https://api.telegram.org")}/bot${token}/${method}`;
}

interface TgResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

function explain(err: unknown): Error {
  if (!(err instanceof HttpError)) return err as Error;
  let message = err.message.replace(/bot[0-9]+:[\w-]+/g, "bot***");
  try {
    message = (JSON.parse(err.body) as { description?: string }).description ?? message;
  } catch {
    // keep the HTTP message
  }
  if (err.status === 401) return new Error("Telegram: TELEGRAM_BOT_TOKEN was refused. Get it again from @BotFather (docs/telegram.md).");
  if (err.status === 400 && /chat not found/i.test(message)) {
    return new Error("Telegram: TELEGRAM_CHAT_ID not found. Use @channelname or the channel's numeric id (docs/telegram.md, step 3).");
  }
  if (err.status === 403) {
    return new Error(`Telegram: the bot can't post there (${message}). Make it an admin of the channel with "Post messages".`);
  }
  return new Error(`Telegram: ${message}`);
}

export async function preflight(): Promise<string> {
  try {
    const me = await requestJson<TgResponse<{ username: string }>>(api("getMe"), { label: "Telegram bot" });
    const chat = await requestJson<TgResponse<{ title?: string; username?: string }>>(
      `${api("getChat")}?chat_id=${encodeURIComponent(env("TELEGRAM_CHAT_ID"))}`,
      { label: "Telegram channel" },
    );
    return `bot @${me.result.username} → ${chat.result.title ?? chat.result.username ?? env("TELEGRAM_CHAT_ID")}`;
  } catch (err) {
    throw explain(err);
  }
}

/** A link to the message when the channel is public. */
function messageUrl(chat: { username?: string } | undefined, id: number): string {
  return chat?.username ? `https://t.me/${chat.username}/${id}` : "";
}

export async function publish(ctx: Context, posts: Posts, media: Media, outDir: string): Promise<PlatformResult> {
  const caption = posts.telegram || buildShortPosts(posts.perLanguage, ctx.app).telegram;
  const chatId = env("TELEGRAM_CHAT_ID");
  try {
    let sent: TgResponse<{ message_id: number; chat?: { username?: string } }>;
    let detail: string;
    const video = media.video ? path.join(outDir, media.video) : "";
    const image = media.image ? path.join(outDir, media.image) : "";
    if (video && (await stat(video)).size <= MAX_UPLOAD) {
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set("caption", caption);
      form.set("supports_streaming", "true");
      form.set("video", await openAsBlob(video, { type: "video/mp4" }), "video.mp4");
      sent = await requestJson(api("sendVideo"), { method: "POST", body: form, label: "Telegram video", retries: 1 });
      detail = "Posted with the video.";
    } else if (image) {
      const form = new FormData();
      form.set("chat_id", chatId);
      form.set("caption", caption);
      form.set("photo", await openAsBlob(image), path.basename(image));
      sent = await requestJson(api("sendPhoto"), { method: "POST", body: form, label: "Telegram photo", retries: 1 });
      detail = video ? "Posted with the image (the video is over Telegram's 50 MB bot limit)." : "Posted with the image.";
    } else {
      sent = await requestJson(api("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: clampChars(caption, 4096) }),
        label: "Telegram message",
        retries: 1,
      });
      detail = video ? "Posted as text (the video is over Telegram's 50 MB bot limit)." : "Posted (text with link preview).";
    }
    const url = messageUrl(sent.result.chat, sent.result.message_id);
    return {
      platform: "telegram",
      status: "posted",
      detail,
      links: url ? [{ label: "Telegram post", url }] : [],
      ids: [String(sent.result.message_id)],
    };
  } catch (err) {
    throw explain(err);
  }
}
