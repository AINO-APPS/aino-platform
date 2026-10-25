# 26: Android feature port

**What to build:** The native Android Tasks area reaches feature parity with web: completed section and shared preference, ranked reorder, board and plan, schedule calendar with tray and overlays, card density, bulk actions, undo, canonical keys, time tracking, command entry, and live field deltas. Nothing is removed from the existing implementation.

**Blocked by:** 05, 07, 08, 12, 18, 21, 24

**Status:** ready-for-agent

- [ ] Every feature in the parity matrix marked for Android is available
- [ ] Completed tasks leave the open backlog on Android, matching web
- [ ] The show-completed and density preferences agree between Android and web for the same user
- [ ] Live field deltas apply without a refresh
- [ ] The native implementation is retained, not replaced by a webview
- [ ] Agile configuration remains read-only, deep-linking to web where an editor would be
