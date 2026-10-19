// Guided plan renderer. Pure: render(spec, { css, runtime, assets, links }) -> one HTML string.
// The same spec and assets give the same bytes. No clock, no randomness, no network.
//
// Layout ("cards that read"): a header (title, intent, the overview rows, a meta line), then one
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

export const FORMAT = "guided-plan/2";
export const FIGURE_TYPES = ["screenshot", "code", "list", "table", "chips", "timeline", "flow", "layers", "pair"];
// A pair's sides hold any figure but another pair.
export const SIDE_TYPES = FIGURE_TYPES.filter((t) => t !== "pair");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pad2 = (n) => String(n).padStart(2, "0");
// Titles and headings are plain text: backticks are removed, not drawn as code.
export const plain = (s) => String(s).replace(/`/g, "");
// `code` only; everything else is plain text.
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
// Long names break only after a dot, an underscore, a dash or a slash, never mid-word.
const breaks = (s) => esc(s).replace(/([._/-])(?=[^\s])/g, "$1<wbr>");

// ---------- figures ----------

const KIND = { screenshot: "Screenshot", code: "Code", list: "List", table: "Table", chips: "List", timeline: "Timeline", flow: "Flow", layers: "Drawing" };

export function kindLabel(fig) {
  let k = fig.type === "pair" ? ((fig.sides || []).length === 2 ? "Before and after" : "Compare") : KIND[fig.type] || "Figure";
  if (fig.toy) k += " · illustration, not part of the change";
  return k;
}

function drawScreenshot(fig, assets) {
  const a = assets[fig.asset];
  if (!a) throw new Error(`unknown asset ${fig.asset}`);
  const [rx, ry, rw, rh] = fig.ring || [];
  const ring = fig.ring ? `<svg class="ring" viewBox="0 0 ${a.w} ${a.h}" preserveAspectRatio="none" aria-hidden="true"><rect x="${rx - 3}" y="${ry - 3}" width="${rw + 6}" height="${rh + 6}" rx="7" vector-effect="non-scaling-stroke"/></svg>` : "";
  const scale = fig.scale || 1;
  return `<div class="cap-wrap"><div class="shot" style="max-width:${Math.round(a.w / scale)}px"><img src="${a.uri}" width="${a.w}" height="${a.h}" alt="${esc(fig.alt || fig.caption || fig.title || "")}">${ring}</div></div>`;
}

function drawCode(fig, spec) {
  const marked = new Set(fig.marked === "all" ? fig.text.map((_, i) => fig.start + i) : fig.marked || []);
  const mode = fig.mark === "out" ? "out" : "hl";
  const lines = fig.text.map((t, i) => {
    const n = fig.start + i;
    const m = marked.has(n);
    return `<span class="ln${m ? " " + mode : ""}"><span class="no">${n}</span><span class="sg">${m && mode === "out" ? "−" : ""}</span><span class="tx">${esc(t.replace(/\t/g, "  ")) || " "}</span></span>`;
  }).join("");
  const at = fig.at || spec.base;
  return `<div class="code"><div class="code-h"><span class="code-p">${breaks(fig.path)}</span><span class="code-at">at ${esc(String(at).slice(0, 9))}</span></div><pre tabindex="0" aria-label="${esc(fig.path)}, lines ${fig.start} to ${fig.start + fig.text.length - 1}">${lines}</pre></div>`;
}

const ROW_MARKS = { out: " out", new: " new", acc: " acc" };
function drawList(fig) {
  return `<ul class="rows">${fig.rows.map((r) => {
    const tag = r.tag ? `<span class="tag${r.tagAcc ? " tag-acc" : ""}">${esc(r.tag)}</span>` : "";
    return `<li class="${(ROW_MARKS[r.mark] || "").trim()}"><span class="${r.mono ? "mono-t" : "t"}">${r.mono ? breaks(r.text) : esc(r.text)}</span>${r.note ? `<span class="n">${esc(r.note)}</span>` : ""}${tag}</li>`;
  }).join("")}</ul>`;
}

// The column that takes the spare width: the one marked "fill", else the one with the longest text.
export function fillColumn(fig) {
  const cols = fig.columns || [];
  const marked = cols.findIndex((c) => c && typeof c === "object" && c.fill);
  if (marked >= 0) return marked;
  let best = 0, len = -1;
  cols.forEach((_, i) => {
    const l = Math.max(...(fig.rows || []).map((r) => String(cellText(r[i])).length), 0);
    if (l > len) { len = l; best = i; }
  });
  return best;
}
const col = (c) => (typeof c === "string" ? { label: c } : c || { label: "" });
const cellText = (c) => (c && typeof c === "object" ? c.text : c ?? "");

function drawTable(fig) {
  const cols = fig.columns.map(col);
  const fill = fillColumn(fig);
  const tpl = cols.map((_, i) => (i === fill ? "minmax(0,1fr)" : "auto")).join(" ");
  const cell = (c, i, head) => {
    const cc = typeof c === "object" && c ? c : { text: c ?? "" };
    const cd = cols[i];
    const mono = cc.mono ?? cd.mono;
    const acc = cc.acc ?? cd.acc;
    const cls = ["td", mono && !head ? "mono" : "", acc && !head ? "acc" : "", cd.end ? "end" : "", i === fill ? "fill" : ""].filter(Boolean).join(" ");
    const text = mono && !head ? breaks(cc.text) : esc(cc.text);
    return head
      ? `<span class="${cls}" role="columnheader">${text}</span>`
      : `<span class="${cls}" role="cell" data-l="${esc(cd.label)}">${text}</span>`;
  };
  const head = `<div class="tr th" role="row">${cols.map((c, i) => cell(c.label, i, true)).join("")}</div>`;
  const rows = fig.rows.map((r) => `<div class="tr" role="row">${r.map((c, i) => cell(c, i, false)).join("")}</div>`).join("");
  return `<div class="tbw"><div class="tb" role="table" aria-label="${esc(fig.title || "")}" style="grid-template-columns:${tpl}">${head}${rows}</div></div>`;
}

const CHIP_MARKS = { out: " out", changed: " changed", new: " new", acc: " acc" };
const chip = (text, mark, sm) => `<li class="chip${CHIP_MARKS[mark] || ""}${sm ? " sm" : ""}">${breaks(text)}${mark === "changed" ? `<i aria-hidden="true"></i>` : ""}</li>`;
function drawChips(fig) {
  const legend = (fig.legend || []).length
    ? `<p class="key">${fig.legend.map((l) => `<span class="key-i"><span class="chip sm${CHIP_MARKS[l.mark] || ""}">name${l.mark === "changed" ? `<i aria-hidden="true"></i>` : ""}</span>${esc(l.text)}</span>`).join("")}</p>`
    : "";
  return `<ul class="chips">${fig.chips.map((c) => chip(c.text, c.mark || (c.acc ? "acc" : ""), false)).join("")}</ul>${legend}`;
}

function drawTimeline(fig) {
  const n = fig.stops.length;
  const bands = fig.bands || [];
  const b = bands.map((x) => `<span class="band${x.acc ? " acc" : ""}" style="--b1:${x.from + 1};--b2:${x.to + 2}">${esc(x.label)}</span>`).join("");
  const s = fig.stops.map((x, i) => {
    const dot = x.mark === "ask" ? `<span class="dot ask" aria-hidden="true">?</span>` : `<span class="dot${x.mark === "acc" ? " acc" : ""}" aria-hidden="true"></span>`;
    return `<li class="stop${i === 0 ? " first" : ""}${i === n - 1 ? " last" : ""}" style="--c:${i + 1}">${dot}<b class="${x.mono ? "mono" : ""}">${x.mono ? breaks(x.label) : esc(x.label)}</b>${[x.sub, x.sub2].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("")}</li>`;
  }).join("");
  return `<ol class="trk${bands.length ? " has-bands" : ""}" style="--n:${n}">${b}${s}</ol>`;
}

const STEP_MARKS = ["plain", "acc", "new", "gone", "muted"];
function drawFlow(fig) {
  const n = fig.steps.length;
  const cells = [];
  fig.steps.forEach((s, i) => {
    if (i > 0) cells.push(`<li class="fl-a" aria-hidden="true"><span class="fl-ar"></span>${s.via ? `<span class="fl-v">${esc(s.via)}</span>` : ""}</li>`);
    const m = STEP_MARKS.includes(s.mark) ? s.mark : "plain";
    const via = i > 0 ? `<span class="sr">then${s.via ? ` (${esc(s.via)})` : ""}: </span>` : "";
    cells.push(`<li class="fl-s fl-${m}">${via}<b class="${s.mono ? "mono" : ""}">${s.mono ? breaks(s.label) : esc(s.label)}</b>${s.sub ? `<span>${esc(s.sub)}</span>` : ""}${m === "new" ? `<span class="sr"> (added)</span>` : m === "gone" ? `<span class="sr"> (removed)</span>` : ""}</li>`);
  });
  const tpl = Array.from({ length: n }, () => "minmax(0,1fr)").join(" auto ");
  return `<ol class="flow${n > 4 ? " long" : ""}" style="--tpl:${tpl}">${cells.join("")}</ol>`;
}

function drawLayers(fig) {
  return `<ol class="lay">${fig.rows.map((r) => {
    const chips = (r.items || []).length ? `<ul class="chips">${r.items.map((t) => chip(typeof t === "string" ? t : t.text, typeof t === "string" ? "" : t.mark, false)).join("")}</ul>` : "";
    const tag = r.tag ? `<div class="lay-tag"><span class="pr-tag${r.tagAcc ? " acc" : ""}">${esc(r.tag)}</span></div>` : `<div class="lay-tag"></div>`;
    return `<li class="lay-r"><div class="lay-n"><b>${esc(r.label)}</b>${r.sub ? `<span>${esc(r.sub)}</span>` : ""}</div><div class="lay-c">${r.text ? `<p class="mini ink">${esc(r.text)}</p>` : ""}${chips}</div>${tag}</li>`;
  }).join("")}</ol>`;
}

function drawPair(fig, spec, assets) {
  const n = fig.sides.length;
  return `<div class="pair pair-${n}">${fig.sides.map((s) => `<div class="pair-s">
    <p class="pair-h"><b class="${s.acc ? "acc" : ""}">${esc(s.label)}</b>${s.note ? `<span>${esc(s.note)}</span>` : ""}${s.toy && !s.note ? `<span>an illustration, not part of the change</span>` : ""}</p>
    ${drawBody(s.figure, spec, assets)}
    ${s.caption ? `<p class="mini">${esc(s.caption)}</p>` : ""}
  </div>`).join("")}</div>`;
}

export function drawBody(fig, spec, assets) {
  switch (fig.type) {
    case "screenshot": return drawScreenshot(fig, assets);
    case "code": return drawCode(fig, spec);
    case "list": return drawList(fig);
    case "table": return drawTable(fig);
    case "chips": return drawChips(fig);
    case "timeline": return drawTimeline(fig);
    case "flow": return drawFlow(fig);
    case "layers": return drawLayers(fig);
    case "pair": return drawPair(fig, spec, assets);
    default: throw new Error(`unknown figure type ${fig.type}`);
  }
}

function figureHtml(fig, id, spec, assets) {
  return `<figure class="fig fx fig-${fig.type}" id="${esc(id)}">
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
  const cards = sec.cards || [];
  if (!cards.length) return "";
  const wide = cardWidths(cards);
  return `<div class="sides-w"><div class="sides">${cards.map((c, j) => {
    const id = `${sec.id}-${c.id}`;
    let visual = "";
    if (c.figure) {
      const f = figureHtml(c.figure, `${id}-f`, spec, assets);
      visual = c.fold ? `<details class="fold"><summary>Show ${esc(plain(c.figure.title))}</summary>${f}</details>` : f;
    }
    return `<div class="side${wide[j] ? " wide" : ""}" id="${esc(id)}"><h3>${esc(plain(c.title))}</h3><div class="side-t">${c.body.map((b) => `<p>${inline(b)}</p>`).join("")}</div>${visual}</div>`;
  }).join("")}</div></div>`;
}

// ---------- files and sources ----------

export function citesOfFigure(f, out = []) {
  if (!f) return out;
  for (const c of f.cites || []) out.push(c);
  for (const s of f.sides || []) citesOfFigure(s.figure, out);
  return out;
}

export function sectionCites(sec) {
  const ids = [];
  const add = (l) => (l || []).forEach((c) => { if (!ids.includes(c)) ids.push(c); });
  add(sec.cites);
  add(citesOfFigure(sec.figure));
  for (const c of sec.cards || []) { add(c.cites); add(citesOfFigure(c.figure)); }
  return ids;
}

function sourceRow(id, s, links, base) {
  const where = s.kind === "git" ? `${s.path}${s.lines ? ":" + s.lines : ""} at ${String(s.at || base).slice(0, 9)}` : `${s.path}${s.lines ? ":" + s.lines : ""}`;
  const href = links.source(s);
  const w = href ? `<a class="s-w" href="${esc(href)}">${breaks(where)}</a>` : `<span class="s-w">${breaks(where)}</span>`;
  const quotes = [].concat(s.quote || []).map((q) => `<q>${esc(String(q).replace(/\s+/g, " "))}</q>`).join(" ");
  return `<li><span class="s-l">${esc(s.label || id)}</span>${w}${quotes ? `<span class="s-q">${quotes}</span>` : ""}</li>`;
}

function fileHtml(a, secId, links) {
  const tag = a.tag ? `<span class="tag${a.tagAcc ? " tag-acc" : ""}">${esc(a.tag)}</span>` : "";
  const inner = `<span class="f-n">${breaks(a.name)}</span><span class="f-d">${inline(a.note || "")}</span>${tag}`;
  const title = a.path || a.note || a.name;
  if (a.card) return `<li><a class="file" href="#${esc(secId)}-${esc(a.card)}" data-jump="${esc(secId)}-${esc(a.card)}" title="${esc(title)}">${inner}</a></li>`;
  const href = links.file(a);
  if (href) return `<li><a class="file" href="${esc(href)}" title="${esc(title)}">${inner}</a></li>`;
  return `<li><span class="file" title="${esc(title)}">${inner}</span></li>`;
}

function folds(sec, spec, links) {
  const ids = sectionCites(sec);
  const files = sec.files || [];
  return `<div class="folds">${files.length ? `<details class="src"><summary>Files · ${files.length}</summary><ul class="files">${files.map((a) => fileHtml(a, sec.id, links)).join("")}</ul></details>` : ""}
  <details class="src"><summary>Sources · ${ids.length}</summary><ul class="srcs">${ids.map((id) => sourceRow(id, spec.sources[id], links, spec.base)).join("")}</ul></details></div>`;
}

// ---------- page ----------

function sectionHtml(sec, i, n, spec, assets, links) {
  return `<section class="card" id="${esc(sec.id)}" data-sec="${i}" aria-labelledby="${esc(sec.id)}-h">
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

export function render(spec, opts) {
  const { css, runtime, assets } = opts;
  const links = opts.links || { source: () => null, file: () => null };
  const n = spec.sections.length;
  const secIndex = Object.fromEntries(spec.sections.map((s, i) => [s.id, i]));
  const overview = spec.overview.map((o) => `<li class="ov ov-${esc(o.kind.toLowerCase())}"><a href="#${esc(o.section)}" data-jump="${esc(o.section)}"><span class="ov-k">${esc(o.kind)}</span><span class="ov-t">${inline(o.text)}</span><span class="ov-n">${pad2(secIndex[o.section] + 1)}</span></a></li>`).join("");
  const intentSrc = (spec.intentCites || []).map((id) => sourceRow(id, spec.sources[id], links, spec.base)).join("");
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
${spec.sections.map((s, i) => sectionHtml(s, i, n, spec, assets, links)).join("\n")}
</div>
<p class="keys">j and k, or the up and down arrows, move between sections.</p>
</main>
<script>
${runtime}
</script>
</body></html>
`;
}
