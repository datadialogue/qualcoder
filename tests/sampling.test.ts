import test from "node:test";
import assert from "node:assert/strict";
import {
  allocate,
  assignUnits,
  drawSample,
  makeRng,
  shuffle,
  type SampleInput,
  type SamplingConfig,
} from "../src/lib/sampling.ts";

const conditions = ["ai", "crowd", "control"];
const aors = ["0", "0.25", "0.5", "0.75", "1"];

function population(n = 1450): SampleInput[] {
  // Mirrors the real data's shape: 3 conditions x 5 aor levels.
  return Array.from({ length: n }, (_, i) => ({
    id: `u${String(i).padStart(5, "0")}`,
    meta: {
      condition: conditions[i % 3],
      aor: aors[i % 5],
      account_suspension: i % 7 === 0 ? "Do not suspend" : "Suspend",
    },
  }));
}

const base: SamplingConfig = {
  mode: "simple",
  size: 60,
  strata: [],
  filters: {},
  excludePriorRounds: false,
};

test("the same seed always yields the identical sample and order", () => {
  const pop = population();
  const a = drawSample(pop, base, "seed-alpha");
  const b = drawSample(pop, base, "seed-alpha");
  assert.deepEqual(a, b);
});

test("input row order does not affect the sample", () => {
  const pop = population();
  const reversed = pop.slice().reverse();
  assert.deepEqual(
    drawSample(pop, base, "seed-alpha"),
    drawSample(reversed, base, "seed-alpha"),
  );
  const strat: SamplingConfig = { ...base, mode: "stratified", strata: ["condition", "aor"] };
  assert.deepEqual(
    drawSample(pop, strat, "s"),
    drawSample(pop.slice().reverse(), strat, "s"),
  );
});

test("a different seed yields a different sample", () => {
  const pop = population();
  assert.notDeepEqual(drawSample(pop, base, "seed-alpha"), drawSample(pop, base, "seed-beta"));
});

test("sample size is exact and contains no duplicates", () => {
  const pop = population();
  for (const size of [1, 7, 60, 333, 1450]) {
    const s = drawSample(pop, { ...base, size }, "s");
    assert.equal(s.length, size, `size ${size}`);
    assert.equal(new Set(s).size, size, `duplicates at size ${size}`);
  }
  // Asking for more than exists yields the whole population, not an error.
  assert.equal(drawSample(pop, { ...base, size: 5000 }, "s").length, 1450);
});

test("stratified sampling hits the exact size and proportional quotas", () => {
  const pop = population();
  const cfg: SamplingConfig = {
    ...base,
    mode: "stratified",
    size: 60,
    strata: ["condition", "aor"],
  };
  const ids = new Set(drawSample(pop, cfg, "s"));
  assert.equal(ids.size, 60);

  // 15 strata of equal size in this synthetic population -> 4 units each.
  const counts = new Map<string, number>();
  for (const u of pop) {
    if (!ids.has(u.id)) continue;
    const k = `${u.meta.condition}|${u.meta.aor}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.equal(counts.size, 15);
  for (const [k, c] of counts) assert.equal(c, 4, `stratum ${k} got ${c}`);
});

test("stratified draw stays exact when strata are uneven", () => {
  // Deliberately lopsided: one stratum far smaller than its proportional share.
  const pop: SampleInput[] = [
    ...Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, meta: { g: "big" } })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `b${i}`, meta: { g: "tiny" } })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, meta: { g: "mid" } })),
  ];
  const s = drawSample(pop, { ...base, mode: "stratified", size: 50, strata: ["g"] }, "s");
  assert.equal(s.length, 50);
  assert.equal(new Set(s).size, 50);
});

test("allocation redistributes the shortfall from exhausted strata", () => {
  // 'tiny' can only give 1, so its unmet share must go elsewhere.
  const alloc = allocate([100, 1, 100], 60);
  assert.equal(alloc.reduce((a, b) => a + b, 0), 60);
  assert.ok(alloc[1] <= 1);
  assert.deepEqual(allocate([5, 5], 20), [5, 5]); // capped by availability
  assert.deepEqual(allocate([], 10), []);
  assert.deepEqual(allocate([10, 10], 0), [0, 0]);
});

test("filters restrict the pool before drawing", () => {
  const pop = population();
  const s = drawSample(pop, { ...base, size: 30, filters: { condition: ["ai"] } }, "s");
  const byId = new Map(pop.map((u) => [u.id, u]));
  assert.equal(s.length, 30);
  for (const id of s) assert.equal(byId.get(id)!.meta.condition, "ai");
});

test("prior-round units are excluded only when asked", () => {
  const pop = population();
  const round1 = new Set(drawSample(pop, { ...base, size: 100 }, "r1"));

  const fresh = drawSample(pop, { ...base, size: 100, excludePriorRounds: true }, "r2", round1);
  assert.equal(fresh.length, 100);
  for (const id of fresh) assert.ok(!round1.has(id), `${id} was already coded in round 1`);

  // Without the flag the exclusion set is ignored, so overlap is expected.
  const overlapping = drawSample(pop, { ...base, size: 100 }, "r2", round1);
  assert.ok(overlapping.some((id) => round1.has(id)));
});

test("shuffle is a permutation and never mutates its input", () => {
  const src = Array.from({ length: 50 }, (_, i) => i);
  const copy = src.slice();
  const out = shuffle(src, makeRng("x"));
  assert.deepEqual(src, copy);
  assert.deepEqual(out.slice().sort((a, b) => a - b), copy);
});

test("full overlap gives every coder every unit", () => {
  const units = ["u1", "u2", "u3"];
  const coders = ["c1", "c2"];
  const pairs = assignUnits(units, coders, "full", "s");
  assert.equal(pairs.length, 6);
  for (const u of units) {
    assert.equal(pairs.filter((p) => p.unitId === u).length, 2);
  }
});

test("subset overlap double-codes a share and splits the remainder", () => {
  const units = Array.from({ length: 100 }, (_, i) => `u${i}`);
  const coders = ["c1", "c2", "c3"];
  const pairs = assignUnits(units, coders, "subset", "s", 0.2);

  const perUnit = new Map<string, number>();
  for (const p of pairs) perUnit.set(p.unitId, (perUnit.get(p.unitId) ?? 0) + 1);

  const shared = [...perUnit.values()].filter((v) => v === 3).length;
  const solo = [...perUnit.values()].filter((v) => v === 1).length;
  assert.equal(shared, 20);
  assert.equal(solo, 80);
  assert.equal(perUnit.size, 100);

  // The remainder is split roughly evenly.
  const load = new Map<string, number>();
  for (const p of pairs) load.set(p.coderId, (load.get(p.coderId) ?? 0) + 1);
  const values = [...load.values()];
  assert.ok(Math.max(...values) - Math.min(...values) <= 1);
});

test("assignment is deterministic for a given seed", () => {
  const units = Array.from({ length: 40 }, (_, i) => `u${i}`);
  const coders = ["c1", "c2"];
  assert.deepEqual(
    assignUnits(units, coders, "subset", "s", 0.25),
    assignUnits(units, coders, "subset", "s", 0.25),
  );
});
