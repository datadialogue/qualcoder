# Qualitative Coding

A small web app for coding text data with a shared codebook, measuring inter-rater
reliability, and iterating on the codebook across rounds. Built to be deployed on Vercel with
Neon Postgres.

One deployment hosts any number of **studies**. Each study has its own dataset, codebook, rounds,
reliability figures and exports; coders are shared, so one person can work on several. A lead
starts a study by uploading a **starter file** — a CSV, JSON, JSON Lines, or a Reddit export,
optionally bundled with the study's starting codebook.

The first study it was built for, `Qual Analysis - accounts_tidy.csv` (1450 participant
justifications for suspending or not suspending an account), is now just one study among others.

## What it does

- **Studies from a starter file.** *New study* reads the file in the browser, shows how it maps onto
  units with a live preview, and uploads it in batches — so a multi-megabyte Reddit dump goes
  through even though request bodies are capped well below that. Re-importing a corrected or
  extended file into a study updates units in place.
- **Reddit data, natively.** Posts and comments from Pushshift / Arctic Shift dumps, PRAW exports, or
  a thread saved from `reddit.com/….json` (nested replies included). A comment is coded on its body,
  a post on its title and self-text; `[deleted]` and `[removed]` items are skipped. Each comment shows
  the original post and the comment it replies to above it as read-only context, and links back to
  the original.

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

### Trying it out on dummy data

```bash
npm install
npm run dev:local
```

That one command needs only Docker running. It starts a Postgres container of its own
(`qualcode-local`, port 55434), fills it the first time with the Reddit example study — a lead, two
coders, a finished pilot round, an open second round, a couple of near-duplicate codes and a merge
proposal waiting for a vote — and starts the app. It prints a fixed invite link per person
(`/join/local-lead`, `/join/local-ana`, `/join/local-ben`); use a separate browser or private window
for each. It ignores `.env.local` entirely, so your real database is never touched.

`npm run dev:local -- --reset` throws the dummy data away and seeds it afresh. Other arguments go to
`next dev` (`npm run dev:local -- -p 3001`). Set `LOCAL_DATABASE_URL` to a localhost Postgres to use
that instead of Docker.

### Setting up your own database

```bash
# 1. Postgres. Anything Postgres 13+ works; Docker is just convenient.
docker run -d --name qualcode-pg \
  -e POSTGRES_PASSWORD=qualcode -e POSTGRES_USER=qualcode -e POSTGRES_DB=qualcode \
  -p 55432:5432 postgres:16-alpine

# 2. Configure
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"  # AUTH_SECRET

# 3. Schema and your own account
npm install
npm run db:migrate
npm run seed:lead -- --name="Your Name"      # prints your invite link

npm run dev
```

Open the invite link the seed script printed. That binds your browser to your coder identity. Then
press **New study** on the home page and upload a starter file — `examples/reddit-starter.json` is a
small synthetic one to try.

To try the whole loop end to end, with two example coders and an open round:

```bash
npm run import -- examples/reddit-starter.json --new
npm run dev:seed -- --study="Reddit starter example"
```

To rebuild the original account-suspension study:

```bash
npm run import -- "Qual Analysis - accounts_tidy.csv" --new="Account suspension" \
  --text=justification --id=user_id,account
npm run seed:codebook -- --study="Account suspension"   # the paper's starting codebook
```

### Upgrading an existing database

`db/migrations/003_studies.sql` introduces studies. On a database that already holds data it
folds everything — units, codebook, rounds and coding — into one study called *Original study*,
which you can rename on its *Data & settings* page. Run `npm run db:migrate` and deploy the new code
together: the old code cannot write to the migrated schema, and the new code needs it.

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
   POSTGRES_URL="…" npm run seed:lead -- --name="Your Name" --url=https://your-app.vercel.app
   ```
5. Redeploy, open the invite link the last command printed, and start a study from the home page.

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

Leads can start studies, manage codebooks, create rounds, adjudicate and administer coders, in
every study. Coders can only code, and only units assigned to them in an open round. A coder sees
the studies they have been put on a round in; a lead sees all of them.

## Typical workflow

1. **New study** — upload the starter file, check the preview, and bring a starting codebook along if
   you have one (in the file, pasted, or uploaded).
2. **Codebook** — check it, or paste your own themes and codes in over it.
3. **Rounds → New round** — pick coders, a sample size, and what to stratify by (for Reddit data,
   `subreddit` or `kind` are natural choices). Choose full overlap for a pilot.
4. Send each coder their invite link. Everyone codes the same units. If nothing in the palette
   fits a passage, a coder presses **n** and adds a code on the spot.
5. **Codebook** — review anything coders added mid-round. Give it a definition, file it under a
   theme, merge duplicates, then keep or archive it.
6. **Reliability** — read the per-code table. Codes with low α are usually definition problems,
   not training problems.
7. **Adjudicate** — work through the disagreements and record the agreed coding.
8. Revise the codebook, then create a new round — either a fresh sample, or the same sample
   again to test whether the revision helped. **Reliability** across rounds shows the trend.
9. **Export** when you are done.

## Starter files

Anything with one record per item to be coded. The format is detected from the content:

| Format | Notes |
| --- | --- |
| CSV | One row per unit. Pick the text column(s) and the id column(s) in the preview. |
| JSON array / JSON Lines | One object per unit. Nested values are ignored; scalars become metadata. |
| Reddit | Detected from fields like `body`, `selftext`, `subreddit`, `link_id`. Dumps, PRAW exports and `reddit.com/….json` listings all work, as do tidy CSVs with `text_content`, `thread_id`, `parent_id` and `is_main_post` / `item_type` columns. |
| Bundle | A JSON object carrying the data plus the study's name and codebook, below. |

```json
{
  "study":    { "name": "Reddit pilot", "description": "r/examplecity, Jan 2026" },
  "mapping":  { "preset": "reddit", "redditInclude": "comments",
                "displayKeys": ["subreddit", "score", "created"] },
  "codebook": [
    { "theme": "Stance", "codes": [
      { "name": "Supports", "definition": "…", "inclusion": "…", "exclusion": "…", "example": "…" }
    ] }
  ],
  "data": [ { "id": "abc", "body": "…", "subreddit": "examplecity", "link_id": "t3_x", "parent_id": "t3_x" } ]
}
```

Everything except `data` is optional, and every `mapping` field can be changed in the preview.
`data` may also be a Reddit listing. `examples/reddit-starter.json` is a complete, synthetic example.

For Reddit, every unit gets the same metadata whatever the dump looked like: `kind` (post or
comment), `subreddit`, `author`, `score`, `created` (ISO time), `permalink`, `post_id`,
`parent_id`, `num_comments` and `flair`; add any raw field on top. The author is kept but not
shown to coders by default, to keep attention on the text. Parent context is only available for
posts and comments that are in the same file, so include the posts when you export comments if
you want coders to see what they reply to. Context is never part of the coded text — span offsets
always refer to the comment alone.

The codebook can also be pasted on the Codebook page or given to *New study* separately, as rows of
`theme, code, definition` (CSV or tab-separated, with optional `inclusion`, `exclusion` and
`example` columns) or as JSON.

## The original study's codebook

`scripts/paper-codebook.ts` holds the themes and codes taken from section 6.1 of the paper behind the
account-suspension study. `npm run seed:codebook -- --study=…` loads it into a study:

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
theme with `--skip-observations`, or delete it on the codebook page.

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
  starter.ts          starter-file parsing, the Reddit preset, units and batching
  codebook-parse.ts   reading a codebook from pasted rows, CSV or JSON
  codebook-write.ts   merging a codebook into a study   units-write.ts  upserting units
  sampling.ts         seeded PRNG, stratified allocation, coder assignment
  irr.ts              the coefficients themselves, on plain arrays
  reliability.ts      turns database rows into a report
  spans.ts            splitting text into runs for rendering overlapping codes
  auth.ts  db.ts  csv.ts  queries.ts
src/app/
  page.tsx            studies and your open work across them
  studies/new/        the starter-file import
  studies/[studyId]/  overview, codebook, rounds, analysis, adjudicate, export, settings
  code/[roundId]/     the coding workspace
  admin/              coders and invite links
  api/                studies, units, annotations, progress, codes, adjudication, exports
scripts/              migrate, import-csv, seed-lead, seed-codebook, dev-seed
                      paper-codebook.ts — the original study's themes and codes as data
examples/             reddit-starter.json, a synthetic starter bundle
tests/                irr, reliability, sampling, spans, starter files, codebook parsing
```

## Commands

| | |
| --- | --- |
| `npm run dev` | development server |
| `npm run dev:local` | development server on a throwaway local database with dummy data; `-- --reset` re-seeds |
| `npm test` | reliability, sampling, span-rendering and import tests |
| `npm run db:migrate` | apply pending migrations |
| `npm run db:reset -- --yes` | drop everything and rebuild — deletes all coding |
| `npm run import -- file --study=…` | load a starter file into a study; `--new[="Name"]` creates one; `--text=`, `--id=`, `--preset=reddit\|generic` override detection |
| `npm run seed:lead -- --name="…"` | create a coder and print their invite link |
| `npm run seed:codebook -- --study=…` | load the original study's codebook; `--skip-observations` omits the last theme |
| `npm run dev:seed -- --study=…` | two example coders and an open round, for trying it out |

`--study=` takes a study's id or exact name, and can be left out when there is only one study.
Re-importing a corrected file updates units in place, matched on their ids, and leaves existing
coding attached.

`AGENTS.md` and `CLAUDE.md` are generated automatically by `next dev` and will reappear if
deleted.
