/**
 * Dummy data for `npm run dev:local`: the Reddit starter study, a lead and two
 * coders with fixed invite links, a closed pilot round both coders finished,
 * and an open second round to keep coding in.
 *
 * The coding is written by hand rather than generated so it reads like real
 * work: the coders mostly agree, each has invented a code that duplicates an
 * existing one ("Pro bike lane", "Money"), and one merge proposal is already
 * waiting for a vote -- enough to try exploring, reliability and merging
 * straight away.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type postgres from "postgres";
import { buildUnits, defaultMapping, parseStarterFile } from "../src/lib/starter.ts";
import { upsertUnits } from "../src/lib/units-write.ts";
import { writeCodebook } from "../src/lib/codebook-write.ts";
import { pickColor } from "../src/lib/palette.ts";
import type { SamplingConfig } from "../src/lib/sampling.ts";

/** Fixed tokens, so the invite links survive a reset. Local data only. */
export const LOCAL_PEOPLE = [
  { name: "Local Lead", role: "lead", token: "local-lead" },
  { name: "Ana Rivera", role: "coder", token: "local-ana" },
  { name: "Ben Okafor", role: "coder", token: "local-ben" },
] as const;

type Person = "ana" | "ben";
/** [code, phrase]: the phrase is found in the unit's text; null codes the whole unit. */
type Coding = Array<[code: string, phrase: string | null, memo?: string]>;

const PILOT: Record<string, Record<Person, Coding>> = {
  t3_x1a001: {
    ana: [["Asks for information", "Thoughts?"]],
    ben: [["Asks for information", "Thoughts?"], ["Opposes", "remove 40 parking spots"]],
  },
  t1_c0001: {
    ana: [
      ["Personal experience", "I bike Elm every morning and get buzzed by a car at least twice a week"],
      ["Safety", "get buzzed by a car"],
      ["Pro bike lane", "A curb between me and traffic would change everything", "Not quite 'Supports' -- they want this specific design."],
    ],
    ben: [
      ["Personal experience", "I bike Elm every morning"],
      ["Safety", "get buzzed by a car at least twice a week"],
      ["Supports", "A curb between me and traffic would change everything."],
    ],
  },
  t1_c0002: {
    ana: [["Opposes", null], ["Personal experience", "Half my customers drive in from out of town"]],
    ben: [
      ["Opposes", null],
      ["Personal experience", "Forty spots is most of the parking on my block"],
      ["Money", "Half my customers drive in from out of town", "Lost business is a money argument."],
    ],
  },
  t1_c0003: {
    ana: [["Asks for information", null]],
    ben: [["Asks for information", null]],
  },
  t1_c0005: {
    ana: [["Opposes", null], ["Cost or money", "The estimate is $2.1M for eight blocks"]],
    ben: [["Opposes", null], ["Money", "The estimate is $2.1M for eight blocks"], ["Money", "potholes we could fill instead"]],
  },
  t1_c0006: {
    ana: [["Pro bike lane", null, "Sarcastic, but clearly in favour."], ["Safety", "people get hit"]],
    ben: [["Supports", null], ["Safety", "while people get hit"]],
  },
  t3_x1a002: {
    ana: [["Asks for information", null]],
    ben: [["Asks for information", null]],
  },
  t1_c0007: { ana: [], ben: [] },
  t1_c0008: {
    ana: [["Supports", null], ["Safety", "The injury numbers on Elm are worse than I assumed"]],
    ben: [["Pro bike lane", null], ["Safety", "injury numbers on Elm are worse"]],
  },
};

/** Ana has started the second round; Ben has not. */
const SECOND_ROUND_ANA = ["t3_x1a001", "t1_c0001", "t1_c0002"];

export async function ensureLocalPeople(sql: postgres.Sql) {
  const out: Record<string, { id: string; name: string; token: string }> = {};
  for (const p of LOCAL_PEOPLE) {
    const [row] = await sql<{ id: string; name: string; token: string }[]>`
      INSERT INTO coders (name, token, role) VALUES (${p.name}, ${p.token}, ${p.role})
      ON CONFLICT (token) DO UPDATE SET active = true
      RETURNING id, name, token
    `;
    out[p.token] = row;
  }
  return { lead: out["local-lead"], ana: out["local-ana"], ben: out["local-ben"] };
}

export async function seedLocalFixture(sql: postgres.Sql): Promise<void> {
  const people = await ensureLocalPeople(sql);
  const parsed = parseStarterFile(
    readFileSync(join(process.cwd(), "examples", "reddit-starter.json"), "utf8"),
  );
  const mapping = defaultMapping(parsed);
  const { units } = buildUnits(parsed, mapping);

  await sql.begin(async (tx) => {
    const [study] = await tx<{ id: string }[]>`
      INSERT INTO studies (name, description, source, settings, created_by)
      VALUES (${parsed.study?.name ?? "Local example"}, ${parsed.study?.description ?? ""}, 'reddit',
              ${tx.json({ displayKeys: mapping.displayKeys, linkKey: "permalink" } as postgres.JSONValue)},
              ${people.lead.id})
      RETURNING id
    `;
    await writeCodebook(tx, study.id, parsed.codebook);
    await upsertUnits(tx, study.id, units);

    // Codes the coders invented mid-coding, duplicating existing ones.
    const themes = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM themes WHERE study_id = ${study.id}
    `;
    const themeId = (name: string) => themes.find((t) => t.name === name)?.id ?? null;
    const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM codes WHERE study_id = ${study.id}`;
    await tx`
      INSERT INTO codes (study_id, theme_id, name, definition, color, position, created_by, provisional)
      VALUES (${study.id}, ${themeId("Stance")}, 'Pro bike lane', 'Wants the bike lane built.',
              ${pickColor(n)}, ${n}, ${people.ana.id}, true),
             (${study.id}, ${themeId("Reasoning")}, 'Money', '',
              ${pickColor(n + 1)}, ${n + 1}, ${people.ben.id}, true)
    `;

    const codeRows = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM codes WHERE study_id = ${study.id}
    `;
    const codeId = new Map(codeRows.map((c) => [c.name, c.id]));
    const unitRows = await tx<{ id: string; external_id: string; text: string }[]>`
      SELECT id, external_id, text FROM units WHERE study_id = ${study.id} ORDER BY created_at, external_id
    `;
    const coders = [people.ana, people.ben];

    const makeRound = async (number: number, name: string, status: "open" | "closed") => {
      const config: SamplingConfig = {
        mode: "simple",
        size: unitRows.length,
        strata: [],
        filters: {},
        excludePriorRounds: false,
        overlapFraction: 1,
      };
      const [round] = await tx<{ id: string }[]>`
        INSERT INTO rounds (study_id, number, name, status, sampling, seed, overlap_mode, opened_at)
        VALUES (${study.id}, ${number}, ${name}, 'open', ${tx.json(config as unknown as postgres.JSONValue)},
                ${`local-${number}`}, 'full', now())
        RETURNING id
      `;
      await tx`INSERT INTO round_units ${tx(unitRows.map((u, i) => ({ round_id: round.id, unit_id: u.id, position: i })), "round_id", "unit_id", "position")}`;
      await tx`INSERT INTO assignments ${tx(coders.map((c) => ({ round_id: round.id, coder_id: c.id })), "round_id", "coder_id")}`;
      await tx`INSERT INTO unit_assignments ${tx(unitRows.flatMap((u) => coders.map((c) => ({ round_id: round.id, unit_id: u.id, coder_id: c.id }))), "round_id", "unit_id", "coder_id")}`;
      return { id: round.id, status };
    };

    const code = async (roundId: string, who: Person, externalId: string) => {
      const unit = unitRows.find((u) => u.external_id === externalId);
      const coding = PILOT[externalId]?.[who];
      if (!unit || !coding) throw new Error(`Fixture refers to unknown unit ${externalId}.`);
      const coder = people[who];
      for (const [name, phrase, memo] of coding) {
        let start: number | null = null;
        let end: number | null = null;
        if (phrase) {
          start = unit.text.indexOf(phrase);
          if (start < 0) throw new Error(`Fixture phrase not found in ${externalId}: "${phrase}"`);
          end = start + phrase.length;
        }
        await tx`
          INSERT INTO annotations (round_id, unit_id, coder_id, code_id, start_offset, end_offset, quote, memo)
          VALUES (${roundId}, ${unit.id}, ${coder.id}, ${codeId.get(name)!}, ${start}, ${end},
                  ${start === null ? "" : unit.text.slice(start, end!)}, ${memo ?? ""})
        `;
      }
      await tx`
        INSERT INTO unit_progress (round_id, unit_id, coder_id, status)
        VALUES (${roundId}, ${unit.id}, ${coder.id}, 'done')
      `;
    };

    const pilot = await makeRound(1, "Pilot", "closed");
    for (const externalId of Object.keys(PILOT)) {
      await code(pilot.id, "ana", externalId);
      await code(pilot.id, "ben", externalId);
    }
    // Close it the way the Rounds page does, codebook snapshot included.
    const snapshot = await tx`
      SELECT c.id, c.name, c.definition, c.inclusion, c.exclusion, c.example, c.color,
             c.archived, t.name AS theme_name
      FROM codes c LEFT JOIN themes t ON t.id = c.theme_id
      WHERE c.study_id = ${study.id}
      ORDER BY t.position NULLS LAST, c.position
    `;
    await tx`
      UPDATE rounds SET status = 'closed', closed_at = now(),
                        codebook_snapshot = ${tx.json(snapshot as unknown as postgres.JSONValue)}
      WHERE id = ${pilot.id}
    `;

    const second = await makeRound(2, "Second pass", "open");
    for (const externalId of SECOND_ROUND_ANA) await code(second.id, "ana", externalId);

    // Ben has noticed his "Money" duplicates "Cost or money"; Ana has not voted yet.
    const [merge] = await tx<{ id: string }[]>`
      INSERT INTO code_merges (study_id, target_code_id, new_name, rationale, proposed_by)
      VALUES (${study.id}, ${codeId.get("Cost or money")!}, 'Cost or money',
              'I made "Money" before noticing this one existed.', ${people.ben.id})
      RETURNING id
    `;
    await tx`
      INSERT INTO code_merge_codes (merge_id, code_id)
      VALUES (${merge.id}, ${codeId.get("Cost or money")!}), (${merge.id}, ${codeId.get("Money")!})
    `;
    await tx`INSERT INTO code_merge_votes (merge_id, coder_id, vote) VALUES (${merge.id}, ${people.ben.id}, 'agree')`;
  });
}
