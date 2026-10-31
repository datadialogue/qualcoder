"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { currentCoder, leadGuard } from "@/lib/auth";
import { MergeError, applyIfAgreed, approveAsLead, canTakePart, pickSurvivor } from "@/lib/merges";
import type { ActionResult } from "@/lib/action-result";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function refresh(studyId: string) {
  revalidatePath(`/studies/${studyId}/codebook`, "layout");
}

/** The signed-in coder, if they may take part in this study's merges. */
async function participant(studyId: string) {
  const coder = await currentCoder();
  if (!coder) return { error: "Not signed in. Open your invite link to continue." } as const;
  if (!(await canTakePart(coder, studyId))) {
    return { error: "Only coders who have worked on this study can propose or vote on merges." } as const;
  }
  return { coder } as const;
}

/** Runs a merge once the last agreement is in, turning a MergeError into a message. */
async function settle(mergeId: string): Promise<ActionResult> {
  try {
    const done = await applyIfAgreed(mergeId);
    return done ? { ok: done } : null;
  } catch (e) {
    if (e instanceof MergeError) return { error: e.message };
    throw e;
  }
}

export async function proposeMerge(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const studyId = str(fd, "study_id");
  const who = await participant(studyId);
  if ("error" in who) return { error: who.error };

  const ids = [...new Set(fd.getAll("code_id").map(String).filter(Boolean))];
  if (ids.length < 2) return { error: "Tick at least two codes to merge." };

  const codes = await sql<
    Array<{ id: string; name: string; position: number; merged_into: string | null; uses: number }>
  >`
    SELECT c.id, c.name, c.position, c.merged_into,
           (SELECT count(*)::int FROM annotations a WHERE a.code_id = c.id) AS uses
    FROM codes c
    WHERE c.study_id = ${studyId} AND c.id = ANY(${ids}::uuid[])
  `;
  if (codes.length !== ids.length) return { error: "Some of those codes are not in this study." };
  if (codes.some((c) => c.merged_into)) {
    return { error: "One of those codes has already been merged. Refresh the page." };
  }

  const survivor = pickSurvivor(codes, str(fd, "new_name"));
  const newName = str(fd, "new_name") || codes.find((c) => c.id === survivor)!.name;
  if (newName.length > 120) return { error: "That name is too long (120 characters max)." };
  const clash = await sql<{ name: string }[]>`
    SELECT name FROM codes
    WHERE study_id = ${studyId} AND lower(name) = lower(${newName}) AND NOT (id = ANY(${ids}::uuid[]))
  `;
  if (clash.length > 0) {
    return { error: `"${clash[0].name}" is already a different code. Pick another name, or include it in the merge.` };
  }

  const mergeId = await sql.begin(async (tx) => {
    const [{ id }] = await tx<{ id: string }[]>`
      INSERT INTO code_merges (study_id, target_code_id, new_name, new_definition, rationale, proposed_by)
      VALUES (${studyId}, ${survivor}, ${newName}, ${str(fd, "new_definition")},
              ${str(fd, "rationale")}, ${who.coder.id})
      RETURNING id
    `;
    await tx`
      INSERT INTO code_merge_codes ${tx(ids.map((code_id) => ({ merge_id: id, code_id })), "merge_id", "code_id")}
    `;
    // Proposing is agreeing.
    await tx`
      INSERT INTO code_merge_votes (merge_id, coder_id, vote) VALUES (${id}, ${who.coder.id}, 'agree')
    `;
    return id;
  });

  // A one-person team needs nobody else's agreement.
  const settled = await settle(mergeId);
  refresh(studyId);
  return settled ?? { ok: "Proposed. It will be applied once everyone on the study has agreed." };
}

export async function voteMerge(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const studyId = str(fd, "study_id");
  const who = await participant(studyId);
  if ("error" in who) return { error: who.error };
  const mergeId = str(fd, "merge_id");
  const vote = str(fd, "vote") === "disagree" ? "disagree" : "agree";

  const rows = await sql<{ id: string }[]>`
    SELECT id FROM code_merges
    WHERE id = ${mergeId} AND study_id = ${studyId} AND status = 'proposed'
  `;
  if (rows.length === 0) return { error: "That proposal is no longer open." };

  await sql`
    INSERT INTO code_merge_votes (merge_id, coder_id, vote, comment)
    VALUES (${mergeId}, ${who.coder.id}, ${vote}, ${str(fd, "comment")})
    ON CONFLICT (merge_id, coder_id) DO UPDATE SET
      vote = EXCLUDED.vote,
      comment = CASE WHEN EXCLUDED.comment = '' THEN code_merge_votes.comment ELSE EXCLUDED.comment END,
      updated_at = now()
  `;
  const settled = vote === "agree" ? await settle(mergeId) : null;
  refresh(studyId);
  return settled ?? { ok: vote === "agree" ? "You agreed." : "You disagreed; the merge is on hold." };
}

/** Applies a proposal everyone has agreed to, e.g. after the team changed size. */
export async function applyMergeNow(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const studyId = str(fd, "study_id");
  const who = await participant(studyId);
  if ("error" in who) return { error: who.error };
  const settled = await settle(str(fd, "merge_id"));
  refresh(studyId);
  return settled ?? { error: "Not everyone has agreed yet." };
}

/** A lead settles the question without waiting for every vote. */
export async function approveMerge(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const lead = (await currentCoder())!;
  const studyId = str(fd, "study_id");
  const mergeId = str(fd, "merge_id");
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM code_merges WHERE id = ${mergeId} AND study_id = ${studyId}
  `;
  if (rows.length === 0) return { error: "That proposal is not part of this study." };
  try {
    const done = await approveAsLead(mergeId, lead.id);
    refresh(studyId);
    return { ok: done };
  } catch (e) {
    if (e instanceof MergeError) return { error: e.message };
    throw e;
  }
}

export async function withdrawMerge(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const studyId = str(fd, "study_id");
  const who = await participant(studyId);
  if ("error" in who) return { error: who.error };
  const rows = await sql<{ id: string }[]>`
    UPDATE code_merges SET status = 'withdrawn'
    WHERE id = ${str(fd, "merge_id")} AND study_id = ${studyId} AND status = 'proposed'
      AND (proposed_by = ${who.coder.id} OR ${who.coder.role === "lead"})
    RETURNING id
  `;
  refresh(studyId);
  return rows.length > 0 ? null : { error: "Only the person who proposed it (or a lead) can withdraw it." };
}
