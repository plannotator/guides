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
