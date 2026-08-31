import Link from "next/link";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getRounds } from "@/lib/queries";
import { computeReliability, type AnnotationRow, type ProgressRow } from "@/lib/reliability";
import { SignedOut } from "@/components/SignedOut";
import { StatCell, agreementLabel } from "@/components/Stat";

export const dynamic = "force-dynamic";

/**
 * Cross-round view. The point of iterating a codebook is that agreement should
 * climb; this puts the rounds side by side so you can see whether it did.
 */
export default async function AnalysisIndexPage() {
  const viewer = await currentCoder();
  if (!viewer) return <SignedOut />;

  const rounds = await getRounds();

  const summaries = await Promise.all(
    rounds.map(async (round) => {
      const [coders, codes, annotations, progress] = await Promise.all([
        sql<{ id: string; name: string }[]>`
          SELECT c.id, c.name FROM assignments a JOIN coders c ON c.id = a.coder_id
          WHERE a.round_id = ${round.id} ORDER BY c.name
        `,
        sql<{ id: string; name: string; theme_name: string | null }[]>`
          SELECT c.id, c.name, t.name AS theme_name
          FROM codes c LEFT JOIN themes t ON t.id = c.theme_id ORDER BY c.position
        `,
        sql<AnnotationRow[]>`
          SELECT unit_id, coder_id, code_id, start_offset, end_offset
          FROM annotations WHERE round_id = ${round.id}
        `,
        sql<ProgressRow[]>`
          SELECT unit_id, coder_id, status FROM unit_progress WHERE round_id = ${round.id}
        `,
      ]);
      // Coders who never started would drive kappa to undefined for the whole
      // round, which says more about scheduling than about the codebook.
      const active = coders.filter((c) => progress.some((p) => p.coder_id === c.id && p.status === "done"));
      const report = computeReliability({
        coders: active.length >= 2 ? active : coders,
        codes,
        annotations,
        progress,
      });
      return { round, report, active, assigned: coders };
    }),
  );

  const withData = summaries.filter((s) => s.report.overall.meanAlpha.value !== null);
  const codeNames = [
    ...new Set(summaries.flatMap((s) => s.report.perCode.filter((c) => c.everApplied).map((c) => c.codeName))),
  ].sort();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Reliability across rounds</h1>
        <p className="muted text-[13px] mt-1 max-w-2xl">
          Each round is one pass at the codebook. Comparing them shows whether revising definitions
          between iterations actually moved agreement.
        </p>
      </header>

      {rounds.length === 0 && (
        <p className="panel px-4 py-8 text-center muted text-[13px]">
          No rounds yet. <Link href="/rounds/new">Create one</Link> to start coding.
        </p>
      )}

      {rounds.length > 0 && (
        <section className="panel overflow-hidden mb-6">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                <th className="text-left font-medium faint px-4 py-2">Round</th>
                <th className="text-right font-medium faint px-2 py-2">Coders</th>
                <th className="text-right font-medium faint px-2 py-2">Units compared</th>
                <th className="text-right font-medium faint px-2 py-2">Mean κ</th>
                <th className="text-right font-medium faint px-2 py-2">Mean α</th>
                <th className="text-right font-medium faint px-2 py-2">% agree</th>
                <th className="text-left font-medium faint px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(({ round, report, active, assigned }) => (
                <tr key={round.id} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="px-4 py-2">
                    <Link href={`/analysis/${round.id}`} className="font-medium">
                      Round {round.number}
                    </Link>
                    {round.name && <span className="muted"> · {round.name}</span>}
                    <span className="faint"> · {round.status}</span>
                  </td>
                  <td className="text-right px-2 py-2 num">
                    {active.length}
                    {active.length !== assigned.length && (
                      <span className="faint" title={`${assigned.length} assigned, ${active.length} have coded`}>
                        {" "}
                        of {assigned.length}
                      </span>
                    )}
                  </td>
                  <td className="text-right px-2 py-2 num">{report.nUnitsAllDone}</td>
                  <td className="text-right px-2 py-2">
                    <StatCell stat={report.overall.meanKappa} />
                  </td>
                  <td className="text-right px-2 py-2">
                    <StatCell stat={report.overall.meanAlpha} />
                  </td>
                  <td className="text-right px-2 py-2">
                    <StatCell stat={report.overall.meanPercentAgreement} />
                  </td>
                  <td className="px-4 py-2 faint">
                    {agreementLabel(report.overall.meanAlpha.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {withData.length > 1 && codeNames.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-[13px] font-semibold">Krippendorff&rsquo;s α per code, by round</h2>
            <p className="faint text-[12px]">
              A code that stays low across rounds usually needs its definition split or sharpened,
              not more training.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                  <th className="text-left font-medium faint px-4 py-2">Code</th>
                  {summaries.map((s) => (
                    <th key={s.round.id} className="text-right font-medium faint px-3 py-2 whitespace-nowrap">
                      R{s.round.number}
                    </th>
                  ))}
                  <th className="text-right font-medium faint px-4 py-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {codeNames.map((name) => {
                  const values = summaries.map(
                    (s) => s.report.perCode.find((c) => c.codeName === name)?.alpha ?? { value: null },
                  );
                  const present = values.filter((v) => v.value !== null);
                  const delta =
                    present.length > 1
                      ? present[present.length - 1].value! - present[0].value!
                      : null;
                  return (
                    <tr key={name} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="px-4 py-1.5">{name}</td>
                      {values.map((v, i) => (
                        <td key={i} className="text-right px-3 py-1.5">
                          <StatCell stat={v} digits={2} />
                        </td>
                      ))}
                      <td
                        className="text-right px-4 py-1.5 num"
                        style={{
                          color:
                            delta === null
                              ? "var(--ink-faint)"
                              : delta > 0.02
                                ? "var(--accent)"
                                : delta < -0.02
                                  ? "var(--danger)"
                                  : "var(--ink-faint)",
                        }}
                      >
                        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
