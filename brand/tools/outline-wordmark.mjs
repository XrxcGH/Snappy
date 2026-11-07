// Regenerates the outlined wordmark files in brand/logo: snappy-lockup.svg, snappy-lockup-stacked.svg
// and snappy-wordmark.svg. The word "Snappy" is set in Bricolage Grotesque Bold (weight 700, optical
// size 48, SIL OFL 1.1), tracking -0.02em, with font kerning, and written as plain paths.
//
// Setup, in any scratch folder:
//   npm install opentype.js @fontsource-variable/bricolage-grotesque
//   Instance the variable font once (opentype.js cannot read variable fonts):
//     from fontTools.ttLib import TTFont
//     from fontTools.varLib import instancer
//     f = TTFont("node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2")
//     i = instancer.instantiateVariableFont(f, {"wght": 700, "opsz": 48})
//     i.flavor = None
//     i.save("fonts/inst-w700-opsz48.ttf")
// Run from that folder:
//   FONT=fonts/inst-w700-opsz48.ttf OUT=<path to brand/logo> node <path to this file>
// FONT defaults to fonts/inst-w700-opsz48.ttf and OUT to the brand/logo folder next to this script.
//
// Layout: font size 48; each glyph advances by its width plus font kerning plus -0.96 (-0.02em).
// Coordinates are rounded to two decimals. Horizontal lockup: mark at translate(8 8), wordmark origin
// x=88, baseline y=55. Stacked lockup: mark at translate(68 12), baseline y=140, wordmark centered on
// x=100. Wordmark alone: viewBox equals the ink box.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.cwd(), 'noop.js'));
const opentype = require('opentype.js');

const here = dirname(fileURLToPath(import.meta.url));
const FONT = process.env.FONT || 'fonts/inst-w700-opsz48.ttf';
const OUT = resolve(process.env.OUT || join(here, '..', 'logo'));
const SIZE = 48;
const TRACK = -0.02 * SIZE;
const sc = SIZE / 1000;

const buf = readFileSync(FONT);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const num = (v) => String(Math.round(v * 100) / 100 || 0);

// Two-decimal path data; drops zero-length L segments.
function toD(cmds) {
  let out = '';
  let cx;
  let cy;
  for (const c of cmds) {
    const keys = { M: ['x', 'y'], L: ['x', 'y'], Q: ['x1', 'y1', 'x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] }[c.type];
    const v = keys.map((k) => num(c[k]));
    if (c.type === 'L' && v[0] === cx && v[1] === cy) continue;
    if (c.type !== 'Z') {
      cx = v.at(-2);
      cy = v.at(-1);
    }
    out += c.type + v.join(' ');
  }
  return out;
}

function layout(x0, y0) {
  const glyphs = [...'Snappy'].map((ch) => font.charToGlyph(ch));
  const cmds = [];
  let x = x0;
  glyphs.forEach((g, i) => {
    cmds.push(...g.getPath(x, y0, SIZE).commands);
    const kern = i < glyphs.length - 1 ? font.getKerningValue(g, glyphs[i + 1]) : 0;
    x += (g.advanceWidth + kern) * sc + TRACK;
  });
  const p = new opentype.Path();
  p.commands = cmds;
  return { d: toD(cmds), bbox: p.getBoundingBox() };
}

const mark = (t) => `  <g transform="translate(${t})">
    <rect x="12" y="4" width="44" height="8" rx="4" fill="currentColor"/>
    <rect x="8" y="16" width="20" height="8" rx="4" fill="currentColor"/>
    <rect x="12" y="28" width="40" height="8" rx="4" fill="var(--accent, #6B4DFF)"/>
    <rect x="36" y="40" width="20" height="8" rx="4" fill="currentColor"/>
    <rect x="8" y="52" width="44" height="8" rx="4" fill="currentColor"/>
  </g>
`;
const note = (text) => `  <!-- ${text} -->\n`;
const svg = (viewBox, comment, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" role="img" aria-label="Snappy">\n${comment}${body}</svg>\n`;
const path = (d) => `  <path fill="currentColor" d="${d}"/>\n`;

mkdirSync(OUT, { recursive: true });

writeFileSync(
  join(OUT, 'snappy-lockup.svg'),
  svg(
    '0 0 280 80',
    note('Snappy horizontal lockup: the mark and the outlined wordmark. Use it in headers, README banners, docs and slides. Bars use currentColor and the spine uses the CSS variable named accent, with violet as the fallback.'),
    mark('8 8') + path(layout(88, 55).d),
  ),
);

const s0 = layout(0, 140).bbox;
const xs = 100 - (s0.x1 + s0.x2) / 2;
writeFileSync(
  join(OUT, 'snappy-lockup-stacked.svg'),
  svg(
    '0 0 200 200',
    note('Snappy stacked lockup: the mark above the outlined wordmark, centered. Use it in square or narrow spaces such as splash screens and covers.'),
    mark('68 12') + path(layout(xs, 140).d),
  ),
);

const t = layout(0, 0).bbox;
const floor2 = (v) => Math.floor(v * 100) / 100;
const ceil2 = (v) => Math.ceil(v * 100) / 100;
const x1 = floor2(t.x1);
const y1 = floor2(t.y1);
writeFileSync(
  join(OUT, 'snappy-wordmark.svg'),
  svg(
    `0 0 ${num(ceil2(t.x2) - x1)} ${num(ceil2(t.y2) - y1)}`,
    note('Snappy wordmark alone, outlined. Tight viewBox with no padding, so add clear space in the layout. Use it next to a mark that is already on the page.'),
    path(layout(-x1, -y1).d),
  ),
);
