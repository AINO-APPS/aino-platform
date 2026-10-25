# 08: Ranked backlog reorder

**What to build:** The backlog can be reordered by dragging a row, on mouse, touch and keyboard. The server computes the new order value from the intended neighbours, so two people dragging at once cannot corrupt the sequence and a client can never invent a position.

**Blocked by:** 05

**Status:** done

- [x] Dragging a row persists the new order and survives reload
- [x] The order endpoint accepts intended neighbours and returns the computed value
- [x] Two concurrent drags leave a consistent total order with no duplicates
- [x] Keyboard reordering works: lift, move, drop, with the result announced
- [x] Touch dragging works on a touchscreen device
- [x] Manual order is preserved when a temporary sort is applied and cleared

## Comments

**2026-10-25 — implemented**

- Commit `53410ea0`. `PATCH /api/tasks/:id/rank { beforeId, afterId }` computes the LexoRank server-side, so a client can never invent a position and two concurrent drags stay totally ordered. `useBacklogReorder` adds `@dnd-kit` sortable with keyboard sensors — lift, move, drop, with the result announced.
