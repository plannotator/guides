// Shared by the tests: a scratch copy of the worked example, and a way to run the build on it.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
export const BUILD = resolve(here, "../system/build.mjs");
export const EXAMPLE = resolve(here, "../../../examples/paste-expiry");

// A scratch copy of the example (plan.json, its notes and assets), with `edit` applied to the plan.
export function scratch(edit) {
  const dir = mkdtempSync(join(tmpdir(), "guided-plan-test-"));
  for (const f of ["plan.json", "PLAN.md", "issue-41.md", "assets"]) cpSync(join(EXAMPLE, f), join(dir, f), { recursive: true });
  const plan = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
  const out = edit ? edit(plan) ?? plan : plan;
  writeFileSync(join(dir, "plan.json"), JSON.stringify(out, null, 2));
  return { dir, plan: join(dir, "plan.json"), done: () => rmSync(dir, { recursive: true, force: true }) };
}

export function build(...args) {
  const r = spawnSync(process.execPath, [BUILD, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

// Lint a plan after `edit`; returns the build's exit code and output.
export function lintWith(edit) {
  const s = scratch(edit);
  try { return build("--lint", s.plan); } finally { s.done(); }
}

export const section = (plan, id) => plan.sections.find((s) => s.id === id);
