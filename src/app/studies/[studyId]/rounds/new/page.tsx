import Link from "next/link";
import { randomBytes } from "node:crypto";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getCoders, getMetaFacets } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { LeadOnly } from "@/components/Progress";
import type { SamplingConfig } from "@/lib/types";
import { NewRoundForm } from "@/components/NewRoundForm";
import { createRound } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewRoundPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  const base = `/studies/${studyId}`;
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;
  if (coder.role !== "lead") {
    return <LeadOnly what="Only the project lead can create rounds." href={base} label="Back to the study" />;
  }

  const [coders, facets, priorRounds, [counts], codeCount] = await Promise.all([
    getCoders(),
    getMetaFacets(studyId),
    sql<
      { id: string; number: number; name: string; unit_count: number; sampling: SamplingConfig }[]
    >`
      SELECT r.id, r.number, r.name, r.sampling,
             (SELECT count(*)::int FROM round_units ru WHERE ru.round_id = r.id) AS unit_count
      FROM rounds r WHERE r.study_id = ${studyId} ORDER BY r.number DESC
    `,
    sql<{ total: number; used: number }[]>`
      SELECT (SELECT count(*)::int FROM units WHERE study_id = ${studyId}) AS total,
             (SELECT count(DISTINCT ru.unit_id)::int
                FROM round_units ru JOIN rounds r ON r.id = ru.round_id
               WHERE r.study_id = ${studyId}) AS used
    `,
    sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM codes WHERE study_id = ${studyId} AND archived = false
    `,
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">New round</h1>
        <p className="muted text-[13px] mt-1">
          A round is one iteration: a fixed sample, a set of coders, and the coding they produce.
        </p>
      </header>

      {codeCount[0].n === 0 && (
        <p className="panel p-3 mb-4 text-[13px]" style={{ borderColor: "var(--warn)" }}>
          Your codebook is empty, so coders would have nothing to apply.{" "}
          <Link href={`${base}/codebook`} style={{ color: "var(--accent)" }}>
            Add codes first
          </Link>
          , or go ahead — coders can add codes as they work.
        </p>
      )}

      {counts.total === 0 && (
        <p className="panel p-3 mb-4 text-[13px]" style={{ borderColor: "var(--warn)" }}>
          This study has no units yet.{" "}
          <Link href={`${base}/settings`} style={{ color: "var(--accent)" }}>
            Import data first
          </Link>
          .
        </p>
      )}

      <NewRoundForm
        action={createRound}
        studyId={studyId}
        defaultStrata={priorRounds[0]?.sampling?.strata ?? []}
        coders={coders.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
        facets={facets}
        priorRounds={priorRounds.map(({ sampling: _s, ...r }) => r)}
        totalUnits={counts.total}
        unusedUnits={counts.total - counts.used}
        defaultSeed={randomBytes(6).toString("hex")}
      />
    </div>
  );
}
