import { sql } from "./db";
import type { Code, Coder, Round, Study, Theme } from "./types";

export interface CodebookTheme extends Theme {
  codes: Code[];
}

export async function getStudy(id: string): Promise<Study | null> {
  // A malformed id in the URL is "not found", not a database error.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await sql<Study[]>`SELECT * FROM studies WHERE id = ${id}`;
  return rows[0] ?? null;
}

export interface StudySummary extends Study {
  unit_count: number;
  code_count: number;
  round_count: number;
  open_rounds: number;
}

export async function getStudySummaries(): Promise<StudySummary[]> {
  return sql<StudySummary[]>`
    SELECT s.*,
           (SELECT count(*)::int FROM units u  WHERE u.study_id = s.id) AS unit_count,
           (SELECT count(*)::int FROM codes c  WHERE c.study_id = s.id AND NOT c.archived) AS code_count,
           (SELECT count(*)::int FROM rounds r WHERE r.study_id = s.id) AS round_count,
           (SELECT count(*)::int FROM rounds r WHERE r.study_id = s.id AND r.status = 'open') AS open_rounds
    FROM studies s
    ORDER BY s.status, s.created_at DESC
  `;
}

/** Themes with their codes, plus any codes not filed under a theme. */
export async function getCodebook(studyId: string, includeArchived = false): Promise<CodebookTheme[]> {
  const [themes, codes] = await Promise.all([
    sql<Theme[]>`SELECT * FROM themes WHERE study_id = ${studyId} ORDER BY position, name`,
    sql<Code[]>`
      SELECT * FROM codes
      WHERE study_id = ${studyId} AND ${includeArchived ? sql`true` : sql`archived = false`}
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
      study_id: studyId,
      name: "Unfiled",
      description: "Codes not yet assigned to a theme.",
      color: "#94a3b8",
      position: 9999,
      codes: loose,
    });
  }
  return grouped;
}

export async function getFlatCodes(
  studyId: string,
): Promise<Array<Code & { theme_name: string | null }>> {
  return sql<Array<Code & { theme_name: string | null }>>`
    SELECT c.*, t.name AS theme_name
    FROM codes c LEFT JOIN themes t ON t.id = c.theme_id
    WHERE c.study_id = ${studyId} AND c.archived = false
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

export async function getRounds(studyId: string): Promise<Round[]> {
  return sql<Round[]>`SELECT * FROM rounds WHERE study_id = ${studyId} ORDER BY number DESC`;
}

export async function getRound(id: string): Promise<Round | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await sql<Round[]>`SELECT * FROM rounds WHERE id = ${id}`;
  return rows[0] ?? null;
}

/** A round, but only if it belongs to the study in the URL. */
export async function getStudyRound(studyId: string, roundId: string): Promise<Round | null> {
  const round = await getRound(roundId);
  return round && round.study_id === studyId ? round : null;
}

export interface RoundSummary extends Round {
  unit_count: number;
  coder_count: number;
}

export async function getRoundSummaries(studyId: string): Promise<RoundSummary[]> {
  return sql<RoundSummary[]>`
    SELECT r.*,
           (SELECT count(*)::int FROM round_units ru WHERE ru.round_id = r.id) AS unit_count,
           (SELECT count(*)::int FROM assignments a  WHERE a.round_id  = r.id) AS coder_count
    FROM rounds r
    WHERE r.study_id = ${studyId}
    ORDER BY r.number DESC
  `;
}

export interface OpenWork extends RoundSummary {
  study_name: string;
}

/** Open rounds, across every study, that this coder is assigned to. */
export async function getOpenWork(coderId: string): Promise<OpenWork[]> {
  return sql<OpenWork[]>`
    SELECT r.*, s.name AS study_name,
           (SELECT count(*)::int FROM round_units ru WHERE ru.round_id = r.id) AS unit_count,
           (SELECT count(*)::int FROM assignments a2 WHERE a2.round_id = r.id) AS coder_count
    FROM rounds r
    JOIN studies s ON s.id = r.study_id
    JOIN assignments a ON a.round_id = r.id AND a.coder_id = ${coderId}
    WHERE r.status = 'open' AND s.status = 'active'
    ORDER BY s.name, r.number DESC
  `;
}

/** Studies in which this coder has been assigned to at least one round. */
export async function getCoderStudyIds(coderId: string): Promise<Set<string>> {
  const rows = await sql<{ study_id: string }[]>`
    SELECT DISTINCT r.study_id FROM assignments a JOIN rounds r ON r.id = a.round_id
    WHERE a.coder_id = ${coderId}
  `;
  return new Set(rows.map((r) => r.study_id));
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
export async function getMetaFacets(studyId: string): Promise<Record<string, string[]>> {
  const rows = await sql<{ key: string; value: string; n: number }[]>`
    SELECT kv.key, kv.value, count(*)::int AS n
    FROM units u, LATERAL jsonb_each_text(u.meta) AS kv(key, value)
    WHERE u.study_id = ${studyId}
    GROUP BY kv.key, kv.value
    ORDER BY kv.key, kv.value
  `;
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    (out[r.key] ??= []).push(r.value);
  }
  // Free-text and identifier columns are useless as strata; skip them.
  for (const k of Object.keys(out)) {
    if (out[k].length > 24) delete out[k];
  }
  return out;
}

/** Every metadata key present on a study's units. */
export async function getMetaKeys(studyId: string): Promise<string[]> {
  const rows = await sql<{ key: string }[]>`
    SELECT DISTINCT kv.key
    FROM units u, LATERAL jsonb_object_keys(u.meta) AS kv(key)
    WHERE u.study_id = ${studyId}
    ORDER BY kv.key
  `;
  return rows.map((r) => r.key);
}
