import test from "node:test";
import assert from "node:assert/strict";
import { computeReliability, type AnnotationRow, type ProgressRow } from "../src/lib/reliability.ts";

const coders = [
  { id: "A", name: "Ana" },
  { id: "B", name: "Ben" },
];
const codes = [
  { id: "threat", name: "Threat of violence", theme_name: "Content cited" },
  { id: "slur", name: "Slur or hate speech", theme_name: "Content cited" },
  { id: "unused", name: "Never applied", theme_name: null },
];

const done = (unit: string, coder: string): ProgressRow => ({
  unit_id: unit,
  coder_id: coder,
  status: "done",
});
const ann = (
  unit: string,
  coder: string,
  code: string,
  span: [number, number] | null = null,
): AnnotationRow => ({
  unit_id: unit,
  coder_id: coder,
  code_id: code,
  start_offset: span ? span[0] : null,
  end_offset: span ? span[1] : null,
});

test("units only one coder has finished are excluded from kappa", () => {
  // u1 and u2 are finished by both; u3 only by Ana. Ana coded 'threat' on u3,
  // which must not count against Ben.
  const progress = [done("u1", "A"), done("u1", "B"), done("u2", "A"), done("u2", "B"), done("u3", "A")];
  const annotations = [ann("u1", "A", "threat"), ann("u1", "B", "threat"), ann("u3", "A", "threat")];

  const r = computeReliability({ coders, codes, annotations, progress });
  assert.equal(r.nUnitsAllDone, 2, "only u1 and u2 are complete cases");

  const threat = r.perCode.find((c) => c.codeId === "threat")!;
  assert.equal(threat.appliedCount.A, 1, "u3 must not inflate Ana's count");
  assert.equal(threat.appliedCount.B, 1);
  assert.equal(threat.percentAgreement.value, 1);
});

test("an unopened unit is missing data, not an implicit absence", () => {
  // Ben never opened u2. If u2 were treated as "Ben applied nothing", the two
  // coders would look like they disagreed. They must simply not be compared.
  const progress = [done("u1", "A"), done("u1", "B"), done("u2", "A")];
  const annotations = [ann("u1", "A", "threat"), ann("u1", "B", "threat"), ann("u2", "A", "threat")];

  const r = computeReliability({ coders, codes, annotations, progress });
  assert.equal(r.nUnitsAllDone, 1);
  const threat = r.perCode.find((c) => c.codeId === "threat")!;
  assert.equal(threat.percentAgreement.value, 1);
  assert.equal(r.disagreements.length, 0);
});

test("a code with no variance reports undefined kappa rather than zero", () => {
  const units = ["u1", "u2", "u3", "u4"];
  const progress = units.flatMap((u) => [done(u, "A"), done(u, "B")]);
  // Both coders apply 'threat' to everything: perfect agreement, zero variance.
  const annotations = units.flatMap((u) => [ann(u, "A", "threat"), ann(u, "B", "threat")]);

  const r = computeReliability({ coders, codes, annotations, progress });
  const threat = r.perCode.find((c) => c.codeId === "threat")!;
  assert.equal(threat.percentAgreement.value, 1, "agreement is still 100%");
  assert.equal(threat.cohensKappa.value, null);
  assert.match(threat.cohensKappa.reason!, /no variance/);
  assert.equal(threat.alpha.value, null);
  assert.match(threat.alpha.reason!, /no variance/);
});

test("partial agreement produces the hand-computed kappa", () => {
  // 10 units. Both apply 'threat' to u1-u4. Ana alone on u5, Ben alone on u6.
  // Neither on u7-u10.
  const units = Array.from({ length: 10 }, (_, i) => `u${i + 1}`);
  const progress = units.flatMap((u) => [done(u, "A"), done(u, "B")]);
  const annotations: AnnotationRow[] = [];
  for (const u of ["u1", "u2", "u3", "u4"]) {
    annotations.push(ann(u, "A", "threat"), ann(u, "B", "threat"));
  }
  annotations.push(ann("u5", "A", "threat"));
  annotations.push(ann("u6", "B", "threat"));

  const r = computeReliability({ coders, codes, annotations, progress });
  const threat = r.perCode.find((c) => c.codeId === "threat")!;
  // po = 8/10 = .8 ; Ana yes 5, Ben yes 5
  // pe = .5*.5 + .5*.5 = .5 ; kappa = (.8-.5)/.5 = .6
  assert.equal(threat.percentAgreement.value, 0.8);
  assert.ok(Math.abs(threat.cohensKappa.value! - 0.6) < 1e-9);
  assert.equal(r.disagreements.length, 2, "u5 and u6 disagree");
});

test("codes nobody used are excluded from the headline averages", () => {
  const units = ["u1", "u2"];
  const progress = units.flatMap((u) => [done(u, "A"), done(u, "B")]);
  const annotations = [ann("u1", "A", "threat"), ann("u1", "B", "threat")];

  const r = computeReliability({ coders, codes, annotations, progress });
  assert.equal(r.overall.codesUnused, 2, "'slur' and 'unused' were never applied");
  assert.equal(r.overall.codesIncluded, 1);
  assert.ok(r.warnings.some((w) => /never applied/.test(w)));
});

test("span overlap is reported separately from code presence", () => {
  const progress = [done("u1", "A"), done("u1", "B")];
  // Both flag 'threat', but on overlapping rather than identical spans.
  const annotations = [ann("u1", "A", "threat", [0, 10]), ann("u1", "B", "threat", [5, 15])];

  const r = computeReliability({ coders, codes, annotations, progress });
  const threat = r.perCode.find((c) => c.codeId === "threat")!;
  assert.equal(threat.percentAgreement.value, 1, "they agree the code applies");
  assert.ok(Math.abs(threat.span.meanIoU! - 5 / 15) < 1e-9, "but only partially on where");
  assert.equal(threat.span.lenientF1, 1, "any overlap counts as a match");
  assert.equal(threat.span.strictF1, 0, "IoU 0.33 is below the strict 0.5 rule");
});

test("unit-level codes are counted but kept out of span metrics", () => {
  const progress = [done("u1", "A"), done("u1", "B")];
  const annotations = [ann("u1", "A", "threat", null), ann("u1", "B", "threat", null)];

  const r = computeReliability({ coders, codes, annotations, progress });
  const threat = r.perCode.find((c) => c.codeId === "threat")!;
  assert.equal(threat.percentAgreement.value, 1);
  assert.equal(threat.span.nUnitsCompared, 0, "no spans to compare");
  assert.equal(threat.span.meanIoU, null);
  assert.equal(threat.span.nUnitLevel, 2);
});

test("three coders use Fleiss and alpha, and skip Cohen", () => {
  const three = [...coders, { id: "C", name: "Cleo" }];
  const units = Array.from({ length: 6 }, (_, i) => `u${i + 1}`);
  const progress = units.flatMap((u) => three.map((c) => done(u, c.id)));
  const annotations: AnnotationRow[] = [];
  for (const u of ["u1", "u2", "u3"]) {
    for (const c of three) annotations.push(ann(u, c.id, "threat"));
  }
  annotations.push(ann("u4", "A", "threat"));

  const r = computeReliability({ coders: three, codes, annotations, progress });
  const threat = r.perCode.find((c) => c.codeId === "threat")!;
  assert.equal(threat.cohensKappa.value, null);
  assert.match(threat.cohensKappa.reason!, /exactly two coders/);
  assert.ok(threat.fleissKappa.value !== null);
  assert.ok(threat.alpha.value !== null);
  assert.equal(r.pairwise.length, 3, "three coder pairs");
});

test("a single coder yields a warning rather than fabricated agreement", () => {
  const r = computeReliability({
    coders: [coders[0]],
    codes,
    annotations: [ann("u1", "A", "threat")],
    progress: [done("u1", "A")],
  });
  assert.ok(r.warnings.some((w) => /at least two coders/.test(w)));
  assert.equal(r.overall.meanAlpha.value, null);
  assert.equal(r.pairwise.length, 0);
});

test("no finished units at all does not throw", () => {
  const r = computeReliability({ coders, codes, annotations: [], progress: [] });
  assert.equal(r.nUnitsAllDone, 0);
  assert.equal(r.overall.meanKappa.value, null);
  assert.ok(r.warnings.length > 0);
});
