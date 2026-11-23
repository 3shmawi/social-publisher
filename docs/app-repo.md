# Add it to an app repo

Everything an app repo needs: the caller workflow, every secret, the
approval environment, the variables, and the first dry run.

← [All docs](README.md) · [README](../README.md)

## 1. Get the accounts ready

Do the platform guides first. Each one ends with the secrets it gives you.
You can do any subset: a platform without its secrets is **skipped** (shown
in the summary), never failed.

| Platform | Guide | Time |
|---|---|---|
| Post writer (Claude) | [claude.md](claude.md) | 2 min |
| Facebook Page | [facebook.md](facebook.md) | 15 min |
| Instagram | [instagram.md](instagram.md) | 10 min (after Facebook) |
| LinkedIn | [linkedin.md](linkedin.md) | 15 min (+ a few days for the company-page API review) |
| YouTube | [youtube.md](youtube.md) | 20 min (+ weeks for the audit, for public videos) |
| TikTok | [tiktok.md](tiktok.md) | 30 min (+ TikTok's app review) |
| Threads (opt-in) | [threads.md](threads.md) | 10 min |
| Bluesky (opt-in) | [bluesky.md](bluesky.md) | 2 min |
| Telegram (opt-in) | [telegram.md](telegram.md) | 5 min |
| X (opt-in, paid) | [x.md](x.md) | 10 min |

The token helpers run on your own computer (Node 22+):

```bash
git clone https://github.com/3shmawi/social-publisher && cd social-publisher && npm ci
```

## 2. The secrets

Set them on **each app repo** (personal GitHub accounts have no shared
secrets; a GitHub organization can hold them once as organization secrets).

| Secret | Platform | Required | From |
|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | writer | no (recommended) | `claude setup-token` ([claude.md](claude.md)) |
| `ANTHROPIC_API_KEY` | writer | no | API key with credit ([claude.md](claude.md)) |
| `FB_PAGE_ID` | Facebook | yes | `get-facebook-token.ts` ([facebook.md](facebook.md)) |
| `FB_PAGE_TOKEN` | Facebook, Instagram | yes | `get-facebook-token.ts`; with Instagram permissions for Instagram |
| `IG_USER_ID` | Instagram | yes | `get-facebook-token.ts` ([instagram.md](instagram.md)) |
| `LINKEDIN_TOKEN` | LinkedIn | yes* | `get-linkedin-token.ts` ([linkedin.md](linkedin.md)) |
| `LINKEDIN_AUTHOR_URN` | LinkedIn as you | for `person`/`both` | `get-linkedin-token.ts` |
| `LINKEDIN_ORG_URN` | LinkedIn as a page | for `organization`/`both` | the page's admin URL |
| `LINKEDIN_CLIENT_ID` | LinkedIn | recommended | the LinkedIn app's *Auth* tab |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn | recommended | the LinkedIn app's *Auth* tab |
| `LINKEDIN_REFRESH_TOKEN` | LinkedIn | optional | `get-linkedin-token.ts` (Community Management API apps) |
| `YT_CLIENT_ID` | YouTube | yes | Google Cloud OAuth client ([youtube.md](youtube.md)) |
| `YT_CLIENT_SECRET` | YouTube | yes | Google Cloud OAuth client |
| `YT_REFRESH_TOKEN` | YouTube | yes | `get-youtube-token.ts` |
| `TIKTOK_CLIENT_KEY` | TikTok | yes | TikTok app ([tiktok.md](tiktok.md)) |
| `TIKTOK_CLIENT_SECRET` | TikTok | yes | TikTok app |
| `TIKTOK_REFRESH_TOKEN` | TikTok | yes (first time) | `get-tiktok-token.ts`; the workflow replaces it after every run |
| `SOCIAL_SECRETS_TOKEN` | TikTok, Threads | yes (TikTok) | fine-grained GitHub token, *Secrets: Read and write* on your app repos |
| `THREADS_USER_ID` | Threads | yes | `get-threads-token.ts` ([threads.md](threads.md)) |
| `THREADS_TOKEN` | Threads | yes | `get-threads-token.ts`; the weekly check refreshes it |
| `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | Bluesky | yes | an app password ([bluesky.md](bluesky.md)) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram | yes | @BotFather ([telegram.md](telegram.md)) |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | X | yes | X Developer Console ([x.md](x.md)) |

\* or `LINKEDIN_REFRESH_TOKEN` with the client ID and secret.

**Set them from a terminal.** The value is read from stdin, so it never
lands in your shell history or on screen:

```bash
gh secret set FB_PAGE_TOKEN --repo <you>/<app>
```

**flutter-project-kit apps:** put the values in `~/.app-secrets/shared.env`
(the kit's template lists them) and run `tool/setup_secrets.sh` in the app
repo; it uploads every non-empty value. An empty value never overwrites a
secret, so after the first upload **delete `TIKTOK_REFRESH_TOKEN` from
`shared.env`** (the workflow owns it from then on).

Never paste a token into a chat, an issue or a commit. If one leaks, revoke
it on the platform first, then make a new one.

## 3. The approval environment

App repo → *Settings → Environments → New environment* → name **`social`**
→ *Required reviewers* → add yourself → *Save*. Optionally limit
*Deployment branches and tags* to your default branch and `v*` tags.

Live runs refuse to post if `social` has no required reviewer (GitHub would
otherwise create the environment on the fly, with no rules, and post without
asking). To opt out on purpose, pass `require_approval: false`.

## 4. The caller workflow

Copy [`examples/social.yml`](../examples/social.yml) to
`.github/workflows/social.yml` in the app repo, change the `with:` values,
and pin the `uses:` line to a release commit of this repo (the comment must
be the tag, which zizmor checks):

```yaml
uses: 3shmawi/social-publisher/.github/workflows/publish.yml@<commit sha> # v1.5.0
```

The caller job needs `permissions: contents: write` (the "already posted"
tags) and `actions: read` (the approval-environment check).
flutter-project-kit apps already have this file; their `release.yml` starts
it after each store release.

**Variables** (*Settings → Secrets and variables → Actions → Variables*). The
kit's caller reads all of these; [`examples/social.yml`](../examples/social.yml) reads `SOCIAL_LIVE` and `APP_STORE_URL`:

| Variable | Effect |
|---|---|
| `SOCIAL_ENABLED` | kit apps: `true` turns automatic runs on (manual runs always work) |
| `SOCIAL_LIVE` | `true`: release and schedule runs post (after approval); otherwise they're dry runs |
| `SOCIAL_PLATFORMS` | subset, e.g. `instagram` to test one platform (default all five) |
| `SOCIAL_LANGUAGES` | default `en,ar` |
| `SOCIAL_LINKEDIN_AS` | `person`, `organization` or `both` |
| `SOCIAL_HASHTAGS` | hashtags for template posts |
| `SOCIAL_YOUTUBE_PRIVACY`, `SOCIAL_YOUTUBE_AUDITED` | after the YouTube audit: `public`, `true` |
| `SOCIAL_TIKTOK_TOKEN_REPOS` | every repo sharing the TikTok account, e.g. `me/app1,me/app2` |
| `APP_STORE_URL`, `PLAY_STORE_URL`, `SOCIAL_WEBSITE_URL` | links added under each post |

## 5. Dry run, then go live

1. App repo → *Actions* → **Social posts** → *Run workflow* → leave
   **dry_run** ticked → *Run*. (On a release with only internal changes it
   skips; set `release_tag` to a release with a user-facing change.)
2. Open the run → **Generate posts** → the summary shows every post per
   platform and language, the video it found, and a **credentials table**
   (✅ / ❌ per platform, with the reason). The same files are in the
   `social-posts` artifact.
3. Run again with **dry_run** unticked. The run stops at **Approve posts**:
   *Review deployments* → tick `social` → *Approve and deploy*. The platform
   jobs post and **Summary** lists the links.
4. Set `SOCIAL_LIVE=true` so releases and the schedule post on their own
   (still waiting for your approval).

**Videos.** Attach an `*.mp4` to the GitHub Release (or commit
`marketing/videos/<tag>.mp4`). Instagram, YouTube and TikTok need one;
Facebook and LinkedIn post text without it. Instagram needs the repo to be
**public** ([instagram.md](instagram.md)).

**Re-running.** Every posted platform is tagged
`social/posted/<tag>/<platform>`, so running the same release again only
posts where it hasn't yet. To post again on purpose: `force: true`.

## Several apps

Each app repo gets its own secrets (the same values), its own `social`
environment and its own caller. Two things are shared:

- **TikTok's token rotates**: set `SOCIAL_TIKTOK_TOKEN_REPOS` to all the app
  repos in each of them, and give `SOCIAL_SECRETS_TOKEN` access to all of
  them, so every run saves the new token everywhere.
- **Facebook/Instagram/LinkedIn pages**: one Page token per Page. A different
  Page per app → different `FB_PAGE_ID` / `FB_PAGE_TOKEN` / `IG_USER_ID` in
  that repo (kit apps: `apps/<repo>/app.env`).
