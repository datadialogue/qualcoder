import { sql } from "@/lib/db";
import { coderOrUnauthorized } from "@/lib/auth";

// Same palette the codebook page uses, so codes made mid-coding do not look
// out of place next to the ones the lead created.
const PALETTE = [
  "#2f6f5e", "#8c5a2b", "#3b5f9e", "#8a3d6b", "#6b6a2f",
  "#2e6f7a", "#94472f", "#5a4a8c", "#3f7a3f", "#7a3f52",
];

/**
 * Creates a code from inside the coding workspace.
 *
 * Any coder may do this: needing a code that does not exist yet is a normal
 * part of open coding, and forcing people to stop and ask the lead pushes them
 * towards misapplying an existing code instead. Codes made this way are marked
 * `provisional` and attributed to their author so the lead can review, rename
 * or merge them before the next round.
 */
export async function POST(request: Request) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;

  const body = (await request.json()) as {
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

  // An existing name is not an error worth stopping for: hand back the code
  // that already exists so the caller can simply apply it.
  const existing = await sql<
    Array<{ id: string; name: string; color: string; definition: string; theme_id: string | null; archived: boolean }>
  >`
    SELECT id, name, color, definition, theme_id, archived
    FROM codes WHERE lower(name) = lower(${name})
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
    const theme = await sql<{ id: string }[]>`SELECT id FROM themes WHERE id = ${themeId}`;
    if (theme.length === 0) {
      return Response.json({ error: "That theme no longer exists." }, { status: 400 });
    }
  }

  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM codes`;

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
    INSERT INTO codes (theme_id, name, definition, color, position, created_by, provisional)
    VALUES (${themeId}, ${name}, ${(body.definition ?? "").trim()},
            ${PALETTE[n % PALETTE.length]}, ${n}, ${auth.coder.id}, true)
    RETURNING id, name, color, definition, inclusion, exclusion, example, theme_id
  `;

  return Response.json({ code, existed: false });
}
