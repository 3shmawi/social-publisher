# Who writes the posts

Claude on your Claude Pro/Max plan, the Claude API, or fixed templates (no AI). Secrets: `CLAUDE_CODE_OAUTH_TOKEN` (recommended) or `ANTHROPIC_API_KEY`; neither is required.

← [All docs](README.md) · [README](../README.md)

`writer: auto` (the default) picks the first that is set up:

| Writer | Needs | What you get |
|---|---|---|
| **Claude Code on your Claude plan** | secret `CLAUDE_CODE_OAUTH_TOKEN` | Claude (`claude-sonnet-5-5`) decides whether the update is worth posting and writes each platform and language natively. Uses your Pro/Max plan's usage; no API credit. |
| **Claude API** | secret `ANTHROPIC_API_KEY` | The same, billed to API credit (about $0.04 a run). |
| **Templates (no AI)** | nothing | Fixed English and Arabic templates filled with the "What's new" items. |

**Claude plan token (recommended).** On your computer, with
[Claude Code](https://code.claude.com/docs/en/setup) installed and signed in to
your Pro or Max account:

```bash
claude setup-token
```

It prints a token that lasts **one year**; store it as the
`CLAUDE_CODE_OAUTH_TOKEN` secret. Each run makes one short request through
Claude Code (pinned version, no tools) and counts toward your plan's usage
limits like any other Claude Code use. The token is tied to your own
subscription: use it for your own repos, and use an API key for anything
shared with other people ([Anthropic's terms for subscription sign-in](https://code.claude.com/docs/en/legal-and-compliance)).
When it expires, the job says so; run `claude setup-token` again.

**Templates.** The "what's new" items come, per language, from the app's
store text at the release commit (`store/android/<lang>/changelogs/default.txt`
or `store/ios/<locale>/release_notes.txt`, as in flutter-project-kit apps),
else (English only) from the release-note bullets or `feat`/`fix`/`perf`
commits. A language with no items is left out, since templates don't
translate. Add hashtags with the `hashtags` input. Templates can't judge
whether a change matters to users: only the commit types and `[skip social]`
decide.

## Secrets

| Secret | Required | Where it comes from |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | no (recommended) | `claude setup-token` on your computer; valid one year |
| `ANTHROPIC_API_KEY` | no | [console.anthropic.com](https://console.anthropic.com) → API keys (needs API credit) |

Neither set → templates. Force one with the `writer` input
(`auto`, `claude-code`, `api`, `template`).
