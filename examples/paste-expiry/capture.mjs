// Makes assets/new-paste.png: pastebox's new paste page (pastebox/views/new.html with its
// stylesheet), opened in headless Chromium at 2x. Needs Playwright:
//   PLAYWRIGHT=/path/to/node_modules/playwright node examples/paste-expiry/capture.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 440 }, deviceScaleFactor: 2 });
await page.route("**/style.css", (r) => r.fulfill({ contentType: "text/css", body: readFileSync(join(here, "pastebox/style.css"), "utf8") }));
await page.goto(pathToFileURL(join(here, "pastebox/views/new.html")).href);
await page.locator("main").screenshot({ path: join(here, "assets/new-paste.png") });
await browser.close();
