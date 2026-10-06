-- New tickets start in "New": rename the seeded initial workflow state.
-- Only touches rows still carrying the seeded default name, so states an
-- admin has customised keep their label. The key stays 'pending'.
UPDATE workflow_states
   SET name = 'New'
 WHERE key = 'pending'
   AND is_initial = TRUE
   AND name = 'To Do';
