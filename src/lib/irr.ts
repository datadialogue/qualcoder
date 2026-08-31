/**
 * Inter-rater reliability.
 *
 * Unit of agreement is (unit x code) presence/absence, restricted to units the
 * compared coders have all marked `done`. That restriction is the whole reason
 * `unit_progress` exists: without it an un-opened unit looks identical to one a
 * coder deliberately left uncoded, and every coefficient below silently
 * inflates.
 *
 * Coefficients are returned as `{ value, reason }`. A null value with a reason
 * is a real result -- most often a code with no variance, where kappa is 0/0
 * and printing 0 would be actively misleading.
 */

export interface Stat {
  value: number | null;
  reason?: string;
}

const ok = (value: number): Stat => ({ value });
const undef = (reason: string): Stat => ({ value: null, reason });

/* ------------------------------------------------------------------ *
 * Generic coefficients, written against plain arrays so they can be
 * tested directly against published reference values.
 * ------------------------------------------------------------------ */

/** Simple percent agreement between two aligned rating vectors. */
export function percentAgreement(a: readonly unknown[], b: readonly unknown[]): Stat {
  if (a.length !== b.length) return undef("rating vectors differ in length");
  if (a.length === 0) return undef("no comparable units");
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
  return ok(same / a.length);
}

/**
 * Cohen's kappa for two raters over a shared set of items.
 * Categories are inferred from the data.
 */
export function cohensKappa(a: readonly unknown[], b: readonly unknown[]): Stat {
  if (a.length !== b.length) return undef("rating vectors differ in length");
  const n = a.length;
  if (n === 0) return undef("no comparable units");

  const cats = [...new Set([...a, ...b])];
  if (cats.length < 2) return undef("no variance: every rating is identical");

  let observed = 0;
  const marginalsA = new Map<unknown, number>();
  const marginalsB = new Map<unknown, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) observed++;
    marginalsA.set(a[i], (marginalsA.get(a[i]) ?? 0) + 1);
    marginalsB.set(b[i], (marginalsB.get(b[i]) ?? 0) + 1);
  }

  const po = observed / n;
  let pe = 0;
  for (const c of cats) {
    pe += ((marginalsA.get(c) ?? 0) / n) * ((marginalsB.get(c) ?? 0) / n);
  }

  if (Math.abs(1 - pe) < 1e-12) {
    return undef("no variance: chance agreement is 1, kappa is undefined");
  }
  return ok((po - pe) / (1 - pe));
}

/**
 * Fleiss' kappa. `counts[i][j]` is how many raters put item i in category j.
 * Every item must have the same number of raters.
 */
export function fleissKappa(counts: readonly (readonly number[])[]): Stat {
  const N = counts.length;
  if (N === 0) return undef("no comparable units");
  const k = counts[0].length;
  const n = counts[0].reduce((x, y) => x + y, 0);
  if (n < 2) return undef("fewer than two ratings per unit");
  for (const row of counts) {
    if (row.length !== k) return undef("inconsistent category count");
    if (row.reduce((x, y) => x + y, 0) !== n) {
      return undef("unequal raters per unit: use Krippendorff's alpha instead");
    }
  }

  // Mean per-item agreement.
  let sumPi = 0;
  for (const row of counts) {
    let s = 0;
    for (const c of row) s += c * (c - 1);
    sumPi += s / (n * (n - 1));
  }
  const pBar = sumPi / N;

  // Category marginals.
  let pe = 0;
  for (let j = 0; j < k; j++) {
    let cj = 0;
    for (const row of counts) cj += row[j];
    const pj = cj / (N * n);
    pe += pj * pj;
  }

  if (Math.abs(1 - pe) < 1e-12) {
    return undef("no variance: chance agreement is 1, kappa is undefined");
  }
  return ok((pBar - pe) / (1 - pe));
}

/**
 * Krippendorff's alpha for the nominal metric, via the coincidence matrix.
 *
 * `units` is one array of observed values per unit; missing ratings are simply
 * absent, so units may have different numbers of ratings. Units with fewer than
 * two ratings carry no reliability information and are dropped.
 */
export function krippendorffAlpha(units: readonly (readonly unknown[])[]): Stat {
  const usable = units.filter((u) => u.length >= 2);
  if (usable.length === 0) return undef("no unit has two or more ratings");

  const cats = [...new Set(usable.flat())];
  if (cats.length < 2) return undef("no variance: every rating is identical");
  const index = new Map(cats.map((c, i) => [c, i]));
  const K = cats.length;

  // Coincidence matrix: o[c][k] counts value pairs within units, each unit
  // weighted by 1/(m_u - 1) so units with more ratings do not dominate.
  const o: number[][] = Array.from({ length: K }, () => new Array<number>(K).fill(0));
  for (const unit of usable) {
    const m = unit.length;
    const counts = new Array<number>(K).fill(0);
    for (const v of unit) counts[index.get(v)!]++;
    for (let c = 0; c < K; c++) {
      if (counts[c] === 0) continue;
      for (let kk = 0; kk < K; kk++) {
        const pairs = c === kk ? counts[c] * (counts[c] - 1) : counts[c] * counts[kk];
        o[c][kk] += pairs / (m - 1);
      }
    }
  }

  const marginal = o.map((row) => row.reduce((a, b) => a + b, 0));
  const n = marginal.reduce((a, b) => a + b, 0);
  if (n < 2) return undef("fewer than two ratings in total");

  // Nominal metric: disagreement is 1 for every off-diagonal cell.
  let Do = 0;
  for (let c = 0; c < K; c++) {
    for (let kk = 0; kk < K; kk++) if (c !== kk) Do += o[c][kk];
  }
  let De = 0;
  for (let c = 0; c < K; c++) {
    for (let kk = 0; kk < K; kk++) {
      if (c !== kk) De += (marginal[c] * marginal[kk]) / (n - 1);
    }
  }

  if (De === 0) return undef("no variance: expected disagreement is 0");
  return ok(1 - Do / De);
}

/* ------------------------------------------------------------------ *
 * Span-level overlap. Descriptive only -- these are NOT chance-corrected,
 * and are reported separately from kappa/alpha for that reason.
 * ------------------------------------------------------------------ */

export type Span = readonly [number, number];

function spanLength(s: Span): number {
  return Math.max(0, s[1] - s[0]);
}

function overlapLength(a: Span, b: Span): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

/** Total characters covered by a set of possibly overlapping spans. */
export function coveredLength(spans: readonly Span[]): number {
  if (spans.length === 0) return 0;
  const sorted = spans.slice().sort((x, y) => x[0] - y[0]);
  let total = 0;
  let [start, end] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s > end) {
      total += end - start;
      start = s;
      end = e;
    } else if (e > end) {
      end = e;
    }
  }
  return total + (end - start);
}

/** Jaccard index over the character sets covered by two span sets. */
export function spanIoU(a: readonly Span[], b: readonly Span[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const lenA = coveredLength(a);
  const lenB = coveredLength(b);
  if (lenA === 0 || lenB === 0) return 0;
  // Intersection of two unions, computed by merging then intersecting.
  let inter = 0;
  for (const x of a) {
    for (const y of b) inter += overlapLength(x, y);
  }
  // Guard against double counting when a set self-overlaps.
  inter = Math.min(inter, Math.min(lenA, lenB));
  const union = lenA + lenB - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Greedy one-to-one matching between two span sets.
 * `threshold` 0 means any overlap counts (lenient); 0.5 is the usual strict rule.
 * Returns raw counts so callers can micro-average across many units.
 */
export function spanMatchCounts(
  a: readonly Span[],
  b: readonly Span[],
  threshold: number,
): { matched: number; nA: number; nB: number } {
  const result = { matched: 0, nA: a.length, nB: b.length };
  if (a.length === 0 || b.length === 0) return result;

  const candidates: Array<{ i: number; j: number; iou: number }> = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const inter = overlapLength(a[i], b[j]);
      if (inter <= 0) continue;
      const union = spanLength(a[i]) + spanLength(b[j]) - inter;
      const iou = union === 0 ? 0 : inter / union;
      if (threshold === 0 ? inter > 0 : iou >= threshold) candidates.push({ i, j, iou });
    }
  }
  candidates.sort((x, y) => y.iou - x.iou || x.i - y.i || x.j - y.j);

  const usedA = new Set<number>();
  const usedB = new Set<number>();
  for (const c of candidates) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i);
    usedB.add(c.j);
    result.matched++;
  }
  return result;
}

/** Symmetric F1 over greedily matched spans; null when neither coder marked any. */
export function spanMatchF1(
  a: readonly Span[],
  b: readonly Span[],
  threshold: number,
): number | null {
  if (a.length === 0 && b.length === 0) return null;
  const { matched, nA, nB } = spanMatchCounts(a, b, threshold);
  return (2 * matched) / (nA + nB);
}
