import { sql } from "@/lib/db";
import { coderOrUnauthorized } from "@/lib/auth";
import { pickColor } from "@/lib/palette";

/**
 * Creates a code from inside the coding workspace.
 *
 * Any coder may do this: needing a code that does not exist yet is a normal
 * part of open coding, and forcing people to stop and ask the lead pushes them
 * towards misapplying an existing code instead. Codes made this way are marked
 * `provisional` and attributed to their author so the lead can review or
 * rename them, and the team can merge them, before the next round.
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
  // A code merged into another resolves to the code it became, so typing an
  // old name lands on the agreed code rather than reviving the old one.
  const existing = await sql<
    Array<{
      id: string;
      name: string;
      color: string;
      definition: string;
      theme_id: string | null;
      archived: boolean;
      merged_name: string | null;
    }>
  >`
    SELECT COALESCE(m.id, c.id) AS id, COALESCE(m.name, c.name) AS name,
           COALESCE(m.color, c.color) AS color, COALESCE(m.definition, c.definition) AS definition,
           CASE WHEN m.id IS NULL THEN c.theme_id ELSE m.theme_id END AS theme_id,
           COALESCE(m.archived, c.archived) AS archived,
           CASE WHEN m.id IS NULL THEN NULL ELSE c.name END AS merged_name
    FROM codes c LEFT JOIN codes m ON m.id = c.merged_into
    WHERE c.study_id = ${studyId} AND lower(c.name) = lower(${name})
    ORDER BY (c.merged_into IS NULL) DESC
  `;
  if (existing.length > 0) {
    const code = existing[0];
    if (code.merged_name) {
      if (code.archived) {
        await sql`UPDATE codes SET archived = false, updated_at = now() WHERE id = ${code.id}`;
      }
      const { merged_name, ...rest } = code;
      return Response.json({
        code: { ...rest, archived: false, inclusion: "", exclusion: "", example: "" },
        existed: true,
        message: `"${merged_name}" was merged into "${code.name}", so that code was used.`,
      });
    }
    if (code.archived) {
      await sql`UPDATE codes SET archived = false, updated_at = now() WHERE id = ${code.id}`;
    }
    return Response.json({
      code: { ...code, merged_name: undefined, archived: false, inclusion: "", exclusion: "", example: "" },
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
