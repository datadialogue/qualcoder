/**
 * Merging codes that turn out to mean the same thing.
 *
 * A merge is proposed by any coder on the study, and is applied once every
 * member of the study's team has agreed to it, or as soon as a lead approves it. Applying one moves every
 * annotation -- in every round, open or closed -- onto a single surviving code,
 * so reliability and exports treat the merged codes as one from then on.
 *
 * Nothing is thrown away. Merged-away codes stay in the codebook, archived and
 * pointing at the code they became; each moved annotation keeps the code its
 * coder originally chose in `original_code_id`; and where a coder had applied
 * two of the merged codes to exactly the same text, the duplicate is copied in
 * full into `code_merge_folded` before it is folded into the one kept.
 */
import type postgres from "postgres";
import { sql } from "./db";
import type { Coder } from "./types";

export type MergeStatus = "proposed" | "merged" | "withdrawn" | "superseded";

export interface CodeMerge {
  id: string;
  study_id: string;
  target_code_id: string;
  new_name: string;
  new_definition: string;
  rationale: string;
  status: MergeStatus;
  proposed_by: string | null;
  created_at: string;
  merged_at: string | null;
  /** The lead who approved it without waiting for everyone; null when the team agreed. */
  approved_by: string | null;
  snapshot: MergeSnapshot | null;
}

export interface MergeSnapshot {
  codes: Array<{
    id: string;
    name: string;
    definition: string;
    theme_name: string | null;
    color: string;
    annotations: number;
    adjudicated: number;
    survivor: boolean;
  }>;
  moved: number;
  folded: number;
}

/** A problem the people involved can fix, as opposed to a bug. */
export class MergeError extends Error {}

/**
 * Who has to agree before a merge goes through: every active coder assigned to
 * any round of the study, plus whoever proposed it. Someone who has never coded
 * in the study has no stake in how its codes are drawn.
 */
export async function getStudyTeam(studyId: string): Promise<Array<{ id: string; name: string }>> {
  return sql<Array<{ id: string; name: string }>>`
    SELECT DISTINCT c.id, c.name
    FROM assignments a
    JOIN rounds r ON r.id = a.round_id
    JOIN coders c ON c.id = a.coder_id
    WHERE r.study_id = ${studyId} AND c.active
    ORDER BY c.name
  `;
}

/** Leads can always take part; coders only in studies they have coded in. */
export async function canTakePart(coder: Coder, studyId: string): Promise<boolean> {
  if (coder.role === "lead") return true;
  const team = await getStudyTeam(studyId);
  return team.some((m) => m.id === coder.id);
}

export async function requiredVoters(
  studyId: string,
  proposedBy: string | null,
): Promise<Array<{ id: string; name: string }>> {
  const team = await getStudyTeam(studyId);
  if (proposedBy && !team.some((m) => m.id === proposedBy)) {
    const [proposer] = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM coders WHERE id = ${proposedBy} AND active
    `;
    if (proposer) team.push(proposer);
  }
  return team;
}

/**
 * The code that survives a merge: the selected code already carrying the
 * chosen name, or failing that the one used most, so as few annotations as
 * possible change code.
 */
export function pickSurvivor(
  codes: Array<{ id: string; name: string; uses: number; position: number }>,
  newName: string,
): string {
  const exact = codes.find((c) => c.name === newName);
  if (exact) return exact.id;
  const loose = codes.find((c) => c.name.toLowerCase() === newName.toLowerCase());
  if (loose) return loose.id;
  return [...codes].sort((a, b) => b.uses - a.uses || a.position - b.position)[0].id;
}

/**
 * Applies the merge if everyone required has agreed. Returns a sentence saying
 * what happened, or null when it is still waiting on someone.
 */
export async function applyIfAgreed(mergeId: string): Promise<string | null> {
  const [merge] = await sql<CodeMerge[]>`SELECT * FROM code_merges WHERE id = ${mergeId}`;
  if (!merge || merge.status !== "proposed") return null;
  const [voters, votes] = await Promise.all([
    requiredVoters(merge.study_id, merge.proposed_by),
    sql<{ coder_id: string; vote: string }[]>`
      SELECT coder_id, vote FROM code_merge_votes WHERE merge_id = ${mergeId}
    `,
  ]);
  const agreed = new Set(votes.filter((v) => v.vote === "agree").map((v) => v.coder_id));
  if (!voters.every((v) => agreed.has(v.id))) return null;

  return describe(merge.new_name, await sql.begin((tx) => applyMerge(tx, mergeId)));
}

/**
 * Applies the merge on a lead's say-so, whatever the votes stand at. The lead's
 * approval is stored with the merge so the history shows it was not unanimous.
 */
export async function approveAsLead(mergeId: string, leadId: string): Promise<string> {
  const snapshot = await sql.begin(async (tx) => {
    const result = await applyMerge(tx, mergeId, leadId);
    await tx`
      INSERT INTO code_merge_votes (merge_id, coder_id, vote) VALUES (${mergeId}, ${leadId}, 'agree')
      ON CONFLICT (merge_id, coder_id) DO UPDATE SET vote = 'agree', updated_at = now()
    `;
    return result;
  });
  const [{ new_name }] = await sql<{ new_name: string }[]>`
    SELECT new_name FROM code_merges WHERE id = ${mergeId}
  `;
  return describe(new_name, snapshot);
}

function describe(name: string, snapshot: MergeSnapshot): string {
  return (
    `Merged into "${name}". ${snapshot.moved} annotation(s) moved` +
    (snapshot.folded ? `; ${snapshot.folded} duplicate(s) folded and kept on record.` : ".")
  );
}

/**
 * Does the merge. Runs inside one transaction so a failure part-way leaves the
 * codebook and every annotation exactly as they were.
 */
export async function applyMerge(
  tx: postgres.TransactionSql,
  mergeId: string,
  approvedBy: string | null = null,
): Promise<MergeSnapshot> {
  const [merge] = await tx<CodeMerge[]>`
    SELECT * FROM code_merges WHERE id = ${mergeId} FOR UPDATE
  `;
  if (!merge) throw new MergeError("That merge proposal no longer exists.");
  if (merge.status !== "proposed") throw new MergeError(`That proposal is already ${merge.status}.`);

  const ids = (
    await tx<{ code_id: string }[]>`
      SELECT code_id FROM code_merge_codes WHERE merge_id = ${mergeId}
    `
  ).map((r) => r.code_id);
  const target = merge.target_code_id;
  const sources = ids.filter((id) => id !== target);

  // Lock the codes first so nobody renames or merges them underneath us.
  await tx`SELECT id FROM codes WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;
  const codes = await tx<
    Array<{
      id: string;
      name: string;
      definition: string;
      color: string;
      theme_name: string | null;
      merged_into: string | null;
      annotations: number;
      adjudicated: number;
    }>
  >`
    SELECT c.id, c.name, c.definition, c.color, t.name AS theme_name, c.merged_into,
           (SELECT count(*)::int FROM annotations a WHERE a.code_id = c.id) AS annotations,
           (SELECT count(*)::int FROM adjudicated_annotations aa WHERE aa.code_id = c.id) AS adjudicated
    FROM codes c LEFT JOIN themes t ON t.id = c.theme_id
    WHERE c.id = ANY(${ids}::uuid[]) AND c.study_id = ${merge.study_id}
  `;
  if (codes.length !== ids.length) {
    throw new MergeError("One of these codes is no longer in the codebook.");
  }
  const gone = codes.filter((c) => c.merged_into);
  if (gone.length > 0) {
    throw new MergeError(
      `${gone.map((c) => `"${c.name}"`).join(", ")} has already been merged into another code. ` +
        "Withdraw this proposal and propose again with the code it became.",
    );
  }
  const clash = await tx<{ name: string }[]>`
    SELECT name FROM codes
    WHERE study_id = ${merge.study_id} AND name = ${merge.new_name} AND NOT (id = ANY(${ids}::uuid[]))
  `;
  if (clash.length > 0) {
    throw new MergeError(`Another code is already called "${merge.new_name}". Pick a different name.`);
  }

  // Duplicates: the same coder, round, unit and span under two of these codes.
  // Keep the one already on the surviving code, else the earliest.
  const folded = await tx<{ id: string; keep_id: string }[]>`
    SELECT id, keep_id FROM (
      SELECT a.id,
             first_value(a.id) OVER (
               PARTITION BY a.round_id, a.unit_id, a.coder_id,
                            COALESCE(a.start_offset, -1), COALESCE(a.end_offset, -1)
               ORDER BY (a.code_id = ${target}) DESC, a.created_at, a.id
             ) AS keep_id
      FROM annotations a
      WHERE a.code_id = ANY(${ids}::uuid[])
    ) g
    WHERE id <> keep_id
  `;
  if (folded.length > 0) {
    await tx`
      INSERT INTO code_merge_folded (merge_id, source_table, kept_id, row_data)
      SELECT ${mergeId}, 'annotations', f.keep_id, to_jsonb(a)
      FROM annotations a
      JOIN unnest(${folded.map((f) => f.id)}::uuid[], ${folded.map((f) => f.keep_id)}::uuid[])
           AS f(id, keep_id) ON f.id = a.id
    `;
    // A memo on the duplicate is the coder's own reasoning; carry it over.
    await tx`
      UPDATE annotations k
      SET memo = concat_ws(E'\n\n', NULLIF(k.memo, ''), m.memos)
      FROM (
        SELECT f.keep_id, string_agg(DISTINCT a.memo, E'\n\n') AS memos
        FROM annotations a
        JOIN unnest(${folded.map((f) => f.id)}::uuid[], ${folded.map((f) => f.keep_id)}::uuid[])
             AS f(id, keep_id) ON f.id = a.id
        WHERE a.memo <> ''
        GROUP BY f.keep_id
      ) m
      WHERE k.id = m.keep_id AND position(m.memos IN k.memo) = 0
    `;
    await tx`DELETE FROM annotations WHERE id = ANY(${folded.map((f) => f.id)}::uuid[])`;
  }
  const moved = await tx`
    UPDATE annotations
    SET original_code_id = COALESCE(original_code_id, code_id), code_id = ${target}
    WHERE code_id = ANY(${sources}::uuid[])
  `;

  // The agreed coding gets the same treatment, minus coders and memos.
  const foldedAdj = await tx<{ id: string; keep_id: string }[]>`
    SELECT id, keep_id FROM (
      SELECT aa.id,
             first_value(aa.id) OVER (
               PARTITION BY aa.round_id, aa.unit_id,
                            COALESCE(aa.start_offset, -1), COALESCE(aa.end_offset, -1)
               ORDER BY (aa.code_id = ${target}) DESC, aa.created_at, aa.id
             ) AS keep_id
      FROM adjudicated_annotations aa
      WHERE aa.code_id = ANY(${ids}::uuid[])
    ) g
    WHERE id <> keep_id
  `;
  if (foldedAdj.length > 0) {
    await tx`
      INSERT INTO code_merge_folded (merge_id, source_table, kept_id, row_data)
      SELECT ${mergeId}, 'adjudicated_annotations', f.keep_id, to_jsonb(aa)
      FROM adjudicated_annotations aa
      JOIN unnest(${foldedAdj.map((f) => f.id)}::uuid[], ${foldedAdj.map((f) => f.keep_id)}::uuid[])
           AS f(id, keep_id) ON f.id = aa.id
    `;
    await tx`
      DELETE FROM adjudicated_annotations WHERE id = ANY(${foldedAdj.map((f) => f.id)}::uuid[])
    `;
  }
  await tx`
    UPDATE adjudicated_annotations
    SET original_code_id = COALESCE(original_code_id, code_id), code_id = ${target}
    WHERE code_id = ANY(${sources}::uuid[])
  `;

  // Codes merged earlier into one of the sources now point straight at the
  // survivor, so `merged_into` is always a single hop to a live code.
  await tx`
    UPDATE codes SET merged_into = ${target}, updated_at = now()
    WHERE merged_into = ANY(${sources}::uuid[])
  `;
  await tx`
    UPDATE codes
    SET merged_into = ${target}, merged_at = now(), archived = true, updated_at = now()
    WHERE id = ANY(${sources}::uuid[])
  `;
  await tx`
    UPDATE codes
    SET name = ${merge.new_name},
        definition = CASE WHEN ${merge.new_definition} = '' THEN definition ELSE ${merge.new_definition} END,
        archived = false,
        updated_at = now()
    WHERE id = ${target}
  `;

  const snapshot: MergeSnapshot = {
    codes: codes.map((c) => ({
      id: c.id,
      name: c.name,
      definition: c.definition,
      theme_name: c.theme_name,
      color: c.color,
      annotations: c.annotations,
      adjudicated: c.adjudicated,
      survivor: c.id === target,
    })),
    moved: moved.count,
    folded: folded.length + foldedAdj.length,
  };
  await tx`
    UPDATE code_merges
    SET status = 'merged', merged_at = now(), approved_by = ${approvedBy},
        snapshot = ${tx.json(snapshot as unknown as postgres.JSONValue)}
    WHERE id = ${mergeId}
  `;
  // Other open proposals naming a code that no longer exists as such cannot be
  // applied any more; mark them so nobody keeps voting on them.
  await tx`
    UPDATE code_merges m SET status = 'superseded'
    WHERE m.status = 'proposed' AND m.id <> ${mergeId}
      AND EXISTS (
        SELECT 1 FROM code_merge_codes mc
        WHERE mc.merge_id = m.id AND mc.code_id = ANY(${sources}::uuid[])
      )
  `;
  return snapshot;
}
