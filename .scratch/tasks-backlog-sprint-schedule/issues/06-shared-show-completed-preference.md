# 06: Shared show-completed preference

**What to build:** One server-side per-user preference decides whether completed work is shown, so the same person sees the same thing on web, desktop, Android and iOS. Completed stays hidden by default with the count visible, and a URL parameter can override the stored choice for a single shared link.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] The preference persists server-side per user per organisation, not in local storage
- [ ] Default is hidden and the Completed count is still visible when hidden
- [ ] Toggling affects backlog, schedule and search consistently
- [ ] A URL parameter overrides the stored preference for that view only and does not persist
- [ ] The preference round-trips unchanged through the generated client models
