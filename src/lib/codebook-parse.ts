/**
 * Reads a codebook from whatever form a lead happens to have it in: pasted
 * spreadsheet rows, a CSV file, or JSON (nested themes, or a flat list).
 * Pure, so the same parser runs in the browser, on the server and in scripts.
 */
import { parseCsv } from "./csv";

export interface CodebookCodeInput {
  name: string;
  definition?: string;
  inclusion?: string;
  exclusion?: string;
  example?: string;
  color?: string;
}

export interface CodebookThemeInput {
  /** Empty means the codes are not filed under a theme. */
  name: string;
  description?: string;
  color?: string;
  codes: CodebookCodeInput[];
}

interface FlatRow {
  theme: string;
  code: string;
  definition: string;
  inclusion: string;
  exclusion: string;
  example: string;
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Groups flat rows under their themes, preserving first-seen order. */
function group(rows: FlatRow[]): CodebookThemeInput[] {
  const themes = new Map<string, CodebookThemeInput>();
  for (const r of rows) {
    if (!r.code) continue;
    const t = themes.get(r.theme) ?? { name: r.theme, codes: [] };
    themes.set(r.theme, t);
    t.codes.push({
      name: r.code,
      definition: r.definition,
      inclusion: r.inclusion,
      exclusion: r.exclusion,
      example: r.example,
    });
  }
  return [...themes.values()];
}

/**
 * Accepts either nested themes
 *   [{ "theme": "Tone", "codes": [{ "name": "Sarcasm", "definition": "…" }] }]
 * or a flat list
 *   [{ "theme": "Tone", "code": "Sarcasm", "definition": "…" }]
 * optionally wrapped as `{ "codebook": [...] }`.
 */
export function normalizeCodebookJson(value: unknown): CodebookThemeInput[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { codebook?: unknown }).codebook)
      ? (value as { codebook: unknown[] }).codebook
      : null;
  if (!list) return [];

  const nested: CodebookThemeInput[] = [];
  const flat: FlatRow[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      flat.push({ theme: "", code: item.trim(), definition: "", inclusion: "", exclusion: "", example: "" });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (Array.isArray(o.codes)) {
      nested.push({
        name: s(o.theme ?? o.name),
        description: s(o.description),
        color: s(o.color) || undefined,
        codes: o.codes.flatMap((c) => {
          if (typeof c === "string") return c.trim() ? [{ name: c.trim() }] : [];
          if (!c || typeof c !== "object") return [];
          const cc = c as Record<string, unknown>;
          const name = s(cc.name ?? cc.code ?? cc.label);
          if (!name) return [];
          return [
            {
              name,
              definition: s(cc.definition ?? cc.description),
              inclusion: s(cc.inclusion),
              exclusion: s(cc.exclusion),
              example: s(cc.example),
              color: s(cc.color) || undefined,
            },
          ];
        }),
      });
    } else {
      flat.push({
        theme: s(o.theme ?? o.category),
        code: s(o.code ?? o.name ?? o.label),
        definition: s(o.definition ?? o.description),
        inclusion: s(o.inclusion),
        exclusion: s(o.exclusion),
        example: s(o.example),
      });
    }
  }
  return [...nested.filter((t) => t.codes.length > 0), ...group(flat)];
}

/**
 * Tab- or comma-separated rows of `theme, code, definition`, with or without a
 * header line. With a header, `inclusion`, `exclusion` and `example` columns
 * are picked up too. A single column is read as a bare list of codes.
 */
export function parseCodebookText(raw: string): CodebookThemeInput[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return normalizeCodebookJson(JSON.parse(text));
    } catch {
      // Not JSON after all; fall through to the delimited readers.
    }
  }

  const blank = { theme: "", code: "", definition: "", inclusion: "", exclusion: "", example: "" };
  let table: string[][];
  if (text.includes("\t")) {
    table = text.split(/\r?\n/).map((line) => line.split("\t"));
  } else {
    const { headers, rows } = parseCsv(text);
    table = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
  }
  table = table.filter((cells) => cells.some((c) => c.trim()));
  if (table.length === 0) return [];

  const header = table[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.includes("code") || header.includes("theme");
  let rows: FlatRow[];
  if (hasHeader) {
    const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const idx = {
      theme: col("theme", "category"),
      code: col("code", "label", "name"),
      definition: col("definition", "description"),
      inclusion: col("inclusion", "include", "inclusion criteria"),
      exclusion: col("exclusion", "exclude", "exclusion criteria"),
      example: col("example", "examples"),
    };
    const at = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    rows = table.slice(1).map((cells) => ({
      theme: at(cells, idx.theme),
      code: at(cells, idx.code),
      definition: at(cells, idx.definition),
      inclusion: at(cells, idx.inclusion),
      exclusion: at(cells, idx.exclusion),
      example: at(cells, idx.example),
    }));
  } else {
    rows = table.map((cells) => ({
      ...blank,
      theme: (cells[0] ?? "").trim(),
      code: (cells[1] ?? "").trim(),
      definition: (cells[2] ?? "").trim(),
    }));
  }

  // A single column is a list of codes with no theme.
  rows = rows.map((r) => (r.code ? r : { ...r, theme: "", code: r.theme }));
  return group(rows);
}

export function countCodes(themes: CodebookThemeInput[]): number {
  return themes.reduce((n, t) => n + t.codes.length, 0);
}
