// A guided plan's page from its content file and the bytes of the screenshots it names, with no
// file system, no process and no Buffer: it runs in Node, a browser or a Worker. build.mjs reads
// the files from the disk and calls buildPage; another tool can hand it the bytes from its own store.
import { render, renderSizeBound } from "./renderer.mjs";
import { validatePlan, insideFolderByName, ownIn, limitsOf, DEFAULT_LIMITS } from "./validate.mjs";

export { DEFAULT_LIMITS };
import { GUIDE_CSS, RUNTIME_JS, FEATURE_CSS } from "./static.generated.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---------- repositories ----------

// The repository a source, excerpt or file means: its own "repo", or the only one the plan names.
export function repoName(spec, r) {
  if (r !== undefined && r !== true) return r;
  const names = Object.keys((spec && spec.repos) || {});
  return names.length === 1 ? names[0] : "";
}

// ---------- links ----------

// Links to the cited lines and files, for repositories that give an https "url".
export function linksFor(spec) {
  const url = (name) => { const u = (ownIn(spec.repos, name) || {}).url; return typeof u === "string" && /^https:\/\//.test(u) ? u.replace(/\/+$/, "") : null; };
  const range = (lines) => {
    if (!lines) return "";
    const [a, b] = String(lines).split("-");
    return b ? `#L${a}-L${b}` : `#L${a}`;
  };
  return {
    source(s) {
      if (s.kind === "git") { const u = url(repoName(spec, s.repo)); return u ? `${u}/blob/${s.at || spec.base}/${s.path}${range(s.lines)}` : null; }
      return null; // files beside the content file are not shipped with the page, so no link
    },
    file(a) {
      if (!a.path) return null;
      if (a.repo !== undefined) { const u = url(repoName(spec, a.repo)); return u ? `${u}/${a.path.endsWith("/") ? "tree" : "blob"}/${a.at || spec.base}/${a.path.replace(/\/$/, "")}` : null; }
      return null;
    },
  };
}

// ---------- screenshots ----------

const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52];
// Frame headers that carry the size: baseline, progressive, lossless, arithmetic (not C4, C8, CC).
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const MAX_SIDE = 2 ** 24;
const sized = (w, h, mime) => (w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE ? { w, h, mime } : null);

// Width, height and type of a PNG or JPEG, read from its header; null for anything else, and for
// a side of 0 or over 2^24 pixels. A PNG needs its 8-byte signature and an IHDR chunk first; a
// JPEG is read marker by marker up to its frame header.
export function imageSize(b) {
  if (!b || typeof b.length !== "number") return null;
  if (b.length >= 24 && PNG_SIGNATURE.every((x, i) => b[i] === x)) {
    if (u32(b, 8) !== 13 || !IHDR.every((x, i) => b[12 + i] === x)) return null;
    return sized(u32(b, 16), u32(b, 20), "image/png");
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null; // every segment starts with a marker
      while (i < b.length && b[i] === 0xff) i++; // fill bytes
      if (i >= b.length) return null;
      const m = b[i++];
      if (m === 0xd9 || m === 0xda) return null; // end of image, or the scan, before a frame header
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) continue; // markers with no length
      if (i + 2 > b.length) return null;
      const len = u16(b, i);
      if (len < 2 || i + len > b.length) return null;
      if (JPEG_SOF.has(m)) return len >= 7 ? sized(u16(b, i + 5), u16(b, i + 3), "image/jpeg") : null;
      i += len;
    }
  }
  return null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_CODES = Uint8Array.from(B64, (c) => c.charCodeAt(0));
const PAD = 61; // "="
// 3 * 0x2000 bytes: whole groups of three, so only the last chunk is padded, and few enough
// arguments for String.fromCharCode.apply.
const CHUNK = 3 * 0x2000;

// One chunk in pure code: the characters go into a byte array, and become a string once.
function chunkBase64(c) {
  const out = new Uint8Array(4 * Math.ceil(c.length / 3));
  let o = 0;
  for (let i = 0; i < c.length; i += 3) {
    const n = (c[i] << 16) | ((i + 1 < c.length ? c[i + 1] : 0) << 8) | (i + 2 < c.length ? c[i + 2] : 0);
    out[o++] = B64_CODES[(n >> 18) & 63];
    out[o++] = B64_CODES[(n >> 12) & 63];
    out[o++] = i + 1 < c.length ? B64_CODES[(n >> 6) & 63] : PAD;
    out[o++] = i + 2 < c.length ? B64_CODES[n & 63] : PAD;
  }
  return String.fromCharCode.apply(null, out);
}

// Standard base64 with padding, the same text as Node's Buffer.toString("base64"). Each chunk is a
// flat string (btoa where there is one, else pure code), and they are joined once, so memory stays
// near the size of the result. `pure` forces the pure path (for tests).
export function base64(b, { pure = false } = {}) {
  const useBtoa = !pure && typeof btoa === "function";
  const parts = [];
  for (let i = 0; i < b.length; i += CHUNK) {
    const c = b.subarray(i, i + CHUNK);
    parts.push(useBtoa ? btoa(String.fromCharCode.apply(null, c)) : chunkBase64(c));
  }
  return parts.join("");
}

// UTF-8 length of a string, without encoding it.
export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

// ---------- the page ----------

const clip = (t, n) => { t = String(t); return t.length <= n ? t : t.slice(0, n) + "…"; };
// Any typed array or DataView, as bytes (a view, not a copy).
const asBytes = (v) => (ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : undefined);

// How many times each asset id is drawn: section and card figures, and the sides of a pair.
function screenshotUses(spec) {
  const uses = new Map();
  const visit = (f) => {
    if (!isObj(f)) return;
    if (f.type === "screenshot" && typeof f.asset === "string") uses.set(f.asset, (uses.get(f.asset) || 0) + 1);
    if (f.type === "pair" && Array.isArray(f.sides)) for (const s of f.sides) if (isObj(s)) visit(s.figure);
  };
  for (const sec of spec.sections) {
    visit(sec.figure);
    for (const c of Array.isArray(sec.cards) ? sec.cards : []) if (isObj(c)) visit(c.figure);
  }
  return uses;
}

const capErrors = (list, L) => (list.length > L.maxErrors ? [...list.slice(0, L.maxErrors), `…and ${list.length - L.maxErrors} more`] : list);

/**
 * Check a content file and draw its page.
 *
 * @param {unknown} spec  the parsed plan.json
 * @param {Map<string, Uint8Array> | Record<string, Uint8Array>} files  the asset files the plan
 *   names, keyed by the exact path its "assets" give (relative to the content file): a Map (or
 *   anything with get), or a plain object. Values are Uint8Array or any other ArrayBuffer view. A
 *   path is looked up by that key and nothing else: never resolved against a URL or a disk.
 * @param {object} [options]
 * @param {(path: string) => boolean} [options.insideFolder]  as for validate; default by name alone
 * @param {(path: string) => boolean | string} [options.fileExists]  as for validate; default: the
 *   path is a key of `files`
 * @param {Partial<typeof DEFAULT_LIMITS>} [options.limits]  any of DEFAULT_LIMITS to change
 * @param {string} [options.css]  default: guide.css, from static.generated.mjs
 * @param {string} [options.runtime]  default: runtime.js, from static.generated.mjs
 * @param {Record<string, string>} [options.features]  default: features.css by feature, from
 *   static.generated.mjs; a page carries a feature's styles only when it uses the feature
 * @returns {{ html: string | null, errors: string[], warnings: string[] }}  html is null when
 *   there are errors. Error text quotes the plan: a host that shows it must escape it.
 */
export function buildPage(spec, files, options = {}) {
  let L = DEFAULT_LIMITS;
  let warnings = [];
  try {
    // Everything that reads the caller's values is in here, so a throwing getter is an error too.
    const opts = isObj(options) ? options : {};
    L = limitsOf(opts.limits);
    const bytes = (p) => {
      try { return asBytes(files && typeof files.get === "function" ? files.get(p) : ownIn(files, p)); } catch { return undefined; }
    };
    const { insideFolder = insideFolderByName, fileExists = (p) => bytes(p) !== undefined } = opts;
    const css = typeof opts.css === "string" ? opts.css : GUIDE_CSS;
    const runtime = typeof opts.runtime === "string" ? opts.runtime : RUNTIME_JS;
    const features = isObj(opts.features) ? opts.features : FEATURE_CSS;
    const checked = validatePlan(spec, { insideFolder, fileExists, limits: L });
    const errors = checked.errors;
    warnings = checked.warnings;
    if (errors.length) return { html: null, errors, warnings };
    // Every named asset is checked: there, not too large, a PNG or JPEG. Only the ones a figure
    // draws are encoded, and each file once, however many ids or figures name it.
    const uses = screenshotUses(spec);
    const files_ = new Map(); // path -> { b, size }
    for (const [id, a] of Object.entries(spec.assets || {})) {
      const name = clip(a.file, L.maxEchoChars);
      const b = bytes(a.file);
      if (!b) { errors.push(`assets.${id}: ${name} not found next to the content file`); continue; }
      if (b.length > L.maxImageBytes) { errors.push(`assets.${id}: ${name} is ${b.length} bytes; keep a screenshot to ${L.maxImageBytes} or fewer`); continue; }
      const size = imageSize(b);
      if (!size) { errors.push(`assets.${id}: ${name}: not a PNG or JPEG`); continue; }
      files_.set(a.file, { b, size });
    }
    if (errors.length) return { html: null, errors: capErrors(errors, L), warnings };
    // The page's size is known before anything is encoded or drawn: each drawing of a screenshot
    // carries its whole data: URI, and each source is drawn in every section that cites it.
    const uriLength = (id) => {
      const a = ownIn(spec.assets, id);
      const f = a && files_.get(a.file);
      return f ? `data:${f.size.mime};base64,`.length + 4 * Math.ceil(f.b.length / 3) : 0;
    };
    let imageBytes = 0, uriChars = 0;
    const counted = new Set();
    for (const [id, n] of uses) {
      const a = ownIn(spec.assets, id);
      const f = a && files_.get(a.file);
      if (!f) continue;
      uriChars += n * uriLength(id);
      if (!counted.has(a.file)) { counted.add(a.file); imageBytes += f.b.length; }
    }
    if (imageBytes > L.maxImageBytesTotal) errors.push(`assets: the screenshots the page draws are ${imageBytes} bytes in all; keep them to ${L.maxImageBytesTotal} or fewer`);
    if (uriChars > L.maxHtmlBytes) errors.push(`assets: the screenshots alone would make the page ${uriChars} bytes (each drawing carries the whole image); keep the page to ${L.maxHtmlBytes} or fewer`);
    if (errors.length) return { html: null, errors, warnings };
    const links = linksFor(spec);
    const bound = renderSizeBound(spec, { css, runtime, uriLength, links, features });
    if (bound > L.maxHtmlBytes) return { html: null, errors: [`the page could be up to ${bound} bytes (its text, with each source drawn in every section that cites it, and its screenshots); keep it to ${L.maxHtmlBytes} or fewer`], warnings };
    const uris = new Map(); // path -> data: URI, encoded once
    const assets = {};
    for (const id of uses.keys()) {
      const a = ownIn(spec.assets, id);
      const f = a && files_.get(a.file);
      if (!f) continue;
      if (!uris.has(a.file)) uris.set(a.file, `data:${f.size.mime};base64,${base64(f.b)}`);
      assets[id] = { w: f.size.w, h: f.size.h, uri: uris.get(a.file) };
    }
    const html = render(spec, { css, runtime, assets, links, features });
    // The bound above is an upper bound; this is the backstop.
    const size = utf8Length(html);
    if (size > L.maxHtmlBytes) return { html: null, errors: [`the page is ${size} bytes; keep it to ${L.maxHtmlBytes} or fewer`], warnings };
    return { html, errors, warnings };
  } catch (e) {
    // A value the checks did not foresee is an error, never an exception.
    return { html: null, errors: [`the page could not be drawn: ${clip(e && e.message ? e.message : String(e), L.maxEchoChars)}`], warnings };
  }
}
