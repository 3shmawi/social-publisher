# YouTube

Uploads the release video to your channel (a Short when it's vertical and under 3 minutes). Secrets: `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.

← [All docs](README.md) · [README](../README.md)

## Steps

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

## Secrets

| Secret | Value |
|---|---|
| `YT_CLIENT_ID` | OAuth client ID (Desktop app), step 3 |
| `YT_CLIENT_SECRET` | its client secret, step 3 |
| `YT_REFRESH_TOKEN` | printed by `get-youtube-token.ts`, step 5 |

Inputs: `youtube_privacy` (`private` until audited) and `youtube_audited`.
An update without a video skips YouTube.

## Check it

Dry run: the credentials table shows `youtube ✅` and the privacy it uploads with.
