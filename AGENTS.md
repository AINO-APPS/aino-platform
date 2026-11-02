## Before you build or commit

Read `.github/copilot-instructions.md` for verified build, test and guardrail commands; run `npm run check:guardrails` before committing. Work on a feature branch: pushes to `master` deploy to production.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix (recorded as `Status:` lines). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` (created lazily) and `docs/adr/`. See `docs/agents/domain.md`.
