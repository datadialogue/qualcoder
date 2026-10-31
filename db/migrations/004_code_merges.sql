-- Merging codes. Any coder on a study can propose that several codes are the
-- same thing; the merge happens only once everyone on the study's team has
-- agreed. Nothing is deleted along the way: merged-away codes are archived with
-- a pointer to the code they became, every moved annotation remembers the code
-- it was originally given, and the few annotations that collapse into an
-- identical one are copied here in full before they are folded.

CREATE TABLE IF NOT EXISTS code_merges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id        uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  -- The code that survives. It keeps its id so everything already pointing at
  -- it stays valid; the others fold into it.
  target_code_id  uuid NOT NULL REFERENCES codes(id),
  -- What the merged code will be called and how it is defined. Empty
  -- definition means "keep the surviving code's definition".
  new_name        text NOT NULL,
  new_definition  text NOT NULL DEFAULT '',
  rationale       text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'proposed'
                  CHECK (status IN ('proposed','merged','withdrawn','superseded')),
  proposed_by     uuid REFERENCES coders(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  merged_at       timestamptz,
  -- Every involved code exactly as it stood when the merge was applied, plus
  -- how many annotations each carried, so the history reads correctly even
  -- after the surviving code is renamed again.
  snapshot        jsonb
);
CREATE INDEX IF NOT EXISTS code_merges_by_study ON code_merges (study_id, status);

-- Every code in the proposal, including the surviving one.
CREATE TABLE IF NOT EXISTS code_merge_codes (
  merge_id  uuid NOT NULL REFERENCES code_merges(id) ON DELETE CASCADE,
  code_id   uuid NOT NULL REFERENCES codes(id),
  PRIMARY KEY (merge_id, code_id)
);
CREATE INDEX IF NOT EXISTS code_merge_codes_by_code ON code_merge_codes (code_id);

CREATE TABLE IF NOT EXISTS code_merge_votes (
  merge_id   uuid NOT NULL REFERENCES code_merges(id) ON DELETE CASCADE,
  coder_id   uuid NOT NULL REFERENCES coders(id) ON DELETE CASCADE,
  vote       text NOT NULL CHECK (vote IN ('agree','disagree')),
  comment    text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merge_id, coder_id)
);

-- A coder who gave the same span two of the codes being merged ends up with
-- two identical annotations, which the unique index forbids. One is kept (its
-- memo absorbs the other's) and the other is recorded here, whole.
CREATE TABLE IF NOT EXISTS code_merge_folded (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_id     uuid NOT NULL REFERENCES code_merges(id) ON DELETE CASCADE,
  source_table text NOT NULL CHECK (source_table IN ('annotations','adjudicated_annotations')),
  kept_id      uuid NOT NULL,
  row_data     jsonb NOT NULL,
  folded_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE codes ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES codes(id);
ALTER TABLE codes ADD COLUMN IF NOT EXISTS merged_at timestamptz;

-- Set the first time an annotation is moved by a merge and never overwritten,
-- so it always names the code the coder actually chose.
ALTER TABLE annotations             ADD COLUMN IF NOT EXISTS original_code_id uuid REFERENCES codes(id);
ALTER TABLE adjudicated_annotations ADD COLUMN IF NOT EXISTS original_code_id uuid REFERENCES codes(id);
CREATE INDEX IF NOT EXISTS annotations_by_original_code
  ON annotations (original_code_id) WHERE original_code_id IS NOT NULL;
