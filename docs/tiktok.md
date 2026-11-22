# TikTok

Sends the release video to your TikTok **inbox as a draft**; you add a sound and the caption in TikTok and post it. Secrets: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`, `SOCIAL_SECRETS_TOKEN`.

← [All docs](README.md) · [README](../README.md)

## How it works

The video goes to your **TikTok inbox as a draft** (Content Posting API,
"upload" flow, scope `video.upload`). TikTok sends you a notification; open
it, add a sound and the caption (the run's summary shows a suggested one),
and post. There's no caption field in this flow, and nothing is ever posted
publicly without you. An update without a video is skipped.

## Steps

1. **Create the app.** [developers.tiktok.com](https://developers.tiktok.com)
   → *Manage apps* → *Connect an app* (owner: you or your organization).
   - *Basic information*: icon, name, category, description, **Terms of
     Service** and **Privacy Policy** URLs (`…/social-publisher/terms.html`,
     `…/privacy.html`), platform **Web**, website `https://3shmawi.github.io/social-publisher/`
     (TikTok asks you to verify it: the verification file is in `site/`).
   - *Products*: add **Login Kit** and **Content Posting API**. Leave *Direct
     Post* off (this tool doesn't use it).
   - *Scopes*: **`user.info.basic`** and **`video.upload`** only.
   - *Login Kit → Redirect URI* (Web): `https://3shmawi.github.io/social-publisher/oauth/callback.html`
2. **Sandbox first.** *Sandbox* → *Create sandbox* → *Target users* → add the
   TikTok account you post from. The sandbox has its own **Client key** and
   **Client secret**; it works for those accounts only, before the review.
3. **Get the refresh token** (on your computer):
   ```bash
   TIKTOK_TOKEN_FILE=~/.tiktok-token npx tsx scripts/get-tiktok-token.ts
   ```
   It asks for the Client key and secret, opens TikTok's sign-in, and the
   callback page shows a code to paste back. The token is saved to the file
   (not printed). Try an upload:
   ```bash
   TIKTOK_CLIENT_KEY=… TIKTOK_CLIENT_SECRET=… TIKTOK_TOKEN_FILE=~/.tiktok-token \
     npx tsx scripts/tiktok-try.ts some-video.mp4
   ```
4. **Token rotation (important).** TikTok replaces the refresh token **every
   time it's used** (each lasts ~180 days) and the old one stops working.
   So the TikTok job saves the new token back into the app repo's
   `TIKTOK_REFRESH_TOKEN` secret after every run. That needs one more secret,
   **`SOCIAL_SECRETS_TOKEN`**: GitHub → *Settings → Developer settings →
   Fine-grained tokens → Generate*: repository access **only** your app repos,
   permission **Secrets: Read and write** (nothing else), the longest expiry
   you're comfortable with. Without it the TikTok job is skipped, so a
   rotated token is never lost.
   - Several app repos share the TikTok account? Each one's run rotates the
     token, so pass them all in `tiktok_token_repos` (e.g. `me/app1,me/app2`)
     and the token is saved to every one, and give the PAT access to all of them.
   - Kit users: after the first `tool/setup_secrets.sh`, **delete
     `TIKTOK_REFRESH_TOKEN` from `~/.app-secrets/shared.env`**. The workflow
     owns it from then on; running the script again would put back a dead
     token.
5. **The review.** *App review* → submit with the production keys. TikTok
   wants a **demo video** of the whole flow in the sandbox: see
   [tiktok-review-demo.md](tiktok-review-demo.md) for the shot list.
   After approval, sign in again with the **production** Client key and
   secret (step 3) and store those.

Limits: about 5 pending inbox uploads per 24 hours per account, which is far
more than one release.

## Secrets

| Secret | Value |
|---|---|
| `TIKTOK_CLIENT_KEY` | the app's Client key (the Sandbox's until the review passes) |
| `TIKTOK_CLIENT_SECRET` | its Client secret |
| `TIKTOK_REFRESH_TOKEN` | from `get-tiktok-token.ts` (the file in `TIKTOK_TOKEN_FILE`); set once, then the workflow replaces it after every run |
| `SOCIAL_SECRETS_TOKEN` | fine-grained GitHub token: your app repos only, **Secrets: Read and write**; lets the workflow save the rotated token |

Input: `tiktok_token_repos` (all repos sharing the TikTok account).

## Check it

Dry run: `tiktok ✅ set; checked when posting` (the token can't be checked
without rotating it). After a live run: the job summary says "In your TikTok
inbox as a draft", and TikTok shows a notification.
