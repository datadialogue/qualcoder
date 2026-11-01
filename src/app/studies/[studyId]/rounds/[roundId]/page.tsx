import Link from "next/link";
import { notFound } from "next/navigation";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getCoders, getRoundProgress, getStudyRound } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { ActionForm } from "@/components/ActionForm";
import { ProgressBar, StatusChip } from "@/components/Progress";
import { addCoders, deleteRound, removeCoder, renameRound, setRoundStatus } from "../actions";

export const dynamic = "force-dynamic";

export default async function RoundDetailPage({
  params,
}: {
  params: Promise<{ studyId: string; roundId: string }>;
}) {
  const { studyId, roundId: id } = await params;
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;

  const round = await getStudyRound(studyId, id);
  if (!round) notFound();
  const base = `/studies/${studyId}`;

  const isLead = coder.role === "lead";
  const [progress, allCoders, [counts], strataBreakdown] = await Promise.all([
    getRoundProgress(id),
    getCoders(),
    sql<{ units: number; annotations: number }[]>`
      SELECT (SELECT count(*)::int FROM round_units WHERE round_id = ${id}) AS units,
             (SELECT count(*)::int FROM annotations WHERE round_id = ${id}) AS annotations
    `,
    // Shows the sample actually landed where the stratification intended.
    round.sampling?.strata?.length
      ? sql<{ label: string; n: number }[]>`
          SELECT concat_ws(' · ', ${sql.unsafe(
            round.sampling.strata.map((k: string) => `u.meta->>${escapeLiteral(k)}`).join(", "),
          )}) AS label,
                 count(*)::int AS n
          FROM round_units ru JOIN units u ON u.id = ru.unit_id
          WHERE ru.round_id = ${id}
          GROUP BY 1 ORDER BY 1
        `
      : Promise.resolve([]),
  ]);

  const assignedIds = new Set(progress.map((p) => p.coder_id));
  const unassigned = allCoders.filter((c) => !assignedIds.has(c.id));
  const mine = progress.find((p) => p.coder_id === coder.id);
  const s = round.sampling ?? {};

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="flex items-start gap-3 mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Round {round.number}</h1>
            <StatusChip status={round.status} />
          </div>
          {round.name && <p className="muted text-[13px] mt-0.5">{round.name}</p>}
          <p className="faint text-[12px] mt-1 num">
            {counts.units} units · {progress.length} coders · {counts.annotations} annotations
          </p>
        </div>
        <div className="flex gap-1.5">
          {mine && round.status !== "closed" && (
            <Link href={`/code/${id}`} className="btn btn-primary">
              {mine.done === 0 ? "Start coding" : "Continue coding"}
            </Link>
          )}
          <Link href={`${base}/analysis/${id}`} className="btn">
            Reliability
          </Link>
          {isLead && (
            <Link href={`${base}/adjudicate/${id}`} className="btn">
              Adjudicate
            </Link>
          )}
        </div>
      </header>

      <section className="panel p-4 mb-4">
        <h2 className="text-[13px] font-semibold mb-2">Progress</h2>
        <table className="w-full text-[12px]">
          <tbody>
            {progress.map((p) => (
              <tr key={p.coder_id}>
                <td className="py-1 pr-3 w-44 truncate">{p.name}</td>
                <td className="py-1 w-full">
                  <ProgressBar pct={p.assigned ? (p.done / p.assigned) * 100 : 0} />
                </td>
                <td className="py-1 pl-3 num faint whitespace-nowrap">
                  {p.done}/{p.assigned} done
                </td>
                <td className="py-1 pl-3 num faint whitespace-nowrap">{p.annotations} ann.</td>
                <td className="py-1 pl-3 num faint whitespace-nowrap">
                  {p.flagged > 0 ? `${p.flagged} flagged` : ""}
                </td>
              </tr>
            ))}
            {progress.length === 0 && (
              <tr>
                <td className="py-2 faint">No coders assigned.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel p-4 mb-4">
        <h2 className="text-[13px] font-semibold mb-1">How this sample was drawn</h2>
        <p className="muted text-[12px] mb-3">
          Recorded so the draw is reproducible and can be described in a methods section. The units
          themselves were stored at creation, so every coder sees the same set in the same order.
        </p>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
          <Row label="Strategy" value={s.reuseRoundId ? "reused an earlier round's sample" : (s.mode ?? "—")} />
          <Row label="Seed" value={<code>{round.seed || "—"}</code>} />
          <Row label="Requested size" value={String(s.size ?? counts.units)} />
          <Row label="Units drawn" value={String(counts.units)} />
          <Row label="Stratified by" value={s.strata?.length ? s.strata.join(" × ") : "not stratified"} />
          <Row
            label="Overlap"
            value={
              round.overlap_mode === "full"
                ? "every coder codes every unit"
                : `${Math.round((s.overlapFraction ?? 0.2) * 100)}% double-coded, remainder split`
            }
          />
          <Row
            label="Filters"
            value={
              s.filters && Object.keys(s.filters).length > 0
                ? Object.entries(s.filters)
                    .map(([k, v]) => `${k} ∈ {${(v as string[]).join(", ")}}`)
                    .join("; ")
                : "none"
            }
          />
          <Row
            label="Fresh units only"
            value={s.excludePriorRounds ? "yes — excluded units from earlier rounds" : "no"}
          />
        </dl>

        {strataBreakdown.length > 0 && (
          <details className="mt-3">
            <summary className="label cursor-pointer">Units per stratum</summary>
            <ul className="grid sm:grid-cols-3 gap-x-4 text-[12px] mt-2">
              {strataBreakdown.map((b) => (
                <li key={b.label} className="flex justify-between gap-2 py-0.5">
                  <span className="muted truncate">{b.label}</span>
                  <span className="num faint">{b.n}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {isLead && (
        <div className="grid md:grid-cols-2 gap-4">
          <section className="panel p-4">
            <h2 className="text-[13px] font-semibold mb-2">Round status</h2>
            <div className="flex flex-wrap gap-2">
              {round.status !== "open" && (
                <ActionForm action={setRoundStatus} submitLabel="Reopen" submitClassName="btn">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value="open" />
                </ActionForm>
              )}
              {round.status !== "closed" && (
                <ActionForm
                  action={setRoundStatus}
                  submitLabel="Close round"
                  submitClassName="btn"
                  confirm="Close this round? Coding becomes read-only and the codebook is snapshotted for provenance."
                >
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value="closed" />
                </ActionForm>
              )}
            </div>
            <p className="faint text-[12px] mt-2">
              Closing freezes coding and stores the codebook as it stands, so the round stays
              interpretable after codes are revised for the next iteration.
            </p>

            <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <ActionForm action={renameRound} className="space-y-2" submitLabel="Rename">
                <input type="hidden" name="id" value={id} />
                <div>
                  <label className="label">Name</label>
                  <input className="input" name="name" defaultValue={round.name} />
                </div>
              </ActionForm>
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="text-[13px] font-semibold mb-2">Coders</h2>
            {unassigned.length === 0 ? (
              <p className="faint text-[12px]">Everyone is already on this round.</p>
            ) : round.overlap_mode !== "full" ? (
              <p className="faint text-[12px]">
                This round uses a partial-overlap design, so its assignments are fixed. Create a new
                round to bring in another coder.
              </p>
            ) : (
              <ActionForm action={addCoders} className="space-y-2" submitLabel="Add to round">
                <input type="hidden" name="id" value={id} />
                <div className="space-y-1">
                  {unassigned.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" name="coder_ids" value={c.id} />
                      {c.name}
                      <span className="faint text-[11px]">{c.role}</span>
                    </label>
                  ))}
                </div>
              </ActionForm>
            )}

            {progress.length > 0 && (
              <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                <h3 className="text-[13px] font-semibold mb-2">Remove a coder</h3>
                {round.status === "closed" ? (
                  <p className="faint text-[12px]">
                    This round is closed, so its coders are fixed. Reopen it to remove someone.
                  </p>
                ) : (
                  <ActionForm
                    action={removeCoder}
                    className="space-y-2"
                    submitLabel="Remove from round"
                    submitClassName="btn btn-danger"
                    confirm="Remove this coder and delete their coding in this round? This cannot be undone."
                  >
                    <input type="hidden" name="id" value={id} />
                    <select className="select" name="coder_id" defaultValue="">
                      <option value="" disabled>
                        Choose a coder…
                      </option>
                      {progress.map((p) => (
                        <option key={p.coder_id} value={p.coder_id}>
                          {p.name} · {p.done}/{p.assigned} done, {p.annotations} ann.
                        </option>
                      ))}
                    </select>
                    <p className="faint text-[12px]">
                      Deletes their annotations and progress in this round; other rounds are
                      untouched. Export first if you may need it. Type <code>remove</code> to
                      confirm if they have already coded.
                      {round.overlap_mode !== "full" &&
                        " In this partial-overlap round, units only they were assigned will be left without a coder."}
                    </p>
                    <input className="input" name="confirm" placeholder="remove" autoComplete="off" />
                  </ActionForm>
                )}
              </div>
            )}

            <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-[13px] font-semibold mb-2">Delete round</h3>
              <ActionForm
                action={deleteRound}
                className="space-y-2"
                submitLabel="Delete round"
                submitClassName="btn btn-danger"
                confirm="Delete this round and every annotation in it? This cannot be undone."
              >
                <input type="hidden" name="id" value={id} />
                <p className="faint text-[12px]">
                  Removes the sample, assignments and all coding for this round. Type{" "}
                  <code>delete</code> to confirm if it already holds annotations.
                </p>
                <input className="input" name="confirm" placeholder="delete" />
              </ActionForm>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="faint w-32 shrink-0">{label}</dt>
      <dd className="muted">{value}</dd>
    </div>
  );
}

/** Quotes a metadata key for inline use in the strata breakdown query. */
function escapeLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
