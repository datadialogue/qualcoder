/**
 * Applies db/migrations/*.sql in filename order, once each.
 *   npm run db:migrate
 *   npm run db:reset      (drops everything first -- destroys all coding)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import "./load-env.ts";

const { sql } = await import("../src/lib/db.ts");

const reset = process.argv.includes("--reset");

if (reset) {
  if (!process.argv.includes("--yes")) {
    console.error(
      "Refusing to reset without --yes. This drops every table and deletes all coding.",
    );
    process.exit(1);
  }
  console.log("Dropping schema public ...");
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
}

await sql`
  CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

const dir = join(process.cwd(), "db", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const done = new Set(
  (await sql<{ name: string }[]>`SELECT name FROM _migrations`).map((r) => r.name),
);

let applied = 0;
for (const file of files) {
  if (done.has(file)) continue;
  const body = readFileSync(join(dir, file), "utf8");
  console.log(`applying ${file}`);
  // One transaction per migration: a failure leaves nothing half-created.
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`INSERT INTO _migrations (name) VALUES (${file})`;
  });
  applied++;
}

console.log(
  applied === 0 ? "Already up to date." : `Applied ${applied} migration(s).`,
);
await sql.end();
