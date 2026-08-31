/**
 * Loads the starting codebook derived from section 6.1 of the paper.
 *   npm run seed:codebook
 *   npm run seed:codebook -- --skip-observations   (omit the reflection theme)
 *
 * Safe to re-run: themes and codes are matched by name and updated in place,
 * so existing annotations keep pointing at the same codes.
 */
import "./load-env.ts";
import { PAPER_CODEBOOK } from "./paper-codebook.ts";

const { sql } = await import("../src/lib/db.ts");

const skipObservations = process.argv.includes("--skip-observations");
const themes = PAPER_CODEBOOK.filter((t) => !(skipObservations && t.fromObservations));

let themeCount = 0;
let codeCount = 0;

await sql.begin(async (tx) => {
  let themePos = 0;
  let codePos = 0;
  for (const theme of themes) {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO themes (name, description, color, position)
      VALUES (${theme.name}, ${theme.description}, ${theme.color}, ${themePos})
      ON CONFLICT (name) DO UPDATE
        SET description = EXCLUDED.description,
            color = EXCLUDED.color,
            position = EXCLUDED.position
      RETURNING id
    `;
    themePos++;
    themeCount++;

    for (const code of theme.codes) {
      await tx`
        INSERT INTO codes (theme_id, name, definition, inclusion, exclusion, example,
                           color, position, provisional)
        VALUES (${row.id}, ${code.name}, ${code.definition}, ${code.inclusion ?? ""},
                ${code.exclusion ?? ""}, ${code.example ?? ""}, ${code.color}, ${codePos}, false)
        ON CONFLICT (name) DO UPDATE
          SET theme_id = EXCLUDED.theme_id,
              definition = EXCLUDED.definition,
              inclusion = EXCLUDED.inclusion,
              exclusion = EXCLUDED.exclusion,
              example = EXCLUDED.example,
              color = EXCLUDED.color,
              position = EXCLUDED.position,
              updated_at = now()
      `;
      codePos++;
      codeCount++;
    }
  }
});

console.log(`Seeded ${codeCount} codes across ${themeCount} themes.`);
if (!skipObservations) {
  console.log(
    "Includes the 'Reflection on the decision' theme, taken from the observations\n" +
      "paragraph rather than the paper's formal codebook. Delete it on /codebook if\n" +
      "you do not want it, or re-run with --skip-observations.",
  );
}
await sql.end();
