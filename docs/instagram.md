# Instagram

Publishes the release video as a **Reel** on the Instagram professional account linked to your Facebook Page. Uses the same Meta app and Page token as [Facebook](facebook.md). Secrets: `IG_USER_ID`, `FB_PAGE_TOKEN` (with Instagram permissions).

← [All docs](README.md) · [README](../README.md)

## How it works

The caption is the Facebook text and hashtags (links can't be clicked in
captions but stay copyable). An update without a video is
skipped: Instagram can only take images from a public URL. In a **public**
repo, Instagram downloads the video from the release asset (or
`marketing/videos/<tag>.mp4`) itself; in a private repo the job uploads the
file, which Meta may refuse with a Page token (`ProcessingFailedError`).

In practice (tested 2026-11-22): with a Page token Meta **refused the direct upload** (`ProcessingFailedError`), and the public-URL path works. So keep the app repo **public** and attach the video to the GitHub Release (or commit it as `marketing/videos/<tag>.mp4`).

## Steps

1. **Link the accounts.** The Instagram account must be **professional**
   (Business or Creator: Instagram → Settings → Account type and tools) and
   **linked to the Facebook Page** (Meta Business Suite → Settings →
   Instagram accounts, or Page → Settings → Linked accounts).
2. **Add the permissions.** Redo [Facebook step 3](facebook.md#steps) with two more permissions:
   `instagram_basic` and `instagram_content_publish`, and run
   `scripts/get-facebook-token.ts` again. It prints a new `FB_PAGE_TOKEN`
   (replace the old one; it still works for Facebook) and **`IG_USER_ID`**
   (17841…). As with Facebook, your own accounts need no App Review. If the
   Explorer doesn't offer the two permissions, add the Instagram use case
   to the app first (Meta app → *Use cases* → *Add use case*).
3. Set `IG_USER_ID` and the new `FB_PAGE_TOKEN` as secrets.

Limits: 100 API posts per 24 hours; captions up to 2,200 characters and 30
hashtags; Reels 3 s to 15 min, MP4/MOV (H.264 or HEVC, AAC), up to 300 MB,
9:16 recommended.

## Secrets

| Secret | Value |
|---|---|
| `IG_USER_ID` | the Instagram account ID, `17841…` (printed by `get-facebook-token.ts`) |
| `FB_PAGE_TOKEN` | the Page token made **with** `instagram_basic` + `instagram_content_publish` (replaces the Facebook-only one) |

Can't see `IG_USER_ID` in the script output? In the Graph API Explorer, query
`<FB_PAGE_ID>?fields=instagram_business_account` with the Page token.

## Check it

Dry run: the credentials table shows `instagram ✅ account @<username>`.
