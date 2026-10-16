import Link from "next/link";
import { notFound } from "next/navigation";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getStudyRound } from "@/lib/queries";
import { computeReliability, type AnnotationRow, type ProgressRow } from "@/lib/reliability";
import { SignedOut } from "@/components/SignedOut";
import { Adjudicator, type AdjUnit } from "@/components/Adjudicator";
import type { ContextItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdjudicatePage({
  params,
}: {
  params: Promise<{ studyId: string; roundId: string }>;
}) {
  const { studyId, roundId } = await params;
  const base = `/studies/${studyId}`;
  const viewer = await currentCoder();
  if (!viewer) return <SignedOut />;

  const round = await getStudyRound(studyId, roundId);
  if (!round) notFound();

  if (viewer.role !== "lead") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <p className="panel p-6 text-[13px] muted">
          Adjudication produces the agreed coding of record, so it is restricted to the project
          lead. <Link href={`${base}/analysis/${roundId}`}>View reliability instead</Link>
        </p>
      </div>
    );
  }

  const [coders, codes, annotations, progress] = await Promise.all([
    sql<{ id: string; name: string }[]>`
      SELECT c.id, c.name FROM assignments a JOIN coders c ON c.id = a.coder_id
      WHERE a.round_id = ${roundId} ORDER BY c.name
    `,
    sql<{ id: string; name: string; color: string; theme_name: string | null }[]>`
      SELECT c.id, c.name, c.color, t.name AS theme_name
      FROM codes c LEFT JOIN themes t ON t.id = c.theme_id
      WHERE c.study_id = ${studyId} AND c.archived = false ORDER BY c.position
    `,
    sql<AnnotationRow[]>`
      SELECT unit_id, coder_id, code_id, start_offset, end_offset
      FROM annotations WHERE round_id = ${roundId}
    `,
    sql<ProgressRow[]>`
      SELECT unit_id, coder_id, status FROM unit_progress WHERE round_id = ${roundId}
    `,
  ]);

  const report = computeReliability({ coders, codes, annotations, progress });

  // One entry per unit that has at least one contested code.
  const contestedByUnit = new Map<string, Set<string>>();
  for (const d of report.disagreements) {
    const set = contestedByUnit.get(d.unitId) ?? new Set<string>();
    set.add(d.codeId);
    contestedByUnit.set(d.unitId, set);
  }
  const unitIds = [...contestedByUnit.keys()];

  let units: AdjUnit[] = [];
  if (unitIds.length > 0) {
    const [rows, detail, notes, agreed, adjudications] = await Promise.all([
      sql<{ id: string; external_id: string; text: string; context: ContextItem[]; position: number }[]>`
        SELECT u.id, u.external_id, u.text, u.context, ru.position
        FROM units u JOIN round_units ru ON ru.unit_id = u.id AND ru.round_id = ${roundId}
        WHERE u.id = ANY(${unitIds}) ORDER BY ru.position
      `,
      sql<
        Array<{
          unit_id: string;
          coder_id: string;
          code_id: string;
          start_offset: number | null;
          end_offset: number | null;
          quote: string;
        }>
      >`
        SELECT unit_id, coder_id, code_id, start_offset, end_offset, quote
        FROM annotations
        WHERE round_id = ${roundId} AND unit_id = ANY(${unitIds})
        ORDER BY start_offset NULLS FIRST
      `,
      sql<{ unit_id: string; coder_id: string; note: string }[]>`
        SELECT unit_id, coder_id, note FROM unit_progress
        WHERE round_id = ${roundId} AND unit_id = ANY(${unitIds}) AND note <> ''
      `,
      sql<
        Array<{ unit_id: string; code_id: string; start_offset: number | null; end_offset: number | null }>
      >`
        SELECT unit_id, code_id, start_offset, end_offset
        FROM adjudicated_annotations WHERE round_id = ${roundId}
      `,
      sql<{ unit_id: string; status: string; note: string }[]>`
        SELECT unit_id, status, note FROM adjudications WHERE round_id = ${roundId}
      `,
    ]);

    const codeById = new Map(codes.map((c) => [c.id, c]));
    const doneBy = new Map<string, Set<string>>();
    for (const p of progress) {
      if (p.status !== "done") continue;
      const s = doneBy.get(p.unit_id) ?? new Set<string>();
      s.add(p.coder_id);
      doneBy.set(p.unit_id, s);
    }

    units = rows.map((u) => {
      const finished = doneBy.get(u.id) ?? new Set();
      const adj = adjudications.find((a) => a.unit_id === u.id);
      return {
        id: u.id,
        external_id: u.external_id,
        text: u.text,
        context: u.context ?? [],
        contested: [...(contestedByUnit.get(u.id) ?? [])],
        resolved: adj?.status === "resolved",
        resolvedNote: adj?.note ?? "",
        agreed: agreed
          .filter((a) => a.unit_id === u.id)
          .map((a) => ({ codeId: a.code_id, start: a.start_offset, end: a.end_offset })),
        // Only coders who actually finished the unit are shown, so an unfinished
        // pane is never mistaken for "applied nothing".
        byCoder: coders
          .filter((c) => finished.has(c.id))
          .map((c) => ({
            coderId: c.id,
            coderName: c.name,
            note: notes.find((n) => n.unit_id === u.id && n.coder_id === c.id)?.note ?? "",
            annotations: detail
              .filter((d) => d.unit_id === u.id && d.coder_id === c.id)
              .map((d) => ({
                codeId: d.code_id,
                codeName: codeById.get(d.code_id)?.name ?? "unknown code",
                color: codeById.get(d.code_id)?.color ?? "#888",
                start: d.start_offset,
                end: d.end_offset,
                quote: d.quote,
              })),
          })),
      };
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`${base}/rounds/${roundId}`} className="text-[13px] muted">
            Round {round.number}
            {round.name && ` · ${round.name}`}
          </Link>
          <span className="faint">/</span>
          <h1 className="text-xl font-semibold tracking-tight">Adjudication</h1>
        </div>
        <p className="muted text-[13px] max-w-2xl">
          Units where coders disagreed about at least one code. Resolving one records an agreed
          coding of record, exported separately from the individual coders&rsquo; work — their
          original coding is never overwritten, so the reliability figures stay honest.
        </p>
      </header>

      <Adjudicator
        roundId={roundId}
        units={units}
        codes={codes.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
      />
    </div>
  );
}
