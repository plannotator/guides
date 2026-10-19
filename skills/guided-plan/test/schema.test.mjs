import { test } from "node:test";
import assert from "node:assert/strict";
import { lintWith, section } from "./helpers.mjs";

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
