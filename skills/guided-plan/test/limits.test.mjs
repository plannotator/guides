// buildPage on untrusted input: every limit holds, is reported as an error before the work it
// guards, and can be changed by the host. A plan at every limit still builds in about a second.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLE } from "./helpers.mjs";
import { buildPage, imageSize, base64, utf8Length, linksFor, DEFAULT_LIMITS } from "../system/page.mjs";
import { render, renderSizeBound } from "../system/renderer.mjs";
import { GUIDE_CSS, RUNTIME_JS } from "../system/static.generated.mjs";
import { limitErrors, unknownFields, limitsOf } from "../system/schema.mjs";
import { validate, validatePlan, lint } from "../system/validate.mjs";

const plan = () => JSON.parse(readFileSync(join(EXAMPLE, "plan.json"), "utf8"));
const exampleFiles = (spec) => new Map(Object.values(spec.assets).map((a) => [a.file, new Uint8Array(readFileSync(join(EXAMPLE, a.file)))]));

// A PNG header for w x h, padded to n bytes.
function png(w, h, n = 64) {
  const b = new Uint8Array(Math.max(n, 24));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
// A JPEG: SOI, the given segments, then the frame header for w x h, with marker `sof`.
function jpeg(w, h, { sof = 0xc0, before = [] } = {}) {
  return new Uint8Array([0xff, 0xd8, ...before, 0xff, sof, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}

test("DEFAULT_LIMITS is frozen, and every limit can be changed per call", () => {
  assert.ok(Object.isFrozen(DEFAULT_LIMITS));
  const spec = plan();
  const files = exampleFiles(spec);
  assert.deepEqual(buildPage(spec, files).errors, []);
  const asset = Object.values(spec.assets)[0].file;
  assert.match(buildPage(spec, files, { limits: { maxImageBytes: 100 } }).errors[0], /keep a screenshot to 100 or fewer/);
  assert.match(buildPage(spec, files, { limits: { maxImageBytesTotal: 100 } }).errors[0], /keep them to 100 or fewer/);
  assert.match(buildPage(spec, files, { limits: { maxHtmlBytes: 10000 } }).errors[0], /keep the page to 10000 or fewer/);
  assert.match(buildPage(spec, files, { limits: { maxHtmlBytes: 70000 } }).errors[0], /^the page could be up to \d+ bytes .*; keep it to 70000 or fewer/);
  assert.match(buildPage(spec, files, { limits: { maxSources: 3 } }).errors.at(-1), /sources: \d+ entries; keep it to 3 or fewer/);
  assert.match(buildPage(spec, files, { limits: { maxStringChars: 50 } }).errors[0], /text of \d+ characters; keep it to 50 or fewer/);
  assert.match(buildPage(spec, files, { limits: { maxTextChars: 1000 } }).errors.at(-1), /characters of text in all; keep it to 1000 or fewer/);
  assert.match(buildPage(spec, files, { limits: { maxCites: 1 } }).errors[0], /items; keep it to 1 or fewer/);
  for (const k of Object.keys(DEFAULT_LIMITS)) assert.equal(typeof DEFAULT_LIMITS[k], "number", k);
  void asset;
});

test("errors are capped and quote at most a little of the plan", () => {
  const spec = plan();
  spec.sources.Q = { kind: "file", path: "PLAN.md", quote: "y" };
  const row = Array.from({ length: 1600 }, (_, i) => String(100000 + i)).join(" ").slice(0, 10000);
  for (let i = 0; i < 40; i++) spec.overview.push({ kind: "Change", text: row, section: spec.sections[0].id, cites: ["Q"] });
  const r = buildPage(spec, exampleFiles(spec));
  assert.equal(r.errors.length, DEFAULT_LIMITS.maxErrors + 1);
  assert.match(r.errors.at(-1), /^…and \d+ more$/);
  assert.ok(r.errors.every((e) => e.length < 300), "each error quotes at most maxEchoChars of the text");
  const few = buildPage(spec, exampleFiles(spec), { limits: { maxErrors: 3, maxEchoChars: 10 } }).errors;
  assert.equal(few.length, 4);
  assert.ok(few[0].endsWith(`"100000 100…"`), few[0]);
  // Warnings are capped the same way.
  const w = plan();
  w.sections[0].lead = Array.from({ length: 300 }, () => "This sentence has a great many plain words in it, and it keeps on going and going well past the limit of words that one sentence may hold before a reader loses the thread of it.").join(" ");
  const lw = lint(w, { maxErrors: 5 });
  assert.equal(lw.warnings.length, 6);
});

test("screenshots: a full PNG signature and IHDR, a JPEG read marker by marker, sides 1 to 2^24", () => {
  assert.deepEqual(imageSize(png(640, 480)), { w: 640, h: 480, mime: "image/png" });
  assert.equal(imageSize(png(0, 480)), null);
  assert.equal(imageSize(png(640, 0)), null);
  assert.equal(imageSize(png(2 ** 24 + 1, 10)), null);
  assert.deepEqual(imageSize(png(2 ** 24, 1)), { w: 2 ** 24, h: 1, mime: "image/png" });
  const noIhdr = png(640, 480); noIhdr[12] = 0x49 + 1; assert.equal(imageSize(noIhdr), null);
  const badLen = png(640, 480); badLen[11] = 12; assert.equal(imageSize(badLen), null);
  const badSig = png(640, 480); badSig[7] = 0; assert.equal(imageSize(badSig), null);
  assert.equal(imageSize(new TextEncoder().encode("\x89P<script>alert(1)</script>AAAAAAAAAAAAAAAAAAAAAAAA")), null);
  assert.equal(imageSize(png(1, 1).subarray(0, 23)), null);

  assert.deepEqual(imageSize(jpeg(300, 200)), { w: 300, h: 200, mime: "image/jpeg" });
  for (const sof of [0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) assert.deepEqual(imageSize(jpeg(3, 2, { sof })), { w: 3, h: 2, mime: "image/jpeg" }, sof.toString(16));
  // C4 (Huffman tables) and C8 are not frame headers: their bytes are skipped by their length.
  const dht = [0xff, 0xc4, 0, 6, 0, 0, 0x10, 0x20];
  assert.deepEqual(imageSize(jpeg(30, 20, { before: dht })), { w: 30, h: 20, mime: "image/jpeg" });
  assert.equal(imageSize(jpeg(30, 20, { sof: 0xc8 })), null);
  // Fill bytes before a marker, and markers with no length (RSTn, TEM).
  assert.deepEqual(imageSize(jpeg(5, 6, { before: [0xff, 0xff, 0xff, 0xd0, 0xff, 0x01] })), { w: 5, h: 6, mime: "image/jpeg" });
  // A frame header that only appears after the scan, or after the end, does not count.
  assert.equal(imageSize(jpeg(5, 6, { before: [0xff, 0xda, 0, 2] })), null);
  assert.equal(imageSize(jpeg(5, 6, { before: [0xff, 0xd9] })), null);
  assert.equal(imageSize(jpeg(0, 6)), null);
  // A frame header's bytes hidden inside another segment are skipped, not read.
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 12, 0xff, 0xc0, 0, 17, 8, 0, 9, 0, 9, 3])), null);
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xc0, 0, 17, 8, 0, 9, 0, 9])), null);
  assert.equal(imageSize(new Uint8Array(1e6).fill(0xff).fill(0xd8, 1, 2)), null);
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 0x11, 8, 0, 1])), null);
});

test("one file named by many ids, or drawn many times, is encoded once and counted per drawing", () => {
  const spec = plan();
  const [id, asset] = Object.entries(spec.assets)[0];
  for (let i = 0; i < 100 - Object.keys(spec.assets).length; i++) spec.assets[`alias${i}`] = { file: asset.file };
  const files = new Map([[asset.file, png(256, 256, 2 * 1024 * 1024)]]);
  const t = Date.now();
  const r = buildPage(spec, files);
  assert.deepEqual(r.errors, []);
  assert.ok(Date.now() - t < 2000);
  // Ids no figure draws add nothing to the page.
  assert.ok(r.html.length < 4 * 1024 * 1024, `${r.html.length}`);
  // Drawn 70 times, a 1 MB screenshot is refused before anything is encoded.
  const many = plan();
  const shot = { type: "screenshot", asset: id, alt: "a shot" };
  const src = Object.keys(many.sources)[0];
  const pair = { type: "pair", title: "Shots", cites: [src], sides: [1, 2, 3, 4].map(() => ({ label: "Side", figure: shot })) };
  for (const s of many.sections) { s.figure = pair; for (const c of s.cards || []) c.figure = pair; }
  const big = buildPage(many, new Map([[asset.file, png(256, 256, 1024 * 1024)]]));
  assert.equal(big.html, null);
  assert.match(big.errors[0], /the screenshots alone would make the page \d+ bytes/);
});

test("bytes may be any ArrayBuffer view, and files any Map-like", () => {
  const spec = plan();
  const [asset] = Object.values(spec.assets);
  const bytes = readFileSync(join(EXAMPLE, asset.file));
  const want = readFileSync(join(EXAMPLE, "guided-plan.html"), "utf8");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const like = { get: (p) => (p === asset.file ? dv : undefined) };
  assert.equal(buildPage(spec, like).html, want);
  assert.equal(buildPage(spec, { [asset.file]: new Uint8Array(bytes) }).html, want);
  for (const files of [null, undefined, 5, "x", [], { get: 5 }, { get() { throw new Error("no"); } }]) {
    const r = buildPage(spec, files);
    assert.equal(r.html, null);
    assert.match(r.errors[0], /not found next to the content file/);
  }
});

test("base64: chunked, the pure path equal to btoa's and to Node's", () => {
  for (const n of [0, 1, 2, 3, 4, 3 * 0x2000 - 1, 3 * 0x2000, 3 * 0x2000 + 1, 100003]) {
    const b = new Uint8Array(n).map((_, i) => (i * 131 + 7) & 255);
    const want = Buffer.from(b).toString("base64");
    assert.equal(base64(b), want, `btoa ${n}`);
    assert.equal(base64(b, { pure: true }), want, `pure ${n}`);
  }
  assert.equal(utf8Length("aé€😀"), Buffer.byteLength("aé€😀"));
  assert.equal(utf8Length("\ud800x"), Buffer.byteLength("\ud800x"));
});

// The largest plan the default limits allow, built to make every check work hard: 500 sources with
// long quotes full of numbers, 200 ban words, 50 overview rows, ten sections of six cards, every
// text full of numbers and cited by its own list of 100 sources, and the text budget nearly spent.
function maxPlan({ clean = false } = {}) {
  const L = DEFAULT_LIMITS;
  const spec = plan();
  const numbers = (k, from) => Array.from({ length: k }, (_, i) => String(from + i)).join(" ");
  spec.sources = {};
  for (let i = 0; i < L.maxSources - 1; i++) spec.sources[`s${i}`] = { kind: "file", path: "PLAN.md", quote: [numbers(60, i * 7), "two three ten"] };
  spec.sources.SHOT = { kind: "capture", path: "assets/new-paste.png" };
  const ids = Object.keys(spec.sources).filter((k) => k !== "SHOT");
  let rot = 0;
  const cites = () => { rot = (rot + 37) % ids.length; return Array.from({ length: L.maxCites }, (_, i) => ids[(rot + i * 3) % ids.length]); };
  const line = clean ? "Plain words that a new reader knows, in short sentences. " : "Seven doors open 12 times a day, 3.5 hours each, near the lane and 999. ";
  const prose = (chars) => line.repeat(Math.ceil(chars / line.length)).slice(0, chars);
  spec.ban = Array.from({ length: L.maxBanWords }, (_, i) => `zz${i}word`);
  spec.intentCites = cites();
  if (clean) spec.intent = prose(200);
  spec.overview = Array.from({ length: L.maxOverviewRows }, (_, i) => ({ kind: "Change", text: prose(1500), section: "s0", cites: cites() }));
  const table = (n) => ({ type: "table", title: "A table", cites: cites(), columns: ["Name", "Kind", "Where", "When", "Note"], rows: Array.from({ length: 20 }, (_, r) => Array.from({ length: 5 }, (_, c) => (clean ? `cell ${"abcdefghijklmnopqrst"[r]}${"abcde"[c]}` : `cell ${r} ${c} ${n}`))) });
  spec.sections = Array.from({ length: 10 }, (_, s) => ({
    id: `s${s}`, title: "A label", heading: "A heading of a few words", lead: prose(2500), cites: cites(),
    figure: { type: "pair", title: "Two sides", cites: cites(), sides: [0, 1, 2, 3].map((k) => ({ label: `Side ${"abcd"[k]}`, figure: table(s) })) },
    cards: Array.from({ length: 6 }, (_, c) => ({
      id: `c${c}`, title: "A card", body: [prose(2000), prose(2000), prose(2000)], cites: cites(),
      figure: { type: "layers", title: "Layers", cites: cites(), rows: Array.from({ length: 5 }, (_, r) => ({ label: `Row ${"abcde"[r]}`, text: prose(200), items: Array.from({ length: L.maxLayerItems }, (_, i) => `item ${clean ? String.fromCharCode(97 + (i % 26)) : i}`) })) },
    })),
    files: Array.from({ length: L.maxFiles }, (_, f) => ({ name: `file ${clean ? "x" : f}`, note: prose(100), path: "PLAN.md" })),
  }));
  return spec;
}

test("a plan at the default limits is checked and built in about a second", () => {
  const spec = maxPlan();
  const json = JSON.stringify(spec);
  const t = Date.now();
  const r = buildPage(spec, exampleFiles(plan()));
  const ms = Date.now() - t;
  assert.deepEqual(validate(spec), [], "the plan is inside every limit, so the words and numbers are checked");
  assert.ok(r.errors.some((e) => e.includes('jargon "doors"')), "the words were checked");
  assert.ok(r.errors.some((e) => e.includes("the number")), "the numbers were checked");
  assert.ok(ms < 2000, `${ms} ms for a ${json.length}-character plan`);
  assert.equal(r.errors.length, DEFAULT_LIMITS.maxErrors + 1);
  assert.equal(validatePlan(spec, { limits: { maxErrors: 1 } }).errors.length, 2);
});

test("a clean plan at the default limits draws its page in about a second", () => {
  const spec = maxPlan({ clean: true });
  const t = Date.now();
  const r = buildPage(spec, exampleFiles(plan()));
  const ms = Date.now() - t;
  assert.deepEqual(r.errors, []);
  assert.ok(r.html.length > 1e6);
  assert.ok(ms < 2000, `${ms} ms`);
});

test("a limit can only be set to a whole number from 0 to 2^53 - 1; anything else keeps the default", () => {
  for (const v of [Infinity, -Infinity, NaN, -1, 1e308, 2 ** 53, 1.5, "5", null, undefined, true, {}, [5]]) {
    assert.equal(limitsOf({ maxSources: v }).maxSources, DEFAULT_LIMITS.maxSources, String(v));
  }
  assert.equal(limitsOf({ maxSources: 0 }).maxSources, 0);
  assert.equal(limitsOf({ maxSources: 2 ** 53 - 1 }).maxSources, 2 ** 53 - 1);
  for (const v of [null, 5, "x", [], { maxSources: Infinity }]) assert.deepEqual(limitsOf(v), { ...DEFAULT_LIMITS });
  // The same for every caller: buildPage, and limitErrors called directly.
  const spec = plan();
  for (let i = 0; i < DEFAULT_LIMITS.maxSources + 1; i++) spec.sources[`x${i}`] = { kind: "capture", path: "assets/new-paste.png" };
  for (const v of [Infinity, NaN, -1, 1e308, "5", null]) {
    assert.match(buildPage(spec, exampleFiles(spec), { limits: { maxSources: v } }).errors[0], /keep it to 500 or fewer/, String(v));
    assert.ok(limitErrors(spec, { maxSources: v }).over, String(v));
  }
});

test("a page whose text would be too large is refused before it is drawn", () => {
  // 95 quotes of 10,000 quote marks (each drawn as &quot;), in every one of ten sections and
  // listed again in intentCites: inside every list and text limit, but the page would be over
  // 60 MB, refused by the bound before anything is encoded or drawn.
  const spec = plan();
  while (spec.sections.length < 10) spec.sections.push({ ...structuredClone(spec.sections[0]), id: `more-${"abcdefghij"[spec.sections.length]}` });
  const ids = [];
  for (let i = 0; i < 95; i++) { spec.sources[`q${i}`] = { kind: "file", path: "PLAN.md", quote: '"'.repeat(10000) }; ids.push(`q${i}`); }
  for (const s of spec.sections) s.cites = [...s.cites, ...ids];
  spec.intentCites = [...(spec.intentCites || []), ...ids];
  const t = Date.now();
  const r = buildPage(spec, exampleFiles(spec));
  assert.ok(Date.now() - t < 2000);
  assert.equal(r.html, null);
  assert.match(r.errors[0], /^the page could be up to \d+ bytes .*; keep it to 50000000 or fewer$/);
});

test("the size bound is never below the page drawn, for hostile text in every field", () => {
  const pieces = ["&", "<", ">", '"', "'", "`", ".", "-", "_", "/", "\t", " ", "a", "é", "€", "😀", "x.y", "`code`"];
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const hostile = () => Array.from({ length: Math.floor(rand() * 40) }, () => pieces[Math.floor(rand() * pieces.length)]).join("");
  for (const name of ["paste-expiry", "inbox-text-size"]) {
    const dir = join(EXAMPLE, "..", name);
    const base = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
    const assets = {};
    for (const [id, a] of Object.entries(base.assets)) { const b = readFileSync(join(dir, a.file)); const s = imageSize(b); assets[id] = { w: s.w, h: s.h, uri: `data:${s.mime};base64,${base64(b)}` }; }
    for (let t = 0; t < 60; t++) {
      const spec = structuredClone(base);
      const p = rand();
      const walk = (v) => {
        if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === "string" && rand() < p) v[i] = hostile() + x + hostile(); else walk(x); });
        else if (v && typeof v === "object") for (const k of Object.keys(v)) { if (["type", "asset", "kind", "mark"].includes(k)) continue; if (typeof v[k] === "string" && rand() < p) v[k] = hostile() + v[k] + hostile(); else walk(v[k]); }
      };
      walk(spec.sections); walk(spec.overview); walk(spec.sources);
      spec.title = hostile() + spec.title;
      spec.intentCites = [...spec.intentCites, ...spec.intentCites];
      const links = linksFor(spec);
      const html = render(spec, { css: GUIDE_CSS, runtime: RUNTIME_JS, assets, links });
      const bound = renderSizeBound(spec, { css: GUIDE_CSS, runtime: RUNTIME_JS, links, uriLength: (id) => (assets[id] ? assets[id].uri.length : 0) });
      assert.ok(bound >= utf8Length(html), `${name} #${t}: bound ${bound} < page ${utf8Length(html)}`);
    }
  }
  // And for the largest plan the limits allow, with room to spare under maxHtmlBytes.
  const spec = maxPlan({ clean: true });
  const links = linksFor(spec);
  const b = readFileSync(join(EXAMPLE, "assets/new-paste.png"));
  const assets = { "new-paste": { w: 1, h: 1, uri: `data:image/png;base64,${base64(b)}` } };
  const html = render(spec, { css: GUIDE_CSS, runtime: RUNTIME_JS, assets, links });
  const bound = renderSizeBound(spec, { css: GUIDE_CSS, runtime: RUNTIME_JS, links, uriLength: () => assets["new-paste"].uri.length });
  assert.ok(bound >= utf8Length(html) && bound < DEFAULT_LIMITS.maxHtmlBytes / 4, `${bound} vs ${utf8Length(html)}`);
});

test("300,000 unknown fields are capped errors, not a stack overflow", () => {
  const spec = plan();
  for (let i = 0; i < 300000; i++) spec[`zz${i}`] = 1;
  const r = validatePlan(spec);
  assert.equal(r.errors.length, DEFAULT_LIMITS.maxErrors + 1);
  assert.match(r.errors.at(-1), /^…and \d+ more$/);
  const some = unknownFields(spec, { max: 3 });
  assert.equal(some.length, 3);
  assert.equal(some.more, 300000 - 3);
});

test("options whose getters throw give an error, never an exception", () => {
  const spec = plan();
  const files = exampleFiles(spec);
  const bad = [
    { get limits() { throw new Error("limits getter"); } },
    { get insideFolder() { throw new Error("insideFolder getter"); } },
    { get css() { throw new Error("css getter"); } },
    { limits: { get maxSources() { throw new Error("maxSources getter"); } } },
    new Proxy({}, { get() { throw new Error("proxy"); }, ownKeys() { throw new Error("proxy keys"); } }),
  ];
  for (const options of bad) {
    let r;
    assert.doesNotThrow(() => { r = buildPage(spec, files, options); });
    assert.equal(r.html, null);
    assert.match(r.errors[0], /could not be drawn/);
  }
});
