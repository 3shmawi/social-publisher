# social-publisher

Announces each app update on **LinkedIn**, a **Facebook Page**, **Instagram**
(as a Reel), **YouTube** and **TikTok** (as a draft in your TikTok inbox),
from GitHub Actions. A version is written for each platform (in English,
Arabic or both), you review and approve it in the Actions UI, then it posts.
The posts are written by Claude on your **Claude Pro/Max plan** (no API
credit needed) or, with no Claude token, by fixed **templates** (no AI);
see [Who writes the posts](docs/claude.md).

- Runs when you publish a GitHub Release or push a version tag, every two weeks on a schedule, or by hand.
- **Dry run by default**: generates the posts and shows them, publishes nothing.
- **Approval gate**: live runs wait for you in the `social` environment.
- **Never posts twice**: each platform tags `social/posted/<release>/<platform>` after posting.
- **One platform failing doesn't stop the others**; the summary lists every result with links.
- Tokens live only in GitHub secrets and are never printed.

```
generate ─► approve ─┬─► facebook ─┐
                     ├─► instagram┤
                     ├─► linkedin ─┤
                     ├─► youtube  ─┼─► summary
                     └─► tiktok   ─┘
```

| Job | What it does |
|---|---|
| **Generate posts** | Works out what to post about (the release notes, or the commits and merged PRs since the last post), skips internal-only updates (chore, ci, refactor, ...), writes the posts (Claude or templates), finds the video, checks every platform's credentials. Its job summary is your review page; the posts are also saved as the `social-posts` artifact. |
| **Approve posts** | Waits for a required reviewer of the `social` environment. Skipped in dry runs. |
| **Facebook / Instagram / LinkedIn / YouTube / TikTok** | Publish, each on its own, after approval. TikTok puts the video in your TikTok inbox; you add a sound and post it in the app. |
| **Summary** | One table: what posted, what failed and why, links to the posts. |

## Set it up

Step-by-step guides are in [`docs/`](docs/README.md), one per platform. Each
ends with the secrets it gives you; a platform you skip is simply skipped.

| Step | Guide | Secrets |
|---|---|---|
| 0 | [Who writes the posts](docs/claude.md) (Claude on your plan, or templates) | `CLAUDE_CODE_OAUTH_TOKEN` (optional) |
| 1 | [Facebook Page](docs/facebook.md) | `FB_PAGE_ID`, `FB_PAGE_TOKEN` |
| 2 | [Instagram](docs/instagram.md) (same Meta app) | `IG_USER_ID` |
| 3 | [LinkedIn](docs/linkedin.md) | `LINKEDIN_TOKEN`, `LINKEDIN_AUTHOR_URN`, `LINKEDIN_ORG_URN`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REFRESH_TOKEN` |
| 4 | [YouTube](docs/youtube.md) | `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` |
| 5 | [TikTok](docs/tiktok.md) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`, `SOCIAL_SECRETS_TOKEN` |
| + | [Threads](docs/threads.md) (opt-in: add `threads` to `platforms`) | `THREADS_USER_ID`, `THREADS_TOKEN` |
| + | [Bluesky](docs/bluesky.md) (opt-in) | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` |
| + | [Telegram](docs/telegram.md) (opt-in) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| + | [X](docs/x.md) (opt-in, paid API) | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` |
| 6 | **[Add it to an app repo](docs/app-repo.md)**: every secret in one table, the `social` approval environment, the caller workflow, variables, dry run and going live | |

**Weekly credential check:** copy [`examples/social-health.yml`](examples/social-health.yml)
too — every Monday it checks each platform's token and opens an issue
before an expired one can break a release ([reference](docs/reference.md#weekly-credential-check)).

**Insights:** [`examples/social-insights.yml`](examples/social-insights.yml)
reports each post's views, likes, comments and shares a week after it went
out ([reference](docs/reference.md#insights)).

Then: [Reference](docs/reference.md) (inputs, behaviour, media, state,
security) · [Troubleshooting](docs/troubleshooting.md).

**Quick start** for an app repo:

1. Set the secrets you have (`gh secret set <NAME> --repo <you>/<app>`).
2. Create the `social` environment with yourself as required reviewer.
3. Copy [`examples/social.yml`](examples/social.yml) to `.github/workflows/social.yml` and pin it to a release.
4. Actions → **Social posts** → Run (dry run) → read the posts and the credentials table.
5. Run without dry run → approve → the posts go out.

**Privacy policy and home page** for the Meta, LinkedIn, Google and TikTok apps:
[3shmawi.github.io/social-publisher/privacy.html](https://3shmawi.github.io/social-publisher/privacy.html)
(published from `site/` by `.github/workflows/pages.yml`).

## Development

```bash
npm ci
npm run check      # typecheck + tests (unit + the whole pipeline against fake APIs)
```

`scripts/` is TypeScript run with `tsx` (no build step) on Node 24 in
Actions. One script per step: `collect` → `generate` → `media` →
`preflight` → `post <platform>` → `summary`; `lib/content.ts` holds the text
rules and is unit-tested.

## License

See [LICENSE.md](LICENSE.md): for flutter-project-kit license holders' apps.
