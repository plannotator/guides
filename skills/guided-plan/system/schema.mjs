// The fields of a guided-plan/2 content file, in one table. build.mjs refuses any field not named
// here (so a typo such as "tagacc" is an error, not a silent no-op), and guided-plan.schema.json
// is generated from it:
//
//   node schema.mjs > guided-plan.schema.json
//
// The JSON Schema states the shape (fields, types, enums, counts). build.mjs checks more than a
// schema can say: cites that exist, numbers inside quotes, jargon, ids that do not collide,
// paths inside the plan folder, text that fits. A file that passes build.mjs passes the schema.
import { FORMAT, FIGURE_TYPES } from "./renderer.mjs";

// Types: "string", "text" (a non-empty string), "integer", "number", "boolean", "ids" (a list of
// source ids), { enum }, { const }, { list: T, min?, max? }, { ref: "<kind>" }, { map: "<kind>" },
// { anyOf: [T, ...] }. A field name ending in "?" is optional.
// How large a content file may be. A real guided plan is far below every one of these; they exist
// so a hostile file cannot make a host spend unbounded time or memory. Every one can be set per
// call (validate's host.limits, buildPage's options.limits); these are the defaults.
export const DEFAULT_LIMITS = Object.freeze({
  maxStringChars: 10000,      // one string: a lead, a quote, a code line
  maxTextChars: 1000000,      // all strings together: bounds the work of every word check
  maxSources: 500,            // keys of "sources"
  maxAssets: 100,             // keys of "assets"
  maxRepos: 20,               // keys of "repos"
  maxOverviewRows: 50,        // "overview"
  maxCites: 100,              // one "cites" or "intentCites" list
  maxQuotes: 50,              // one source's "quote" list
  maxFiles: 50,               // one section's "files"
  maxBanWords: 200,           // "ban"
  maxBands: 20,               // one timeline's "bands"
  maxLegend: 20,              // one chips figure's "legend"
  maxMarked: 40,              // one code figure's "marked" (an excerpt has at most 40 lines)
  maxLayerItems: 40,          // one layer's "items"
  maxImageBytes: 10 * 1024 * 1024,      // one screenshot file
  maxImageBytesTotal: 25 * 1024 * 1024, // all screenshot files the page draws
  maxHtmlBytes: 50 * 1000 * 1000,       // the page, in UTF-8 bytes
  maxErrors: 200,             // errors (and warnings) returned; the rest are counted
  maxEchoChars: 120,          // plan text quoted back in one error
  maxErrorChars: 1000,        // one error, whole (the longest fixed message is about 520)
});

const text = "text";
const ids = { list: "text", min: 1, limit: "maxCites" };
const idsOpt = { list: "text", limit: "maxCites" };
const SAFE_KEY = "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$";
export const ID = "^[a-z][a-z0-9-]*$";
const COMMIT = "^[0-9a-f]{7,40}$";

const figureCommon = { "type": null, "title?": "string", "caption?": "string", "cites?": idsOpt, "toy?": "boolean" };

export const KINDS = {
  plan: {
    "format": { const: FORMAT }, "title": text, "intent": text, "intentCites?": idsOpt,
    "plan?": { ref: "planName" }, "model?": "string", "base": { pattern: COMMIT },
    "repos?": { map: "repo", limit: "maxRepos" }, "sources": { map: "source", limit: "maxSources" }, "assets?": { map: "asset", limit: "maxAssets" },
    "overview": { list: { ref: "overview" }, min: 1, limit: "maxOverviewRows" }, "sections": { list: { ref: "section" }, min: 1, max: 10 },
    "ban?": { list: text, limit: "maxBanWords" },
  },
  planName: { "name?": "string" },
  repo: { "url?": { pattern: "^https://[^\\s\"<>]+$" }, "path?": text },
  source: {
    "kind": { enum: ["git", "file", "capture"] }, "path": text, "lines?": { pattern: "^[1-9][0-9]*(-[1-9][0-9]*)?$" },
    "quote?": { anyOf: [text, { list: text, min: 1, limit: "maxQuotes" }] }, "label?": "string", "at?": { pattern: COMMIT }, "repo?": text,
  },
  asset: { "file": text, "from?": text },
  overview: { "kind": { enum: ["Decided", "Change", "Kept", "Open"] }, "text": text, "section": text, "cites": ids },
  section: {
    "id": { pattern: ID }, "title": text, "heading": text, "question?": text, "lead": text, "cites": ids,
    "figure": { ref: "figure" }, "cards?": { list: { ref: "card" }, max: 6 }, "files?": { list: { ref: "file" }, limit: "maxFiles" },
  },
  card: {
    "id": { pattern: ID }, "title": text, "body": { list: text, min: 1, max: 3 }, "cites": ids,
    "figure?": { ref: "figure" }, "fold?": "boolean", "wide?": "boolean",
  },
  file: {
    "name": text, "note?": "string", "path?": text, "repo?": { anyOf: [text, { const: true }] }, "at?": { pattern: COMMIT },
    "card?": text, "tag?": "string", "tagAcc?": "boolean",
  },
  // figures, one kind per type; "figure" is any of them
  screenshot: { ...figureCommon, "type": { const: "screenshot" }, "asset": text, "alt?": "string", "ring?": { list: "number", min: 4, max: 4 }, "scale?": "number" },
  code: {
    ...figureCommon, "type": { const: "code" }, "path": text, "start": "integer", "text": { list: "string", min: 1, max: 40 },
    "at?": { pattern: COMMIT }, "repo?": text, "marked?": { anyOf: [{ const: "all" }, { list: "integer", limit: "maxMarked" }] }, "mark?": { enum: ["hl", "out"] },
  },
  list: { ...figureCommon, "type": { const: "list" }, "rows": { list: { ref: "listRow" }, min: 1, max: 12 } },
  listRow: { "text": text, "note?": "string", "tag?": "string", "tagAcc?": "boolean", "mono?": "boolean", "mark?": { enum: ["out", "new", "acc"] } },
  table: {
    ...figureCommon, "type": { const: "table" },
    "columns": { list: { anyOf: [text, { ref: "column" }] }, min: 2, max: 5 },
    "rows": { list: { list: { anyOf: ["string", { ref: "cell" }] }, max: 5 }, min: 1, max: 20 },
  },
  column: { "label": text, "mono?": "boolean", "acc?": "boolean", "end?": "boolean", "fill?": "boolean" },
  cell: { "text": "string", "mono?": "boolean", "acc?": "boolean" },
  chips: { ...figureCommon, "type": { const: "chips" }, "chips": { list: { ref: "chip" }, min: 1, max: 40 }, "legend?": { list: { ref: "legend" }, limit: "maxLegend" } },
  chip: { "text": text, "mark?": { enum: ["out", "changed", "new", "acc"] }, "acc?": "boolean", "mono?": "boolean" },
  legend: { "text": text, "mark?": { enum: ["out", "changed", "new", "acc"] } },
  timeline: { ...figureCommon, "type": { const: "timeline" }, "stops": { list: { ref: "stop" }, min: 1, max: 6 }, "bands?": { list: { ref: "band" }, limit: "maxBands" } },
  stop: { "label": text, "sub?": "string", "sub2?": "string", "mark?": { enum: ["acc", "ask"] }, "mono?": "boolean" },
  band: { "from": "integer", "to": "integer", "label": text, "acc?": "boolean" },
  flow: { ...figureCommon, "type": { const: "flow" }, "steps": { list: { ref: "step" }, min: 2, max: 6 } },
  step: { "label": text, "sub?": "string", "via?": "string", "mark?": { enum: ["plain", "acc", "new", "gone", "muted"] }, "mono?": "boolean" },
  layers: { ...figureCommon, "type": { const: "layers" }, "rows": { list: { ref: "layer" }, min: 1, max: 5 } },
  layer: { "label": text, "sub?": "string", "text?": "string", "items?": { list: { anyOf: [text, { ref: "layerItem" }] }, limit: "maxLayerItems" }, "tag?": "string", "tagAcc?": "boolean" },
  layerItem: { "text": text, "mark?": { enum: ["out", "changed", "new", "acc"] }, "mono?": "boolean" },
  pair: { ...figureCommon, "type": { const: "pair" }, "sides": { list: { ref: "side" }, min: 2, max: 4 } },
  side: { "label": text, "note?": "string", "acc?": "boolean", "toy?": "boolean", "figure": { ref: "sideFigure" }, "caption?": "string" },
};
export const MAP_KEY = SAFE_KEY;

const fields = (kind) => Object.keys(KINDS[kind]).map((k) => k.replace(/\?$/, ""));

// Every field the table does not name, as "where: unknown field \"x\"" errors. Walks the same
// tree the table describes; shapes it does not understand are left to build.mjs's own checks.
export function unknownFields(spec) {
  const errs = [];
  const walk = (v, t, where) => {
    if (v === null || v === undefined || typeof t === "string") return;
    if (t.ref) return walkKind(v, t.ref, where);
    if (t.map) {
      if (!v || typeof v !== "object" || Array.isArray(v)) return;
      for (const [k, x] of Object.entries(v)) walkKind(x, t.map, `${where}.${k}`);
      return;
    }
    if (t.list) {
      if (!Array.isArray(v)) return;
      // sections and cards are named by their ids, as build.mjs's other errors name them
      v.forEach((x, i) => {
        const named = x && typeof x === "object" && typeof x.id === "string" && /^[a-z][a-z0-9-]*$/.test(x.id);
        const w = named && where === "plan.sections" ? x.id : named && where.endsWith(".cards") ? `${where.slice(0, -6)}.${x.id}` : `${where}[${i}]`;
        walk(x, t.list, w);
      });
      return;
    }
    if (t.anyOf) {
      // the object branch, when the value is an object
      const o = t.anyOf.find((b) => typeof b === "object" && (b.ref || b.list));
      if (o && typeof v === "object") walk(v, o, where);
    }
  };
  const walkKind = (v, kind, where) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    if (kind === "figure" || kind === "sideFigure") {
      if (!FIGURE_TYPES.includes(v.type) || (kind === "sideFigure" && v.type === "pair")) return; // build.mjs names the type
      kind = v.type;
    }
    const allowed = fields(kind);
    for (const k of Object.keys(v)) {
      if (!allowed.includes(k)) {
        const near = allowed.find((a) => a.toLowerCase() === k.toLowerCase());
        errs.push(`${where}: unknown field "${k}"${near ? `; did you mean "${near}"?` : ""}`);
      }
    }
    for (const [k, t] of Object.entries(KINDS[kind])) walk(v[k.replace(/\?$/, "")], t, `${where}.${k.replace(/\?$/, "")}`);
  };
  walkKind(spec, "plan", "plan");
  return errs.map((e) => e.replace(/^plan\./, "").replace(/^plan: /, ""));
}

// What is over a limit: lists and maps longer than their limit, strings longer than
// maxStringChars, and all strings together longer than maxTextChars. Walks the same tree as
// unknownFields, so it reads each value once. Returns { errors, over } where over is true when
// anything is over, so the caller can stop before any other check spends time on the file.
export function limitErrors(spec, limits = DEFAULT_LIMITS) {
  const L = { ...DEFAULT_LIMITS, ...(limits && typeof limits === "object" ? limits : {}) };
  const errs = [];
  let total = 0;
  const str = (v, where) => {
    total += v.length;
    if (v.length > L.maxStringChars) errs.push(`${where}: text of ${v.length} characters; keep it to ${L.maxStringChars} or fewer`);
  };
  const count = (n, t, where, what) => {
    if (t.limit && n > L[t.limit]) errs.push(`${where}: ${n} ${what}; keep it to ${L[t.limit]} or fewer`);
  };
  const walk = (v, t, where) => {
    if (typeof v === "string") return str(v, where);
    if (v === null || v === undefined || typeof t === "string") return;
    if (t.ref) return walkKind(v, t.ref, where);
    if (t.map) {
      if (!v || typeof v !== "object" || Array.isArray(v)) return;
      const keys = Object.keys(v);
      count(keys.length, t, where, "entries");
      for (const k of keys) walkKind(v[k], t.map, `${where}.${k}`);
      return;
    }
    if (t.list) {
      if (!Array.isArray(v)) return;
      count(v.length, t, where, "items");
      if (t.limit && v.length > L[t.limit]) return; // too long to be worth walking
      v.forEach((x, i) => walk(x, t.list, `${where}[${i}]`));
      return;
    }
    if (t.anyOf) {
      const o = t.anyOf.find((b) => typeof b === "object" && (b.ref || b.list));
      if (o && typeof v === "object") walk(v, o, where);
    }
  };
  const walkKind = (v, kind, where) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return;
    if (kind === "figure" || kind === "sideFigure") {
      if (!FIGURE_TYPES.includes(v.type) || (kind === "sideFigure" && v.type === "pair")) return;
      kind = v.type;
    }
    for (const [k, t] of Object.entries(KINDS[kind])) {
      const name = k.replace(/\?$/, "");
      if (Object.prototype.hasOwnProperty.call(v, name)) walk(v[name], t, `${where}.${name}`);
    }
  };
  walkKind(spec, "plan", "plan");
  if (total > L.maxTextChars) errs.push(`plan: ${total} characters of text in all; keep it to ${L.maxTextChars} or fewer`);
  return { errors: errs.map((e) => e.replace(/^plan\./, "").replace(/^plan: /, "")), over: errs.length > 0 };
}

// ---------- JSON Schema ----------

function toSchema(t) {
  if (t === "string") return { type: "string", maxLength: DEFAULT_LIMITS.maxStringChars };
  if (t === "text") return { type: "string", minLength: 1, maxLength: DEFAULT_LIMITS.maxStringChars, pattern: "\\S" };
  if (t === "integer") return { type: "integer" };
  if (t === "number") return { type: "number" };
  if (t === "boolean") return { type: "boolean" };
  if (t.const !== undefined) return { const: t.const };
  if (t.enum) return { enum: t.enum };
  if (t.pattern) return { type: "string", maxLength: DEFAULT_LIMITS.maxStringChars, pattern: t.pattern };
  if (t.ref) return { $ref: `#/$defs/${t.ref}` };
  if (t.map) return { type: "object", ...(t.limit ? { maxProperties: DEFAULT_LIMITS[t.limit] } : {}), propertyNames: { pattern: SAFE_KEY, not: { enum: ["__proto__", "constructor", "prototype"] } }, additionalProperties: { $ref: `#/$defs/${t.map}` } };
  if (t.list) return { type: "array", items: toSchema(t.list), ...(t.min !== undefined ? { minItems: t.min } : {}), ...(t.max !== undefined ? { maxItems: t.max } : t.limit ? { maxItems: DEFAULT_LIMITS[t.limit] } : {}) };
  if (t.anyOf) return { anyOf: t.anyOf.map(toSchema) };
  throw new Error(`unknown type ${JSON.stringify(t)}`);
}

function kindSchema(kind) {
  const properties = {}, required = [];
  for (const [k, t] of Object.entries(KINDS[kind])) {
    const name = k.replace(/\?$/, "");
    if (t === null) continue;
    properties[name] = toSchema(t);
    if (!k.endsWith("?")) required.push(name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function jsonSchema() {
  const $defs = {};
  for (const kind of Object.keys(KINDS)) if (kind !== "plan") $defs[kind] = kindSchema(kind);
  $defs.figure = { oneOf: FIGURE_TYPES.map((t) => ({ $ref: `#/$defs/${t}` })) };
  $defs.sideFigure = { oneOf: FIGURE_TYPES.filter((t) => t !== "pair").map((t) => ({ $ref: `#/$defs/${t}` })) };
  // a figure in a pair's side needs no title or cites of its own; the main figure and a card's need both
  for (const t of FIGURE_TYPES) $defs[t] = { ...$defs[t] };
  $defs.section.properties.figure = { allOf: [{ $ref: "#/$defs/figure" }, { required: ["title", "cites"] }] };
  $defs.card.properties.figure = { allOf: [{ $ref: "#/$defs/figure" }, { required: ["title", "cites"] }] };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://github.com/plannotator/guides/blob/main/skills/guided-plan/system/guided-plan.schema.json",
    title: `Guided plan content file (${FORMAT})`,
    description: "The shape of plan.json. build.mjs checks more than this: cites that exist, numbers inside cited quotes, jargon, ids that do not collide, paths inside the plan folder, and text that fits.",
    ...kindSchema("plan"),
    $defs,
  };
}

// Run as a script (Node), print the schema; imported anywhere else (a browser, a Worker), do nothing.
if (typeof process !== "undefined" && process.argv && process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.stdout.write(JSON.stringify(jsonSchema(), null, 2) + "\n");
}
