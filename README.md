# Qualitative Coding

A small web app for coding text data with a shared codebook, measuring inter-rater
reliability, and iterating on the codebook across rounds. Built to be deployed on Vercel with
Neon Postgres.

Set up for `Qual Analysis - accounts_tidy.csv` — 1450 participant justifications for suspending
or not suspending an account — but nothing is hardcoded to that data.

## What it does

- **Shared sampling.** A round draws its sample once, from a seeded PRNG, and stores it. Every
  coder then reads the same table, so they see an identical set in an identical order. The seed
  and the sampling config are kept on the round, so the draw is reproducible and reportable.
  Simple random, stratified (proportional allocation with largest-remainder rounding), or the
  whole corpus; optionally excluding units used in earlier rounds.
- **Span-level coding.** Select text in a comment and attach a code to it, or apply a code to
  the whole comment with nothing selected. Overlapping and nested spans render correctly.
- **A codebook you control.** Themes and codes with definitions, inclusion and exclusion rules
  and examples, all editable between rounds. It ships seeded with the codebook from section 6.1
  of the paper, and you can paste your own list in over the top.
- **Codes can be created while coding.** When nothing in the palette fits, a coder can add a
  code without leaving the unit; it is applied to the selection straight away. Such codes are
  flagged for the lead to review before the next round.
- **Inter-rater reliability.** Percent agreement, Cohen's κ, Fleiss' κ and Krippendorff's α per
  code, plus a pairwise coder matrix and descriptive span-overlap measures.
- **Adjudication.** Resolve disagreements into an agreed coding of record without touching the
  original coding, so the reliability figures stay honest.
- **Iterations.** Each round is one pass. Draw a fresh sample, or re-code an earlier round's
  sample under a revised codebook to see whether agreement actually improved.
- **Export.** Everything as CSV or JSON, with the original data columns carried along.

## Two things worth knowing before you use it

**Marking a unit "done" is what makes it count.** Reliability is only computed over units that
every compared coder has marked done. Without that distinction, a unit nobody has opened looks
exactly like a unit someone deliberately left uncoded, and every coefficient silently inflates.
This is why the workspace has a **Mark done** button and why `progress.csv` exists.

**A coefficient can legitimately be undefined.** When a code has no variance — every coder
applied it everywhere, or nowhere — κ is 0/0. The app prints "undefined" with the reason rather
than a misleading `0`. Percent agreement is still shown, because it is still meaningful. The
converse trap also shows up in real data: a code with 80% agreement can have κ = 0 when one
coder used it and the other never did.

## Local setup

```bash
# 1. Postgres. Anything Postgres 13+ works; Docker is just convenient.
docker run -d --name qualcode-pg \
  -e POSTGRES_PASSWORD=qualcode -e POSTGRES_USER=qualcode -e POSTGRES_DB=qualcode \
  -p 55432:5432 postgres:16-alpine

# 2. Configure
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"  # AUTH_SECRET

# 3. Schema, data, and your own account
npm install
npm run db:migrate
npm run import -- "Qual Analysis - accounts_tidy.csv"
npm run seed:codebook                        # the paper's starting codebook
npm run seed:lead -- --name="Your Name"      # prints your invite link

npm run dev
```

Open the invite link the seed script printed. That binds your browser to your coder identity.

To try the whole loop end to end, with two example coders and an open round of 40 units:

```bash
npm run dev:seed
```

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel.
2. Add the **Neon** integration from the Vercel Marketplace (Vercel's own Postgres product was
   retired in 2025; Neon is its successor and has a free tier that is far more than enough here).
   It injects a block of variables — `POSTGRES_URL`, `DATABASE_URL`, `PGHOST` and so on.
3. Add `AUTH_SECRET` yourself; the integration does not provide one.
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
4. Prepare the database from your machine, using the pooled connection string:
   ```bash
   POSTGRES_URL="postgres://…-pooler….neon.tech/neondb?sslmode=require" npm run db:migrate
   POSTGRES_URL="…" npm run seed:codebook
   POSTGRES_URL="…" npm run import -- "Qual Analysis - accounts_tidy.csv"
   POSTGRES_URL="…" npm run seed:lead -- --name="Your Name" --url=https://your-app.vercel.app
   ```
5. Redeploy, then open the invite link the last command printed.

### Variable names

The app does not insist on one spelling. It looks for a connection string under
`POSTGRES_URL`, then `DATABASE_URL`, then the unpooled variants, and accepts a namespaced
form of any of them — so if the Vercel integration is configured with a prefix, both
`qual_POSTGRES_URL` and `qual_AUTH_SECRET` are picked up with no code change. Pooled endpoints
are preferred automatically; if only a direct one is available the app uses it and says so.

If something is missing, the home page lists exactly what rather than returning a 500.

**One trap worth knowing.** Within a single `.env` file, a later definition of a name overrides
an earlier one. Pasting Neon's block underneath an existing `POSTGRES_URL` therefore silently
switches you to Neon — which is fine, but not always what you meant. Define each name once.

Alternatively add coders from the **Admin** page once you are signed in, and copy their invite
links from there.

## Access model

Each coder has a unique invite link. Opening it once sets a signed, http-only cookie that
identifies them. There are no passwords and no OAuth app to register.

**Invite links are bearer credentials.** Anyone holding one codes as that person. Send them
directly, not to a shared channel. If one leaks, issue a new link from Admin — the old one stops
working immediately. This model suits a small trusted research team; it is not appropriate for
public or participant-facing use.

Leads can manage the codebook, create rounds, adjudicate and administer coders. Coders can only
code, and only units assigned to them in an open round.

## Typical workflow

1. **Codebook** — check the seeded codebook, or paste your own themes and codes in over it.
2. **Rounds → New round** — pick coders, a sample size, and what to stratify by
   (`condition × aor` is the natural choice for this data). Choose full overlap for a pilot.
3. Send each coder their invite link. Everyone codes the same units. If nothing in the palette
   fits a passage, a coder presses **n** and adds a code on the spot.
4. **Codebook** — review anything coders added mid-round. Give it a definition, file it under a
   theme, merge duplicates, then keep or archive it.
5. **Reliability** — read the per-code table. Codes with low α are usually definition problems,
   not training problems.
6. **Adjudicate** — work through the disagreements and record the agreed coding.
7. Revise the codebook, then create a new round — either a fresh sample, or the same sample
   again to test whether the revision helped. **Reliability** across rounds shows the trend.
8. **Export** when you are done.

## The starting codebook

`scripts/paper-codebook.ts` holds the themes and codes taken from section 6.1 of the paper:

| Theme | Codes |
| --- | --- |
| Type of offensiveness | No offensive content · Threats of violence · Hate speech and offensive language |
| Patterns of behavior | Consistent offensive behavior · One-off offensive |
| Justifications | Contextual understanding · Appeal to intent |
| Reflection on the decision | Expressed uncertainty · Would revise the decision · References the recommendation |

Each code carries the definition, inclusion and exclusion rules, and an example quote drawn from
the paper's own text.

Two things to know about it. The paper says it extracted "6 sub themes" but then describes
**seven**; all seven are seeded. And the fourth theme is not part of that formal codebook — it
comes from the paragraph of additional observations at the end of 6.1.3, and is included so those
patterns can be counted rather than asserted. Its third code, *References the recommendation*,
exists specifically to demonstrate a negative finding: the paper reports no participant cited the
AI or crowd label, and coding for it turns that from an impression into a number. Drop the whole
theme with `npm run seed:codebook -- --skip-observations`, or delete it on the codebook page.

## How reliability is computed

The unit of agreement is (unit × code) presence or absence, over units every compared coder
marked done.

| Statistic | When it is used |
| --- | --- |
| Percent agreement | Always. Not chance-corrected; read it alongside κ, never instead of it. |
| Cohen's κ | Exactly two coders. |
| Fleiss' κ | Two or more coders, when every unit has the same number of raters. |
| Krippendorff's α | Always. The one that tolerates unequal raters and missing data. |

Span overlap (mean IoU, and F1 over greedily matched spans at lenient and strict thresholds) is
reported **separately and labelled as descriptive**. These measure *where* coders marked text
given that they agreed a code applies. They are raw overlap with no correction for chance, so
quote them as descriptive statistics, not as reliability coefficients. Unit-level codes are
excluded from them.

The "pooled α" figure treats every (unit, code) cell as one item. It reads high because shared
absences dominate it. The per-code table is the honest view.

The coefficients are tested against published reference values — including Krippendorff's
canonical nominal example (α = 56/81 = 0.691) and the standard Fleiss worked example (κ = 0.210):

```bash
npm test
```

## Project layout

```
db/migrations/        schema, applied in filename order
src/lib/
  sampling.ts         seeded PRNG, stratified allocation, coder assignment
  irr.ts              the coefficients themselves, on plain arrays
  reliability.ts      turns database rows into a report
  spans.ts            splitting text into runs for rendering overlapping codes
  auth.ts  db.ts  csv.ts  queries.ts
src/app/
  code/[roundId]/     the coding workspace
  analysis/           reliability, per round and across rounds
  adjudicate/         disagreement resolution
  codebook/  rounds/  export/  admin/
  api/                annotations, progress, codes, adjudication, exports
scripts/              migrate, import-csv, seed-lead, seed-codebook, dev-seed
                      paper-codebook.ts — the starting themes and codes as data
tests/                irr, reliability, sampling, spans
```

## Commands

| | |
| --- | --- |
| `npm run dev` | development server |
| `npm test` | reliability, sampling and span-rendering tests |
| `npm run db:migrate` | apply pending migrations |
| `npm run db:reset -- --yes` | drop everything and rebuild — deletes all coding |
| `npm run import -- file.csv` | load units; `--text=` and `--id=` override the defaults |
| `npm run seed:lead -- --name="…"` | create a coder and print their invite link |
| `npm run seed:codebook` | load the paper's starting codebook; `--skip-observations` omits the last theme |
| `npm run dev:seed` | the codebook plus two example coders and a round, for trying it out |

Re-importing a corrected CSV updates units in place, matched on the id columns, and leaves
existing coding attached.

`AGENTS.md` and `CLAUDE.md` are generated automatically by `next dev` and will reappear if
deleted.
