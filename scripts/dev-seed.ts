/**
 * Development fixture: two example coders and one open round of 40 units in a
 * study that already has data. With --paper-codebook it also loads the
 * original study's codebook. Handy for trying the app out end to end.
 *   npm run import -- examples/reddit-starter.json --new
 *   npm run dev:seed -- --study="Reddit starter example"
 */
import "./load-env.ts";
import { randomBytes } from "node:crypto";
import { assignUnits, drawSample, type SampleInput, type SamplingConfig } from "../src/lib/sampling.ts";
import { argValue, requireStudy } from "./study-arg.ts";

const { sql, json } = await import("../src/lib/db.ts");
const { writeCodebook } = await import("../src/lib/codebook-write.ts");

const study = await requireStudy(sql, argValue("study"));
if (process.argv.includes("--paper-codebook")) {
  const { PAPER_CODEBOOK } = await import("./paper-codebook.ts");
  const r = await sql.begin((tx) => writeCodebook(tx, study.id, PAPER_CODEBOOK));
  console.log(`Codebook: ${r.codesAdded} code(s) added.`);
}

const coders: { id: string; name: string; token: string }[] = [];
for (const name of ["Ana Rivera", "Ben Okafor"]) {
  const token = randomBytes(24).toString("base64url");
  const existing = await sql<{ id: string; name: string; token: string }[]>`
    SELECT id, name, token FROM coders WHERE name = ${name}
  `;
  if (existing[0]) coders.push(existing[0]);
  else {
    const [row] = await sql<{ id: string; name: string; token: string }[]>`
      INSERT INTO coders (name, token, role) VALUES (${name}, ${token}, 'coder')
      RETURNING id, name, token
    `;
    coders.push(row);
  }
}
const lead = await sql<{ id: string; name: string; token: string }[]>`
  SELECT id, name, token FROM coders WHERE role = 'lead' ORDER BY created_at LIMIT 1
`;
const roster = [...lead, ...coders];

const existingRound = await sql<{ id: string }[]>`
  SELECT id FROM rounds WHERE name = 'dev fixture' AND study_id = ${study.id}
`;
if (existingRound.length > 0) {
  console.log("Dev round already exists; leaving it alone.");
} else {
  const config: SamplingConfig = {
    mode: "simple",
    size: 40,
    strata: [],
    filters: {},
    excludePriorRounds: false,
    overlapFraction: 0.2,
  };
  const seed = "dev-fixture-seed";
  const units = await sql<SampleInput[]>`SELECT id, meta FROM units WHERE study_id = ${study.id}`;
  if (units.length === 0) {
    console.error(`"${study.name}" has no units; import data into it first.`);
    process.exit(1);
  }
  const unitIds = drawSample(units, config, seed);
  const pairs = assignUnits(unitIds, roster.map((c) => c.id), "full", seed);

  await sql.begin(async (tx) => {
    const [{ next }] = await tx<{ next: number }[]>`
      SELECT COALESCE(max(number),0)+1 AS next FROM rounds WHERE study_id = ${study.id}
    `;
    const [round] = await tx<{ id: string }[]>`
      INSERT INTO rounds (study_id, number, name, status, sampling, seed, overlap_mode, opened_at)
      VALUES (${study.id}, ${next}, 'dev fixture', 'open', ${json(config)}, ${seed}, 'full', now())
      RETURNING id
    `;
    await tx`INSERT INTO round_units ${tx(unitIds.map((id, i) => ({ round_id: round.id, unit_id: id, position: i })), "round_id", "unit_id", "position")}`;
    await tx`INSERT INTO assignments ${tx(roster.map((c) => ({ round_id: round.id, coder_id: c.id })), "round_id", "coder_id")}`;
    await tx`INSERT INTO unit_assignments ${tx(pairs.map((p) => ({ round_id: round.id, unit_id: p.unitId, coder_id: p.coderId })), "round_id", "unit_id", "coder_id")}`;
    console.log(`Round ${next}: ${unitIds.length} units, ${roster.length} coders.`);
  });
}

console.log("\nInvite links:");
for (const c of roster) console.log(`  ${c.name.padEnd(14)} http://localhost:3000/join/${c.token}`);
await sql.end();
