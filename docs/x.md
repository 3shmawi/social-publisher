# X (Twitter)

Posts each update on X: the main-language text fitted to 280 characters
(X counts every link as 23), with the link and two hashtags.

← [All docs](README.md) · [README](../README.md)

X is **opt-in**: add `x` to the `platforms` input.

> **X charges for every API call** (pay-per-use since February 2026). A
> post *with a link* costs much more than one without (around $0.20 vs
> $0.015 at the time of writing — check the X Developer Console for
> today's prices). Set `x_links: false` to post without the link. The
> credentials check also makes one paid read per run. No media is
> uploaded: X bills each upload like another post.

## 1. A developer app
[developer.x.com](https://developer.x.com) → Developer Console → create a
project and an app. Add credit (pay-per-use) and set a spending limit.

## 2. Read and write
App → **User authentication settings → Set up**: App permissions **Read
and write**, type *Web App, Automated App or Bot*, callback
`https://3shmawi.github.io/social-publisher/oauth/callback.html`, website
your app's site. Save.

## 3. Keys and tokens
App → **Keys and tokens**:
- **API Key and Secret** → `X_API_KEY`, `X_API_SECRET`
- **Access Token and Secret** (generate *after* step 2, so they can write)
  → `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`

They're for the account that created the app; to post as another account,
use a separate app on that account.

## 4. Add the secrets
```bash
for s in X_API_KEY X_API_SECRET X_ACCESS_TOKEN X_ACCESS_SECRET; do gh secret set "$s" --repo <you>/<app>; done
```
Pass them in `social.yml`, add `x` to `platforms` (and `x_links: false`
if you want), dry run: the review page shows the post and its X length.

## Troubleshooting
| Message | Fix |
|---|---|
| `the keys were refused` | Regenerate the access token and secret (step 3) |
| `not allowed … Read and write` | Step 2, then regenerate the access token |
| `no API credit left` | Add credit in the Developer Console |
