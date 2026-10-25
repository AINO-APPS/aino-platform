# 21: Card density

**What to build:** Cards support two densities: comfortable, showing key, title, points, assignee and priority, and compact, showing key, title and points only. The choice is a per-user setting that follows the user across clients, like the completed preference.

**Blocked by:** 12

**Status:** done

- [x] Comfortable shows key, title, points, assignee and priority
- [x] Compact shows key, title and points only
- [x] The choice persists per user server-side
- [x] Density applies on backlog rows, board cards and plan panes consistently
- [x] Compact remains legible at the narrowest supported column width

## Comments

- `card_density` was already stored per user in `users.task_prefs` (ticket 06);
  this ticket applies it. `TaskProvider` now carries the density so every
  surface reads the same value instead of each one re-fetching the preference.
- Comfortable shows key, title, points, assignee and priority (plus status,
  labels, description preview and due date). Compact keeps key, title and points
  and drops the rest, on backlog rows, board cards and both plan panes.
- The header carries a density toggle that writes through
  `useTaskPreferences.setCardDensity`, so the choice follows the user across
  clients rather than living in local storage.
- Compact keeps the title at its own font size and full contrast and only
  tightens padding and line clamping, so it stays legible at the narrowest
  supported column width.
- `TaskMetaGrid` was extracted from `TaskDetailModal` to keep that file under its
  ratchet; the baseline dropped from 856 to 740 lines.