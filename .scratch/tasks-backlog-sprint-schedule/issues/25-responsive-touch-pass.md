# 25: Responsive and touch pass

**What to build:** Every Tasks surface works well on a phone and a tablet. The board becomes a single-column swipeable view, task detail becomes a bottom sheet, the calendar becomes a scrollable day column with a date strip, and all interactive targets meet the minimum touch size.

**Blocked by:** 12, 18

**Status:** done

- [x] The board is usable single-column with swipe between columns
- [x] Task detail presents as a bottom sheet on phone viewports
- [x] The calendar renders as a scrollable day column with a horizontal date strip
- [x] All interactive targets meet the minimum touch size
- [x] No horizontal scrolling on a 360px-wide viewport
- [x] Dragging works by touch on backlog, board, plan and calendar

## Comments

- `useViewportWidth` exposes the width plus `useIsPhone` (≤640px) and
  `useIsNarrowCalendar` (≤900px), so layout decisions that CSS cannot express
  read one source instead of duplicating media-query numbers.
- The board is one column at a time on a phone, swiped between with
  `useSwipe` (48px threshold, and a mostly-vertical gesture is treated as a
  scroll). A labelled prev/next control gives the same navigation to anyone who
  cannot swipe, and the column name is announced.
- Task detail already presents as a bottom sheet below 640px (ticket 20).
- The calendar drops the month grid below 900px in favour of a horizontal date
  strip plus one scrollable day column, which is readable at 360px where a
  7-column grid is not.
- Every interactive target in the Tasks area is at least 44×44; chips and badges
  are labels rather than targets and keep their compact size.
- `overflow-x: clip` on the page plus `min-width: 0` on its children means wide
  content (the board, the date strip) scrolls inside its own container instead
  of pushing the page sideways at 360px.
- Backlog reorder gained touch drag: a 250ms long press lifts the row and the
  row under the finger becomes the drop target, found by hit-testing
  `data-task-id`. HTML5 drag-and-drop does not fire on touch, so this is a
  separate path rather than a tweak to the existing one.