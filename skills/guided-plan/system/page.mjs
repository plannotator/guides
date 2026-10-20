// A guided plan's page from its content file and the bytes of the screenshots it names, with no
// file system, no process and no Buffer: it runs in Node, a browser or a Worker. build.mjs reads
// the files from the disk and calls buildPage; another tool can hand it the bytes from its own store.
import { render } from "./renderer.mjs";
import { validatePlan, insideFolderByName, ownIn } from "./validate.mjs";
import { GUIDE_CSS, RUNTIME_JS } from "./static.generated.mjs";

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

// Width, height and type of a PNG or JPEG, read from its header; null for anything else.
export function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return b.length >= 24 ? { w: u32(b, 16), h: u32(b, 20), mime: "image/png" } : null;
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xc3) return i + 9 <= b.length ? { h: u16(b, i + 5), w: u16(b, i + 7), mime: "image/jpeg" } : null;
      if (i + 4 > b.length) return null;
      i += 2 + u16(b, i + 2);
    }
  }
  return null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// Standard base64 with padding, the same text as Node's Buffer.toString("base64").
export function base64(b) {
  const out = [];
  let chunk = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8) | (i + 2 < b.length ? b[i + 2] : 0);
    chunk += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < b.length ? B64[n & 63] : "=");
    if (chunk.length >= 8192) { out.push(chunk); chunk = ""; }
  }
  out.push(chunk);
  return out.join("");
}

// ---------- the page ----------

/**
 * Check a content file and draw its page.
 *
 * @param {unknown} spec  the parsed plan.json
 * @param {Map<string, Uint8Array> | Record<string, Uint8Array>} files  the asset files the plan
 *   names, keyed by the exact path its "assets" give (relative to the content file). A path is
 *   looked up by that key and nothing else: never resolved against a URL or a disk.
 * @param {object} [options]
 * @param {(path: string) => boolean} [options.insideFolder]  as for validate; default by name alone
 * @param {(path: string) => boolean | string} [options.fileExists]  as for validate; default: the
 *   path is a key of `files`
 * @param {string} [options.css]  default: guide.css, from static.generated.mjs
 * @param {string} [options.runtime]  default: runtime.js, from static.generated.mjs
 * @returns {{ html: string | null, errors: string[], warnings: string[] }}  html is null when
 *   there are errors
 */
export function buildPage(spec, files, options = {}) {
  const opts = isObj(options) ? options : {};
  const bytes = (p) => {
    const b = files instanceof Map ? files.get(p) : ownIn(files, p);
    return b instanceof Uint8Array ? b : undefined;
  };
  const { insideFolder = insideFolderByName, fileExists = (p) => bytes(p) !== undefined } = opts;
  const { errors, warnings } = validatePlan(spec, { insideFolder, fileExists });
  if (errors.length) return { html: null, errors, warnings };
  const assets = {};
  for (const [id, a] of Object.entries(spec.assets || {})) {
    const b = bytes(a.file);
    const size = b && imageSize(b);
    if (!b) errors.push(`assets.${id}: ${a.file} not found next to the content file`);
    else if (!size) errors.push(`assets.${id}: ${a.file}: not a PNG or JPEG`);
    else assets[id] = { w: size.w, h: size.h, uri: `data:${size.mime};base64,${base64(b)}` };
  }
  if (errors.length) return { html: null, errors, warnings };
  try {
    const html = render(spec, {
      css: typeof opts.css === "string" ? opts.css : GUIDE_CSS,
      runtime: typeof opts.runtime === "string" ? opts.runtime : RUNTIME_JS,
      assets,
      links: linksFor(spec),
    });
    return { html, errors, warnings };
  } catch (e) {
    // A value the checks did not foresee is an error, never an exception.
    return { html: null, errors: [`the page could not be drawn: ${e && e.message ? e.message : String(e)}`], warnings };
  }
}
