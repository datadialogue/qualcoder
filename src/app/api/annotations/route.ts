import { sql } from "@/lib/db";
import { coderOrUnauthorized } from "@/lib/auth";

/** A coder may only touch units assigned to them in an open round. */
async function assertAssigned(
  roundId: string,
  unitId: string,
  coderId: string,
): Promise<string | null> {
  const rows = await sql<{ status: string }[]>`
    SELECT r.status
    FROM unit_assignments ua
    JOIN rounds r ON r.id = ua.round_id
    WHERE ua.round_id = ${roundId} AND ua.unit_id = ${unitId} AND ua.coder_id = ${coderId}
  `;
  if (rows.length === 0) return "That unit is not assigned to you in this round.";
  if (rows[0].status === "closed") return "This round is closed and can no longer be edited.";
  return null;
}

export async function POST(request: Request) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;

  const body = (await request.json()) as {
    roundId?: string;
    unitId?: string;
    codeId?: string;
    start?: number | null;
    end?: number | null;
    quote?: string;
  };
  const { roundId, unitId, codeId } = body;
  if (!roundId || !unitId || !codeId) {
    return Response.json({ error: "roundId, unitId and codeId are required." }, { status: 400 });
  }

  const denied = await assertAssigned(roundId, unitId, auth.coder.id);
  if (denied) return Response.json({ error: denied }, { status: 403 });

  const hasSpan = body.start !== null && body.start !== undefined && body.end !== null && body.end !== undefined;
  let start: number | null = null;
  let end: number | null = null;
  let quote = "";

  if (hasSpan) {
    const [{ text }] = await sql<{ text: string }[]>`SELECT text FROM units WHERE id = ${unitId}`;
    start = Math.max(0, Math.floor(body.start as number));
    end = Math.min(text.length, Math.ceil(body.end as number));
    if (end <= start) {
      return Response.json({ error: "That selection is empty." }, { status: 400 });
    }
    // Store the literal text alongside the offsets so annotations stay auditable
    // even if the source data is re-imported.
    quote = text.slice(start, end);
  }

  // ON CONFLICT makes a double-click or a retried request idempotent rather
  // than creating a second identical annotation.
  const rows = await sql<
    Array<{
      id: string;
      unit_id: string;
      code_id: string;
      start_offset: number | null;
      end_offset: number | null;
      quote: string;
      memo: string;
    }>
  >`
    INSERT INTO annotations (round_id, unit_id, coder_id, code_id, start_offset, end_offset, quote)
    VALUES (${roundId}, ${unitId}, ${auth.coder.id}, ${codeId}, ${start}, ${end}, ${quote})
    ON CONFLICT (round_id, unit_id, coder_id, code_id, COALESCE(start_offset, -1), COALESCE(end_offset, -1))
    DO UPDATE SET updated_at = now()
    RETURNING id, unit_id, code_id, start_offset, end_offset, quote, memo
  `;

  // Opening a unit and coding it counts as progress, but never downgrades 'done'.
  await sql`
    INSERT INTO unit_progress (round_id, unit_id, coder_id, status)
    VALUES (${roundId}, ${unitId}, ${auth.coder.id}, 'in_progress')
    ON CONFLICT (round_id, unit_id, coder_id) DO NOTHING
  `;

  return Response.json({ annotation: rows[0] });
}

export async function PATCH(request: Request) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;

  const { id, memo } = (await request.json()) as { id?: string; memo?: string };
  if (!id) return Response.json({ error: "id is required." }, { status: 400 });

  const rows = await sql<{ id: string }[]>`
    UPDATE annotations SET memo = ${memo ?? ""}, updated_at = now()
    WHERE id = ${id} AND coder_id = ${auth.coder.id}
    RETURNING id
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Annotation not found, or not yours." }, { status: 404 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required." }, { status: 400 });

  // Coders can only remove their own annotations, and only in an open round.
  const rows = await sql<{ id: string }[]>`
    DELETE FROM annotations a
    USING rounds r
    WHERE a.id = ${id}
      AND a.coder_id = ${auth.coder.id}
      AND r.id = a.round_id
      AND r.status <> 'closed'
    RETURNING a.id
  `;
  if (rows.length === 0) {
    return Response.json(
      { error: "Nothing deleted. The annotation may belong to someone else, or the round is closed." },
      { status: 404 },
    );
  }
  return Response.json({ ok: true });
}
