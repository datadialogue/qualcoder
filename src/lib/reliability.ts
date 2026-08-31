/**
 * Turns raw annotation + progress rows into a reliability report.
 *
 * Everything here rests on one rule: a coder's judgement about a unit only
 * counts once they have marked that unit `done`. An un-opened unit is missing
 * data, not an implicit "no codes apply".
 */

import {
  cohensKappa,
  fleissKappa,
  krippendorffAlpha,
  percentAgreement,
  spanIoU,
  spanMatchCounts,
  type Span,
  type Stat,
} from "./irr";

export interface AnnotationRow {
  unit_id: string;
  coder_id: string;
  code_id: string;
  start_offset: number | null;
  end_offset: number | null;
}

export interface ProgressRow {
  unit_id: string;
  coder_id: string;
  status: string;
}

export interface CoderRef {
  id: string;
  name: string;
}

export interface CodeRef {
  id: string;
  name: string;
  theme_name?: string | null;
}

export interface SpanStat {
  meanIoU: number | null;
  lenientF1: number | null;
  strictF1: number | null;
  nUnitsCompared: number;
  nUnitLevel: number;
}

export interface CodeReliability {
  codeId: string;
  codeName: string;
  themeName: string | null;
  /** Units every compared coder marked done. */
  nUnits: number;
  /** Units at least two compared coders marked done (what alpha uses). */
  nPairable: number;
  appliedCount: Record<string, number>;
  prevalence: Record<string, number>;
  percentAgreement: Stat;
  cohensKappa: Stat;
  fleissKappa: Stat;
  alpha: Stat;
  span: SpanStat;
  everApplied: boolean;
}

export interface PairStat {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  nUnits: number;
  percentAgreement: Stat;
  meanKappa: Stat;
  meanAlpha: Stat;
}

export interface Disagreement {
  unitId: string;
  codeId: string;
  codeName: string;
  appliedBy: string[];
  missedBy: string[];
}

export interface ReliabilityReport {
  coders: CoderRef[];
  codes: CodeRef[];
  nUnitsAllDone: number;
  nUnitsAnyDone: number;
  perCode: CodeReliability[];
  overall: {
    meanAlpha: Stat;
    meanKappa: Stat;
    meanPercentAgreement: Stat;
    pooledAlpha: Stat;
    codesIncluded: number;
    codesUnused: number;
  };
  pairwise: PairStat[];
  disagreements: Disagreement[];
  warnings: string[];
}

const key = (a: string, b: string, c: string) => `${a} ${b} ${c}`;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function statFrom(values: number[], emptyReason: string): Stat {
  const m = mean(values);
  return m === null ? { value: null, reason: emptyReason } : { value: m };
}

export function computeReliability(input: {
  coders: CoderRef[];
  codes: CodeRef[];
  annotations: AnnotationRow[];
  progress: ProgressRow[];
}): ReliabilityReport {
  const { coders, codes, annotations, progress } = input;
  const warnings: string[] = [];
  const coderIds = coders.map((c) => c.id);
  const nameOf = new Map(coders.map((c) => [c.id, c.name]));

  // Who finished what.
  const doneByCoder = new Map<string, Set<string>>(coderIds.map((id) => [id, new Set()]));
  for (const p of progress) {
    if (p.status !== "done") continue;
    doneByCoder.get(p.coder_id)?.add(p.unit_id);
  }

  const doneCount = new Map<string, number>();
  for (const id of coderIds) {
    for (const u of doneByCoder.get(id)!) doneCount.set(u, (doneCount.get(u) ?? 0) + 1);
  }
  const allDone = [...doneCount.entries()]
    .filter(([, n]) => n === coderIds.length)
    .map(([u]) => u)
    .sort();
  const pairable = [...doneCount.entries()]
    .filter(([, n]) => n >= 2)
    .map(([u]) => u)
    .sort();

  if (coderIds.length < 2) {
    warnings.push("Reliability needs at least two coders; select more to see agreement.");
  }
  if (allDone.length === 0 && coderIds.length >= 2) {
    warnings.push(
      "No unit has been marked done by every selected coder yet, so kappa cannot be computed. " +
        "Alpha will still appear once at least two coders finish the same unit.",
    );
  }

  // Index annotations.
  const applied = new Set<string>();
  const spansBy = new Map<string, Span[]>();
  const unitLevel = new Set<string>();
  for (const a of annotations) {
    const k = key(a.coder_id, a.unit_id, a.code_id);
    applied.add(k);
    if (a.start_offset === null || a.end_offset === null) {
      unitLevel.add(k);
    } else {
      const list = spansBy.get(k);
      const span: Span = [a.start_offset, a.end_offset];
      if (list) list.push(span);
      else spansBy.set(k, [span]);
    }
  }
  const has = (coder: string, unit: string, code: string) => applied.has(key(coder, unit, code));
  const spansOf = (coder: string, unit: string, code: string): Span[] =>
    spansBy.get(key(coder, unit, code)) ?? [];

  const perCode: CodeReliability[] = [];
  const disagreements: Disagreement[] = [];

  for (const code of codes) {
    const appliedCount: Record<string, number> = {};
    const prevalence: Record<string, number> = {};
    for (const id of coderIds) {
      const n = allDone.filter((u) => has(id, u, code.id)).length;
      appliedCount[id] = n;
      prevalence[id] = allDone.length ? n / allDone.length : 0;
    }

    let pa: Stat = { value: null, reason: "no comparable units" };
    let cohen: Stat = { value: null, reason: "Cohen's kappa needs exactly two coders" };
    let fleiss: Stat = { value: null, reason: "no comparable units" };

    if (allDone.length > 0 && coderIds.length >= 2) {
      const vectors = coderIds.map((id) => allDone.map((u) => (has(id, u, code.id) ? 1 : 0)));
      const pairPct: number[] = [];
      for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
          const r = percentAgreement(vectors[i], vectors[j]);
          if (r.value !== null) pairPct.push(r.value);
        }
      }
      pa = statFrom(pairPct, "no comparable units");
      if (coderIds.length === 2) cohen = cohensKappa(vectors[0], vectors[1]);

      const counts = allDone.map((u) => {
        let yes = 0;
        for (const id of coderIds) if (has(id, u, code.id)) yes++;
        return [coderIds.length - yes, yes];
      });
      fleiss = fleissKappa(counts);
    }

    // Alpha tolerates missing data, so it uses every unit two coders finished.
    let alpha: Stat = { value: null, reason: "no unit finished by two coders" };
    if (pairable.length > 0) {
      const ratings = pairable.map((u) =>
        coderIds
          .filter((id) => doneByCoder.get(id)!.has(u))
          .map((id) => (has(id, u, code.id) ? 1 : 0)),
      );
      alpha = krippendorffAlpha(ratings);
    }

    // Span overlap: descriptive, and only over actual spans.
    let iouSum = 0;
    let iouN = 0;
    let lenMatched = 0;
    let lenTotal = 0;
    let strMatched = 0;
    let strTotal = 0;
    let nUnitLevel = 0;
    for (const u of pairable) {
      const present = coderIds.filter((id) => doneByCoder.get(id)!.has(u));
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const A = spansOf(present[i], u, code.id);
          const B = spansOf(present[j], u, code.id);
          if (A.length === 0 && B.length === 0) continue;
          iouSum += spanIoU(A, B);
          iouN++;
          const len = spanMatchCounts(A, B, 0);
          lenMatched += len.matched;
          lenTotal += len.nA + len.nB;
          const str = spanMatchCounts(A, B, 0.5);
          strMatched += str.matched;
          strTotal += str.nA + str.nB;
        }
      }
      for (const id of present) if (unitLevel.has(key(id, u, code.id))) nUnitLevel++;
    }

    for (const u of pairable) {
      const present = coderIds.filter((id) => doneByCoder.get(id)!.has(u));
      const yes = present.filter((id) => has(id, u, code.id));
      if (yes.length > 0 && yes.length < present.length) {
        disagreements.push({
          unitId: u,
          codeId: code.id,
          codeName: code.name,
          appliedBy: yes.map((id) => nameOf.get(id) ?? id),
          missedBy: present.filter((id) => !yes.includes(id)).map((id) => nameOf.get(id) ?? id),
        });
      }
    }

    perCode.push({
      codeId: code.id,
      codeName: code.name,
      themeName: code.theme_name ?? null,
      nUnits: allDone.length,
      nPairable: pairable.length,
      appliedCount,
      prevalence,
      percentAgreement: pa,
      cohensKappa: cohen,
      fleissKappa: fleiss,
      alpha,
      span: {
        meanIoU: iouN ? iouSum / iouN : null,
        lenientF1: lenTotal ? (2 * lenMatched) / lenTotal : null,
        strictF1: strTotal ? (2 * strMatched) / strTotal : null,
        nUnitsCompared: iouN,
        nUnitLevel,
      },
      everApplied: coderIds.some((id) => appliedCount[id] > 0),
    });
  }

  // Pairwise coder comparison.
  const pairwise: PairStat[] = [];
  for (let i = 0; i < coderIds.length; i++) {
    for (let j = i + 1; j < coderIds.length; j++) {
      const a = coderIds[i];
      const b = coderIds[j];
      const shared = [...doneByCoder.get(a)!].filter((u) => doneByCoder.get(b)!.has(u)).sort();
      const pcts: number[] = [];
      const kappas: number[] = [];
      const alphas: number[] = [];
      for (const code of codes) {
        const va = shared.map((u) => (has(a, u, code.id) ? 1 : 0));
        const vb = shared.map((u) => (has(b, u, code.id) ? 1 : 0));
        const p = percentAgreement(va, vb);
        if (p.value !== null) pcts.push(p.value);
        const k = cohensKappa(va, vb);
        if (k.value !== null) kappas.push(k.value);
        const al = krippendorffAlpha(shared.map((_u, idx) => [va[idx], vb[idx]]));
        if (al.value !== null) alphas.push(al.value);
      }
      pairwise.push({
        aId: a,
        bId: b,
        aName: nameOf.get(a) ?? a,
        bName: nameOf.get(b) ?? b,
        nUnits: shared.length,
        percentAgreement: statFrom(pcts, "no shared finished units"),
        meanKappa: statFrom(kappas, "kappa undefined for every code"),
        meanAlpha: statFrom(alphas, "alpha undefined for every code"),
      });
    }
  }

  const used = perCode.filter((c) => c.everApplied);
  const alphaVals = used.map((c) => c.alpha.value).filter((v): v is number => v !== null);
  const kappaVals = used
    .map((c) => (coderIds.length === 2 ? c.cohensKappa.value : c.fleissKappa.value))
    .filter((v): v is number => v !== null);
  const paVals = used.map((c) => c.percentAgreement.value).filter((v): v is number => v !== null);

  // Pooled across codes treats every (unit, code) cell as one item. Shared
  // absences dominate it, so it reads high; the per-code table is the honest view.
  let pooled: Stat = { value: null, reason: "no comparable units" };
  if (pairable.length > 0 && used.length > 0) {
    const items: number[][] = [];
    for (const u of pairable) {
      const present = coderIds.filter((id) => doneByCoder.get(id)!.has(u));
      for (const code of used) {
        items.push(present.map((id) => (has(id, u, code.codeId) ? 1 : 0)));
      }
    }
    pooled = krippendorffAlpha(items);
  }

  if (used.length < perCode.length) {
    warnings.push(
      `${perCode.length - used.length} code(s) were never applied by anyone and are excluded ` +
        "from the summary averages.",
    );
  }

  return {
    coders,
    codes,
    nUnitsAllDone: allDone.length,
    nUnitsAnyDone: pairable.length,
    perCode,
    overall: {
      meanAlpha: statFrom(alphaVals, "alpha undefined for every used code"),
      meanKappa: statFrom(kappaVals, "kappa undefined for every used code"),
      meanPercentAgreement: statFrom(paVals, "no comparable units"),
      pooledAlpha: pooled,
      codesIncluded: used.length,
      codesUnused: perCode.length - used.length,
    },
    pairwise,
    disagreements,
    warnings,
  };
}
