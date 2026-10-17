import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildUnits,
  chunkUnits,
  defaultMapping,
  parseStarterFile,
  sanitizeUnit,
  StarterError,
} from "../src/lib/starter.ts";

const build = (text: string, patch = {}) => {
  const parsed = parseStarterFile(text);
  return { parsed, ...buildUnits(parsed, { ...defaultMapping(parsed), ...patch }) };
};

test("a CSV defaults to its longest column as text and keeps the rest as metadata", () => {
  const csv = "id,condition,justification\n1,ai,The account posted repeated threats against a named person.\n2,crowd,Nothing offensive here.\n";
  const { parsed, units } = build(csv);
  assert.equal(parsed.format, "csv");
  const m = defaultMapping(parsed);
  assert.deepEqual(m.textFields, ["justification"]);
  assert.deepEqual(m.idFields, ["id"]);
  assert.equal(m.preset, "generic");
  assert.equal(units.length, 2);
  assert.equal(units[0].external_id, "1");
  assert.deepEqual(units[0].meta, { id: "1", condition: "ai" });
  assert.ok(m.displayKeys.includes("condition"));
});

test("several text fields are joined in order, and rows without text are skipped", () => {
  const csv = "title,body\nHello,World\n,\nOnly title,\n";
  const { units, stats } = build(csv, { textFields: ["title", "body"], idFields: [] });
  assert.deepEqual(units.map((u) => u.text), ["Hello\n\nWorld", "Only title"]);
  assert.equal(units[1].external_id, "row-3");
  assert.equal(stats.empty, 1);
});

test("duplicate ids keep the first row and are counted", () => {
  const { units, stats } = build("id,text\na,one\na,two\n", { textFields: ["text"], idFields: ["id"] });
  assert.equal(units.length, 1);
  assert.equal(units[0].text, "one");
  assert.equal(stats.duplicate, 1);
});

test("JSON Lines Reddit comments are detected and get standard metadata", () => {
  const jsonl = [
    JSON.stringify({ id: "p1", title: "A post", selftext: "Body", subreddit: "test", permalink: "/r/test/comments/p1/", created_utc: 1700000000, score: 5 }),
    JSON.stringify({ id: "c1", body: "First!", link_id: "t3_p1", parent_id: "t3_p1", subreddit: "test", author: "u1", score: 2, created_utc: "1700000100" }),
    JSON.stringify({ id: "c2", body: "Reply", link_id: "t3_p1", parent_id: "t1_c1", subreddit: "test" }),
  ].join("\n");
  const { parsed, units } = build(jsonl);
  assert.equal(parsed.format, "jsonl");
  assert.equal(defaultMapping(parsed).preset, "reddit");

  const post = units.find((u) => u.external_id === "t3_p1")!;
  assert.equal(post.text, "A post\n\nBody");
  assert.equal(post.meta.kind, "post");
  assert.equal(post.meta.permalink, "https://www.reddit.com/r/test/comments/p1/");
  assert.equal(post.meta.created, "2023-11-14T22:13:20Z");

  const reply = units.find((u) => u.external_id === "t1_c2")!;
  assert.equal(reply.meta.kind, "comment");
  assert.equal(reply.meta.post_id, "t3_p1");
  assert.deepEqual(
    reply.context.map((c) => [c.label, c.text]),
    [
      ["Original post · r/test", "A post\n\nBody"],
      ["Replying to", "First!"],
    ],
  );
  // A top-level comment has the post as context but no parent comment.
  assert.equal(units.find((u) => u.external_id === "t1_c1")!.context.length, 1);
});

test("a tidy Reddit CSV with thread_id and is_main_post gets the Reddit preset and context", () => {
  const csv = [
    "unit_id,thread_id,parent_id,item_type,is_main_post,text_content,author_anon,created_utc,score",
    't3_p1,t3_p1,,main_post,1,"Title\n\nPost body",User_a,1700000000,4',
    "t1_c1,t3_p1,t3_p1,reply,0,Top-level reply,User_b,1700000100,2",
    "t1_c2,t3_p1,t1_c1,reply,0,Nested reply,User_c,1700000200,1",
    "t1_c3,t3_p1,t3_p1,reply,0,[deleted],User_d,1700000300,1",
  ].join("\n");
  const { parsed, units, stats } = build(csv);
  assert.equal(parsed.format, "csv");
  assert.equal(defaultMapping(parsed).preset, "reddit");
  assert.equal(stats.removed, 1);

  const post = units.find((u) => u.external_id === "t3_p1")!;
  assert.equal(post.meta.kind, "post");
  assert.equal(post.text, "Title\n\nPost body");
  assert.equal(post.meta.author, "User_a");

  const top = units.find((u) => u.external_id === "t1_c1")!;
  assert.equal(top.meta.kind, "comment");
  assert.deepEqual(top.context.map((c) => c.label), ["Original post · replying directly to it"]);

  const nested = units.find((u) => u.external_id === "t1_c2")!;
  assert.deepEqual(
    nested.context.map((c) => [c.label, c.text]),
    [
      ["Original post", "Title\n\nPost body"],
      ["Replying to", "Top-level reply"],
    ],
  );

  // Main posts only.
  assert.deepEqual(build(csv, { redditInclude: "posts" }).units.map((u) => u.external_id), ["t3_p1"]);
});

test("Reddit include filter keeps posts available as context", () => {
  const jsonl = [
    JSON.stringify({ id: "p1", title: "Post", subreddit: "s", permalink: "/r/s/comments/p1/" }),
    JSON.stringify({ id: "c1", body: "Comment", link_id: "t3_p1", parent_id: "t3_p1", subreddit: "s" }),
  ].join("\n");
  const { units, stats } = build(jsonl, { redditInclude: "comments" });
  assert.deepEqual(units.map((u) => u.external_id), ["t1_c1"]);
  assert.equal(stats.excluded, 1);
  assert.equal(units[0].context[0].text, "Post");
});

test("removed and deleted Reddit comments are skipped by default", () => {
  const jsonl = [
    JSON.stringify({ id: "c1", body: "[removed]", parent_id: "t3_x", subreddit: "s" }),
    JSON.stringify({ id: "c2", body: "[deleted]", parent_id: "t3_x", subreddit: "s" }),
    JSON.stringify({ id: "c3", body: "kept", parent_id: "t3_x", subreddit: "s" }),
  ].join("\n");
  const { units, stats } = build(jsonl);
  assert.equal(units.length, 1);
  assert.equal(stats.removed, 2);
  assert.equal(build(jsonl, { skipRemoved: false }).units.length, 3);
});

test("a thread saved from reddit.com/.json is unwrapped, nested replies included", () => {
  const listing = (children: unknown[]) => ({ kind: "Listing", data: { children } });
  const thread = [
    listing([{ kind: "t3", data: { id: "p9", name: "t3_p9", title: "Thread", selftext: "", subreddit: "s", permalink: "/r/s/comments/p9/x/" } }]),
    listing([
      {
        kind: "t1",
        data: {
          id: "a", name: "t1_a", body: "Top", link_id: "t3_p9", parent_id: "t3_p9", subreddit: "s",
          replies: listing([
            { kind: "t1", data: { id: "b", name: "t1_b", body: "Nested", link_id: "t3_p9", parent_id: "t1_a", subreddit: "s", replies: "" } },
            { kind: "more", data: { count: 3, children: ["c", "d"] } },
          ]),
        },
      },
    ]),
  ];
  const { parsed, units } = build(JSON.stringify(thread));
  assert.equal(parsed.format, "reddit-listing");
  assert.deepEqual(units.map((u) => u.external_id), ["t3_p9", "t1_a", "t1_b"]);
  assert.equal(units[2].context[1].text, "Top");
  // Nested objects never leak into metadata.
  assert.ok(!("replies" in units[1].meta));
});

test("a bundle carries the study, codebook and mapping hints", () => {
  const bundle = readFileSync(new URL("../examples/reddit-starter.json", import.meta.url), "utf8");
  const { parsed, units, stats } = build(bundle);
  assert.equal(parsed.study?.name, "Reddit starter example");
  assert.equal(parsed.codebook.length, 2);
  assert.equal(parsed.codebook[0].codes[0].name, "Supports");
  assert.equal(parsed.codebook[0].codes[0].inclusion, "Explicit endorsement, or reasons offered in its favour.");
  assert.deepEqual(defaultMapping(parsed).displayKeys, ["kind", "subreddit", "score", "created"]);
  assert.equal(stats.removed, 1);
  assert.equal(units.length, 9);
  // A post with empty self-text is coded on its title alone.
  assert.equal(units.find((u) => u.external_id === "t3_x1a002")!.text,
    "Where can I read the actual proposal for the Elm St bike lane?");
});

test("bundle hints that do not fit the data are ignored", () => {
  const bundle = JSON.stringify({ mapping: { textFields: ["nope"], displayKeys: ["also_nope", "b"] }, data: [{ a: "x", b: "y" }] });
  const m = defaultMapping(parseStarterFile(bundle));
  assert.deepEqual(m.textFields, []);
  assert.deepEqual(m.displayKeys, ["b"]);
});

test("malformed JSON Lines name the offending line", () => {
  assert.throws(() => parseStarterFile('{"a":1}\n{"a":\n'), (e: unknown) =>
    e instanceof StarterError && /line 2/.test(e.message));
});

test("an empty file is an error, not zero units", () => {
  assert.throws(() => parseStarterFile("   \n"), StarterError);
});

test("chunks stay under the byte budget and keep every unit", () => {
  const units = Array.from({ length: 50 }, (_, i) => ({
    external_id: `u${i}`,
    text: "x".repeat(1000),
    meta: {},
    context: [],
  }));
  const chunks = chunkUnits(units, 20_000);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.flat().length, 50);
  for (const c of chunks) assert.ok(JSON.stringify(c).length * 3 <= 20_000 + 3100);
});

test("server-side sanitising drops unusable units and coerces metadata", () => {
  assert.equal(sanitizeUnit({ external_id: "", text: "x" }), null);
  assert.equal(sanitizeUnit({ external_id: "a", text: "  " }), null);
  assert.deepEqual(
    sanitizeUnit({ external_id: "a", text: "t", meta: { n: 3, o: { x: 1 } }, context: [{ text: "c" }, 5] }),
    { external_id: "a", text: "t", meta: { n: "3" }, context: [{ label: "", text: "c" }] },
  );
});
