# 22: Realtime field deltas

**What to build:** Two people looking at the same backlog or board see each other's changes arrive live. Changes travel as field-level deltas, so simultaneous edits to different fields both survive, and a card visibly indicates who changed it just now.

**Blocked by:** 03, 05

**Status:** ready-for-agent

- [ ] A change made by one user appears for another without a refresh
- [ ] Deltas carry only changed fields, the actor and a timestamp — never the whole object
- [ ] Simultaneous edits to different fields both persist
- [ ] The same field edited twice resolves to the later write, deterministically
- [ ] The affected card shows a non-blocking indication of who changed it
- [ ] An optimistic local change reconciles with the broadcast without visible flicker
- [ ] The delta payload is validated by a contract test
