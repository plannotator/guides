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

import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, isAbsolute, sep, resolve as rpath } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { render } from "./renderer.mjs";
import { validatePlan, ownIn } from "./validate.mjs";

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

function defaultRepoName() {
  const names = Object.keys(spec.repos || {});
  return names.length === 1 ? names[0] : "";
}
function repoName(r) { return r === undefined || r === true ? defaultRepoName() : r; }
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

function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), mime: "image/png" };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), mime: "image/jpeg" };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  throw new Error("not a PNG or JPEG");
}

function loadAssets() {
  const out = {};
  for (const [id, a] of Object.entries(spec.assets || {})) {
    const buf = readFileSync(join(specDir, a.file));
    const { w, h, mime } = imageSize(buf);
    out[id] = { w, h, uri: `data:${mime};base64,${buf.toString("base64")}` };
  }
  return out;
}

// ---------- links ----------

function linksFor() {
  const url = (name) => { const u = (ownIn(spec.repos, name) || {}).url; return typeof u === "string" && /^https:\/\//.test(u) ? u.replace(/\/+$/, "") : null; };
  const range = (lines) => {
    if (!lines) return "";
    const [a, b] = String(lines).split("-");
    return b ? `#L${a}-L${b}` : `#L${a}`;
  };
  return {
    source(s) {
      if (s.kind === "git") { const u = url(repoName(s.repo)); return u ? `${u}/blob/${s.at || spec.base}/${s.path}${range(s.lines)}` : null; }
      return null; // files beside the content file are not shipped with the page, so no link
    },
    file(a) {
      if (!a.path) return null;
      if (a.repo !== undefined) { const u = url(repoName(a.repo)); return u ? `${u}/${a.path.endsWith("/") ? "tree" : "blob"}/${a.at || spec.base}/${a.path.replace(/\/$/, "")}` : null; }
      return null;
    },
  };
}

// ---------- main ----------

const { errors: errs, warnings: warns } = validatePlan(spec, { insideFolder: insideSpecDir, fileExists: (p) => existsSync(join(specDir, p)) });
warns.forEach((w) => console.error("warn: " + w));
if (errs.length) { console.error("Errors:\n  " + errs.join("\n  ")); process.exit(2); }
if (checkMode) process.exit(check() ? 1 : 0);
if (lintMode) { console.log(`${pos[0]}: structure and words are clean.`); process.exit(0); }
const outPath = rpath(pos[1]);
const html = render(spec, {
  css: readFileSync(join(here, "guide.css"), "utf8"),
  runtime: readFileSync(join(here, "runtime.js"), "utf8"),
  assets: loadAssets(),
  links: linksFor(),
});
writeFileSync(outPath, html);
console.log(`${pos[1]}  ${Buffer.byteLength(html)} bytes  sha256 ${createHash("sha256").update(html).digest("hex").slice(0, 16)}`);
