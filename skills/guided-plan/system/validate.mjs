// The checks a guided-plan content file must pass before it is drawn: its shape (validate), and the
// words and numbers a reader sees (lint). Pure: no file system, no process, no I/O, so it runs in
// Node, a browser or a Worker. build.mjs reads the files and runs it; anything that has to look at
// the disk is a function the caller passes in (see validate's `host`).
import { citesOfFigure, FORMAT, FIGURE_TYPES, SIDE_TYPES, laneWordsTooWide } from "./renderer.mjs";
import { unknownFields, limitErrors, limitsOf, MAP_KEY, DEFAULT_LIMITS } from "./schema.mjs";

export { DEFAULT_LIMITS, limitsOf };

// Lookups by a key the content file chose are own-property lookups, so "constructor" or
// "__proto__" never finds something the file did not write.
export const ownIn = (o, k) => (o && typeof o === "object" && typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

// ---------- structure ----------

const SECTION_ID = /^[a-z][a-z0-9-]*$/;
const KINDS = ["Decided", "Change", "Kept", "Open", "Ask"];
const AUDIENCES = ["engineering", "business"];
const BUSINESS = "a guided plan for business stakeholders";
const isStr = (s) => typeof s === "string" && s.trim().length > 0;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// The entries of a map that is an object; any other value is reported once, by the map check.
const entries = (v) => (isObj(v) ? Object.entries(v) : []);
// A list, or nothing; null and undefined are an empty list, as they always were.
const notList = (v) => v !== undefined && v !== null && !Array.isArray(v);
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const MAX_HEADING_WORDS = 8;
const RESERVED_KEYS = ["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf"];
// Page ids the renderer uses itself; a section id may not be one of them.
const RESERVED_SECTION_IDS = ["theme", "read"];
// Card ids the renderer uses inside a section ("<section>-h" is the heading, "<section>-f" the figure).
const RESERVED_CARD_IDS = ["h", "f", "read"];
const COMMIT = /^[0-9a-f]{7,40}$/;
const tooLong = (errs, where, what, text, max) => { if (typeof text === "string" && text.length > max) errs.push(`${where}: ${what} "${errs.clip(text)}" is ${text.length} characters; keep it to ${max} or fewer`); };


// Text cut to at most n characters, never through a surrogate pair.
function clip(t, n) {
  t = String(t);
  if (t.length <= n) return t;
  let end = n;
  if (end > 0 && t.charCodeAt(end - 1) >= 0xd800 && t.charCodeAt(end - 1) <= 0xdbff) end--;
  return t.slice(0, end) + "…";
}

// Where errors (or warnings) go: the first maxErrors are kept, each at most maxErrorChars (its start
// and end, with "…" between), and the rest only counted. Error text quotes the plan, so a host that
// shows it must escape it like any other untrusted text.
function sink(L) {
  const kept = [];
  let more = 0;
  const head = Math.ceil((L.maxErrorChars * 2) / 3);
  const cut = (m) => (m.length <= L.maxErrorChars ? m : clip(m, head) + m.slice(m.length - Math.max(0, L.maxErrorChars - head - 1)));
  return {
    push(m) { if (kept.length < L.maxErrors) kept.push(cut(String(m))); else more++; },
    // A list, one at a time (never spread: a list can be longer than the stack), and how many
    // its producer left out.
    pushAll(list, left = 0) { for (const m of list) this.push(m); more += left; },
    get length() { return kept.length + more; },
    clip: (t) => clip(t, L.maxEchoChars),
    list: () => (more ? [...kept, `…and ${more} more`] : kept),
  };
}

// A path the content file names beside itself stays inside its folder. This is the check by name
// alone, so it refuses anything a host might resolve somewhere else: a leading "/", any backslash,
// any ":" (a scheme such as https: or file:, a drive such as C:), any "%" (an escaped ".." or "/"),
// any control character, and a ".." that climbs out. build.mjs passes its own check, which also
// follows symlinks on the disk.
export function insideFolderByName(p) {
  if (typeof p !== "string" || !p || p.startsWith("/") || /[\\:%\u0000-\u001f\u007f]/.test(p)) return false;
  let depth = 0;
  for (const part of p.split("/")) {
    if (part === "..") { if (--depth < 0) return false; }
    else if (part && part !== ".") depth++;
  }
  return true;
}

// What a guided-plan/1 file needs to become a guided-plan/2 file, said once.
const MIGRATE = `guided-plan/2 draws each section as one card with its story on the left and its figures on the right: give each section "heading" (a few words), "lead" (one paragraph), "cites" and one "figure"; its other parts become "cards": [{ "id", "title", "body", "cites", "figure"? }]. "parts" are gone. A toggle or steps becomes a "pair" figure (each state side by side), a drawing becomes a "flow" or "layers" figure, and controls and rules are gone. See SKILL.md, section 6`;

// One part of a screen: what its kind takes, and nothing it does not.
const SCREEN_TEXT = ["heading", "text", "box", "button", "message", "status"];
const SCREEN_MARKS = ["new", "changed", "out", "acc"];
const SCREEN_FITS = { heading: 80, text: 200, box: 120, button: 40, message: 240, status: 120 };
function validateScreenParts(parts, where, errs, inCard) {
  if (!Array.isArray(parts) || !parts.length) { errs.push(`${where}: ${inCard ? "a card holds parts" : "a screen needs parts"}: [{ "as": "heading", "text": "..." }, ...]`); return; }
  parts.forEach((p, i) => {
    const w = `${where}[${i}]`;
    if (!isObj(p)) { errs.push(`${w}: a part is { "as", ... }`); return; }
    const as = p.as;
    if (!["heading", "text", "box", "button", "message", "status", "menu", "card"].includes(as)) { errs.push(`${w}: "as" is heading, text, box, button, message, status, menu or card`); return; }
    if (inCard && as === "card") { errs.push(`${w}: a card holds parts one level deep; no card inside a card`); return; }
    if (SCREEN_TEXT.includes(as)) {
      if (!isStr(p.text)) errs.push(`${w}: a ${as} needs text`);
      else tooLong(errs, w, "text", p.text, SCREEN_FITS[as]);
    } else if (p.text !== undefined) errs.push(`${w}: a ${as} takes no text; ${as === "menu" ? "its words are its items" : "its words are in its parts"}`);
    if (p.by !== undefined) { if (as !== "message") errs.push(`${w}: "by" is the author of a message; a ${as} takes none`); else if (!isStr(p.by)) errs.push(`${w}: by is text`); else tooLong(errs, w, "by", p.by, 60); }
    if (p.pin !== undefined && (as !== "box" || typeof p.pin !== "boolean")) errs.push(`${w}: "pin" is true or false, on a box`);
    if (as === "menu") {
      if (!Array.isArray(p.items) || !p.items.length || !p.items.every(isStr)) errs.push(`${w}: a menu needs items, a list of words`);
      else p.items.forEach((t, j) => tooLong(errs, `${w}.items[${j}]`, "item", t, 40));
    } else if (p.items !== undefined) errs.push(`${w}: "items" belong to a menu; a ${as} takes none`);
    if (p.mark !== undefined && !SCREEN_MARKS.includes(p.mark)) errs.push(`${w}: mark is "new", "changed", "out" or "acc"`);
    if (as === "card") validateScreenParts(p.parts, `${w}.parts`, errs, true);
    else if (p.parts !== undefined) errs.push(`${w}: "parts" belong to a card; a ${as} takes none`);
  });
}

function validateFigure(spec, f, where, errs, { nested = false } = {}) {
  if (!f || typeof f !== "object") { errs.push(`${where}: no figure`); return; }
  const t = f.type;
  if (t === "code" && spec.audience === "business") { errs.push(`${where}: ${BUSINESS} shows no code; show what a person sees with a "screen" (a mock-up) or a "screenshot", who does what with "lanes", or the facts as a "list" or "table"`); return; }
  if (["toggle", "steps"].includes(t)) { errs.push(`${where}: ${t} is gone in ${FORMAT}; draw the states side by side with a "pair" figure: { "type": "pair", "sides": [{ "label": "Before", "figure": {...}, "caption": "..." }, ...] }`); return; }
  if (t === "drawing") { errs.push(`${where}: drawing is gone in ${FORMAT}; use "flow" (steps in order, with arrows) or "layers" (labelled rows with a tag each)`); return; }
  if (f.controls || f.rules) errs.push(`${where}: figures take no controls or rules in ${FORMAT}; show each case instead: a "pair", or a "table" with a row per case`);
  if (nested && t === "pair") { errs.push(`${where}: a pair's side holds ${SIDE_TYPES.join(", ")}, not another pair`); return; }
  if (!FIGURE_TYPES.includes(t)) { errs.push(`${where}: unknown figure type ${t}; use one of ${FIGURE_TYPES.join(", ")}`); return; }
  if (!nested && !isStr(f.title)) errs.push(`${where}: figure needs a title`);
  if (!nested && !(Array.isArray(f.cites) && f.cites.length)) errs.push(`${where}: figure has no cites`);
  switch (t) {
    case "screenshot":
      if (!ownIn(spec.assets, f.asset)) errs.push(`${where}: unknown asset ${f.asset}`);
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
      if (f.repo !== undefined && !ownIn(spec.repos, f.repo)) errs.push(`${where}: unknown repo ${f.repo}`);
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
      if (notList(f.legend)) errs.push(`${where}: legend is a list`);
      else (f.legend || []).forEach((l, i) => { if (!l || !isStr(l.text) || !["out", "changed", "new", "acc", undefined].includes(l.mark)) errs.push(`${where}.legend[${i}]: a legend item is { "mark", "text" }`); });
      break;
    case "timeline":
      if (!Array.isArray(f.stops) || f.stops.length < 1 || f.stops.length > 6 || !f.stops.every((s) => s && isStr(s.label))) { errs.push(`${where}: timeline needs 1 to 6 stops, each with a label`); break; }
      f.stops.forEach((s, i) => {
        if (s.mark !== undefined && !["acc", "ask"].includes(s.mark)) errs.push(`${where}.stops[${i}]: mark is "acc" or "ask"`);
        tooLong(errs, `${where}.stops[${i}]`, "label", s.label, 40);
        tooLong(errs, `${where}.stops[${i}]`, "sub", s.sub, 60);
        tooLong(errs, `${where}.stops[${i}]`, "sub2", s.sub2, 60);
      });
      if (notList(f.bands)) errs.push(`${where}: bands is a list`);
      else (f.bands || []).forEach((b, i) => { if (!(b && Number.isInteger(b.from) && Number.isInteger(b.to) && b.from >= 0 && b.to < f.stops.length && b.from <= b.to && isStr(b.label))) errs.push(`${where}.bands[${i}]: a band needs label, and from and to as stop indexes`); });
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
        if (notList(r.items)) errs.push(`${where}.rows[${i}]: items is a list`);
        else if (!isStr(r.text) && !(r.items || []).length) errs.push(`${where}.rows[${i}]: a layer needs text, items, or both`);
        if (Array.isArray(r.items)) r.items.forEach((it, j) => { if (!(isStr(it) || (it && isStr(it.text) && ["out", "changed", "new", "acc", undefined].includes(it.mark)))) errs.push(`${where}.rows[${i}].items[${j}]: an item is text, or { "text", "mark" }`); });
        tooLong(errs, `${where}.rows[${i}]`, "label", r.label, 24);
        tooLong(errs, `${where}.rows[${i}]`, "tag", r.tag, 24);
      });
      break;
    case "screen":
      if (f.address !== undefined && !isStr(f.address)) errs.push(`${where}: address is text, the bar at the top of the mock-up`);
      else tooLong(errs, where, "address", f.address, 80);
      validateScreenParts(f.parts, `${where}.parts`, errs, false);
      break;
    case "lanes": {
      if (!Array.isArray(f.lanes) || f.lanes.length < 2 || f.lanes.length > 5 || !f.lanes.every(isStr)) { errs.push(`${where}: lanes needs 2 to 5 lanes, each a label (a person or a role)`); break; }
      f.lanes.forEach((l, i) => tooLong(errs, `${where}.lanes[${i}]`, "label", l, 40));
      if (!Array.isArray(f.steps) || f.steps.length < 2 || f.steps.length > 12 || !f.steps.every((s) => isObj(s) && isStr(s.text))) { errs.push(`${where}: lanes needs 2 to 12 steps, each { "lane", "text" }`); break; }
      f.steps.forEach((s, i) => {
        if (!(Number.isInteger(s.lane) && s.lane >= 0 && s.lane < f.lanes.length)) errs.push(`${where}.steps[${i}]: lane is the index of its lane, 0 to ${f.lanes.length - 1}`);
        if (s.mark !== undefined && !["acc", "new"].includes(s.mark)) errs.push(`${where}.steps[${i}]: mark is "acc" or "new"`);
        tooLong(errs, `${where}.steps[${i}]`, "text", s.text, 60);
      });
      break;
    }
    case "pair":
      if (!Array.isArray(f.sides) || f.sides.length < 2 || f.sides.length > 4) { errs.push(`${where}: pair needs 2 to 4 sides`); break; }
      f.sides.forEach((s, i) => {
        const w = `${where}.sides[${i}]`;
        if (!s || !isStr(s.label)) { errs.push(`${w}: a side needs a label ("Before", "After", "Today")`); return; }
        tooLong(errs, w, "label", s.label, 40);
        validateFigure(spec, s.figure, w, errs, { nested: true });
      });
      break;
  }
}

function validateUnguarded(spec, host) {
  const { insideFolder = insideFolderByName, fileExists = () => true, limits } = isObj(host) ? host : {};
  const L = limitsOf(limits);
  const errs = sink(L);
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return ["the content file is a JSON object"];
  if (spec.format === "guided-plan/1") return [`format: this file is guided-plan/1 (lettered parts). ${MIGRATE}`];
  if (spec.format !== FORMAT) errs.push(`format: expected "${FORMAT}"`);
  const unknown = unknownFields(spec, { max: L.maxErrors + 1 });
  errs.pushAll(unknown, unknown.more);
  // Over a limit: say so and stop, before any other check spends time on the file.
  const over = limitErrors(spec, L, { max: L.maxErrors + 1 });
  if (over.over) { errs.pushAll(over.errors, over.more); return errs.list(); }
  // Keys of sources, assets and repos become ids and lookups: a safe set, and never a name every object already has.
  const keyRe = new RegExp(MAP_KEY);
  for (const m of ["sources", "assets", "repos"]) {
    const v = spec[m];
    if (v === undefined) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) { errs.push(`${m}: an object keyed by id`); continue; }
    for (const k of Object.keys(v)) if (!keyRe.test(k) || RESERVED_KEYS.includes(k)) errs.push(`${m}.${k}: a key is 1 to 64 letters, digits, dot, dash or underscore, starting with a letter or digit, and not ${RESERVED_KEYS.join(", ")}`);
  }
  for (const k of ["title", "intent", "base"]) if (!isStr(spec[k])) errs.push(`${k}: required`);
  if (spec.audience !== undefined && !AUDIENCES.includes(spec.audience)) errs.push(`audience: "engineering" (the default, when it is left out) or "business"`);
  if (spec.base && !/^[0-9a-f]{7,40}$/.test(spec.base)) errs.push("base: a commit hash (7 to 40 hex characters)");
  if (!spec.sources || typeof spec.sources !== "object") errs.push("sources: required");
  const known = new Set(entries(spec.sources).map(([k]) => k));
  const cite = (where, ids, required) => {
    if (required && !(Array.isArray(ids) && ids.length)) errs.push(`${where}: no cites`);
    if (notList(ids)) { if (!required) errs.push(`${where}: cites is a list of source ids`); return; }
    (ids || []).forEach((id) => { if (!known.has(id)) errs.push(`${where}: unknown source ${id}`); });
  };
  const citeFigure = (where, f) => {
    if (!f) return;
    cite(`${where}.figure`, f.cites, false);
    (Array.isArray(f.sides) ? f.sides : []).forEach((s, i) => cite(`${where}.figure.sides[${i}]`, s && s.figure && s.figure.cites, false));
  };
  for (const [id, s] of entries(spec.sources)) {
    if (!isObj(s)) { errs.push(`sources.${id}: a source is an object`); continue; }
    if (!["git", "file", "capture"].includes(s.kind)) errs.push(`sources.${id}: kind is git, file or capture`);
    if (!isStr(s.path)) errs.push(`sources.${id}: path required`);
    else if (s.kind !== "git" && !insideFolder(s.path)) errs.push(`sources.${id}: path ${s.path} must be inside the folder of the content file`);
    if (s.kind !== "capture" && !(isStr(s.quote) || (Array.isArray(s.quote) && s.quote.length && s.quote.every(isStr)))) errs.push(`sources.${id}: quote required (exact text inside the lines)`);
    if (s.lines !== undefined && !/^[1-9][0-9]*(-[1-9][0-9]*)?$/.test(String(s.lines))) errs.push(`sources.${id}: lines is "N" or "N-M"`);
    else if (s.lines !== undefined && String(s.lines).includes("-") && Number(String(s.lines).split("-")[1]) < Number(String(s.lines).split("-")[0])) errs.push(`sources.${id}: lines "${s.lines}" ends before it starts`);
    if (s.kind === "git") {
      if (s.at !== undefined && !/^[0-9a-f]{7,40}$/.test(s.at)) errs.push(`sources.${id}: at is a commit hash`);
      if (s.repo !== undefined && !ownIn(spec.repos, s.repo)) errs.push(`sources.${id}: unknown repo ${s.repo}`);
    }
  }
  for (const [name, r] of entries(spec.repos)) if (!isObj(r)) errs.push(`repos.${name}: a repo is an object`); else if (r.url !== undefined && !(typeof r.url === "string" && /^https:\/\/[^\s"<>]+$/.test(r.url))) errs.push(`repos.${name}: url must start with https://`);
  if (entries(spec.repos).length > 1) {
    for (const [id, s] of entries(spec.sources)) if (isObj(s) && s.kind === "git" && s.repo === undefined) errs.push(`sources.${id}: name its repo; this guided plan has more than one`);
  }
  for (const [id, a] of entries(spec.assets)) {
    if (!isObj(a)) { errs.push(`assets.${id}: an asset is an object`); continue; }
    if (!isStr(a.file)) errs.push(`assets.${id}: file required`);
    else if (!insideFolder(a.file)) errs.push(`assets.${id}: ${a.file} must be inside the folder of the content file`);
    else {
      const found = fileExists(a.file);
      if (found !== true) errs.push(`assets.${id}: ${typeof found === "string" ? found : `${a.file} not found next to the content file`}`);
    }
    if (a.from !== undefined && !known.has(a.from)) errs.push(`assets.${id}: unknown source ${a.from}`);
  }
  cite("intent", spec.intentCites, false);
  if (notList(spec.ban) || (Array.isArray(spec.ban) && !spec.ban.every(isStr))) errs.push("ban: a list of words");
  if (!Array.isArray(spec.sections) || !spec.sections.length || spec.sections.length > 10) { errs.push("sections: 1 to 10"); return errs.list(); }
  if (!Array.isArray(spec.overview) || !spec.overview.length) errs.push("overview: at least one row");
  const secIds = new Set();
  for (const [i, s] of spec.sections.entries()) {
    if (!isObj(s)) { errs.push(`sections[${i}]: a section is an object`); continue; }
    const sid = s.id;
    if (!SECTION_ID.test(sid || "")) errs.push(`section ${sid}: id is lower case letters, digits and dashes`);
    if (secIds.has(sid)) errs.push(`section ${sid}: id used twice`);
    secIds.add(sid);
    if (s.parts) { errs.push(`${sid}: "parts" are gone in ${FORMAT}. ${MIGRATE}`); continue; }
    if (!isStr(s.title)) errs.push(`${sid}: title required (the small label above the heading)`);
    if (!isStr(s.heading)) errs.push(`${sid}: heading required (the story in a few words)`);
    else if (words(s.heading) > MAX_HEADING_WORDS) errs.push(`${sid}: heading "${errs.clip(s.heading)}" is ${words(s.heading)} words; say it in ${MAX_HEADING_WORDS} or fewer`);
    if (Array.isArray(s.lead)) errs.push(`${sid}: lead is one paragraph, a string; put more in a card`);
    else if (!isStr(s.lead)) errs.push(`${sid}: lead required (one paragraph)`);
    if (s.question !== undefined && !isStr(s.question)) errs.push(`${sid}: question is text`);
    cite(sid, s.cites, true);
    validateFigure(spec, s.figure, sid, errs);
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
      if (c.figure !== undefined) { validateFigure(spec, c.figure, where, errs); citeFigure(where, c.figure); }
      if (c.fold && !c.figure) errs.push(`${where}: fold folds the card's figure; this card has none`);
      if (c.wide !== undefined && typeof c.wide !== "boolean") errs.push(`${where}: wide is true or false`);
    }
    if (notList(s.files)) { errs.push(`${sid}: files is a list`); continue; }
    if (spec.audience === "business" && Array.isArray(s.files) && s.files.length) errs.push(`${sid}: ${BUSINESS} lists no files, since its reader does not open code; name the work as plain pieces in a "timeline" or a "list" instead`);
    for (const a of s.files || []) {
      if (!isObj(a)) { errs.push(`${sid}: a file is an object`); continue; }
      if (!isStr(a.name)) errs.push(`${sid}: a file needs name`);
      if (a.part) errs.push(`${sid}: file ${a.name} names a part; in ${FORMAT} a file points at a card with "card"`);
      if (a.card && !cardIds.has(a.card)) errs.push(`${sid}: file ${a.name} points at unknown card ${a.card}`);
      if (a.repo !== undefined && a.repo !== true && !ownIn(spec.repos, a.repo)) errs.push(`${sid}: file ${a.name} names unknown repo ${a.repo}`);
      if (a.at !== undefined && !(typeof a.at === "string" && COMMIT.test(a.at))) errs.push(`${sid}: file ${a.name}: at is a commit hash (7 to 40 hex characters)`);
      if (a.path !== undefined && !isStr(a.path)) errs.push(`${sid}: file ${a.name}: path is text`);
      else if (a.path !== undefined && a.repo === undefined && !insideFolder(a.path)) errs.push(`${sid}: file ${a.name}: path ${a.path} must be inside the folder of the content file`);
    }
  }
  // Every id the page will carry is unique: sections, their headings and figures, cards and their figures.
  const pageIds = new Map([["theme", "the theme button"]]);
  const claim = (id, what) => {
    if (pageIds.has(id)) errs.push(`${what}: its page id "${id}" is already used by ${pageIds.get(id)}; rename one`);
    else pageIds.set(id, what);
  };
  for (const s of spec.sections) {
    if (!s || typeof s !== "object" || !SECTION_ID.test(s.id || "")) continue;
    if (RESERVED_SECTION_IDS.includes(s.id)) { errs.push(`section ${s.id}: "${s.id}" is reserved by the page; pick another id`); continue; }
    claim(s.id, `section ${s.id}`); claim(`${s.id}-h`, `section ${s.id}'s heading`); claim(`${s.id}-f`, `section ${s.id}'s figure`);
    for (const c of Array.isArray(s.cards) ? s.cards : []) {
      if (!c || !SECTION_ID.test(c.id || "")) continue;
      if (RESERVED_CARD_IDS.includes(c.id)) { errs.push(`${s.id}.${c.id}: card id "${c.id}" is reserved (the section's heading, figure or read state use it); pick another`); continue; }
      claim(`${s.id}-${c.id}`, `card ${s.id}.${c.id}`); claim(`${s.id}-${c.id}-f`, `card ${s.id}.${c.id}'s figure`);
    }
  }
  (Array.isArray(spec.overview) ? spec.overview : []).forEach((o, i) => {
    if (!isObj(o)) { errs.push(`overview[${i}]: a row is an object`); return; }
    if (!KINDS.includes(o.kind)) errs.push(`overview[${i}]: kind is one of ${KINDS.join(", ")}`);
    if (!isStr(o.text)) errs.push(`overview[${i}]: text required`);
    if (o.kind === "Ask") {
      tooLong(errs, `overview[${i}]`, "question", o.text, 120);
      if (o.recommended !== undefined) { if (!isStr(o.recommended)) errs.push(`overview[${i}]: recommended is text, the answer this guided plan recommends`); else tooLong(errs, `overview[${i}]`, "recommended", o.recommended, 60); }
    } else if (o.recommended !== undefined) errs.push(`overview[${i}]: recommended belongs to an Ask row (a question for the reader); a ${KINDS.includes(o.kind) ? o.kind : "row"} row takes none`);
    if (!secIds.has(o.section)) errs.push(`overview[${i}]: unknown section ${o.section}`);
    cite(`overview[${i}]`, o.cites, true);
  });
  return errs.list();
}

// ---------- words: what a reader sees ----------

// Words a new engineer would not know on day one, or that are house jargon. A plan may ban more with "ban".
const BANNED = ["doors?", "prefix(es)?", "seams?", "census", "specs?", "rulings?", "goldens?", "lanes?", "stub", "canonical"];
// The most words a business guided plan's page should hold: every word a reader sees, figures,
// captions and cards included, but not the folded sources. Past it, the build warns.
export const BUSINESS_WORD_BUDGET = 1200;
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
    // A mock-up shows invented example content (a name, a sentence a customer might write), so its
    // contents are checked as an illustration: no digit. Its title and caption are claims, as usual.
    case "screen": {
      add("screen.address", f.address, false, true);
      const parts = (ps) => (Array.isArray(ps) ? ps : []).forEach((p) => { if (!p) return; add("screen.part", p.text, false, true); add("screen.part", p.by, false, true); (Array.isArray(p.items) ? p.items : []).forEach((t) => add("screen.item", t, false, true)); parts(p.parts); });
      parts(f.parts);
      break;
    }
    case "lanes": (f.lanes || []).forEach((l) => a("lane", l)); (f.steps || []).forEach((s) => a("lane.step", s && s.text)); break;
    case "pair": (f.sides || []).forEach((s) => { if (!s) return; const st = toy || Boolean(s.toy); add("side", s.label, false, st); add("side", s.note, false, st); add("side.caption", s.caption, false, st); figureStrings(s.figure, add, st); }); break;
  }
}

const figureCites = (f) => citesOfFigure(f, []);

function readerStrings(spec) {
  // [where, text, citeIds or null, isCode, toy, inFigure, isTitle]
  const out = [];
  out.push(["title", spec.title, spec.intentCites || [], false, false]);
  out.push(["intent", spec.intent, spec.intentCites || [], false, false]);
  (spec.overview || []).forEach((o, i) => { out.push([`overview[${i}]`, o.text, o.cites || [], false, false]); if (o.recommended !== undefined) out.push([`overview[${i}].recommended`, o.recommended, o.cites || [], false, false]); });
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

// A banned word as a regular expression, and the lower-case text it cannot match without (null when
// it has letters outside ASCII, whose case rules differ; then the expression always runs).
function banWord(w, isPattern) {
  const stem = isPattern ? w.replace(/\([^)]*\)\?$/, "").replace(/.\?$/, "") : w.toLowerCase();
  return { re: new RegExp(`\\b${isPattern ? w : w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), stem: /^[\x20-\x7e]*$/.test(stem) ? stem : null };
}

// The numbers a quote holds, read once: a number in the text counts when it is one of them. The
// same rule as the expression (?<![\d.])(n)(?![\d]) against the quote, for every n at once. Quotes
// are joined with a space, which no number crosses, so each source can be read on its own.
function numbersIn(quotes, into = new Set()) {
  for (const m of quotes.matchAll(/(?<![\d.])(\d+)(?:\.(\d+))?/g)) {
    into.add(m[1]);
    if (m[2] !== undefined) into.add(`${m[1]}.${m[2]}`);
  }
  for (const w of Object.keys(NUMWORDS)) if (new RegExp(`(?<![\\d.])${w}(?![\\d])`).test(quotes)) into.add(w);
  return into;
}

function lintUnguarded(spec, limits) {
  const L = limitsOf(limits);
  const errs = sink(L);
  const warns = sink(L);
  const banned = [...BANNED.map((w) => banWord(w, true)), ...(spec.ban || []).map((w) => banWord(w, false))];
  const sourceNumbers = new Map(); // source id -> the numbers its quotes hold
  const citedNumbers = new Map(); // cites list -> the numbers all its sources hold
  const numbersOf = (id) => {
    if (!sourceNumbers.has(id)) sourceNumbers.set(id, numbersIn([].concat((ownIn(spec.sources, id) || {}).quote || []).join(" ").toLowerCase()));
    return sourceNumbers.get(id);
  };
  const business = spec.audience === "business";
  let pageWords = 0;
  const quotesOf = new Map(); // cites list -> the lower-case text of all its quotes
  const quoteText = (ids) => {
    const key = [...new Set(ids)].sort().join("\u0000");
    if (!quotesOf.has(key)) quotesOf.set(key, [...new Set(ids)].flatMap((id) => [].concat((ownIn(spec.sources, id) || {}).quote || [])).join(" ").toLowerCase());
    return quotesOf.get(key);
  };
  for (const [where, text, ids, isCode, toy, inFigure, isTitle] of readerStrings(spec)) {
    if (!isStr(text)) continue;
    if (business) {
      pageWords += words(text);
      // Do not strengthen: a word that makes a claim absolute must come from the plan's own words.
      if (!isCode && !toy && ids !== null) for (const m of text.replace(/`[^`]*`/g, " ").matchAll(/\b(never|always|only)\b/gi)) {
        const w = m[1].toLowerCase();
        if (!new RegExp(`\\b${w}\\b`).test(quoteText(ids))) warns.push(`${where}: "${w}" is not in any quote this text cites; say no more than the plan says: "${errs.clip(text)}"`);
      }
    }
    const shown = errs.clip(text);
    // code in backticks and code-like names (mono) are not prose, so the word list does not apply to them
    const prose = isCode ? "" : text.replace(/`[^`]*`/g, " ");
    const low = prose.toLowerCase();
    for (const b of banned) if ((b.stem === null || low.includes(b.stem)) && b.re.test(prose)) errs.push(`${where}: jargon "${errs.clip(prose.match(b.re)[0])}" in "${shown}"; say it in plain words`);
    if (/—/.test(text) || /\s--\s/.test(text)) errs.push(`${where}: a dash standing in for a comma; use a comma, a colon or two sentences: "${shown}"`);
    if (/(body|lead)/.test(where) && words(text) > 70) warns.push(`${where}: paragraph of ${words(text)} words`);
    for (const sent of text.split(/(?<=[.?!])\s+/)) if (words(sent) > 28) warns.push(`${where}: sentence over 28 words: "${sent.slice(0, 60)}..."`);
    if (inFigure && !isCode && /`/.test(text)) errs.push(`${where}: figure text is plain; drop the backticks: "${shown}"`);
    if (isCode) continue;
    // A number a reader sees comes from a cited quote. Code in backticks, "PR 123", "#123", dates and years are exempt.
    const stripped = text.replace(/`[^`]*`/g, " ").replace(/\bPR \d+\b/g, " ").replace(/#\d+\b/g, " ").replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").replace(/\b(19|20)\d{2}\b/g, " ");
    if (toy) {
      if (/\d/.test(stripped)) errs.push(`${where}: an illustration shows invented data, so it may not show a digit: "${shown}"`);
      continue;
    }
    if (ids === null) continue;
    // Digits always count. Number words count too, except in titles and headings ("Two ways in").
    const nums = [...stripped.matchAll(/(?<![A-Za-z_.\d])(\d+(?:\.\d+)?)(?![\d])|\b(two|three|four|five|six|seven|eight|nine|ten)\b/gi)].filter((m) => m[1] || !isTitle).map((m) => (m[1] || m[2]).toLowerCase());
    if (!nums.length) continue;
    const key = [...new Set(ids)].sort().join("\u0000");
    let held = citedNumbers.get(key);
    if (!held) {
      const ownIds = [...new Set(ids)];
      held = ownIds.length === 1 ? numbersOf(ownIds[0]) : new Set(ownIds.flatMap((id) => [...numbersOf(id)]));
      citedNumbers.set(key, held);
    }
    for (const n of nums) {
      const alt = NUMWORDS[n] || Object.keys(NUMWORDS).find((k) => NUMWORDS[k] === n);
      if (!(held.has(n) || (alt && held.has(alt)))) errs.push(`${where}: the number "${errs.clip(n)}" is not in any quote ${ids.length ? "this text cites" : "(a section label cites nothing, so it may not hold a digit)"}: "${shown}"`);
    }
  }
  // A lane's word too wide for its box on a phone is cut inside the word there: say so.
  const lanesIn = (f, where) => {
    if (!isObj(f)) return;
    if (f.type === "lanes") for (const { where: w, word } of laneWordsTooWide(f)) warns.push(`${where}.${w}: "${errs.clip(word)}" is too wide for a box of ${(Array.isArray(f.lanes) ? f.lanes : []).length} lanes on a phone, so it is cut inside the word there; use a shorter word, or fewer lanes`);
    if (f.type === "pair" && Array.isArray(f.sides)) f.sides.forEach((sd, i) => lanesIn(sd && sd.figure, `${where}.sides[${i}]`));
  };
  for (const sc of spec.sections) {
    lanesIn(sc.figure, `${sc.id}.figure`);
    for (const c of sc.cards || []) lanesIn(c.figure, `${sc.id}.${c.id}.figure`);
  }
  if (business && pageWords > BUSINESS_WORD_BUDGET) warns.push(`the page holds ${pageWords} words of text (figures, captions and cards included); ${BUSINESS} reads best under ${BUSINESS_WORD_BUDGET}: drop cards, shorten captions, and let a picture carry what words repeat`);
  return { errors: errs.list(), warnings: warns.list() };
}

// ---------- the exports ----------

// None of them throws: a value the checks did not foresee becomes an error, never an exception.
const unforeseen = (e) => `the content file could not be checked: ${e && e.message ? e.message : String(e)}`;

/**
 * The shape of a content file. Returns a list of errors; an empty list means the shape is sound.
 *
 * @param {unknown} spec  the parsed plan.json
 * @param {object} [host] what needs a look at the disk. Both defaults go by the name alone, and
 *   cannot know what a name will reach. A host that has no folder must look an asset up by its
 *   exact key in its own store, and never resolve the path against a URL or a disk.
 * @param {(path: string) => boolean} [host.insideFolder]  true when a path the file names stays
 *   inside the content file's folder. Default: insideFolderByName.
 * @param {(path: string) => boolean | string} [host.fileExists]  true when the asset file is there;
 *   false when it is not; a string to say what is wrong with it instead. Default: not checked.
 * @param {Partial<typeof DEFAULT_LIMITS>} [host.limits]  any of DEFAULT_LIMITS to change for this call.
 *   Error text quotes the plan: a host that shows it must escape it.
 * @returns {string[]}
 */
export function validate(spec, host) {
  try { return validateUnguarded(spec, host); } catch (e) { return [unforeseen(e)]; }
}

/**
 * The words and numbers a reader sees. Run it on a file whose shape is sound (see validate).
 * `limits` as for validate's host.limits.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function lint(spec, limits) {
  try { return lintUnguarded(spec, limits); } catch (e) { return { errors: [unforeseen(e)], warnings: [] }; }
}

/**
 * Shape first; the words only once the shape is sound. The same errors, in the same order, as
 * build.mjs prints. `host` is as for validate.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validatePlan(spec, host) {
  const errors = validate(spec, host);
  if (errors.length) return { errors, warnings: [] };
  return lint(spec, isObj(host) ? host.limits : undefined);
}
