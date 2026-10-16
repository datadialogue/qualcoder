import Link from "next/link";
import { notFound } from "next/navigation";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getRoundProgress, getRoundSummaries, getStudy } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { Callout, ProgressBar, StatusChip } from "@/components/Progress";

export const dynamic = "force-dynamic";

export default async function StudyOverviewPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;
  const study = await getStudy(studyId);
  if (!study) notFound();

  const base = `/studies/${studyId}`;
  const isLead = coder.role === "lead";
  const [[counts], rounds] = await Promise.all([
    sql<{ units: number; codes: number; provisional: number }[]>`
      SELECT (SELECT count(*)::int FROM units WHERE study_id = ${studyId}) AS units,
             (SELECT count(*)::int FROM codes WHERE study_id = ${studyId} AND archived = false) AS codes,
             (SELECT count(*)::int FROM codes
               WHERE study_id = ${studyId} AND archived = false AND provisional) AS provisional
    `,
    getRoundSummaries(studyId),
  ]);

  const progressByRound = new Map(
    await Promise.all(rounds.map(async (r) => [r.id, await getRoundProgress(r.id)] as const)),
  );
  const mine = rounds.filter(
    (r) => r.status === "open" && progressByRound.get(r.id)?.some((p) => p.coder_id === coder.id),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{study.name}</h1>
        {study.description && (
          <p className="muted text-[13px] mt-1 max-w-2xl whitespace-pre-line">{study.description}</p>
        )}
        <p className="faint text-[12px] mt-1 num">
          {counts.units.toLocaleString()} units · {counts.codes} active codes
          {counts.provisional > 0 && ` (${counts.provisional} awaiting review)`} · {rounds.length}{" "}
          round{rounds.length === 1 ? "" : "s"} · source: {study.source}
        </p>
      </header>

      {isLead && counts.units === 0 && (
        <Callout
          title="This study has no data yet"
          body="Upload a starter file — CSV, JSON, JSON Lines or a Reddit export — to create the units coders will work through."
          href={`${base}/settings`}
          cta="Import data"
        />
      )}
      {isLead && counts.units > 0 && counts.codes === 0 && (
        <Callout
          title="The codebook is empty"
          body="Paste your existing themes and codes in before creating a round, or create a round anyway and let coders build the codebook as they go."
          href={`${base}/codebook`}
          cta="Set up the codebook"
        />
      )}
      {isLead && counts.units > 0 && counts.codes > 0 && rounds.length === 0 && (
        <Callout
          title="No rounds yet"
          body="A round draws a shared sample and assigns it to coders. Everyone on a round sees exactly the same units in the same order."
          href={`${base}/rounds/new`}
          cta="Create the first round"
        />
      )}

      {mine.length > 0 && (
        <section className="mb-6">
          <h2 className="label mb-2">Your open work</h2>
          <div className="space-y-2">
            {mine.map((r) => {
              const me = progressByRound.get(r.id)!.find((p) => p.coder_id === coder.id)!;
              const pct = me.assigned ? Math.round((me.done / me.assigned) * 100) : 0;
              return (
                <Link
                  key={r.id}
                  href={`/code/${r.id}`}
                  className="panel px-4 py-3 flex items-center gap-4 hover:border-[var(--ink-faint)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium">
                      Round {r.number}
                      {r.name && <span className="muted font-normal"> · {r.name}</span>}
                    </div>
                    <div className="faint text-[12px] mt-0.5 num">
                      {me.done} of {me.assigned} units done · {me.annotations} annotations
                      {me.flagged > 0 && ` · ${me.flagged} flagged`}
                    </div>
                  </div>
                  <div className="w-40 shrink-0">
                    <ProgressBar pct={pct} />
                  </div>
                  <span className="btn btn-primary text-[12px] shrink-0">
                    {me.done === 0 ? "Start coding" : pct === 100 ? "Review" : "Continue"}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="label mb-0">All rounds</h2>
          {isLead && (
            <Link href={`${base}/rounds/new`} className="btn text-[12px] ml-auto">
              New round
            </Link>
          )}
        </div>
        {rounds.length === 0 ? (
          <p className="panel px-4 py-6 text-center muted text-[13px]">No rounds yet.</p>
        ) : (
          <div className="space-y-2">
            {rounds.map((r) => {
              const progress = progressByRound.get(r.id) ?? [];
              const done = progress.reduce((n, p) => n + p.done, 0);
              const assigned = progress.reduce((n, p) => n + p.assigned, 0);
              return (
                <div key={r.id} className="panel px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Link href={`${base}/rounds/${r.id}`} className="text-[13px] font-medium">
                      Round {r.number}
                      {r.name && <span className="muted font-normal"> · {r.name}</span>}
                    </Link>
                    <StatusChip status={r.status} />
                    <span className="faint text-[12px] num">
                      {r.unit_count} units · {r.coder_count} coders
                    </span>
                    <div className="ml-auto flex gap-1.5">
                      <Link href={`${base}/analysis/${r.id}`} className="btn text-[12px]">
                        Reliability
                      </Link>
                      <Link href={`${base}/rounds/${r.id}`} className="btn text-[12px]">
                        Details
                      </Link>
                    </div>
                  </div>
                  {progress.length > 0 && (
                    <div className="mt-2 flex items-center gap-3">
                      <div className="flex-1">
                        <ProgressBar pct={assigned ? Math.round((done / assigned) * 100) : 0} />
                      </div>
                      <span className="faint text-[11px] num shrink-0">
                        {done}/{assigned} coded
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
