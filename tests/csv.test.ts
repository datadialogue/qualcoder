import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "../src/lib/csv.ts";

test("quoted fields containing commas survive parsing", () => {
  const { headers, rows } = parseCsv('a,b\n1,"hello, world"\n');
  assert.deepEqual(headers, ["a", "b"]);
  assert.deepEqual(rows, [{ a: "1", b: "hello, world" }]);
});

test("escaped double quotes are unescaped", () => {
  const { rows } = parseCsv('a\n"she said ""no"""\n');
  assert.equal(rows[0].a, 'she said "no"');
});

test("newlines inside quoted fields do not split the row", () => {
  const { rows } = parseCsv('a,b\n"line one\nline two",x\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].a, "line one\nline two");
  assert.equal(rows[0].b, "x");
});

test("CRLF line endings are handled", () => {
  const { rows } = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
  assert.deepEqual(rows, [
    { a: "1", b: "2" },
    { a: "3", b: "4" },
  ]);
});

test("a UTF-8 BOM does not corrupt the first header", () => {
  const { headers } = parseCsv("﻿user_id,justification\n1,hi\n");
  assert.deepEqual(headers, ["user_id", "justification"]);
});

test("missing trailing cells become empty strings", () => {
  const { rows } = parseCsv("a,b,c\n1,2\n");
  assert.deepEqual(rows[0], { a: "1", b: "2", c: "" });
});

test("blank trailing lines are ignored", () => {
  const { rows } = parseCsv("a\n1\n\n");
  assert.equal(rows.length, 1);
});

test("empty input yields no headers and no rows", () => {
  assert.deepEqual(parseCsv(""), { headers: [], rows: [] });
});

test("writing then reading returns the original values", () => {
  const rows = [
    { code: "Threat", quote: 'said "kill you", twice', n: 3 },
    { code: "Slur", quote: "line one\nline two", n: 0 },
    { code: "Plain", quote: "", n: 12 },
  ];
  const { rows: back } = parseCsv(toCsv(["code", "quote", "n"], rows));
  assert.deepEqual(
    back,
    rows.map((r) => ({ ...r, n: String(r.n) })),
  );
});

test("cells that would be read as spreadsheet formulas are neutralised", () => {
  // A quote beginning with = or + is executed on open in Excel and Sheets.
  const csv = toCsv(["quote"], [{ quote: "=1+1" }, { quote: "@import" }]);
  assert.ok(csv.includes("'=1+1"), "leading = must be escaped");
  assert.ok(csv.includes("'@import"), "leading @ must be escaped");
});

test("null and undefined become empty cells rather than the strings", () => {
  const csv = toCsv(["a", "b"], [{ a: null, b: undefined }]);
  assert.equal(csv.trim().split("\r\n")[1], ",");
});
