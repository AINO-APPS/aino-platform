# 10: Enforce minimum client versions

**What to build:** Platform operators can enforce minimum versions for Android, desktop and web so that outdated recognized clients are directed to upgrade before legacy APIs are removed.

**Blocked by:** 09: Report client versions and handle upgrades.

**Status:** ready-for-agent

- [ ] Operators can configure the platform-wide gate mode and a minimum version for each recognized client class.
- [ ] In enforce mode, a recognized client below its minimum receives HTTP 426 with `CLIENT_UPGRADE_REQUIRED`, its current version and the required minimum.
- [ ] A recognized client with no version is treated as version zero; unrecognized clients are never gated.
- [ ] Health and the public client-version read remain exempt so clients can recover and show upgrade instructions.
- [ ] Version comparison handles supported semantic versions and rejects malformed configuration safely.
- [ ] Integration tests cover the enforcement boundary, each client class, missing versions and exempt routes.
