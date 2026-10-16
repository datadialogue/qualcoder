import { currentCoder } from "@/lib/auth";
import { getCoders, getRoundSummaries } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { ExportPanel } from "@/components/ExportPanel";

export const dynamic = "force-dynamic";

export default async function ExportPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;
  const [rounds, coders] = await Promise.all([getRoundSummaries(studyId), getCoders()]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Export</h1>
        <p className="muted text-[13px] mt-1 max-w-2xl">
          Everything leaves as plain CSV or JSON. Each annotation export carries the original
          metadata columns alongside it, so the files stand on their own without this app.
        </p>
      </header>

      <ExportPanel
        studyId={studyId}
        rounds={rounds.map((r) => ({
          id: r.id,
          label: `Round ${r.number}${r.name ? ` · ${r.name}` : ""} (${r.unit_count} units)`,
        }))}
        coders={coders.map((c) => ({ id: c.id, name: c.name }))}
      />

      <section className="panel p-4 mt-4">
        <h2 className="text-[13px] font-semibold mb-1">A note on reading the exports</h2>
        <p className="muted text-[13px]">
          In <code>code-matrix.csv</code> a <code>0</code> means the coder finished that unit and
          judged the code did not apply. Units a coder never finished have no row at all, because
          treating them as zeros would silently inflate every agreement statistic. The{" "}
          <code>status</code> column carries that distinction explicitly, and{" "}
          <code>progress.csv</code> gives the full picture.
        </p>
      </section>
    </div>
  );
}
