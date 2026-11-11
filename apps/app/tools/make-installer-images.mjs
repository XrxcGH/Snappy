/**
 * Draws the pictures of the Windows installer (the NSIS wizard) from the brand logo and tokens, and writes
 * them as 24-bit BMP files, each at two sizes:
 *
 *   header.bmp      150 x 57 px    the strip at the top of the inner wizard pages
 *   sidebar.bmp     164 x 314 px   the left side of the Welcome and Finish pages
 *   header-3x.bmp   450 x 171 px   the same picture drawn at three times the size
 *   sidebar-3x.bmp  492 x 942 px
 *
 * The first two are what the wizard shows at 100% display scaling. NSIS stretches a bitmap to its control
 * with a plain pixel copy (no smoothing), so on a scaled display installer/pictures.nsh shrinks the 3x files
 * to the exact size of the control with a smoothing filter and hands that to the wizard (see docs/RELEASES.md).
 *
 * It needs nothing installed: it reads the mark's bars from brand/logo/snappy-mark.svg and the outlined
 * wordmark from brand/logo/snappy-wordmark.svg, the colors from brand/tokens/tokens.css, and draws them
 * itself (anti-aliased, eight by eight samples a pixel, from the exact outlines). The same files give the
 * same bytes.
 *
 *   node apps/app/tools/make-installer-images.mjs [--out <folder>]    (default: apps/app/src-tauri/installer)
 *   node apps/app/tools/make-installer-images.mjs --check              (fails if the committed files differ)
 *
 * The files are committed, so a build does not need to run this. Run it again after a logo or token change.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const defaultOut = path.join(repo, "apps", "app", "src-tauri", "installer");

const read = (rel) => readFileSync(path.join(repo, rel), "utf8");

// ---------- colors, from the brand tokens ----------
const tokens = read("brand/tokens/tokens.css");
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (!m) throw new Error(`brand token --${name} not found`);
  const n = parseInt(m[1].slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const INK = token("brand-ink");
const BONE = token("brand-bone");
const VIOLET = token("brand-violet");
const VIOLET_ON_DARK = token("brand-violet-on-dark");
const WHITE = [255, 255, 255];

// ---------- shapes ----------
const ARC_STEPS = 32;
const QUAD_STEPS = 12;

/** The mark: each bar as a pill (every rx in the file is half the bar's height), and whether it is the spine. */
function markBars() {
  const svg = read("brand/logo/snappy-mark.svg");
  const bars = [...svg.matchAll(/<rect\b([^>]*)\/>/g)].map((m) => {
    const attr = (name) => {
      const a = new RegExp(`\\b${name}="([^"]*)"`).exec(m[1]);
      return a ? a[1] : null;
    };
    return { x: Number(attr("x")), y: Number(attr("y")), w: Number(attr("width")), h: Number(attr("height")), spine: /accent/.test(attr("fill") ?? "") };
  });
  if (bars.length !== 5 || bars.filter((b) => b.spine).length !== 1) throw new Error("the mark should have five bars and one spine");
  return bars;
}

function pill(x, y, w, h) {
  const r = h / 2;
  const pts = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / ARC_STEPS;
    pts.push([x + w - r + r * Math.cos(a), y + r + r * Math.sin(a)]);
  }
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / ARC_STEPS;
    pts.push([x + r + r * Math.cos(a), y + r + r * Math.sin(a)]);
  }
  return [pts];
}

/** The wordmark's outline (moves, lines, quadratic curves) as polygons. */
function wordmarkPolygons() {
  const svg = read("brand/logo/snappy-wordmark.svg");
  const d = /<path\b[^>]*\bd="([^"]*)"/.exec(svg)?.[1];
  if (!d) throw new Error("the wordmark has no path");
  const tokens = d.match(/[MLQZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const polys = [];
  let cur = null;
  let at = [0, 0];
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "M") {
      cur = [];
      polys.push(cur);
      at = [num(), num()];
      cur.push(at);
    } else if (cmd === "L") {
      at = [num(), num()];
      cur.push(at);
    } else if (cmd === "Q") {
      const [cx, cy, x, y] = [num(), num(), num(), num()];
      for (let s = 1; s <= QUAD_STEPS; s++) {
        const t = s / QUAD_STEPS;
        cur.push([(1 - t) * (1 - t) * at[0] + 2 * (1 - t) * t * cx + t * t * x, (1 - t) * (1 - t) * at[1] + 2 * (1 - t) * t * cy + t * t * y]);
      }
      at = [x, y];
    } else if (cmd === "Z") {
      // The shape closes by itself when it is filled.
    } else {
      throw new Error(`unexpected path token ${cmd}`);
    }
  }
  return polys;
}

const place = (polys, scale, dx, dy) => polys.map((p) => p.map(([x, y]) => [x * scale + dx, y * scale + dy]));

// ---------- drawing ----------
const SS = 8;

class Canvas {
  constructor(width, height, ground) {
    this.width = width;
    this.height = height;
    this.px = new Float64Array(width * height * 3);
    for (let i = 0; i < width * height; i++) this.px.set(ground, i * 3);
  }

  /** Fills polygons (non-zero winding) in one color, anti-aliased by sampling. */
  fill(polys, color) {
    const cov = new Float32Array(this.width * this.height);
    const edges = [];
    let top = Infinity;
    let bottom = -Infinity;
    for (const p of polys) {
      for (let k = 0; k < p.length; k++) {
        const [x0, y0] = p[k];
        const [x1, y1] = p[(k + 1) % p.length];
        if (y0 === y1) continue;
        edges.push({ x0, y0, x1, y1, dir: y1 > y0 ? 1 : -1, lo: Math.min(y0, y1), hi: Math.max(y0, y1) });
        top = Math.min(top, y0, y1);
        bottom = Math.max(bottom, y0, y1);
      }
    }
    const first = Math.max(0, Math.floor(top * SS));
    const last = Math.min(this.height * SS - 1, Math.ceil(bottom * SS));
    for (let sy = first; sy <= last; sy++) {
      const y = (sy + 0.5) / SS;
      const crossings = [];
      for (const e of edges) {
        if (y >= e.lo && y < e.hi) crossings.push({ x: e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), dir: e.dir });
      }
      crossings.sort((a, b) => a.x - b.x);
      let winding = 0;
      for (let c = 0; c < crossings.length - 1; c++) {
        winding += crossings[c].dir;
        if (winding === 0) continue;
        const from = Math.max(0, Math.ceil(crossings[c].x * SS - 0.5));
        const to = Math.min(this.width * SS - 1, Math.ceil(crossings[c + 1].x * SS - 0.5) - 1);
        const row = Math.floor(sy / SS) * this.width;
        for (let sx = from; sx <= to; sx++) cov[row + Math.floor(sx / SS)] += 1 / (SS * SS);
      }
    }
    for (let i = 0; i < cov.length; i++) {
      const a = Math.min(1, cov[i]);
      if (a === 0) continue;
      for (let c = 0; c < 3; c++) this.px[i * 3 + c] = this.px[i * 3 + c] * (1 - a) + color[c] * a;
    }
  }

  /** A 24-bit bottom-up BMP, rows padded to four bytes. */
  bmp() {
    const rowBytes = Math.ceil((this.width * 3) / 4) * 4;
    const size = 54 + rowBytes * this.height;
    const out = Buffer.alloc(size);
    out.write("BM", 0, "latin1");
    out.writeUInt32LE(size, 2);
    out.writeUInt32LE(54, 10);
    out.writeUInt32LE(40, 14);
    out.writeInt32LE(this.width, 18);
    out.writeInt32LE(this.height, 22);
    out.writeUInt16LE(1, 26);
    out.writeUInt16LE(24, 28);
    out.writeUInt32LE(rowBytes * this.height, 34);
    out.writeInt32LE(2835, 38);
    out.writeInt32LE(2835, 42);
    for (let y = 0; y < this.height; y++) {
      const row = 54 + (this.height - 1 - y) * rowBytes;
      for (let x = 0; x < this.width; x++) {
        for (let c = 0; c < 3; c++) out[row + x * 3 + (2 - c)] = Math.max(0, Math.min(255, Math.round(this.px[(y * this.width + x) * 3 + c])));
      }
    }
    return out;
  }
}

/** The mark with its top-left corner of the bars' bounding box at (x, y), `scale` pixels to a unit. */
function drawMark(canvas, bars, x, y, scale, barColor, spineColor) {
  const left = Math.min(...bars.map((b) => b.x));
  const top = Math.min(...bars.map((b) => b.y));
  for (const b of bars) canvas.fill(pill(x + (b.x - left) * scale, y + (b.y - top) * scale, b.w * scale, b.h * scale), b.spine ? spineColor : barColor);
}

const markSize = (bars) => ({ w: Math.max(...bars.map((b) => b.x + b.w)) - Math.min(...bars.map((b) => b.x)), h: Math.max(...bars.map((b) => b.y + b.h)) - Math.min(...bars.map((b) => b.y)) });

/**
 * One scene at `k` times its nominal size. The layout is in whole nominal pixels, with the mark at a scale where each
 * bar is a whole number of pixels, so at k = 1 the bars start and end on the pixel grid; k only multiplies it.
 */
function drawScene(k) {
  const bars = markBars();
  const word = wordmarkPolygons();
  const wordW = 162.54;
  const wordH = 40.52;
  const m = markSize(bars);

  // Sidebar: the dark brand ground, the mark over the wordmark, and a violet edge at the foot.
  const side = new Canvas(164 * k, 314 * k, INK);
  const sMark = 1.75 * k; // 14 px bars, 21 px apart, at k = 1
  drawMark(side, bars, 40 * k, 78 * k, sMark, BONE, VIOLET_ON_DARK);
  const sWord = 0.62 * k;
  side.fill(place(word, sWord, (164 * k - wordW * sWord) / 2, 198 * k), BONE);
  side.fill([[[0, 308 * k], [164 * k, 308 * k], [164 * k, 314 * k], [0, 314 * k]]], VIOLET_ON_DARK);

  // Header: a white ground like the wizard page, the mark beside the wordmark, centered.
  const head = new Canvas(150 * k, 57 * k, WHITE);
  const hMark = 0.75 * k; // 6 px bars, 9 px apart, at k = 1
  const hWord = 0.42 * k;
  const x0 = 18 * k;
  drawMark(head, bars, x0, 7 * k, hMark, INK, VIOLET);
  head.fill(place(word, hWord, x0 + m.w * hMark + 9 * k, 20 * k), INK);

  return { header: head.bmp(), sidebar: side.bmp() };
}

export function drawImages() {
  const one = drawScene(1);
  const three = drawScene(3);
  return { "header.bmp": one.header, "sidebar.bmp": one.sidebar, "header-3x.bmp": three.header, "sidebar-3x.bmp": three.sidebar };
}

function main() {
  const args = process.argv.slice(2);
  const files = drawImages();
  if (args.includes("--check")) {
    let bad = 0;
    for (const [name, bytes] of Object.entries(files)) {
      let have = null;
      try {
        have = readFileSync(path.join(defaultOut, name));
      } catch {
        // missing counts as different
      }
      if (have === null || !have.equals(bytes)) {
        console.error(`${name} differs from what this script draws`);
        bad++;
      }
    }
    process.exit(bad === 0 ? 0 : 1);
  }
  const at = args.indexOf("--out");
  const out = at >= 0 ? path.resolve(args[at + 1]) : defaultOut;
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(path.join(out, name), bytes);
    console.log(`wrote ${path.join(out, name)} (${bytes.length} bytes)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
