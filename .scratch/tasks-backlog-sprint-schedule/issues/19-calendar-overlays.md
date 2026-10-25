# 19: Calendar overlays

**What to build:** The calendar shows approved leave, holidays and booked meetings behind tasks as read-only context, each independently toggleable, so it is obvious why a day has no capacity. No new capacity model is introduced.

**Blocked by:** 18

**Status:** done

- [x] Leave, holidays and meetings render as background context for their days
- [x] Each overlay type toggles independently
- [x] Overlays are read-only and cannot be edited from the calendar
- [x] Overlays do not affect task counts or point totals
- [x] A day with an all-day absence still allows tasks to be planned on it

## Comments

**2026-10-25 — implemented**

- Commit `43666443`. Approved leave, holidays and booked meetings render as read-only background bands behind tasks, each independently toggleable, reusing existing data rather than introducing a capacity model. Overlays cannot be edited from the calendar and do not affect it — a day with an all-day absence still accepts planned tasks.
