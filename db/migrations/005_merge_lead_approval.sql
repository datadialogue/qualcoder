-- A lead can approve a merge without waiting for every vote. Recording who did
-- keeps that visible in the history: NULL means the whole team agreed.
ALTER TABLE code_merges ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES coders(id) ON DELETE SET NULL;
