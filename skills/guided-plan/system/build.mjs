#!/usr/bin/env node
// Build a guided plan from its content file, and re-check the sources it cites.
//
//   node build.mjs plan.json plan.html            validate, lint, embed the screenshots, write one HTML file
//   node build.mjs --check plan.json              reopen every source: each quote sits in its cited lines,
//                                                 each code excerpt matches its commit, each file exists
//
//   --repo name=DIR    where the repository `name` (a key of "repos") is checked out; `--repo DIR` for a
//                      plan with one repository. Without it: "repos.<name>.path" (relative to the content
//                      file), else the git repository that holds the current directory.
//
// Needs Node 18+ and git. No dependencies. Only reads: files next to the content file, and
// `git show` / `git cat-file` at named commits. It never fetches. The same input gives the same bytes.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve as rpath } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { render, resolve, initialValues, figureIds, layoutDrawing, layoutTimeline, FORMAT } from "./renderer.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// ---------- arguments ----------

const argv = process.argv.slice(2);
const checkMode = argv.includes("--check");
const repoArgs = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--check") continue;
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
  console.error("usage: node build.mjs plan.json plan.html [--repo name=DIR]\n       node build.mjs --check plan.json [--repo name=DIR]");
  process.exit(code);
}
if (!pos[0] || (!checkMode && !pos[1])) usage(1);

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
  if (!dir) throw new Error(`no git repository for "${name || "the plan"}"; run from inside it or pass --repo ${name ? name + "=" : ""}DIR`);
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
}

// ---------- structure ----------

const SECTION_ID = /^[a-z][a-z0-9-]*$/;
const KINDS = ["Decided", "Change", "Kept", "Open"];
const STATIC = ["screenshot", "code", "list", "chips", "timeline", "drawing"];
const PLAYABLE = ["list", "chips", "timeline", "drawing"];
const isStr = (s) => typeof s === "string" && s.trim().length > 0;
// Control keys and values, and state values, end up in attributes and page pins: keep them to a safe set.
const SAFE = /^[A-Za-z0-9_.-]{1,40}$/;
// Longest text a button or a control's name can hold (they wrap on a phone, but must stay one line each).
const MAX_BUTTON = 20, MAX_CONTROL_LABEL = 16;
const tooLong = (errs, where, what, text, max) => { if (typeof text === "string" && text.length > max) errs.push(`${where}: ${what} "${text}" is ${text.length} characters; the most that fits is ${max}`); };

function validateFigure(f, where, errs, nested) {
  if (!f || typeof f !== "object") { errs.push(`${where}: no figure`); return; }
  if (!isStr(f.title) && !nested) errs.push(`${where}: figure needs a title`);
  if (!nested && !(Array.isArray(f.cites) && f.cites.length)) errs.push(`${where}: figure has no cites`);
  const t = f.type;
  if (nested && !STATIC.includes(t)) { errs.push(`${where}: a state holds one of ${STATIC.join(", ")}, not ${t}`); return; }
  if (nested && (f.controls || f.rules)) errs.push(`${where}: a state's figure takes no controls or rules`);
  switch (t) {
    case "screenshot":
      if (!spec.assets || !spec.assets[f.asset]) errs.push(`${where}: unknown asset ${f.asset}`);
      if (!isStr(f.alt) && !isStr(f.caption)) errs.push(`${where}: a screenshot needs alt or a caption (what it shows, for screen readers)`);
      if (f.ring && !(Array.isArray(f.ring) && f.ring.length === 4 && f.ring.every(Number.isFinite))) errs.push(`${where}: ring is [x, y, width, height] in image pixels`);
      break;
    case "code":
      if (!isStr(f.path)) errs.push(`${where}: code needs path`);
      if (!Number.isInteger(f.start) || f.start < 1) errs.push(`${where}: code needs start, the first line number`);
      if (!Array.isArray(f.text) || !f.text.length || !f.text.every((x) => typeof x === "string")) errs.push(`${where}: code needs text, a list of lines`);
      else if (f.text.length > 40) errs.push(`${where}: code excerpt of ${f.text.length} lines; keep it to 40 or fewer`);
      if (f.mark && !["hl", "out"].includes(f.mark)) errs.push(`${where}: mark is "hl" or "out"`);
      if (f.marked && f.marked !== "all" && !(Array.isArray(f.marked) && f.marked.every((n) => Number.isInteger(n) && n >= f.start && n < f.start + (f.text || []).length))) errs.push(`${where}: marked is "all" or line numbers inside the excerpt`);
      if (f.repo !== undefined && !(spec.repos || {})[f.repo]) errs.push(`${where}: unknown repo ${f.repo}`);
      break;
    case "list":
      if (!Array.isArray(f.rows) || !f.rows.length || !f.rows.every((r) => isStr(r.text))) errs.push(`${where}: list needs rows, each with text`);
      break;
    case "chips":
      if (!Array.isArray(f.chips) || !f.chips.length || !f.chips.every((c) => isStr(c.text))) errs.push(`${where}: chips needs chips, each with text`);
      break;
    case "timeline":
      if (!Array.isArray(f.stops) || f.stops.length < 1 || f.stops.length > 6 || !f.stops.every((s) => isStr(s.label))) errs.push(`${where}: timeline needs 1 to 6 stops, each with a label`);
      else if (!(f.bands || []).every((b) => Number.isInteger(b.from) && Number.isInteger(b.to) && b.from >= 0 && b.to < f.stops.length && b.from <= b.to && isStr(b.label))) errs.push(`${where}: band needs label, and from and to as stop indexes`);
      else {
        const T = layoutTimeline(f);
        for (const st of f.stops) for (const k of ["label", "sub", "sub2"]) tooLong(errs, where, `timeline ${k}`, st[k], T.stopChars);
        for (const st of f.stops) for (const v of (f.rules || []).map((r) => r.then && r.then.set && st.id ? r.then.set[st.id] : undefined)) tooLong(errs, where, "timeline sub", v, T.stopChars);
        T.bands.forEach((b) => tooLong(errs, where, "band label", b.label, b.chars));
      }
      break;
    case "drawing": {
      if (!Array.isArray(f.rows) || !f.rows.length || f.rows.length > 5) { errs.push(`${where}: drawing needs 1 to 5 rows`); break; }
      for (const r of f.rows) if (!Array.isArray(r.nodes) || !r.nodes.length || r.nodes.length > 4 || !r.nodes.every((n) => isStr(n.text))) errs.push(`${where}: each drawing row needs 1 to 4 boxes, each with text`);
      const L = layoutDrawing(f);
      L.errs.forEach((e) => errs.push(`${where}: ${e}`));
      break;
    }
    case "toggle":
    case "steps": {
      const [lo, hi] = t === "toggle" ? [2, 4] : [2, 8];
      if (!Array.isArray(f.states) || f.states.length < lo || f.states.length > hi) { errs.push(`${where}: ${t} needs ${lo} to ${hi} states`); break; }
      const seen = new Set();
      f.states.forEach((s, i) => {
        if (!isStr(s.value) || !SAFE.test(s.value) || seen.has(s.value)) errs.push(`${where}.states[${i}]: needs a unique value of letters, digits, dot, dash or underscore`);
        seen.add(s.value);
        if (!isStr(s.label)) errs.push(`${where}.states[${i}]: needs a label (the button text)`);
        tooLong(errs, `${where}.states[${i}]`, "label", s.label, MAX_BUTTON);
        if (!isStr(s.caption)) errs.push(`${where}.states[${i}]: needs a caption`);
        validateFigure(s.figure, `${where}.states[${i}]`, errs, true);
      });
      if (f.initial !== undefined && !seen.has(f.initial)) errs.push(`${where}: initial names no state`);
      tooLong(errs, where, "control label", f.label, MAX_CONTROL_LABEL);
      if (f.controls || f.rules) errs.push(`${where}: ${t} makes its own control; use states`);
      break;
    }
    default:
      errs.push(`${where}: unknown figure type ${t}; use one of ${[...STATIC, "toggle", "steps"].join(", ")}`);
  }
  if (f.controls || f.rules) {
    if (!PLAYABLE.includes(t)) { errs.push(`${where}: only ${PLAYABLE.join(", ")} take controls and rules`); return; }
    const ids = figureIds(f);
    const controls = f.controls || [];
    for (const c of controls) {
      if (!isStr(c.key) || !isStr(c.label) || !Array.isArray(c.options) || c.options.length < 2 || !c.options.every((o) => isStr(o.value) && isStr(o.text))) { errs.push(`${where}: a control needs key, label and 2 or more options, each with value and text`); continue; }
      if (!SAFE.test(c.key) || !c.options.every((o) => SAFE.test(o.value))) errs.push(`${where}: control ${c.key}: key and values are letters, digits, dot, dash or underscore`);
      if (c.key === "state") errs.push(`${where}: "state" is the key toggle and steps use; name the control something else`);
      if (new Set(c.options.map((o) => o.value)).size !== c.options.length) errs.push(`${where}: control ${c.key} has the same value twice`);
      tooLong(errs, where, "control label", c.label, MAX_CONTROL_LABEL);
      c.options.forEach((o) => tooLong(errs, where, "button", o.text, MAX_BUTTON));
    }
    if (f.initial !== undefined) {
      if (typeof f.initial !== "object" || f.initial === null || Array.isArray(f.initial)) errs.push(`${where}: initial is { control key: value }`);
      else for (const [k, v] of Object.entries(f.initial)) {
        const c = controls.find((x) => x.key === k);
        if (!c) errs.push(`${where}: initial names unknown control ${k}`);
        else if (!c.options.some((o) => o.value === v)) errs.push(`${where}: initial names unknown value ${k}=${v}`);
      }
    }
    for (const r of f.rules || []) {
      for (const [k, v] of Object.entries(r.if || {})) {
        const c = controls.find((x) => x.key === k);
        if (!c) errs.push(`${where}: rule names unknown control ${k}`);
        else if (!c.options.some((o) => o.value === v)) errs.push(`${where}: rule names unknown value ${k}=${v}`);
      }
      const then = r.then || {};
      (then.gone || []).forEach((id) => { if (!ids.el.includes(id)) errs.push(`${where}: rule ghosts unknown element ${id}${ids.opt.includes(id) ? " (it is optional; use show)" : ""}`); });
      (then.show || []).forEach((id) => { if (!ids.opt.includes(id)) errs.push(`${where}: rule shows ${id}, which is not an optional element`); });
      Object.keys(then.set || {}).forEach((id) => { if (!ids.slot.includes(id)) errs.push(`${where}: rule sets text of unknown element ${id}`); });
    }
    const rules = f.rules || [];
    if (rules.length && rules[rules.length - 1].if !== undefined && Object.keys(rules[rules.length - 1].if).length) warns.push(`${where}: the last rule has a condition; some control values may match nothing`);
    if (controls.length) {
      const combos = controls.reduce((acc, c) => acc.flatMap((a) => c.options.map((o) => ({ ...a, [c.key]: o.value }))), [{}]);
      combos.forEach((v) => { if (!resolve(f, v).caption && !f.caption) errs.push(`${where}: no caption for ${JSON.stringify(v)}`); });
      initialValues(f);
    }
  }
}

function validate() {
  const errs = [];
  if (spec.format !== FORMAT) errs.push(`format: expected "${FORMAT}"`);
  for (const k of ["title", "intent", "base"]) if (!isStr(spec[k])) errs.push(`${k}: required`);
  if (spec.base && !/^[0-9a-f]{7,40}$/.test(spec.base)) errs.push("base: a commit hash (7 to 40 hex characters)");
  if (!spec.sources || typeof spec.sources !== "object") errs.push("sources: required");
  const known = new Set(Object.keys(spec.sources || {}));
  const cite = (where, ids, required) => {
    if (required && !(Array.isArray(ids) && ids.length)) errs.push(`${where}: no cites`);
    (ids || []).forEach((id) => { if (!known.has(id)) errs.push(`${where}: unknown source ${id}`); });
  };
  for (const [id, s] of Object.entries(spec.sources || {})) {
    if (!["git", "file", "capture"].includes(s.kind)) errs.push(`sources.${id}: kind is git, file or capture`);
    if (!isStr(s.path)) errs.push(`sources.${id}: path required`);
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
    else if (!existsSync(join(specDir, a.file))) errs.push(`assets.${id}: ${a.file} not found next to the content file`);
    if (a.from !== undefined && !known.has(a.from)) errs.push(`assets.${id}: unknown source ${a.from}`);
  }
  cite("intent", spec.intentCites, false);
  if (!Array.isArray(spec.sections) || !spec.sections.length || spec.sections.length > 10) { errs.push("sections: 1 to 10"); return errs; }
  if (!Array.isArray(spec.overview) || !spec.overview.length) errs.push("overview: at least one row");
  const secIds = new Set();
  for (const s of spec.sections) {
    if (!SECTION_ID.test(s.id || "")) errs.push(`section ${s.id}: id is lower case letters, digits and dashes`);
    if (secIds.has(s.id)) errs.push(`section ${s.id}: id used twice`);
    secIds.add(s.id);
    if (!isStr(s.title)) errs.push(`${s.id}: title required`);
    if (!Array.isArray(s.parts) || !s.parts.length || s.parts.length > 6) { errs.push(`${s.id}: 1 to 6 parts`); continue; }
    const partIds = new Set();
    for (const p of s.parts) {
      const where = `${s.id}.${p.id}`;
      if (!SECTION_ID.test(p.id || "") || partIds.has(p.id)) errs.push(`${where}: part id is unique, lower case letters, digits and dashes`);
      partIds.add(p.id);
      if (!isStr(p.title)) errs.push(`${where}: title required`);
      if (!Array.isArray(p.body) || !p.body.length || !p.body.every(isStr)) errs.push(`${where}: body is a list of paragraphs`);
      cite(where, p.cites, true);
      if (p.figure) {
        cite(`${where}.figure`, p.figure.cites, false);
        for (const st of p.figure.states || []) cite(`${where}.figure.state`, st.figure && st.figure.cites, false);
      }
      validateFigure(p.figure, where, errs, false);
    }
    for (const a of s.files || []) {
      if (!isStr(a.name)) errs.push(`${s.id}: a file needs name`);
      if (a.part && !partIds.has(a.part)) errs.push(`${s.id}: file ${a.name} points at unknown part ${a.part}`);
      if (a.repo !== undefined && a.repo !== true && !(spec.repos || {})[a.repo]) errs.push(`${s.id}: file ${a.name} names unknown repo ${a.repo}`);
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

function figureStrings(f, add) {
  if (!f) return;
  add("figure.title", f.title);
  add("figure.caption", f.caption);
  add("figure.alt", f.alt);
  (f.controls || []).forEach((c) => { add("control", c.label); c.options.forEach((o) => add("control", o.text)); });
  (f.rules || []).forEach((r) => { const t = r.then || {}; add("rule.caption", t.caption); Object.values(t.set || {}).forEach((v) => add("rule.set", v)); });
  (f.rows || []).forEach((r) => {
    if (r.nodes) { add("row.label", r.label); r.nodes.forEach((n) => { add("box", n.text); add("box", n.sub); }); }
    else { add("row", r.text, r.mono); add("row", r.note); add("row", r.tag); }
  });
  (f.edges || []).forEach((e) => add("arrow", e.text));
  (f.chips || []).forEach((c) => add("chip", c.text));
  (f.stops || []).forEach((s) => { add("stop", s.label, s.mono); add("stop", s.sub); add("stop", s.sub2); });
  (f.bands || []).forEach((b) => add("band", b.label));
  (f.states || []).forEach((s) => { add("state", s.label); add("state.caption", s.caption); figureStrings(s.figure, add); });
}

function readerStrings() {
  // [where, text, citeIds or null, isCode, toy, inFigure, isTitle]
  const out = [];
  out.push(["title", spec.title, spec.intentCites || [], false, false]);
  out.push(["intent", spec.intent, spec.intentCites || [], false, false]);
  (spec.overview || []).forEach((o, i) => out.push([`overview[${i}]`, o.text, o.cites || [], false, false]));
  for (const s of spec.sections) {
    out.push([`${s.id}.title`, s.title, [], false, false, false, true]);
    for (const p of s.parts) {
      const c = [...(p.cites || []), ...((p.figure && p.figure.cites) || [])];
      for (const st of (p.figure && p.figure.states) || []) c.push(...((st.figure && st.figure.cites) || []));
      out.push([`${s.id}.${p.id}.title`, p.title, c, false, false, false, true]);
      (p.body || []).forEach((b, i) => out.push([`${s.id}.${p.id}.body[${i}]`, b, p.cites || [], false, false]));
      const toy = Boolean(p.figure && p.figure.toy);
      figureStrings(p.figure, (w, t, code) => { if (isStr(t)) out.push([`${s.id}.${p.id}.${w}`, t, c, Boolean(code), toy, true]); });
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
    // code in backticks and code-like names (mono) are not prose, so the word list does not apply to them
    const prose = isCode ? "" : text.replace(/`[^`]*`/g, " ");
    for (const re of banned) if (re.test(prose)) errs.push(`${where}: jargon "${prose.match(re)[0]}" in "${text}"; say it in plain words`);
    if (/—/.test(text) || /\s--\s/.test(text)) errs.push(`${where}: a dash standing in for a comma; use a comma, a colon or two sentences: "${text}"`);
    if (/body/.test(where) && text.split(/\s+/).length > 70) warns.push(`${where}: paragraph of ${text.split(/\s+/).length} words`);
    for (const sent of text.split(/(?<=[.?!])\s+/)) if (sent.split(/\s+/).length > 28) warns.push(`${where}: sentence over 28 words: "${sent.slice(0, 60)}..."`);
    if (inFigure && !isCode && /`/.test(text)) errs.push(`${where}: figure text is plain; drop the backticks: "${text}"`);
    if (isCode) continue;
    // A number a reader sees comes from a cited quote. Code in backticks, "PR 123", "#123", dates and years are exempt.
    const stripped = text.replace(/`[^`]*`/g, " ").replace(/\bPR \d+\b/g, " ").replace(/#\d+\b/g, " ").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").replace(/\b(19|20)\d{2}\b/g, " ");
    if (toy) {
      if (/\d/.test(stripped)) errs.push(`${where}: an illustration shows invented data, so it may not show a digit: "${text}"`);
      continue;
    }
    if (ids === null) continue;
    // Digits always count. Number words count too, except in section and part titles ("Two ways in").
    const nums = [...stripped.matchAll(/(?<![A-Za-z_.\d])(\d+(?:\.\d+)?)(?![\d])|\b(two|three|four|five|six|seven|eight|nine|ten)\b/gi)].filter((m) => m[1] || !isTitle).map((m) => (m[1] || m[2]).toLowerCase());
    if (!nums.length) continue;
    const quotes = ids.flatMap((id) => [].concat((spec.sources[id] || {}).quote || [])).join(" ").toLowerCase();
    for (const n of nums) {
      const alt = NUMWORDS[n] || Object.keys(NUMWORDS).find((k) => NUMWORDS[k] === n);
      const forms = [n, alt].filter(Boolean).map((x) => x.replace(/\./g, "\\."));
      if (!new RegExp(`(?<![\\d.])(${forms.join("|")})(?![\\d])`).test(quotes)) errs.push(`${where}: the number "${n}" is not in any quote this part cites: "${text}"`);
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
  for (const sec of spec.sections) for (const p of sec.parts) {
    const f = p.figure;
    if (f.type === "code") codeFigs.push(f);
    for (const st of f.states || []) if (st.figure.type === "code") codeFigs.push(st.figure);
  }
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
const outPath = rpath(pos[1]);
const html = render(spec, {
  css: readFileSync(join(here, "guide.css"), "utf8"),
  runtime: readFileSync(join(here, "runtime.js"), "utf8"),
  assets: loadAssets(),
  links: linksFor(),
});
writeFileSync(outPath, html);
console.log(`${pos[1]}  ${Buffer.byteLength(html)} bytes  sha256 ${createHash("sha256").update(html).digest("hex").slice(0, 16)}`);
