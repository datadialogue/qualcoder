import test from "node:test";
import assert from "node:assert/strict";
import { countCodes, normalizeCodebookJson, parseCodebookText } from "../src/lib/codebook-parse.ts";

test("pasted spreadsheet rows group codes under their themes", () => {
  const themes = parseCodebookText("Tone\tSarcasm\tSays the opposite\nTone\tHostility\t\nStance\tAgrees\t");
  assert.deepEqual(themes.map((t) => [t.name, t.codes.map((c) => c.name)]), [
    ["Tone", ["Sarcasm", "Hostility"]],
    ["Stance", ["Agrees"]],
  ]);
  assert.equal(themes[0].codes[0].definition, "Says the opposite");
});

test("a CSV header picks up inclusion, exclusion and example columns", () => {
  const themes = parseCodebookText(
    'code,theme,definition,inclusion,exclusion,example\nSarcasm,Tone,Opposite meant,"Irony, mockery",Jokes,"Oh great."\n',
  );
  assert.deepEqual(themes[0].codes[0], {
    name: "Sarcasm",
    definition: "Opposite meant",
    inclusion: "Irony, mockery",
    exclusion: "Jokes",
    example: "Oh great.",
  });
});

test("a single column is a bare list of unfiled codes", () => {
  const themes = parseCodebookText("Sarcasm\nHostility\n");
  assert.equal(themes.length, 1);
  assert.equal(themes[0].name, "");
  assert.equal(countCodes(themes), 2);
});

test("JSON is accepted nested or flat", () => {
  const nested = normalizeCodebookJson([{ theme: "Tone", codes: ["Sarcasm", { name: "Hostility", definition: "d" }] }]);
  assert.equal(countCodes(nested), 2);
  assert.equal(nested[0].codes[1].definition, "d");

  const flat = parseCodebookText(JSON.stringify({ codebook: [{ theme: "Tone", code: "Sarcasm" }, { code: "Loose" }] }));
  assert.deepEqual(flat.map((t) => [t.name, t.codes.map((c) => c.name)]), [["Tone", ["Sarcasm"]], ["", ["Loose"]]]);
});
