import Link from "next/link";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { configProblems } from "@/lib/env";
import { getRoundProgress, getRoundSummaries } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";

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

  const [[counts], rounds] = await Promise.all([
    sql<{ units: number; codes: number; coders: number }[]>`
      SELECT (SELECT count(*)::int FROM units) AS units,
             (SELECT count(*)::int FROM codes WHERE archived = false) AS codes,
             (SELECT count(*)::int FROM coders WHERE active = true) AS coders
    `,
    getRoundSummaries(),
  ]);

  const progressByRound = new Map(
    await Promise.all(
      rounds.map(async (r) => [r.id, await getRoundProgress(r.id)] as const),
    ),
  );

  const mine = rounds.filter(
    (r) => r.status === "open" && progressByRound.get(r.id)?.some((p) => p.coder_id === coder.id),
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {greeting()}, {coder.name.split(" ")[0]}
        </h1>
        <p className="muted text-[13px] mt-1">
          {counts.units.toLocaleString()} units imported · {counts.codes} active codes ·{" "}
          {counts.coders} coder{counts.coders === 1 ? "" : "s"}
        </p>
      </header>

      {counts.codes === 0 && coder.role === "lead" && (
        <Callout
          title="Your codebook is empty"
          body="Paste your existing themes and codes in before creating a round, so coders have something to apply."
          href="/codebook"
          cta="Set up the codebook"
        />
      )}
      {counts.codes > 0 && rounds.length === 0 && coder.role === "lead" && (
        <Callout
          title="No rounds yet"
          body="A round draws a shared sample and assigns it to coders. Everyone on a round sees exactly the same units in the same order."
          href="/rounds/new"
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
          {coder.role === "lead" && (
            <Link href="/rounds/new" className="btn text-[12px] ml-auto">
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
                    <Link href={`/rounds/${r.id}`} className="text-[13px] font-medium">
                      Round {r.number}
                      {r.name && <span className="muted font-normal"> · {r.name}</span>}
                    </Link>
                    <StatusChip status={r.status} />
                    <span className="faint text-[12px] num">
                      {r.unit_count} units · {r.coder_count} coders
                    </span>
                    <div className="ml-auto flex gap-1.5">
                      <Link href={`/analysis/${r.id}`} className="btn text-[12px]">
                        Reliability
                      </Link>
                      <Link href={`/rounds/${r.id}`} className="btn text-[12px]">
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

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: "var(--accent)" }}
      />
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const style: Record<string, { bg: string; fg: string }> = {
    open: { bg: "var(--accent-soft)", fg: "var(--accent)" },
    draft: { bg: "var(--warn-soft)", fg: "var(--warn)" },
    closed: { bg: "var(--border)", fg: "var(--ink-soft)" },
  };
  const s = style[status] ?? style.closed;
  return (
    <span className="chip" style={{ background: s.bg, color: s.fg, borderColor: "transparent" }}>
      {status}
    </span>
  );
}

function Callout({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="panel p-4 mb-6" style={{ borderColor: "var(--accent)" }}>
      <h2 className="text-[13px] font-semibold mb-1">{title}</h2>
      <p className="muted text-[13px] mb-3 max-w-xl">{body}</p>
      <Link href={href} className="btn btn-primary text-[12px]">
        {cta}
      </Link>
    </div>
  );
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
            Import your data: <code>npm run import -- yourfile.csv</code>.
          </li>
          <li>
            Mint the first invite: <code>npm run seed:lead -- --name=&quot;Your Name&quot;</code>.
          </li>
        </ol>
      </div>
    </div>
  );
}
