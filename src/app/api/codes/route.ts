import { sql } from "@/lib/db";
import { coderOrUnauthorized } from "@/lib/auth";
import { pickColor } from "@/lib/palette";

/**
 * Creates a code from inside the coding workspace.
 *
 * Any coder may do this: needing a code that does not exist yet is a normal
 * part of open coding, and forcing people to stop and ask the lead pushes them
 * towards misapplying an existing code instead. Codes made this way are marked
 * `provisional` and attributed to their author so the lead can review, rename
 * or merge them before the next round.
 *
 * The code joins the codebook of the round's study, and only a coder on that
 * round may add one.
 */
export async function POST(request: Request) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;

  const body = (await request.json()) as {
    roundId?: string;
    name?: string;
    themeId?: string | null;
    definition?: string;
  };

  const name = (body.name ?? "").trim();
  if (!name) {
    return Response.json({ error: "Give the code a name." }, { status: 400 });
  }
  if (name.length > 120) {
    return Response.json({ error: "That name is too long (120 characters max)." }, { status: 400 });
  }
  if (!body.roundId) {
    return Response.json({ error: "roundId is required." }, { status: 400 });
  }

  const round = await sql<{ study_id: string; status: string }[]>`
    SELECT r.study_id, r.status FROM rounds r
    JOIN assignments a ON a.round_id = r.id AND a.coder_id = ${auth.coder.id}
    WHERE r.id = ${body.roundId}
  `;
  if (round.length === 0) {
    return Response.json({ error: "You are not assigned to that round." }, { status: 403 });
  }
  if (round[0].status === "closed") {
    return Response.json({ error: "This round is closed." }, { status: 403 });
  }
  const studyId = round[0].study_id;

  // An existing name is not an error worth stopping for: hand back the code
  // that already exists so the caller can simply apply it.
  const existing = await sql<
    Array<{ id: string; name: string; color: string; definition: string; theme_id: string | null; archived: boolean }>
  >`
    SELECT id, name, color, definition, theme_id, archived
    FROM codes WHERE study_id = ${studyId} AND lower(name) = lower(${name})
  `;
  if (existing.length > 0) {
    const code = existing[0];
    if (code.archived) {
      await sql`UPDATE codes SET archived = false, updated_at = now() WHERE id = ${code.id}`;
    }
    return Response.json({
      code: { ...code, archived: false, inclusion: "", exclusion: "", example: "" },
      existed: true,
      message: code.archived
        ? `"${code.name}" already existed and was archived; it has been restored.`
        : `"${code.name}" already exists, so that code was used.`,
    });
  }

  const themeId = body.themeId?.trim() || null;
  if (themeId) {
    const theme = await sql<{ id: string }[]>`
      SELECT id FROM themes WHERE id = ${themeId} AND study_id = ${studyId}
    `;
    if (theme.length === 0) {
      return Response.json({ error: "That theme no longer exists." }, { status: 400 });
    }
  }

  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM codes WHERE study_id = ${studyId}
  `;

  const [code] = await sql<
    Array<{
      id: string;
      name: string;
      color: string;
      definition: string;
      inclusion: string;
      exclusion: string;
      example: string;
      theme_id: string | null;
    }>
  >`
    INSERT INTO codes (study_id, theme_id, name, definition, color, position, created_by, provisional)
    VALUES (${studyId}, ${themeId}, ${name}, ${(body.definition ?? "").trim()},
            ${pickColor(n)}, ${n}, ${auth.coder.id}, true)
    RETURNING id, name, color, definition, inclusion, exclusion, example, theme_id
  `;

  return Response.json({ code, existed: false });
}
