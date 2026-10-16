"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { leadGuard } from "@/lib/auth";
import { parseCsv } from "@/lib/csv";
import type { ActionResult } from "@/lib/action-result";

// Distinguishable in both themes and reasonably colour-blind safe.
const PALETTE = [
  "#2f6f5e", "#8c5a2b", "#3b5f9e", "#8a3d6b", "#6b6a2f",
  "#2e6f7a", "#94472f", "#5a4a8c", "#3f7a3f", "#7a3f52",
];

function pick(index: number): string {
  return PALETTE[index % PALETTE.length];
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

export async function createTheme(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const name = str(fd, "name");
  if (!name) return { error: "A theme needs a name." };
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM themes`;
  await sql`
    INSERT INTO themes (name, description, color, position)
    VALUES (${name}, ${str(fd, "description")}, ${pick(n)}, ${n})
    ON CONFLICT (name) DO NOTHING
  `;
  revalidatePath("/codebook");
  return null;
}

export async function updateTheme(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  await sql`
    UPDATE themes
    SET name = ${str(fd, "name")},
        description = ${str(fd, "description")},
        color = ${str(fd, "color") || "#64748b"}
    WHERE id = ${str(fd, "id")}
  `;
  revalidatePath("/codebook");
  return null;
}

export async function deleteTheme(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  // Codes survive; they fall back to "Unfiled" so no coding is lost.
  await sql`DELETE FROM themes WHERE id = ${str(fd, "id")}`;
  revalidatePath("/codebook");
  return null;
}

export async function createCode(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const name = str(fd, "name");
  if (!name) return { error: "A code needs a name." };
  const themeId = str(fd, "theme_id");
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM codes`;
  await sql`
    INSERT INTO codes (theme_id, name, definition, color, position)
    VALUES (${themeId || null}, ${name}, ${str(fd, "definition")}, ${pick(n)}, ${n})
    ON CONFLICT (name) DO NOTHING
  `;
  revalidatePath("/codebook");
  return null;
}

export async function updateCode(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  await sql`
    UPDATE codes SET
      name       = ${str(fd, "name")},
      theme_id   = ${str(fd, "theme_id") || null},
      definition = ${str(fd, "definition")},
      inclusion  = ${str(fd, "inclusion")},
      exclusion  = ${str(fd, "exclusion")},
      example    = ${str(fd, "example")},
      color      = ${str(fd, "color") || "#3b82f6"},
      updated_at = now()
    WHERE id = ${str(fd, "id")}
  `;
  revalidatePath("/codebook");
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
  await sql`
    UPDATE codes SET archived = ${str(fd, "archived") === "true"}, updated_at = now()
    WHERE id = ${str(fd, "id")}
  `;
  revalidatePath("/codebook");
  return null;
}

export async function deleteCode(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const id = str(fd, "id");
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM annotations WHERE code_id = ${id}
  `;
  if (n > 0) {
    return {
      error: `That code is used by ${n} annotation(s). Archive it instead so existing coding stays intact.`,
    };
  }
  await sql`DELETE FROM codes WHERE id = ${id}`;
  revalidatePath("/codebook");
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
  await sql`
    UPDATE codes SET provisional = false, updated_at = now() WHERE id = ${str(fd, "id")}
  `;
  revalidatePath("/codebook");
  return { ok: "Kept in the codebook." };
}

/**
 * Bulk import. Accepts tab- or comma-separated rows of
 * `theme, code, definition`, with or without a header line.
 */
export async function importCodebook(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const raw = String(fd.get("text") ?? "").trim();
  if (!raw) return { error: "Nothing to import." };

  const useTabs = raw.includes("\t");
  let records: Array<{ theme: string; code: string; definition: string }> = [];

  if (useTabs) {
    records = raw
      .split(/\r?\n/)
      .map((line) => line.split("\t"))
      .filter((cells) => cells.some((c) => c.trim()))
      .map((cells) => ({
        theme: (cells[0] ?? "").trim(),
        code: (cells[1] ?? "").trim(),
        definition: (cells[2] ?? "").trim(),
      }));
  } else {
    const { headers, rows } = parseCsv(raw);
    const lower = headers.map((h) => h.toLowerCase());
    const hasHeader = lower.includes("code") || lower.includes("theme");
    if (hasHeader) {
      const find = (...names: string[]) =>
        headers[lower.findIndex((h) => names.includes(h))] ?? "";
      const tk = find("theme", "category");
      const ck = find("code", "label");
      const dk = find("definition", "description");
      records = rows.map((r) => ({
        theme: (r[tk] ?? "").trim(),
        code: (r[ck] ?? "").trim(),
        definition: (r[dk] ?? "").trim(),
      }));
    } else {
      records = raw
        .split(/\r?\n/)
        .map((line) => parseCsv(line).headers)
        .filter((cells) => cells.some((c) => c.trim()))
        .map((cells) => ({
          theme: (cells[0] ?? "").trim(),
          code: (cells[1] ?? "").trim(),
          definition: (cells[2] ?? "").trim(),
        }));
    }
  }

  // A single column is read as a list of codes with no theme.
  records = records
    .map((r) => (r.code ? r : { theme: "", code: r.theme, definition: r.definition }))
    .filter((r) => r.code);

  if (records.length === 0) {
    return { error: "Could not find any codes in that text." };
  }

  let themesAdded = 0;
  let codesAdded = 0;

  await sql.begin(async (tx) => {
    const themeIds = new Map<string, string>();
    for (const { theme } of records) {
      if (!theme || themeIds.has(theme)) continue;
      const existing = await tx<{ id: string }[]>`SELECT id FROM themes WHERE name = ${theme}`;
      if (existing[0]) {
        themeIds.set(theme, existing[0].id);
        continue;
      }
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM themes`;
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO themes (name, color, position) VALUES (${theme}, ${pick(n)}, ${n})
        RETURNING id
      `;
      themeIds.set(theme, created.id);
      themesAdded++;
    }

    for (const r of records) {
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM codes`;
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO codes (theme_id, name, definition, color, position)
        VALUES (${r.theme ? themeIds.get(r.theme)! : null}, ${r.code}, ${r.definition},
                ${pick(n)}, ${n})
        ON CONFLICT (name) DO UPDATE
          SET definition = CASE WHEN EXCLUDED.definition <> '' THEN EXCLUDED.definition
                                ELSE codes.definition END,
              theme_id   = COALESCE(EXCLUDED.theme_id, codes.theme_id),
              updated_at = now()
        RETURNING id
      `;
      if (inserted.length > 0) codesAdded++;
    }
  });

  revalidatePath("/codebook");
  return { ok: `Imported ${codesAdded} code(s) and ${themesAdded} new theme(s).` };
}
