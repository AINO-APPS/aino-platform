-- Push payload version per device token (2026-10-02).
-- 1 = legacy app payloads. Android 0.14.0 and older reject unknown FCM data
-- keys, so they must never receive `link` / `linkTaskId`.
-- 2 = general alerts may carry `link` and `linkTaskId` (Android 0.15.0+).
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS push_version INTEGER NOT NULL DEFAULT 1;
