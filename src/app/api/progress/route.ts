import { sql } from "@/lib/db";
import { coderOrUnauthorized } from "@/lib/auth";

/**
 * Records that a coder has finished (or flagged, or annotated) a unit.
 *
 * This is what separates "I looked and nothing applies" from "I have not got to
 * this yet". Reliability only compares units every coder marked done, so this
 * endpoint is load-bearing rather than cosmetic.
 */
export async function POST(request: Request) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;

  const body = (await request.json()) as {
    roundId?: string;
    unitId?: string;
    status?: string;
    flagged?: boolean;
    note?: string;
  };
  const { roundId, unitId } = body;
  if (!roundId || !unitId) {
    return Response.json({ error: "roundId and unitId are required." }, { status: 400 });
  }
  if (body.status && !["todo", "in_progress", "done"].includes(body.status)) {
    return Response.json({ error: "Unknown status." }, { status: 400 });
  }

  const allowed = await sql<{ status: string }[]>`
    SELECT r.status
    FROM unit_assignments ua
    JOIN rounds r ON r.id = ua.round_id
    WHERE ua.round_id = ${roundId} AND ua.unit_id = ${unitId} AND ua.coder_id = ${auth.coder.id}
  `;
  if (allowed.length === 0) {
    return Response.json({ error: "That unit is not assigned to you." }, { status: 403 });
  }
  if (allowed[0].status === "closed") {
    return Response.json({ error: "This round is closed." }, { status: 403 });
  }

  const rows = await sql<
    Array<{ unit_id: string; status: string; flagged: boolean; note: string }>
  >`
    INSERT INTO unit_progress (round_id, unit_id, coder_id, status, flagged, note)
    VALUES (${roundId}, ${unitId}, ${auth.coder.id},
            ${body.status ?? "in_progress"}, ${body.flagged ?? false}, ${body.note ?? ""})
    ON CONFLICT (round_id, unit_id, coder_id) DO UPDATE SET
      status  = COALESCE(${body.status ?? null}, unit_progress.status),
      flagged = COALESCE(${body.flagged ?? null}::boolean, unit_progress.flagged),
      note    = COALESCE(${body.note ?? null}, unit_progress.note),
      updated_at = now()
    RETURNING unit_id, status, flagged, note
  `;

  return Response.json({ progress: rows[0] });
}
