import { notFound } from "next/navigation";
import { currentCoder } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getCodebook, getRound, getStudy } from "@/lib/queries";
import { SignedOut } from "@/components/SignedOut";
import {
  CodingWorkspace,
  type WorkAnnotation,
  type WorkProgress,
  type WorkUnit,
} from "@/components/CodingWorkspace";

export const dynamic = "force-dynamic";

export default async function CodePage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const coder = await currentCoder();
  if (!coder) return <SignedOut />;

  const round = await getRound(roundId);
  if (!round) notFound();
  const study = await getStudy(round.study_id);
  if (!study) notFound();

  const [units, codebook, annotations, progress] = await Promise.all([
    // Only the units assigned to this coder, in the round's stored order --
    // the same order every coder sees.
    sql<WorkUnit[]>`
      SELECT u.id, u.external_id, u.text, u.meta, u.context, ru.position
      FROM unit_assignments ua
      JOIN round_units ru ON ru.round_id = ua.round_id AND ru.unit_id = ua.unit_id
      JOIN units u ON u.id = ua.unit_id
      WHERE ua.round_id = ${roundId} AND ua.coder_id = ${coder.id}
      ORDER BY ru.position
    `,
    getCodebook(study.id),
    sql<WorkAnnotation[]>`
      SELECT id, unit_id, code_id, start_offset, end_offset, quote
      FROM annotations
      WHERE round_id = ${roundId} AND coder_id = ${coder.id}
    `,
    sql<WorkProgress[]>`
      SELECT unit_id, status, flagged, note
      FROM unit_progress
      WHERE round_id = ${roundId} AND coder_id = ${coder.id}
    `,
  ]);

  // Positions are round-wide; renumber so a partially-assigned coder sees 1..n.
  const renumbered = units.map((u, i) => ({ ...u, position: i }));
  // The study chooses which metadata appears above each unit; free-text and
  // high-cardinality columns are noise there.
  const displayKeys = study.settings.displayKeys ?? [];
  const presentKeys = displayKeys.filter((k) => renumbered.some((u) => u.meta?.[k]));
  const linkKey = study.settings.linkKey;

  return (
    <CodingWorkspace
      round={{ id: round.id, number: round.number, name: round.name, status: round.status }}
      study={{ id: study.id, name: study.name }}
      coderName={coder.name}
      units={renumbered}
      codebook={codebook.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        codes: t.codes.map((c) => ({
          id: c.id,
          name: c.name,
          color: c.color,
          definition: c.definition,
          inclusion: c.inclusion,
          exclusion: c.exclusion,
          example: c.example,
        })),
      }))}
      initialAnnotations={annotations}
      initialProgress={progress}
      metaKeys={presentKeys}
      linkKey={linkKey && renumbered.some((u) => u.meta?.[linkKey]) ? linkKey : null}
    />
  );
}
