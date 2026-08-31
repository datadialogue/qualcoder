-- Codes can now be created mid-coding, so record who made one and whether the
-- lead has reviewed it yet. A code added during coding is `provisional` until
-- confirmed, which keeps emergent codes visible for reconciliation rather than
-- letting them quietly accumulate in the codebook.
ALTER TABLE codes ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES coders(id) ON DELETE SET NULL;
ALTER TABLE codes ADD COLUMN IF NOT EXISTS provisional boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS codes_provisional ON codes (provisional) WHERE provisional;
