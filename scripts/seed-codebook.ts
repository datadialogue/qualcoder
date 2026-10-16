/**
 * Loads the codebook from section 6.1 of the paper behind the original
 * account-suspension study into a study.
 *   npm run seed:codebook -- --study="Account suspension"
 *   npm run seed:codebook -- --study=<id> --skip-observations   (omit the reflection theme)
 *
 * New studies normally bring their own codebook in the starter file; this is
 * kept so the original study can be rebuilt from scratch.
 *
 * Safe to re-run: themes and codes are matched by name and updated in place,
 * so existing annotations keep pointing at the same codes.
 */
import "./load-env.ts";
import { PAPER_CODEBOOK } from "./paper-codebook.ts";
import { argValue, requireStudy } from "./study-arg.ts";

const { sql } = await import("../src/lib/db.ts");
const { writeCodebook } = await import("../src/lib/codebook-write.ts");

const study = await requireStudy(sql, argValue("study"));
const skipObservations = process.argv.includes("--skip-observations");
const themes = PAPER_CODEBOOK.filter((t) => !(skipObservations && t.fromObservations));

const result = await sql.begin((tx) => writeCodebook(tx, study.id, themes));

console.log(
  `"${study.name}": ${result.codesAdded} code(s) added, ${result.codesUpdated} updated, ` +
    `${result.themesAdded} new theme(s).`,
);
if (!skipObservations) {
  console.log(
    "Includes the 'Reflection on the decision' theme, taken from the observations\n" +
      "paragraph rather than the paper's formal codebook. Delete it on the codebook page\n" +
      "if you do not want it, or re-run with --skip-observations.",
  );
}
await sql.end();
