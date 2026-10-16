"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { json, sql } from "@/lib/db";
import { leadGuard } from "@/lib/auth";
import { assignUnits, drawSample, type SampleInput, type SamplingConfig } from "@/lib/sampling";
import type { ActionResult } from "@/lib/action-result";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string, fallback: number) => {
  // A field the form did not render is absent, and Number(null) is 0 -- which
  // would silently look like a deliberate zero rather than "not specified".
  const raw = fd.get(k);
  if (raw === null || String(raw).trim() === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
};

async function studyOfRound(roundId: string): Promise<string | null> {
  const rows = await sql<{ study_id: string }[]>`SELECT study_id FROM rounds WHERE id = ${roundId}`;
  return rows[0]?.study_id ?? null;
}

/**
 * Draws the sample once and stores it. Everything downstream reads
 * `round_units`, which is what makes the set identical for every coder.
 */
export async function createRound(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;

  const studyId = str(fd, "study_id");
  const study = await sql<{ id: string }[]>`SELECT id FROM studies WHERE id = ${studyId}`;
  if (study.length === 0) return { error: "That study no longer exists." };

  const coderIds = fd.getAll("coder_ids").map(String).filter(Boolean);
  if (coderIds.length === 0) {
    return { error: "Assign at least one coder. Reliability needs at least two." };
  }

  const reuseRoundId = str(fd, "reuse_round_id");
  const mode = (str(fd, "mode") || "stratified") as SamplingConfig["mode"];
  const strata = fd.getAll("strata").map(String).filter(Boolean);
  const size = Math.max(1, Math.round(num(fd, "size", 60)));
  const seed = str(fd, "seed") || randomBytes(6).toString("hex");
  const overlapMode = str(fd, "overlap_mode") === "subset" ? "subset" : "full";
  const overlapFraction = Math.min(1, Math.max(0, num(fd, "overlap_fraction", 0.2)));
  const excludePriorRounds = fd.get("exclude_prior") === "on";

  // Filters arrive as `filter:<key>` multi-selects.
  const filters: Record<string, string[]> = {};
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("filter:")) continue;
    const metaKey = key.slice("filter:".length);
    const v = String(value);
    if (v) (filters[metaKey] ??= []).push(v);
  }

  const config: SamplingConfig = {
    mode,
    size,
    strata,
    filters,
    excludePriorRounds,
    overlapFraction,
    reuseRoundId: reuseRoundId || null,
  };

  let unitIds: string[];

  if (reuseRoundId) {
    const rows = await sql<{ unit_id: string }[]>`
      SELECT ru.unit_id FROM round_units ru JOIN rounds r ON r.id = ru.round_id
      WHERE ru.round_id = ${reuseRoundId} AND r.study_id = ${studyId}
      ORDER BY ru.position
    `;
    if (rows.length === 0) return { error: "That round has no sample to reuse." };
    unitIds = rows.map((r) => r.unit_id);
  } else {
    const units = await sql<SampleInput[]>`SELECT id, meta FROM units WHERE study_id = ${studyId}`;
    if (units.length === 0) {
      return { error: "This study has no units yet. Import data on its settings page first." };
    }
    const prior = excludePriorRounds
      ? new Set(
          (
            await sql<{ unit_id: string }[]>`
              SELECT DISTINCT ru.unit_id FROM round_units ru JOIN rounds r ON r.id = ru.round_id
              WHERE r.study_id = ${studyId}
            `
          ).map((r) => r.unit_id),
        )
      : new Set<string>();

    unitIds = drawSample(units, config, seed, prior);
    if (unitIds.length === 0) {
      return {
        error:
          "The sampling settings matched no units. Loosen the filters, or turn off " +
          "'exclude units used in earlier rounds'.",
      };
    }
    if (unitIds.length < size) {
      // Not an error: report it on the round page instead of silently shrinking.
      config.size = unitIds.length;
    }
  }

  const assignmentPairs = assignUnits(unitIds, coderIds, overlapMode, seed, overlapFraction);

  let roundId = "";
  await sql.begin(async (tx) => {
    const [{ next }] = await tx<{ next: number }[]>`
      SELECT COALESCE(max(number), 0) + 1 AS next FROM rounds WHERE study_id = ${studyId}
    `;
    const [round] = await tx<{ id: string }[]>`
      INSERT INTO rounds (study_id, number, name, status, sampling, seed, overlap_mode, opened_at)
      VALUES (${studyId}, ${next}, ${str(fd, "name")}, 'open', ${json(config)}, ${seed},
              ${overlapMode}, now())
      RETURNING id
    `;
    roundId = round.id;

    await tx`
      INSERT INTO round_units ${tx(
        unitIds.map((id, i) => ({ round_id: roundId, unit_id: id, position: i })),
        "round_id",
        "unit_id",
        "position",
      )}
    `;
    await tx`
      INSERT INTO assignments ${tx(
        coderIds.map((id) => ({ round_id: roundId, coder_id: id })),
        "round_id",
        "coder_id",
      )}
    `;
    for (let i = 0; i < assignmentPairs.length; i += 1000) {
      const batch = assignmentPairs.slice(i, i + 1000);
      await tx`
        INSERT INTO unit_assignments ${tx(
          batch.map((p) => ({ round_id: roundId, unit_id: p.unitId, coder_id: p.coderId })),
          "round_id",
          "unit_id",
          "coder_id",
        )}
      `;
    }
  });

  revalidatePath("/");
  revalidatePath("/studies/[studyId]", "layout");
  redirect(`/studies/${studyId}/rounds/${roundId}`);
}

export async function setRoundStatus(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const id = str(fd, "id");
  const status = str(fd, "status");
  if (!["draft", "open", "closed"].includes(status)) return { error: "Unknown status." };
  const studyId = await studyOfRound(id);
  if (!studyId) return { error: "Round not found." };

  if (status === "closed") {
    // Freeze the codebook as it stood, so a closed round stays interpretable
    // even after codes are renamed or retired.
    const snapshot = await sql`
      SELECT c.id, c.name, c.definition, c.inclusion, c.exclusion, c.example, c.color,
             c.archived, t.name AS theme_name
      FROM codes c LEFT JOIN themes t ON t.id = c.theme_id
      WHERE c.study_id = ${studyId}
      ORDER BY t.position NULLS LAST, c.position
    `;
    await sql`
      UPDATE rounds
      SET status = 'closed', closed_at = now(), codebook_snapshot = ${json(snapshot)}
      WHERE id = ${id}
    `;
  } else {
    await sql`
      UPDATE rounds
      SET status = ${status}, opened_at = COALESCE(opened_at, now())
      WHERE id = ${id}
    `;
  }
  revalidatePath("/studies/[studyId]", "layout");
  return { ok: `Round marked ${status}.` };
}

export async function renameRound(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const id = str(fd, "id");
  const studyId = await studyOfRound(id);
  if (!studyId) return { error: "Round not found." };
  await sql`UPDATE rounds SET name = ${str(fd, "name")} WHERE id = ${id}`;
  revalidatePath("/studies/[studyId]", "layout");
  return { ok: "Renamed." };
}

/** Adds coders to a round already in progress, without disturbing existing work. */
export async function addCoders(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const roundId = str(fd, "id");
  const coderIds = fd.getAll("coder_ids").map(String).filter(Boolean);
  if (coderIds.length === 0) return { error: "Pick at least one coder to add." };

  const round = (await sql<{ overlap_mode: string; seed: string; study_id: string }[]>`
    SELECT overlap_mode, seed, study_id FROM rounds WHERE id = ${roundId}
  `)[0];
  if (!round) return { error: "Round not found." };
  if (round.overlap_mode !== "full") {
    return {
      error:
        "This round uses a partial-overlap design, so coders cannot be added afterwards " +
        "without changing who was assigned what. Create a new round instead.",
    };
  }

  const units = await sql<{ unit_id: string }[]>`
    SELECT unit_id FROM round_units WHERE round_id = ${roundId}
  `;

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO assignments ${tx(
        coderIds.map((id) => ({ round_id: roundId, coder_id: id })),
        "round_id",
        "coder_id",
      )}
      ON CONFLICT DO NOTHING
    `;
    const pairs = coderIds.flatMap((coderId) =>
      units.map((u) => ({ round_id: roundId, unit_id: u.unit_id, coder_id: coderId })),
    );
    for (let i = 0; i < pairs.length; i += 1000) {
      await tx`
        INSERT INTO unit_assignments ${tx(
          pairs.slice(i, i + 1000),
          "round_id",
          "unit_id",
          "coder_id",
        )}
        ON CONFLICT DO NOTHING
      `;
    }
  });

  revalidatePath("/studies/[studyId]", "layout");
  return { ok: `Added ${coderIds.length} coder(s).` };
}

export async function deleteRound(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const id = str(fd, "id");
  const studyId = await studyOfRound(id);
  if (!studyId) return { error: "Round not found." };
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM annotations WHERE round_id = ${id}
  `;
  if (n > 0 && str(fd, "confirm") !== "delete") {
    return { error: `This round holds ${n} annotation(s). Type "delete" to confirm.` };
  }
  await sql`DELETE FROM rounds WHERE id = ${id}`;
  revalidatePath("/studies/[studyId]", "layout");
  redirect(`/studies/${studyId}/rounds`);
}
