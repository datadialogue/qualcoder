import { revalidatePath } from "next/cache";
import { json, sql } from "@/lib/db";
import { coderOrUnauthorized } from "@/lib/auth";
import { normalizeCodebookJson } from "@/lib/codebook-parse";
import { writeCodebook } from "@/lib/codebook-write";
import type { StudySettings } from "@/lib/types";

/**
 * Creates a study and its starting codebook. The data itself follows in
 * batches to /api/studies/<id>/units, because a large starter file would not
 * fit in one request.
 */
export async function POST(request: Request) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;
  if (auth.coder.role !== "lead") {
    return Response.json({ error: "Only a lead can start a study." }, { status: 403 });
  }

  const body = (await request.json()) as {
    name?: string;
    description?: string;
    source?: string;
    settings?: StudySettings;
    codebook?: unknown;
  };
  const name = (body.name ?? "").trim();
  if (!name) return Response.json({ error: "Give the study a name." }, { status: 400 });
  if (name.length > 200) {
    return Response.json({ error: "That name is too long (200 characters max)." }, { status: 400 });
  }

  const settings: StudySettings = {
    displayKeys: Array.isArray(body.settings?.displayKeys)
      ? body.settings.displayKeys.filter((k) => typeof k === "string")
      : [],
    linkKey: typeof body.settings?.linkKey === "string" ? body.settings.linkKey : undefined,
    mapping: body.settings?.mapping,
  };
  const source = /^[a-z-]{1,20}$/.test(body.source ?? "") ? body.source! : "csv";
  const codebook = normalizeCodebookJson(body.codebook ?? []);

  const result = await sql.begin(async (tx) => {
    const [study] = await tx<{ id: string }[]>`
      INSERT INTO studies (name, description, source, settings, created_by)
      VALUES (${name}, ${(body.description ?? "").trim()}, ${source}, ${json(settings)},
              ${auth.coder.id})
      RETURNING id
    `;
    const written = await writeCodebook(tx, study.id, codebook);
    return { id: study.id, ...written };
  });

  revalidatePath("/");
  return Response.json(result);
}
