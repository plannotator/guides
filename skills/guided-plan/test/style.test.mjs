import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../system/guide.css"), "utf8");
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
const light = tokens(css.match(/^:root\{([^}]*)\}/m)[1]);
const dark = tokens(css.match(/:root\[data-theme=dark\]\{([^}]*)\}/)[1]);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (s) => { const m = s.match(/rgba\((\d+),(\d+),(\d+),([.\d]+)\)/); return m ? [[+m[1], +m[2], +m[3]], +m[4]] : [hex(s), 1]; };
const over = ([c, a], bg) => c.map((v, i) => v * a + bg[i] * (1 - a));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const [name, t] of [["light", light], ["dark", dark]]) {
  test(`${name}: small grey text passes 4.5:1 on every ground`, () => {
    for (const ground of ["bg", "surface", "tint"]) for (const ink of ["ink2", "ink3"]) {
      const bg = hex(t[ground]);
      const r = ratio(over(rgba(t[ink]), bg), bg);
      assert.ok(r >= 4.5, `${ink} on ${ground}: ${r.toFixed(2)}`);
    }
  });
}

test("forced colours keep a visible mark on highlighted lines, accent steps, bands and new rows", () => {
  const fc = css.match(/@media \(forced-colors:active\)\{([\s\S]*?)\n\}/)[1];
  for (const sel of [".ln.hl", ".fl-acc", ".fl-new", ".band.acc", ".rows li.new", ".stop .dot.acc", ".chip.out"]) assert.ok(fc.includes(sel), sel);
  assert.match(fc, /Highlight/);
});
