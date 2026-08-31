import test from "node:test";
import assert from "node:assert/strict";
import { buildSegments, type SpanLike } from "../src/lib/spans.ts";

const span = (code: string, start: number | null, end: number | null): SpanLike => ({
  code_id: code,
  start_offset: start,
  end_offset: end,
});

const TEXT = "Threatened to kill someone and used a slur.";

test("text with no spans is one plain run", () => {
  const segs = buildSegments(TEXT, []);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0], { start: 0, end: TEXT.length, text: TEXT, codeIds: [] });
});

test("a single span splits the text into a coded run and a plain one", () => {
  const segs = buildSegments(TEXT, [span("threat", 0, 26)]);
  assert.deepEqual(
    segs.map((s) => [s.text, s.codeIds]),
    [
      ["Threatened to kill someone", ["threat"]],
      [" and used a slur.", []],
    ],
  );
});

test("partially overlapping spans produce a shared middle run", () => {
  // This is the case a naive wrap-each-span renderer gets wrong: the overlap
  // must carry both codes rather than nesting invalidly.
  const segs = buildSegments("abcdefghij", [span("a", 0, 6), span("b", 4, 10)]);
  assert.deepEqual(
    segs.map((s) => [s.text, s.codeIds.slice().sort()]),
    [
      ["abcd", ["a"]],
      ["ef", ["a", "b"]],
      ["ghij", ["b"]],
    ],
  );
});

test("a nested span carries both its own code and the enclosing one", () => {
  const segs = buildSegments("abcdefghij", [span("outer", 0, 10), span("inner", 3, 6)]);
  assert.deepEqual(
    segs.map((s) => [s.text, s.codeIds.slice().sort()]),
    [
      ["abc", ["outer"]],
      ["def", ["inner", "outer"]],
      ["ghij", ["outer"]],
    ],
  );
});

test("identical spans from two codes collapse into one run", () => {
  const segs = buildSegments("abcdef", [span("x", 0, 3), span("y", 0, 3)]);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs[0].codeIds.slice().sort(), ["x", "y"]);
});

test("unit-level codes are ignored, since they mark no span", () => {
  const segs = buildSegments(TEXT, [span("whole", null, null)]);
  assert.equal(segs.length, 1);
  assert.deepEqual(segs[0].codeIds, []);
});

test("adjacent spans do not create an empty run between them", () => {
  const segs = buildSegments("abcdef", [span("a", 0, 3), span("b", 3, 6)]);
  assert.equal(segs.length, 2);
  assert.ok(segs.every((s) => s.text.length > 0));
});

test("segments always reconstruct the original text exactly", () => {
  const spans = [span("a", 2, 9), span("b", 5, 20), span("c", 0, 4), span("d", 30, 42)];
  const segs = buildSegments(TEXT, spans);
  assert.equal(segs.map((s) => s.text).join(""), TEXT);
  // Runs must tile the text with no gaps or overlaps.
  for (let i = 1; i < segs.length; i++) {
    assert.equal(segs[i].start, segs[i - 1].end);
  }
});

test("out-of-range offsets are clamped rather than producing phantom runs", () => {
  const segs = buildSegments("abcdef", [span("a", -5, 100)]);
  assert.equal(segs.map((s) => s.text).join(""), "abcdef");
  assert.ok(segs.every((s) => s.start >= 0 && s.end <= 6));
  assert.deepEqual(segs[0].codeIds, ["a"]);
});

test("a span covering everything yields one fully coded run", () => {
  const segs = buildSegments("abc", [span("a", 0, 3)]);
  assert.deepEqual(segs, [{ start: 0, end: 3, text: "abc", codeIds: ["a"] }]);
});

test("empty text does not produce a run", () => {
  assert.deepEqual(buildSegments("", []), []);
});
