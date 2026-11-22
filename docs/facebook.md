# Facebook Page

Posts each update on a Facebook Page you manage: a video post when the update has a video, a photo post with an image, otherwise a text post with a link card. Secrets: `FB_PAGE_ID`, `FB_PAGE_TOKEN`.

← [All docs](README.md) · [README](../README.md)

## What you need

- A Facebook **Page** where your account has **Full control** (Meta Business
  Suite → Settings → People).
- A **Meta developer account** ([developers.facebook.com](https://developers.facebook.com)).
- This repo cloned on your computer with `npm ci` (the token helper runs locally).

## Steps

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
   (Page in a **business portfolio**? `me/accounts` is often empty for those.
   Also add `business_management` in step 3; the script then finds the Page
   through your businesses, or asks for the **Page ID**: Page → *About* →
   *Page transparency* → *Page ID*.)
   ```bash
   npx tsx scripts/get-facebook-token.ts
   ```
   It asks for the App ID, App Secret and the token from step 3, and prints
   `FB_PAGE_ID` and `FB_PAGE_TOKEN` for each Page you manage (with
   `expires: never`). You can check any token in the
   [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/).

What gets posted: a video post when the update has a video, a photo post
when it has an image (see [media](reference.md#media)), otherwise a text post with a link card.

## Secrets

| Secret | Value |
|---|---|
| `FB_PAGE_ID` | the Page's numeric ID (printed by the script) |
| `FB_PAGE_TOKEN` | the Page token (printed by the script; `expires: never`) |

The token stops working only if you change your Facebook password, lose your
Page role or remove the app: then repeat steps 3–4. Using Instagram too? Make
the token with the Instagram permissions as well ([Instagram](instagram.md)), then one
token serves both.

## Check it

Run a dry run of the app's **Social posts** workflow: the credentials table
shows `facebook ✅ page "<name>"`.
