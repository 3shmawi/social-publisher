# Docs

Set-up guides, one per platform, then how to add the workflow to an app
repo. Each platform guide ends with the exact secrets it produces.

| Guide | What you get | Secrets |
|---|---|---|
| [Who writes the posts](claude.md) | Claude on your plan, the API, or templates | `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` (optional) |
| [Facebook Page](facebook.md) | video / photo / text posts on your Page | `FB_PAGE_ID`, `FB_PAGE_TOKEN` |
| [Instagram](instagram.md) | the release video as a Reel | `IG_USER_ID` (+ `FB_PAGE_TOKEN` with Instagram permissions) |
| [LinkedIn](linkedin.md) | posts with the video, as you and/or a company page | `LINKEDIN_TOKEN`, `LINKEDIN_AUTHOR_URN`, `LINKEDIN_ORG_URN`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REFRESH_TOKEN` |
| [YouTube](youtube.md) | the video uploaded (Shorts when vertical) | `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` |
| [TikTok](tiktok.md) | the video as a draft in your TikTok inbox | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`, `SOCIAL_SECRETS_TOKEN` |
| [Threads](threads.md) (opt-in) | text posts, or the video when it's public | `THREADS_USER_ID`, `THREADS_TOKEN` |
| [Bluesky](bluesky.md) (opt-in) | short posts with the image or a link card | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |
| [Telegram](telegram.md) (opt-in) | the video / image / text in your channel | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| [X](x.md) (opt-in, paid API) | short text posts | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` |
| [TikTok review video](tiktok-review-demo.md) | shot list for TikTok's app review | |
| **[Add it to an app repo](app-repo.md)** | all secrets in one table, the `social` environment, variables, dry run, going live | |
| [Reference](reference.md) | inputs, what gets posted when, media, state, security | |
| [Troubleshooting](troubleshooting.md) | error messages and fixes | |

**Privacy policy and home page** for the Meta, LinkedIn, Google and TikTok
apps: [3shmawi.github.io/social-publisher/privacy.html](https://3shmawi.github.io/social-publisher/privacy.html)
(terms: `…/terms.html`, data deletion: `…/privacy.html#deletion`). They live
in `site/` and are published by `.github/workflows/pages.yml`.
