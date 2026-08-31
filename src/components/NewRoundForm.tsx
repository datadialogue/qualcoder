"use client";

import { useState } from "react";
import { ActionForm } from "./ActionForm";
import type { ActionResult } from "@/lib/action-result";

export interface NewRoundFormProps {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  coders: Array<{ id: string; name: string; role: string }>;
  facets: Record<string, string[]>;
  priorRounds: Array<{ id: string; number: number; name: string; unit_count: number }>;
  totalUnits: number;
  unusedUnits: number;
  defaultSeed: string;
}

export function NewRoundForm({
  action,
  coders,
  facets,
  priorRounds,
  totalUnits,
  unusedUnits,
  defaultSeed,
}: NewRoundFormProps) {
  const [source, setSource] = useState<"new" | "reuse">("new");
  const [mode, setMode] = useState<"stratified" | "simple" | "all">("stratified");
  const [overlap, setOverlap] = useState<"full" | "subset">("full");
  const [excludePrior, setExcludePrior] = useState(priorRounds.length > 0);
  const [selected, setSelected] = useState<string[]>(coders.map((c) => c.id));
  const [strata, setStrata] = useState<string[]>(
    ["condition", "aor"].filter((k) => k in facets),
  );

  const facetKeys = Object.keys(facets);
  const available = excludePrior ? unusedUnits : totalUnits;

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <ActionForm action={action} className="space-y-5" submitLabel="Create round and draw sample">
      <Section
        title="Coders"
        hint="Everyone selected gets the same sample. Reliability needs at least two."
      >
        <div className="flex flex-wrap gap-2">
          {coders.map((c) => (
            <label key={c.id} className="chip cursor-pointer select-none" style={
              selected.includes(c.id)
                ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }
                : undefined
            }>
              <input
                type="checkbox"
                name="coder_ids"
                value={c.id}
                checked={selected.includes(c.id)}
                onChange={() => toggle(selected, setSelected, c.id)}
                className="sr-only"
              />
              {c.name}
              {c.role === "lead" && <span className="faint">lead</span>}
            </label>
          ))}
        </div>
        {selected.length === 1 && (
          <p className="text-[12px] mt-2" style={{ color: "var(--warn)" }}>
            With one coder you will get coding but no agreement statistics.
          </p>
        )}
      </Section>

      <Section title="Name" hint="Optional. Something like “pilot”, or “after codebook revision”.">
        <input className="input" name="name" placeholder="Pilot round" />
      </Section>

      <Section
        title="Which units"
        hint="The sample is drawn once now and stored, so every coder sees the identical set in the identical order."
      >
        <div className="flex gap-2 mb-3">
          <Radio checked={source === "new"} onChange={() => setSource("new")} label="Draw a new sample" />
          <Radio
            checked={source === "reuse"}
            onChange={() => setSource("reuse")}
            label="Reuse an earlier round's sample"
            disabled={priorRounds.length === 0}
          />
        </div>

        {source === "reuse" ? (
          <div>
            <label className="label">Copy the sample from</label>
            <select className="select" name="reuse_round_id" defaultValue={priorRounds[0]?.id}>
              {priorRounds.map((r) => (
                <option key={r.id} value={r.id}>
                  Round {r.number}
                  {r.name ? ` · ${r.name}` : ""} — {r.unit_count} units
                </option>
              ))}
            </select>
            <p className="muted text-[12px] mt-2">
              Re-coding the same units under a revised codebook is how you show whether agreement
              actually improved between iterations. Earlier coding is untouched.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <input type="hidden" name="mode" value={mode} />
            <div className="flex gap-2">
              <Radio checked={mode === "stratified"} onChange={() => setMode("stratified")} label="Stratified" />
              <Radio checked={mode === "simple"} onChange={() => setMode("simple")} label="Simple random" />
              <Radio checked={mode === "all"} onChange={() => setMode("all")} label="Every unit" />
            </div>

            {mode !== "all" && (
              <div className="grid grid-cols-[160px_1fr] gap-3 items-end">
                <div>
                  <label className="label">Sample size</label>
                  <input
                    className="input num"
                    type="number"
                    name="size"
                    min={1}
                    max={available}
                    defaultValue={Math.min(60, available)}
                  />
                </div>
                <p className="muted text-[12px] pb-1.5">
                  {available.toLocaleString()} unit{available === 1 ? "" : "s"} available
                  {excludePrior && priorRounds.length > 0 && " after excluding earlier rounds"}.
                </p>
              </div>
            )}

            {mode === "stratified" && (
              <div>
                <label className="label">Stratify by</label>
                <div className="flex flex-wrap gap-1.5">
                  {facetKeys.map((k) => (
                    <label
                      key={k}
                      className="chip cursor-pointer select-none font-mono text-[11px]"
                      style={
                        strata.includes(k)
                          ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        name="strata"
                        value={k}
                        checked={strata.includes(k)}
                        onChange={() => toggle(strata, setStrata, k)}
                        className="sr-only"
                      />
                      {k}
                      <span className="faint">{facets[k].length}</span>
                    </label>
                  ))}
                </div>
                <p className="muted text-[12px] mt-1.5">
                  {strata.length === 0
                    ? "No strata selected — this falls back to a simple random draw."
                    : `${strata.reduce((n, k) => n * facets[k].length, 1)} strata; each gets a share of the sample proportional to its size in the data.`}
                </p>
              </div>
            )}

            <details>
              <summary className="label cursor-pointer">Restrict the pool (optional)</summary>
              <div className="grid sm:grid-cols-2 gap-3 mt-2">
                {facetKeys.map((k) => (
                  <div key={k}>
                    <label className="label font-mono">{k}</label>
                    <select className="select h-auto" name={`filter:${k}`} multiple size={Math.min(5, facets[k].length)}>
                      {facets[k].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="muted text-[12px] mt-1.5">
                Select nothing in a list to leave that column unfiltered.
              </p>
            </details>

            {priorRounds.length > 0 && (
              <label className="flex items-start gap-2 text-[13px] cursor-pointer">
                <input
                  type="checkbox"
                  name="exclude_prior"
                  checked={excludePrior}
                  onChange={(e) => setExcludePrior(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Exclude units already used in earlier rounds
                  <span className="faint block text-[12px]">
                    Keeps each iteration on fresh material. Turn this off if you want to re-code
                    familiar units.
                  </span>
                </span>
              </label>
            )}

            <div>
              <label className="label">Seed</label>
              <input className="input font-mono" name="seed" defaultValue={defaultSeed} />
              <p className="muted text-[12px] mt-1">
                Recorded with the round so the draw can be reproduced and reported.
              </p>
            </div>
          </div>
        )}
      </Section>

      <Section title="Who codes what">
        <input type="hidden" name="overlap_mode" value={overlap} />
        <div className="flex gap-2 mb-2">
          <Radio checked={overlap === "full"} onChange={() => setOverlap("full")} label="Everyone codes everything" />
          <Radio
            checked={overlap === "subset"}
            onChange={() => setOverlap("subset")}
            label="Overlap a subset, split the rest"
          />
        </div>
        {overlap === "full" ? (
          <p className="muted text-[12px]">
            Maximum reliability information, and the simplest to interpret. Best for a pilot.
          </p>
        ) : (
          <div className="grid grid-cols-[160px_1fr] gap-3 items-end">
            <div>
              <label className="label">Double-coded share</label>
              <input
                className="input num"
                type="number"
                name="overlap_fraction"
                step="0.05"
                min="0.05"
                max="1"
                defaultValue="0.2"
              />
            </div>
            <p className="muted text-[12px] pb-1.5">
              That share is coded by everyone and carries the reliability estimate; the remainder is
              split round-robin for coverage.
            </p>
          </div>
        )}
      </Section>
    </ActionForm>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {hint && <p className="muted text-[12px] mt-0.5 mb-3">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function Radio({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className="btn text-[12px]"
      style={
        checked
          ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }
          : undefined
      }
    >
      {label}
    </button>
  );
}
