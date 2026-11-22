# LinkedIn

Posts on your LinkedIn profile, your company page, or both, with the release video attached when there is one. Secrets: `LINKEDIN_TOKEN`, `LINKEDIN_AUTHOR_URN` and/or `LINKEDIN_ORG_URN`; optional `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REFRESH_TOKEN`.

← [All docs](README.md) · [README](../README.md)

## Who posts

`linkedin_as` chooses the author: `person` (you, scope `w_member_social`),
`organization` (a company page, scope `w_organization_social`) or `both`.
With `both`, a repo without `LINKEDIN_ORG_URN` posts as you only.

## Steps

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

## Video

With a video (up to 500 MB, MP4, 3 s to 30 min) the job uploads it through
the Videos API for each author (initializeUpload → 4 MB parts →
finalizeUpload → wait until AVAILABLE) and attaches it to the post. It needs
no extra scope: `w_member_social` / `w_organization_social` cover it.

## Secrets

| Secret | Required | Value |
|---|---|---|
| `LINKEDIN_TOKEN` | yes (unless a refresh token is set) | access token from step 5 (~60 days) |
| `LINKEDIN_AUTHOR_URN` | to post as you | `urn:li:person:…` from step 5 |
| `LINKEDIN_ORG_URN` | to post as a page | `urn:li:organization:…` from step 6 |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | recommended | step 3; enables the expiry check and refresh |
| `LINKEDIN_REFRESH_TOKEN` | optional | step 5, Community Management API apps only (~1 year) |

## Check it

Dry run: `linkedin ✅ urn:li:person:…; token valid for N more days`.
