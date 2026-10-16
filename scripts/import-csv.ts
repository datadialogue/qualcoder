/**
 * Loads a starter file into a study: CSV, JSON, JSON Lines, a Reddit export or
 * a bundle carrying its own codebook -- the same formats the New study page
 * accepts, read by the same code.
 *
 *   npm run import -- comments.jsonl --study="Reddit pilot"
 *   npm run import -- data.csv --study=<id> --text=justification --id=user_id,account
 *   npm run import -- starter.json --new                    (creates a study from the bundle)
 *   npm run import -- data.csv --new="Account suspension"   (creates a study with that name)
 *
 * --preset=reddit|generic overrides the detected format. Re-running updates
 * existing units matched on their id rather than duplicating them, so a
 * corrected export can be re-imported safely.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import "./load-env.ts";
import { argValue, requireStudy } from "./study-arg.ts";
import { buildUnits, defaultMapping, parseStarterFile, type Preset } from "../src/lib/starter.ts";
import { countCodes } from "../src/lib/codebook-parse.ts";

const { sql, json } = await import("../src/lib/db.ts");
const { upsertUnits } = await import("../src/lib/units-write.ts");
const { writeCodebook } = await import("../src/lib/codebook-write.ts");

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error(
    "Usage: npm run import -- <file> (--study=<id or name> | --new[=\"Study name\"])\n" +
      "       [--preset=reddit|generic] [--text=col1,col2] [--id=col1,col2]",
  );
  process.exit(1);
}

const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);
const parsed = parseStarterFile(readFileSync(file, "utf8"));
const preset = argValue("preset") as Preset | undefined;
const mapping = defaultMapping({
  ...parsed,
  mapping: {
    ...parsed.mapping,
    ...(preset ? { preset } : {}),
    ...(list(argValue("text")) ? { textFields: list(argValue("text")) } : {}),
    ...(list(argValue("id")) ? { idFields: list(argValue("id")) } : {}),
  },
});
for (const f of [...mapping.textFields, ...mapping.idFields]) {
  if (!parsed.fields.includes(f)) {
    console.error(`Column "${f}" not found. Available: ${parsed.fields.join(", ")}`);
    process.exit(1);
  }
}

const { units, stats } = buildUnits(parsed, mapping);
console.log(
  `Read ${stats.records} record(s) as ${parsed.format}, ${mapping.preset} preset -> ${units.length} unit(s)` +
    (mapping.preset === "generic" ? ` (text: ${mapping.textFields.join(" + ")})` : "") +
    ".",
);
for (const [k, v] of Object.entries(stats)) {
  if (!["records", "units"].includes(k) && v > 0) console.log(`  skipped ${v} (${k})`);
}

const isNew = process.argv.some((a) => a === "--new" || a.startsWith("--new="));
let study: { id: string; name: string };
if (isNew) {
  const name = argValue("new") || parsed.study?.name || basename(file).replace(/\.[^.]+$/, "");
  const [row] = await sql<{ id: string; name: string }[]>`
    INSERT INTO studies (name, description, source, settings)
    VALUES (${name}, ${parsed.study?.description ?? ""},
            ${mapping.preset === "reddit" ? "reddit" : parsed.format === "csv" ? "csv" : "json"},
            ${json({
              displayKeys: mapping.displayKeys,
              linkKey: mapping.preset === "reddit" ? "permalink" : undefined,
              mapping,
            })})
    RETURNING id, name
  `;
  study = row;
  console.log(`Created study "${row.name}" (${row.id}).`);
  if (parsed.codebook.length > 0) {
    const r = await sql.begin((tx) => writeCodebook(tx, row.id, parsed.codebook));
    console.log(`Codebook: ${r.codesAdded} of ${countCodes(parsed.codebook)} code(s) added.`);
  }
} else {
  study = await requireStudy(sql, argValue("study"));
}

let done = 0;
let inserted = 0;
for (let i = 0; i < units.length; i += 2000) {
  const r = await upsertUnits(sql, study.id, units.slice(i, i + 2000));
  inserted += r.inserted;
  done += Math.min(2000, units.length - i);
  process.stdout.write(`\r  imported ${done}/${units.length}`);
}

const [{ count }] = await sql<{ count: string }[]>`
  SELECT count(*)::text AS count FROM units WHERE study_id = ${study.id}
`;
console.log(`\nDone. ${inserted} new; "${study.name}" now has ${count} unit(s).`);
await sql.end();
