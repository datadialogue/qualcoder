import Link from "next/link";
import { notFound } from "next/navigation";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getRound } from "@/lib/queries";
import { computeReliability, type AnnotationRow, type ProgressRow } from "@/lib/reliability";
import { SignedOut } from "@/components/SignedOut";
import { Metric, StatCell, agreementLabel } from "@/components/Stat";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ roundId: string }>;
  searchParams: Promise<{ coders?: string }>;
}) {
  const { roundId } = await params;
  const { coders: coderParam } = await searchParams;
  const viewer = await currentCoder();
  if (!viewer) return <SignedOut />;

  const round = await getRound(roundId);
  if (!round) notFound();

  const [assigned, codes, annotations, progress] = await Promise.all([
    sql<{ id: string; name: string }[]>`
      SELECT c.id, c.name FROM assignments a JOIN coders c ON c.id = a.coder_id
      WHERE a.round_id = ${roundId} ORDER BY c.name
    `,
    sql<{ id: string; name: string; theme_name: string | null; color: string }[]>`
      SELECT DISTINCT c.id, c.name, t.name AS theme_name, c.color
      FROM codes c LEFT JOIN themes t ON t.id = c.theme_id
      ORDER BY t.name NULLS LAST, c.name
    `,
    sql<AnnotationRow[]>`
      SELECT unit_id, coder_id, code_id, start_offset, end_offset
      FROM annotations WHERE round_id = ${roundId}
    `,
    sql<ProgressRow[]>`
      SELECT unit_id, coder_id, status FROM unit_progress WHERE round_id = ${roundId}
    `,
  ]);

  const requested = coderParam?.split(",").filter(Boolean);
  const selected = requested?.length
    ? assigned.filter((c) => requested.includes(c.id))
    : assigned;

  const report = computeReliability({
    coders: selected,
    codes: codes.map((c) => ({ id: c.id, name: c.name, theme_name: c.theme_name })),
    annotations,
    progress,
  });

  const colorOf = new Map(codes.map((c) => [c.id, c.color]));
  const twoCoders = selected.length === 2;
  const usedCodes = report.perCode.filter((c) => c.everApplied);
  const unusedCodes = report.perCode.filter((c) => !c.everApplied);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/rounds/${roundId}`} className="text-[13px] muted">
            Round {round.number}
            {round.name && ` · ${round.name}`}
          </Link>
          <span className="faint">/</span>
          <h1 className="text-xl font-semibold tracking-tight">Reliability</h1>
        </div>
        <p className="muted text-[13px] max-w-3xl">
          Agreement is measured on whether each code was applied to each unit, over the{" "}
          <strong className="num">{report.nUnitsAllDone}</strong> unit
          {report.nUnitsAllDone === 1 ? "" : "s"} every selected coder has marked done. Units
          someone has not finished are treated as missing data, not as an absence of codes.
        </p>
      </header>

      {/* coder selection */}
      <div className="flex flex-wrap items-center gap-1.5 mb-5">
        <span className="label mb-0 mr-1">Comparing</span>
        {assigned.map((c) => {
          const on = selected.some((s) => s.id === c.id);
          const next = on
            ? selected.filter((s) => s.id !== c.id).map((s) => s.id)
            : [...selected.map((s) => s.id), c.id];
          return (
            <Link
              key={c.id}
              href={`/analysis/${roundId}${next.length ? `?coders=${next.join(",")}` : "?coders=none"}`}
              className="chip"
              style={
                on
                  ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }
                  : undefined
              }
            >
              {c.name}
            </Link>
          );
        })}
        {requested && (
          <Link href={`/analysis/${roundId}`} className="chip faint">
            reset
          </Link>
        )}
      </div>

      {report.warnings.map((w) => (
        <p
          key={w}
          className="panel px-3 py-2 text-[13px] mb-3"
          style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
        >
          {w}
        </p>
      ))}

      {/* headline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Metric
          label={twoCoders ? "Mean Cohen's κ" : "Mean Fleiss' κ"}
          stat={report.overall.meanKappa}
          hint={`across ${report.overall.codesIncluded} used codes · ${agreementLabel(report.overall.meanKappa.value)}`}
        />
        <Metric
          label="Mean Krippendorff's α"
          stat={report.overall.meanAlpha}
          hint={`across ${report.overall.codesIncluded} used codes · ${agreementLabel(report.overall.meanAlpha.value)}`}
        />
        <Metric
          label="Mean percent agreement"
          stat={report.overall.meanPercentAgreement}
          hint="not chance-corrected"
        />
        <Metric
          label="Pooled α"
          stat={report.overall.pooledAlpha}
          hint="all code cells at once — inflated by shared absences"
        />
      </div>

      {/* per code */}
      <section className="panel overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-[13px] font-semibold">Per code</h2>
          <p className="faint text-[12px]">
            κ and α are undefined when a code has no variance — every coder applied it to
            everything, or to nothing. Percent agreement still tells you what happened there.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                <th className="text-left font-medium faint px-4 py-2">Code</th>
                {selected.map((c) => (
                  <th key={c.id} className="text-right font-medium faint px-2 py-2 whitespace-nowrap">
                    {c.name.split(" ")[0]} n
                  </th>
                ))}
                <th className="text-right font-medium faint px-2 py-2">% agree</th>
                <th className="text-right font-medium faint px-2 py-2">
                  {twoCoders ? "Cohen κ" : "Fleiss κ"}
                </th>
                <th className="text-right font-medium faint px-2 py-2">Kripp. α</th>
                <th className="text-right font-medium faint px-2 py-2" title="Mean intersection over union of the characters each coder covered. Descriptive, not chance-corrected.">
                  Span IoU
                </th>
                <th className="text-right font-medium faint px-4 py-2" title="Spans matched on any overlap (lenient) / at least 50% IoU (strict).">
                  Span F1 len/str
                </th>
              </tr>
            </thead>
            <tbody>
              {usedCodes.map((c) => (
                <tr key={c.codeId} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-sm shrink-0"
                        style={{ background: colorOf.get(c.codeId) }}
                      />
                      <span className="font-medium">{c.codeName}</span>
                      {c.themeName && <span className="faint">· {c.themeName}</span>}
                    </span>
                  </td>
                  {selected.map((coder) => (
                    <td key={coder.id} className="text-right px-2 py-1.5 num">
                      {c.appliedCount[coder.id]}
                      <span className="faint">
                        {" "}
                        ({(c.prevalence[coder.id] * 100).toFixed(0)}%)
                      </span>
                    </td>
                  ))}
                  <td className="text-right px-2 py-1.5">
                    <StatCell stat={c.percentAgreement} digits={3} />
                  </td>
                  <td className="text-right px-2 py-1.5">
                    <StatCell stat={twoCoders ? c.cohensKappa : c.fleissKappa} />
                  </td>
                  <td className="text-right px-2 py-1.5">
                    <StatCell stat={c.alpha} />
                  </td>
                  <td className="text-right px-2 py-1.5 num faint">
                    {c.span.meanIoU === null ? "—" : c.span.meanIoU.toFixed(2)}
                  </td>
                  <td className="text-right px-4 py-1.5 num faint">
                    {c.span.lenientF1 === null
                      ? "—"
                      : `${c.span.lenientF1.toFixed(2)} / ${c.span.strictF1!.toFixed(2)}`}
                  </td>
                </tr>
              ))}
              {usedCodes.length === 0 && (
                <tr>
                  <td colSpan={selected.length + 5} className="px-4 py-6 text-center faint">
                    No codes have been applied yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {unusedCodes.length > 0 && (
          <div className="px-4 py-2 border-t faint text-[12px]" style={{ borderColor: "var(--border)" }}>
            Never applied by anyone: {unusedCodes.map((c) => c.codeName).join(", ")}
          </div>
        )}
      </section>

      {/* pairwise */}
      {report.pairwise.length > 0 && (
        <section className="panel overflow-hidden mb-6">
          <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-[13px] font-semibold">Coder pairs</h2>
            <p className="faint text-[12px]">
              Averaged across codes, over the units each pair both finished.
            </p>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                <th className="text-left font-medium faint px-4 py-2">Pair</th>
                <th className="text-right font-medium faint px-2 py-2">Shared units</th>
                <th className="text-right font-medium faint px-2 py-2">% agree</th>
                <th className="text-right font-medium faint px-2 py-2">Mean κ</th>
                <th className="text-right font-medium faint px-4 py-2">Mean α</th>
              </tr>
            </thead>
            <tbody>
              {report.pairwise.map((p) => (
                <tr key={`${p.aId}-${p.bId}`} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-1.5">
                    {p.aName} <span className="faint">×</span> {p.bName}
                  </td>
                  <td className="text-right px-2 py-1.5 num">{p.nUnits}</td>
                  <td className="text-right px-2 py-1.5">
                    <StatCell stat={p.percentAgreement} />
                  </td>
                  <td className="text-right px-2 py-1.5">
                    <StatCell stat={p.meanKappa} />
                  </td>
                  <td className="text-right px-4 py-1.5">
                    <StatCell stat={p.meanAlpha} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* disagreements */}
      <section className="panel overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-[13px] font-semibold">
              Disagreements ({report.disagreements.length})
            </h2>
            <p className="faint text-[12px]">
              Units where some coders applied a code and others did not.
            </p>
          </div>
          {viewer.role === "lead" && report.disagreements.length > 0 && (
            <Link href={`/adjudicate/${roundId}`} className="btn btn-primary text-[12px] ml-auto">
              Adjudicate
            </Link>
          )}
        </div>
        {report.disagreements.length === 0 ? (
          <p className="px-4 py-6 text-center faint text-[13px]">
            No disagreements among the units compared so far.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {report.disagreements.slice(0, 200).map((d, i) => (
              <li
                key={`${d.unitId}-${d.codeId}-${i}`}
                className="px-4 py-2 border-b last:border-0 flex items-center gap-2 text-[12px]"
                style={{ borderColor: "var(--border)" }}
              >
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ background: colorOf.get(d.codeId) }}
                />
                <span className="font-medium">{d.codeName}</span>
                <span className="muted">
                  applied by {d.appliedBy.join(", ")} · not by {d.missedBy.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="faint text-[12px] mt-4 max-w-3xl">
        Span IoU and span F1 describe <em>where</em> coders marked text, given that they agreed a
        code applies. They are raw overlap measures with no correction for chance, so quote them as
        descriptive statistics rather than reliability coefficients. Unit-level codes (applied to a
        whole comment rather than a selection) are excluded from them.
      </p>
    </div>
  );
}
