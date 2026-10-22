// The business audience and what came with it: plan.audience, overview rows of kind Ask (the
// decide panel and its "nothing to decide" state), the screen and lanes figure kinds, the refusals
// for a business plan, and the business-only warnings. Pages that use none of it are the bytes
// they always were.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXAMPLE, build } from "./helpers.mjs";
import { makeExampleRepo } from "./make-example-repo.mjs";
import { buildPage, linksFor, utf8Length } from "../system/page.mjs";
import { render, renderSizeBound, featuresOf, featureCss, wrapLines, FEATURES } from "../system/renderer.mjs";
import { validate, validatePlan, lint, BUSINESS_WORD_BUDGET, DEFAULT_LIMITS } from "../system/validate.mjs";
import { GUIDE_CSS, RUNTIME_JS, FEATURE_CSS } from "../system/static.generated.mjs";

const BUSINESS = join(EXAMPLE, "..", "pickup-times");
const read = (dir) => JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
const biz = () => read(BUSINESS);
const eng = () => read(EXAMPLE);
const engFiles = (spec) => new Map(Object.values(spec.assets).map((a) => [a.file, new Uint8Array(readFileSync(join(EXAMPLE, a.file)))]));
const sec = (p, id) => p.sections.find((s) => s.id === id);
const errorsOf = (spec) => validatePlan(spec).errors;
const refused = (spec, ...parts) => {
  const errs = errorsOf(spec);
  assert.ok(errs.length, "expected a refusal");
  for (const p of parts) assert.ok(errs.some((e) => e.includes(p)), `expected "${p}" in:\n${errs.join("\n")}`);
};
const clean = (spec) => assert.deepEqual(errorsOf(spec), []);
const page = (spec) => { const r = buildPage(spec, new Map()); assert.deepEqual(r.errors, []); return r.html; };

// ---------- the bytes of existing pages ----------

test("every committed example builds to its committed page, byte for byte", () => {
  for (const name of ["paste-expiry", "inbox-text-size", "pickup-times"]) {
    const dir = join(EXAMPLE, "..", name);
    const spec = read(dir);
    const files = new Map(Object.values(spec.assets || {}).map((a) => [a.file, new Uint8Array(readFileSync(join(dir, a.file)))]));
    const r = buildPage(spec, files);
    assert.deepEqual(r.errors, [], name);
    assert.ok(r.html === readFileSync(join(dir, "guided-plan.html"), "utf8"), `${name}: guided-plan.html is stale`);
  }
});

test("a page that uses nothing new carries none of features.css, and audience engineering is the default", () => {
  const spec = eng();
  const files = engFiles(spec);
  const before = buildPage(spec, files).html;
  assert.deepEqual(featuresOf(spec), []);
  for (const css of Object.values(FEATURE_CSS)) assert.ok(!before.includes(css));
  assert.ok(!/class="(aud|ask)"|fig-screen"|fig-lanes"/.test(before));
  const explicit = buildPage({ ...spec, audience: "engineering" }, files);
  assert.equal(explicit.html, before, "audience engineering draws the same bytes as no audience");
  // build.mjs reads features.css from the disk; static.generated.mjs holds the same blocks
  assert.deepEqual(featureCss(readFileSync(new URL("../system/features.css", import.meta.url), "utf8")), FEATURE_CSS);
  assert.deepEqual(Object.keys(FEATURE_CSS), FEATURES);
});

test("the business example builds the same with build.mjs, and --check confirms it", () => {
  const dir = mkdtempSync(join(tmpdir(), "guided-plan-biz-"));
  try {
    const out = join(dir, "g.html");
    const r = build(join(BUSINESS, "plan.json"), out);
    assert.equal(r.code, 0, r.out);
    assert.ok(readFileSync(out).equals(readFileSync(join(BUSINESS, "guided-plan.html"))));
    const { commit } = makeExampleRepo(join(dir, "larkspur"), { example: "pickup-times" });
    assert.equal(commit, biz().base, "the larkspur repository is not deterministic");
    const c = build("--check", join(BUSINESS, "plan.json"), "--repo", `larkspur=${join(dir, "larkspur")}`);
    assert.equal(c.code, 0, c.out);
    assert.match(c.out, /All sources, excerpts and files confirmed\./);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the business example is clean: no error, no warning, and under the word budget", () => {
  const r = validatePlan(biz());
  assert.deepEqual(r, { errors: [], warnings: [] });
});

// ---------- audience ----------

test("audience is engineering or business", () => {
  clean({ ...eng(), audience: "engineering" });
  refused({ ...biz(), audience: "Business" }, 'audience: "engineering" (the default');
  refused({ ...biz(), audience: 5 }, "audience:");
});

test("a business page says who it is for, above the title and in the meta line", () => {
  const html = page(biz());
  assert.match(html, /<header class="top">\n  <p class="aud"><b>For business stakeholders<\/b> who shape the product<\/p>\n  <h1>/);
  assert.match(html, /<p class="line">7 sections · for business stakeholders · from PLAN\.md/);
  assert.ok(html.includes(FEATURE_CSS.business));
});

test("a business plan refuses code figures anywhere, and section files, with the shape to use", () => {
  const code = { type: "code", title: "Code", cites: ["ORDER"], path: "x.js", start: 1, text: ["x"] };
  refused((() => { const p = biz(); sec(p, "work").figure = code; return p; })(), 'work: a guided plan for business stakeholders shows no code; show what a person sees with a "screen"');
  refused((() => { const p = biz(); sec(p, "work").cards = [{ id: "c", title: "C", body: ["b"], cites: ["ORDER"], figure: code }]; return p; })(), "work.c: a guided plan for business stakeholders shows no code");
  refused((() => { const p = biz(); sec(p, "customer-sees").figure.sides[0].figure = { type: "code", path: "x.js", start: 1, text: ["x"] }; return p; })(), "customer-sees.sides[0]: a guided plan for business stakeholders shows no code");
  refused((() => { const p = biz(); sec(p, "work").files = [{ name: "order.html", path: "views/order.html", repo: "larkspur" }]; return p; })(), 'work: a guided plan for business stakeholders lists no files');
  // the same plan, for engineers, may hold both
  const p = biz();
  delete p.audience;
  sec(p, "work").files = [{ name: "order.html", path: "views/order.html", repo: "larkspur" }];
  clean(p);
});

// ---------- Ask rows and the decide panel ----------

test("Ask rows: recommended only there, text that fits, and the row's cites vouch for both", () => {
  refused((() => { const p = biz(); p.overview.push({ kind: "Change", text: "x", recommended: "y", section: "work", cites: ["ORDER"] }); return p; })(), "recommended belongs to an Ask row");
  refused((() => { const p = biz(); p.overview[0].text = "How far ahead ".repeat(10) + "?"; return p; })(), "overview[0]: question");
  refused((() => { const p = biz(); p.overview[0].recommended = "Up to two days, ".repeat(5); return p; })(), "overview[0]: recommended");
  refused((() => { const p = biz(); p.overview[0].recommended = "Up to 3 days"; return p; })(), 'overview[0].recommended: the number "3"');
  refused((() => { const p = biz(); p.overview[0].recommended = "The canonical answer"; return p; })(), 'overview[0].recommended: jargon "canonical"');
  refused((() => { const p = biz(); p.overview[0].recommended = ""; return p; })(), "recommended");
  // recommended is optional
  const p = biz(); delete p.overview[0].recommended; clean(p);
});

test("Ask rows are drawn as the decide panel above the other rows, one line each", () => {
  const p = biz();
  p.overview.push({ kind: "Kept", text: "Paying at pickup stays.", section: "for-us", cites: ["PLAN-KEPT"] });
  const html = page(p);
  const panel = html.indexOf('<section class="ask"'), list = html.indexOf('<ol class="overview"');
  assert.ok(panel > html.indexOf('<p class="intent">') && panel < list, "the panel sits between the intent and the other rows");
  assert.equal((html.match(/<li><a href="#decisions" data-jump="decisions"><span class="ask-q">/g) || []).length, 2);
  assert.ok(html.includes('<span class="ask-r"><span class="sr">Recommended: </span>Up to two days</span><span class="ask-n">05</span>'));
  assert.equal((html.match(/<li class="ov /g) || []).length, 1, "only the Kept row is in the list");
  // every row an Ask: no overview list at all
  assert.ok(!page(biz()).includes('<ol class="overview"'));
});

test("nothing to decide: a business plan with no Ask row says so, and asks nothing", () => {
  const p = biz();
  p.overview = [{ kind: "Decided", text: "Customers can order for a day and an hour.", section: "customer-sees", cites: ["PLAN-CHOICE"] }];
  clean(p);
  const html = page(p);
  assert.ok(html.includes('<section class="ask" aria-labelledby="decide_h"><h2 id="decide_h">What you are asked to decide</h2><p class="ask-none">Nothing to decide. This guided plan asks you no question.</p></section>'));
  assert.ok(!html.includes('class="ask-l"'));
  assert.ok(html.includes('<ol class="overview"'));
  // an engineering plan with no Ask row has no panel at all; with one, it has the panel
  assert.ok(!page({ ...p, audience: "engineering" }).includes('class="ask"'));
  const e = eng();
  e.overview.push({ kind: "Ask", text: "Keep never as the default?", recommended: "Yes", section: "why", cites: ["ISSUE"] });
  const r = buildPage(e, engFiles(e));
  assert.deepEqual(r.errors, []);
  assert.ok(r.html.includes("<span class=\"ask-q\">Keep never as the default?</span>"));
  assert.ok(r.html.includes(FEATURE_CSS.ask) && !r.html.includes(FEATURE_CSS.business));
});

test("the panel's id can never be a section's", () => {
  const p = biz();
  sec(p, "decisions").id = "decide";
  p.overview.forEach((o) => { o.section = "decide"; });
  const html = page(p);
  assert.equal((html.match(/id="decide_h"/g) || []).length, 1);
  assert.equal((html.match(/id="decide-h"/g) || []).length, 1);
});

// ---------- screen ----------

const screenOf = (parts, extra = {}) => { const p = biz(); sec(p, "morning-text").figure = { type: "screen", title: "A screen", cites: ["PLAN-TEXT"], parts, ...extra }; return p; };

test("screen parts take what their kind takes, and nothing else", () => {
  clean(screenOf([{ as: "heading", text: "Hi" }, { as: "button", text: "A" }, { as: "button", text: "B", mark: "new" }, { as: "menu", items: ["One"], mark: "out" }, { as: "box", text: "Box", pin: true }, { as: "card", mark: "acc", parts: [{ as: "message", by: "Ann", text: "Hello" }, { as: "status", text: "Sent", mark: "changed" }] }]));
  refused(screenOf([]), "a screen needs parts");
  refused(screenOf([{ as: "slider", text: "x" }]), '"as" is heading, text, box, button, message, status, menu or card');
  refused(screenOf([{ as: "button" }]), "a button needs text");
  refused(screenOf([{ as: "menu", text: "x", items: ["a"] }]), "a menu takes no text");
  refused(screenOf([{ as: "menu" }]), "a menu needs items");
  refused(screenOf([{ as: "button", text: "x", items: ["a"] }]), '"items" belong to a menu');
  refused(screenOf([{ as: "box", text: "x", by: "Ann" }]), '"by" is the author of a message');
  refused(screenOf([{ as: "button", text: "x", pin: true }]), '"pin" is true or false, on a box');
  refused(screenOf([{ as: "button", text: "x", mark: "red" }]), 'mark is "new", "changed", "out" or "acc"');
  refused(screenOf([{ as: "box", text: "x", parts: [{ as: "text", text: "y" }] }]), '"parts" belong to a card');
  refused(screenOf([{ as: "card", parts: [] }]), "a card holds parts");
  refused(screenOf([{ as: "button", text: "A very long button label that goes on and on" }]), "keep it to 40 or fewer");
  refused(screenOf([{ as: "text", text: "x" }], { address: "x".repeat(81) }), "address");
});

test("a card holds parts one level deep: a card inside a card is refused", () => {
  refused(screenOf([{ as: "card", parts: [{ as: "card", parts: [{ as: "text", text: "x" }] }] }]), "parts[0].parts[0]: a card holds parts one level deep");
  refused(screenOf([{ as: "card", parts: [{ as: "text", text: "x", parts: [{ as: "text", text: "y" }] }] }]), 'unknown field "parts"');
});

test("a mock-up's contents may hold no digit, and are checked for jargon; its title and caption are claims as usual", () => {
  refused(screenOf([{ as: "message", by: "Ann", text: "Your order 12 is ready" }]), "may not show a digit");
  refused(screenOf([{ as: "text", text: "x" }], { address: "shop.example/order/7" }), "may not show a digit");
  refused(screenOf([{ as: "menu", items: ["Option 2"] }]), "may not show a digit");
  refused(screenOf([{ as: "button", text: "Open the door" }]), 'jargon "door"');
  refused(screenOf([{ as: "text", text: "x" }], { caption: "Sent 9 times" }), 'the number "9"');
  refused(screenOf([{ as: "button", text: "`code`" }]), "figure text is plain");
});

test("a screen is drawn as a frame: adjacent buttons share a row, marks carry words, its kind is Mock-up", () => {
  const html = page(screenOf([
    { as: "heading", text: "Order" }, { as: "button", text: "Save" }, { as: "button", text: "Send", mark: "new" }, { as: "text", text: "Between" }, { as: "button", text: "Later" },
    { as: "box", text: "Summary", pin: true }, { as: "menu", items: ["One", "Two words"], mark: "new" }, { as: "status", text: "Done", mark: "out" },
    { as: "card", parts: [{ as: "message", by: "Ann", text: "Hi", mark: "changed" }] },
  ], { address: "shop.example" }));
  assert.ok(html.includes('<span class="fig-k">Mock-up</span>'));
  assert.ok(html.includes('<span class="scr-addr">shop.example</span>'));
  assert.ok(html.includes('<div class="sp-row"><span class="sp-b">Save</span><span class="sp-b m-new">Send<span class="sr"> (new)</span></span></div><p class="sp-t">Between</p><div class="sp-row"><span class="sp-b">Later</span></div>'));
  assert.ok(html.includes('<span class="sr"> (a note is pinned here)</span>'));
  assert.ok(html.includes('<p class="sp-s m-out"><i aria-hidden="true"></i><span>Done</span><span class="sr"> (goes)</span></p>'));
  assert.ok(html.includes('<div class="sp-card"><div class="sp-m m-changed"><b>Ann</b><span>Hi</span><span class="sr"> (changes)</span></div></div>'));
  assert.ok(html.includes(FEATURE_CSS.screen));
});

test("two screens in a pair are a before and after", () => {
  const html = page(biz());
  assert.match(html, /<span class="fig-k">Before and after<\/span><span class="fig-t">The order page, today and with this plan<\/span>/);
  assert.equal((html.match(/<div class="scr">/g) || []).length, 3);
});

// ---------- lanes ----------

const lanesOf = (lanes, steps, extra = {}) => { const p = biz(); sec(p, "who-does-what").figure = { type: "lanes", title: "Who", cites: ["PLAN-BOARD"], lanes, steps, ...extra }; return p; };

test("lanes: 2 to 5 lanes, 2 to 12 steps, each step in a lane that exists", () => {
  const two = [{ lane: 0, text: "Orders" }, { lane: 1, text: "Sees it" }];
  clean(lanesOf(["Customer", "Counter"], two));
  refused(lanesOf(["Customer"], two), "lanes needs 2 to 5 lanes");
  refused(lanesOf(["A", "B", "C", "D", "E", "F"], two), "lanes needs 2 to 5 lanes");
  refused(lanesOf(["A", "B"], [{ lane: 0, text: "x" }]), "lanes needs 2 to 12 steps");
  refused(lanesOf(["A", "B"], Array.from({ length: 13 }, (_, i) => ({ lane: i % 2, text: "x" }))), "lanes needs 2 to 12 steps");
  refused(lanesOf(["A", "B"], [{ lane: 0, text: "x" }, { lane: 2, text: "y" }]), "steps[1]: lane is the index of its lane, 0 to 1");
  refused(lanesOf(["A", "B"], [{ lane: 0, text: "x" }, { lane: -1, text: "y" }]), "steps[1]: lane is the index");
  refused(lanesOf(["A", "B"], [{ lane: 0, text: "x" }, { lane: 0.5, text: "y" }]), "lane");
  refused(lanesOf(["A", "B"], [{ lane: 0, text: "x" }, { lane: 1, text: "y", mark: "gone" }]), 'mark is "acc" or "new"');
  refused(lanesOf(["A", "B"], [{ lane: 0, text: "x" }, { lane: 1, text: "y".repeat(61) }]), "keep it to 60 or fewer");
  refused(lanesOf(["A".repeat(41), "B"], two), "keep it to 40 or fewer");
  refused(lanesOf(["A", "B"], [{ lane: 0, text: "x" }, { lane: 1, text: "y", by: "z" }]), 'unknown field "by"');
});

test("lane labels and steps are linted with the figure's cites", () => {
  refused(lanesOf(["The counter seam", "Baker"], [{ lane: 0, text: "x" }, { lane: 1, text: "y" }]), 'jargon "seam"');
  refused(lanesOf(["A", "B"], [{ lane: 0, text: "Takes 7 orders" }, { lane: 1, text: "y" }]), 'the number "7"');
  clean(lanesOf(["A", "B"], [{ lane: 0, text: "Takes 41 orders" }, { lane: 1, text: "y" }], { cites: ["WHY"] }));
});

test("lanes are drawn on one grid: equal boxes, connectors from bottom centre to top centre, the arrow tip on the edge", () => {
  const p = biz();
  const fig = sec(p, "who-does-what").figure;
  const html = page(p);
  for (const cls of ["lanes-w", "lanes-n"]) {
    const svg = html.match(new RegExp(`<svg class="${cls}"[\\s\\S]*?</svg>`))[0];
    const boxes = [...svg.matchAll(/<rect class="ln-box[^"]*" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map((m) => m.slice(1).map(Number));
    assert.equal(boxes.length, fig.steps.length);
    assert.equal(new Set(boxes.map((b) => b[2])).size, 1, "every box the same width");
    assert.equal(new Set(boxes.map((b) => b[3])).size, 1, "every box the same height");
    const lanesX = [...new Set(boxes.map((b) => b[0]))];
    assert.equal(lanesX.length, new Set(fig.steps.map((s) => s.lane)).size, "a box per lane column, one x per lane");
    const arrows = [...svg.matchAll(/<path class="ln-a" d="M([\d.]+) ([\d.]+) /g)].map((m) => [Number(m[1]), Number(m[2])]);
    const starts = [...svg.matchAll(/<path class="ln-c" d="M([\d.]+) ([\d.]+) /g)].map((m) => [Number(m[1]), Number(m[2])]);
    assert.equal(arrows.length, fig.steps.length - 1);
    for (let i = 0; i + 1 < boxes.length; i++) {
      const [x, y, w, h] = boxes[i], [nx, ny, nw] = boxes[i + 1];
      assert.deepEqual(starts[i], [Math.round((x + w / 2) * 10) / 10, Math.round((y + h) * 10) / 10], `connector ${i} leaves the bottom centre`);
      assert.deepEqual(arrows[i], [Math.round((nx + nw / 2) * 10) / 10, ny], `arrow ${i} tip on the next box's top centre`);
    }
    assert.ok(!/NaN|undefined|Infinity/.test(svg));
  }
  // a screen reader gets the steps in order, "lane: step"
  assert.ok(html.includes('<ol class="sr"><li>Customer: Orders and picks a pickup time<span class="sr"> (new)</span></li><li>Counter: Sees it on the board by pickup time<span class="sr"> (highlighted)</span></li>'));
  assert.ok(html.includes('<span class="fig-k">Who does what</span>'));
});

test("wrapped lines balance, and a word wider than the box is cut, so text stays inside", () => {
  assert.deepEqual(wrapLines("Orders and picks a pickup time", 12, 60), ["Orders", "and", "picks a", "pickup", "time"]);
  for (const t of ["Bakes from the morning list, grouped by hour", "Supercalifragilisticexpialidocious and more", "a", ""]) {
    for (const [fs, w] of [[13, 170], [12, 60], [11.5, 30]]) {
      const lines = wrapLines(t, fs, w);
      const per = Math.max(1, Math.floor(w / (fs * 0.56)));
      for (const l of lines) assert.ok(l.length <= per, `${JSON.stringify(l)} fits ${per}`);
      assert.equal(lines.join(" ").replace(/\s+/g, ""), t.replace(/\s+/g, ""), "no character is lost");
    }
  }
  // balanced: two lines of similar length rather than a long line and a stub
  const [a, b] = wrapLines("Accepts the fix, or not", 13, 120);
  assert.ok(Math.abs(a.length - b.length) <= 6, `${a} / ${b}`);
});

// ---------- the renderer on its own, with hostile values ----------

const X = `"><script>alert(1)</script><img src=x onerror=alert(2)>'`;
test("screen, lanes and the panel come out escaped and finite for hostile values", () => {
  const spec = {
    format: "guided-plan/2", audience: "business", title: X, intent: X, base: X, sources: {},
    overview: [{ kind: "Ask", text: X, recommended: X, section: X, cites: [] }, { kind: "Ask", text: "q", section: "constructor" }],
    sections: [{
      id: "s", title: X, heading: X, lead: X, cites: [],
      figure: { type: "lanes", title: X, caption: X, lanes: [X, "constructor", 5, null], steps: [{ lane: X, text: X, mark: "__proto__" }, { lane: "1e400", text: X, mark: "new" }, { lane: -3, text: null }, null, { lane: 99, text: X.repeat(30) }] },
      cards: [
        { id: "a", title: X, body: [X], cites: [], figure: { type: "screen", title: X, address: X, parts: [
          { as: "button", text: X, mark: "constructor" }, { as: X, text: X }, null, 5, { as: "menu", items: [X, null] }, { as: "box", text: X, pin: X },
          { as: "card", mark: X, parts: [{ as: "card", parts: [{ as: "text", text: "DEEP" }] }, { as: "message", by: X, text: X }] },
        ] } },
        { id: "b", title: "b", body: ["b"], cites: [], figure: { type: "lanes", title: "t", lanes: [], steps: [{ lane: 0, text: "only" }] } },
      ],
    }],
  };
  const html = render(spec, { css: "", runtime: "/*r*/", features: FEATURE_CSS });
  assert.equal((html.match(/<script/g) || []).length, 2, "only the page's own scripts");
  assert.ok(!/<img src=x/.test(html));
  assert.ok(!html.includes("DEEP"), "a card's card is not drawn");
  for (const m of html.matchAll(/ (?:x|y|width|height|x1|x2|y1|y2)="([^"]*)"/g)) assert.ok(Number.isFinite(Number(m[1])), `coordinate ${m[1]}`);
  for (const m of html.matchAll(/ d="([^"]*)"/g)) assert.match(m[1], /^[MVHQLZ\d. -]+$/, `path ${m[1]}`);
  for (const m of html.matchAll(/class="([^"]*)"/g)) assert.ok(!/[<>]|function|native code/.test(m[1]), `class ${m[1]}`);
  assert.ok(!/function Object|native code|\[object/.test(html));
  const bound = renderSizeBound(spec, { css: "", runtime: "/*r*/", features: FEATURE_CSS });
  assert.ok(bound >= utf8Length(html), `bound ${bound} < page ${utf8Length(html)}`);
});

test("the size bound is never below the page drawn, for hostile text in every field of the business example", () => {
  const pieces = ["&", "<", ">", '"', "'", "`", ".", "-", "_", "/", "\t", " ", "a", "é", "€", "😀", "x.y", "`code`", "Supercalifragilistic"];
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const hostile = () => Array.from({ length: Math.floor(rand() * 40) }, () => pieces[Math.floor(rand() * pieces.length)]).join("");
  for (let t = 0; t < 60; t++) {
    const spec = biz();
    const p = rand();
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === "string" && rand() < p) v[i] = hostile() + x + hostile(); else walk(x); });
      else if (v && typeof v === "object") for (const k of Object.keys(v)) { if (["type", "as", "kind", "mark", "section"].includes(k)) continue; if (typeof v[k] === "string" && rand() < p) v[k] = hostile() + v[k] + hostile(); else walk(v[k]); }
    };
    walk(spec.sections); walk(spec.overview); walk(spec.sources);
    const links = linksFor(spec);
    const html = render(spec, { css: GUIDE_CSS, runtime: RUNTIME_JS, links, features: FEATURE_CSS });
    const bound = renderSizeBound(spec, { css: GUIDE_CSS, runtime: RUNTIME_JS, links, features: FEATURE_CSS });
    assert.ok(bound >= utf8Length(html), `#${t}: bound ${bound} < page ${utf8Length(html)}`);
  }
});

test("the same business plan gives the same bytes", () => {
  const a = page(biz()), b = page(biz());
  assert.equal(a, b);
});

// ---------- bounds ----------

test("screen parts and menu items have limits a host can change", () => {
  const many = Array.from({ length: DEFAULT_LIMITS.maxScreenParts + 1 }, () => ({ as: "text", text: "x" }));
  refused(screenOf(many), `parts: ${DEFAULT_LIMITS.maxScreenParts + 1} items; keep it to ${DEFAULT_LIMITS.maxScreenParts} or fewer`);
  refused(screenOf([{ as: "card", parts: many }]), "parts[0].parts:");
  refused(screenOf([{ as: "menu", items: Array.from({ length: DEFAULT_LIMITS.maxMenuItems + 1 }, () => "x") }]), `keep it to ${DEFAULT_LIMITS.maxMenuItems} or fewer`);
  const r = buildPage(screenOf([{ as: "text", text: "x" }, { as: "text", text: "y" }]), new Map(), { limits: { maxScreenParts: 1 } });
  assert.match(r.errors[0], /keep it to 1 or fewer/);
});

test("parts nested thousands deep are refused quickly, never a stack overflow", () => {
  let part = { as: "text", text: "x" };
  for (let i = 0; i < 20000; i++) part = { as: "card", parts: [part] };
  const spec = screenOf([part]);
  const t = Date.now();
  let r;
  assert.doesNotThrow(() => { r = buildPage(spec, new Map()); });
  assert.equal(r.html, null);
  assert.ok(r.errors.some((e) => e.includes("one level deep") || e.includes('unknown field "parts"')), r.errors.join("\n"));
  assert.ok(Date.now() - t < 2000);
});

// ---------- business-only warnings ----------

test("do not strengthen: never, only and always must come from a cited quote", () => {
  const p = biz();
  sec(p, "morning-text").lead = "The customer only gets one text, and it is never late.";
  const w = lint(p).warnings;
  assert.ok(w.some((x) => x.startsWith('morning-text.lead: "only" is not in any quote this text cites')), w.join("\n"));
  assert.ok(w.some((x) => x.startsWith('morning-text.lead: "never" is not in any quote')), w.join("\n"));
  // in a quote it vouches: the plan says "Orders for now work exactly as today", not "only"
  const q = biz();
  q.sources["PLAN-TEXT"].quote.push("We only send the morning text once.");
  sec(q, "morning-text").lead = "We only send the morning text once.";
  assert.ok(!lint(q).warnings.some((x) => x.includes('"only"')));
  // an engineering plan is not checked this way
  assert.deepEqual(lint({ ...p, audience: "engineering" }).warnings, []);
  // nor is a mock-up's invented content
  assert.deepEqual(lint(screenOf([{ as: "text", text: "Only today" }])).warnings, []);
});

test("a business page over the word budget is warned, figures and captions counted", () => {
  const p = biz();
  sec(p, "for-us").figure.caption = "plain words ".repeat(BUSINESS_WORD_BUDGET / 2);
  const w = lint(p).warnings;
  assert.ok(w.some((x) => /^the page holds \d+ words of text \(figures, captions and cards included\); a guided plan for business stakeholders reads best under 1200/.test(x)), w.join("\n"));
  assert.ok(!lint({ ...p, audience: "engineering" }).warnings.some((x) => x.startsWith("the page holds")));
});

test("SKILL.md teaches the business section with the numbers and words the build uses", () => {
  const md = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
  const section = md.split("## 3. For business stakeholders")[1].split("\n## 4.")[0];
  assert.ok(section.includes(`under ${BUSINESS_WORD_BUDGET.toLocaleString("en-US")} words`), "the word budget");
  const html = page((() => { const p = biz(); p.overview = [{ kind: "Decided", text: "Customers can order for a day and an hour.", section: "customer-sees", cites: ["PLAN-CHOICE"] }]; return p; })());
  const none = html.match(/<p class="ask-none">([^<]*)<\/p>/)[1];
  assert.ok(section.includes(`"${none}"`), "the nothing-to-decide words");
  for (const rule of ["Show what changes", "Nothing to decide", "is a `lanes` figure", "Do not strengthen", "Define each technical term once", "No code", "Money is who pays for what", ":::question"]) assert.ok(section.includes(rule), rule);
});
