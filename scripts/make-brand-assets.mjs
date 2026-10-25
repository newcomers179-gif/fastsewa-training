/**
 * Renders the app's icon, splash, favicon and notification icon (client/assets/images/*.png) from the
 * SVG sources in client/assets/brand/. Run it after replacing an SVG with the official artwork:
 *
 *   npx --yes playwright@1 install chromium   # once, if no Chromium is installed
 *   node scripts/make-brand-assets.mjs
 *
 * Playwright is only needed for this one-off job, so it is deliberately not a project dependency.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = join(root, "client/assets/brand");
const OUT = join(root, "client/assets/images");

/** [svg, png, pixels, transparent background?] */
const JOBS = [
  ["icon.svg", "icon.png", 1024, false], // iOS and store listing: no transparency allowed
  ["adaptive-icon.svg", "adaptive-icon.png", 1024, true], // Android foreground; its background colour is set in app.json
  ["splash-icon.svg", "splash-icon.png", 1024, true], // drawn on the splash colour from app.json
  ["favicon.svg", "favicon.png", 192, true],
  ["notification-icon.svg", "notification-icon.png", 96, true], // Android status bar: white on transparent
];

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i --no-save playwright   (or see the header of this file)");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [svgName, pngName, size, transparent] of JOBS) {
    const svg = readFileSync(join(SOURCES, svgName), "utf8");
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
    const png = await page.screenshot({ type: "png", omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(join(OUT, pngName), png);
    await page.close();
    console.log(`${pngName.padEnd(22)} ${size}x${size}${transparent ? " (transparent)" : ""}`);
  }
} finally {
  await browser.close();
}
