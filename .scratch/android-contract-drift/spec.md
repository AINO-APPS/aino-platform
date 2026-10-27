
# Android contract drift

Platform-side changes required for the Android app to agree with the server.

Audit and client-side plan live in `aino-android/.scratch/android-backend-drift/`.

## Tickets

| # | Title | Status |
|---|---|---|
| 05 | Regenerate contracts and make the validator catch unregistered routes | ready-for-agent |
| 06 | Let the native app read agile config | ready-for-human |
| 07 | Machine-readable failures — bulk codes and transfer deltas | ready-for-agent |
| 08 | Re-audit after the uncommitted lifecycle work lands | needs-info |

Numbering starts at 05 because 01–04 of this effort are recorded in
[`plan-jira-parity`](../plan-jira-parity/issues/) — `01-first-load-safe-render`,
`02-board-drag-correctness`, `03-team-ticket-visibility`, `04-workflow-transition-lifecycle`.
Those are the commits this drift was audited against.

## Ordering

05 is a prerequisite for the Android R2 release: shipping client fixes compiled against a spec
that is known-wrong is building against a fiction.

06 unblocks the Android board rendering the tenant's real workflow, which is currently not the
case at all.

08 gates any re-audit claim; do not report these findings as final until it closes.
