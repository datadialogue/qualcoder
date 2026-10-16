import type postgres from "postgres";
import type { UnitInput } from "./starter";

/**
 * Inserts units into a study, or updates them in place when the external id is
 * already there -- so re-importing a corrected file never duplicates units and
 * existing coding stays attached.
 *
 * The batch travels as one jsonb parameter. Passing `context` through
 * postgres.js's bulk helper would send a JS array as a Postgres array rather
 * than as JSON.
 */
export async function upsertUnits(
  db: postgres.Sql | postgres.TransactionSql,
  studyId: string,
  units: UnitInput[],
): Promise<{ inserted: number; updated: number }> {
  // One statement cannot update the same row twice, so a repeated id within a
  // request keeps its last occurrence.
  const unique = [...new Map(units.map((u) => [u.external_id, u])).values()];
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const rows = await db<{ inserted: boolean }[]>`
      INSERT INTO units (study_id, external_id, text, meta, context)
      SELECT ${studyId}, x.external_id, x.text, COALESCE(x.meta, '{}'), COALESCE(x.context, '[]')
      FROM jsonb_to_recordset(${db.json(batch as unknown as postgres.JSONValue)}::jsonb)
        AS x(external_id text, text text, meta jsonb, context jsonb)
      ON CONFLICT (study_id, external_id) DO UPDATE
        SET text = EXCLUDED.text, meta = EXCLUDED.meta, context = EXCLUDED.context
      RETURNING (xmax = 0) AS inserted
    `;
    for (const r of rows) {
      if (r.inserted) inserted++;
      else updated++;
    }
  }
  return { inserted, updated };
}
