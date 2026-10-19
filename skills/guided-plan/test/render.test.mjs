// render() on its own, as a host that skips build.mjs might call it: hostile strings and numbers
// must come out escaped or coerced, never as markup, script, styles or links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../system/renderer.mjs";

const X = `"><script>alert(1)</script><img src=x onerror=alert(2)>'`;
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const RUNTIME = "/*runtime*/";

function hostile() {
  const fig = (o) => ({ title: X, caption: X, cites: [X], ...o });
  return {
    format: "guided-plan/2", title: X, intent: X, intentCites: ["S", "constructor", X], base: X, model: X, plan: { name: X },
    sources: { S: { kind: "git", path: X, lines: X, label: X, quote: [X], at: X } },
    overview: [{ kind: X, text: X, section: X, cites: [X] }, { kind: "Open", text: "ok", section: "constructor", cites: [] }],
    sections: [{
      id: X, title: X, heading: X, question: X, lead: X, cites: ["S"],
      figure: fig({ type: "timeline", stops: [{ label: X, sub: X, mark: X, mono: true }, { label: "b", mark: "ask" }], bands: [{ from: X, to: `1;}</style><script>alert(3)</script>`, label: X, acc: true }] }),
      cards: [
        { id: X, title: X, body: [X], cites: [], figure: fig({ type: "screenshot", asset: "a", ring: [X, "1e400", -5, `2"><b id=pwn>`], scale: X, alt: X }) },
        { id: "k", title: X, body: [X], cites: [], fold: true, figure: fig({ type: "code", path: X, start: `3"><i id=pwn>`, text: [X, X], marked: [X, 1], mark: X, at: X }) },
        { id: "t", title: X, body: [X], cites: [], figure: fig({ type: "table", columns: [X, { label: X, mono: true, fill: true }], rows: [[X, { text: X, acc: true }], [X]] }) },
        { id: "c", title: X, body: [X], cites: [], figure: fig({ type: "chips", chips: [{ text: X, mark: "constructor" }, { text: X, mark: X }], legend: [{ mark: "changed", text: X }] }) },
        { id: "f", title: X, body: [X], cites: [], figure: fig({ type: "flow", steps: [{ label: X, mark: "toString" }, { label: X, via: X, mark: "new" }] }) },
        { id: "l", title: X, body: [X], cites: [], figure: fig({ type: "layers", rows: [{ label: X, sub: X, text: X, items: [X, { text: X, mark: X }], tag: X, tagAcc: true }] }) },
        { id: "p", title: X, body: [X], cites: [], figure: fig({ type: "pair", sides: [{ label: X, note: X, acc: true, figure: { type: "list", rows: [{ text: X, mark: "__proto__", tag: X }] }, caption: X }, { label: X, figure: { type: "pair", sides: [] } }] }) },
      ],
      files: [{ name: X, note: X, path: X, tag: X, card: X }, { name: "b", path: "p" }],
    }],
  };
}

function page(spec, links) {
  return render(spec, { css: "", runtime: RUNTIME, assets: { a: { w: X, h: "NaN", uri: PNG } }, links });
}

test("hostile strings and numbers come out as text, never markup", () => {
  const html = page(hostile(), { source: () => "javascript:alert(4)", file: () => `https://ok.example/"><script>` });
  // the only scripts are the page's own two
  assert.equal((html.match(/<script/g) || []).length, 2);
  assert.ok(html.includes(`<script>\n${RUNTIME}\n</script>`));
  assert.ok(!/<img src=x/.test(html), "an injected tag got through");
  assert.ok(!/onerror=/.test(html.replace(/&lt;img src=x onerror=alert\(2\)&gt;/g, "")), "an injected attribute got through");
  assert.ok(!/<\/style><script>/.test(html));
  assert.ok(!html.includes("id=pwn"), "a number field carried markup");
  // links: no javascript:, and a link with markup in it is dropped
  assert.ok(!/href="javascript:/i.test(html));
  assert.ok(!/href="https:\/\/ok\.example/.test(html));
  // numbers are numbers
  for (const m of html.matchAll(/--b1:([^;"]*);--b2:([^;"]*)/g)) { assert.match(m[1], /^\d+$/); assert.match(m[2], /^\d+$/); }
  for (const m of html.matchAll(/<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"/g)) for (const v of m.slice(1)) assert.ok(Number.isFinite(Number(v)), `ring value ${v}`);
  for (const m of html.matchAll(/max-width:([^p;"]*)px/g)) assert.ok(Number.isFinite(Number(m[1])));
  for (const m of html.matchAll(/<span class="no">([^<]*)<\/span>/g)) assert.match(m[1], /^\d+$/);
  for (const m of html.matchAll(/class="([^"]*)"/g)) assert.ok(!/[<>]|function|native code/.test(m[1]), `class ${m[1]}`);
  for (const m of html.matchAll(/data-sec="([^"]*)"/g)) assert.match(m[1], /^\d+$/);
});

test("a key every object has never reaches the page", () => {
  const html = page(hostile());
  assert.ok(!/function Object|native code|\[object/.test(html));
});

test("an asset that is not an embedded PNG or JPEG is refused", () => {
  const spec = hostile();
  assert.throws(() => render(spec, { css: "", runtime: "", assets: { a: { w: 1, h: 1, uri: "javascript:alert(1)" } } }), /unknown asset/);
  assert.throws(() => render(spec, { css: "", runtime: "", assets: {} }), /unknown asset/);
});

test("marks that are colour or line style also carry words for a screen reader", () => {
  const spec = hostile();
  const html = page(spec);
  for (const w of ["(added)", "(highlighted)", "(open question)"]) assert.ok(html.includes(w), w);
  assert.ok(html.includes(`<span class="sr">marked: </span>`) || html.includes(`<span class="sr">removed: </span>`));
});
