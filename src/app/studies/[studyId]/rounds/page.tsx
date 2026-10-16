import Link from "next/link";
import { currentCoder } from "@/lib/auth";
import { getRoundProgress, getRoundSummaries } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { ProgressBar, StatusChip } from "../page";

export const dynamic = "force-dynamic";

export default async function RoundsPage() {
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;

  const rounds = await getRoundSummaries();
  const progress = new Map(
    await Promise.all(rounds.map(async (r) => [r.id, await getRoundProgress(r.id)] as const)),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="flex items-center mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Rounds</h1>
          <p className="muted text-[13px] mt-1">
            Each round is an iteration of the codebook against a fixed shared sample.
          </p>
        </div>
        {coder.role === "lead" && (
          <Link href="/rounds/new" className="btn btn-primary ml-auto">
            New round
          </Link>
        )}
      </header>

      {rounds.length === 0 ? (
        <p className="panel px-4 py-8 text-center muted text-[13px]">
          No rounds yet.{" "}
          {coder.role === "lead" && <Link href="/rounds/new">Create the first one.</Link>}
        </p>
      ) : (
        <div className="space-y-3">
          {rounds.map((r) => {
            const p = progress.get(r.id) ?? [];
            const done = p.reduce((n, x) => n + x.done, 0);
            const assigned = p.reduce((n, x) => n + x.assigned, 0);
            const mine = p.find((x) => x.coder_id === coder.id);
            return (
              <article key={r.id} className="panel p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Link href={`/rounds/${r.id}`} className="text-[14px] font-semibold">
                    Round {r.number}
                    {r.name && <span className="muted font-normal"> · {r.name}</span>}
                  </Link>
                  <StatusChip status={r.status} />
                  <span className="faint text-[12px] num">
                    {r.unit_count} units · {r.coder_count} coders ·{" "}
                    {r.overlap_mode === "full" ? "full overlap" : "partial overlap"}
                  </span>
                  <div className="ml-auto flex gap-1.5">
                    {mine && r.status !== "closed" && (
                      <Link href={`/code/${r.id}`} className="btn btn-primary text-[12px]">
                        {mine.done === 0 ? "Start coding" : "Continue"}
                      </Link>
                    )}
                    <Link href={`/analysis/${r.id}`} className="btn text-[12px]">
                      Reliability
                    </Link>
                  </div>
                </div>

                <table className="w-full text-[12px]">
                  <tbody>
                    {p.map((x) => (
                      <tr key={x.coder_id}>
                        <td className="py-0.5 pr-3 w-40 truncate">{x.name}</td>
                        <td className="py-0.5 w-full">
                          <ProgressBar pct={x.assigned ? (x.done / x.assigned) * 100 : 0} />
                        </td>
                        <td className="py-0.5 pl-3 num faint whitespace-nowrap">
                          {x.done}/{x.assigned}
                        </td>
                        <td className="py-0.5 pl-3 num faint whitespace-nowrap">
                          {x.annotations} ann.
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {assigned > 0 && (
                  <p className="faint text-[11px] mt-2 num">
                    {Math.round((done / assigned) * 100)}% of assigned coding complete
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
