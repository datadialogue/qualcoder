/**
 * Deterministic, seeded sampling.
 *
 * The sample is drawn once at round creation and written to `round_units`; the
 * app never re-derives it at request time. Keeping the seed and config on the
 * round means a draw can be reproduced exactly and reported in a methods
 * section.
 */

export interface SampleInput {
  id: string;
  meta: Record<string, string>;
}

export interface SamplingConfig {
  mode: "all" | "simple" | "stratified";
  size: number;
  /** Metadata keys whose combination defines a stratum, e.g. ["condition","aor"]. */
  strata: string[];
  /** Keep only units whose meta[key] is one of the listed values. */
  filters: Record<string, string[]>;
  excludePriorRounds: boolean;
  /** For overlap_mode 'subset': share of units every coder codes, 0..1. */
  overlapFraction?: number;
  reuseRoundId?: string | null;
}

/** cyrb128 — string to four well-mixed 32-bit seeds. */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: string): () => number {
  return mulberry32(cyrb128(seed)[0]);
}

/** Fisher-Yates; returns a new array and does not mutate the input. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function stratumKey(unit: SampleInput, strata: string[]): string {
  return strata.map((k) => `${k}=${unit.meta[k] ?? ""}`).join(" | ");
}

/**
 * Proportional allocation with largest-remainder rounding, capped by how many
 * units each stratum actually has. Any shortfall from an exhausted stratum is
 * redistributed to strata with capacity left, so the totals always add up to
 * `total` when the population is large enough.
 */
export function allocate(groupSizes: number[], total: number): number[] {
  const n = groupSizes.length;
  const population = groupSizes.reduce((a, b) => a + b, 0);
  const alloc = new Array<number>(n).fill(0);
  if (n === 0 || total <= 0 || population === 0) return alloc;
  if (total >= population) return groupSizes.slice();

  const ideal = groupSizes.map((g) => (total * g) / population);
  for (let i = 0; i < n; i++) {
    alloc[i] = Math.min(Math.floor(ideal[i]), groupSizes[i]);
  }

  // Ties broken by index so the result stays reproducible.
  const order = ideal
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .map((x) => x.i);

  let remaining = total - alloc.reduce((a, b) => a + b, 0);
  while (remaining > 0) {
    let progressed = false;
    for (const i of order) {
      if (remaining === 0) break;
      if (alloc[i] < groupSizes[i]) {
        alloc[i]++;
        remaining--;
        progressed = true;
      }
    }
    if (!progressed) break; // every stratum is exhausted
  }
  return alloc;
}

export function applyFilters(
  units: readonly SampleInput[],
  filters: Record<string, string[]>,
): SampleInput[] {
  const active = Object.entries(filters).filter(([, v]) => v && v.length > 0);
  if (active.length === 0) return units.slice();
  return units.filter((u) =>
    active.every(([k, allowed]) => allowed.includes(u.meta[k] ?? "")),
  );
}

/**
 * Returns the ordered list of unit ids making up the sample.
 *
 * The final list is shuffled so coders do not meet an entire stratum in a
 * block, which would invite order effects.
 */
export function drawSample(
  units: readonly SampleInput[],
  config: SamplingConfig,
  seed: string,
  excludeIds: ReadonlySet<string> = new Set(),
): string[] {
  let pool = applyFilters(units, config.filters ?? {});
  if (config.excludePriorRounds && excludeIds.size > 0) {
    pool = pool.filter((u) => !excludeIds.has(u.id));
  }

  let picked: string[];

  if (config.mode === "all") {
    picked = pool.map((u) => u.id);
  } else if (config.mode === "stratified" && config.strata.length > 0) {
    const groups = new Map<string, SampleInput[]>();
    for (const u of pool) {
      const key = stratumKey(u, config.strata);
      const g = groups.get(key);
      if (g) g.push(u);
      else groups.set(key, [u]);
    }
    // Sorted keys keep allocation independent of input row order.
    const keys = [...groups.keys()].sort();
    const sizes = keys.map((k) => groups.get(k)!.length);
    const quota = allocate(sizes, config.size);
    picked = [];
    keys.forEach((key, i) => {
      // A per-stratum sub-seed means changing one stratum does not perturb the
      // draw in any other.
      const rng = makeRng(`${seed}::stratum::${key}`);
      const members = groups.get(key)!.slice().sort((a, b) => a.id.localeCompare(b.id));
      picked.push(...shuffle(members, rng).slice(0, quota[i]).map((u) => u.id));
    });
  } else {
    const rng = makeRng(`${seed}::simple`);
    const ordered = pool.slice().sort((a, b) => a.id.localeCompare(b.id));
    picked = shuffle(ordered, rng)
      .slice(0, config.size)
      .map((u) => u.id);
  }

  return shuffle(picked.sort(), makeRng(`${seed}::order`));
}

/**
 * Which coder codes which unit.
 *
 * 'full'   — everybody codes everything (maximum reliability information).
 * 'subset' — an overlapping subset is coded by all coders for IRR, and the
 *            remainder is split round-robin for coverage.
 */
export function assignUnits(
  unitIds: readonly string[],
  coderIds: readonly string[],
  overlapMode: "full" | "subset",
  seed: string,
  overlapFraction = 0.2,
): Array<{ unitId: string; coderId: string }> {
  const out: Array<{ unitId: string; coderId: string }> = [];
  if (coderIds.length === 0) return out;
  const coders = coderIds.slice().sort();

  if (overlapMode === "full") {
    for (const unitId of unitIds) {
      for (const coderId of coders) out.push({ unitId, coderId });
    }
    return out;
  }

  const shared = shuffle(unitIds.slice().sort(), makeRng(`${seed}::overlap`));
  const nShared = Math.max(
    coders.length > 1 ? 1 : 0,
    Math.round(unitIds.length * Math.min(Math.max(overlapFraction, 0), 1)),
  );
  const sharedSet = new Set(shared.slice(0, nShared));

  let turn = 0;
  for (const unitId of unitIds) {
    if (sharedSet.has(unitId)) {
      for (const coderId of coders) out.push({ unitId, coderId });
    } else {
      out.push({ unitId, coderId: coders[turn % coders.length] });
      turn++;
    }
  }
  return out;
}
