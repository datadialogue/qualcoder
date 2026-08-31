import test from "node:test";
import assert from "node:assert/strict";
import {
  cohensKappa,
  fleissKappa,
  krippendorffAlpha,
  percentAgreement,
  coveredLength,
  spanIoU,
  spanMatchF1,
  type Span,
} from "../src/lib/irr.ts";

const close = (a: number | null, b: number, eps = 1e-3) => {
  assert.ok(a !== null, "expected a value, got null");
  assert.ok(Math.abs(a! - b) < eps, `expected ~${b}, got ${a}`);
};

function rep<T>(v: T, n: number): T[] {
  return new Array(n).fill(v);
}

test("Cohen's kappa matches a hand-computed 2x2", () => {
  // 20 both-yes, 5 A-only, 10 B-only, 15 both-no.
  // po = 35/50 = .7 ; pe = (25/50)(30/50) + (25/50)(20/50) = .5 ; k = .4
  const a = [...rep(1, 20), ...rep(1, 5), ...rep(0, 10), ...rep(0, 15)];
  const b = [...rep(1, 20), ...rep(0, 5), ...rep(1, 10), ...rep(0, 15)];
  close(cohensKappa(a, b).value, 0.4);
  close(percentAgreement(a, b).value, 0.7);
});

test("Cohen's kappa is undefined, not zero, when there is no variance", () => {
  const a = rep(1, 10);
  const b = rep(1, 10);
  const r = cohensKappa(a, b);
  assert.equal(r.value, null);
  assert.match(r.reason!, /no variance/);
  // Percent agreement is still perfectly well defined and should say 100%.
  close(percentAgreement(a, b).value, 1);
});

test("Fleiss' kappa reproduces the standard 10-subject / 14-rater example", () => {
  const counts = [
    [0, 0, 0, 0, 14],
    [0, 2, 6, 4, 2],
    [0, 0, 3, 5, 6],
    [0, 3, 9, 2, 0],
    [2, 2, 8, 1, 1],
    [7, 7, 0, 0, 0],
    [3, 2, 6, 3, 0],
    [2, 5, 3, 2, 2],
    [6, 5, 2, 1, 0],
    [0, 2, 2, 3, 7],
  ];
  close(fleissKappa(counts).value, 0.21, 2e-3);
});

test("Fleiss' kappa refuses unequal rater counts rather than guessing", () => {
  const r = fleissKappa([
    [2, 1],
    [1, 1],
  ]);
  assert.equal(r.value, null);
  assert.match(r.reason!, /unequal raters/);
});

test("Krippendorff's alpha reproduces the canonical nominal worked example", () => {
  // Standard 3-coder x 15-unit reliability matrix; asterisks are missing values.
  // 12 units are multiply coded, giving n = 26 pairable values and
  // alpha_nominal = 56/81 = 0.691.
  const _ = null;
  const A = [_, _, _, _, _, 3, 4, 1, 2, 1, 1, 3, 3, _, 3];
  const B = [1, _, 2, 1, 3, 3, 4, 3, _, _, _, _, _, _, _];
  const C = [_, _, 2, 1, 3, 4, 4, _, 2, 1, 1, 3, 3, _, 4];
  const units = A.map((_v, i) =>
    [A[i], B[i], C[i]].filter((v): v is number => v !== null),
  );
  assert.equal(units.filter((u) => u.length >= 2).length, 12);
  close(krippendorffAlpha(units).value, 56 / 81, 1e-9);
  close(krippendorffAlpha(units).value, 0.691, 1e-3);
});

test("Krippendorff's alpha matches a hand-computed binary case", () => {
  // A = [1,1,0,0], B = [1,0,0,0]
  // marginals n0 = 5, n1 = 3, n = 8 ; Do = 2 ; De = 30/7 ; alpha = 1 - 7/15
  const units = [
    [1, 1],
    [1, 0],
    [0, 0],
    [0, 0],
  ];
  close(krippendorffAlpha(units).value, 1 - 2 / (30 / 7), 1e-9);
  close(krippendorffAlpha(units).value, 0.533333, 1e-5);
});

test("Krippendorff's alpha agrees with a direct pairwise enumeration", () => {
  // Independent formulation: enumerate ordered pairs within each unit rather
  // than going through category counts.
  function alphaByPairs(units: number[][]): number {
    const usable = units.filter((u) => u.length >= 2);
    let Do = 0;
    const marginal = new Map<number, number>();
    let n = 0;
    for (const u of usable) {
      const m = u.length;
      for (let i = 0; i < m; i++) {
        marginal.set(u[i], (marginal.get(u[i]) ?? 0) + 1);
        n++;
        for (let j = 0; j < m; j++) {
          if (i !== j && u[i] !== u[j]) Do += 1 / (m - 1);
        }
      }
    }
    let De = 0;
    for (const [c, nc] of marginal) {
      for (const [k, nk] of marginal) if (c !== k) De += (nc * nk) / (n - 1);
    }
    return 1 - Do / De;
  }

  // Deterministic pseudo-random reliability data with ragged rater counts.
  let s = 12345;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 25; trial++) {
    const units: number[][] = [];
    for (let u = 0; u < 40; u++) {
      const m = 2 + Math.floor(rand() * 3);
      units.push(Array.from({ length: m }, () => Math.floor(rand() * 4)));
    }
    close(krippendorffAlpha(units).value, alphaByPairs(units), 1e-9);
  }
});

test("alpha and kappa handle degenerate input without producing NaN", () => {
  assert.equal(krippendorffAlpha([]).value, null);
  assert.equal(krippendorffAlpha([[1]]).value, null);
  assert.equal(cohensKappa([], []).value, null);
  assert.equal(fleissKappa([]).value, null);
  for (const r of [
    krippendorffAlpha([[1, 1], [1, 1]]),
    cohensKappa([1, 1], [1, 1]),
  ]) {
    assert.equal(r.value, null);
    assert.ok(r.reason && r.reason.length > 0);
  }
});

test("perfect and complete disagreement land on the expected bounds", () => {
  close(krippendorffAlpha([[0, 0], [1, 1], [0, 0], [1, 1]]).value, 1);
  close(cohensKappa([0, 1, 0, 1], [0, 1, 0, 1]).value, 1);
  // Systematic inversion is worse than chance.
  const r = cohensKappa([0, 1, 0, 1], [1, 0, 1, 0]);
  assert.ok(r.value !== null && r.value < 0);
});

test("covered length merges overlapping and adjacent spans", () => {
  assert.equal(coveredLength([]), 0);
  assert.equal(coveredLength([[0, 5]]), 5);
  assert.equal(coveredLength([[0, 5], [3, 8]]), 8);
  assert.equal(coveredLength([[0, 5], [5, 8]]), 8);
  assert.equal(coveredLength([[0, 5], [10, 12]]), 7);
  assert.equal(coveredLength([[0, 20], [5, 8]]), 20);
});

test("span IoU behaves at its boundaries", () => {
  assert.equal(spanIoU([[0, 10]], [[0, 10]]), 1);
  assert.equal(spanIoU([[0, 10]], [[20, 30]]), 0);
  assert.equal(spanIoU([], []), 1);
  assert.equal(spanIoU([[0, 10]], []), 0);
  // Half overlap: intersection 5, union 15.
  close(spanIoU([[0, 10]], [[5, 15]]), 5 / 15, 1e-9);
});

test("span match F1 separates lenient from strict agreement", () => {
  const a: Span[] = [[0, 10], [20, 30]];
  const b: Span[] = [[8, 18], [20, 30]];
  // Lenient: [0,10] overlaps [8,18], and [20,30] matches exactly -> 2 matches.
  close(spanMatchF1(a, b, 0), 1, 1e-9);
  // Strict: [0,10] vs [8,18] has IoU 2/18, below .5, so only one match.
  close(spanMatchF1(a, b, 0.5), (2 * 1) / 4, 1e-9);
  assert.equal(spanMatchF1([], [], 0), null);
  assert.equal(spanMatchF1(a, [], 0), 0);
});
