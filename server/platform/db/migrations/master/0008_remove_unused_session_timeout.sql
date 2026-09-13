-- This setting was exposed in the platform console but was never consulted by
-- tenant authentication. Remove it rather than presenting a misleading global
-- control. Tenant sessions retain their explicit two-day inactivity policy;
-- platform sessions do not idle-expire.
DELETE FROM app_settings WHERE key = 'session_timeout_minutes';