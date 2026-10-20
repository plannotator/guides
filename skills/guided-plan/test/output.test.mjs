import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, scratch, EXAMPLE } from "./helpers.mjs";
import { makeExampleRepo } from "./make-example-repo.mjs";
import { cardWidths } from "../system/renderer.mjs";

test("the same input gives the same bytes, and the committed example is current", () => {
  const s = scratch();
  try {
    const a = join(s.dir, "a.html"), b = join(s.dir, "b.html");
    assert.equal(build(s.plan, a).code, 0);
    assert.equal(build(s.plan, b).code, 0);
    const ha = readFileSync(a), hb = readFileSync(b);
    assert.ok(ha.equals(hb), "two builds differ");
    assert.ok(ha.equals(readFileSync(join(EXAMPLE, "guided-plan.html"))), "examples/paste-expiry/guided-plan.html is stale; rebuild it");
  } finally { s.done(); }
});

test("the real-world example is current too", () => {
  const ex = join(EXAMPLE, "..", "inbox-text-size");
  const dir = mkdtempSync(join(tmpdir(), "guided-plan-out-"));
  try {
    const out = join(dir, "g.html");
    const r = build(join(ex, "plan.json"), out);
    assert.equal(r.code, 0, r.out);
    assert.ok(readFileSync(out).equals(readFileSync(join(ex, "guided-plan.html"))), "examples/inbox-text-size/guided-plan.html is stale; rebuild it");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the page has the shape: top rows, one card per section, a sticky story, a figure and cards", () => {
  const html = readFileSync(join(EXAMPLE, "guided-plan.html"), "utf8");
  const plan = JSON.parse(readFileSync(join(EXAMPLE, "plan.json"), "utf8"));
  assert.equal((html.match(/<section class="card"/g) || []).length, plan.sections.length);
  assert.equal((html.match(/<li class="ov ov-/g) || []).length, plan.overview.length);
  assert.equal((html.match(/class="left-in"/g) || []).length, plan.sections.length);
  for (const s of plan.sections) {
    assert.ok(html.includes(`id="${s.id}-f"`), `main figure of ${s.id}`);
    for (const c of s.cards || []) assert.ok(html.includes(`id="${s.id}-${c.id}"`), `card ${s.id}.${c.id}`);
  }
  // no lettered parts, no Read box, nothing to toggle
  assert.ok(!/class="part|role="checkbox"|data-rules|seg-b/.test(html));
  // no network: nothing loads from elsewhere
  assert.ok(!/(src|href)="https?:/.test(html));
});

test("a narrow card never sits alone in its row", () => {
  const list = { type: "list" }, code = { type: "code" };
  assert.deepEqual(cardWidths([{ figure: list }]), [true]);
  assert.deepEqual(cardWidths([{ figure: list }, { figure: list }]), [false, false]);
  assert.deepEqual(cardWidths([{ figure: list }, { figure: code }, { figure: list }]), [true, true, true]);
  assert.deepEqual(cardWidths([{ figure: list }, { figure: list }, { figure: list }]), [false, false, true]);
  assert.deepEqual(cardWidths([{ figure: list, wide: false }]), [false]);
});

test("--check confirms every citation of the example at its commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "guided-plan-repo-"));
  try {
    const { commit } = makeExampleRepo(join(dir, "pastebox"));
    assert.equal(commit, JSON.parse(readFileSync(join(EXAMPLE, "plan.json"), "utf8")).base, "the example repository is not deterministic");
    const r = build("--check", join(EXAMPLE, "plan.json"), "--repo", `pastebox=${join(dir, "pastebox")}`);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /All sources, excerpts and files confirmed\./);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--check fails a quote that is not in its lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "guided-plan-repo-"));
  const s = scratch((p) => { p.sources.SCHEMA.quote = ["expires_at INTEGER"]; });
  try {
    makeExampleRepo(join(dir, "pastebox"));
    const r = build("--check", s.plan, "--repo", `pastebox=${join(dir, "pastebox")}`);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAIL {2}SCHEMA .* missing: "expires_at INTEGER"/);
  } finally { s.done(); rmSync(dir, { recursive: true, force: true }); }
});
