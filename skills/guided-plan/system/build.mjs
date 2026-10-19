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
import { render, citesOfFigure, FORMAT, FIGURE_TYPES, SIDE_TYPES } from "./renderer.mjs";

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
  const conf = (spec.repos || {})[name];
  if (conf && conf.path) return rpath(specDir, conf.path);
  return toplevel;
}
function git(name, args) {
  const dir = repoDir(name);
  if (!dir) throw new Error(`no git repository for "${name || "the guided plan"}"; run from inside it or pass --repo ${name ? name + "=" : ""}DIR`);
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
}

// ---------- structure ----------

const SECTION_ID = /^[a-z][a-z0-9-]*$/;
const KINDS = ["Decided", "Change", "Kept", "Open"];
const isStr = (s) => typeof s === "string" && s.trim().length > 0;
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const MAX_HEADING_WORDS = 8;
const COMMIT = /^[0-9a-f]{7,40}$/;
// A path the build reads beside the content file stays inside its folder (no "..", no absolute
// path, no symlink out), so a guided plan cannot embed or probe other files on the computer.
const leaves = (r) => r === ".." || r.startsWith(".." + sep) || isAbsolute(r);
function insideSpecDir(p) {
  if (typeof p !== "string" || !p || isAbsolute(p)) return false;
  if (leaves(relative(specDir, rpath(specDir, p)))) return false;
  try { return !leaves(relative(realpathSync(specDir), realpathSync(rpath(specDir, p)))); }
  catch { return true; } // missing: existence is reported elsewhere
}
const tooLong = (errs, where, what, text, max) => { if (typeof text === "string" && text.length > max) errs.push(`${where}: ${what} "${text}" is ${text.length} characters; keep it to ${max} or fewer`); };

// What a guided-plan/1 file needs to become a guided-plan/2 file, said once.
const MIGRATE = `guided-plan/2 draws each section as one card that reads: give each section "heading" (a few words), "lead" (one paragraph), "cites" and one "figure"; its other parts become "cards": [{ "id", "title", "body", "cites", "figure"? }]. "parts" are gone. A toggle or steps becomes a "pair" figure (each state side by side), a drawing becomes a "flow" or "layers" figure, and controls and rules are gone. See SKILL.md, section 5`;

function validateFigure(f, where, errs, { nested = false } = {}) {
  if (!f || typeof f !== "object") { errs.push(`${where}: no figure`); return; }
  const t = f.type;
  if (["toggle", "steps"].includes(t)) { errs.push(`${where}: ${t} is gone in ${FORMAT}; draw the states side by side with a "pair" figure: { "type": "pair", "sides": [{ "label": "Before", "figure": {...}, "caption": "..." }, ...] }`); return; }
  if (t === "drawing") { errs.push(`${where}: drawing is gone in ${FORMAT}; use "flow" (steps in order, with arrows) or "layers" (labelled rows with a tag each)`); return; }
  if (f.controls || f.rules) errs.push(`${where}: figures take no controls or rules in ${FORMAT}; show each case instead: a "pair", or a "table" with a row per case`);
  if (nested && t === "pair") { errs.push(`${where}: a pair's side holds ${SIDE_TYPES.join(", ")}, not another pair`); return; }
  if (!FIGURE_TYPES.includes(t)) { errs.push(`${where}: unknown figure type ${t}; use one of ${FIGURE_TYPES.join(", ")}`); return; }
  if (!nested && !isStr(f.title)) errs.push(`${where}: figure needs a title`);
  if (!nested && !(Array.isArray(f.cites) && f.cites.length)) errs.push(`${where}: figure has no cites`);
  switch (t) {
    case "screenshot":
      if (!spec.assets || !spec.assets[f.asset]) errs.push(`${where}: unknown asset ${f.asset}`);
      if (!isStr(f.alt) && !isStr(f.caption)) errs.push(`${where}: a screenshot needs alt or a caption (what it shows, for screen readers)`);
      if (f.ring && !(Array.isArray(f.ring) && f.ring.length === 4 && f.ring.every(Number.isFinite))) errs.push(`${where}: ring is [x, y, width, height] in image pixels`);
      if (f.scale !== undefined && !(typeof f.scale === "number" && f.scale > 0)) errs.push(`${where}: scale is a number above 0 (2 for a 2x capture)`);
      break;
    case "code":
      if (!isStr(f.path)) errs.push(`${where}: code needs path`);
      if (!Number.isInteger(f.start) || f.start < 1) errs.push(`${where}: code needs start, the first line number`);
      if (!Array.isArray(f.text) || !f.text.length || !f.text.every((x) => typeof x === "string")) errs.push(`${where}: code needs text, a list of lines`);
      else if (f.text.length > 40) errs.push(`${where}: code excerpt of ${f.text.length} lines; keep it to 40 or fewer`);
      if (f.mark && !["hl", "out"].includes(f.mark)) errs.push(`${where}: mark is "hl" or "out"`);
      if (f.marked && f.marked !== "all" && !(Array.isArray(f.marked) && f.marked.every((n) => Number.isInteger(n) && n >= f.start && n < f.start + (f.text || []).length))) errs.push(`${where}: marked is "all" or line numbers inside the excerpt`);
      if (f.repo !== undefined && !(spec.repos || {})[f.repo]) errs.push(`${where}: unknown repo ${f.repo}`);
      if (f.at !== undefined && !(typeof f.at === "string" && COMMIT.test(f.at))) errs.push(`${where}: at is a commit hash (7 to 40 hex characters)`);
      break;
    case "list":
      if (!Array.isArray(f.rows) || !f.rows.length || f.rows.length > 12 || !f.rows.every((r) => r && isStr(r.text))) errs.push(`${where}: list needs 1 to 12 rows, each with text`);
      else f.rows.forEach((r, i) => { if (r.mark !== undefined && !["out", "new", "acc"].includes(r.mark)) errs.push(`${where}.rows[${i}]: mark is "out", "new" or "acc"`); });
      break;
    case "table": {
      const cols = f.columns;
      if (!Array.isArray(cols) || cols.length < 2 || cols.length > 5) { errs.push(`${where}: table needs 2 to 5 columns`); break; }
      cols.forEach((c, i) => { if (!(isStr(c) || (c && typeof c === "object" && isStr(c.label)))) errs.push(`${where}.columns[${i}]: a column is its label, or { "label", "mono", "acc", "end", "fill" }`); });
      if (cols.filter((c) => c && typeof c === "object" && c.fill).length > 1) errs.push(`${where}: only one column may "fill"`);
      if (!Array.isArray(f.rows) || !f.rows.length || f.rows.length > 20) { errs.push(`${where}: table needs 1 to 20 rows`); break; }
      f.rows.forEach((r, i) => {
        if (!Array.isArray(r) || r.length !== cols.length) { errs.push(`${where}.rows[${i}]: a row is a list of ${cols.length} cells, one per column`); return; }
        r.forEach((c, j) => { if (!(typeof c === "string" || (c && typeof c === "object" && typeof c.text === "string"))) errs.push(`${where}.rows[${i}][${j}]: a cell is text, or { "text", "mono", "acc" }`); });
      });
      break;
    }
    case "chips":
      if (!Array.isArray(f.chips) || !f.chips.length || f.chips.length > 40 || !f.chips.every((c) => c && isStr(c.text))) errs.push(`${where}: chips needs 1 to 40 chips, each with text`);
      else f.chips.forEach((c, i) => { if (c.mark !== undefined && !["out", "changed", "new", "acc"].includes(c.mark)) errs.push(`${where}.chips[${i}]: mark is "out", "changed", "new" or "acc"`); });
      (f.legend || []).forEach((l, i) => { if (!l || !isStr(l.text) || !["out", "changed", "new", "acc", undefined].includes(l.mark)) errs.push(`${where}.legend[${i}]: a legend item is { "mark", "text" }`); });
      break;
    case "timeline":
      if (!Array.isArray(f.stops) || f.stops.length < 1 || f.stops.length > 6 || !f.stops.every((s) => s && isStr(s.label))) { errs.push(`${where}: timeline needs 1 to 6 stops, each with a label`); break; }
      f.stops.forEach((s, i) => {
        if (s.mark !== undefined && !["acc", "ask"].includes(s.mark)) errs.push(`${where}.stops[${i}]: mark is "acc" or "ask"`);
        tooLong(errs, `${where}.stops[${i}]`, "label", s.label, 40);
        tooLong(errs, `${where}.stops[${i}]`, "sub", s.sub, 60);
        tooLong(errs, `${where}.stops[${i}]`, "sub2", s.sub2, 60);
      });
      (f.bands || []).forEach((b, i) => { if (!(b && Number.isInteger(b.from) && Number.isInteger(b.to) && b.from >= 0 && b.to < f.stops.length && b.from <= b.to && isStr(b.label))) errs.push(`${where}.bands[${i}]: a band needs label, and from and to as stop indexes`); });
      break;
    case "flow":
      if (!Array.isArray(f.steps) || f.steps.length < 2 || f.steps.length > 6 || !f.steps.every((s) => s && isStr(s.label))) { errs.push(`${where}: flow needs 2 to 6 steps, each with a label`); break; }
      f.steps.forEach((s, i) => {
        if (s.mark !== undefined && !["plain", "acc", "new", "gone", "muted"].includes(s.mark)) errs.push(`${where}.steps[${i}]: mark is plain, acc, new, gone or muted`);
        if (i === 0 && s.via) errs.push(`${where}.steps[0]: via labels the arrow into a step; the first step has none`);
        tooLong(errs, `${where}.steps[${i}]`, "label", s.label, 40);
        tooLong(errs, `${where}.steps[${i}]`, "sub", s.sub, 60);
        tooLong(errs, `${where}.steps[${i}]`, "via", s.via, 16);
      });
      break;
    case "layers":
      if (!Array.isArray(f.rows) || !f.rows.length || f.rows.length > 5 || !f.rows.every((r) => r && isStr(r.label))) { errs.push(`${where}: layers needs 1 to 5 rows, each with a label`); break; }
      f.rows.forEach((r, i) => {
        if (!isStr(r.text) && !(r.items || []).length) errs.push(`${where}.rows[${i}]: a layer needs text, items, or both`);
        (r.items || []).forEach((it, j) => { if (!(isStr(it) || (it && isStr(it.text) && ["out", "changed", "new", "acc", undefined].includes(it.mark)))) errs.push(`${where}.rows[${i}].items[${j}]: an item is text, or { "text", "mark" }`); });
        tooLong(errs, `${where}.rows[${i}]`, "label", r.label, 24);
        tooLong(errs, `${where}.rows[${i}]`, "tag", r.tag, 24);
      });
      break;
    case "pair":
      if (!Array.isArray(f.sides) || f.sides.length < 2 || f.sides.length > 4) { errs.push(`${where}: pair needs 2 to 4 sides`); break; }
      f.sides.forEach((s, i) => {
        const w = `${where}.sides[${i}]`;
        if (!s || !isStr(s.label)) { errs.push(`${w}: a side needs a label ("Before", "After", "Today")`); return; }
        tooLong(errs, w, "label", s.label, 40);
        validateFigure(s.figure, w, errs, { nested: true });
      });
      break;
  }
}

function validate() {
  const errs = [];
  if (spec.format === "guided-plan/1") return [`format: this file is guided-plan/1 (lettered parts). ${MIGRATE}`];
  if (spec.format !== FORMAT) errs.push(`format: expected "${FORMAT}"`);
  for (const k of ["title", "intent", "base"]) if (!isStr(spec[k])) errs.push(`${k}: required`);
  if (spec.base && !/^[0-9a-f]{7,40}$/.test(spec.base)) errs.push("base: a commit hash (7 to 40 hex characters)");
  if (!spec.sources || typeof spec.sources !== "object") errs.push("sources: required");
  const known = new Set(Object.keys(spec.sources || {}));
  const cite = (where, ids, required) => {
    if (required && !(Array.isArray(ids) && ids.length)) errs.push(`${where}: no cites`);
    (ids || []).forEach((id) => { if (!known.has(id)) errs.push(`${where}: unknown source ${id}`); });
  };
  const citeFigure = (where, f) => {
    if (!f) return;
    cite(`${where}.figure`, f.cites, false);
    (f.sides || []).forEach((s, i) => cite(`${where}.figure.sides[${i}]`, s && s.figure && s.figure.cites, false));
  };
  for (const [id, s] of Object.entries(spec.sources || {})) {
    if (!["git", "file", "capture"].includes(s.kind)) errs.push(`sources.${id}: kind is git, file or capture`);
    if (!isStr(s.path)) errs.push(`sources.${id}: path required`);
    else if (s.kind !== "git" && !insideSpecDir(s.path)) errs.push(`sources.${id}: path ${s.path} must be inside the folder of the content file`);
    if (s.kind !== "capture" && !(isStr(s.quote) || (Array.isArray(s.quote) && s.quote.length && s.quote.every(isStr)))) errs.push(`sources.${id}: quote required (exact text inside the lines)`);
    if (s.lines !== undefined && !/^[1-9][0-9]*(-[1-9][0-9]*)?$/.test(String(s.lines))) errs.push(`sources.${id}: lines is "N" or "N-M"`);
    else if (s.lines !== undefined && String(s.lines).includes("-") && Number(String(s.lines).split("-")[1]) < Number(String(s.lines).split("-")[0])) errs.push(`sources.${id}: lines "${s.lines}" ends before it starts`);
    if (s.kind === "git") {
      if (s.at !== undefined && !/^[0-9a-f]{7,40}$/.test(s.at)) errs.push(`sources.${id}: at is a commit hash`);
      if (s.repo !== undefined && !(spec.repos || {})[s.repo]) errs.push(`sources.${id}: unknown repo ${s.repo}`);
    }
  }
  for (const [name, r] of Object.entries(spec.repos || {})) if (r.url !== undefined && !(typeof r.url === "string" && /^https:\/\/[^\s"<>]+$/.test(r.url))) errs.push(`repos.${name}: url must start with https://`);
  if (Object.keys(spec.repos || {}).length > 1) {
    for (const [id, s] of Object.entries(spec.sources || {})) if (s.kind === "git" && s.repo === undefined) errs.push(`sources.${id}: name its repo; this plan has more than one`);
  }
  for (const [id, a] of Object.entries(spec.assets || {})) {
    if (!isStr(a.file)) errs.push(`assets.${id}: file required`);
    else if (!insideSpecDir(a.file)) errs.push(`assets.${id}: ${a.file} must be inside the folder of the content file`);
    else if (!existsSync(join(specDir, a.file))) errs.push(`assets.${id}: ${a.file} not found next to the content file`);
    if (a.from !== undefined && !known.has(a.from)) errs.push(`assets.${id}: unknown source ${a.from}`);
  }
  cite("intent", spec.intentCites, false);
  if (!Array.isArray(spec.sections) || !spec.sections.length || spec.sections.length > 10) { errs.push("sections: 1 to 10"); return errs; }
  if (!Array.isArray(spec.overview) || !spec.overview.length) errs.push("overview: at least one row");
  const secIds = new Set();
  for (const s of spec.sections) {
    const sid = s.id;
    if (!SECTION_ID.test(sid || "")) errs.push(`section ${sid}: id is lower case letters, digits and dashes`);
    if (secIds.has(sid)) errs.push(`section ${sid}: id used twice`);
    secIds.add(sid);
    if (s.parts) { errs.push(`${sid}: "parts" are gone in ${FORMAT}. ${MIGRATE}`); continue; }
    if (!isStr(s.title)) errs.push(`${sid}: title required (the small label above the heading)`);
    if (!isStr(s.heading)) errs.push(`${sid}: heading required (the story in a few words)`);
    else if (words(s.heading) > MAX_HEADING_WORDS) errs.push(`${sid}: heading "${s.heading}" is ${words(s.heading)} words; say it in ${MAX_HEADING_WORDS} or fewer`);
    if (Array.isArray(s.lead)) errs.push(`${sid}: lead is one paragraph, a string; put more in a card`);
    else if (!isStr(s.lead)) errs.push(`${sid}: lead required (one paragraph)`);
    if (s.question !== undefined && !isStr(s.question)) errs.push(`${sid}: question is text`);
    cite(sid, s.cites, true);
    validateFigure(s.figure, sid, errs);
    citeFigure(sid, s.figure);
    const cards = s.cards || [];
    if (!Array.isArray(cards) || cards.length > 6) { errs.push(`${sid}: cards is a list of 0 to 6`); continue; }
    const cardIds = new Set();
    for (const c of cards) {
      const where = `${sid}.${c && c.id}`;
      if (!c || !SECTION_ID.test(c.id || "") || cardIds.has(c.id)) { errs.push(`${where}: card id is unique, lower case letters, digits and dashes`); continue; }
      cardIds.add(c.id);
      if (!isStr(c.title)) errs.push(`${where}: title required`);
      if (!Array.isArray(c.body) || !c.body.length || c.body.length > 3 || !c.body.every(isStr)) errs.push(`${where}: body is a list of 1 to 3 paragraphs`);
      cite(where, c.cites, true);
      if (c.figure !== undefined) { validateFigure(c.figure, where, errs); citeFigure(where, c.figure); }
      if (c.fold && !c.figure) errs.push(`${where}: fold folds the card's figure; this card has none`);
      if (c.wide !== undefined && typeof c.wide !== "boolean") errs.push(`${where}: wide is true or false`);
    }
    for (const a of s.files || []) {
      if (!isStr(a.name)) errs.push(`${sid}: a file needs name`);
      if (a.part) errs.push(`${sid}: file ${a.name} names a part; in ${FORMAT} a file points at a card with "card"`);
      if (a.card && !cardIds.has(a.card)) errs.push(`${sid}: file ${a.name} points at unknown card ${a.card}`);
      if (a.repo !== undefined && a.repo !== true && !(spec.repos || {})[a.repo]) errs.push(`${sid}: file ${a.name} names unknown repo ${a.repo}`);
      if (a.at !== undefined && !(typeof a.at === "string" && COMMIT.test(a.at))) errs.push(`${sid}: file ${a.name}: at is a commit hash (7 to 40 hex characters)`);
      if (a.path !== undefined && a.repo === undefined && !insideSpecDir(a.path)) errs.push(`${sid}: file ${a.name}: path ${a.path} must be inside the folder of the content file`);
    }
  }
  (spec.overview || []).forEach((o, i) => {
    if (!KINDS.includes(o.kind)) errs.push(`overview[${i}]: kind is one of ${KINDS.join(", ")}`);
    if (!isStr(o.text)) errs.push(`overview[${i}]: text required`);
    if (!secIds.has(o.section)) errs.push(`overview[${i}]: unknown section ${o.section}`);
    cite(`overview[${i}]`, o.cites, true);
  });
  return errs;
}

// ---------- words: what a reader sees ----------

// Words a new engineer would not know on day one, or that are house jargon. A plan may ban more with "ban".
const BANNED = ["doors?", "prefix(es)?", "seams?", "census", "specs?", "rulings?", "goldens?", "lanes?", "stub", "canonical"];
const NUMWORDS = { two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };

// Every string a figure draws: add(where, text, isCode, toy)
function figureStrings(f, add, toy) {
  if (!f) return;
  toy = toy || Boolean(f.toy);
  const a = (w, t, code) => add(w, t, code, toy);
  a("figure.title", f.title);
  a("figure.caption", f.caption);
  a("figure.alt", f.alt);
  switch (f.type) {
    case "list": (f.rows || []).forEach((r) => { a("row", r.text, r.mono); a("row", r.note); a("row", r.tag); }); break;
    case "table": {
      const cols = (f.columns || []).map((c) => (typeof c === "string" ? { label: c } : c || {}));
      cols.forEach((c) => a("column", c.label));
      (f.rows || []).forEach((r) => (Array.isArray(r) ? r : []).forEach((c, j) => {
        const cc = c && typeof c === "object" ? c : { text: c };
        a("cell", cc.text, cc.mono ?? (cols[j] || {}).mono);
      }));
      break;
    }
    case "chips": (f.chips || []).forEach((c) => a("chip", c.text, c.mono)); (f.legend || []).forEach((l) => a("legend", l.text)); break;
    case "timeline": (f.stops || []).forEach((s) => { a("stop", s.label, s.mono); a("stop", s.sub); a("stop", s.sub2); }); (f.bands || []).forEach((b) => a("band", b.label)); break;
    case "flow": (f.steps || []).forEach((s) => { a("step", s.label, s.mono); a("step", s.sub); a("step", s.via); }); break;
    case "layers": (f.rows || []).forEach((r) => { a("layer", r.label); a("layer", r.sub); a("layer", r.text); a("layer", r.tag); (r.items || []).forEach((it) => a("layer.item", typeof it === "string" ? it : it && it.text, typeof it === "object" && it ? it.mono : false)); }); break;
    case "pair": (f.sides || []).forEach((s) => { if (!s) return; const st = toy || Boolean(s.toy); add("side", s.label, false, st); add("side", s.note, false, st); add("side.caption", s.caption, false, st); figureStrings(s.figure, add, st); }); break;
  }
}

const figureCites = (f) => citesOfFigure(f, []);

function readerStrings() {
  // [where, text, citeIds or null, isCode, toy, inFigure, isTitle]
  const out = [];
  out.push(["title", spec.title, spec.intentCites || [], false, false]);
  out.push(["intent", spec.intent, spec.intentCites || [], false, false]);
  (spec.overview || []).forEach((o, i) => out.push([`overview[${i}]`, o.text, o.cites || [], false, false]));
  for (const s of spec.sections) {
    // The label cites nothing; the heading, question and lead lean on the section's cites and its figure's.
    const sc = [...(s.cites || []), ...figureCites(s.figure)];
    out.push([`${s.id}.title`, s.title, [], false, false, false, true]);
    out.push([`${s.id}.heading`, s.heading, sc, false, false, false, true]);
    if (s.question) out.push([`${s.id}.question`, s.question, s.cites || [], false, false]);
    out.push([`${s.id}.lead`, s.lead, s.cites || [], false, false]);
    figureStrings(s.figure, (w, t, code, toy) => { if (isStr(t)) out.push([`${s.id}.${w}`, t, sc, Boolean(code), toy, true]); });
    for (const c of s.cards || []) {
      const cc = [...(c.cites || []), ...figureCites(c.figure)];
      out.push([`${s.id}.${c.id}.title`, c.title, cc, false, false, false, true]);
      (c.body || []).forEach((b, i) => out.push([`${s.id}.${c.id}.body[${i}]`, b, c.cites || [], false, false]));
      figureStrings(c.figure, (w, t, code, toy) => { if (isStr(t)) out.push([`${s.id}.${c.id}.${w}`, t, cc, Boolean(code), toy, true]); });
    }
    (s.files || []).forEach((a) => a.note && out.push([`${s.id}.files`, a.note, null, false, false]));
  }
  return out;
}

const warns = [];
function lint() {
  const errs = [];
  const banned = [...BANNED, ...(spec.ban || []).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))].map((w) => new RegExp(`\\b${w}\\b`, "i"));
  for (const [where, text, ids, isCode, toy, inFigure, isTitle] of readerStrings()) {
    if (!isStr(text)) continue;
    // code in backticks and code-like names (mono) are not prose, so the word list does not apply to them
    const prose = isCode ? "" : text.replace(/`[^`]*`/g, " ");
    for (const re of banned) if (re.test(prose)) errs.push(`${where}: jargon "${prose.match(re)[0]}" in "${text}"; say it in plain words`);
    if (/—/.test(text) || /\s--\s/.test(text)) errs.push(`${where}: a dash standing in for a comma; use a comma, a colon or two sentences: "${text}"`);
    if (/(body|lead)/.test(where) && words(text) > 70) warns.push(`${where}: paragraph of ${words(text)} words`);
    for (const sent of text.split(/(?<=[.?!])\s+/)) if (words(sent) > 28) warns.push(`${where}: sentence over 28 words: "${sent.slice(0, 60)}..."`);
    if (inFigure && !isCode && /`/.test(text)) errs.push(`${where}: figure text is plain; drop the backticks: "${text}"`);
    if (isCode) continue;
    // A number a reader sees comes from a cited quote. Code in backticks, "PR 123", "#123", dates and years are exempt.
    const stripped = text.replace(/`[^`]*`/g, " ").replace(/\bPR \d+\b/g, " ").replace(/#\d+\b/g, " ").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").replace(/\b(19|20)\d{2}\b/g, " ");
    if (toy) {
      if (/\d/.test(stripped)) errs.push(`${where}: an illustration shows invented data, so it may not show a digit: "${text}"`);
      continue;
    }
    if (ids === null) continue;
    // Digits always count. Number words count too, except in titles and headings ("Two ways in").
    const nums = [...stripped.matchAll(/(?<![A-Za-z_.\d])(\d+(?:\.\d+)?)(?![\d])|\b(two|three|four|five|six|seven|eight|nine|ten)\b/gi)].filter((m) => m[1] || !isTitle).map((m) => (m[1] || m[2]).toLowerCase());
    if (!nums.length) continue;
    const quotes = ids.flatMap((id) => [].concat((spec.sources[id] || {}).quote || [])).join(" ").toLowerCase();
    for (const n of nums) {
      const alt = NUMWORDS[n] || Object.keys(NUMWORDS).find((k) => NUMWORDS[k] === n);
      const forms = [n, alt].filter(Boolean).map((x) => x.replace(/\./g, "\\."));
      if (!new RegExp(`(?<![\\d.])(${forms.join("|")})(?![\\d])`).test(quotes)) errs.push(`${where}: the number "${n}" is not in any quote ${ids.length ? "this text cites" : "(a section label cites nothing, so it may not hold a digit)"}: "${text}"`);
    }
  }
  return errs;
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
  const url = (name) => { const u = ((spec.repos || {})[name] || {}).url; return typeof u === "string" && /^https:\/\//.test(u) ? u.replace(/\/+$/, "") : null; };
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

const errs = validate();
if (!errs.length) errs.push(...lint());
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
