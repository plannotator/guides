// Guided plan renderer. Pure: render(spec, { css, runtime, assets, links }) -> one HTML string.
// The same spec and assets give the same bytes. No clock, no randomness, no network.
//
// Layout: a header (title, intent, the overview rows, a meta line), then one card per section.
// A card has two columns. LEFT: the title, "01 / 07", a Read checkbox, the lettered parts (the
// selected one opens its text), the files and a sources disclosure. RIGHT: the figure for the
// selected part. At 760 px and under, the figure drops under the text.
//
// Figures: screenshot, code, list, timeline, chips, drawing (boxes and arrows), toggle (before
// and after), steps (step through). A list, timeline, chips or drawing may also carry controls and
// rules: a rule is { if: { key: value }, then: { gone, show, set, caption } } and the first rule
// whose `if` matches wins. Rules are data, never code.

export const FORMAT = "guided-plan/1";

export function resolve(fig, values) {
  const rules = fig.rules || [];
  for (const r of rules) {
    const cond = r.if || {};
    if (Object.keys(cond).every((k) => values[k] === cond[k])) return r.then || {};
  }
  return {};
}

export function initialValues(fig) {
  const v = {};
  for (const c of fig.controls || []) v[c.key] = (fig.initial && fig.initial[c.key]) || c.options[0].value;
  return v;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pad2 = (n) => String(n).padStart(2, "0");

// `code` only; everything else is plain text.
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
}

// ---------- element state, decided at build time for the first view ----------

function mk(st) {
  const gone = new Set(st.gone || []);
  const show = new Set(st.show || []);
  const set = st.set || {};
  return {
    // An element a rule can ghost (data-el) or reveal (data-opt, for optional elements).
    attr(id, optional) {
      if (!id) return "";
      if (optional) return ` data-opt="${esc(id)}"${show.has(id) ? ' data-on="1"' : ""}`;
      return ` data-el="${esc(id)}"${gone.has(id) ? ' data-gone="1"' : ""}`;
    },
    // A text a rule can replace.
    text(id, fallback) {
      const t = id && id in set ? set[id] : fallback ?? "";
      return id ? { t, slot: ` data-slot="${esc(id)}"` } : { t, slot: "" };
    },
  };
}

// ---------- the ids a rule may name, per figure ----------

export function figureIds(fig) {
  const el = [], opt = [], slot = [];
  const add = (x, hasSlot) => {
    if (!x || !x.id) return;
    (x.optional ? opt : el).push(x.id);
    if (hasSlot) slot.push(x.id);
  };
  switch (fig.type) {
    case "list": (fig.rows || []).forEach((r) => add(r, true)); break;
    case "chips": (fig.chips || []).forEach((c) => add(c, false)); break;
    case "timeline": (fig.stops || []).forEach((s) => add(s, true)); break;
    case "drawing":
      (fig.rows || []).forEach((r) => (r.nodes || []).forEach((n) => add(n, true)));
      (fig.edges || []).forEach((e) => add(e, true));
      break;
    default: return null;
  }
  return { el, opt, slot };
}

// ---------- drawing layout (shared with the lint, so a box that would overflow is refused) ----------

const CHAR = 7.3; // average width of a 13 px label, in px; deliberately wide so text never touches the edge
const SUBCHAR = 6.5; // 11.5 px

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function layoutDrawing(fig) {
  const W = 620;
  const errs = [];
  const rows = fig.rows || [];
  const hasLabels = rows.some((r) => r.label);
  const gx = hasLabels ? 108 : 0;
  const avail = W - gx;
  const GAP = 20;
  const ROWGAP = 62;
  const setIds = new Set();
  for (const r of fig.rules || []) Object.keys((r.then && r.then.set) || {}).forEach((k) => setIds.add(k));
  const nodes = {};
  let y = 8;
  const rowBoxes = [];
  const rowOf = {};
  rows.forEach((row, ri) => (row.nodes || []).forEach((nd) => { if (nd.id) rowOf[nd.id] = ri; }));
  rows.forEach((row, ri) => {
    const ns = row.nodes || [];
    const n = ns.length;
    // An arrow between two boxes of this row needs room for its head and its label.
    const side = (fig.edges || []).filter((e) => rowOf[e.from] === ri && rowOf[e.to] === ri);
    const gap = side.length ? Math.max(36, ...side.map((e) => Math.ceil((e.text || "").length * 6.4) + 28)) : GAP;
    const w = Math.min(190, Math.floor((avail - gap * (n - 1)) / Math.max(n, 1)));
    if (w < 90) errs.push(`row ${ri + 1}: its boxes and the arrow labels between them do not fit; use fewer boxes or shorter labels`);
    const total = w * n + gap * (n - 1);
    let x = gx + Math.round((avail - total) / 2);
    const laid = ns.map((node) => {
      const maxChars = Math.floor((w - 20) / CHAR);
      const lines = wrap(node.text, maxChars);
      if (lines.length > 2 || lines.some((l) => l.length > maxChars)) errs.push(`node ${node.id || node.text}: "${node.text}" does not fit its box; shorten it or put fewer boxes in the row`);
      const subs = [node.sub, ...(fig.rules || []).map((r) => (node.id && r.then && r.then.set ? r.then.set[node.id] : undefined))].filter(Boolean);
      const subMax = Math.floor((w - 20) / SUBCHAR);
      subs.forEach((s) => { if (s.length > subMax) errs.push(`node ${node.id || node.text}: second line "${s}" is over ${subMax} characters for its box`); });
      const hasSub = Boolean(node.sub) || setIds.has(node.id);
      const h = 22 + lines.length * 17 + (hasSub ? 17 : 0);
      const box = { ...node, x, w, lines, hasSub, row: ri, col: ns.indexOf(node), h };
      x += w + gap;
      return box;
    });
    const rh = Math.max(46, ...laid.map((b) => b.h));
    laid.forEach((b) => {
      b.y = y + Math.round((rh - b.h) / 2);
      b.cx = b.x + b.w / 2;
      b.cy = b.y + b.h / 2;
      if (b.id) {
        if (nodes[b.id]) errs.push(`node id ${b.id} is used twice`);
        nodes[b.id] = b;
      }
    });
    rowBoxes.push({ y, h: rh, label: row.label, nodes: laid });
    y += rh + ROWGAP;
  });
  const height = y - ROWGAP + 8;
  const edges = (fig.edges || []).map((e) => {
    const a = nodes[e.from], b = nodes[e.to];
    if (!a || !b) { errs.push(`edge ${e.id || ""} ${e.from} -> ${e.to}: unknown box`); return null; }
    if (a === b) { errs.push(`edge ${e.from} -> ${e.to}: a box cannot point at itself`); return null; }
    if (Math.abs(a.row - b.row) > 1) { errs.push(`edge ${e.from} -> ${e.to}: an arrow joins boxes in the same row or the next one; it would cross the row between`); return null; }
    let d, head, lx, ly, anchor;
    if (a.row === b.row) {
      const right = b.x > a.x;
      const sx = right ? a.x + a.w : a.x, ex = right ? b.x : b.x + b.w;
      const sy = a.cy, ey = b.cy;
      d = `M${sx},${sy} L${ex},${ey}`;
      head = right ? `M${ex - 6},${ey - 4} L${ex},${ey} L${ex - 6},${ey + 4}` : `M${ex + 6},${ey - 4} L${ex},${ey} L${ex + 6},${ey + 4}`;
      lx = (sx + ex) / 2; ly = sy - 8; anchor = "middle";
      if (Math.abs(a.col - b.col) > 1) errs.push(`edge ${e.from} -> ${e.to}: an arrow in a row joins neighbouring boxes; it would cross the box between`);
    } else {
      const down = b.row > a.row;
      const sx = a.cx, sy = down ? a.y + a.h : a.y;
      const ex = b.cx, ey = down ? b.y : b.y + b.h;
      const k = (ey - sy) / 2;
      d = `M${sx},${sy} C${sx},${sy + k} ${ex},${ey - k} ${ex},${ey}`;
      head = down ? `M${ex - 4},${ey - 6} L${ex},${ey} L${ex + 4},${ey - 6}` : `M${ex - 4},${ey + 6} L${ex},${ey} L${ex + 4},${ey + 6}`;
      // the label sits beside the arrow's end, over the box it points at, so fanned-out arrows never share a spot
      lx = ex + 7; ly = down ? ey - 11 : ey + 19; anchor = "start";
      if (e.text && e.text.length * 6.2 > b.w / 2 - 10) errs.push(`edge ${e.from} -> ${e.to}: label "${e.text}" is too long for the box it points at; keep it to a word or two`);
    }
    return { ...e, d, head, lx, ly, anchor };
  }).filter(Boolean);
  return { W, gx, height, rows: rowBoxes, nodes, edges, errs, spine: Boolean(fig.spine) && hasLabels };
}

function drawDrawing(fig, st) {
  const h = mk(st);
  const L = layoutDrawing(fig);
  const labels = L.rows.map((r) => {
    if (!r.label) return "";
    const lines = wrap(r.label, 12);
    const cy = r.y + r.h / 2 - ((lines.length - 1) * 16) / 2 + 4;
    return `<text x="0" y="${cy}" class="lab ink">${lines.map((l, i) => `<tspan x="0" dy="${i ? 16 : 0}">${esc(l)}</tspan>`).join("")}</text>`;
  }).join("");
  const spine = L.spine ? L.rows.slice(0, -1).map((r, i) => {
    const nx = L.rows[i + 1];
    const lines = wrap(r.label || "", 12).length;
    const nlines = wrap(nx.label || "", 12).length;
    const sy = r.y + r.h / 2 + ((lines - 1) * 16) / 2 + 14;
    const ey = nx.y + nx.h / 2 - ((nlines - 1) * 16) / 2 - 12;
    return `<path d="M8,${sy} V${ey}" class="sp"/><path d="M4,${ey - 6} L8,${ey} L12,${ey - 6}" class="sp"/>`;
  }).join("") : "";
  const boxes = L.rows.flatMap((r) => r.nodes).map((b) => {
    const style = ["plain", "acc", "new", "muted", "gone"].includes(b.style) ? b.style : "plain";
    const sub = h.text(b.id, b.sub);
    const ty = b.y + 25;
    const text = b.lines.map((l, i) => `<tspan x="${b.cx}" dy="${i ? 17 : 0}">${esc(l)}</tspan>`).join("");
    const subY = ty + b.lines.length * 17;
    return `<g class="node n-${style}"${h.attr(b.id, b.optional)}><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10"/><text x="${b.cx}" y="${ty}" class="nt" text-anchor="middle">${text}</text>${b.hasSub ? `<text x="${b.cx}" y="${subY}" class="ns" text-anchor="middle"${sub.slot}>${esc(sub.t)}</text>` : ""}</g>`;
  }).join("");
  const edges = L.edges.map((e) => {
    const label = h.text(e.id, e.text);
    const style = e.style === "acc" ? "acc" : e.style === "gone" ? "gone" : "plain";
    const hasLabel = e.text || (e.id && (fig.rules || []).some((r) => r.then && r.then.set && e.id in r.then.set));
    return `<g class="edge e-${style}"${h.attr(e.id, e.optional)}><path d="${e.d}" class="ep"/><path d="${e.head}" class="ep"/>${hasLabel ? `<text x="${e.lx}" y="${e.ly}" class="elab" text-anchor="${e.anchor}"${label.slot}>${esc(label.t)}</text>` : ""}</g>`;
  }).join("");
  // A plain-text account of the drawing for screen readers.
  const name = (id) => (L.nodes[id] ? L.nodes[id].text : id);
  const said = [
    ...L.rows.map((r) => `${r.label ? r.label + ": " : ""}${r.nodes.map((b) => b.text + (b.sub ? ` (${b.sub})` : "")).join(", ")}.`),
    ...L.edges.map((e) => `${name(e.from)} to ${name(e.to)}${e.text ? `: ${e.text}` : ""}.`),
  ].join(" ");
  return `<svg class="pic" viewBox="0 0 ${L.W} ${L.height}" role="img" aria-label="${esc(fig.title)}"><desc>${esc(said)}</desc>${labels}${spine}${edges}${boxes}</svg>`;
}

function drawTimeline(fig, st) {
  const h = mk(st);
  const stops = fig.stops;
  const n = stops.length;
  const x0 = 110, x1 = 510;
  const xs = stops.map((_, i) => (n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1)));
  const hasBands = (fig.bands || []).length > 0;
  const ly = hasBands ? 92 : 50;
  const bands = (fig.bands || []).map((b) => {
    const a = b.from === 0 ? xs[0] - 50 : (xs[b.from - 1] + xs[b.from]) / 2;
    const z = b.to === n - 1 ? xs[n - 1] + 50 : (xs[b.to] + xs[b.to + 1]) / 2;
    return `<rect x="${a}" y="${ly - 58}" width="${z - a}" height="28" rx="6" class="${b.acc ? "band-acc" : "band"}"/><text x="${(a + z) / 2}" y="${ly - 39.5}" text-anchor="middle" class="lab${b.acc ? " acc" : " ink"}">${esc(b.label)}</text>`;
  }).join("");
  const dots = stops.map((s, i) => {
    const x = xs[i];
    const dot = s.mark === "ask"
      ? `<circle cx="${x}" cy="${ly}" r="11" class="mark"/><text x="${x}" y="${ly + 4.5}" class="markt">?</text>`
      : `<circle cx="${x}" cy="${ly}" r="7" class="${s.mark === "acc" ? "dot-acc" : "dot"}"/>`;
    const sub = h.text(s.id, s.sub);
    return `<g${h.attr(s.id, s.optional)}>${dot}<text x="${x}" y="${ly + 34}" text-anchor="middle" class="${s.mono ? "mono ink" : "lab ink"}">${esc(s.label)}</text><text x="${x}" y="${ly + 54}" text-anchor="middle" class="lab"${sub.slot}>${esc(sub.t)}</text>${s.sub2 ? `<text x="${x}" y="${ly + 72}" text-anchor="middle" class="lab">${esc(s.sub2)}</text>` : ""}</g>`;
  }).join("");
  return `<svg class="pic" viewBox="0 0 620 ${ly + 90}" role="img" aria-label="${esc(fig.title)}"><desc>${esc(stops.map((s) => [s.label, s.sub, s.sub2].filter(Boolean).join(", ")).join("; "))}</desc>${bands}<line x1="60" y1="${ly}" x2="560" y2="${ly}" class="track"/>${dots}</svg>`;
}

function drawChips(fig, st) {
  const h = mk(st);
  return `<ul class="chips">${fig.chips.map((c) => `<li class="chip${c.acc ? " solidc" : ""}"${h.attr(c.id, c.optional)}>${esc(c.text)}</li>`).join("")}</ul>`;
}

function drawList(fig, st) {
  const h = mk(st);
  return `<ul class="rows">${fig.rows.map((r) => {
    const note = h.text(r.id, r.note);
    return `<li${h.attr(r.id, r.optional)}><span class="${r.mono ? "mono-t" : "t"}">${esc(r.text)}</span><span class="n"${note.slot}>${esc(note.t)}</span>${r.tag ? `<span class="tag${r.tagAcc ? " tag-acc" : ""}">${esc(r.tag)}</span>` : ""}</li>`;
  }).join("")}</ul>`;
}

function drawCode(fig, spec) {
  const marked = new Set(fig.marked === "all" ? fig.text.map((_, i) => fig.start + i) : fig.marked || []);
  const mode = fig.mark === "out" ? "out" : "hl";
  const lines = fig.text.map((t, i) => {
    const n = fig.start + i;
    const m = marked.has(n);
    return `<span class="ln${m ? " " + mode : ""}"><span class="no">${n}</span><span class="sg">${m && mode === "out" ? "\u2212" : " "}</span><span class="tx">${esc(t.replace(/\t/g, "  ")) || " "}</span></span>`;
  }).join("");
  const at = fig.at || spec.base;
  return `<div class="code"><div class="code-h"><span class="code-p">${esc(fig.path)}</span><span class="code-at">at ${esc(String(at).slice(0, 9))}</span></div><pre tabindex="0" aria-label="${esc(fig.path)}, lines ${fig.start} to ${fig.start + fig.text.length - 1}">${lines}</pre></div>`;
}

function drawScreenshot(fig, assets) {
  const a = assets[fig.asset];
  if (!a) throw new Error(`unknown asset ${fig.asset}`);
  const [rx, ry, rw, rh] = fig.ring || [];
  const ring = fig.ring ? `<svg class="ring" viewBox="0 0 ${a.w} ${a.h}" preserveAspectRatio="none" aria-hidden="true"><rect x="${rx - 3}" y="${ry - 3}" width="${rw + 6}" height="${rh + 6}" rx="7" vector-effect="non-scaling-stroke"/></svg>` : "";
  const scale = fig.scale || 1;
  return `<div class="shot" style="max-width:${Math.round(a.w / scale)}px"><img src="${a.uri}" width="${a.w}" height="${a.h}" alt="${esc(fig.alt || fig.caption || fig.title)}">${ring}</div>`;
}

function drawStatic(fig, spec, assets, st) {
  switch (fig.type) {
    case "screenshot": return drawScreenshot(fig, assets);
    case "code": return drawCode(fig, spec);
    case "list": return drawList(fig, st);
    case "chips": return drawChips(fig, st);
    case "timeline": return drawTimeline(fig, st);
    case "drawing": return drawDrawing(fig, st);
    default: throw new Error(`unknown figure type ${fig.type}`);
  }
}

// A toggle or steps figure is a control over whole states, each holding a static figure.
export function statesAsControls(fig) {
  return {
    controls: [{ key: "state", label: fig.label || (fig.type === "steps" ? "Step" : "Show"), stepper: fig.type === "steps", options: fig.states.map((s) => ({ value: s.value, text: s.label })) }],
    rules: fig.states.map((s) => ({ if: { state: s.value }, then: { caption: s.caption } })),
    initial: fig.initial ? { state: fig.initial } : undefined,
  };
}

function controlsHtml(controls, values, fid) {
  return controls.map((c) => {
    const btns = c.options.map((o) => `<button type="button" class="seg-b" data-key="${esc(c.key)}" data-val="${esc(o.value)}" aria-pressed="${values[c.key] === o.value}">${esc(o.text)}</button>`).join("");
    const step = c.stepper ? `<span class="step"><button type="button" class="nav-b" data-step="${esc(c.key)}" data-d="-1" aria-label="Back one">\u2190</button><button type="button" class="nav-b" data-step="${esc(c.key)}" data-d="1" aria-label="Forward one">\u2192</button></span>` : "";
    return `<div class="ctl"><span class="ctl-l" id="${fid}-${esc(c.key)}">${esc(c.label)}</span><span class="seg" role="group" aria-labelledby="${fid}-${esc(c.key)}">${btns}</span>${step}</div>`;
  }).join("");
}

const KIND = { screenshot: "Screenshot", code: "Code", list: "List", chips: "List", timeline: "Timeline", drawing: "Drawing", steps: "Step through" };

function figureHtml(fig, fid, spec, assets) {
  const composite = fig.type === "toggle" || fig.type === "steps";
  const live = composite ? { ...statesAsControls(fig) } : { controls: fig.controls, rules: fig.rules, initial: fig.initial };
  const values = initialValues(live);
  const st = resolve(live, values);
  let body;
  if (composite) {
    body = fig.states.map((s) => `<div class="state" data-when="state=${esc(s.value)}"${values.state === s.value ? "" : " hidden"}>${drawStatic(s.figure, spec, assets, {})}</div>`).join("");
  } else {
    body = drawStatic(fig, spec, assets, st);
  }
  const caption = st.caption || fig.caption || "";
  const script = live.rules ? `<script type="application/json" data-rules>${JSON.stringify({ rules: live.rules, controls: (live.controls || []).map((c) => ({ key: c.key, options: c.options.map((o) => o.value) })), values }).replace(/</g, "\\u003c")}</script>` : "";
  let kind = fig.type === "toggle" ? (fig.states.length === 2 ? "Before and after" : "Compare") : fig.controls ? "Try it" : KIND[fig.type];
  if (fig.toy) kind += " \u00b7 illustration";
  return `<figure class="fig fig-${fig.type}" data-fig="${fid}">
  <div class="fig-h"><span class="fig-t"><span class="fig-k">${kind}</span>${esc(fig.title)}</span>${controlsHtml(live.controls || [], values, fid)}</div>
  <div class="fig-b">${body}</div>
  <figcaption data-cap aria-live="polite">${esc(caption)}</figcaption>${script}
</figure>`;
}

// ---------- page ----------

function citesOf(p) {
  const ids = [...(p.cites || []), ...((p.figure && p.figure.cites) || [])];
  for (const s of (p.figure && p.figure.states) || []) ids.push(...((s.figure && s.figure.cites) || []));
  return ids;
}

function sourcesFor(sec) {
  const ids = [];
  for (const p of sec.parts) for (const c of citesOf(p)) if (!ids.includes(c)) ids.push(c);
  return ids;
}

function sourceRow(id, s, links) {
  const where = s.kind === "git" ? `${s.path}${s.lines ? ":" + s.lines : ""} at ${String(s.at).slice(0, 9)}` : `${s.path}${s.lines ? ":" + s.lines : ""}`;
  const href = links.source(s);
  const w = href ? `<a class="s-w" href="${esc(href)}">${esc(where)}</a>` : `<span class="s-w">${esc(where)}</span>`;
  const quotes = [].concat(s.quote || []).map((q) => `<q>${esc(String(q).replace(/\s+/g, " "))}</q>`).join(" ");
  return `<li><span class="s-l">${esc(s.label || id)}</span>${w}${quotes ? `<span class="s-q">${quotes}</span>` : ""}</li>`;
}

function fileHtml(a, secId, links) {
  const tag = a.tag ? `<span class="tag${a.tagAcc ? " tag-acc" : ""}">${esc(a.tag)}</span>` : "";
  const inner = `<span class="f-n">${esc(a.name)}</span><span class="f-d">${inline(a.note || "")}</span>${tag}`;
  const title = a.path || a.note || a.name;
  if (a.part) return `<li><button type="button" class="file" data-goto="${esc(secId)}.${esc(a.part)}" title="${esc(title)}">${inner}</button></li>`;
  const href = links.file(a);
  if (href) return `<li><a class="file" href="${esc(href)}" title="${esc(title)}">${inner}</a></li>`;
  return `<li><span class="file" title="${esc(title)}">${inner}</span></li>`;
}

function sectionHtml(sec, i, n, spec, assets, links) {
  const pos = `${pad2(i + 1)} / ${pad2(n)}`;
  const parts = sec.parts.map((p, j) => {
    const sel = j === 0;
    return `<li class="part${sel ? " is-sel" : ""}" data-part="${esc(p.id)}">
      <button type="button" class="part-b" aria-expanded="${sel}" aria-controls="${esc(sec.id)}-${esc(p.id)}-t ${esc(sec.id)}-${esc(p.id)}-f"><span class="part-i">${String.fromCharCode(97 + j)}</span><span class="part-t">${esc(p.title)}</span></button>
      <div class="part-body" id="${esc(sec.id)}-${esc(p.id)}-t"${sel ? "" : " hidden"}>${p.body.map((b) => `<p>${inline(b)}</p>`).join("")}</div>
    </li>`;
  }).join("");
  const figs = sec.parts.map((p, j) => `<div class="panel" id="${esc(sec.id)}-${esc(p.id)}-f" data-panel="${esc(p.id)}"${j === 0 ? "" : " hidden"}>${figureHtml(p.figure, `${sec.id}-${p.id}`, spec, assets)}</div>`).join("");
  const srcIds = sourcesFor(sec);
  const files = sec.files || [];
  return `<section class="card" id="${esc(sec.id)}" data-sec="${i}" aria-labelledby="${esc(sec.id)}-h">
  <div class="card-row">
    <button type="button" class="check" role="checkbox" aria-checked="false" aria-label="Mark ${esc(sec.title)} as read"><span class="box-c"></span></button>
    <button type="button" class="row-t" data-open>${esc(sec.title)}</button>
    <span class="row-m">read \u00b7 ${pos}</span>
  </div>
  <div class="card-grid">
    <div class="left">
      <h2 id="${esc(sec.id)}-h" tabindex="-1">${esc(sec.title)}</h2>
      <div class="meta"><span class="pos">${pos}</span><button type="button" class="check" role="checkbox" aria-checked="false"><span class="box-c"></span>Read</button></div>
      <ol class="parts" aria-label="Parts of this section">${parts}</ol>
    </div>
    <div class="right">${figs}</div>
    <div class="foot">
      ${files.length ? `<p class="files-h">Files</p><ul class="files">${files.map((a) => fileHtml(a, sec.id, links)).join("")}</ul>` : ""}
      <details class="src"><summary>Sources \u00b7 ${srcIds.length}</summary><ul>${srcIds.map((id) => sourceRow(id, spec.sources[id], links)).join("")}</ul></details>
    </div>
  </div>
</section>`;
}

export function render(spec, opts) {
  const { css, runtime, assets } = opts;
  const links = opts.links || { source: () => null, file: () => null };
  const n = spec.sections.length;
  const secIndex = Object.fromEntries(spec.sections.map((s, i) => [s.id, i]));
  const overview = spec.overview.map((o) => `<li class="ov ov-${esc(o.kind.toLowerCase())}"><a href="#${esc(o.section)}" data-jump="${esc(o.section)}"><span class="ov-k">${esc(o.kind)}</span><span class="ov-t">${inline(o.text)}</span><span class="ov-n">${pad2(secIndex[o.section] + 1)}</span></a></li>`).join("");
  const intentSrc = (spec.intentCites || []).map((id) => sourceRow(id, spec.sources[id], links)).join("");
  const meta = [`${n} section${n === 1 ? "" : "s"}`, spec.plan && spec.plan.name ? `from ${esc(spec.plan.name)}` : "", spec.model ? `generated by ${esc(spec.model)}` : ""].filter(Boolean).join(" \u00b7 ");
  return `<!doctype html>
<!-- Guided plan (${FORMAT}). Built by the guided-plan skill's system/build.mjs from a content file. Do not edit by hand. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="${FORMAT}">
<title>${esc(spec.title)} \u00b7 guided plan</title>
<script>(function(){var q=new URLSearchParams(location.search).get('theme');document.documentElement.dataset.theme=q||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');})();</script>
<style>${css}</style></head>
<body>
<main class="page">
<header class="top">
  <button type="button" class="theme" id="theme" aria-label="Switch light or dark">Dark</button>
  <h1>${esc(spec.title)}</h1>
  <p class="intent">${inline(spec.intent)}</p>
  <ol class="overview" aria-label="Decisions and changes">${overview}</ol>
  <p class="line"><span>${meta}</span><span id="readcount"></span></p>
  ${intentSrc ? `<details class="src top-src"><summary>Sources for this summary</summary><ul>${intentSrc}</ul></details>` : ""}
</header>
<div class="cards">
${spec.sections.map((s, i) => sectionHtml(s, i, n, spec, assets, links)).join("\n")}
</div>
<p class="keys">j and k, or the up and down arrows, move between sections. In a section's list of parts, the arrows move between parts. In a figure's buttons, left and right move between choices.</p>
</main>
<script>
var resolve=${resolve.toString()};
${runtime}
</script>
</body></html>
`;
}
