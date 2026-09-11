-- PR-B: least-privilege tiers for control-plane operators.
--
-- Today every platform account is an undifferentiated `platform_admin` with
-- full authority: provision tenants, change plans, request access to any
-- workspace. Microsoft GDAP's core lesson is that "provider" is not one
-- privilege level, so this introduces a ladder:
--
--   platform_owner    manage operators + billing; the only role that may
--                     co-sign a support operator's write access
--   platform_operator day-to-day tenant lifecycle; may request access
--   platform_support  read-only catalog; may request READ access
--   platform_auditor  read-only catalog + audit trail; may NOT request access
--
-- Columns are added and surfaced in the console now. ENFORCEMENT LANDS IN
-- PHASE 2 alongside the tenant-side role split — shipping the schema first
-- keeps this migration additive and independently revertible.
--
-- See docs/PLATFORM_TENANT_SEPARATION_PLAN.md (item B6).

ALTER TABLE platform_users
    ADD COLUMN IF NOT EXISTS platform_role TEXT NOT NULL DEFAULT 'platform_operator';

DO $$ BEGIN
    ALTER TABLE platform_users ADD CONSTRAINT platform_users_platform_role_check
        CHECK (platform_role IN (
            'platform_owner', 'platform_operator', 'platform_support', 'platform_auditor'
        ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Step-up authentication for realm switching (PR-C). Defaults FALSE so the
-- column is inert until the switcher ships; PR-C flips it on for any account
-- that gains a linked tenant principal.
ALTER TABLE platform_users
    ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT FALSE;

-- Promote the earliest account to owner so the install always has exactly one
-- principal able to manage other operators. Idempotent: only runs when no
-- owner exists yet.
UPDATE platform_users
   SET platform_role = 'platform_owner'
 WHERE id = (SELECT MIN(id) FROM platform_users)
   AND NOT EXISTS (SELECT 1 FROM platform_users WHERE platform_role = 'platform_owner');

CREATE INDEX IF NOT EXISTS idx_platform_users_role ON platform_users(platform_role);
