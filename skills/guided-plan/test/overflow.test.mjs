// Needs Playwright (headless Chromium). Point PLAYWRIGHT at its folder, or install it where Node
// finds it; without it this test is skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { EXAMPLE } from "./helpers.mjs";
import { loadChromium, renderPage } from "./render.mjs";

const chromium = loadChromium();
test("nothing is wider than the window at 390, 1130 and 1440, light and dark", { skip: chromium ? false : "Playwright not found; set PLAYWRIGHT", timeout: 120000 }, async () => {
  const { problems } = await renderPage(join(EXAMPLE, "guided-plan.html"), { chromium });
  assert.deepEqual(problems, []);
});

test("the overflow check catches a page that is too wide", { skip: chromium ? false : "Playwright not found; set PLAYWRIGHT", timeout: 120000 }, async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "guided-plan-wide-"));
  try {
    const file = join(dir, "wide.html");
    writeFileSync(file, '<!doctype html><meta name="viewport" content="width=device-width"><div style="width:600px">too wide on a phone</div><pre style="overflow-x:auto;width:200px">' + "x".repeat(400) + "</pre>");
    const { problems } = await renderPage(file, { chromium, openFolds: false });
    assert.ok(problems.some((p) => p.startsWith("390") && /ends at/.test(p)), problems.join("\n"));
    assert.ok(problems.some((p) => /scrolls sideways/.test(p)), problems.join("\n"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("in forced colours the marks still show as borders", { skip: chromium ? false : "Playwright not found; set PLAYWRIGHT", timeout: 120000 }, async () => {
  const { pathToFileURL } = await import("node:url");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(pathToFileURL(join(EXAMPLE, "guided-plan.html")).href);
    const widths = await page.evaluate(() => Object.fromEntries([".ln.hl", ".fl-acc", ".band.acc", ".rows li.new", ".stop .dot.acc"].map((s) => {
      const e = document.querySelector(s);
      const cs = e && getComputedStyle(e);
      return [s, cs ? Math.max(parseFloat(cs.borderLeftWidth), parseFloat(cs.borderTopWidth)) : -1];
    })));
    for (const [sel, w] of Object.entries(widths)) assert.ok(w >= 3, `${sel}: border ${w}`);
  } finally { await browser.close(); }
});
