# Troubleshooting

Error messages from the jobs and what to do.

← [All docs](README.md) · [README](../README.md)

| Message | Fix |
|---|---|
| `FB_PAGE_TOKEN is expired or was revoked` | [Facebook](facebook.md) steps 3–4 again |
| `LinkedIn: the access token has expired` | [LinkedIn](linkedin.md) step 5 again, or set up the refresh token |
| `LINKEDIN_REFRESH_TOKEN was rejected` | It lasts ~1 year: [LinkedIn](linkedin.md) step 5 again |
| `not allowed … needs w_organization_social` | Community Management API not approved yet, or you're not a page admin |
| `YT_REFRESH_TOKEN was rejected (invalid_grant)` | Consent screen still in Testing (7-day tokens): [YouTube](youtube.md) step 4, then 5 |
| `The "social" environment has no required reviewers` | [App repo setup](app-repo.md#3-the-approval-environment) |
| `GitHub create ref …: HTTP 403` | The caller job needs `permissions: contents: write` |
| YouTube video is private | Expected until the audit passes ([YouTube](youtube.md) step 6) |
| `Instagram: the token lacks a permission` | [Instagram](instagram.md) step 2: a Page token with `instagram_basic` and `instagram_content_publish` |
| `Instagram couldn't process the video` | Re-encode: MP4, H.264 + AAC, 9:16, 3 s to 15 min |
| `TIKTOK_REFRESH_TOKEN was rejected` | A run couldn't save the rotated token, or it's older than ~180 days: [TikTok](tiktok.md) step 3 again, then set the secret |
| `Couldn't save TIKTOK_REFRESH_TOKEN in …` | `SOCIAL_SECRETS_TOKEN` expired or lacks *Secrets: Read and write* on that repo; fix it **before the next run**, then [TikTok](tiktok.md) step 3 |
| TikTok: `not configured: missing secrets SOCIAL_SECRETS_TOKEN` | [TikTok](tiktok.md) step 4 |
| `Unrecognized named-value: 'runner'` when starting the workflow | You pinned v1.3.0 or v1.4.0; pin v1.4.1 or later |
| `Instagram upload: HTTP 400 … ProcessingFailedError` | Meta refused the direct upload: keep the repo public and attach the video to the release (v1.4.2+ uses the public URL) |
| Run skipped: "nothing changes for app users" | Claude judged the release internal-only; add release notes describing the user-facing change, or run another tag |
| LinkedIn post has no video | Pin v1.5.0 or later; the update needs a video |
