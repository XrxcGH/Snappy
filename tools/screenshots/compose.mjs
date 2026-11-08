/**
 * Turn the raw captures into the small images the README and the docs use, and build the README header image.
 *
 *   PLAYWRIGHT_DIR=<folder with playwright installed> node tools/screenshots/compose.mjs [--in out/screenshots] [--out docs/images]
 *
 * Reads what tools/screenshots/capture.mjs and tools/mobile/ios-webkit.mjs wrote (see docs/images/README.md) and writes to docs/images:
 *   - every desktop, phone and iPhone picture as WebP, sized for a README (GitHub shows WebP in a README);
 *   - readme-header.webp: light and dark side by side, a desktop window with a phone in front of it.
 * The repository's social preview is not made here: it is brand/social-preview.png, built by brand/tools/build-assets.mjs (see docs/BRAND.md).
 * It needs no image library: the headless Chromium that Playwright already provides scales, draws and encodes the pictures,
 * so nothing is installed and nothing leaves this computer. Every source picture comes from the built-in sample data.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEBP_QUALITY = 0.82;

function parseArgs(argv) {
  const out = { in: path.join(root, "out", "screenshots"), out: path.join(root, "docs", "images") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") out.in = path.resolve(argv[++i]);
    else if (argv[i] === "--out") out.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return out;
}

function loadPlaywright() {
  for (const dir of [process.env.PLAYWRIGHT_DIR, root].filter(Boolean)) {
    try { return createRequire(path.join(path.resolve(dir), "noop.js"))("playwright"); } catch { /* next */ }
  }
  throw new Error("Playwright was not found. See the install steps in tools/mobile/ios-webkit.mjs.");
}

const dataUri = (bytes, type) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
const fileUri = (file, type) => dataUri(readFileSync(file), type);

/**
 * Re-encode PNG bytes as WebP in a page. A capture wider than 800 pixels is a phone at 3 pixels per point: it is
 * scaled to 2 per point, which is still sharp at the size a README shows it and keeps the file small.
 */
async function toWebp(page, png) {
  const b64 = await page.evaluate(async ({ src, q }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = img.naturalWidth > 800 && img.naturalWidth < 1500 && img.naturalHeight > img.naturalWidth ? 2 / 3 : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", q));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, { src: dataUri(png, "image/png"), q: WEBP_QUALITY });
  return Buffer.from(b64, "base64");
}

/** Draw some HTML at a fixed size and return the screenshot as PNG bytes. */
async function render(browser, html, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode()));
  });
  const png = await page.screenshot({ type: "png" });
  await context.close();
  return png;
}

function raw(dir, name) {
  const file = path.join(dir, name);
  if (!existsSync(file)) throw new Error(`Missing ${path.relative(root, file)}. Run capture.mjs first.`);
  return fileUri(file, "image/png");
}

/** A light panel and a dark panel side by side, each with a desktop window and a phone in front of it. */
function headerHtml(dir) {
  const panel = (scheme, bg) => `
    <section style="background:${bg}">
      <img class="desk" src="${raw(dir, `desktop-overview-${scheme}.png`)}" alt="">
      <img class="phone" src="${raw(dir, `phone-cleanup-queue-${scheme}.png`)}" alt="">
    </section>`;
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:1600px;height:800px;overflow:hidden}
    body{display:grid;grid-template-columns:1fr 1fr}
    section{position:relative;overflow:hidden}
    img{position:absolute;display:block;border-radius:12px;box-shadow:0 18px 48px rgba(20,16,40,.28),0 0 0 1px rgba(128,128,128,.28)}
    .desk{left:44px;top:92px;width:690px}
    .phone{left:540px;top:208px;width:224px;border-radius:22px}
  </style>${panel("light", "#dfe3ea")}${panel("dark", "#1b1816")}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.in)) throw new Error(`No captures in ${path.relative(root, opts.in)}. Run capture.mjs first.`);
  mkdirSync(opts.out, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const write = (name, bytes) => {
    writeFileSync(path.join(opts.out, name), bytes);
    console.log("wrote", path.relative(root, path.join(opts.out, name)), `${Math.round(bytes.length / 1024)} KB`);
  };
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const name of readdirSync(opts.in).filter((f) => /^(desktop|phone)-.*\.png$/.test(f))) {
      write(name.replace(/\.png$/, ".webp"), await toWebp(page, readFileSync(path.join(opts.in, name))));
    }
    const iosDir = path.join(opts.in, "ios");
    if (existsSync(iosDir)) {
      for (const name of readdirSync(iosDir)) {
        const m = /^(iphone-.+)-(light|dark)-(overview|tool)\.png$/.exec(name);
        if (m) write(`${m[1]}-${m[3]}-${m[2]}.webp`, await toWebp(page, readFileSync(path.join(iosDir, name))));
      }
    }
    write("readme-header.webp", await toWebp(page, await render(browser, headerHtml(opts.in), 1600, 800)));
    await context.close();
  } finally {
    await browser.close();
  }
  const sizes = readdirSync(opts.out).filter((f) => /\.(webp|png)$/.test(f)).map((f) => statSync(path.join(opts.out, f)).size);
  console.log(`${sizes.length} images, ${(sizes.reduce((a, b) => a + b, 0) / 1024 / 1024).toFixed(2)} MB in ${path.relative(root, opts.out)}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
