import { sql } from "@/lib/db";
import { coderOrUnauthorized } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { computeReliability, type AnnotationRow, type ProgressRow } from "@/lib/reliability";
import { getStudy, getStudyRound } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Kind = "annotations" | "matrix" | "codebook" | "irr" | "adjudicated" | "progress" | "project";

function csvResponse(filename: string, headers: string[], rows: Record<string, unknown>[]) {
  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

const num = (v: number | null) => (v === null ? "" : v.toFixed(4));

/** Filename-safe version of a study name. */
const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "study";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const auth = await coderOrUnauthorized();
  if (auth.response) return auth.response;

  const { kind } = await params;
  const params_ = new URL(request.url).searchParams;
  const study = await getStudy(params_.get("study") ?? "");
  if (!study) {
    return Response.json({ error: "Pass ?study=<id> for the study to export." }, { status: 400 });
  }
  const studyId = study.id;
  const roundId = params_.get("round");
  // Mirrors the analysis page: restrict which coders are compared. Without
  // this, one coder who has not started yet drives every kappa to undefined.
  const coderFilter = params_.get("coders")?.split(",").filter(Boolean) ?? null;
  const scoped = roundId && roundId !== "all" ? roundId : null;
  if (scoped && (await getStudyRound(studyId, scoped)) === null) {
    return Response.json({ error: "That round is not part of this study." }, { status: 404 });
  }
  const prefix = slugify(study.name);
  const suffix = `${prefix}-${scoped ? `round-${scoped.slice(0, 8)}` : "all-rounds"}`;

  switch (kind as Kind) {
    /* ---------------------------------------------------------------- */
    case "annotations": {
      // One row per annotation, joined back to every original CSV column so the
      // export can be analysed without needing this app.
      const rows = await sql<Record<string, unknown>[]>`
        SELECT r.number       AS round_number,
               r.name         AS round_name,
               co.name        AS coder,
               u.external_id  AS unit_id,
               u.text         AS unit_text,
               t.name         AS theme,
               c.name         AS code,
               CASE WHEN a.start_offset IS NULL THEN 'unit' ELSE 'span' END AS scope,
               a.start_offset,
               a.end_offset,
               a.quote,
               a.memo,
               a.created_at,
               u.meta
        FROM annotations a
        JOIN rounds r ON r.id = a.round_id
        JOIN coders co ON co.id = a.coder_id
        JOIN units u ON u.id = a.unit_id
        JOIN codes c ON c.id = a.code_id
        LEFT JOIN themes t ON t.id = c.theme_id
        WHERE r.study_id = ${studyId} AND ${scoped ? sql`a.round_id = ${scoped}` : sql`true`}
        ORDER BY r.number, co.name, u.external_id, a.start_offset NULLS FIRST
      `;
      const metaKeys = [
        ...new Set(rows.flatMap((r) => Object.keys((r.meta as object) ?? {}))),
      ].sort();
      const base = [
        "round_number", "round_name", "coder", "unit_id", "unit_text", "theme", "code",
        "scope", "start_offset", "end_offset", "quote", "memo", "created_at",
      ];
      const flat = rows.map((r) => {
        const meta = (r.meta ?? {}) as Record<string, string>;
        const out: Record<string, unknown> = {};
        for (const k of base) out[k] = r[k];
        for (const k of metaKeys) out[k] = meta[k] ?? "";
        return out;
      });
      return csvResponse(`annotations-${suffix}.csv`, [...base, ...metaKeys], flat);
    }

    /* ---------------------------------------------------------------- */
    case "matrix": {
      // Wide 0/1 matrix: one row per (round, unit, coder), one column per code.
      // Rows only appear for units the coder actually finished, so a 0 means
      // "judged not to apply" rather than "not looked at".
      const [codes, cells] = await Promise.all([
        sql<{ id: string; name: string }[]>`
          SELECT id, name FROM codes WHERE study_id = ${studyId} ORDER BY position, name
        `,
        sql<
          Array<{
            round_number: number;
            coder: string;
            unit_id: string;
            unit_text: string;
            status: string;
            applied: string[];
            meta: Record<string, string>;
          }>
        >`
          SELECT r.number AS round_number,
                 co.name  AS coder,
                 u.external_id AS unit_id,
                 u.text   AS unit_text,
                 up.status,
                 u.meta,
                 COALESCE(array_agg(DISTINCT a.code_id::text)
                          FILTER (WHERE a.code_id IS NOT NULL), '{}') AS applied
          FROM unit_progress up
          JOIN rounds r ON r.id = up.round_id
          JOIN coders co ON co.id = up.coder_id
          JOIN units u ON u.id = up.unit_id
          LEFT JOIN annotations a
                 ON a.round_id = up.round_id AND a.unit_id = up.unit_id
                AND a.coder_id = up.coder_id
          WHERE r.study_id = ${studyId} AND ${scoped ? sql`up.round_id = ${scoped}` : sql`true`}
          GROUP BY r.number, co.name, u.external_id, u.text, up.status, u.meta
          ORDER BY r.number, co.name, u.external_id
        `,
      ]);

      const metaKeys = [
        ...new Set(cells.flatMap((c) => Object.keys(c.meta ?? {}))),
      ].sort();
      const headers = [
        "round_number", "coder", "unit_id", "unit_text", "status",
        ...codes.map((c) => c.name),
        ...metaKeys,
      ];
      const rows = cells.map((c) => {
        const applied = new Set(c.applied);
        const out: Record<string, unknown> = {
          round_number: c.round_number,
          coder: c.coder,
          unit_id: c.unit_id,
          unit_text: c.unit_text,
          status: c.status,
        };
        for (const code of codes) out[code.name] = applied.has(code.id) ? 1 : 0;
        for (const k of metaKeys) out[k] = c.meta?.[k] ?? "";
        return out;
      });
      return csvResponse(`code-matrix-${suffix}.csv`, headers, rows);
    }

    /* ---------------------------------------------------------------- */
    case "codebook": {
      const rows = await sql<Record<string, unknown>[]>`
        SELECT t.name AS theme, c.name AS code, c.definition, c.inclusion, c.exclusion,
               c.example, c.color, c.archived, c.created_at, c.updated_at,
               (SELECT count(*)::int FROM annotations a WHERE a.code_id = c.id) AS times_applied
        FROM codes c LEFT JOIN themes t ON t.id = c.theme_id
        WHERE c.study_id = ${studyId}
        ORDER BY t.position NULLS LAST, c.position
      `;
      return csvResponse(
        `codebook-${prefix}.csv`,
        ["theme", "code", "definition", "inclusion", "exclusion", "example", "color",
         "archived", "times_applied", "created_at", "updated_at"],
        rows,
      );
    }

    /* ---------------------------------------------------------------- */
    case "progress": {
      const rows = await sql<Record<string, unknown>[]>`
        SELECT r.number AS round_number, co.name AS coder, u.external_id AS unit_id,
               up.status, up.flagged, up.note, up.updated_at
        FROM unit_progress up
        JOIN rounds r ON r.id = up.round_id
        JOIN coders co ON co.id = up.coder_id
        JOIN units u ON u.id = up.unit_id
        WHERE r.study_id = ${studyId} AND ${scoped ? sql`up.round_id = ${scoped}` : sql`true`}
        ORDER BY r.number, co.name, u.external_id
      `;
      return csvResponse(
        `progress-${suffix}.csv`,
        ["round_number", "coder", "unit_id", "status", "flagged", "note", "updated_at"],
        rows,
      );
    }

    /* ---------------------------------------------------------------- */
    case "irr": {
      const rounds = await sql<{ id: string; number: number; name: string }[]>`
        SELECT id, number, name FROM rounds
        WHERE study_id = ${studyId} AND ${scoped ? sql`id = ${scoped}` : sql`true`}
        ORDER BY number
      `;
      const out: Record<string, unknown>[] = [];

      for (const round of rounds) {
        const [allCoders, codes, annotations, progress] = await Promise.all([
          sql<{ id: string; name: string }[]>`
            SELECT c.id, c.name FROM assignments a JOIN coders c ON c.id = a.coder_id
            WHERE a.round_id = ${round.id} ORDER BY c.name
          `,
          sql<{ id: string; name: string; theme_name: string | null }[]>`
            SELECT c.id, c.name, t.name AS theme_name
            FROM codes c LEFT JOIN themes t ON t.id = c.theme_id
            WHERE c.study_id = ${studyId} ORDER BY c.position
          `,
          sql<AnnotationRow[]>`
            SELECT unit_id, coder_id, code_id, start_offset, end_offset
            FROM annotations WHERE round_id = ${round.id}
          `,
          sql<ProgressRow[]>`
            SELECT unit_id, coder_id, status FROM unit_progress WHERE round_id = ${round.id}
          `,
        ]);

        const coders = coderFilter
          ? allCoders.filter((c) => coderFilter.includes(c.id))
          : allCoders;
        if (coders.length === 0) continue;

        const report = computeReliability({ coders, codes, annotations, progress });
        for (const c of report.perCode) {
          out.push({
            round_number: round.number,
            round_name: round.name,
            n_coders: coders.length,
            coders: coders.map((c) => c.name).join("; "),
            theme: c.themeName ?? "",
            code: c.codeName,
            n_units_all_done: c.nUnits,
            n_units_pairable: c.nPairable,
            times_applied: Object.values(c.appliedCount).reduce((a, b) => a + b, 0),
            percent_agreement: num(c.percentAgreement.value),
            cohens_kappa: num(c.cohensKappa.value),
            fleiss_kappa: num(c.fleissKappa.value),
            krippendorff_alpha: num(c.alpha.value),
            undefined_reason:
              c.alpha.value === null ? (c.alpha.reason ?? "") : "",
            span_mean_iou: num(c.span.meanIoU),
            span_f1_lenient: num(c.span.lenientF1),
            span_f1_strict: num(c.span.strictF1),
            span_pairs_compared: c.span.nUnitsCompared,
            unit_level_annotations: c.span.nUnitLevel,
          });
        }
      }
      return csvResponse(
        `reliability-${suffix}.csv`,
        ["round_number", "round_name", "n_coders", "coders", "theme", "code", "n_units_all_done",
         "n_units_pairable", "times_applied", "percent_agreement", "cohens_kappa",
         "fleiss_kappa", "krippendorff_alpha", "undefined_reason", "span_mean_iou",
         "span_f1_lenient", "span_f1_strict", "span_pairs_compared",
         "unit_level_annotations"],
        out,
      );
    }

    /* ---------------------------------------------------------------- */
    case "adjudicated": {
      const rows = await sql<Record<string, unknown>[]>`
        SELECT r.number AS round_number, u.external_id AS unit_id, u.text AS unit_text,
               t.name AS theme, c.name AS code,
               CASE WHEN aa.start_offset IS NULL THEN 'unit' ELSE 'span' END AS scope,
               aa.start_offset, aa.end_offset, aa.quote,
               adj.status AS adjudication_status, adj.note, res.name AS resolved_by,
               adj.updated_at
        FROM adjudicated_annotations aa
        JOIN rounds r ON r.id = aa.round_id
        JOIN units u ON u.id = aa.unit_id
        JOIN codes c ON c.id = aa.code_id
        LEFT JOIN themes t ON t.id = c.theme_id
        LEFT JOIN adjudications adj
               ON adj.round_id = aa.round_id AND adj.unit_id = aa.unit_id
        LEFT JOIN coders res ON res.id = adj.resolved_by
        WHERE r.study_id = ${studyId} AND ${scoped ? sql`aa.round_id = ${scoped}` : sql`true`}
        ORDER BY r.number, u.external_id, aa.start_offset NULLS FIRST
      `;
      return csvResponse(
        `adjudicated-${suffix}.csv`,
        ["round_number", "unit_id", "unit_text", "theme", "code", "scope", "start_offset",
         "end_offset", "quote", "adjudication_status", "note", "resolved_by", "updated_at"],
        rows,
      );
    }

    /* ---------------------------------------------------------------- */
    case "project": {
      // Complete archival dump of this study, enough to reproduce every table.
      const inStudy = sql`round_id IN (SELECT id FROM rounds WHERE study_id = ${studyId})`;
      const [units, themes, codes, coders, rounds, roundUnits, assignments,
             unitAssignments, annotations, progress, adjudications, adjudicated] =
        await Promise.all([
          sql`SELECT id, external_id, text, meta, context FROM units
              WHERE study_id = ${studyId} ORDER BY external_id`,
          sql`SELECT * FROM themes WHERE study_id = ${studyId} ORDER BY position`,
          sql`SELECT * FROM codes WHERE study_id = ${studyId} ORDER BY position`,
          sql`SELECT id, name, email, role, active, created_at FROM coders
              WHERE id IN (SELECT coder_id FROM assignments WHERE ${inStudy})
                 OR id IN (SELECT created_by FROM codes WHERE study_id = ${studyId})
              ORDER BY name`,
          sql`SELECT * FROM rounds WHERE study_id = ${studyId} ORDER BY number`,
          sql`SELECT * FROM round_units WHERE ${inStudy} ORDER BY round_id, position`,
          sql`SELECT * FROM assignments WHERE ${inStudy}`,
          sql`SELECT * FROM unit_assignments WHERE ${inStudy}`,
          sql`SELECT * FROM annotations WHERE ${inStudy} ORDER BY created_at`,
          sql`SELECT * FROM unit_progress WHERE ${inStudy}`,
          sql`SELECT * FROM adjudications WHERE ${inStudy}`,
          sql`SELECT * FROM adjudicated_annotations WHERE ${inStudy}`,
        ]);

      const body = JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          study,
          note:
            "Complete study dump. Invite tokens are deliberately omitted. " +
            "unit_progress is required to interpret annotations: a unit absent " +
            "from it was never finished by that coder, and is missing data " +
            "rather than an absence of codes.",
          units, themes, codes, coders, rounds,
          round_units: roundUnits,
          assignments,
          unit_assignments: unitAssignments,
          annotations,
          unit_progress: progress,
          adjudications,
          adjudicated_annotations: adjudicated,
        },
        null,
        2,
      );
      return new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="study-${prefix}.json"`,
        },
      });
    }

    default:
      return Response.json({ error: `Unknown export "${kind}".` }, { status: 404 });
  }
}
