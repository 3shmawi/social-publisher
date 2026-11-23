# Bluesky

Posts each update on your Bluesky account: the main-language text fitted to
300 characters, with the link and hashtags clickable, and the release image
(with alt text) or a link card to your website.

← [All docs](README.md) · [README](../README.md)

Bluesky is **opt-in**: add `bluesky` to the `platforms` input. No app
review, no developer account.

## 1. An app password
Bluesky → **Settings → Privacy and security → App passwords → Add App
Password**. Name it `social-publisher`; leave "Allow access to your direct
messages" off. Copy it (`xxxx-xxxx-xxxx-xxxx`) — it's shown once. Never use
your account password: an app password can be revoked on its own.

## 2. Add the secrets
| Secret | Value |
|---|---|
| `BLUESKY_HANDLE` | your handle, e.g. `cafemenu.bsky.social` or your domain |
| `BLUESKY_APP_PASSWORD` | the app password from step 1 |

```bash
gh secret set BLUESKY_HANDLE --repo <you>/<app>
gh secret set BLUESKY_APP_PASSWORD --repo <you>/<app>
```
Pass them in the app's `social.yml`, add `bluesky` to `platforms`, and run
a dry run: the review page shows the post and its length (`n/300`).

A self-hosted PDS: set the `BLUESKY_SERVICE` environment variable on the
job (default `https://bsky.social`).

## Limits
- 300 characters (graphemes), one language. Images up to 1 MB (a bigger
  image is replaced by the link card). No video yet.

## Troubleshooting
| Message | Fix |
|---|---|
| `the handle or app password was refused` | Check `BLUESKY_HANDLE` (no `@`); make a new app password |
| `rate limit` | Re-run the Bluesky job later |
