# 02: Board drag is one staged, cancel-safe interaction

**What to build:** Collapse the board's two pointer drag systems into one, make
every drag/keyboard status change staged behind the existing confirmation
dialog, guarantee that Cancel is a no-op, keep dragged cards fully visible, and
always reset drag state.

**Blocked by:** —

**Status:** ready-for-agent

## Context

- Two independent systems are wired to the same cards: native HTML5
  `useDragDrop` (`client/src/pages/tasks/hooks/useDragDrop.ts:37-138`) and custom
  `useBoardDrag` / `useBoardDragWiring` (`useBoardDrag.ts:73-182`,
  `useBoardDragWiring.ts:30-52`).
- The duplicate drop dispatch is the cancel bug:
  `KanbanBoard.tsx:140` opens the confirmation, `:141` immediately calls
  `useBoardDrag.onDrop` → `updateTaskStatus` + `fetchTasks`.
- Keyboard arrow moves execute immediately (`useBoardDrag.ts:121-162`); Escape
  only clears state.
- `confirmDone` resolves only in the confirm callback, so cancelling leaves the
  promise pending (`useBoardDragWiring.ts:40-51`; `useConfirmDialog.ts:12-44` has
  no cancel hook).
- `useBoardDrag` has no `dragEnd` wiring, so an aborted/outside drop leaves
  `draggingId` and `aria-grabbed` set.
- The board dimming rule is already gone from source and covered by
  `boardDragVisibility.test.tsx`; it survives only in the stale Sep 8 desktop
  bundle. The remaining dimming rule is `.backlog-card-dragging { opacity: .4 }`
  (`BacklogTab.module.css:31`).

## Acceptance criteria

- [ ] Exactly one pointer drop handler exists on the board. `useDragDrop` owns
      pointer drag; `useBoardDrag` is reduced to keyboard navigation and
      announcements.
- [ ] A drop or keyboard move opens one confirmation dialog naming the ticket and
      target status; no state mutation, PATCH or refetch occurs before accept.
- [ ] Accept performs one optimistic update and one PATCH, rolling back on
      server error.
- [ ] Cancel performs zero mutations, zero requests and zero refetches, from
      pointer, keyboard and the done-advisory path.
- [ ] No card changes opacity or visibility while dragging — board or backlog.
      Replace the backlog dim with a placeholder/outline. Dragged card stays
      fully readable.
- [ ] `dragEnd`, outside drop and Escape all clear drag state, `aria-grabbed` and
      the drop indicator.
- [ ] The target-column seam is ready for issue 04 to disable illegal/WIP-full
      targets; until then all active columns are legal.
- [ ] Regression tests fail on the current code: one PATCH on accept, zero on
      cancel, no double dispatch, state reset after aborted drag, no opacity rule.

## Notes

- Reuse `ConfirmDialog` and `useConfirmDialog`; add an explicit `onCancel` hook
  rather than resolving promises from the confirm callback.
- Do not add a DnD library. Touch long-press and within-column reordering are
  follow-ups.
- The backlog has a third drag system (`useBacklogReorder`) used for ranking;
  leave its behaviour intact apart from the opacity rule.
- Desktop verification requires the rebuilt bundle — see issue 04/rollout.

## Comments

**2026-10-27 — specced**

Root cause (double dispatch) confirmed by exploration. Awaiting spec sign-off.
