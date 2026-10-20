// Guided plan renderer. Pure: render(spec, { css, runtime, assets, links }) -> one HTML string.
// The same spec and assets give the same bytes. No clock, no randomness, no network.
//
// Layout: a header (title, intent, the overview rows, a meta line), then one
// card per section in reading order. A card has two columns. LEFT, which stays in view while the
// right column scrolls: a label (position and section title), one story heading, one paragraph,
// then the files and the sources, folded. RIGHT: one large figure, then the section's other
// cards (a title, a few sentences, and an optional small figure) under it. At 760 px and under
// the right column drops under the left one.
//
// Figures are HTML and CSS with container queries, so each reflows to its own width and nothing
// scrolls sideways on a phone: screenshot, code, list, table, chips, timeline, flow, layers, and
// pair (two to four of the others side by side: before and after). There is nothing to click in
// a figure; folds are plain <details>.
//
// render() is safe on its own, for a host that skips build.mjs's checks: every string it draws is
// escaped, every number is coerced with Number() and checked, every lookup by a content key is an
// own-property lookup, and a link is drawn only when it is https or a same-page anchor. Only `css`
// and `runtime` are trusted: they are the skill's own files.

export const FORMAT = "guided-plan/2";
export const FIGURE_TYPES = ["screenshot", "code", "list", "table", "chips", "timeline", "flow", "layers", "pair"];
// A pair's sides hold any figure but another pair.
export const SIDE_TYPES = FIGURE_TYPES.filter((t) => t !== "pair");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// A finite number, or the fallback.
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const int = (v, d = 0) => Math.trunc(num(v, d));
const arr = (v) => (Array.isArray(v) ? v : []);
const has = (o, k) => o != null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const own = (o, k) => (has(o, k) ? o[k] : undefined);
const pad2 = (n) => String(int(n)).padStart(2, "0");
// Titles and headings are plain text: backticks are removed, not drawn as code.
export const plain = (s) => String(s ?? "").replace(/`/g, "");
// `code` only; everything else is plain text.
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
// Long names break only after a dot, an underscore, a dash or a slash, never mid-word.
const breaks = (s) => esc(s).replace(/([._/-])(?=[^\s])/g, "$1<wbr>");
// Only https links and same-page anchors are drawn as links.
const safeHref = (h) => (typeof h === "string" && /^(https:\/\/[^\s"'<>]+|#[A-Za-z0-9_-]+)$/.test(h) ? h : null);
// A class from a fixed list, or nothing.
const oneOf = (v, list) => (list.includes(v) ? v : "");
// Visually hidden words for a mark that is otherwise only colour or line style.
const sr = (t) => (t ? `<span class="sr"> (${t})</span>` : "");

// ---------- figures ----------

const KIND = { screenshot: "Screenshot", code: "Code", list: "List", table: "Table", chips: "List", timeline: "Timeline", flow: "Flow", layers: "Drawing" };

export function kindLabel(fig) {
  let k = fig.type === "pair" ? (arr(fig.sides).length === 2 ? "Before and after" : "Compare") : own(KIND, fig.type) || "Figure";
  if (fig.toy) k += " · illustration, not part of the change";
  return k;
}

const IMAGE_URI = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
function drawScreenshot(fig, assets) {
  const a = own(assets, fig.asset);
  if (!a || typeof a.uri !== "string" || !IMAGE_URI.test(a.uri)) throw new Error(`unknown asset ${String(fig.asset)}`);
  const w = Math.max(1, num(a.w, 1)), h = Math.max(1, num(a.h, 1));
  const ring = arr(fig.ring).length === 4 ? (() => {
    const [rx, ry, rw, rh] = fig.ring.map((v) => num(v));
    return `<svg class="ring" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><rect x="${rx - 3}" y="${ry - 3}" width="${Math.max(0, rw + 6)}" height="${Math.max(0, rh + 6)}" rx="7" vector-effect="non-scaling-stroke"/></svg>`;
  })() : "";
  const scale = num(fig.scale, 1) > 0 ? num(fig.scale, 1) : 1;
  return `<div class="cap-wrap"><div class="shot" style="max-width:${Math.round(w / scale)}px"><img src="${esc(a.uri)}" width="${w}" height="${h}" alt="${esc(fig.alt || fig.caption || fig.title || "")}">${ring}</div></div>`;
}

function drawCode(fig, spec) {
  const text = arr(fig.text).map((t) => String(t ?? ""));
  const start = Math.max(1, int(fig.start, 1));
  const marked = new Set(fig.marked === "all" ? text.map((_, i) => start + i) : arr(fig.marked).map((n) => int(n, -1)));
  const mode = fig.mark === "out" ? "out" : "hl";
  const lines = text.map((t, i) => {
    const n = start + i;
    const m = marked.has(n);
    const said = m ? `<span class="sr">${mode === "out" ? "removed" : "marked"}: </span>` : "";
    return `<span class="ln${m ? " " + mode : ""}"><span class="no">${n}</span><span class="sg">${m && mode === "out" ? "−" : ""}</span><span class="tx">${said}${esc(t.replace(/\t/g, "  ")) || " "}</span></span>`;
  }).join("");
  const at = fig.at || spec.base;
  return `<div class="code"><div class="code-h"><span class="code-p">${breaks(fig.path)}</span><span class="code-at">at ${esc(String(at ?? "").slice(0, 9))}</span></div><pre tabindex="0" aria-label="${esc(fig.path)}, lines ${start} to ${start + Math.max(0, text.length - 1)}">${lines}</pre></div>`;
}

const ROW_SAID = { out: "removed", new: "new", acc: "highlighted" };
function drawList(fig) {
  return `<ul class="rows">${arr(fig.rows).map((r) => {
    r = r || {};
    const mark = oneOf(r.mark, ["out", "new", "acc"]);
    const tag = r.tag ? `<span class="tag${r.tagAcc ? " tag-acc" : ""}">${esc(r.tag)}</span>` : "";
    return `<li class="${mark}"><span class="${r.mono ? "mono-t" : "t"}">${r.mono ? breaks(r.text) : esc(r.text)}</span>${sr(own(ROW_SAID, mark))}${r.note ? `<span class="n">${esc(r.note)}</span>` : ""}${tag}</li>`;
  }).join("")}</ul>`;
}

const col = (c) => (typeof c === "string" ? { label: c } : c && typeof c === "object" ? c : { label: "" });
const cellText = (c) => (c && typeof c === "object" ? c.text : c ?? "");
// The column that takes the spare width: the one marked "fill", else the one with the longest text.
export function fillColumn(fig) {
  const cols = arr(fig.columns);
  const marked = cols.findIndex((c) => c && typeof c === "object" && c.fill);
  if (marked >= 0) return marked;
  let best = 0, len = -1;
  cols.forEach((_, i) => {
    const l = Math.max(...arr(fig.rows).map((r) => String(cellText(arr(r)[i])).length), 0);
    if (l > len) { len = l; best = i; }
  });
  return best;
}

function drawTable(fig) {
  const cols = arr(fig.columns).map(col);
  const fill = fillColumn(fig);
  const tpl = cols.map((_, i) => (i === fill ? "minmax(0,1fr)" : "auto")).join(" ");
  const cell = (c, i, head) => {
    const cc = typeof c === "object" && c ? c : { text: c ?? "" };
    const cd = cols[i] || {};
    const mono = cc.mono ?? cd.mono;
    const acc = cc.acc ?? cd.acc;
    const cls = ["td", mono && !head ? "mono" : "", acc && !head ? "acc" : "", cd.end ? "end" : "", i === fill ? "fill" : ""].filter(Boolean).join(" ");
    const text = mono && !head ? breaks(cc.text) : esc(cc.text);
    return head
      ? `<span class="${cls}" role="columnheader">${text}</span>`
      : `<span class="${cls}" role="cell" data-l="${esc(cd.label)}">${text}${acc ? sr("highlighted") : ""}</span>`;
  };
  const head = `<div class="tr th" role="row">${cols.map((c, i) => cell(c.label, i, true)).join("")}</div>`;
  const rows = arr(fig.rows).map((r) => `<div class="tr" role="row">${cols.map((_, i) => cell(arr(r)[i], i, false)).join("")}</div>`).join("");
  return `<div class="tbw"><div class="tb" role="table" aria-label="${esc(fig.title || "")}" style="grid-template-columns:${tpl}">${head}${rows}</div></div>`;
}

const CHIP_MARKS = ["out", "changed", "new", "acc"];
const CHIP_SAID = { out: "goes", changed: "changes", new: "new", acc: "highlighted" };
const chipOf = (text, mark) => {
  const m = oneOf(mark, CHIP_MARKS);
  return `<li class="chip${m ? " " + m : ""}">${breaks(text)}${m === "changed" ? `<i aria-hidden="true"></i>` : ""}${sr(own(CHIP_SAID, m))}</li>`;
};
function drawChips(fig) {
  const legend = arr(fig.legend).length
    ? `<p class="key">${fig.legend.map((l) => { const m = oneOf((l || {}).mark, CHIP_MARKS); return `<span class="key-i"><span class="chip sm${m ? " " + m : ""}" aria-hidden="true">name${m === "changed" ? `<i></i>` : ""}</span>${esc((l || {}).text)}</span>`; }).join("")}</p>`
    : "";
  return `<ul class="chips">${arr(fig.chips).map((c) => chipOf((c || {}).text, (c || {}).mark || ((c || {}).acc ? "acc" : ""))).join("")}</ul>${legend}`;
}

function drawTimeline(fig) {
  const stops = arr(fig.stops);
  const n = stops.length;
  const bands = arr(fig.bands);
  const b = bands.map((x) => {
    x = x || {};
    const from = Math.min(Math.max(int(x.from), 0), Math.max(n - 1, 0));
    const to = Math.min(Math.max(int(x.to, from), from), Math.max(n - 1, 0));
    return `<span class="band${x.acc ? " acc" : ""}" style="--b1:${from + 1};--b2:${to + 2}">${esc(x.label)}${x.acc ? sr("highlighted") : ""}</span>`;
  }).join("");
  const s = stops.map((x, i) => {
    x = x || {};
    const dot = x.mark === "ask" ? `<span class="dot ask" aria-hidden="true">?</span>` : `<span class="dot${x.mark === "acc" ? " acc" : ""}" aria-hidden="true"></span>`;
    const said = x.mark === "ask" ? sr("open question") : x.mark === "acc" ? sr("highlighted") : "";
    return `<li class="stop${i === 0 ? " first" : ""}${i === n - 1 ? " last" : ""}" style="--c:${i + 1}">${dot}<b class="${x.mono ? "mono" : ""}">${x.mono ? breaks(x.label) : esc(x.label)}</b>${said}${[x.sub, x.sub2].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</li>`;
  }).join("");
  return `<ol class="trk${bands.length ? " has-bands" : ""}" style="--n:${Math.max(n, 1)}">${b}${s}</ol>`;
}

const STEP_MARKS = ["plain", "acc", "new", "gone", "muted"];
const STEP_SAID = { acc: "changes", new: "added", gone: "removed" };
function drawFlow(fig) {
  const steps = arr(fig.steps);
  const n = steps.length;
  const cells = [];
  steps.forEach((s, i) => {
    s = s || {};
    if (i > 0) cells.push(`<li class="fl-a" aria-hidden="true"><span class="fl-ar"></span>${s.via ? `<span class="fl-v">${esc(s.via)}</span>` : ""}</li>`);
    const m = oneOf(s.mark, STEP_MARKS) || "plain";
    const via = i > 0 ? `<span class="sr">then${s.via ? ` (${esc(s.via)})` : ""}: </span>` : "";
    cells.push(`<li class="fl-s fl-${m}">${via}<b class="${s.mono ? "mono" : ""}">${s.mono ? breaks(s.label) : esc(s.label)}</b>${s.sub ? `<span>${esc(s.sub)}</span>` : ""}${sr(own(STEP_SAID, m))}</li>`);
  });
  const tpl = Array.from({ length: Math.max(n, 1) }, () => "minmax(0,1fr)").join(" auto ");
  return `<ol class="flow${n > 4 ? " long" : ""}" style="--tpl:${tpl}">${cells.join("")}</ol>`;
}

function drawLayers(fig) {
  return `<ol class="lay">${arr(fig.rows).map((r) => {
    r = r || {};
    const items = arr(r.items);
    const chips = items.length ? `<ul class="chips">${items.map((t) => (typeof t === "string" ? chipOf(t, "") : chipOf((t || {}).text, (t || {}).mark))).join("")}</ul>` : "";
    const tag = r.tag ? `<div class="lay-tag"><span class="pr-tag${r.tagAcc ? " acc" : ""}">${esc(r.tag)}</span></div>` : `<div class="lay-tag"></div>`;
    return `<li class="lay-r"><div class="lay-n"><b>${esc(r.label)}</b>${r.sub ? `<span>${esc(r.sub)}</span>` : ""}</div><div class="lay-c">${r.text ? `<p class="mini ink">${esc(r.text)}</p>` : ""}${chips}</div>${tag}</li>`;
  }).join("")}</ol>`;
}

function drawPair(fig, spec, assets) {
  const sides = arr(fig.sides);
  return `<div class="pair pair-${Math.min(Math.max(sides.length, 2), 4)}">${sides.map((s) => {
    s = s || {};
    const inner = s.figure && s.figure.type !== "pair" ? drawBody(s.figure, spec, assets) : "";
    return `<div class="pair-s">
    <p class="pair-h"><b class="${s.acc ? "acc" : ""}">${esc(s.label)}</b>${s.note ? `<span>${esc(s.note)}</span>` : ""}${s.toy && !s.note ? `<span>an illustration, not part of the change</span>` : ""}</p>
    ${inner}
    ${s.caption ? `<p class="mini">${esc(s.caption)}</p>` : ""}
  </div>`;
  }).join("")}</div>`;
}

export function drawBody(fig, spec, assets) {
  switch (fig && fig.type) {
    case "screenshot": return drawScreenshot(fig, assets);
    case "code": return drawCode(fig, spec);
    case "list": return drawList(fig);
    case "table": return drawTable(fig);
    case "chips": return drawChips(fig);
    case "timeline": return drawTimeline(fig);
    case "flow": return drawFlow(fig);
    case "layers": return drawLayers(fig);
    case "pair": return drawPair(fig, spec, assets);
    default: throw new Error(`unknown figure type ${String(fig && fig.type)}`);
  }
}

function figureHtml(fig, id, spec, assets) {
  return `<figure class="fig fx fig-${esc(oneOf(fig && fig.type, FIGURE_TYPES))}" id="${esc(id)}">
  <div class="fig-h"><span class="fig-k">${esc(kindLabel(fig))}</span><span class="fig-t">${esc(plain(fig.title))}</span></div>
  ${drawBody(fig, spec, assets)}
  ${fig.caption ? `<figcaption class="cap">${esc(fig.caption)}</figcaption>` : ""}
</figure>`;
}

// ---------- side cards ----------

// A card spans both columns when its figure needs the width, when it says so, or when it would
// otherwise sit alone in its row (an empty cell beside a card reads as a mistake).
const WIDE = ["code", "table", "pair", "flow", "timeline", "layers"];
export function cardWidths(cards) {
  const wide = cards.map((c) => (c.wide !== undefined ? Boolean(c.wide) : Boolean(c.figure && WIDE.includes(c.figure.type))));
  let i = 0;
  while (i < cards.length) {
    if (wide[i]) { i++; continue; }
    // a narrow card: does a second narrow card follow it in the same row?
    if (i + 1 < cards.length && !wide[i + 1]) { i += 2; continue; }
    if (cards[i].wide === undefined) wide[i] = true;
    i++;
  }
  return wide;
}

function cardsHtml(sec, spec, assets) {
  const cards = arr(sec.cards).map((c) => c || {});
  if (!cards.length) return "";
  const wide = cardWidths(cards);
  return `<div class="sides-w"><div class="sides">${cards.map((c, j) => {
    const id = `${sec.id}-${c.id}`;
    let visual = "";
    if (c.figure) {
      const f = figureHtml(c.figure, `${id}-f`, spec, assets);
      visual = c.fold ? `<details class="fold"><summary>Show ${esc(plain(c.figure.title))}</summary>${f}</details>` : f;
    }
    return `<div class="side${wide[j] ? " wide" : ""}" id="${esc(id)}"><h3>${esc(plain(c.title))}</h3><div class="side-t">${arr(c.body).map((b) => `<p>${inline(b)}</p>`).join("")}</div>${visual}</div>`;
  }).join("")}</div></div>`;
}

// ---------- files and sources ----------

export function citesOfFigure(f, out = []) {
  if (!f) return out;
  for (const c of arr(f.cites)) out.push(c);
  for (const s of arr(f.sides)) citesOfFigure(s && s.figure, out);
  return out;
}

export function sectionCites(sec) {
  const ids = [];
  const seen = new Set();
  const add = (l) => arr(l).forEach((c) => { if (!seen.has(c)) { seen.add(c); ids.push(c); } });
  add(sec.cites);
  add(citesOfFigure(sec.figure));
  for (const c of arr(sec.cards)) { if (c) { add(c.cites); add(citesOfFigure(c.figure)); } }
  return ids;
}

function sourceRow(id, s, links, base) {
  if (!s || typeof s !== "object") return `<li><span class="s-l">${esc(id)}</span></li>`;
  const where = s.kind === "git" ? `${s.path}${s.lines ? ":" + s.lines : ""} at ${String(s.at || base || "").slice(0, 9)}` : `${s.path}${s.lines ? ":" + s.lines : ""}`;
  const href = safeHref(links.source(s));
  const w = href ? `<a class="s-w" href="${esc(href)}">${breaks(where)}</a>` : `<span class="s-w">${breaks(where)}</span>`;
  const quotes = [].concat(s.quote || []).map((q) => `<q>${esc(String(q).replace(/\s+/g, " "))}</q>`).join(" ");
  return `<li><span class="s-l">${esc(s.label || id)}</span>${w}${quotes ? `<span class="s-q">${quotes}</span>` : ""}</li>`;
}

function fileHtml(a, secId, links) {
  a = a || {};
  const tag = a.tag ? `<span class="tag${a.tagAcc ? " tag-acc" : ""}">${esc(a.tag)}</span>` : "";
  const inner = `<span class="f-n">${breaks(a.name)}</span><span class="f-d">${inline(a.note || "")}</span>${tag}`;
  const title = a.path || a.note || a.name;
  if (a.card) return `<li><a class="file" href="#${esc(secId)}-${esc(a.card)}" data-jump="${esc(secId)}-${esc(a.card)}" title="${esc(title)}">${inner}</a></li>`;
  const href = safeHref(links.file(a));
  if (href) return `<li><a class="file" href="${esc(href)}" title="${esc(title)}">${inner}</a></li>`;
  return `<li><span class="file" title="${esc(title)}">${inner}</span></li>`;
}

function folds(sec, spec, links) {
  const ids = sectionCites(sec);
  const files = arr(sec.files);
  return `<div class="folds">${files.length ? `<details class="src"><summary>Files · ${files.length}</summary><ul class="files">${files.map((a) => fileHtml(a, sec.id, links)).join("")}</ul></details>` : ""}
  <details class="src"><summary>Sources · ${ids.length}</summary><ul class="srcs">${ids.map((id) => sourceRow(id, own(spec.sources, id), links, spec.base)).join("")}</ul></details></div>`;
}

// ---------- page ----------

function sectionHtml(sec, i, n, spec, assets, links) {
  return `<section class="card" id="${esc(sec.id)}" data-sec="${int(i)}" aria-labelledby="${esc(sec.id)}-h">
  <div class="card-grid">
    <div class="left"><div class="left-in">
      <p class="label"><span class="pos">${pad2(i + 1)} / ${pad2(n)}</span><span>${esc(plain(sec.title))}</span></p>
      <h2 id="${esc(sec.id)}-h" tabindex="-1">${esc(plain(sec.heading))}</h2>
      ${sec.question ? `<p class="question">${esc(plain(sec.question))}</p>` : ""}
      <p class="sub">${inline(sec.lead)}</p>
      ${folds(sec, spec, links)}
    </div></div>
    <div class="right">${figureHtml(sec.figure, `${sec.id}-f`, spec, assets)}${cardsHtml(sec, spec, assets)}</div>
  </div>
</section>`;
}

const OV_KINDS = ["Decided", "Change", "Kept", "Open"];
export function render(spec, opts) {
  const { css, runtime } = opts;
  const assets = opts.assets || {};
  const links = opts.links || { source: () => null, file: () => null };
  const sections = arr(spec.sections).map((s) => s || {});
  const n = sections.length;
  const secIndex = new Map(sections.map((s, i) => [s.id, i]));
  const overview = arr(spec.overview).map((o) => {
    o = o || {};
    const kind = oneOf(o.kind, OV_KINDS) || "Change";
    const at = secIndex.has(o.section) ? pad2(secIndex.get(o.section) + 1) : "";
    return `<li class="ov ov-${kind.toLowerCase()}"><a href="#${esc(o.section)}" data-jump="${esc(o.section)}"><span class="ov-k">${kind}</span><span class="ov-t">${inline(o.text)}</span><span class="ov-n">${at}</span></a></li>`;
  }).join("");
  const intentSrc = arr(spec.intentCites).map((id) => sourceRow(id, own(spec.sources, id), links, spec.base)).join("");
  const meta = [`${n} section${n === 1 ? "" : "s"}`, spec.plan && spec.plan.name ? `from ${esc(spec.plan.name)}` : "", spec.model ? `generated by ${esc(spec.model)}` : ""].filter(Boolean).join(" · ");
  return `<!doctype html>
<!-- Guided plan (${FORMAT}). Built by the guided-plan skill's system/build.mjs from a content file. Do not edit by hand. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="${FORMAT}">
<title>${esc(spec.title)} · guided plan</title>
<script>(function(){var q=new URLSearchParams(location.search).get('theme');if(q==='dark'||q==='light')document.documentElement.dataset.theme=q;})();</script>
<style>${css}</style></head>
<body>
<main class="page">
<button type="button" class="theme" id="theme" aria-label="Switch light or dark">Dark</button>
<header class="top">
  <h1>${esc(spec.title)}</h1>
  <p class="intent">${inline(spec.intent)}</p>
  <ol class="overview" aria-label="Decisions and changes">${overview}</ol>
  <p class="line">${meta}</p>
  ${intentSrc ? `<details class="src top-src"><summary>Sources for this summary</summary><ul class="srcs">${intentSrc}</ul></details>` : ""}
</header>
<div class="cards">
${sections.map((s, i) => sectionHtml(s, i, n, spec, assets, links)).join("\n")}
</div>
<p class="keys">j and k, or the up and down arrows, move between sections.</p>
</main>
<script>
${runtime}
</script>
</body></html>
`;
}

// ---------- size, before drawing ----------

// The most UTF-8 bytes one character of plan text can become in the page, through esc, inline,
// breaks or plain: & is &amp;, " is &quot;, a backtick may open or close <code>, a dot, dash,
// underscore or slash may gain <wbr>, a tab in code is two spaces, and anything past ASCII is at
// most three bytes per UTF-16 unit.
const WEIGHT = (() => {
  const w = new Uint8Array(128).fill(1);
  for (const [c, n] of [["&", 5], ["<", 4], [">", 4], ['"', 6], ["'", 5], ["`", 7], [".", 6], ["_", 6], ["/", 6], ["-", 6], ["\t", 2]]) w[c.charCodeAt(0)] = n;
  return w;
})();
function tw(v) {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  let n = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 128 ? WEIGHT[c] : 3; }
  return n;
}
const hrefw = (h) => (safeHref(h) ? tw(h) : 0);

// An upper bound on the UTF-8 bytes render(spec, opts) returns, read without drawing anything, so a
// host can refuse a page that would be too large before it spends the memory. It follows render:
// every string the page draws, as many times as the page draws it (a source once in every section
// that cites it, and once for each time intentCites names it), and a generous allowance for the
// markup around each element. `uriLength(assetId)` is the length of that screenshot's data: URI.
export function renderSizeBound(spec, { css = "", runtime = "", uriLength = () => 0, links } = {}) {
  links = links || { source: () => null, file: () => null };
  const sources = spec.sources;
  const sourceRow = (id) => {
    const s = own(sources, id);
    if (!s || typeof s !== "object") return 80 + tw(id);
    let n = 200 + tw(s.label) + tw(id) + tw(s.path) + tw(s.lines) + 60 + hrefw(links.source(s));
    for (const q of [].concat(s.quote || [])) n += 24 + tw(q);
    return n;
  };
  const body = (f) => {
    if (!f || typeof f !== "object") return 0;
    switch (f.type) {
      case "screenshot": return 800 + Math.max(0, num(uriLength(f.asset))) + tw(f.alt) + tw(f.caption) + tw(f.title);
      case "code": return 400 + 2 * tw(f.path) + tw(f.at || spec.base) + arr(f.text).reduce((n, t) => n + 200 + tw(t), 0);
      case "list": return 60 + arr(f.rows).reduce((n, r) => n + 250 + tw((r || {}).text) + tw((r || {}).note) + tw((r || {}).tag), 0);
      case "table": {
        const cols = arr(f.columns).map(col);
        let n = 300 + tw(f.title) + cols.length * 20 + cols.reduce((m, c) => m + 200 + tw(c.label), 0);
        for (const r of arr(f.rows)) cols.forEach((c, i) => { n += 250 + tw(c.label) + tw(cellText(arr(r)[i])); });
        return n + arr(f.rows).length * 40;
      }
      case "chips": return 120 + arr(f.chips).reduce((n, c) => n + 200 + tw((c || {}).text), 0) + arr(f.legend).reduce((n, l) => n + 250 + tw((l || {}).text), 0);
      case "timeline": return 200 + arr(f.bands).reduce((n, b) => n + 250 + tw((b || {}).label), 0) + arr(f.stops).reduce((n, s) => n + 400 + tw((s || {}).label) + tw((s || {}).sub) + tw((s || {}).sub2), 0);
      case "flow": return 200 + arr(f.steps).reduce((n, s) => n + 450 + tw((s || {}).label) + tw((s || {}).sub) + 2 * tw((s || {}).via), 0);
      case "layers": return 60 + arr(f.rows).reduce((n, r) => { r = r || {}; return n + 400 + tw(r.label) + tw(r.sub) + tw(r.text) + tw(r.tag) + arr(r.items).reduce((m, t) => m + 200 + tw(typeof t === "string" ? t : (t || {}).text), 0); }, 0);
      case "pair": return 100 + arr(f.sides).reduce((n, s) => { s = s || {}; return n + 300 + tw(s.label) + tw(s.note) + tw(s.caption) + (s.figure && s.figure.type !== "pair" ? body(s.figure) : 0); }, 0);
      default: return 0;
    }
  };
  const figure = (f, idw) => (f ? 500 + idw + tw(f.title) + tw(f.caption) + body(f) : 0);
  let n = 3000 + tw(css) + tw(runtime) + 2 * tw(spec.title) + tw(spec.intent) + tw(spec.plan && spec.plan.name) + tw(spec.model);
  for (const o of arr(spec.overview)) n += 300 + tw((o || {}).text) + 2 * tw((o || {}).section);
  for (const id of arr(spec.intentCites)) n += sourceRow(id);
  for (const sec of arr(spec.sections)) {
    const s = sec || {};
    const sid = tw(s.id);
    n += 1500 + 3 * sid + tw(s.title) + tw(s.heading) + tw(s.question) + tw(s.lead) + figure(s.figure, sid);
    for (const c of arr(s.cards)) {
      const cc = c || {};
      n += 300 + sid + tw(cc.id) + tw(cc.title) + arr(cc.body).reduce((m, b) => m + 20 + tw(b), 0);
      if (cc.figure) n += figure(cc.figure, sid + tw(cc.id)) + 100 + tw(cc.figure.title);
    }
    for (const a of arr(s.files)) {
      const f = a || {};
      n += 300 + tw(f.tag) + 2 * tw(f.name) + 2 * tw(f.note) + tw(f.path) + (f.card ? 2 * (sid + tw(f.card)) : hrefw(links.file(f)));
    }
    for (const id of sectionCites(s)) n += sourceRow(id);
  }
  return n;
}
