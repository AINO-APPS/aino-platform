# 08: Ranked backlog reorder

**What to build:** The backlog can be reordered by dragging a row, on mouse, touch and keyboard. The server computes the new order value from the intended neighbours, so two people dragging at once cannot corrupt the sequence and a client can never invent a position.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Dragging a row persists the new order and survives reload
- [ ] The order endpoint accepts intended neighbours and returns the computed value
- [ ] Two concurrent drags leave a consistent total order with no duplicates
- [ ] Keyboard reordering works: lift, move, drop, with the result announced
- [ ] Touch dragging works on a touchscreen device
- [ ] Manual order is preserved when a temporary sort is applied and cleared
