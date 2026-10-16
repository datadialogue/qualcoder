-- Studies. One deployment now hosts several independent studies, each with its
-- own data, codebook and rounds. Coders stay global -- a person can work on
-- more than one study -- and rounds already decide who codes what.

CREATE TABLE IF NOT EXISTS studies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- What the data looked like on import ('csv', 'reddit', ...). Informational:
  -- every unit is stored the same way regardless.
  source      text NOT NULL DEFAULT 'csv',
  -- Display and import settings; see StudySettings in src/lib/types.ts.
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by  uuid REFERENCES coders(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Installs from before this migration held exactly one study. Fold whatever is
-- there into a study of its own so nothing is orphaned. The display keys are
-- the ones the coding workspace used to hardcode, so it looks the same.
INSERT INTO studies (name, description, source, settings)
SELECT 'Original study',
       'Created automatically from the data that existed before studies were introduced.',
       'csv',
       '{"displayKeys": ["condition", "aor", "num_messages", "account_suspension", "account_confidence"]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM studies)
  AND (EXISTS (SELECT 1 FROM units) OR EXISTS (SELECT 1 FROM codes)
       OR EXISTS (SELECT 1 FROM themes) OR EXISTS (SELECT 1 FROM rounds));

ALTER TABLE units  ADD COLUMN IF NOT EXISTS study_id uuid REFERENCES studies(id) ON DELETE CASCADE;
ALTER TABLE themes ADD COLUMN IF NOT EXISTS study_id uuid REFERENCES studies(id) ON DELETE CASCADE;
ALTER TABLE codes  ADD COLUMN IF NOT EXISTS study_id uuid REFERENCES studies(id) ON DELETE CASCADE;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS study_id uuid REFERENCES studies(id) ON DELETE CASCADE;

UPDATE units  SET study_id = (SELECT id FROM studies ORDER BY created_at LIMIT 1) WHERE study_id IS NULL;
UPDATE themes SET study_id = (SELECT id FROM studies ORDER BY created_at LIMIT 1) WHERE study_id IS NULL;
UPDATE codes  SET study_id = (SELECT id FROM studies ORDER BY created_at LIMIT 1) WHERE study_id IS NULL;
UPDATE rounds SET study_id = (SELECT id FROM studies ORDER BY created_at LIMIT 1) WHERE study_id IS NULL;

ALTER TABLE units  ALTER COLUMN study_id SET NOT NULL;
ALTER TABLE themes ALTER COLUMN study_id SET NOT NULL;
ALTER TABLE codes  ALTER COLUMN study_id SET NOT NULL;
ALTER TABLE rounds ALTER COLUMN study_id SET NOT NULL;

-- Names and numbers only need to be unique within a study: two studies can
-- both have a "Round 1" and a code called "Sarcasm".
ALTER TABLE units  DROP CONSTRAINT IF EXISTS units_external_id_key;
ALTER TABLE themes DROP CONSTRAINT IF EXISTS themes_name_key;
ALTER TABLE codes  DROP CONSTRAINT IF EXISTS codes_name_key;
ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_number_key;

ALTER TABLE units  ADD CONSTRAINT units_study_external_id_key UNIQUE (study_id, external_id);
ALTER TABLE themes ADD CONSTRAINT themes_study_name_key       UNIQUE (study_id, name);
ALTER TABLE codes  ADD CONSTRAINT codes_study_name_key        UNIQUE (study_id, name);
ALTER TABLE rounds ADD CONSTRAINT rounds_study_number_key     UNIQUE (study_id, number);

-- Read-only text shown above a unit while coding but never coded itself, e.g.
-- the post a Reddit comment replies to. An array of {label, text}. Kept apart
-- from `text` so span offsets refer only to what is actually being coded.
ALTER TABLE units ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '[]'::jsonb;
