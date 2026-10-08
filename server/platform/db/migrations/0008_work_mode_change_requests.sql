-- Work-mode lock (2026-10-08). The first clock-in of a day fixes that day's
-- work mode; switching office <-> remote needs an approved request of type
-- 'work_mode_change' (metadata: { date, work_mode, from_mode }).
ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_type_check;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_type_check
    CHECK (type IN ('leave','manual_entry','overtime','leave_withdraw','work_mode_change'));
