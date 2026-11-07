// Builds the raster and sheet assets from the brand sources:
//   brand/logo/png/*.png and brand/logo/favicon.ico   from the logo SVGs
//   brand/tokens/palette.svg and palette.png          from brand/tokens/tokens.json
//   brand/social-preview.svg and social-preview.png   from the lockup, the tagline and the independence line
// All text in the generated SVGs is converted to paths, so nothing depends on installed fonts.
//
// Setup, in any scratch folder: npm install opentype.js @resvg/resvg-js
// Fonts: the instanced Bricolage Grotesque file described in outline-wordmark.mjs (set BRICOLAGE to
// its path), plus the Atkinson Hyperlegible Next and JetBrains Mono woff files from the repository's
// node_modules/@fontsource packages.
// Run from the scratch folder:  BRICOLAGE=fonts/inst-w700-opsz48.ttf node <path to this file>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.cwd(), 'noop.js'));
const opentype = require('opentype.js');
const { Resvg } = require('@resvg/resvg-js');

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, '..');
const fontsource = join(brand, '..', 'node_modules', '@fontsource');
const read = (p) => readFileSync(join(brand, p), 'utf8');
const write = (p, data) => {
  mkdirSync(dirname(join(brand, p)), { recursive: true });
  writeFileSync(join(brand, p), data);
};

// ---------- fonts and outlined text ----------
const loadFont = (p) => {
  const b = readFileSync(p);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const fonts = {
  display: loadFont(process.env.BRICOLAGE || 'fonts/inst-w700-opsz48.ttf'),
  body: loadFont(join(fontsource, 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff')),
  bodyBold: loadFont(join(fontsource, 'atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-600-normal.woff')),
  mono: loadFont(join(fontsource, 'jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff')),
};
const num = (v) => String(Math.round(v * 100) / 100 || 0);
function toD(cmds) {
  let out = '';
  for (const c of cmds) {
    const keys = { M: ['x', 'y'], L: ['x', 'y'], Q: ['x1', 'y1', 'x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] }[c.type];
    out += c.type + keys.map((k) => num(c[k])).join(' ');
  }
  return out;
}
// Text as a filled path. anchor: 'start' | 'middle' | 'end'. track is in em.
function text(font, str, x, y, size, fill, { anchor = 'start', track = 0 } = {}) {
  const glyphs = [...str].map((ch) => font.charToGlyph(ch));
  const scale = size / font.unitsPerEm;
  const adv = glyphs.map((g, i) => (g.advanceWidth + (i < glyphs.length - 1 ? font.getKerningValue(g, glyphs[i + 1]) : 0)) * scale + track * size);
  const width = adv.reduce((a, b) => a + b, 0) - track * size;
  let cx = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const cmds = [];
  glyphs.forEach((g, i) => {
    cmds.push(...g.getPath(cx, y, size).commands);
    cx += adv[i];
  });
  return `<path fill="${fill}" d="${toD(cmds)}"/>`;
}

// ---------- shapes ----------
const rect = (x, y, w, h, r, fill, stroke, sw = 1) =>
  `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}/>`;
const markBars = (ink, spine, t = '') =>
  `<g${t ? ` transform="${t}"` : ''}>${[
    [12, 4, 44, ink],
    [8, 16, 20, ink],
    [12, 28, 40, spine],
    [36, 40, 20, ink],
    [8, 52, 44, ink],
  ]
    .map(([x, y, w, f]) => `<rect x="${x}" y="${y}" width="${w}" height="8" rx="4" fill="${f}"/>`)
    .join('')}</g>`;

// ---------- PNG and ICO exports ----------
const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng();
const tokens = JSON.parse(read('tokens/tokens.json'));
const B = tokens.brand;

const appIcon = read('logo/snappy-app-icon.svg');
const favicon = read('logo/snappy-favicon.svg');
const mark = read('logo/snappy-mark.svg').replaceAll('currentColor', B.ink).replaceAll('var(--accent, #6B4DFF)', B.violet);
for (const w of [1024, 512, 192]) write(`logo/png/app-icon-${w}.png`, png(appIcon, w));
for (const w of [32, 16]) write(`logo/png/favicon-${w}.png`, png(favicon, w));
write('logo/png/mark-512.png', png(mark, 512));

// ICO container with PNG entries at 16, 32 and 48.
const sizes = [16, 32, 48];
const images = sizes.map((s) => png(favicon, s));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const o = 6 + 16 * i;
  head.writeUInt8(s, o);
  head.writeUInt8(s, o + 1);
  head.writeUInt8(0, o + 2);
  head.writeUInt8(0, o + 3);
  head.writeUInt16LE(1, o + 4);
  head.writeUInt16LE(32, o + 6);
  head.writeUInt32LE(images[i].length, o + 8);
  head.writeUInt32LE(offset, o + 12);
  offset += images[i].length;
});
write('logo/favicon.ico', Buffer.concat([head, ...images]));

// ---------- palette sheet ----------
const W = 1600;
const M = 64;
const parts = [];
const sheetBg = '#FBFCFC';
const ink = B.ink;
const muted = tokens.light['text-muted'];
let y = 0;

// Header
parts.push(markBars(ink, B.violet, `translate(${M} ${M - 4}) scale(1)`));
parts.push(text(fonts.display, 'Snappy palette', M + 80, M + 44, 40, ink, { track: -0.02 }));
parts.push(text(fonts.body, 'Light and dark themes. Values are read from tokens.json.', M + 80, M + 72, 16, muted));
y = M + 56 + 56;

// Brand colors
parts.push(text(fonts.bodyBold, 'Brand', M, y, 14, ink));
y += 20;
const brandRoles = {
  ink: 'Text and primary on light',
  'ink-dark-ground': 'Dark theme ground',
  bone: 'Light theme ground',
  violet: 'Accent on light grounds',
  'violet-on-dark': 'Accent on dark grounds',
};
const gap = 16;
const bw = (W - 2 * M - 4 * gap) / 5;
Object.entries(B).forEach(([name, hex], i) => {
  const x = M + i * (bw + gap);
  parts.push(rect(x, y, bw, 88, 12, hex, '#D5D9DC'));
  parts.push(text(fonts.bodyBold, name, x, y + 88 + 22, 14, ink));
  parts.push(text(fonts.mono, hex, x, y + 88 + 40, 12, muted));
  parts.push(text(fonts.body, brandRoles[name] || '', x, y + 88 + 58, 12, muted));
});
y += 88 + 58 + 40;

// Theme panels
const panelW = (W - 2 * M - 32) / 2;
const pad = 32;
const cols = 5;
const cw = (panelW - 2 * pad - (cols - 1) * 12) / cols;

function panel(theme, x0, y0) {
  const t = tokens[theme];
  const out = [];
  const body = [];
  let py = y0 + pad;
  body.push(text(fonts.display, theme === 'light' ? 'Light' : 'Dark', x0 + pad, py + 24, 28, t.text, { track: -0.02 }));
  py += 24 + 28;

  const swatchRow = (label, keys) => {
    body.push(text(fonts.bodyBold, label, x0 + pad, py + 12, 13, t.text));
    py += 24;
    keys.forEach((k, i) => {
      const x = x0 + pad + i * (cw + 12);
      body.push(rect(x, py, cw, 52, 8, t[k], t.border, 1));
      body.push(text(fonts.bodyBold, k, x, py + 52 + 18, 12, t.text));
      body.push(text(fonts.mono, t[k].toUpperCase(), x, py + 52 + 34, 11, t['text-muted']));
    });
    py += 52 + 34 + 22;
  };
  swatchRow('Grounds', ['bg', 'surface', 'surface-raised', 'surface-sunken']);
  swatchRow('Text and lines', ['text', 'text-muted', 'border', 'border-strong']);
  swatchRow('Primary', ['primary', 'primary-hover', 'primary-text-on', 'focus-ring']);
  swatchRow('Accent', ['accent', 'accent-hover', 'accent-text-on', 'accent-fg', 'link']);

  const chipRows = (label, rows) => {
    body.push(text(fonts.bodyBold, label, x0 + pad, py + 12, 13, t.text));
    py += 22;
    for (const r of rows) {
      const cx = x0 + pad;
      body.push(rect(cx + 0.5, py + 0.5, 148, 36, 8, r.bg, r.border, 1.5));
      let tx = cx + 14;
      if (r.bars != null) {
        for (let i = 0; i < 3; i++) {
          const filled = i >= 3 - r.bars;
          body.push(
            rect(tx, py + 9 + i * 7, 18, 4, 2, filled ? r.fg : 'none', filled ? null : r.fg, filled ? 0 : 1),
          );
        }
        tx += 28;
      }
      body.push(text(fonts.bodyBold, r.label, tx, py + 24, 14, r.fg));
      let hx = cx + 148 + 28;
      for (const [role, hex] of [['fg', r.fg], ['bg', r.bg], ['border', r.border]]) {
        body.push(rect(hx, py + 10, 16, 16, 4, hex, t['border-strong'], 1));
        body.push(text(fonts.mono, `${role} ${hex.toUpperCase()}`, hx + 24, py + 23, 11, t['text-muted']));
        hx += 24 + 6.6 * 11 + 12 + (role === 'border' ? 0 : 0);
      }
      py += 48;
    }
    py += 14;
  };
  chipRows(
    'Status',
    Object.entries(tokens.semantic).map(([name, v]) => ({ label: name[0].toUpperCase() + name.slice(1), ...v[theme] })),
  );
  const levels = { high: 3, medium: 2, low: 1 };
  chipRows(
    'Confidence',
    Object.entries(tokens.confidence).map(([name, v]) => ({ label: v.label, bars: levels[name], ...v[theme] })),
  );
  const h = py - y0 + pad - 14;
  out.push(rect(x0 + 0.5, y0 + 0.5, panelW - 1, h - 1, 16, t.bg, t['border-strong'], 1));
  out.push(...body);
  return { svg: out.join(''), h };
}
const pl = panel('light', M, y);
const pd = panel('dark', M + panelW + 32, y);
parts.push(pl.svg, pd.svg);
const H = y + Math.max(pl.h, pd.h) + M;

const paletteSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${num(H)}" role="img" aria-label="Snappy">
  <!-- Snappy palette sheet: brand colors, then every light and dark theme token with its role name and hex value. Values come from tokens.json; all text is outlined. -->
  <rect width="${W}" height="${num(H)}" fill="${sheetBg}"/>
  ${parts.join('\n  ')}
</svg>
`;
write('tokens/palette.svg', paletteSvg);
write('tokens/palette.png', png(paletteSvg, W * 2));

// ---------- social preview ----------
const lockup = read('logo/snappy-lockup.svg');
const lockupInner = lockup
  .replace(/<svg[^>]*>/, '')
  .replace(/<!--[\s\S]*?-->/, '')
  .replace('</svg>', '')
  .replaceAll('currentColor', B.bone)
  .replaceAll('var(--accent, #6B4DFF)', B['violet-on-dark']);
const s = 3; // lockup scale; the ink starts at x=16 and y=12 in the lockup's own units
const inkLeft = 120;
const inkTop = 188;
const tx = inkLeft - 16 * s;
const ty = inkTop - 12 * s;
const tagline = 'Organize your Snapchat world from your own export.';
const notice = ['Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc.', 'Snapchat is a trademark of Snap Inc.'];
const social = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" role="img" aria-label="Snappy">
  <!-- Snappy social preview, 1280 by 640: the lockup, the tagline and the independence line on an ink ground. The spine bar is the one violet element. All text is outlined. -->
  <rect width="1280" height="640" fill="${B.ink}"/>
  <g transform="translate(${tx} ${ty}) scale(${s})">${lockupInner}</g>
  ${text(fonts.body, tagline, inkLeft, 470, 38, tokens.dark.text)}
  ${notice.map((line, i) => text(fonts.body, line, inkLeft, 556 + i * 30, 22, tokens.dark['text-muted'])).join(' ')}
</svg>
`;
write('social-preview.svg', social);
write('social-preview.png', png(social, 1280));
