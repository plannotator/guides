import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { lintWith, section, scratch, build } from "./helpers.mjs";

const refused = (edit, ...parts) => {
  const r = lintWith(edit);
  assert.equal(r.code, 2, `expected a refusal, got:\n${r.out}`);
  for (const p of parts) assert.ok(r.out.includes(p), `expected "${p}" in:\n${r.out}`);
};

test("the worked example is clean", () => {
  const r = lintWith();
  assert.equal(r.code, 0, r.out);
});

test("a guided-plan/1 file is refused with the fields it needs now", () => {
  refused((p) => { p.format = "guided-plan/1"; }, "guided-plan/1", '"heading"', '"lead"', '"cards"', '"pair"');
});

test("a section that still has parts is refused, not drawn wrong", () => {
  refused((p) => { section(p, "why").parts = [{ id: "a", title: "A", body: ["x"], cites: ["ISSUE"] }]; }, 'why: "parts" are gone', '"heading"');
});

test("heading, lead and cites are required", () => {
  refused((p) => { delete section(p, "why").heading; }, "why: heading required");
  refused((p) => { delete section(p, "why").lead; }, "why: lead required");
  refused((p) => { section(p, "why").cites = []; }, "why: no cites");
});

test("a heading is a few words", () => {
  refused((p) => { section(p, "why").heading = "Every paste that anyone ever saved is kept forever"; }, "is 9 words");
});

test("a lead is one paragraph", () => {
  refused((p) => { section(p, "why").lead = ["One.", "Two."]; }, "lead is one paragraph");
});

test("toggle, steps, drawing, controls and rules are gone", () => {
  refused((p) => { section(p, "why").figure = { type: "toggle", title: "T", cites: ["ISSUE"], states: [] }; }, "toggle is gone", '"pair"');
  refused((p) => { section(p, "why").figure = { type: "drawing", title: "T", cites: ["ISSUE"], rows: [] }; }, "drawing is gone", '"flow"');
  refused((p) => { section(p, "kept").figure.controls = [{ key: "v", label: "V", options: [] }]; }, "no controls or rules");
});

test("each figure kind checks its own shape", () => {
  refused((p) => { section(p, "server").figure.rows[0] = ["GET", "/"]; }, "a row is a list of 4 cells");
  refused((p) => { section(p, "server").figure.columns = ["Only"]; }, "2 to 5 columns");
  refused((p) => { section(p, "server").cards[1].figure.bands[0].to = 9; }, "a band needs label, and from and to");
  refused((p) => { section(p, "where").cards[0].figure.steps[0].via = "in"; }, "the first step has none");
  refused((p) => { section(p, "where").cards[0].figure.steps = [{ label: "one" }]; }, "flow needs 2 to 6 steps");
  refused((p) => { section(p, "where").figure.rows[0].label = "A label much longer than a layer holds"; }, "keep it to 24 or fewer");
  refused((p) => { const f = section(p, "form").figure; f.sides[0].figure = { type: "pair", sides: [] }; }, "not another pair");
  refused((p) => { section(p, "form").figure.sides = [section(p, "form").figure.sides[0]]; }, "pair needs 2 to 4 sides");
  refused((p) => { section(p, "why").figure.asset = "nope"; }, "unknown asset nope");
  refused((p) => { section(p, "kept").cards[0].figure.chips[0].mark = "red"; }, 'mark is "out", "changed", "new" or "acc"');
});

test("cards: ids, bodies, cites and file links", () => {
  refused((p) => { section(p, "why").cards[1].id = "table"; }, "card id is unique");
  refused((p) => { section(p, "why").cards[0].body = []; }, "body is a list of 1 to 3 paragraphs");
  refused((p) => { section(p, "why").cards[0].cites = ["NOPE"]; }, "unknown source NOPE");
  refused((p) => { section(p, "form").files[1].card = "nope"; }, "unknown card nope");
  refused((p) => { const f = section(p, "form").files[1]; delete f.card; f.part = "markup"; }, '"card"');
  refused((p) => { delete section(p, "why").cards[1].figure; section(p, "why").cards[1].fold = true; }, "fold folds the card's figure");
});

test("the section shown in SKILL.md is valid and passes the lint", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const md = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../SKILL.md"), "utf8");
  const block = md.split("## 6. A worked example")[1].match(/```json\n([\s\S]*?)\n```/)[1];
  const shown = JSON.parse(block);
  const r = lintWith((p) => { p.sections = p.sections.map((s) => (s.id === shown.id ? shown : s)); });
  assert.equal(r.code, 0, r.out);
});

test("commit names are hashes, so --check never hands git an option", () => {
  const r = lintWith((p) => { const c = section(p, "server").cards.find((x) => x.figure && x.figure.type === "code"); c.figure.at = "--output=x"; });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /at is a commit hash/);
  const f = lintWith((p) => { section(p, "server").files[0].at = "--textconv"; });
  assert.equal(f.code, 2, f.out);
  assert.match(f.out, /at is a commit hash/);
});

test("files the build reads stay inside the folder of the content file", () => {
  for (const edit of [
    (p) => { for (const a of Object.values(p.assets)) a.file = "../outside.png"; },
    (p) => { p.sources.ISSUE.path = "../../etc/hosts"; },
    (p) => { section(p, "why").files = [{ name: "x", path: "/etc/hosts" }]; },
  ]) {
    const r = lintWith(edit);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /inside the folder of the content file/);
  }
});

test("an asset that names a folder is an error, not a crash", () => {
  for (const folder of ["assets", "."]) {
    const edit = (p) => { for (const a of Object.values(p.assets)) a.file = folder; };
    refused(edit, `${folder} is a folder; name an image file inside it`);
    const s = scratch(edit);
    try {
      const r = build(s.plan, join(s.dir, "out.html"));
      assert.equal(r.code, 2, r.out);
      assert.ok(r.out.includes("is a folder") && !r.out.includes("EISDIR"), r.out);
    } finally { s.done(); }
  }
});

test("an asset that is not a PNG or JPEG is an error from --lint too", () => {
  refused((p) => { for (const a of Object.values(p.assets)) a.file = "PLAN.md"; }, "PLAN.md: not a PNG or JPEG");
});

test("unknown fields are errors, with the field named", () => {
  refused((p) => { section(p, "why").cards[1].figure.rows[3].tagacc = true; }, 'why.ask.figure.rows[3]: unknown field "tagacc"; did you mean "tagAcc"?');
  refused((p) => { p.titel = "x"; }, 'unknown field "titel"');
  refused((p) => { section(p, "why").leed = "x"; }, 'unknown field "leed"');
  refused((p) => { p.sources.ISSUE.quotes = ["x"]; }, 'sources.ISSUE: unknown field "quotes"');
});

test("a chip may say acc", () => {
  const r = lintWith((p) => { section(p, "kept").cards[0].figure.chips[4].acc = true; });
  assert.equal(r.code, 0, r.out);
});

test("ids the page uses itself, and ids that collide, are refused", () => {
  refused((p) => { section(p, "open").id = "theme"; p.overview.at(-1).section = "theme"; }, '"theme" is reserved');
  for (const id of ["h", "f", "read"]) refused((p) => { section(p, "why").cards[0].id = id; }, `card id "${id}" is reserved`);
  // section "why-table" would share its id with card "table" of section "why"
  refused((p) => { section(p, "kept").id = "why-table"; p.overview.find((o) => o.section === "kept").section = "why-table"; }, 'page id "why-table" is already used');
});

test("keys every object already has are refused as source, asset or repo names", () => {
  refused((p) => { p.assets.constructor = { file: "assets/new-paste.png" }; }, "assets.constructor: a key is");
  refused((p) => { p.repos.prototype = { path: "." }; }, "repos.prototype: a key is");
  refused((p) => { p.sources.toString = { kind: "file", path: "PLAN.md", quote: "Plan" }; }, "sources.toString: a key is");
  // and a figure that names one finds nothing
  refused((p) => { section(p, "why").figure.asset = "constructor"; }, "unknown asset constructor");
});

test("the JSON Schema file is generated from the same field table", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { jsonSchema } = await import("../system/schema.mjs");
  const file = join(dirname(fileURLToPath(import.meta.url)), "../system/guided-plan.schema.json");
  assert.equal(readFileSync(file, "utf8"), JSON.stringify(jsonSchema(), null, 2) + "\n", "guided-plan.schema.json is stale; run: node skills/guided-plan/system/schema.mjs > skills/guided-plan/system/guided-plan.schema.json");
});
