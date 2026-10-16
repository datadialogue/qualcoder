/**
 * Turns a study's starter file into codeable units.
 *
 * A starter file is whatever the lead has: a CSV, a JSON array, JSON Lines (the
 * usual shape of Reddit dumps), a Reddit listing saved straight from
 * `reddit.com/…/.json`, or a bundle that also carries the study's name and
 * starting codebook:
 *
 *   {
 *     "study":    { "name": "…", "description": "…" },
 *     "codebook": [{ "theme": "…", "codes": [{ "name": "…", "definition": "…" }] }],
 *     "mapping":  { "preset": "reddit", "displayKeys": ["subreddit", "score"] },
 *     "data":     [ …records, or a Reddit listing… ]
 *   }
 *
 * Everything here is pure so the same code runs in the browser (where large
 * files are parsed before upload), on the server and in the CLI import.
 */
import { parseCsv } from "./csv";
import { normalizeCodebookJson, type CodebookThemeInput } from "./codebook-parse";
import type { ContextItem } from "./types";

export type StarterFormat = "csv" | "json" | "jsonl" | "reddit-listing";
export type Preset = "generic" | "reddit";
export type RedditInclude = "comments" | "posts" | "both";

export class StarterError extends Error {}

export interface ParsedStarter {
  format: StarterFormat;
  /** Every record, with scalar values as strings. Nested values are dropped. */
  records: Record<string, string>[];
  /** Union of record keys, in first-seen order. */
  fields: string[];
  study?: { name?: string; description?: string };
  codebook: CodebookThemeInput[];
  /** Mapping hints carried by a bundle. */
  mapping?: Partial<ImportMapping>;
}

export interface ImportMapping {
  preset: Preset;
  /** Generic: fields joined, blank line between, to form the text that is coded. */
  textFields: string[];
  /** Generic: fields that together identify a record. Empty means row number. */
  idFields: string[];
  /** Raw fields kept as unit metadata (for sampling, display and export). With
   *  the Reddit preset these are in addition to the standard Reddit fields. */
  keepFields: string[];
  /** Metadata keys shown as chips above each unit while coding. */
  displayKeys: string[];
  /** Drop records whose text is just "[deleted]" or "[removed]". */
  skipRemoved: boolean;
  /** Reddit: which items become units. The rest can still serve as context. */
  redditInclude: RedditInclude;
  /** Reddit: show the original post and parent comment above each comment. */
  redditContext: boolean;
}

export interface UnitInput {
  external_id: string;
  text: string;
  meta: Record<string, string>;
  context: ContextItem[];
}

export interface BuildStats {
  records: number;
  units: number;
  empty: number;
  removed: number;
  duplicate: number;
  excluded: number;
}

/* ------------------------------------------------------------------------ */
/* Parsing                                                                  */
/* ------------------------------------------------------------------------ */

const DATA_KEYS = ["data", "units", "records", "items", "rows", "posts", "submissions", "comments"];

function flatten(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) out[k] = "";
    else if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    // Objects and arrays (awards, media, reply trees) are not useful as flat
    // metadata and would bloat every row; they are left out.
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Walks records, unwrapping Reddit's `{kind, data}` envelopes and listings,
 * including the nested `replies` trees of a saved thread.
 */
function collect(items: unknown[], out: Record<string, string>[]): boolean {
  let sawListing = false;
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!isObject(item)) return;
    if (item.kind === "Listing" && isObject(item.data)) {
      sawListing = true;
      const children = (item.data as { children?: unknown }).children;
      if (Array.isArray(children)) children.forEach(visit);
      return;
    }
    if ((item.kind === "t1" || item.kind === "t3") && isObject(item.data)) {
      sawListing = true;
      out.push({ ...flatten(item.data), kind: item.kind });
      if (isObject(item.data.replies)) visit(item.data.replies);
      return;
    }
    if (item.kind === "more") return;
    out.push(flatten(item));
  };
  items.forEach(visit);
  return sawListing;
}

function fieldsOf(records: Record<string, string>[]): string[] {
  const seen = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

function fromJson(value: unknown): ParsedStarter {
  const records: Record<string, string>[] = [];
  let study: ParsedStarter["study"];
  let codebook: CodebookThemeInput[] = [];
  let mapping: ParsedStarter["mapping"];
  let listing = false;

  const isBundle =
    isObject(value) &&
    value.kind !== "Listing" &&
    (DATA_KEYS.some((k) => Array.isArray(value[k]) || isObject(value[k])) ||
      "codebook" in value ||
      "study" in value);

  if (isBundle) {
    const b = value as Record<string, unknown>;
    const meta = isObject(b.study) ? b.study : b;
    const name = typeof meta.name === "string" ? meta.name : undefined;
    const description = typeof meta.description === "string" ? meta.description : undefined;
    if (name || description) study = { name, description };
    codebook = normalizeCodebookJson(b.codebook ?? []);
    if (isObject(b.mapping)) mapping = b.mapping as Partial<ImportMapping>;
    if (b.preset === "reddit" || b.preset === "generic") {
      mapping = { ...mapping, preset: b.preset };
    }
    for (const key of DATA_KEYS) {
      const d = b[key];
      if (Array.isArray(d)) listing = collect(d, records) || listing;
      else if (isObject(d) && d.kind === "Listing") listing = collect([d], records) || listing;
    }
  } else {
    listing = collect(Array.isArray(value) ? value : [value], records);
  }

  return {
    format: listing ? "reddit-listing" : "json",
    records,
    fields: fieldsOf(records),
    study,
    codebook,
    mapping,
  };
}

export function parseStarterFile(input: string): ParsedStarter {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const trimmed = text.trim();
  if (!trimmed) throw new StarterError("The file is empty.");

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let whole: unknown;
    let ok = true;
    try {
      whole = JSON.parse(trimmed);
    } catch {
      ok = false;
    }
    if (ok) return fromJson(whole);

    // JSON Lines: one object per line.
    const items: unknown[] = [];
    const lines = trimmed.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        items.push(JSON.parse(line));
      } catch {
        throw new StarterError(
          `Could not read line ${i + 1} as JSON. The file looks like JSON or JSON Lines, ` +
            "but this line is malformed.",
        );
      }
    }
    const records: Record<string, string>[] = [];
    const listing = collect(items, records);
    return {
      format: listing ? "reddit-listing" : "jsonl",
      records,
      fields: fieldsOf(records),
      codebook: [],
    };
  }

  const { headers, rows } = parseCsv(text);
  if (headers.length === 0) throw new StarterError("The file is empty.");
  return { format: "csv", records: rows, fields: headers, codebook: [] };
}

/* ------------------------------------------------------------------------ */
/* Reddit                                                                   */
/* ------------------------------------------------------------------------ */

/** The metadata every Reddit unit gets, whatever the dump looked like. */
export const REDDIT_FIELDS = [
  "kind",
  "subreddit",
  "author",
  "score",
  "created",
  "permalink",
  "post_id",
  "parent_id",
  "num_comments",
  "flair",
] as const;

/** Author is left off by default: seeing who wrote something invites coders to
 *  code the person rather than the text. Add it in settings if it matters. */
const REDDIT_DISPLAY = ["kind", "subreddit", "score", "created"];

const REMOVED = new Set(["[deleted]", "[removed]"]);

export function looksLikeReddit(fields: string[]): boolean {
  const f = new Set(fields);
  const text = f.has("body") || f.has("selftext");
  const reddit = ["subreddit", "permalink", "link_id", "parent_id", "subreddit_id"].some((k) =>
    f.has(k),
  );
  return text && reddit;
}

interface RedditItem {
  kind: "comment" | "post";
  fullname: string;
  text: string;
  removed: boolean;
  meta: Record<string, string>;
  raw: Record<string, string>;
}

function isoTime(raw: string): string {
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n) || raw.trim() === "") return raw;
  // Reddit uses seconds; some exporters write milliseconds.
  const d = new Date(n > 1e12 ? n : n * 1000);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function withPrefix(id: string, prefix: "t1_" | "t3_"): string {
  if (!id) return "";
  return /^t\d_/.test(id) ? id : prefix + id;
}

function normalizeReddit(r: Record<string, string>): RedditItem | null {
  const kindRaw = (r.kind ?? r.type ?? "").toLowerCase();
  let kind: RedditItem["kind"] | null = null;
  if (kindRaw === "t1" || kindRaw === "comment") kind = "comment";
  else if (["t3", "post", "submission", "link"].includes(kindRaw)) kind = "post";
  else if (r.body !== undefined) kind = "comment";
  else if (r.title !== undefined || r.selftext !== undefined) kind = "post";
  if (!kind) return null;

  const prefix = kind === "comment" ? "t1_" : "t3_";
  const fullname = /^t\d_/.test(r.name ?? "") ? r.name : withPrefix(r.id ?? "", prefix);

  let text: string;
  let removed: boolean;
  if (kind === "comment") {
    const body = (r.body ?? "").trim();
    removed = REMOVED.has(body);
    text = body;
  } else {
    const title = (r.title ?? "").trim();
    const self = (r.selftext ?? "").trim();
    removed = !title && REMOVED.has(self);
    text = [title, REMOVED.has(self) ? "" : self].filter(Boolean).join("\n\n");
  }

  let permalink = r.permalink ?? "";
  if (permalink.startsWith("/")) permalink = `https://www.reddit.com${permalink}`;
  else if (!/^https?:\/\//.test(permalink)) permalink = "";

  const meta: Record<string, string> = {
    kind,
    subreddit: (r.subreddit ?? "").replace(/^r\//, ""),
    author: r.author ?? "",
    score: r.score ?? "",
    created: isoTime(r.created_utc ?? r.created ?? r.timestamp ?? ""),
    permalink,
    post_id: kind === "comment" ? withPrefix(r.link_id ?? "", "t3_") : fullname,
    parent_id: kind === "comment" ? (r.parent_id ?? "") : "",
    num_comments: kind === "post" ? (r.num_comments ?? "") : "",
    flair: r.link_flair_text ?? "",
  };
  return { kind, fullname, text, removed, meta, raw: r };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

/* ------------------------------------------------------------------------ */
/* Mapping                                                                  */
/* ------------------------------------------------------------------------ */

/** The field whose values are, on average, longest: almost always the prose. */
function guessTextField(records: Record<string, string>[], fields: string[]): string {
  const sample = records.slice(0, 2000);
  let best = fields[0] ?? "";
  let bestLen = -1;
  for (const f of fields) {
    const total = sample.reduce((n, r) => n + (r[f]?.length ?? 0), 0);
    if (total > bestLen) {
      best = f;
      bestLen = total;
    }
  }
  return best;
}

function guessIdFields(records: Record<string, string>[], fields: string[]): string[] {
  const candidates = fields.filter((f) => /^(id|uuid|_id|.*_id|key)$/i.test(f));
  for (const f of candidates) {
    const values = new Set(records.map((r) => r[f] ?? ""));
    if (!values.has("") && values.size === records.length) return [f];
  }
  return [];
}

/** Short categorical columns make good chips; free text and identifiers do not. */
function guessDisplayKeys(
  records: Record<string, string>[],
  fields: string[],
  exclude: Set<string>,
): string[] {
  const sample = records.slice(0, 2000);
  const out: string[] = [];
  for (const f of fields) {
    if (exclude.has(f)) continue;
    const values = new Set(sample.map((r) => r[f] ?? ""));
    values.delete("");
    const avg = sample.reduce((n, r) => n + (r[f]?.length ?? 0), 0) / Math.max(1, sample.length);
    if (values.size >= 1 && values.size <= 24 && avg <= 40) out.push(f);
    if (out.length === 5) break;
  }
  return out;
}

export function defaultMapping(parsed: ParsedStarter): ImportMapping {
  const { records, fields } = parsed;
  const preset: Preset =
    parsed.mapping?.preset ??
    (parsed.format === "reddit-listing" || looksLikeReddit(fields) ? "reddit" : "generic");

  let base: ImportMapping;
  if (preset === "reddit") {
    base = {
      preset,
      textFields: [],
      idFields: [],
      keepFields: [],
      displayKeys: REDDIT_DISPLAY,
      skipRemoved: true,
      redditInclude: "both",
      redditContext: true,
    };
  } else {
    const text = guessTextField(records, fields);
    const ids = guessIdFields(records, fields);
    base = {
      preset,
      textFields: text ? [text] : [],
      idFields: ids,
      keepFields: fields.filter((f) => f !== text),
      displayKeys: guessDisplayKeys(records, fields, new Set([text, ...ids])),
      skipRemoved: false,
      redditInclude: "both",
      redditContext: false,
    };
  }

  // A bundle may pin any of these; only accept values that fit the data.
  const hint = parsed.mapping ?? {};
  const known = (list: unknown) =>
    Array.isArray(list) ? list.filter((f): f is string => typeof f === "string") : undefined;
  const has = (list: string[] | undefined, allowed: Set<string>) =>
    list?.filter((f) => allowed.has(f));
  const fieldSet = new Set(fields);
  const metaSet = new Set(preset === "reddit" ? [...REDDIT_FIELDS, ...fields] : fields);
  return {
    ...base,
    textFields: has(known(hint.textFields), fieldSet) ?? base.textFields,
    idFields: has(known(hint.idFields), fieldSet) ?? base.idFields,
    keepFields: has(known(hint.keepFields), fieldSet) ?? base.keepFields,
    displayKeys: has(known(hint.displayKeys), metaSet) ?? base.displayKeys,
    skipRemoved: typeof hint.skipRemoved === "boolean" ? hint.skipRemoved : base.skipRemoved,
    redditInclude: ["comments", "posts", "both"].includes(hint.redditInclude as string)
      ? (hint.redditInclude as RedditInclude)
      : base.redditInclude,
    redditContext: typeof hint.redditContext === "boolean" ? hint.redditContext : base.redditContext,
  };
}

/** The metadata keys units will carry under a mapping, for choosing display keys. */
export function metaKeysFor(mapping: ImportMapping): string[] {
  if (mapping.preset === "reddit") {
    return [...new Set([...REDDIT_FIELDS, ...mapping.keepFields])];
  }
  return mapping.keepFields.filter((f) => !mapping.textFields.includes(f));
}

/* ------------------------------------------------------------------------ */
/* Building units                                                           */
/* ------------------------------------------------------------------------ */

export function buildUnits(
  parsed: ParsedStarter,
  mapping: ImportMapping,
): { units: UnitInput[]; stats: BuildStats } {
  const stats: BuildStats = {
    records: parsed.records.length,
    units: 0,
    empty: 0,
    removed: 0,
    duplicate: 0,
    excluded: 0,
  };
  const units: UnitInput[] = [];
  const seen = new Set<string>();
  const push = (u: UnitInput) => {
    if (seen.has(u.external_id)) {
      stats.duplicate++;
      return;
    }
    seen.add(u.external_id);
    units.push(u);
  };

  if (mapping.preset === "reddit") {
    const items = parsed.records.map(normalizeReddit);
    // Every item is available as context, including kinds not being coded.
    const byFullname = new Map<string, RedditItem>();
    for (const it of items) if (it?.fullname) byFullname.set(it.fullname, it);

    items.forEach((it, i) => {
      if (!it) {
        stats.empty++;
        return;
      }
      if (mapping.redditInclude === "comments" && it.kind !== "comment") return void stats.excluded++;
      if (mapping.redditInclude === "posts" && it.kind !== "post") return void stats.excluded++;
      if (it.removed && mapping.skipRemoved) return void stats.removed++;
      if (!it.text) return void stats.empty++;

      const context: ContextItem[] = [];
      if (mapping.redditContext && it.kind === "comment") {
        const post = byFullname.get(it.meta.post_id);
        const sub = it.meta.subreddit ? ` · r/${it.meta.subreddit}` : "";
        if (post?.text) context.push({ label: `Original post${sub}`, text: truncate(post.text, 1500) });
        else if (it.raw.link_title) context.push({ label: `Original post${sub}`, text: it.raw.link_title });
        const parent = it.meta.parent_id.startsWith("t1_") ? byFullname.get(it.meta.parent_id) : undefined;
        if (parent?.text) context.push({ label: "Replying to", text: truncate(parent.text, 1000) });
      }

      const meta: Record<string, string> = { ...it.meta };
      for (const f of mapping.keepFields) if (!(f in meta)) meta[f] = it.raw[f] ?? "";
      push({ external_id: it.fullname || `row-${i + 1}`, text: it.text, meta, context });
    });
  } else {
    if (mapping.textFields.length === 0) {
      throw new StarterError("Choose at least one field holding the text to code.");
    }
    const text = new Set(mapping.textFields);
    parsed.records.forEach((r, i) => {
      const body = mapping.textFields
        .map((f) => (r[f] ?? "").trim())
        .filter(Boolean)
        .join("\n\n");
      if (!body) return void stats.empty++;
      if (mapping.skipRemoved && REMOVED.has(body)) return void stats.removed++;
      const id = mapping.idFields.map((f) => r[f] ?? "").join("::");
      const meta: Record<string, string> = {};
      for (const f of mapping.keepFields) if (!text.has(f)) meta[f] = r[f] ?? "";
      push({
        external_id: id.replace(/:/g, "") ? id : `row-${i + 1}`,
        text: body,
        meta,
        context: [],
      });
    });
  }

  stats.units = units.length;
  return { units, stats };
}

/* ------------------------------------------------------------------------ */
/* Transport                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Splits units into request-sized batches. Server Actions cap bodies at 1MB
 * and Vercel Functions at 4.5MB, so large studies go up in pieces.
 */
export function chunkUnits(units: UnitInput[], maxBytes = 800_000, maxCount = 2000): UnitInput[][] {
  const chunks: UnitInput[][] = [];
  let current: UnitInput[] = [];
  let size = 0;
  for (const u of units) {
    // UTF-8 can take up to 3 bytes per UTF-16 unit; overestimating is harmless.
    const bytes = JSON.stringify(u).length * 3;
    if (current.length > 0 && (size + bytes > maxBytes || current.length >= maxCount)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(u);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const MAX_ID = 512;

/** Server-side check of a unit sent by the browser. Returns null if unusable. */
export function sanitizeUnit(value: unknown): UnitInput | null {
  if (!isObject(value)) return null;
  const external_id = typeof value.external_id === "string" ? value.external_id.trim() : "";
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!external_id || external_id.length > MAX_ID || !text) return null;
  const meta: Record<string, string> = {};
  if (isObject(value.meta)) {
    for (const [k, v] of Object.entries(value.meta)) {
      if (typeof v === "string") meta[k] = v;
      else if (typeof v === "number" || typeof v === "boolean") meta[k] = String(v);
    }
  }
  const context: ContextItem[] = Array.isArray(value.context)
    ? value.context.flatMap((c) =>
        isObject(c) && typeof c.text === "string" && c.text.trim()
          ? [{ label: typeof c.label === "string" ? c.label : "", text: c.text }]
          : [],
      )
    : [];
  return { external_id, text, meta, context };
}
