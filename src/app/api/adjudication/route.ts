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
  if (ids.length > 0) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM codes c JOIN rounds r ON r.study_id = c.study_id
      WHERE r.id = ${roundId} AND c.id = ANY(${ids}::uuid[])
    `;
    if (n !== ids.length) {
      return Response.json({ error: "Some of those codes are not in this study's codebook." }, { status: 400 });
    }
  }

  await sql.begin(async (tx) => {
    await tx`
      DELETE FROM adjudicated_annotations
      WHERE round_id = ${roundId} AND unit_id = ${unitId}
    `;
    if (codes.length > 0) {
      const rows = codes.map((c) => {
        const hasSpan = c.start !== null && c.end !== null;
        const start = hasSpan ? Math.max(0, c.start!) : null;
        const end = hasSpan ? Math.min(text.length, c.end!) : null;
        return {
          round_id: roundId,
          unit_id: unitId,
          code_id: c.codeId,
          start_offset: start,
          end_offset: end,
          quote: start !== null && end !== null ? text.slice(start, end) : "",
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
