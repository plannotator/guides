#!/usr/bin/env node
// Build a guided plan from its content file, and re-check the sources it cites.
//
//   node build.mjs plan.json plan.html            validate, lint, embed the screenshots, write one HTML file
//   node build.mjs --lint plan.json               validate and lint only; write nothing
//   node build.mjs --check plan.json              reopen every source: each quote sits in its cited lines,
//                                                 each code excerpt matches its commit, each file exists
//
//   --repo name=DIR    where the repository `name` (a key of "repos") is checked out; `--repo DIR` for a
//                      plan with one repository. Without it: "repos.<name>.path" (relative to the content
//                      file), else the git repository that holds the current directory.
//
// Needs Node 18+ and git. No dependencies. Only reads: files next to the content file, and
// `git show` / `git cat-file` at named commits. It never fetches. The same input gives the same bytes.

import { readFileSync, writeFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, isAbsolute, sep, resolve as rpath } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ownIn, insideFolderByName, DEFAULT_LIMITS } from "./validate.mjs";
import { buildPage, repoName as repoOf } from "./page.mjs";
import { featureCss } from "./renderer.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// ---------- arguments ----------

const argv = process.argv.slice(2);
const checkMode = argv.includes("--check");
const lintMode = argv.includes("--lint");
const repoArgs = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--check" || a === "--lint") continue;
  if (a === "--repo") {
    const v = argv[++i] || "";
    const eq = v.indexOf("=");
    if (eq > 0) repoArgs[v.slice(0, eq)] = rpath(v.slice(eq + 1));
    else repoArgs[""] = rpath(v);
    continue;
  }
  if (a === "-h" || a === "--help") { usage(0); }
  pos.push(a);
}
function usage(code) {
  console.error("usage: node build.mjs plan.json plan.html [--repo name=DIR]\n       node build.mjs --lint plan.json\n       node build.mjs --check plan.json [--repo name=DIR]");
  process.exit(code);
}
if (!pos[0] || (!checkMode && !lintMode && !pos[1])) usage(1);

const specPath = rpath(pos[0]);
const specDir = dirname(specPath);
let spec;
try { spec = JSON.parse(readFileSync(specPath, "utf8")); }
catch (e) { console.error(`cannot read ${pos[0]}: ${e.message}`); process.exit(1); }

// ---------- repositories ----------

const defaultRepoName = () => repoOf(spec, undefined);
const repoName = (r) => repoOf(spec, r);
const toplevel = (() => {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
})();
function repoDir(name) {
  if (repoArgs[name]) return repoArgs[name];
  if (repoArgs[""] && (name === defaultRepoName() || name === "")) return repoArgs[""];
  const conf = ownIn(spec.repos, name);
  if (conf && conf.path) return rpath(specDir, conf.path);
  return toplevel;
}
function git(name, args) {
  const dir = repoDir(name);
  if (!dir) throw new Error(`no git repository for "${name || "the guided plan"}"; run from inside it or pass --repo ${name ? name + "=" : ""}DIR`);
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
}

// ---------- paths beside the content file ----------

// A path the build reads beside the content file stays inside its folder (no "..", no absolute
// path, no symlink out), so a guided plan cannot embed or probe other files on the computer.
const leaves = (r) => r === ".." || r.startsWith(".." + sep) || isAbsolute(r);
function insideSpecDir(p) {
  if (typeof p !== "string" || !p || isAbsolute(p)) return false;
  if (leaves(relative(specDir, rpath(specDir, p)))) return false;
  try { return !leaves(relative(realpathSync(specDir), realpathSync(rpath(specDir, p)))); }
  catch { return true; } // missing: existence is reported elsewhere
}
// The same check a host without a folder runs (by name alone), and then the disk's: so a plan that
// builds here does not fail when it is uploaded.
const insideFolder = (p) => insideFolderByName(p) && insideSpecDir(p);
// Assets that are files but could not be read, with the reason.
const unreadable = new Map();
// An asset is a file: true, false when it is missing, or what is wrong with it.
function assetFile(p) {
  if (unreadable.has(p)) return `${p} could not be read (${unreadable.get(p)})`;
  const f = join(specDir, p);
  if (!existsSync(f)) return false;
  const st = statSync(f);
  if (st.isDirectory()) return `${p} is a folder; name an image file inside it`;
  if (!st.isFile()) return `${p} is not a file`;
  return st.size > DEFAULT_LIMITS.maxImageBytes ? `${p} is ${st.size} bytes; keep a screenshot to ${DEFAULT_LIMITS.maxImageBytes} or fewer` : true;
}

// ---------- the re-check ----------

const norm = (s) => s.replace(/\s+/g, " ").trim();
function sliceLines(text, lines) {
  if (!lines) return text;
  const [a, b] = String(lines).split("-").map(Number);
  return text.split("\n").slice(a - 1, b || a).join("\n");
}
const firstLine = (e) => String((e.stderr && String(e.stderr).trim()) || e.message).split("\n")[0];

function check() {
  let fails = 0;
  const ok = (m) => console.log(`ok    ${m}`);
  const bad = (m) => { fails++; console.log(`FAIL  ${m}`); };
  const commits = new Set();
  for (const [id, s] of Object.entries(spec.sources)) {
    let text = null;
    try {
      if (s.kind === "file") text = readFileSync(join(specDir, s.path), "utf8");
      else if (s.kind === "git") { const at = s.at || spec.base; commits.add(`${repoName(s.repo)}@${at}`); text = git(repoName(s.repo), ["show", `${at}:${s.path}`]); }
      else if (s.kind === "capture") { existsSync(join(specDir, s.path)) ? ok(`${id}  screenshot exists: ${s.path}`) : bad(`${id}  screenshot missing: ${s.path}`); continue; }
    } catch (e) { bad(`${id}  ${s.path}: ${firstLine(e)}`); continue; }
    const body = norm(sliceLines(text, s.lines));
    if (s.lines && !body) { bad(`${id}  ${s.path}:${s.lines} is past the end of the file`); continue; }
    const missing = [].concat(s.quote).filter((q) => !body.includes(norm(q)));
    const at = s.kind === "git" ? ` at ${String(s.at || spec.base).slice(0, 9)}` : "";
    if (missing.length) bad(`${id}  ${s.path}${s.lines ? ":" + s.lines : ""}${at}  missing: ${missing.map((q) => JSON.stringify(q)).join("; ")}`);
    else ok(`${id}  ${s.path}${s.lines ? ":" + s.lines : ""}${at}  (${[].concat(s.quote).length} quote${[].concat(s.quote).length === 1 ? "" : "s"})`);
  }
  // Code excerpts must match the commit byte for byte, tabs included.
  const codeFigs = [];
  const collect = (f) => {
    if (!f) return;
    if (f.type === "code") codeFigs.push(f);
    for (const s of f.sides || []) collect(s.figure);
  };
  for (const sec of spec.sections) { collect(sec.figure); for (const c of sec.cards || []) collect(c.figure); }
  for (const f of codeFigs) {
    const at = f.at || spec.base;
    try {
      const lines = git(repoName(f.repo), ["show", `${at}:${f.path}`]).split("\n").slice(f.start - 1, f.start - 1 + f.text.length);
      const diff = f.text.findIndex((t, i) => t !== lines[i]);
      diff < 0 ? ok(`code  ${f.path}:${f.start}-${f.start + f.text.length - 1} matches ${at.slice(0, 9)}`) : bad(`code  ${f.path} line ${f.start + diff} differs at ${at.slice(0, 9)}: ${JSON.stringify(lines[diff])}`);
    } catch (e) { bad(`code  ${f.path}  ${firstLine(e)}`); }
  }
  // Files: repository paths exist at their commit; other paths exist next to the content file.
  for (const sec of spec.sections) for (const a of sec.files || []) {
    if (!a.path) continue;
    if (a.repo !== undefined) {
      const at = a.at || spec.base;
      try { git(repoName(a.repo), ["cat-file", "-e", `${at}:${a.path.replace(/\/$/, "")}`]); ok(`file  ${a.path} at ${at.slice(0, 9)}`); } catch { bad(`file  ${a.path} not at ${at.slice(0, 9)}`); }
    } else existsSync(join(specDir, a.path)) ? ok(`file  ${a.path}`) : bad(`file  ${a.path} missing`);
  }
  try { git(repoName(undefined), ["cat-file", "-e", `${spec.base}^{commit}`]); ok(`base  ${spec.base.slice(0, 9)} exists`); }
  catch { bad(`base  ${spec.base} is not a commit in ${repoDir(repoName(undefined)) || "the current directory"}; fetch it or pass --repo`); }
  console.log(fails ? `\n${fails} check${fails === 1 ? "" : "s"} failed.` : `\nAll sources, excerpts and files confirmed.`);
  return fails;
}

// ---------- screenshots ----------

// The bytes of every asset file the plan names that is a file inside its folder; page.mjs checks
// the rest and reads the images.
function readAssets() {
  const files = new Map();
  const assets = spec && typeof spec === "object" && spec.assets && typeof spec.assets === "object" && !Array.isArray(spec.assets) ? spec.assets : {};
  for (const a of Object.values(assets)) {
    if (!a || typeof a !== "object" || typeof a.file !== "string" || !a.file || files.has(a.file)) continue;
    if (!insideFolder(a.file) || assetFile(a.file) !== true) continue;
    try { files.set(a.file, readFileSync(join(specDir, a.file))); } catch (e) { unreadable.set(a.file, e.code || e.message); }
  }
  return files;
}

// ---------- main ----------

const page = buildPage(spec, readAssets(), {
  insideFolder,
  fileExists: assetFile,
  css: readFileSync(join(here, "guide.css"), "utf8"),
  runtime: readFileSync(join(here, "runtime.js"), "utf8"),
  features: featureCss(readFileSync(join(here, "features.css"), "utf8")),
});
const { errors: errs, warnings: warns, html } = page;
warns.forEach((w) => console.error("warn: " + w));
if (errs.length) { console.error("Errors:\n  " + errs.join("\n  ")); process.exit(2); }
if (checkMode) process.exit(check() ? 1 : 0);
if (lintMode) { console.log(`${pos[0]}: structure and words are clean.`); process.exit(0); }
const outPath = rpath(pos[1]);
writeFileSync(outPath, html);
console.log(`${pos[1]}  ${Buffer.byteLength(html)} bytes  sha256 ${createHash("sha256").update(html).digest("hex").slice(0, 16)}`);
