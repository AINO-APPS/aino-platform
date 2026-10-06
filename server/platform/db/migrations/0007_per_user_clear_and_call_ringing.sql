-- Per-user "Clear chat" / "Delete chat" (2026-10-06).
-- Messages created at or before cleared_at are hidden from every read for that
-- participant only; no message rows are deleted. hidden_at removes the
-- conversation from that participant's list until a newer message arrives.
ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;
ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- First callee-device "I'm ringing" acknowledgement for a 1:1 call.
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS ringing_at TIMESTAMPTZ;
