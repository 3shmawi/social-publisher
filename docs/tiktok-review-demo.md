# TikTok app review: demo video

TikTok's review asks for a screen recording of the whole flow, made in the
**sandbox**, showing every product and scope you ask for: Login Kit
(`user.info.basic`) and Content Posting API (`video.upload`). About 3–5
minutes, one take is fine, no voice needed (captions or on-screen text help).
Record on your Mac with **⇧⌘5 → Record entire screen**, and your phone with
its own screen recorder (or QuickTime → *New Movie Recording* → the iPhone).

**Never show a token or the Client secret.** The commands below keep them in
a file and the environment; close other terminals and hide shared.env.

## Before recording

```bash
cd social-publisher && git pull && npm ci
export TIKTOK_CLIENT_KEY=<sandbox client key>       # from shared.env, not typed on camera
export TIKTOK_CLIENT_SECRET=<sandbox client secret>
clear
```

- Sign out of TikTok in the browser, so the sign-in shows.
- Have a short vertical test video ready, e.g. `~/Desktop/demo.mp4` (an app
  release video or any 9:16 clip, 5–60 s).
- Browser at 100% zoom, notifications off (Do Not Disturb).

## Shot list

| # | Show | On screen |
|---|---|---|
| 1 | The tool and what it does | The repo's README top (or `https://3shmawi.github.io/social-publisher/`): "posts app updates; TikTok gets the video as a draft in your inbox". |
| 2 | The privacy policy and terms | `…/privacy.html` (scroll to the TikTok part), `…/terms.html`. |
| 3 | **Login Kit** starts | Terminal: `TIKTOK_TOKEN_FILE=~/.tiktok-token npx tsx scripts/get-tiktok-token.ts` → press Enter for the key/secret prompts if they're already exported, open the printed link. |
| 4 | TikTok sign-in and **consent screen** | Log in with the sandbox target account; the consent page lists "Read your profile info" and "Upload content to TikTok" → **Authorize**. Pause 2 s on the permissions. |
| 5 | The redirect | The callback page shows the one-time code → **Copy** → paste in the terminal. |
| 6 | **`user.info.basic` in use** | Terminal prints `Connected TikTok account: <display name>` and the granted scopes, and "Saved … to ~/.tiktok-token" (no token shown). |
| 7 | **`video.upload` in use** | `npx tsx scripts/tiktok-try.ts ~/Desktop/demo.mp4` → it prints the steps and "In your TikTok inbox as a draft…". |
| 8 | The result in TikTok | Phone: TikTok → **Inbox** → the "your video is ready to edit/post" notification → open it → the draft is in the editor. Add a sound and the caption. In the sandbox you can stop here, or post it as private. |
| 9 | How it runs for real | GitHub → an app repo → Actions → **Social posts** run → *Approve posts* (environment `social`) → the **TikTok** job → the summary line "In your TikTok inbox as a draft" with the suggested caption. A dry-run screenshot is fine if no release is due. |

Trim the waiting parts; keep each scope's moment visible for a few seconds.

## In the review form

- **Products / scopes:** Login Kit (`user.info.basic`), Content Posting API
  (`video.upload`). Direct Post: not used.
- **Why `user.info.basic`:** show which TikTok account is connected, so the
  owner can check uploads go to the right account.
- **Why `video.upload`:** send the release video of our own apps to our own
  TikTok account's inbox as a draft; we review, add a sound and post it in
  the TikTok app. Nothing is posted automatically.
- **Who uses it:** only the app developer (one TikTok account, our own
  content). No other TikTok users sign in.
- **Data:** the refresh token is kept as an encrypted GitHub Actions secret;
  no TikTok user data is stored. Privacy policy: `…/privacy.html`.

After approval: run step 3 of [tiktok.md](tiktok.md) again with the **production**
Client key and secret and store those secrets (the sandbox ones stop being
used).
