# 15: Carryover pre-flight and sprint freeze

**What to build:** Completing a sprint shows what will happen before it happens: which unfinished tasks move, where to, and which are dropped. The default target is the next planned sprint, otherwise the backlog. Finished work always stays with the sprint it finished in. A completed sprint then stops accepting task changes.

**Blocked by:** 12

**Status:** done

- [x] Completing a sprint presents a summary of what moves and what is dropped before committing
- [x] The default target is the next planned sprint, else the backlog, and can be overridden
- [x] Finished work stays with the completed sprint and is never carried
- [x] A completed sprint rejects task edits, moves and re-opening
- [x] The retrospective remains writable for a completed sprint
- [x] Paused sprints are presented and counted as active everywhere

## Comments

**2026-10-25 — implemented**

- Commit `ecb5da90`. `SprintCompletionDialog` presents the carryover pre-flight before committing: the target (next planned, else backlog, overridable), what moves and what is dropped. Finished work stays with the closed sprint and is never carried. A completed sprint rejects task edits, moves and reopening while the retrospective stays writable, and paused sprints are counted as active everywhere.
