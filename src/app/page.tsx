import Link from "next/link";
import { currentCoder } from "@/lib/auth";
import { configProblems } from "@/lib/env";
import {
  getCoderStudyIds,
  getOpenWork,
  getRoundProgress,
  getStudySummaries,
  type StudySummary,
} from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { Callout, ProgressBar, StatusChip } from "@/components/Progress";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Checked before anything touches the database, so a misconfigured deployment
  // explains itself instead of returning an opaque 500.
  const problems = configProblems();
  if (problems.length > 0) return <SetupNeeded problems={problems} />;

  let coder;
  try {
    coder = await currentCoder();
  } catch (err) {
    return <SetupNeeded problems={[err instanceof Error ? err.message : String(err)]} />;
  }
  if (!coder) return <SignedOut />;

  const isLead = coder.role === "lead";
  const [studies, openWork, assignedStudyIds] = await Promise.all([
    getStudySummaries(),
    getOpenWork(coder.id),
    getCoderStudyIds(coder.id),
  ]);
  const progress = new Map(
    await Promise.all(
      openWork.map(async (r) => {
        const p = await getRoundProgress(r.id);
        return [r.id, p.find((x) => x.coder_id === coder.id)] as const;
      }),
    ),
  );

  // Coders see the studies they have been on a round in; leads see everything.
  const visible = studies.filter((s) => isLead || assignedStudyIds.has(s.id));
  const active = visible.filter((s) => s.status === "active");
  const archived = visible.filter((s) => s.status === "archived");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-start gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {greeting()}, {coder.name.split(" ")[0]}
          </h1>
          <p className="muted text-[13px] mt-1">
            {active.length} active stud{active.length === 1 ? "y" : "ies"}
            {openWork.length > 0 &&
              ` · ${openWork.length} open round${openWork.length === 1 ? "" : "s"} assigned to you`}
          </p>
        </div>
        {isLead && (
          <Link href="/studies/new" className="btn btn-primary ml-auto">
            New study
          </Link>
        )}
      </header>

      {isLead && studies.length === 0 && (
        <Callout
          title="Start your first study"
          body="A study holds one dataset, its codebook and its coding rounds. Upload a starter file — a CSV, JSON, JSON Lines or a Reddit export — optionally with a starting codebook."
          href="/studies/new"
          cta="New study"
        />
      )}

      {openWork.length > 0 && (
        <section className="mb-6">
          <h2 className="label mb-2">Your open work</h2>
          <div className="space-y-2">
            {openWork.map((r) => {
              const me = progress.get(r.id);
              const pct = me?.assigned ? Math.round((me.done / me.assigned) * 100) : 0;
              return (
                <Link
                  key={r.id}
                  href={`/code/${r.id}`}
                  className="panel px-4 py-3 flex items-center gap-4 hover:border-[var(--ink-faint)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium">
                      {r.study_name} <span className="faint font-normal">/</span> Round {r.number}
                      {r.name && <span className="muted font-normal"> · {r.name}</span>}
                    </div>
                    {me && (
                      <div className="faint text-[12px] mt-0.5 num">
                        {me.done} of {me.assigned} units done · {me.annotations} annotations
                        {me.flagged > 0 && ` · ${me.flagged} flagged`}
                      </div>
                    )}
                  </div>
                  <div className="w-40 shrink-0">
                    <ProgressBar pct={pct} />
                  </div>
                  <span className="btn btn-primary text-[12px] shrink-0">
                    {!me || me.done === 0 ? "Start coding" : pct === 100 ? "Review" : "Continue"}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="label mb-2">Studies</h2>
        {active.length === 0 ? (
          <p className="panel px-4 py-6 text-center muted text-[13px]">
            {isLead ? "No active studies." : "You have not been assigned to a study yet."}
          </p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {active.map((s) => (
              <StudyCard key={s.id} study={s} />
            ))}
          </div>
        )}
        {archived.length > 0 && (
          <details className="mt-4">
            <summary className="label cursor-pointer">
              {archived.length} archived stud{archived.length === 1 ? "y" : "ies"}
            </summary>
            <div className="grid md:grid-cols-2 gap-3 mt-2">
              {archived.map((s) => (
                <StudyCard key={s.id} study={s} />
              ))}
            </div>
          </details>
        )}
      </section>
    </div>
  );
}

function StudyCard({ study }: { study: StudySummary }) {
  return (
    <Link
      href={`/studies/${study.id}`}
      className="panel px-4 py-3 block hover:border-[var(--ink-faint)] transition-colors"
      style={{ opacity: study.status === "archived" ? 0.7 : 1 }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold truncate">{study.name}</span>
        <span className="chip">{study.source}</span>
        {study.open_rounds > 0 && <StatusChip status="open" />}
      </div>
      {study.description && (
        <p className="muted text-[12px] mt-1 line-clamp-2">{study.description}</p>
      )}
      <p className="faint text-[12px] mt-1.5 num">
        {study.unit_count.toLocaleString()} units · {study.code_count} codes · {study.round_count}{" "}
        round{study.round_count === 1 ? "" : "s"}
      </p>
    </Link>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function SetupNeeded({ problems }: { problems: string[] }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="panel p-6">
        <h1 className="text-[15px] font-semibold mb-2">
          {problems.length === 1 ? "Configuration problem" : "Configuration problems"}
        </h1>
        <ul className="muted text-[13px] mb-4 space-y-2 list-disc ml-5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <h2 className="text-[13px] font-semibold mb-1">First-time setup</h2>
        <ol className="muted text-[13px] list-decimal ml-5 space-y-1">
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code> and set{" "}
            <code>POSTGRES_URL</code> and <code>AUTH_SECRET</code>.
          </li>
          <li>
            Run <code>npm run db:migrate</code>.
          </li>
          <li>
            Mint the first invite: <code>npm run seed:lead -- --name=&quot;Your Name&quot;</code>.
          </li>
          <li>
            Open the link, then create a study from the home page by uploading a starter file.
          </li>
        </ol>
      </div>
    </div>
  );
}
