/**
 * Resolves the `--study=` argument shared by the CLI scripts. It accepts a
 * study id or an exact name. Without it, a database holding exactly one study
 * uses that one; otherwise the script lists the studies and stops.
 */
import type postgres from "postgres";

export interface StudyRow {
  id: string;
  name: string;
}

export function argValue(name: string): string | undefined {
  return process.argv
    .slice(2)
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
}

export async function findStudy(sql: postgres.Sql, wanted: string | undefined): Promise<StudyRow | null> {
  if (wanted) {
    const isId = /^[0-9a-f-]{36}$/i.test(wanted);
    const rows = await sql<StudyRow[]>`
      SELECT id, name FROM studies
      WHERE ${isId ? sql`id = ${wanted}` : sql`lower(name) = lower(${wanted})`}
    `;
    return rows[0] ?? null;
  }
  const rows = await sql<StudyRow[]>`SELECT id, name FROM studies ORDER BY created_at`;
  return rows.length === 1 ? rows[0] : null;
}

export async function requireStudy(sql: postgres.Sql, wanted: string | undefined): Promise<StudyRow> {
  const study = await findStudy(sql, wanted);
  if (study) return study;
  const all = await sql<StudyRow[]>`SELECT id, name FROM studies ORDER BY created_at`;
  console.error(
    wanted
      ? `No study matches "${wanted}".`
      : all.length === 0
        ? "There are no studies yet."
        : "More than one study exists; say which with --study=<id or name>.",
  );
  for (const s of all) console.error(`  ${s.id}  ${s.name}`);
  await sql.end();
  process.exit(1);
}
