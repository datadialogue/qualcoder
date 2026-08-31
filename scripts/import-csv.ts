/**
 * Loads a CSV into `units`. One row becomes one codeable unit; every other
 * column is kept in `meta` so exports can join back to the original data.
 *
 *   npm run import -- "Qual Analysis - accounts_tidy.csv"
 *   npm run import -- data.csv --text=justification --id=user_id,account
 *
 * Re-running updates existing units matched on their external id rather than
 * duplicating them, so a corrected export can be re-imported safely.
 */
import { readFileSync } from "node:fs";
import "./load-env.ts";
import { parseCsv } from "../src/lib/csv.ts";

const { sql } = await import("../src/lib/db.ts");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const opt = (name: string, fallback: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

if (!file) {
  console.error('Usage: npm run import -- <file.csv> [--text=justification] [--id=user_id,account]');
  process.exit(1);
}

const textColumn = opt("text", "justification");
const idColumns = opt("id", "user_id,account").split(",").map((s) => s.trim()).filter(Boolean);

const { headers, rows } = parseCsv(readFileSync(file, "utf8"));
if (!headers.includes(textColumn)) {
  console.error(`Column "${textColumn}" not found. Available: ${headers.join(", ")}`);
  process.exit(1);
}
for (const c of idColumns) {
  if (!headers.includes(c)) {
    console.error(`Id column "${c}" not found. Available: ${headers.join(", ")}`);
    process.exit(1);
  }
}

const seen = new Set<string>();
const units = rows.flatMap((row, i) => {
  const text = (row[textColumn] ?? "").trim();
  if (!text) return [];
  const externalId = idColumns.map((c) => row[c]).join("::") || `row-${i + 1}`;
  if (seen.has(externalId)) {
    console.warn(`  duplicate external id "${externalId}" at row ${i + 2}; skipping`);
    return [];
  }
  seen.add(externalId);
  const meta: Record<string, string> = {};
  for (const h of headers) if (h !== textColumn) meta[h] = row[h] ?? "";
  return [{ external_id: externalId, text, meta }];
});

console.log(`Parsed ${rows.length} row(s) -> ${units.length} unit(s).`);

let written = 0;
const CHUNK = 500;
for (let i = 0; i < units.length; i += CHUNK) {
  const batch = units.slice(i, i + CHUNK);
  await sql`
    INSERT INTO units ${sql(batch, "external_id", "text", "meta")}
    ON CONFLICT (external_id) DO UPDATE
      SET text = EXCLUDED.text, meta = EXCLUDED.meta
  `;
  written += batch.length;
  process.stdout.write(`\r  imported ${written}/${units.length}`);
}

const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM units`;
console.log(`\nDone. ${count} unit(s) in the database.`);
await sql.end();
