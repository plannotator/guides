// validate.mjs, schema.mjs and renderer.mjs are the pure core: a host can copy them and run them in a
// browser or a Worker. They may import each other and nothing else, and they must load and work
// where there is no `process` and no `Buffer`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { EXAMPLE } from "./helpers.mjs";
import { validate, validatePlan, lint, insideFolderByName } from "../system/validate.mjs";

const SYSTEM = join(dirname(fileURLToPath(import.meta.url)), "../system");
const CORE = ["validate.mjs", "schema.mjs", "renderer.mjs"];

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

test("the pure core loads and runs with no process and no Buffer", () => {
  const plan = readFileSync(join(EXAMPLE, "plan.json"), "utf8");
  const url = (f) => pathToFileURL(join(SYSTEM, f)).href;
  // The child takes away the Node globals a browser lacks, then imports the core and uses it.
  const script = `
    const log = console.log;
    delete globalThis.process; delete globalThis.Buffer;
    const { validatePlan } = await import(${JSON.stringify(url("validate.mjs"))});
    await import(${JSON.stringify(url("schema.mjs"))});
    const { render } = await import(${JSON.stringify(url("renderer.mjs"))});
    const spec = ${JSON.stringify(JSON.parse(plan))};
    const clean = validatePlan(spec);
    const broken = validatePlan({ ...spec, format: "guided-plan/1" });
    const assets = Object.fromEntries(Object.keys(spec.assets || {}).map((id) => [id, { w: 10, h: 10, uri: "data:image/png;base64,iVBORw0KGgo=" }]));
    const html = render(spec, { css: "", runtime: "", assets, links: { source: () => null, file: () => null } });
    log(JSON.stringify({ process: typeof process, errors: clean.errors, brokenErrors: broken.errors.length, html: html.startsWith("<!doctype html>") || html.startsWith("<!DOCTYPE html>") }));
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(out.process, "undefined");
  assert.deepEqual(out.errors, [], "the worked example passes validate and lint with no file system");
  assert.equal(out.brokenErrors, 1, "a guided-plan/1 file is refused");
  assert.ok(out.html, "render() returns a page");
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
