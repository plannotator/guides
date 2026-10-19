import { test } from "node:test";
import assert from "node:assert/strict";
import { lintWith, section } from "./helpers.mjs";

const refused = (edit, ...parts) => {
  const r = lintWith(edit);
  assert.equal(r.code, 2, `expected a refusal, got:\n${r.out}`);
  for (const p of parts) assert.ok(r.out.includes(p), `expected "${p}" in:\n${r.out}`);
};
const clean = (edit) => { const r = lintWith(edit); assert.equal(r.code, 0, r.out); };

test("jargon is refused in every new text field", () => {
  refused((p) => { section(p, "why").heading = "The storage seam"; }, "why.heading: jargon \"seam\"");
  refused((p) => { section(p, "why").lead += " The spec says so."; }, "why.lead: jargon \"spec\"");
  refused((p) => { section(p, "why").question = "Is this canonical?"; }, "why.question: jargon \"canonical\"");
  refused((p) => { section(p, "why").cards[0].body[0] += " It is a stub."; }, "why.table.body[0]: jargon \"stub\"");
  refused((p) => { section(p, "where").cards[0].figure.steps[2].sub = "the storage lane"; }, "where.path.step: jargon \"lane\"");
  refused((p) => { section(p, "server").figure.rows[0][2] = "the front door"; }, "server.cell: jargon \"door\"");
  refused((p) => { section(p, "form").figure.sides[0].caption = "Per the ruling."; }, "form.side.caption: jargon \"ruling\"");
  refused((p) => { section(p, "where").figure.rows[3].text = "Runs a census."; }, "where.layer: jargon \"census\"");
});

test("code and mono text are not prose", () => {
  clean((p) => { section(p, "why").lead += " It reads `spec_prefix`."; });
  clean((p) => { section(p, "kept").figure.rows[1].text = "DELETE /spec/:id"; });
});

test("a number must sit in a quote the text cites", () => {
  refused((p) => { section(p, "why").lead = "The disk is 95% full."; }, 'why.lead: the number "95"');
  refused((p) => { section(p, "where").cards[0].figure.steps[3].sub = "answers 418"; }, 'the number "418"');
  refused((p) => { section(p, "form").figure.sides[1].caption = "Seven choices now."; }, 'the number "seven"');
  // a card's text leans on the card's own cites, not the section's
  refused((p) => { section(p, "why").cards[0].body = ["The disk is 90% full."]; }, 'why.table.body[0]: the number "90"');
  clean((p) => { section(p, "why").cards[0].cites.push("ISSUE"); section(p, "why").cards[0].body = ["The disk is 90% full."]; });
});

test("a heading may hold a number word; a label may not hold a digit", () => {
  clean((p) => { section(p, "why").heading = "Two ways a paste is kept"; });
  refused((p) => { section(p, "why").title = "Why 90 pastes"; }, "a section label cites nothing");
});

test("an illustration shows no digits", () => {
  refused((p) => { const f = section(p, "form").figure; f.sides[1].toy = true; }, "may not show a digit");
  refused((p) => { section(p, "kept").figure.toy = true; section(p, "kept").figure.rows[0].note = "kept 3 days"; }, "may not show a digit");
});

test("figure text is plain", () => {
  refused((p) => { section(p, "server").figure.caption = "The `410` answer."; }, "figure text is plain");
});

test("no dash standing in for a comma", () => {
  refused((p) => { section(p, "why").heading = "Kept forever — sadly"; }, "a dash standing in for a comma");
});
