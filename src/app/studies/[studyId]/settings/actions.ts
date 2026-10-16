"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { json, sql } from "@/lib/db";
import { leadGuard } from "@/lib/auth";
import { getStudy } from "@/lib/queries";
import type { ActionResult } from "@/lib/action-result";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function updateStudy(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const name = str(fd, "name");
  if (!name) return { error: "A study needs a name." };
  await sql`
    UPDATE studies SET name = ${name}, description = ${str(fd, "description")}
    WHERE id = ${str(fd, "study_id")}
  `;
  revalidatePath("/");
  revalidatePath("/studies/[studyId]", "layout");
  return { ok: "Saved." };
}

/** Which metadata coders see above each unit, and which field links to the original. */
export async function updateDisplay(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const study = await getStudy(str(fd, "study_id"));
  if (!study) return { error: "Study not found." };
  const settings = {
    ...study.settings,
    displayKeys: fd.getAll("display_keys").map(String).filter(Boolean),
    linkKey: str(fd, "link_key") || undefined,
  };
  await sql`UPDATE studies SET settings = ${json(settings)} WHERE id = ${study.id}`;
  revalidatePath("/studies/[studyId]", "layout");
  return { ok: "Saved. Coders see the change next time they open the round." };
}

export async function setStudyStatus(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const status = str(fd, "status") === "archived" ? "archived" : "active";
  await sql`UPDATE studies SET status = ${status} WHERE id = ${str(fd, "study_id")}`;
  revalidatePath("/");
  revalidatePath("/studies/[studyId]", "layout");
  return {
    ok:
      status === "archived"
        ? "Archived. It is hidden from coders' work lists; everything is kept."
        : "Restored.",
  };
}

/** Deletes the study and, by cascade, every unit, code, round and annotation in it. */
export async function deleteStudy(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const denied = await leadGuard();
  if (denied) return denied;
  const study = await getStudy(str(fd, "study_id"));
  if (!study) return { error: "Study not found." };
  if (str(fd, "confirm") !== study.name) {
    return { error: `Type the study's name, "${study.name}", to confirm.` };
  }
  await sql`DELETE FROM studies WHERE id = ${study.id}`;
  revalidatePath("/");
  redirect("/");
}
