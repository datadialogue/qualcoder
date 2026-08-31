import { sql } from "./db";
import type { Code, Coder, Round, Theme } from "./types";

export interface CodebookTheme extends Theme {
  codes: Code[];
}

/** Themes with their codes, plus any codes not filed under a theme. */
export async function getCodebook(includeArchived = false): Promise<CodebookTheme[]> {
  const [themes, codes] = await Promise.all([
    sql<Theme[]>`SELECT * FROM themes ORDER BY position, name`,
    sql<Code[]>`
      SELECT * FROM codes
      WHERE ${includeArchived ? sql`true` : sql`archived = false`}
      ORDER BY position, name
    `,
  ]);
  const grouped: CodebookTheme[] = themes.map((t) => ({ ...t, codes: [] }));
  const byId = new Map(grouped.map((t) => [t.id, t]));
  const loose: Code[] = [];
  for (const c of codes) {
    const t = c.theme_id ? byId.get(c.theme_id) : undefined;
    if (t) t.codes.push(c);
    else loose.push(c);
  }
  if (loose.length > 0) {
    grouped.push({
      id: "__unfiled__",
      name: "Unfiled",
      description: "Codes not yet assigned to a theme.",
      color: "#94a3b8",
      position: 9999,
      codes: loose,
    });
  }
  return grouped;
}

export async function getFlatCodes(): Promise<Array<Code & { theme_name: string | null }>> {
  return sql<Array<Code & { theme_name: string | null }>>`
    SELECT c.*, t.name AS theme_name
    FROM codes c LEFT JOIN themes t ON t.id = c.theme_id
    WHERE c.archived = false
    ORDER BY t.position NULLS LAST, t.name NULLS LAST, c.position, c.name
  `;
}

export async function getCoders(activeOnly = true): Promise<Coder[]> {
  return sql<Coder[]>`
    SELECT * FROM coders
    WHERE ${activeOnly ? sql`active = true` : sql`true`}
    ORDER BY role DESC, name
  `;
}

export async function getRounds(): Promise<Round[]> {
  return sql<Round[]>`SELECT * FROM rounds ORDER BY number DESC`;
}

export async function getRound(id: string): Promise<Round | null> {
  const rows = await sql<Round[]>`SELECT * FROM rounds WHERE id = ${id}`;
  return rows[0] ?? null;
}

export interface RoundSummary extends Round {
  unit_count: number;
  coder_count: number;
}

export async function getRoundSummaries(): Promise<RoundSummary[]> {
  return sql<RoundSummary[]>`
    SELECT r.*,
           (SELECT count(*)::int FROM round_units ru WHERE ru.round_id = r.id) AS unit_count,
           (SELECT count(*)::int FROM assignments a  WHERE a.round_id  = r.id) AS coder_count
    FROM rounds r
    ORDER BY r.number DESC
  `;
}

export interface CoderProgress {
  coder_id: string;
  name: string;
  assigned: number;
  done: number;
  flagged: number;
  annotations: number;
}

/** Per-coder completion for a round. `assigned` respects partial-overlap designs. */
export async function getRoundProgress(roundId: string): Promise<CoderProgress[]> {
  return sql<CoderProgress[]>`
    SELECT c.id AS coder_id,
           c.name,
           (SELECT count(*)::int FROM unit_assignments ua
             WHERE ua.round_id = ${roundId} AND ua.coder_id = c.id) AS assigned,
           (SELECT count(*)::int FROM unit_progress up
             WHERE up.round_id = ${roundId} AND up.coder_id = c.id AND up.status = 'done') AS done,
           (SELECT count(*)::int FROM unit_progress up
             WHERE up.round_id = ${roundId} AND up.coder_id = c.id AND up.flagged) AS flagged,
           (SELECT count(*)::int FROM annotations an
             WHERE an.round_id = ${roundId} AND an.coder_id = c.id) AS annotations
    FROM assignments a
    JOIN coders c ON c.id = a.coder_id
    WHERE a.round_id = ${roundId}
    ORDER BY c.name
  `;
}

/** Distinct values for each metadata key, for building sampling filters. */
export async function getMetaFacets(): Promise<Record<string, string[]>> {
  const rows = await sql<{ key: string; value: string; n: number }[]>`
    SELECT kv.key, kv.value, count(*)::int AS n
    FROM units u, LATERAL jsonb_each_text(u.meta) AS kv(key, value)
    GROUP BY kv.key, kv.value
    ORDER BY kv.key, kv.value
  `;
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    // Free-text and identifier columns are useless as strata; skip them.
    (out[r.key] ??= []).push(r.value);
  }
  for (const k of Object.keys(out)) {
    if (out[k].length > 24) delete out[k];
  }
  return out;
}
