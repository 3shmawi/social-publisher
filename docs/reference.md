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
| `platforms` | `facebook,instagram,linkedin,youtube,tiktok` | Any subset; also the opt-in `threads` |
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

## Media

| | Used for |
|---|---|
| Release asset `*.mp4`, or `marketing/videos/<tag>.mp4` in the app repo | YouTube upload, Facebook video post, LinkedIn video post (up to 500 MB; one upload per author), Instagram Reel, TikTok inbox draft |
| Release asset `*.png` / `*.jpg`, or `marketing/images/<tag>.png` | Facebook photo post |

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

