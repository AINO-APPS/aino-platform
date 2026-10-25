# 24: Command palette and shortcuts

**What to build:** One keyboard entry point searches tasks by key or title, jumps to any view, and runs the common actions. A documented shortcut set ships with it and is discoverable from a help overlay.

**Blocked by:** 07

**Status:** done

- [x] The palette opens on the primary modifier plus K and closes on escape
- [x] Searching by key or title returns tasks; selecting one opens it
- [x] Every view is reachable from the palette
- [x] Common actions run from the palette
- [x] The shortcut help overlay lists the complete set
- [x] No focus trap; the palette is fully operable by keyboard alone

## Comments

- `useCommandPalette` owns the behaviour: `Ctrl/Cmd+K` toggles, arrow keys move,
  `Enter` runs, `Escape` closes. Both the open and close keys are document-level
  so the palette works from anywhere on the page.
- Results are one keyboard-navigable list in three groups — Tasks, Views,
  Actions. Tasks come first because that is what people search for; an empty
  query still lists views and actions so the palette doubles as a launcher.
- Task search goes through the existing `/tasks/search`, which already ranks an
  exact `PROJ-123` key match first, so searching by key and by title both work.
- Every view is reachable: Backlog, Sprint board, Sprint plan, Schedule and
  Service desk. Actions cover New task, Toggle completed, Set density, Start
  sprint and Keyboard shortcuts.
- `ShortcutHelp` renders `TASK_SHORTCUTS`, the documented set from the design
  spec, and opens on `?` unless the user is typing. Keeping the list as data
  means the overlay and the tests read the same source.
- There is no focus trap: `aria-modal` is `false`, Tab leaves the palette, and
  the active option is exposed through `aria-activedescendant` so a screen
  reader follows the arrow keys.
- `useTasksPalette` and `TasksOverlays` were extracted so `Tasks.tsx` stays
  within its ratchet.