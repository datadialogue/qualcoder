import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { coderOrUnauthorized } from "@/lib/auth";
import { getStudy } from "@/lib/queries";
import { sanitizeUnit } from "@/lib/starter";
import { upsertUnits } from "@/lib/units-write";

const MAX_BATCH = 5000;

/**
 * Adds one batch of units to a study. The browser parses the starter file and
 * sends it here in pieces; re-sending a batch is harmless because units are
 * matched on their external id and updated in place.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studyId: string }> },
) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;
  if (auth.coder.role !== "lead") {
    return Response.json({ error: "Only a lead can import data." }, { status: 403 });
  }

  const { studyId } = await params;
  const study = await getStudy(studyId);
  if (!study) return Response.json({ error: "Study not found." }, { status: 404 });

  const body = (await request.json()) as { units?: unknown[] };
  if (!Array.isArray(body.units) || body.units.length === 0) {
    return Response.json({ error: "No units in that request." }, { status: 400 });
  }
  if (body.units.length > MAX_BATCH) {
    return Response.json(
      { error: `Send at most ${MAX_BATCH} units per request.` },
      { status: 413 },
    );
  }

  const units = body.units.map(sanitizeUnit);
  const rejected = units.filter((u) => u === null).length;
  const valid = units.filter((u) => u !== null);

  const written = await upsertUnits(sql, studyId, valid);
  revalidatePath("/studies/[studyId]", "layout");
  return Response.json({ ...written, rejected });
}
