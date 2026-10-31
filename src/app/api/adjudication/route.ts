import { sql } from "@/lib/db";
import { coderOrUnauthorized } from "@/lib/auth";

interface Candidate {
  codeId: string;
  start: number | null;
  end: number | null;
}

/**
 * Replaces the agreed coding for one unit in one go.
 *
 * The whole set is written atomically rather than diffed, so an interrupted
 * save can never leave a half-reconciled unit behind.
 */
export async function POST(request: Request) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;
  if (auth.coder.role !== "lead") {
    return Response.json({ error: "Only the project lead can adjudicate." }, { status: 403 });
  }

  const body = (await request.json()) as {
    roundId?: string;
    unitId?: string;
    codes?: Candidate[];
    note?: string;
    status?: "open" | "resolved";
  };
  const { roundId, unitId } = body;
  if (!roundId || !unitId) {
    return Response.json({ error: "roundId and unitId are required." }, { status: 400 });
  }

  const belongs = await sql<{ unit_id: string }[]>`
    SELECT unit_id FROM round_units WHERE round_id = ${roundId} AND unit_id = ${unitId}
  `;
  if (belongs.length === 0) {
    return Response.json({ error: "That unit is not part of this round." }, { status: 404 });
  }

  const [{ text }] = await sql<{ text: string }[]>`SELECT text FROM units WHERE id = ${unitId}`;
  const codes = (body.codes ?? []).filter((c) => c.codeId);

  const ids = [...new Set(codes.map((c) => c.codeId))];
  // Merged-away codes (from a page loaded before the merge) resolve to the code they became.
  const live = new Map<string, string>();
  if (ids.length > 0) {
    const rows = await sql<{ id: string; live: string }[]>`
      SELECT c.id, COALESCE(c.merged_into, c.id) AS live
      FROM codes c JOIN rounds r ON r.study_id = c.study_id
      WHERE r.id = ${roundId} AND c.id = ANY(${ids}::uuid[])
    `;
    if (rows.length !== ids.length) {
      return Response.json({ error: "Some of those codes are not in this study's codebook." }, { status: 400 });
    }
    for (const r of rows) live.set(r.id, r.live);
  }

  await sql.begin(async (tx) => {
    // Re-saving rewrites the unit's rows; carry over which code each one was
    // originally given before a merge, so saving again does not erase it.
    const before = await tx<
      { code_id: string; start_offset: number | null; end_offset: number | null; original_code_id: string | null }[]
    >`
      SELECT code_id, start_offset, end_offset, original_code_id FROM adjudicated_annotations
      WHERE round_id = ${roundId} AND unit_id = ${unitId} AND original_code_id IS NOT NULL
    `;
    const originalOf = new Map(
      before.map((b) => [`${b.code_id}|${b.start_offset}|${b.end_offset}`, b.original_code_id]),
    );
    await tx`
      DELETE FROM adjudicated_annotations
      WHERE round_id = ${roundId} AND unit_id = ${unitId}
    `;
    if (codes.length > 0) {
      const rows = codes.map((c) => {
        const hasSpan = c.start !== null && c.end !== null;
        const start = hasSpan ? Math.max(0, c.start!) : null;
        const end = hasSpan ? Math.min(text.length, c.end!) : null;
        const codeId = live.get(c.codeId) ?? c.codeId;
        return {
          round_id: roundId,
          unit_id: unitId,
          code_id: codeId,
          start_offset: start,
          end_offset: end,
          quote: start !== null && end !== null ? text.slice(start, end) : "",
          original_code_id:
            originalOf.get(`${codeId}|${start}|${end}`) ?? (codeId !== c.codeId ? c.codeId : null),
        };
      });
      await tx`
        INSERT INTO adjudicated_annotations ${tx(
          rows,
          "round_id",
          "unit_id",
          "code_id",
          "start_offset",
          "end_offset",
          "quote",
          "original_code_id",
        )}
      `;
    }
    await tx`
      INSERT INTO adjudications (round_id, unit_id, resolved_by, status, note)
      VALUES (${roundId}, ${unitId}, ${auth.coder.id}, ${body.status ?? "resolved"},
              ${body.note ?? ""})
      ON CONFLICT (round_id, unit_id) DO UPDATE SET
        resolved_by = EXCLUDED.resolved_by,
        status      = EXCLUDED.status,
        note        = EXCLUDED.note,
        updated_at  = now()
    `;
  });

  return Response.json({ ok: true, saved: codes.length });
}
