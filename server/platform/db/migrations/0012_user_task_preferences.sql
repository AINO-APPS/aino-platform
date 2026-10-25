-- Per-user Tasks preferences, shared by every client.
--
-- `show_completed` decides whether finished work is visible; `card_density`
-- chooses the card layout. Stored server-side so the same person sees the same
-- thing on web, desktop, Android and iOS. A URL parameter may override the
-- stored choice for one view without persisting.
ALTER TABLE users ADD COLUMN IF NOT EXISTS task_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
