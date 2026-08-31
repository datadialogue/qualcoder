/** Splitting annotated text into renderable runs. */

export interface SpanLike {
  code_id: string;
  start_offset: number | null;
  end_offset: number | null;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  codeIds: string[];
}

/**
 * Splits `text` at every span boundary so each returned run carries the full
 * set of codes covering it.
 *
 * Wrapping each annotation in its own element instead would produce invalid
 * nesting the moment two codes overlap partially, which is common once coders
 * mark overlapping reasons in the same sentence. Annotations with null offsets
 * apply to the whole unit and are not spans, so they are ignored here.
 */
export function buildSegments(text: string, spans: readonly SpanLike[]): Segment[] {
  const real = spans.filter(
    (s): s is SpanLike & { start_offset: number; end_offset: number } =>
      s.start_offset !== null && s.end_offset !== null,
  );

  const points = new Set<number>([0, text.length]);
  for (const s of real) {
    points.add(Math.min(Math.max(s.start_offset, 0), text.length));
    points.add(Math.min(Math.max(s.end_offset, 0), text.length));
  }
  const sorted = [...points].sort((a, b) => a - b);

  const out: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end <= start) continue;
    out.push({
      start,
      end,
      text: text.slice(start, end),
      // A span covers this run only if it spans the run entirely.
      codeIds: real
        .filter((s) => s.start_offset <= start && s.end_offset >= end)
        .map((s) => s.code_id),
    });
  }
  return out;
}
