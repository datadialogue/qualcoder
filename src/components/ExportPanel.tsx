"use client";

import { useState } from "react";

const EXPORTS = [
  {
    kind: "annotations",
    name: "Annotations",
    detail:
      "One row per code applied, with the quoted span, character offsets and every original data column.",
    scoped: true,
  },
  {
    kind: "matrix",
    name: "Unit × code matrix",
    detail:
      "Wide 0/1 table, one row per unit and coder. The shape most statistics packages expect.",
    scoped: true,
  },
  {
    kind: "irr",
    name: "Reliability summary",
    detail:
      "Per code and round: percent agreement, Cohen's κ, Fleiss' κ, Krippendorff's α and span overlap.",
    scoped: true,
  },
  {
    kind: "progress",
    name: "Coding progress",
    detail: "Which coder finished which unit, plus flags and notes. Needed to interpret the matrix.",
    scoped: true,
  },
  {
    kind: "adjudicated",
    name: "Adjudicated coding",
    detail: "The reconciled gold-standard set produced in adjudication.",
    scoped: true,
  },
  { kind: "codebook", name: "Codebook", detail: "Themes, codes, definitions and usage counts.", scoped: false },
  {
    kind: "project",
    name: "Full study (JSON)",
    detail: "Every table for this study, for archival or reproduction. Invite tokens are omitted.",
    scoped: false,
  },
];

export function ExportPanel({
  studyId,
  rounds,
  coders,
}: {
  studyId: string;
  rounds: Array<{ id: string; label: string }>;
  coders: Array<{ id: string; name: string }>;
}) {
  const [round, setRound] = useState("all");
  const [selected, setSelected] = useState<string[]>(coders.map((c) => c.id));

  const allSelected = selected.length === coders.length;
  const coderParam = allSelected ? "" : `&coders=${selected.join(",")}`;

  const href = (kind: string, scoped: boolean) =>
    `/api/export/${kind}?study=${studyId}${scoped ? `&round=${round}` : ""}${kind === "irr" ? coderParam : ""}`;

  return (
    <div className="panel overflow-hidden">
      <div
        className="px-4 py-3 border-b flex items-center gap-3"
        style={{ borderColor: "var(--border)" }}
      >
        <label className="label mb-0">Round</label>
        <select className="select w-auto flex-1" value={round} onChange={(e) => setRound(e.target.value)}>
          <option value="all">All rounds</option>
          {rounds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <label className="label">Coders compared in the reliability summary</label>
        <div className="flex flex-wrap gap-1.5">
          {coders.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() =>
                  setSelected(on ? selected.filter((v) => v !== c.id) : [...selected, c.id])
                }
                className="chip cursor-pointer"
                style={
                  on
                    ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }
                    : undefined
                }
              >
                {c.name}
              </button>
            );
          })}
        </div>
        <p className="faint text-[12px] mt-1.5">
          Kappa is only defined over units every selected coder finished, so including someone who
          has not started yet will empty the column. Alpha tolerates the gap and still reports.
        </p>
      </div>

      <ul>
        {EXPORTS.map((e) => (
          <li
            key={e.kind}
            className="flex items-center gap-4 px-4 py-3 border-b last:border-0"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium">{e.name}</div>
              <div className="muted text-[12px]">{e.detail}</div>
            </div>
            <a
              className="btn shrink-0"
              href={href(e.kind, e.scoped)}
              download
            >
              Download
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
