import Link from "next/link";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getCodebook } from "@/lib/queries";
import { canTakePart, requiredVoters, type CodeMerge } from "@/lib/merges";
import { SignedOut } from "@/components/SignedOut";
import { ActionForm } from "@/components/ActionForm";
import { applyMergeNow, approveMerge, proposeMerge, voteMerge, withdrawMerge } from "./actions";

export const dynamic = "force-dynamic";

interface MergeRow extends CodeMerge {
  proposer_name: string | null;
  approver_name: string | null;
}

export default async function MergesPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string }>;
  searchParams: Promise<{ codes?: string }>;
}) {
  const { studyId } = await params;
  const { codes: preselect } = await searchParams;
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;
  const base = `/studies/${studyId}/codebook`;

  const [themes, usage, merges, mergeCodes, votes, mayAct] = await Promise.all([
    getCodebook(studyId),
    sql<{ code_id: string; n: number }[]>`
      SELECT a.code_id, count(*)::int AS n
      FROM annotations a JOIN codes c ON c.id = a.code_id
      WHERE c.study_id = ${studyId}
      GROUP BY a.code_id
    `,
    sql<MergeRow[]>`
      SELECT m.*, co.name AS proposer_name, ap.name AS approver_name
      FROM code_merges m
      LEFT JOIN coders co ON co.id = m.proposed_by
      LEFT JOIN coders ap ON ap.id = m.approved_by
      WHERE m.study_id = ${studyId}
      ORDER BY COALESCE(m.merged_at, m.created_at) DESC
    `,
    sql<{ merge_id: string; id: string; name: string; color: string; merged_into: string | null }[]>`
      SELECT mc.merge_id, c.id, c.name, c.color, c.merged_into
      FROM code_merge_codes mc
      JOIN code_merges m ON m.id = mc.merge_id
      JOIN codes c ON c.id = mc.code_id
      WHERE m.study_id = ${studyId}
      ORDER BY c.name
    `,
    sql<{ merge_id: string; coder_id: string; name: string; vote: string; comment: string }[]>`
      SELECT v.merge_id, v.coder_id, co.name, v.vote, v.comment
      FROM code_merge_votes v
      JOIN code_merges m ON m.id = v.merge_id
      JOIN coders co ON co.id = v.coder_id
      WHERE m.study_id = ${studyId}
      ORDER BY v.updated_at
    `,
    canTakePart(coder, studyId),
  ]);
  const useCount = new Map(usage.map((u) => [u.code_id, u.n]));
  const codesOf = (id: string) => mergeCodes.filter((c) => c.merge_id === id);
  const votesOf = (id: string) => votes.filter((v) => v.merge_id === id);
  const open = merges.filter((m) => m.status === "proposed");
  const done = merges.filter((m) => m.status === "merged");
  const dropped = merges.filter((m) => m.status === "withdrawn" || m.status === "superseded");
  const voters = new Map(
    await Promise.all(open.map(async (m) => [m.id, await requiredVoters(studyId, m.proposed_by)] as const)),
  );
  const checked = new Set((preselect ?? "").split(",").filter(Boolean));
  const totalCodes = themes.reduce((n, t) => n + t.codes.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <p className="text-[12px] mb-1">
          <Link href={base}>← Codebook</Link>
        </p>
        <h1 className="text-xl font-semibold tracking-tight">Merge codes</h1>
        <p className="muted text-[13px] mt-1 max-w-2xl">
          When several codes turn out to mean the same thing, anyone on the team can propose merging
          them. The merge happens once everyone who has coded in this study agrees, or when a lead
          approves it. It applies to
          every round, past and future: all their annotations move onto one code. The old codes are
          hidden from the coding palette but kept on record, and every annotation remembers which
          code it was first given.
        </p>
      </header>

      {!mayAct && (
        <p className="panel px-3 py-2 text-[13px] muted mb-6">
          You have not been assigned to a round in this study, so you can follow merges here but not
          propose or vote on them.
        </p>
      )}

      {open.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[13px] font-semibold mb-2">Waiting for agreement</h2>
          <div className="space-y-3">
            {open.map((m) => {
              const mVotes = votesOf(m.id);
              const required = voters.get(m.id) ?? [];
              const voteBy = new Map(mVotes.map((v) => [v.coder_id, v]));
              const extra = mVotes.filter((v) => !required.some((r) => r.id === v.coder_id));
              const mine = voteBy.get(coder.id);
              const allAgreed = required.every((r) => voteBy.get(r.id)?.vote === "agree");
              const waitingOn = required.filter((r) => voteBy.get(r.id)?.vote !== "agree").map((r) => r.name);
              const against = mVotes.filter((v) => v.vote === "disagree").map((v) => v.name);
              return (
                <article key={m.id} className="panel p-4" style={{ borderColor: "var(--warn)" }}>
                  <MergeLine
                    codes={codesOf(m.id)}
                    newName={m.new_name}
                    uses={useCount}
                    base={base}
                  />
                  {m.new_definition && (
                    <p className="text-[13px] mt-2">
                      <span className="label inline mr-1">New definition</span>
                      {m.new_definition}
                    </p>
                  )}
                  {m.rationale && (
                    <p className="text-[13px] mt-1 muted">
                      <span className="label inline mr-1">Why</span>
                      {m.rationale}
                    </p>
                  )}
                  <p className="faint text-[12px] mt-1">
                    Proposed by {m.proposer_name ?? "someone"} ·{" "}
                    {new Date(m.created_at).toLocaleDateString()}
                  </p>

                  <ul className="flex flex-wrap gap-1.5 mt-3">
                    {[...required, ...extra.map((v) => ({ id: v.coder_id, name: v.name }))].map((r) => {
                      const v = voteBy.get(r.id);
                      return (
                        <li
                          key={r.id}
                          className="chip"
                          title={v?.comment || undefined}
                          style={
                            v?.vote === "agree"
                              ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "transparent" }
                              : v?.vote === "disagree"
                                ? { color: "var(--danger)", borderColor: "var(--danger)" }
                                : undefined
                          }
                        >
                          {v?.vote === "agree" ? "✓" : v?.vote === "disagree" ? "✗" : "…"} {r.name}
                          {v?.comment && <span className="faint">“{v.comment}”</span>}
                        </li>
                      );
                    })}
                  </ul>

                  {coder.role === "lead" && !allAgreed && (
                    <ActionForm
                      action={approveMerge}
                      className="mt-3"
                      submitLabel="Approve as lead"
                      submitClassName="btn btn-primary text-[12px]"
                      confirm={
                        `Merge now without waiting for ${waitingOn.join(", ")}?` +
                        (against.length ? ` ${against.join(", ")} disagreed.` : "") +
                        " The history will show you approved it."
                      }
                    >
                      <input type="hidden" name="study_id" value={studyId} />
                      <input type="hidden" name="merge_id" value={m.id} />
                    </ActionForm>
                  )}

                  {mayAct && (
                    <div className="flex flex-wrap items-start gap-2 mt-3">
                      {mine?.vote !== "agree" && (
                        <ActionForm action={voteMerge} submitLabel="Agree" submitClassName="btn btn-primary text-[12px]">
                          <input type="hidden" name="study_id" value={studyId} />
                          <input type="hidden" name="merge_id" value={m.id} />
                          <input type="hidden" name="vote" value="agree" />
                        </ActionForm>
                      )}
                      {mine?.vote !== "disagree" && (
                        <ActionForm
                          action={voteMerge}
                          className="flex gap-2 items-start"
                          submitLabel="Disagree"
                          submitClassName="btn text-[12px]"
                        >
                          <input type="hidden" name="study_id" value={studyId} />
                          <input type="hidden" name="merge_id" value={m.id} />
                          <input type="hidden" name="vote" value="disagree" />
                          <input className="input text-[12px] w-56" name="comment" placeholder="Why not? (optional)" />
                        </ActionForm>
                      )}
                      {allAgreed && (
                        <ActionForm action={applyMergeNow} submitLabel="Apply merge" submitClassName="btn btn-primary text-[12px]">
                          <input type="hidden" name="study_id" value={studyId} />
                          <input type="hidden" name="merge_id" value={m.id} />
                        </ActionForm>
                      )}
                      {(m.proposed_by === coder.id || coder.role === "lead") && (
                        <ActionForm
                          action={withdrawMerge}
                          submitLabel="Withdraw"
                          submitClassName="btn btn-danger text-[12px] ml-auto"
                          confirm="Withdraw this merge proposal?"
                        >
                          <input type="hidden" name="study_id" value={studyId} />
                          <input type="hidden" name="merge_id" value={m.id} />
                        </ActionForm>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {mayAct && (
        <section className="panel p-4 mb-8">
          <h2 className="text-[13px] font-semibold mb-1">Propose a merge</h2>
          <p className="muted text-[12px] mb-3 max-w-2xl">
            Tick the codes that mean the same thing. Use{" "}
            <span className="faint">explore</span> to read the posts each code was applied to
            before deciding.
          </p>
          {totalCodes < 2 ? (
            <p className="faint text-[13px]">The codebook needs at least two codes to merge.</p>
          ) : (
            <ActionForm action={proposeMerge} className="space-y-4" submitLabel="Propose merge">
              <input type="hidden" name="study_id" value={studyId} />
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-3">
                {themes.map((t) => (
                  <fieldset key={t.id}>
                    <legend className="label flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                      {t.name}
                    </legend>
                    {t.codes.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-[13px] py-0.5">
                        <input type="checkbox" name="code_id" value={c.id} defaultChecked={checked.has(c.id)} />
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
                        <span className="truncate">{c.name}</span>
                        <span className="faint text-[12px] num shrink-0">{useCount.get(c.id) ?? 0}</span>
                        <Link href={`${base}/${c.id}`} className="text-[12px] shrink-0 ml-auto">
                          explore
                        </Link>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="label">Name for the merged code</label>
                  <input
                    className="input"
                    name="new_name"
                    placeholder="Leave blank to keep the most-used code's name"
                  />
                </div>
                <div>
                  <label className="label">Why these are the same (optional)</label>
                  <input className="input" name="rationale" />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Definition of the merged code (optional)</label>
                  <textarea
                    className="textarea"
                    name="new_definition"
                    rows={2}
                    placeholder="Leave blank to keep the existing definition"
                  />
                </div>
              </div>
            </ActionForm>
          )}
        </section>
      )}

      <section>
        <h2 className="text-[13px] font-semibold mb-2">Merge history</h2>
        {done.length === 0 ? (
          <p className="faint text-[13px]">No codes have been merged yet.</p>
        ) : (
          <ul className="panel overflow-hidden">
            {done.map((m) => {
              const snap = m.snapshot;
              const agreed = votesOf(m.id).filter((v) => v.vote === "agree").map((v) => v.name);
              return (
                <li key={m.id} className="px-4 py-3 border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                    {(snap?.codes ?? []).map((c) => (
                      <Link key={c.id} href={`${base}/${c.id}`} className="chip" style={{ borderColor: c.color }}>
                        <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />
                        {c.name}
                        <span className="faint num">{c.annotations}</span>
                      </Link>
                    ))}
                    <span className="faint">→</span>
                    <Link href={`${base}/${m.target_code_id}`} className="font-medium">
                      {m.new_name}
                    </Link>
                  </div>
                  <p className="faint text-[12px] mt-1">
                    {m.merged_at && new Date(m.merged_at).toLocaleDateString()} ·{" "}
                    {m.approved_by ? (
                      <>
                        approved by {m.approver_name ?? "a lead"} (lead)
                        {agreed.length > 1 && `; agreed by ${agreed.filter((n) => n !== m.approver_name).join(", ")}`}
                      </>
                    ) : (
                      <>agreed by {agreed.join(", ") || "—"}</>
                    )}{" "}
                    · proposed by {m.proposer_name ?? "someone"}
                    {snap && (
                      <>
                        {" "}
                        · {snap.moved} annotation{snap.moved === 1 ? "" : "s"} moved
                        {snap.folded > 0 && `, ${snap.folded} duplicate${snap.folded === 1 ? "" : "s"} folded`}
                      </>
                    )}
                  </p>
                  {m.rationale && <p className="muted text-[12px] mt-0.5">{m.rationale}</p>}
                </li>
              );
            })}
          </ul>
        )}
        {dropped.length > 0 && (
          <details className="mt-3">
            <summary className="faint text-[12px] cursor-pointer">
              {dropped.length} withdrawn or superseded proposal{dropped.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 space-y-1">
              {dropped.map((m) => (
                <li key={m.id} className="text-[12px] muted">
                  {codesOf(m.id).map((c) => c.name).join(", ")} → {m.new_name}{" "}
                  <span className="faint">
                    · {m.status === "superseded" ? "superseded by another merge" : "withdrawn"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

function MergeLine({
  codes,
  newName,
  uses,
  base,
}: {
  codes: Array<{ id: string; name: string; color: string }>;
  newName: string;
  uses: Map<string, number>;
  base: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
      {codes.map((c) => (
        <Link key={c.id} href={`${base}/${c.id}`} className="chip" style={{ borderColor: c.color }}>
          <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />
          {c.name}
          <span className="faint num">{uses.get(c.id) ?? 0}</span>
        </Link>
      ))}
      <span className="faint">→</span>
      <span className="font-semibold">{newName}</span>
    </div>
  );
}
