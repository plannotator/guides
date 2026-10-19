#!/usr/bin/env node
// Opens a built guided plan in headless Chromium at 390, 1130 and 1440 px, light and dark, checks
// that nothing is wider than the window, and (with --shots DIR) saves a full-page PNG of each.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright node render.mjs page.html [--shots DIR]
//
// Headless only: no window opens, and no keyboard or clipboard of the computer is touched.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WIDTHS = [390, 1130, 1440];
export const THEMES = ["light", "dark"];

export function loadChromium() {
  const require = createRequire(import.meta.url);
  try { return require(process.env.PLAYWRIGHT || "playwright").chromium; } catch { return null; }
}

// Every element wider than the window, and every element that scrolls sideways.
async function overflow(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const bad = [];
    if (document.documentElement.scrollWidth > W) bad.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${W}`);
    for (const e of document.querySelectorAll("body *")) {
      if (e.closest("[hidden]") || e.closest(".sr")) continue;
      const r = e.getBoundingClientRect();
      const name = `${e.tagName.toLowerCase()}${typeof e.className === "string" && e.className ? "." + e.className.split(" ")[0] : ""}`;
      if (r.width && r.right > W + 0.5) bad.push(`${name} ends at ${Math.round(r.right)} (window ${W})`);
      const ox = getComputedStyle(e).overflowX;
      if (e.clientWidth && e.scrollWidth > e.clientWidth + 1 && ox !== "visible" && ox !== "hidden" && ox !== "clip") bad.push(`${name} scrolls sideways (${e.scrollWidth} in ${e.clientWidth})`);
    }
    return bad;
  });
}

export async function renderPage(file, { shots, chromium = loadChromium(), openFolds = true } = {}) {
  if (!chromium) throw new Error("Playwright is not installed; set PLAYWRIGHT to its folder");
  const browser = await chromium.launch({ headless: true });
  const problems = [];
  const written = [];
  try {
    for (const w of WIDTHS) for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 1000 }, deviceScaleFactor: w < 600 ? 2 : 1, reducedMotion: "reduce", colorScheme: theme });
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(resolve(file)).href + `?theme=${theme}`);
      await page.waitForLoadState("load");
      for (const p of await overflow(page)) problems.push(`${w} ${theme}: ${p}`);
      if (openFolds) {
        // every fold open, so what it holds is measured too
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        for (const p of await overflow(page)) problems.push(`${w} ${theme}, folds open: ${p}`);
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = false)));
      }
      if (shots) {
        mkdirSync(shots, { recursive: true });
        const out = join(shots, `${basename(file, ".html")}-${w}-${theme}.png`);
        await page.screenshot({ path: out, fullPage: true });
        written.push(out);
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  return { problems: [...new Set(problems)], written };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--shots");
  const shots = i >= 0 ? resolve(args[i + 1]) : null;
  const file = args.find((a, j) => !a.startsWith("--") && j !== i + 1);
  if (!file) { console.error("usage: node render.mjs page.html [--shots DIR]"); process.exit(1); }
  const { problems, written } = await renderPage(file, { shots });
  written.forEach((w) => console.log(w));
  if (problems.length) { console.log(problems.join("\n")); process.exit(1); }
  console.log("Nothing is wider than the window at 390, 1130 or 1440, light or dark.");
}
