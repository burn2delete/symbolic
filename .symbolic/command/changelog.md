---
description: Build or refresh the upcoming changelog from merged PRs
---

Go through each PR merged since the last tag.

For each PR, spawn a subagent to summarize what the PR was about. Focus on user-facing changes. If it was entirely internal, code-only, or docs-only, ignore it. Each subagent should append its summary to `UPCOMING_CHANGELOG.md`.

Once that is done, read `UPCOMING_CHANGELOG.md` and group it into sections for readability. Preserve all PR references.
