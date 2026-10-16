"use client";

import { useMemo, useState } from "react";

export interface AdjUnit {
  id: string;
  external_id: string;
  text: string;
  /** Read-only surrounding text, e.g. the post a comment replies to. */
  context: Array<{ label: string; text: string }>;
  /** Each coder's annotations on this unit. */
  byCoder: Array<{
    coderId: string;
    coderName: string;
    annotations: Array<{
      codeId: string;
      codeName: string;
      color: string;
      start: number | null;
      end: number | null;
      quote: string;
    }>;
    note: string;
  }>;
  /** Codes where the coders differ. */
  contested: string[];
  resolved: boolean;
  resolvedNote: string;
  agreed: Array<{ codeId: string; start: number | null; end: number | null }>;
}

interface Props {
  roundId: string;
  units: AdjUnit[];
  codes: Array<{ id: string; name: string; color: string }>;
}

/** Stable identity for a candidate coding, so the same span from two coders
 *  collapses into one selectable row. */
const keyOf = (c: { codeId: string; start: number | null; end: number | null }) =>
  `${c.codeId}|${c.start ?? "u"}|${c.end ?? "u"}`;

export function Adjudicator({ roundId, units, codes }: Props) {
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<Record<string, { picked: Set<string>; note: string; resolved: boolean }>>(
    () =>
      Object.fromEntries(
        units.map((u) => [
          u.id,
          {
            picked: new Set(u.agreed.map(keyOf)),
            note: u.resolvedNote,
            resolved: u.resolved,
          },
        ]),
      ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const codeById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);

  const visible = useMemo(
    () => units.filter((u) => showResolved || !state[u.id]?.resolved),
    [units, state, showResolved],
  );
  const unit = visible[Math.min(index, visible.length - 1)];

  if (units.length === 0) {
    return (
      <p className="panel px-4 py-8 text-center muted text-[13px]">
        No disagreements to adjudicate. Coders either agree on every unit they have both finished,
        or not enough overlapping coding exists yet.
      </p>
    );
  }
  if (!unit) {
    return (
      <div className="panel px-4 py-8 text-center">
        <p className="muted text-[13px] mb-3">Every disagreement has been resolved.</p>
        <button className="btn" onClick={() => setShowResolved(true)}>
          Show resolved units
        </button>
      </div>
    );
  }

  const current = state[unit.id];

  // Every distinct coding any coder produced, as candidates for the agreed set.
  const candidates = new Map<
    string,
    { codeId: string; start: number | null; end: number | null; quote: string; by: string[] }
  >();
  for (const c of unit.byCoder) {
    for (const a of c.annotations) {
      const k = keyOf(a);
      const existing = candidates.get(k);
      if (existing) existing.by.push(c.coderName);
      else
        candidates.set(k, {
          codeId: a.codeId,
          start: a.start,
          end: a.end,
          quote: a.quote,
          by: [c.coderName],
        });
    }
  }

  const setPicked = (next: Set<string>) =>
    setState((s) => ({ ...s, [unit.id]: { ...s[unit.id], picked: next } }));

  const toggle = (k: string) => {
    const next = new Set(current.picked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setPicked(next);
  };

  const adopt = (coderId: string) => {
    const c = unit.byCoder.find((x) => x.coderId === coderId);
    if (!c) return;
    setPicked(new Set(c.annotations.map(keyOf)));
  };

  const save = async (resolved: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const chosen = [...current.picked]
        .map((k) => candidates.get(k))
        .filter(Boolean)
        .map((c) => ({ codeId: c!.codeId, start: c!.start, end: c!.end }));
      // Unit-level codes added from the palette are not in `candidates`.
      for (const k of current.picked) {
        if (candidates.has(k)) continue;
        const [codeId] = k.split("|");
        chosen.push({ codeId, start: null, end: null });
      }

      const res = await fetch("/api/adjudication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId,
          unitId: unit.id,
          codes: chosen,
          note: current.note,
          status: resolved ? "resolved" : "open",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save.");
      setState((s) => ({ ...s, [unit.id]: { ...s[unit.id], resolved } }));
      if (resolved) setIndex((i) => Math.min(i, visible.length - 2 < 0 ? 0 : i));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remaining = units.filter((u) => !state[u.id]?.resolved).length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="chip num">{remaining} unresolved</span>
        <span className="faint text-[12px]">
          {visible.indexOf(unit) + 1} of {visible.length} shown
        </span>
        <label className="chip cursor-pointer ml-2">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="mr-1"
          />
          include resolved
        </label>
        <div className="ml-auto flex gap-1.5">
          <button className="btn" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            ← Previous
          </button>
          <button
            className="btn"
            onClick={() => setIndex((i) => Math.min(visible.length - 1, i + 1))}
            disabled={index >= visible.length - 1}
          >
            Next →
          </button>
        </div>
      </div>

      <article className="panel p-4 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="chip font-mono text-[11px]">{unit.external_id}</span>
          {current.resolved && (
            <span className="chip" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              resolved
            </span>
          )}
          <span className="faint text-[12px]">
            contested: {unit.contested.map((id) => codeById.get(id)?.name).filter(Boolean).join(", ")}
          </span>
        </div>
        {unit.context.map((c, i) => (
          <div
            key={i}
            className="text-[12px] px-3 py-1.5 mb-2 rounded"
            style={{ background: "var(--panel)", borderLeft: "3px solid var(--ink-faint)" }}
          >
            {c.label && <span className="label mr-1">{c.label}</span>}
            <span className="muted whitespace-pre-line line-clamp-3">{c.text}</span>
          </div>
        ))}
        <p className="coding-text">{unit.text}</p>
      </article>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        {unit.byCoder.map((c) => (
          <section key={c.coderId} className="panel p-3">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-[13px] font-semibold">{c.coderName}</h3>
              <button className="btn text-[11px] py-0.5 ml-auto" onClick={() => adopt(c.coderId)}>
                Adopt this set
              </button>
            </div>
            {c.annotations.length === 0 ? (
              <p className="faint text-[12px]">Applied no codes.</p>
            ) : (
              <ul className="space-y-1">
                {c.annotations.map((a, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[12px]">
                    <span
                      className="w-2.5 h-2.5 rounded-sm mt-0.5 shrink-0"
                      style={{ background: a.color }}
                    />
                    <span>
                      <span className="font-medium">{a.codeName}</span>
                      {a.start === null ? (
                        <span className="faint"> · whole comment</span>
                      ) : (
                        <span className="muted"> · &ldquo;{a.quote}&rdquo;</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {c.note && (
              <p className="muted text-[12px] mt-2 italic border-l-2 pl-2" style={{ borderColor: "var(--border)" }}>
                {c.note}
              </p>
            )}
          </section>
        ))}
      </div>

      <section className="panel p-4">
        <h3 className="text-[13px] font-semibold mb-1">Agreed coding</h3>
        <p className="muted text-[12px] mb-3">
          Pick what the final set should be. Candidates below are every distinct coding either coder
          produced; you can also add a whole-comment code that neither used.
        </p>

        <ul className="space-y-1 mb-3">
          {[...candidates.entries()].map(([k, c]) => {
            const code = codeById.get(c.codeId);
            const on = current.picked.has(k);
            return (
              <li key={k}>
                <button
                  onClick={() => toggle(k)}
                  className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded border text-[12px]"
                  style={{
                    borderColor: on ? (code?.color ?? "var(--accent)") : "var(--border)",
                    background: on
                      ? `color-mix(in srgb, ${code?.color ?? "#888"} 14%, transparent)`
                      : "transparent",
                  }}
                >
                  <span className="shrink-0">{on ? "✓" : "○"}</span>
                  <span
                    className="w-2.5 h-2.5 rounded-sm mt-0.5 shrink-0"
                    style={{ background: code?.color }}
                  />
                  <span className="flex-1">
                    <span className="font-medium">{code?.name ?? "unknown"}</span>
                    {c.start === null ? (
                      <span className="faint"> · whole comment</span>
                    ) : (
                      <span className="muted"> · &ldquo;{c.quote}&rdquo;</span>
                    )}
                  </span>
                  <span className="faint shrink-0">{c.by.join(", ")}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <details className="mb-3">
          <summary className="label cursor-pointer">Add a whole-comment code</summary>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {codes.map((c) => {
              const k = `${c.id}|u|u`;
              const on = current.picked.has(k);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(k)}
                  className="chip cursor-pointer"
                  style={
                    on
                      ? { background: `color-mix(in srgb, ${c.color} 18%, transparent)`, borderColor: c.color }
                      : undefined
                  }
                >
                  <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />
                  {c.name}
                </button>
              );
            })}
          </div>
        </details>

        <label className="label">Adjudication note</label>
        <textarea
          className="textarea mb-3"
          rows={2}
          value={current.note}
          placeholder="Why this resolution, and any codebook change it implies…"
          onChange={(e) =>
            setState((s) => ({ ...s, [unit.id]: { ...s[unit.id], note: e.target.value } }))
          }
        />

        <div className="flex items-center gap-2">
          <button className="btn btn-primary" disabled={saving} onClick={() => void save(true)}>
            {saving ? "Saving…" : "Save and mark resolved"}
          </button>
          <button className="btn" disabled={saving} onClick={() => void save(false)}>
            Save, keep open
          </button>
          {error && (
            <span className="text-[12px]" style={{ color: "var(--danger)" }}>
              {error}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
