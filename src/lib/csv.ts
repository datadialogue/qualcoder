/** Minimal RFC 4180 CSV reader/writer. Handles quotes, escaped quotes,
 *  embedded newlines and CRLF, which the real data set contains. */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(input: string): ParsedCsv {
  // A leading BOM otherwise becomes part of the first header name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Skip blank trailing lines.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const out = rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] ?? "";
    });
    return obj;
  });
  return { headers, rows: out };
}

function escapeField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // A leading =, +, - or @ makes spreadsheets treat the cell as a formula.
  const risky = /^[=+\-@]/.test(s);
  const body = risky ? `'${s}` : s;
  return /[",\r\n]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map(escapeField).join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => escapeField(r[h])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
