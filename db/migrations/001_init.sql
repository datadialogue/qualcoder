-- Qualitative coding platform: core schema.

CREATE TABLE IF NOT EXISTS coders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text,
  token       text NOT NULL UNIQUE,
  role        text NOT NULL DEFAULT 'coder' CHECK (role IN ('lead','coder')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per codeable text (here: one `justification`).
-- `meta` keeps every other column from the source CSV so exports can join back.
CREATE TABLE IF NOT EXISTS units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  text        text NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS themes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  color       text NOT NULL DEFAULT '#64748b',
  position    integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id    uuid REFERENCES themes(id) ON DELETE SET NULL,
  name        text NOT NULL UNIQUE,
  definition  text NOT NULL DEFAULT '',
  inclusion   text NOT NULL DEFAULT '',
  exclusion   text NOT NULL DEFAULT '',
  example     text NOT NULL DEFAULT '',
  color       text NOT NULL DEFAULT '#3b82f6',
  position    integer NOT NULL DEFAULT 0,
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- A round IS an iteration of the coding process.
CREATE TABLE IF NOT EXISTS rounds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number           integer NOT NULL UNIQUE,
  name             text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  sampling         jsonb NOT NULL DEFAULT '{}'::jsonb,
  seed             text NOT NULL DEFAULT '',
  overlap_mode     text NOT NULL DEFAULT 'full' CHECK (overlap_mode IN ('full','subset')),
  codebook_snapshot jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  opened_at        timestamptz,
  closed_at        timestamptz
);

-- The shared sample. Drawn ONCE at round creation and persisted, so every coder
-- reads the identical set in the identical order.
CREATE TABLE IF NOT EXISTS round_units (
  round_id  uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  unit_id   uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  position  integer NOT NULL,
  PRIMARY KEY (round_id, unit_id)
);
CREATE INDEX IF NOT EXISTS round_units_order ON round_units (round_id, position);

CREATE TABLE IF NOT EXISTS assignments (
  round_id  uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  coder_id  uuid NOT NULL REFERENCES coders(id) ON DELETE CASCADE,
  PRIMARY KEY (round_id, coder_id)
);

-- Which coder is responsible for which unit (supports partial-overlap designs).
CREATE TABLE IF NOT EXISTS unit_assignments (
  round_id  uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  unit_id   uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  coder_id  uuid NOT NULL REFERENCES coders(id) ON DELETE CASCADE,
  PRIMARY KEY (round_id, unit_id, coder_id)
);
CREATE INDEX IF NOT EXISTS unit_assignments_by_coder ON unit_assignments (round_id, coder_id);

-- NULL start/end offsets mean the code was applied to the whole unit
-- rather than to a selected span.
CREATE TABLE IF NOT EXISTS annotations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  unit_id      uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  coder_id     uuid NOT NULL REFERENCES coders(id) ON DELETE CASCADE,
  code_id      uuid NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  start_offset integer,
  end_offset   integer,
  quote        text NOT NULL DEFAULT '',
  memo         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT annotations_span_valid CHECK (
    (start_offset IS NULL AND end_offset IS NULL)
    OR (start_offset IS NOT NULL AND end_offset IS NOT NULL AND end_offset > start_offset
        AND start_offset >= 0)
  )
);
CREATE INDEX IF NOT EXISTS annotations_by_unit ON annotations (round_id, unit_id, coder_id);
CREATE INDEX IF NOT EXISTS annotations_by_code ON annotations (round_id, code_id);

-- Guards against duplicates from double-clicks or retried requests.
CREATE UNIQUE INDEX IF NOT EXISTS annotations_unique_span ON annotations
  (round_id, unit_id, coder_id, code_id, COALESCE(start_offset, -1), COALESCE(end_offset, -1));

-- Without this table, "applied no codes" and "has not opened it yet" are
-- indistinguishable, which silently corrupts every reliability statistic.
-- IRR only ever compares units that all compared coders marked 'done'.
CREATE TABLE IF NOT EXISTS unit_progress (
  round_id   uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  unit_id    uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  coder_id   uuid NOT NULL REFERENCES coders(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  flagged    boolean NOT NULL DEFAULT false,
  note       text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, unit_id, coder_id)
);
CREATE INDEX IF NOT EXISTS unit_progress_done ON unit_progress (round_id, coder_id, status);

CREATE TABLE IF NOT EXISTS adjudications (
  round_id    uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  unit_id     uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  resolved_by uuid REFERENCES coders(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  note        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, unit_id)
);

CREATE TABLE IF NOT EXISTS adjudicated_annotations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  unit_id      uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  code_id      uuid NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  start_offset integer,
  end_offset   integer,
  quote        text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS adjudicated_by_unit ON adjudicated_annotations (round_id, unit_id);
