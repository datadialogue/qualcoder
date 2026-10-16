/**
 * Merges themes and codes into a study's codebook. Used by study creation, the
 * codebook page's paste box and the seed script, so they all agree on how an
 * existing code is treated.
 *
 * Themes and codes are matched by name within the study. A new one is added;
 * an existing one keeps its id -- so annotations stay attached -- and takes any
 * non-empty field from the input. Nothing is deleted.
 */
import type postgres from "postgres";
import type { CodebookThemeInput } from "./codebook-parse";
import { pickColor } from "./palette";

export interface CodebookWriteResult {
  themesAdded: number;
  codesAdded: number;
  codesUpdated: number;
}

export async function writeCodebook(
  tx: postgres.TransactionSql,
  studyId: string,
  themes: CodebookThemeInput[],
): Promise<CodebookWriteResult> {
  const result: CodebookWriteResult = { themesAdded: 0, codesAdded: 0, codesUpdated: 0 };
  let [{ themeCount, codeCount }] = await tx<{ themeCount: number; codeCount: number }[]>`
    SELECT (SELECT count(*)::int FROM themes WHERE study_id = ${studyId}) AS "themeCount",
           (SELECT count(*)::int FROM codes  WHERE study_id = ${studyId}) AS "codeCount"
  `;

  for (const theme of themes) {
    let themeId: string | null = null;
    const themeName = theme.name.trim();
    if (themeName) {
      const [row] = await tx<{ id: string; inserted: boolean }[]>`
        INSERT INTO themes (study_id, name, description, color, position)
        VALUES (${studyId}, ${themeName}, ${theme.description ?? ""},
                ${theme.color || pickColor(themeCount)}, ${themeCount})
        ON CONFLICT (study_id, name) DO UPDATE SET
          description = CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description
                             ELSE themes.description END
        RETURNING id, (xmax = 0) AS inserted
      `;
      themeId = row.id;
      if (row.inserted) {
        result.themesAdded++;
        themeCount++;
      }
    }

    for (const code of theme.codes) {
      const name = code.name.trim();
      if (!name) continue;
      const [row] = await tx<{ inserted: boolean }[]>`
        INSERT INTO codes (study_id, theme_id, name, definition, inclusion, exclusion, example,
                           color, position, provisional)
        VALUES (${studyId}, ${themeId}, ${name}, ${code.definition ?? ""},
                ${code.inclusion ?? ""}, ${code.exclusion ?? ""}, ${code.example ?? ""},
                ${code.color || pickColor(codeCount)}, ${codeCount}, false)
        ON CONFLICT (study_id, name) DO UPDATE SET
          theme_id   = COALESCE(EXCLUDED.theme_id, codes.theme_id),
          definition = CASE WHEN EXCLUDED.definition <> '' THEN EXCLUDED.definition ELSE codes.definition END,
          inclusion  = CASE WHEN EXCLUDED.inclusion  <> '' THEN EXCLUDED.inclusion  ELSE codes.inclusion  END,
          exclusion  = CASE WHEN EXCLUDED.exclusion  <> '' THEN EXCLUDED.exclusion  ELSE codes.exclusion  END,
          example    = CASE WHEN EXCLUDED.example    <> '' THEN EXCLUDED.example    ELSE codes.example    END,
          updated_at = now()
        RETURNING (xmax = 0) AS inserted
      `;
      if (row.inserted) {
        result.codesAdded++;
        codeCount++;
      } else {
        result.codesUpdated++;
      }
    }
  }
  return result;
}
