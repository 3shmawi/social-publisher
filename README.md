# social-publisher

Announces each app update on **LinkedIn**, a **Facebook Page** and **YouTube**,
from GitHub Actions. A version is written for each platform (in English,
Arabic or both), you review and approve it in the Actions UI, then it posts.
The posts are written by Claude on your **Claude Pro/Max plan** (no API
credit needed) or, with no Claude token, by fixed **templates** (no AI);
see [Who writes the posts](#0-who-writes-the-posts).

- Runs when you publish a GitHub Release or push a version tag, every two weeks on a schedule, or by hand.
- **Dry run by default**: generates the posts and shows them, publishes nothing.
- **Approval gate**: live runs wait for you in the `social` environment.
- **Never posts twice**: each platform tags `social/posted/<release>/<platform>` after posting.
- **One platform failing doesn't stop the others**; the summary lists every result with links.
- Tokens live only in GitHub secrets and are never printed.

```
generate ─► approve ─┬─► facebook ─┐
                     ├─► linkedin ─┼─► summary
                     └─► youtube  ─┘
```

| Job | What it does |
|---|---|
| **Generate posts** | Works out what to post about (the release notes, or the commits and merged PRs since the last post), skips internal-only updates (chore, ci, refactor, ...), writes the posts (Claude or templates), finds the video, checks every platform's credentials. Its job summary is your review page; the posts are also saved as the `social-posts` artifact. |
| **Approve posts** | Waits for a required reviewer of the `social` environment. Skipped in dry runs. |
| **Facebook / LinkedIn / YouTube** | Publish, each on its own, after approval. |
| **Summary** | One table: what posted, what failed and why, links to the posts. |

## Contents

0. [Who writes the posts: your Claude plan, or templates](#0-who-writes-the-posts)
1. [Facebook Page: Meta app and long-lived Page token](#1-facebook-page)
2. [LinkedIn: app, products, token and author URN](#2-linkedin)
3. [YouTube: Google Cloud project, API and refresh token](#3-youtube)
4. [Add it to an app repo: secrets and caller workflow](#4-add-it-to-an-app-repo)
5. [Run a dry run, then go live](#5-dry-run-then-go-live)
6. [Reference: inputs, behaviour, troubleshooting](#reference)

The token helpers in `scripts/` run on your own computer (Node 22+):

```bash
git clone https://github.com/3shmawi/social-publisher && cd social-publisher && npm ci
```

---

## 0. Who writes the posts

`writer: auto` (the default) picks the first that is set up:

| Writer | Needs | What you get |
|---|---|---|
| **Claude Code on your Claude plan** | secret `CLAUDE_CODE_OAUTH_TOKEN` | Claude (`claude-sonnet-5-5`) decides whether the update is worth posting and writes each platform and language natively. Uses your Pro/Max plan's usage; no API credit. |
| **Claude API** | secret `ANTHROPIC_API_KEY` | The same, billed to API credit (about $0.04 a run). |
| **Templates (no AI)** | nothing | Fixed English and Arabic templates filled with the "What's new" items. |

**Claude plan token (recommended).** On your computer, with
[Claude Code](https://code.claude.com/docs/en/setup) installed and signed in to
your Pro or Max account:

```bash
claude setup-token
```

It prints a token that lasts **one year**; store it as the
`CLAUDE_CODE_OAUTH_TOKEN` secret. Each run makes one short request through
Claude Code (pinned version, no tools) and counts toward your plan's usage
limits like any other Claude Code use. The token is tied to your own
subscription: use it for your own repos, and use an API key for anything
shared with other people ([Anthropic's terms for subscription sign-in](https://code.claude.com/docs/en/legal-and-compliance)).
When it expires, the job says so; run `claude setup-token` again.

**Templates.** The "what's new" items come, per language, from the app's
store text at the release commit (`store/android/<lang>/changelogs/default.txt`
or `store/ios/<locale>/release_notes.txt`, as in flutter-project-kit apps),
else (English only) from the release-note bullets or `feat`/`fix`/`perf`
commits. A language with no items is left out, since templates don't
translate. Add hashtags with the `hashtags` input. Templates can't judge
whether a change matters to users: only the commit types and `[skip social]`
decide.

## 1. Facebook Page

You need a Facebook Page you manage. You get a **Page access token that
doesn't expire** (it stops working only if you change your password, lose the
Page role, or remove the app).

1. **Create a Meta app.** [developers.facebook.com/apps](https://developers.facebook.com/apps)
   → *Create app* → use case **Manage everything on your Page** (older UI:
   type *Business*). Connect it to your business portfolio if asked.
2. **Fill in the basics.** *App settings → Basic*: privacy policy URL (your
   app's website has one), category, icon. Note the **App ID** and **App
   Secret**. Switch the app to **Live** (top bar). For posting to Pages you
   manage yourself, Standard Access is enough; no App Review needed. Posts
   made while the app is in *Development* mode may be visible only to people
   with a role on the app.
3. **Get a short-lived User token.** [Graph API Explorer](https://developers.facebook.com/tools/explorer)
   → choose your app → *User Token* → add permissions
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
   → *Generate Access Token* → allow it for your Page.
4. **Exchange it for a Page token that doesn't expire:**
   ```bash
   npx tsx scripts/get-facebook-token.ts
   ```
   It asks for the App ID, App Secret and the token from step 3, and prints
   `FB_PAGE_ID` and `FB_PAGE_TOKEN` for each Page you manage (with
   `expires: never`). You can check any token in the
   [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/).

What gets posted: a video post when the update has a video, a photo post
when it has an image (see [media](#media)), otherwise a text post with a link card.

## 2. LinkedIn

`linkedin_as` chooses the author: `person` (you, scope `w_member_social`),
`organization` (a company page, scope `w_organization_social`) or `both`.
With `both`, a repo without `LINKEDIN_ORG_URN` posts as you only.

1. **Create an app.** [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps)
   → *Create app*. LinkedIn requires a company page to link the app to (your
   own page works). Verify the app from the page (*Settings → Verify*).
2. **Add products** (*Products* tab):
   - **Posting as you only:** *Share on LinkedIn* and *Sign In with LinkedIn
     using OpenID Connect*. Both are self-serve, approved at once.
   - **Posting as a company page:** request the **Community Management API**.
     It covers both `w_member_social` and `w_organization_social`, and its
     apps get **refresh tokens** (≈1 year), so you never refresh by hand.
     LinkedIn reviews the request (fill in the access form; a few days) and
     may require it to be the only product in the app; if it says so, create
     a second app just for it and use that app's credentials below.
     Until it's approved, use the self-serve products with `linkedin_as: both`:
     it posts as you only.
   You must be an **admin** (or content admin) of the company page.
3. **Allow the redirect URL.** *Auth* tab → *Authorized redirect URLs* → add
   `http://localhost:8585/callback`. Note the **Client ID** and **Client Secret**.
4. **Check the scopes** on the *Auth* tab: `openid profile w_member_social`,
   plus `w_organization_social r_organization_admin` with the Community
   Management API.
5. **Get the token:**
   ```bash
   npx tsx scripts/get-linkedin-token.ts
   ```
   It prints `LINKEDIN_TOKEN` (valid ~60 days), `LINKEDIN_REFRESH_TOKEN`
   (only with the Community Management API) and `LINKEDIN_AUTHOR_URN`
   (`urn:li:person:…`).
6. **Find the company page URN** (`LINKEDIN_ORG_URN`): the script lists the
   pages you administer. Or open the page as admin; the number in
   `linkedin.com/company/12345678/admin/` gives `urn:li:organization:12345678`.

**Token expiry (~60 days).** Store `LINKEDIN_CLIENT_ID` and
`LINKEDIN_CLIENT_SECRET` too: the credentials check then reads the token's
expiry date, warns 10 days ahead and **fails clearly when it has expired**,
telling you to run step 5 again. With `LINKEDIN_REFRESH_TOKEN` as well, every run makes a fresh
access token and the 60-day limit no longer matters (the refresh token lasts
about a year). Without the client ID and secret, an expired token shows up as a clear
"expired, refresh it" failure of the LinkedIn job.

The `LinkedIn-Version` header is `202609` by default; LinkedIn supports each
monthly version for about a year. When it's retired, the LinkedIn job says so; set
the `linkedin_version` input to a recent month (`YYYYMM`).

## 3. YouTube

1. **Create a Google Cloud project.** [console.cloud.google.com](https://console.cloud.google.com/projectcreate)
   → new project (e.g. "social-publisher").
2. **Enable the API.** *APIs & Services → Library* → **YouTube Data API v3** → *Enable*.
3. **OAuth consent screen and client.** *Google Auth Platform* (older UI:
   *APIs & Services → OAuth consent screen*):
   - *Branding*: app name, support email, your website and privacy policy.
   - *Audience*: **External**.
   - *Data access*: add scopes `.../auth/youtube.upload` and `.../auth/youtube.readonly`.
   - *Clients* → *Create client* → type **Desktop app** → note the **Client ID** and **Client secret**.
4. **Publish the app** (*Audience* → *Publish app* → status **In production**).
   This matters: while the status is **Testing**, refresh tokens **expire after 7 days**.
   Google may show "Google hasn't verified this app" when you sign in in the
   next step; as the developer you can continue (*Advanced → Go to …*).
   Verification is only needed if other people will sign in.
5. **Get the refresh token:**
   ```bash
   npx tsx scripts/get-youtube-token.ts
   ```
   Sign in with the Google account that owns the channel (for a Brand
   Account channel, pick the channel when asked). It prints `YT_REFRESH_TOKEN`.
6. **The audit (for public videos).** Videos uploaded through the API by a
   project that hasn't passed YouTube's **API compliance audit** are locked
   to **private**. Until then, the workflow uploads as private and says so
   in the job summary; make each video public in
   [YouTube Studio](https://studio.youtube.com). To lift the lock, apply with the
   [YouTube API Services audit and quota extension form](https://support.google.com/youtube/contact/yt_api_form):
   describe this tool (uploads your own app's release videos to your own
   channel), link your privacy policy, and show the consent screen and a
   sample upload. It usually takes a few weeks. Once approved, set
   `youtube_audited: true` and `youtube_privacy: public` in the caller.

Quota: uploads are the most expensive YouTube API call, but the default daily
quota of 10,000 units leaves room for a few uploads a day.

## 4. Add it to an app repo

### Secrets

GitHub has no account-level secrets on personal accounts (only
organizations share secrets across repos), so set them on each app repo, or
move your apps into a free GitHub organization and set them once as
organization secrets.

| Secret | Needed for | Where it comes from |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude writes the posts (recommended) | `claude setup-token` (section 0) |
| `ANTHROPIC_API_KEY` | only to use the API instead | [console.anthropic.com](https://console.anthropic.com) → API keys (needs API credit) |
| `FB_PAGE_ID` | Facebook | step 1.4 |
| `FB_PAGE_TOKEN` | Facebook | step 1.4 |
| `LINKEDIN_TOKEN` | LinkedIn | step 2.5 |
| `LINKEDIN_AUTHOR_URN` | LinkedIn as you | step 2.5 (`urn:li:person:…`) |
| `LINKEDIN_ORG_URN` | LinkedIn as a page | step 2.6 (`urn:li:organization:…`) |
| `LINKEDIN_CLIENT_ID` | expiry check, refresh | step 2.3 |
| `LINKEDIN_CLIENT_SECRET` | expiry check, refresh | step 2.3 |
| `LINKEDIN_REFRESH_TOKEN` | no manual refresh (optional) | step 2.5, Community Management API only |
| `YT_CLIENT_ID` | YouTube | step 3.3 |
| `YT_CLIENT_SECRET` | YouTube | step 3.3 |
| `YT_REFRESH_TOKEN` | YouTube | step 3.5 |

A platform without its secrets is skipped (shown in the summary), never failed.
Set them from a terminal; values are read from stdin, so they don't end up in your
shell history:

```bash
gh secret set FB_PAGE_TOKEN --repo <you>/<app>
```

Apps made with flutter-project-kit: put the values in `~/.app-secrets/shared.env`
and run `tool/setup_secrets.sh`; it sets all of them on the app repo.

### The workflow

Copy [`examples/social.yml`](examples/social.yml) to `.github/workflows/social.yml`
in the app repo, change the `with:` values, and pin the `uses:` line to the
latest commit of this repo (Dependabot keeps it current):

```yaml
uses: 3shmawi/social-publisher/.github/workflows/publish.yml@<commit sha> # main
```

### The approval environment

App repo → *Settings → Environments → New environment* → name **`social`**
→ *Required reviewers* → add yourself → *Save*. Optionally limit
*Deployment branches and tags* to your default branch and `v*` tags.

Live runs refuse to post if `social` has no required reviewer (GitHub would
otherwise create the environment on the fly, with no rules, and post without
asking). To opt out on purpose, pass `require_approval: false`.

## 5. Dry run, then go live

1. App repo → *Actions* → **Social posts** → *Run workflow* → leave
   **dry_run** ticked → *Run*.
2. Open the run → **Generate posts** → the summary shows every post (LinkedIn,
   Facebook, YouTube title/description/tags, per language), the video it
   found and a credentials table (✅ / ❌ per platform). The same files are in
   the `social-posts` artifact.
3. Happy with it? Run again with **dry_run** unticked. The run stops at
   **Approve posts**: *Review deployments* → tick `social` → *Approve and deploy*.
   Then the platform jobs post and **Summary** lists the links.
4. To let releases and the schedule post on their own (still with your approval),
   set the repo variable **`SOCIAL_LIVE`** to `true` (*Settings → Secrets and
   variables → Actions → Variables*). Until then they're dry runs.

---

## Reference

### Inputs

| Input | Default | |
|---|---|---|
| `app_name` | required | Name as users know it |
| `about` | | One or two sentences about the app and its users; helps the writing |
| `voice` | | Style notes ("casual, no emojis on LinkedIn") |
| `play_store_url`, `app_store_url`, `website_url` | | Added after each post; empty ones are left out |
| `platforms` | `facebook,linkedin,youtube` | Any subset |
| `languages` | `en` | e.g. `en,ar`; the first is the main language |
| `linkedin_as` | `person` | `person`, `organization` or `both` |
| `linkedin_version` | `202609` | `LinkedIn-Version` header |
| `facebook_graph_version` | `v24.0` | Graph API version |
| `youtube_privacy` | `private` | `private`, `unlisted`, `public` |
| `youtube_audited` | `false` | `true` once the YouTube audit has passed |
| `release_tag` | | Empty: the triggering or latest release. `changes`: commits since the last post. Or a tag. |
| `biweekly` | `true` | On schedule runs, skip odd ISO weeks |
| `include_prereleases` | `false` | |
| `dry_run` | `true` | Generate and show only |
| `force` | `false` | Post even if already posted |
| `environment` | `social` | Approval environment |
| `require_approval` | `true` | Refuse to post when the environment has no reviewer |
| `writer` | `auto` | `auto`, `claude-code`, `api` or `template` (section 0) |
| `hashtags` | | Hashtags for template posts, e.g. `Flutter,MobileApps` |
| `model` | `claude-sonnet-5-5` | Claude model (Claude Code and API writers) |

### How it decides what to post

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

### Language and links

Each language gets its own post written natively, not translated. LinkedIn and Facebook get
one post with the languages one after another (separated by `— — —`); YouTube
gets the main language plus a localization per other language, so viewers
see their own language. Store links are added by the script, not by the
model, so they're always exact.

### Media

| | Used for |
|---|---|
| Release asset `*.mp4`, or `marketing/videos/<tag>.mp4` in the app repo | YouTube upload, Facebook video post |
| Release asset `*.png` / `*.jpg`, or `marketing/images/<tag>.png` | Facebook photo post |

No video → YouTube is skipped (not failed). A vertical video under 3 minutes
becomes a YouTube Short.

### State ("don't post twice")

Lightweight tags in the app repo, created through the API (they start no workflows):

- `social/posted/<key>/<channel>`: `<key>` is the release tag or
  `changes-<sha>`, `<channel>` is `facebook`, `linkedin-person`,
  `linkedin-organization` or `youtube`. Present → that channel is skipped.
  Re-running a failed job therefore only retries what failed.
- `social/last-post`: the commit of the last posted update; the schedule
  starts from there.

To post an update again: run with `force: true`, or delete the tag
(`git push origin :refs/tags/social/posted/v1.2.0/facebook`).

### Security

- Secrets reach scripts only through `env:`; tokens made during a run (page,
  access tokens) are masked; nothing logs request headers.
- Before approval, platform secrets are used only for read-only credential
  checks. After approval, each posting job gets only its own platform's secrets.
- Release notes and PR texts are passed to Claude as data inside `<update>`
  tags, and you review the result before anything is posted: a PR author
  can't make it post something you didn't see.
- Actions are pinned to commits; app repos pin this workflow to a commit,
  and the scripts are checked out at that same commit (`job.workflow_sha`).
- No npm cache (cache poisoning on release events); `npm ci` from the lockfile.

### Troubleshooting

| Message | Fix |
|---|---|
| `FB_PAGE_TOKEN is expired or was revoked` | Step 1.3–1.4 again |
| `LinkedIn: the access token has expired` | Step 2.5 again, or set up the refresh token |
| `LINKEDIN_REFRESH_TOKEN was rejected` | It lasts ~1 year: step 2.5 again |
| `not allowed … needs w_organization_social` | Community Management API not approved yet, or you're not a page admin |
| `YT_REFRESH_TOKEN was rejected (invalid_grant)` | Consent screen still in Testing (7-day tokens): step 3.4, then 3.5 |
| `The "social" environment has no required reviewers` | Section 4, approval environment |
| `GitHub create ref …: HTTP 403` | The caller job needs `permissions: contents: write` |
| YouTube video is private | Expected until the audit passes (step 3.6) |

## Development

```bash
npm ci
npm run check      # typecheck + tests (unit + the whole pipeline against fake APIs)
```

`scripts/` is TypeScript run with `tsx` (no build step) on Node 24 in
Actions. One script per step: `collect` → `generate` → `media` →
`preflight` → `post <platform>` → `summary`; `lib/content.ts` holds the text
rules and is unit-tested.
