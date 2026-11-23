# Threads

Posts each update on your Threads account: the release video when it has a
public URL (a release asset in a public repo), otherwise a text post. One
language (the first in `languages`), fitted to Threads' 500 characters,
with the main link and a hashtag.

← [All docs](README.md) · [README](../README.md)

Threads is **opt-in**: add `threads` to the `platforms` input.

## 1. A Meta app with the Threads use case
1. [developers.facebook.com/apps](https://developers.facebook.com/apps) →
   **Create app** → use case **Access the Threads API**. (A separate app
   from the Facebook/Instagram one is fine; Threads has its own app ID.)
2. Use cases → Access the Threads API → **Customize** → Permissions: add
   `threads_basic`, `threads_content_publish` and `threads_manage_insights`
   (the 7-day insights report reads views and likes).
3. Settings → **Redirect callback URLs**:
   `https://3shmawi.github.io/social-publisher/oauth/callback.html`. Also
   fill the uninstall and delete callback URLs with
   `https://3shmawi.github.io/social-publisher/privacy.html#deletion`.
4. App roles → Roles → add the Threads account that will post as a
   **Threads Tester**, and accept the invite in the Threads app
   (Settings → Account → Website permissions → Invites). Until the app is
   published (App Review), only testers can connect.

## 2. Get the token
```bash
npx tsx scripts/get-threads-token.ts
```
Paste the app ID and secret (Use cases → Access the Threads API →
Settings), open the link, allow access, paste the code the callback page
shows. It prints:

| Secret | Value |
|---|---|
| `THREADS_USER_ID` | the account's Threads user id |
| `THREADS_TOKEN` | a long-lived token, valid **60 days** |

## 3. Keep it alive
The token lasts 60 days and can be refreshed while it's still valid. The
weekly credential check (`examples/social-health.yml`, [reference](reference.md#weekly-credential-check))
refreshes it and saves the new one in each app repo with
`SOCIAL_SECRETS_TOKEN` (the same fine-grained token TikTok uses). Without
the weekly check, run step 2 again before the 60 days are up.

## 4. Add the secrets
```bash
gh secret set THREADS_USER_ID --repo <you>/<app>
gh secret set THREADS_TOKEN --repo <you>/<app>
```
Pass them in the app's `.github/workflows/social.yml` (`secrets:`), add
`threads` to `platforms`, and run a dry run: the review page shows the
Threads post and its length.

## Limits
- 500 characters (emoji are counted by size, to be safe); 250 posts per
  24 hours per account.
- Video: MP4/MOV, public URL, up to 5 minutes. Threads downloads it itself,
  so a private repo's release video can't be used: the post is text then.

## Troubleshooting
| Message | Fix |
|---|---|
| `THREADS_TOKEN is expired or was revoked` | Step 2 again; turn on the weekly check |
| `the token lacks a permission` | Step 1.2, then step 2 again |
| `Threads couldn't process the video` | Re-encode: H.264 + AAC MP4, ≤ 5 min |
