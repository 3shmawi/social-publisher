# Telegram

Posts each update to your Telegram channel (or group) through a bot: the
release video (up to 50 MB) or image with a caption, otherwise a text
message with a link preview. All languages, like the Facebook post.

← [All docs](README.md) · [README](../README.md)

Telegram is **opt-in**: add `telegram` to the `platforms` input.

## 1. A bot
In Telegram, open **@BotFather** → `/newbot` → a name and a username
ending in `bot`. It replies with the token (`123456:ABC…`): that's
`TELEGRAM_BOT_TOKEN`. Keep it secret; `/revoke` in BotFather makes a new
one.

## 2. Make it a channel admin
Your channel → **Administrators → Add admin** → the bot → only **Post
messages** (nothing else).

## 3. The chat id
- Public channel: `@yourchannel`.
- Private channel: forward any post from it to **@userinfobot** (or
  similar) and use the id it shows, e.g. `-1001234567890`.

## 4. Add the secrets
| Secret | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from step 1 |
| `TELEGRAM_CHAT_ID` | from step 3 |

```bash
gh secret set TELEGRAM_BOT_TOKEN --repo <you>/<app>
gh secret set TELEGRAM_CHAT_ID --repo <you>/<app>
```
Pass them in `social.yml`, add `telegram` to `platforms`, dry run. The
credentials check shows the bot and the channel name.

## Limits
- Caption 1,024 characters (the post is fitted to it). Bots upload videos
  up to 50 MB; a bigger video posts the image or text instead.
- The post link appears in the summary for public channels only.

## Troubleshooting
| Message | Fix |
|---|---|
| `TELEGRAM_BOT_TOKEN was refused` | Step 1 again (`/token` in BotFather) |
| `TELEGRAM_CHAT_ID not found` | Step 3; the bot must be in the channel |
| `the bot can't post there` | Step 2: admin with *Post messages* |
