# Reference

Inputs, what gets posted when, languages, media, state and security.

← [All docs](README.md) · [README](../README.md)

## Inputs

| Input | Default | |
|---|---|---|
| `app_name` | required | Name as users know it |
| `about` | | One or two sentences about the app and its users; helps the writing |
| `voice` | | Style notes ("casual, no emojis on LinkedIn") |
| `play_store_url`, `app_store_url`, `website_url` | | Added after each post; empty ones are left out |
| `platforms` | `facebook,instagram,linkedin,youtube,tiktok` | Any subset; also the opt-in `threads`, `bluesky`, `telegram`, `x` |
| `utm` | `true` | Campaign tags on links (see [Language and links](#language-and-links)) |
| `app_store_provider_token` | | Tags App Store links for App Analytics |
| `reencode` | `true` | Re-encode the video when a platform wouldn't take it (ffmpeg) |
| `x_links` | `true` | Add the link to X posts (a post with a link costs more on X) |
| `languages` | `en` | e.g. `en,ar`; the first is the main language |
| `linkedin_as` | `person` | `person`, `organization` or `both` |
| `linkedin_version` | `202609` | `LinkedIn-Version` header |
| `facebook_graph_version` | `v24.0` | Graph API version |
| `youtube_privacy` | `private` | `private`, `unlisted`, `public` |
| `youtube_audited` | `false` | `true` once the YouTube audit has passed |
| `tiktok_token_repos` | this repo | Repos whose `TIKTOK_REFRESH_TOKEN` gets the rotated token ([TikTok](tiktok.md) step 4) |
| `release_tag` | | Empty: the triggering or latest release. `changes`: commits since the last post. Or a tag. |
| `biweekly` | `true` | On schedule runs, skip odd ISO weeks |
| `include_prereleases` | `false` | |
| `dry_run` | `true` | Generate and show only |
| `force` | `false` | Post even if already posted |
| `environment` | `social` | Approval environment |
| `require_approval` | `true` | Refuse to post when the environment has no reviewer |
| `writer` | `auto` | `auto`, `claude-code`, `api` or `template` ([Who writes the posts](claude.md)) |
| `hashtags` | | Hashtags for template posts, e.g. `Flutter,MobileApps` |
| `model` | `claude-sonnet-5-5` | Claude model (Claude Code and API writers) |

## How it decides what to post

- **Release** (the `release` event, or a manual run): the release title and
  notes, plus the commits since the previous `v*` tag. Drafts are ignored;
  pre-releases too unless `include_prereleases`.
- **Pushed `v*` tag, or a tag without a GitHub Release** (e.g. Codemagic only
  pushes tags): the commits since the previous `v*` tag. Tags pushed with
  the workflow's own `GITHUB_TOKEN` start no workflows; tags pushed with a
  personal token or by hand do.
- **Schedule / `release_tag: changes`**: commits and merged PRs since the
  `social/last-post` tag (or since the latest `v*` tag, or the last 14 days).
  The schedule runs weekly and skips odd ISO weeks, since cron can't express
  "every two weeks".
- **Skipped, with the reason in the summary**: only internal Conventional
  Commits (`chore`, `ci`, `build`, `refactor`, `test`, `style`, `docs`), Claude finds
  nothing user-facing, the notes contain `[skip social]`, a PR has the label
  `skip-social`, or every platform already posted it.

## Language and links

Each language gets its own post written natively, not translated. LinkedIn and Facebook get
one post with the languages one after another (separated by `— — —`); YouTube
gets the main language plus a localization per other language, so viewers
see their own language. Store links are added by the script, not by the
model, so they're always exact.

**Campaign tags** (`utm`, on by default): each platform's links say where
the visit came from, with the update as the campaign — website links get
`utm_source=<platform>&utm_medium=social&utm_campaign=<tag>`, Google Play
links get the same in `referrer` (Play Console → Statistics / acquisition
reports by campaign), App Store links get `pt` + `ct` (App Analytics →
Campaigns) only when you set `app_store_provider_token` (App Store
Connect → App Analytics → Campaigns → Campaign Generator shows it). In
PostHog / web analytics filter by `utm_source` to see which platform
brings people.

## Media

| | Used for |
|---|---|
| Release asset `*.mp4`, or `marketing/videos/<tag>.mp4` in the app repo | YouTube upload, Facebook video post, LinkedIn video post (up to 500 MB; one upload per author), Instagram Reel, TikTok inbox draft |
| Release assets `*.png` / `*.jpg` (up to 10, by name; not `*thumb*`), or the folder `marketing/images/<tag>/`, or `marketing/images/<tag>.png` | Facebook photo post; **without a video:** an Instagram image or carousel (2–10, needs public URLs), a LinkedIn image or multi-image post, the Bluesky / Telegram image |
| Release asset `*thumb*.png|jpg`, or `marketing/thumbnails/<tag>.png|jpg` | YouTube custom thumbnail |
| Release assets `*.<lang>.srt|vtt`, or `marketing/captions/<tag>.<lang>.srt|vtt` | YouTube captions, one per language |

**Alt text** (screen readers) for each image: the release asset's
*label* (edit the asset on the release page), or a `.txt` file with the same
name next to it in `marketing/images/`, else "<app>: <headline>". Used by
Instagram, LinkedIn and Bluesky.

**Re-encoding** (`reencode`, on by default): the Generate job checks the
video with ffprobe and, only when a platform would refuse it, makes one
copy they all take — H.264 (High) + AAC, yuv420p, even size within
1080×1920 (either way round), ≤ 60 fps, index at the start
(`scripts/lib/video.ts`). The review page says why ("re-encoded: video
codec hevc, 120 fps"). The public release URL still points at the
original, so for a re-encoded video Instagram uploads the copy and Threads
posts text.

No video → Instagram, YouTube and TikTok are skipped (not failed). A vertical video under 3 minutes
becomes a YouTube Short.

## State ("don't post twice")

Lightweight tags in the app repo, created through the API (they start no workflows):

- `social/posted/<key>/<channel>`: `<key>` is the release tag or
  `changes-<sha>`, `<channel>` is `facebook`, `linkedin-person`,
  `linkedin-organization`, `instagram`, `youtube` or `tiktok`. Present → that channel is skipped.
  Re-running a failed job therefore only retries what failed.
- `social/last-post`: the commit of the last posted update; the schedule
  starts from there.

To post an update again: run with `force: true`, or delete the tag
(`git push origin :refs/tags/social/posted/v1.2.0/facebook`).

## Security

- Secrets reach scripts only through `env:`; tokens made during a run (page,
  access tokens) are masked; nothing logs request headers.
- Before approval, platform secrets are used only for read-only credential
  checks (TikTok's token isn't touched before approval: checking it would
  rotate it). After approval, each posting job gets only its own platform's
  secrets.
- TikTok's rotated refresh token is masked, written to a file in
  `$RUNNER_TEMP` (never to `out/`, which is uploaded), saved with
  `gh secret set` from stdin and deleted. `SOCIAL_SECRETS_TOKEN` should be a
  fine-grained token limited to your app repos and *Secrets: Read and write*.
- Release notes and PR texts are passed to Claude as data inside `<update>`
  tags, and you review the result before anything is posted: a PR author
  can't make it post something you didn't see.
- Actions are pinned to commits; app repos pin this workflow to a commit,
  and the scripts are checked out at that same commit (`job.workflow_sha`).
- No npm cache (cache poisoning on release events); `npm ci` from the lockfile.

## Weekly credential check
`examples/social-health.yml` (copy it next to `social.yml`, same platforms
and secrets) calls `.github/workflows/health.yml` every Monday:
- runs each enabled platform's read-only check (the same one the review
  page shows), so an expired Facebook, LinkedIn, YouTube, Threads,
  Bluesky, Telegram or X credential shows up before a release;
- while anything fails it keeps **one issue** open (label
  `social-credentials`) and updates it each week, with each platform's fix;
  it closes the issue when all checks pass;
- refreshes the Threads token (60 days) and saves it with
  `SOCIAL_SECRETS_TOKEN`, in every repo in `threads_token_repos`;
- TikTok isn't checked: checking would rotate its token (the posting job
  does that).

Needs `permissions: issues: write` in the caller (the example has it).

## Insights
`examples/social-insights.yml` calls `.github/workflows/insights.yml`
daily. Each post is reported once, 7 days after it went out (`days`), in
the run's summary: views, likes, comments and shares per platform with a
link to the post. Run it by hand with `key: v1.2.0` for one update.

It reads the post ids stored in the `social/posted/<key>/<channel>` tags
(annotated tags; posts made before this feature have no ids and are left
out). What each platform shares:

| Platform | Numbers | Needs |
|---|---|---|
| Facebook | reactions, comments, shares; video views | Page token (`read_insights` for video views) |
| Instagram | views, likes, comments, shares | `instagram_manage_insights` on the Page token |
| LinkedIn | likes, comments | a token that may read social actions on the post |
| YouTube | views, likes, comments | the existing YouTube secrets |
| Threads | views, likes, replies, reposts | `threads_manage_insights` (in `get-threads-token.ts`) |
| Bluesky | likes, replies, reposts | nothing (public) |
| X | impressions, likes, replies, reposts | `x_insights: true` — X bills each read |
| TikTok, Telegram | — | not shared (TikTok: a draft; Telegram: no view counts for bots) |

A missing permission shows as a note in that row; the rest of the report
still runs.

