// schema.mjs, validate.mjs, renderer.mjs, page.mjs and static.generated.mjs are the pure core: a
// host can copy them and run them in a browser or a Worker, and draw the same bytes build.mjs does.
// They may import each other and nothing else, and they must load and work where there is no
// `process` and no `Buffer`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { EXAMPLE } from "./helpers.mjs";
import { validate, validatePlan, lint, insideFolderByName } from "../system/validate.mjs";
import { buildPage, base64, imageSize } from "../system/page.mjs";
import { currentStaticSource, STATIC_PATH } from "../system/make-static.mjs";

const SYSTEM = join(dirname(fileURLToPath(import.meta.url)), "../system");
const CORE = ["schema.mjs", "validate.mjs", "renderer.mjs", "page.mjs", "static.generated.mjs"];

test("the pure core imports only itself, never a node: module", () => {
  for (const file of CORE) {
    const src = readFileSync(join(SYSTEM, file), "utf8");
    const specifiers = [
      ...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm),
      ...src.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
      ...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
      ...src.matchAll(/\brequire\s*\(\s*["']([^"']+)["']/g),
    ].map((m) => m[1]);
    for (const s of specifiers) {
      assert.ok(!s.startsWith("node:"), `${file} imports ${s}`);
      assert.ok(CORE.map((f) => "./" + f).includes(s), `${file} imports ${s}; the core may import only ${CORE.join(", ")}`);
    }
    assert.ok(!/\brequire\s*\(/.test(src), `${file} calls require()`);
  }
});

test("the pure core loads and draws every example, byte for byte, with no process and no Buffer", () => {
  const url = (f) => pathToFileURL(join(SYSTEM, f)).href;
  const examples = ["paste-expiry", "inbox-text-size", "pickup-times"].map((name) => join(EXAMPLE, "..", name));
  // The child reads the examples first (plain Uint8Array copies), then takes away the Node globals
  // a browser lacks, and only then imports the core and builds each page.
  const script = `
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    const log = console.log;
    const inputs = ${JSON.stringify(examples)}.map((dir) => {
      const spec = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
      const files = new Map(Object.values(spec.assets || {}).map((a) => [a.file, new Uint8Array(readFileSync(join(dir, a.file)))]));
      return { spec, files };
    });
    delete globalThis.process; delete globalThis.Buffer;
    const { validatePlan } = await import(${JSON.stringify(url("validate.mjs"))});
    await import(${JSON.stringify(url("schema.mjs"))});
    await import(${JSON.stringify(url("renderer.mjs"))});
    await import(${JSON.stringify(url("static.generated.mjs"))});
    const { buildPage } = await import(${JSON.stringify(url("page.mjs"))});
    const broken = validatePlan({ ...inputs[0].spec, format: "guided-plan/1" });
    const pages = inputs.map(({ spec, files }) => buildPage(spec, files));
    log(JSON.stringify({ process: typeof process, buffer: typeof Buffer, brokenErrors: broken.errors.length, pages }));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(out.process, "undefined");
  assert.equal(out.buffer, "undefined");
  assert.equal(out.brokenErrors, 1, "a guided-plan/1 file is refused");
  examples.forEach((dir, i) => {
    assert.deepEqual(out.pages[i].errors, [], dir);
    assert.ok(out.pages[i].html === readFileSync(join(dir, "guided-plan.html"), "utf8"), `${dir}: buildPage with no process or Buffer differs from the committed guided-plan.html`);
  });
});

test("the default folder check, by name alone, refuses anything a host might resolve elsewhere", () => {
  for (const p of ["assets/shot.png", "a/b/../c.png", "./x.png", "a b.png"]) assert.equal(insideFolderByName(p), true, p);
  for (const p of [
    "%2e%2e/%2e%2e/etc/passwd", "assets%2fshot.png", "https://evil.example/x.png", "file:///etc/passwd",
    "data:image/png;base64,iVBORw0KGgo=", "C:foo", "C:\\x.png", "assets\\shot.png", "/etc/passwd", "\\x.png",
    "a\u0000.png", "a\n.png", "a\u007f.png", "../x.png", "a/../../x.png", "", null, 5,
  ]) assert.equal(insideFolderByName(p), false, JSON.stringify(p));
  const spec = JSON.parse(readFileSync(join(EXAMPLE, "plan.json"), "utf8"));
  const id = Object.keys(spec.assets)[0];
  spec.assets[id].file = "https://evil.example/x.png";
  assert.ok(validate(spec).some((e) => e.startsWith(`assets.${id}: https://evil.example/x.png must be inside`)));
});

test("null and wrong-type entries are errors, never a throw", () => {
  const base = JSON.parse(readFileSync(join(EXAMPLE, "plan.json"), "utf8"));
  const cases = {
    "sources: null entry": (p) => { p.sources.X = null; },
    "sources: a number entry": (p) => { p.sources.X = 5; },
    "assets: null entry": (p) => { p.assets.X = null; },
    "repos: null entry": (p) => { p.repos = { a: null }; },
    "sections: null entry": (p) => { p.sections.push(null); },
    "sections: a string entry": (p) => { p.sections[0] = "why"; },
    "overview: null row": (p) => { p.overview.push(null); },
    "overview: not a list": (p) => { p.overview = 5; },
    "files: null entry": (p) => { p.sections[0].files = [null]; },
    "files: not a list": (p) => { p.sections[0].files = { name: "x" }; },
    "files: a path that is not text": (p) => { p.sections[0].files = [{ name: "x", repo: true, path: 5 }]; },
    "cites: not a list": (p) => { p.intentCites = "ISSUE"; },
    "figure parts: not lists": (p) => { p.sections[0].figure = { type: "layers", title: "t", cites: [], rows: [{ label: "a", items: 5 }] }; },
    "ban: not a list of words": (p) => { p.ban = [null]; },
  };
  for (const [name, edit] of Object.entries(cases)) {
    const spec = structuredClone(base);
    edit(spec);
    for (const host of [undefined, null, {}]) {
      let r;
      assert.doesNotThrow(() => { r = validatePlan(spec, host); }, name);
      assert.ok(r.errors.length > 0, `${name}: expected errors`);
      assert.ok(!r.errors.some((e) => e.includes("could not be checked")), `${name}: ${r.errors.join("; ")}`);
      assert.doesNotThrow(() => validate(spec, host), name);
    }
  }
  for (const spec of [null, undefined, 5, "x", []]) {
    assert.deepEqual(validatePlan(spec, null).errors, ["the content file is a JSON object"]);
    assert.ok(lint(spec).errors.length > 0, `lint(${JSON.stringify(spec)}) reports an error`);
  }
});

test("static.generated.mjs is current with guide.css and runtime.js", () => {
  assert.ok(readFileSync(STATIC_PATH, "utf8") === currentStaticSource(), "static.generated.mjs is stale; run node skills/guided-plan/system/make-static.mjs");
});

test("buildPage on both examples, with files read from the disk, gives the committed pages", () => {
  for (const name of ["paste-expiry", "inbox-text-size"]) {
    const dir = join(EXAMPLE, "..", name);
    const spec = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
    const entries = Object.values(spec.assets).map((a) => [a.file, readFileSync(join(dir, a.file))]);
    for (const files of [new Map(entries), Object.fromEntries(entries)]) {
      const page = buildPage(spec, files);
      assert.deepEqual(page.errors, [], name);
      assert.ok(readFileSync(join(dir, "guided-plan.html")).equals(Buffer.from(page.html)), `${name}: buildPage differs from guided-plan.html`);
    }
  }
});

test("buildPage reports a missing or broken screenshot as an error, never a throw", () => {
  const spec = JSON.parse(readFileSync(join(EXAMPLE, "plan.json"), "utf8"));
  const [id, asset] = Object.entries(spec.assets)[0];
  const missing = buildPage(spec, new Map());
  assert.equal(missing.html, null);
  assert.deepEqual(missing.errors, [`assets.${id}: ${asset.file} not found next to the content file`]);
  for (const bad of [new TextEncoder().encode("not an image"), new Uint8Array([0x89, 0x50, 0x4e]), new Uint8Array([0xff, 0xd8, 0xff]), new Uint8Array()]) {
    const page = buildPage(spec, new Map([[asset.file, bad]]));
    assert.equal(page.html, null);
    assert.deepEqual(page.errors, [`assets.${id}: ${asset.file}: not a PNG or JPEG`]);
  }
  assert.equal(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])), null);
});

test("base64 matches Node's for every length and byte", () => {
  for (let n = 0; n < 300; n++) {
    const b = new Uint8Array(n).map((_, i) => (i * 37 + n * 11) & 255);
    assert.equal(base64(b), Buffer.from(b).toString("base64"), `length ${n}`);
  }
  const all = new Uint8Array(70000).map((_, i) => i & 255);
  assert.equal(base64(all), Buffer.from(all).toString("base64"));
});
