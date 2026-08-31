import Link from "next/link";
import { randomBytes } from "node:crypto";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getCoders, getMetaFacets } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import { NewRoundForm } from "@/components/NewRoundForm";
import { createRound } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewRoundPage() {
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;
  if (coder.role !== "lead") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <p className="panel p-6 text-[13px] muted">
          Only the project lead can create rounds. <Link href="/">Back to overview</Link>
        </p>
      </div>
    );
  }

  const [coders, facets, priorRounds, [counts], codeCount] = await Promise.all([
    getCoders(),
    getMetaFacets(),
    sql<{ id: string; number: number; name: string; unit_count: number }[]>`
      SELECT r.id, r.number, r.name,
             (SELECT count(*)::int FROM round_units ru WHERE ru.round_id = r.id) AS unit_count
      FROM rounds r ORDER BY r.number DESC
    `,
    sql<{ total: number; used: number }[]>`
      SELECT (SELECT count(*)::int FROM units) AS total,
             (SELECT count(DISTINCT unit_id)::int FROM round_units) AS used
    `,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM codes WHERE archived = false`,
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
          <Link href="/codebook" style={{ color: "var(--accent)" }}>
            Add codes first
          </Link>
          .
        </p>
      )}

      <NewRoundForm
        action={createRound}
        coders={coders.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
        facets={facets}
        priorRounds={priorRounds}
        totalUnits={counts.total}
        unusedUnits={counts.total - counts.used}
        defaultSeed={randomBytes(6).toString("hex")}
      />
    </div>
  );
}
