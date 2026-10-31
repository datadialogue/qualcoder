"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { leadGuard } from "@/lib/auth";
import { countCodes, parseCodebookText } from "@/lib/codebook-parse";
import { writeCodebook } from "@/lib/codebook-write";
import { pickColor } from "@/lib/palette";
import type { ActionResult } from "@/lib/action-result";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/** Every form on the codebook page posts the study it belongs to. */
function studyOf(fd: FormData) {
  const studyId = str(fd, "study_id");
  return { studyId, path: `/studies/${studyId}/codebook` };
}

export async function createTheme(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const { studyId, path } = studyOf(fd);
  const name = str(fd, "name");
  if (!name) return { error: "A theme needs a name." };
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM themes WHERE study_id = ${studyId}
  `;
  await sql`
    INSERT INTO themes (study_id, name, description, color, position)
    VALUES (${studyId}, ${name}, ${str(fd, "description")}, ${pickColor(n)}, ${n})
    ON CONFLICT (study_id, name) DO NOTHING
  `;
  revalidatePath(path);
  return null;
}

export async function updateTheme(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const { studyId, path } = studyOf(fd);
  await sql`
    UPDATE themes
    SET name = ${str(fd, "name")},
        description = ${str(fd, "description")},
        color = ${str(fd, "color") || "#64748b"}
    WHERE id = ${str(fd, "id")} AND study_id = ${studyId}
  `;
  revalidatePath(path);
  return null;
}

export async function deleteTheme(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const { studyId, path } = studyOf(fd);
  // Codes survive; they fall back to "Unfiled" so no coding is lost.
  await sql`DELETE FROM themes WHERE id = ${str(fd, "id")} AND study_id = ${studyId}`;
  revalidatePath(path);
  return null;
}

export async function createCode(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const { studyId, path } = studyOf(fd);
  const name = str(fd, "name");
  if (!name) return { error: "A code needs a name." };
  const themeId = str(fd, "theme_id");
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM codes WHERE study_id = ${studyId}
  `;
  await sql`
    INSERT INTO codes (study_id, theme_id, name, definition, color, position)
    SELECT ${studyId}, ${themeId || null}, ${name}, ${str(fd, "definition")}, ${pickColor(n)}, ${n}
    WHERE ${themeId || null}::uuid IS NULL
       OR EXISTS (SELECT 1 FROM themes WHERE id = ${themeId || null} AND study_id = ${studyId})
    ON CONFLICT (study_id, name) DO NOTHING
  `;
  revalidatePath(path);
  return null;
}

export async function updateCode(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const { studyId, path } = studyOf(fd);
  const themeId = str(fd, "theme_id") || null;
  await sql`
    UPDATE codes SET
      name       = ${str(fd, "name")},
      theme_id   = (SELECT id FROM themes WHERE id = ${themeId} AND study_id = ${studyId}),
      definition = ${str(fd, "definition")},
      inclusion  = ${str(fd, "inclusion")},
      exclusion  = ${str(fd, "exclusion")},
      example    = ${str(fd, "example")},
      color      = ${str(fd, "color") || "#3b82f6"},
      updated_at = now()
    WHERE id = ${str(fd, "id")} AND study_id = ${studyId}
  `;
  revalidatePath(path);
  return null;
}

/**
 * Archiving keeps a code out of the palette while preserving every annotation
 * that used it, so historic rounds stay analysable. Deleting is only offered
 * for codes nothing has been coded with.
 */
export async function setCodeArchived(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const { studyId, path } = studyOf(fd);
  // A merged code stays archived: its annotations now live on the code it became.
  await sql`
    UPDATE codes SET archived = ${str(fd, "archived") === "true"}, updated_at = now()
    WHERE id = ${str(fd, "id")} AND study_id = ${studyId} AND merged_into IS NULL
  `;
  revalidatePath(path);
  return null;
}

export async function deleteCode(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const { studyId, path } = studyOf(fd);
  const id = str(fd, "id");
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM annotations WHERE code_id = ${id}
  `;
  if (n > 0) {
    return {
      error: `That code is used by ${n} annotation(s). Archive it instead so existing coding stays intact.`,
    };
  }
  const [{ merges }] = await sql<{ merges: number }[]>`
    SELECT (SELECT count(*)::int FROM code_merge_codes WHERE code_id = ${id})
         + (SELECT count(*)::int FROM codes WHERE merged_into = ${id}) AS merges
  `;
  if (merges > 0) {
    return { error: "That code is part of a merge proposal or merge history. Archive it instead." };
  }
  await sql`DELETE FROM codes WHERE id = ${id} AND study_id = ${studyId}`;
  revalidatePath(path);
  return null;
}

/**
 * Marks a code created during coding as reviewed. Confirming does not change
 * any annotation -- it only records that the lead has looked at the code and is
 * keeping it, so the next round starts from a codebook that has been agreed.
 */
export async function confirmCode(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const { studyId, path } = studyOf(fd);
  await sql`
    UPDATE codes SET provisional = false, updated_at = now()
    WHERE id = ${str(fd, "id")} AND study_id = ${studyId}
  `;
  revalidatePath(path);
  return { ok: "Kept in the codebook." };
}

/**
 * Bulk import. Accepts tab- or comma-separated rows of
 * `theme, code, definition`, with or without a header line, or JSON.
 */
export async function importCodebook(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const { studyId, path } = studyOf(fd);
  const raw = String(fd.get("text") ?? "").trim();
  if (!raw) return { error: "Nothing to import." };

  const themes = parseCodebookText(raw);
  if (countCodes(themes) === 0) return { error: "Could not find any codes in that text." };

  const result = await sql.begin((tx) => writeCodebook(tx, studyId, themes));
  revalidatePath(path);
  return {
    ok:
      `Added ${result.codesAdded} code(s) and ${result.themesAdded} new theme(s)` +
      (result.codesUpdated ? `; updated ${result.codesUpdated} existing code(s).` : "."),
  };
}
