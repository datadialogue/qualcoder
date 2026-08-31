/**
 * Creates (or re-issues an invite for) a coder and prints their invite link.
 *   npm run seed:lead -- --name="Alireza" --role=lead
 *   npm run seed:lead -- --name="Ana" --role=coder --url=https://your-app.vercel.app
 */
import "./load-env.ts";
import { randomBytes } from "node:crypto";

const { sql } = await import("../src/lib/db.ts");

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

const name = opt("name", "").trim();
const role = opt("role", "lead");
const base = opt("url", process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!name) {
  console.error('Usage: npm run seed:lead -- --name="Your Name" [--role=lead|coder] [--url=...]');
  process.exit(1);
}
if (role !== "lead" && role !== "coder") {
  console.error("--role must be 'lead' or 'coder'");
  process.exit(1);
}

const token = randomBytes(24).toString("base64url");
const [coder] = await sql<{ id: string; name: string; role: string; token: string }[]>`
  INSERT INTO coders (name, token, role) VALUES (${name}, ${token}, ${role})
  ON CONFLICT DO NOTHING
  RETURNING id, name, role, token
`;

const record =
  coder ??
  (
    await sql<{ id: string; name: string; role: string; token: string }[]>`
      UPDATE coders SET token = ${token}, role = ${role}, active = true
      WHERE name = ${name} RETURNING id, name, role, token
    `
  )[0];

if (!record) {
  console.error(`Could not create or find a coder named "${name}".`);
  process.exit(1);
}

console.log(`\n  ${record.name} (${record.role})`);
console.log(`  Invite link: ${base}/join/${record.token}\n`);
console.log("  Treat this link as a password: anyone holding it codes as this person.\n");
await sql.end();
