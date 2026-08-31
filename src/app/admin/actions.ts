"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { leadGuard, newInviteToken } from "@/lib/auth";
import { parseCsv } from "@/lib/csv";
import type { ActionResult } from "@/lib/action-result";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function createCoder(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const name = str(fd, "name");
  if (!name) return { error: "A coder needs a name." };
  const role = str(fd, "role") === "lead" ? "lead" : "coder";

  const existing = await sql<{ id: string }[]>`SELECT id FROM coders WHERE name = ${name}`;
  if (existing.length > 0) {
    return { error: `There is already a coder called "${name}".` };
  }

  await sql`
    INSERT INTO coders (name, email, token, role)
    VALUES (${name}, ${str(fd, "email") || null}, ${newInviteToken()}, ${role})
  `;
  revalidatePath("/admin");
  return { ok: `Added ${name}. Their invite link is in the list below — send it to them directly.` };
}

/** Invalidates the old link immediately; use if one leaks. */
export async function regenerateToken(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  await sql`UPDATE coders SET token = ${newInviteToken()} WHERE id = ${str(fd, "id")}`;
  revalidatePath("/admin");
  return { ok: "New link issued. The previous one no longer works." };
}

export async function setCoderActive(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const active = str(fd, "active") === "true";
  const id = str(fd, "id");

  if (!active) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM coders WHERE role = 'lead' AND active = true AND id <> ${id}
    `;
    const [{ isLead }] = await sql<{ isLead: boolean }[]>`
      SELECT role = 'lead' AS "isLead" FROM coders WHERE id = ${id}
    `;
    if (isLead && n === 0) {
      return { error: "That is the only active lead. Promote someone else first." };
    }
  }

  await sql`UPDATE coders SET active = ${active} WHERE id = ${id}`;
  revalidatePath("/admin");
  return { ok: active ? "Reactivated." : "Deactivated. Their coding is kept." };
}

export async function setCoderRole(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const role = str(fd, "role") === "lead" ? "lead" : "coder";
  const id = str(fd, "id");

  if (role === "coder") {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM coders WHERE role = 'lead' AND active = true AND id <> ${id}
    `;
    if (n === 0) return { error: "Someone has to be lead. Promote another coder first." };
  }
  await sql`UPDATE coders SET role = ${role} WHERE id = ${id}`;
  revalidatePath("/admin");
  return { ok: `Role set to ${role}.` };
}

/**
 * Imports a CSV of units. Matching on `external_id` means re-importing a
 * corrected file updates units in place rather than duplicating them, and
 * existing coding stays attached.
 */
export async function importUnits(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." };
  }
  const textColumn = str(fd, "text_column");
  const idColumns = str(fd, "id_columns")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!textColumn) return { error: "Name the column holding the text to be coded." };

  const { headers, rows } = parseCsv(await file.text());
  if (!headers.includes(textColumn)) {
    return { error: `Column "${textColumn}" not found. Found: ${headers.join(", ")}` };
  }
  for (const c of idColumns) {
    if (!headers.includes(c)) {
      return { error: `Id column "${c}" not found. Found: ${headers.join(", ")}` };
    }
  }

  const seen = new Set<string>();
  const units = rows.flatMap((row, i) => {
    const text = (row[textColumn] ?? "").trim();
    if (!text) return [];
    const externalId = idColumns.length
      ? idColumns.map((c) => row[c]).join("::")
      : `row-${i + 1}`;
    if (seen.has(externalId)) return [];
    seen.add(externalId);
    const meta: Record<string, string> = {};
    for (const h of headers) if (h !== textColumn) meta[h] = row[h] ?? "";
    return [{ external_id: externalId, text, meta }];
  });

  if (units.length === 0) return { error: "No rows with text were found in that file." };

  for (let i = 0; i < units.length; i += 500) {
    await sql`
      INSERT INTO units ${sql(units.slice(i, i + 500), "external_id", "text", "meta")}
      ON CONFLICT (external_id) DO UPDATE
        SET text = EXCLUDED.text, meta = EXCLUDED.meta
    `;
  }

  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: `Imported ${units.length} unit(s) from ${rows.length} row(s).` };
}
