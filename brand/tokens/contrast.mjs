// Snappy palette: WCAG 2.x contrast report.
// Reads tokens.json and checks every tracked foreground and background pair. Exits 1 if any pair fails.
// Run: node brand/tokens/contrast.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const p = JSON.parse(readFileSync(join(dir, 'tokens.json'), 'utf8'));

const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Perceptual distance (OKLab, scaled by 100) and hue angle (OKLCH degrees), used to keep the secondary orange
// clearly apart from the warning status gold.
const lin2 = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const oklab = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => lin2(parseInt(h.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const hueOf = (hex) => { const [, a, b] = oklab(hex); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };
const hueGap = (x, y) => { const d = Math.abs(hueOf(x) - hueOf(y)); return Math.min(d, 360 - d); };
const deltaE = (x, y) => { const p = oklab(x), q = oklab(y); return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const MIN_HUE_GAP = 45; // degrees between orange and the warning gold
const MIN_DELTA_E = 14; // perceptual distance between orange and the warning gold, same role
const MIN_DELTA_E_DANGER = 6; // floor for orange against danger red: it sits nearer to red, so this only guards against drift

let fails = 0;
let total = 0;
const out = [];
const check = (theme, label, fg, bg, min) => {
  const r = ratio(fg, bg);
  const ok = r >= min;
  total++;
  if (!ok) fails++;
  out.push(
    `${ok ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${label}  [${fg} on ${bg}]`
  );
};

const TEXT = 4.5; // normal text
const UI = 3; // UI components, graphics, focus indicators

for (const theme of ['light', 'dark']) {
  const t = p[theme];
  const grounds = ['bg', 'surface', 'surface-raised', 'surface-sunken'];

  // Body and muted text on every ground
  for (const g of grounds) {
    check(theme, `text on ${g}`, t.text, t[g], TEXT);
    check(theme, `text-muted on ${g}`, t['text-muted'], t[g], TEXT);
    check(theme, `link on ${g}`, t.link, t[g], TEXT);
    check(theme, `accent-fg (violet text) on ${g}`, t['accent-fg'], t[g], TEXT);
    check(theme, `focus-ring on ${g}`, t['focus-ring'], t[g], UI);
  }
  // Input and control borders (decorative "border" token is intentionally excluded)
  for (const g of ['bg', 'surface', 'surface-raised']) {
    check(theme, `border-strong on ${g}`, t['border-strong'], t[g], UI);
  }
  // Primary button: label on fill, fill against page
  check(theme, 'primary-text-on on primary', t['primary-text-on'], t.primary, TEXT);
  check(theme, 'primary-text-on on primary-hover', t['primary-text-on'], t['primary-hover'], TEXT);
  for (const g of ['bg', 'surface', 'surface-raised']) {
    check(theme, `primary fill vs ${g}`, t.primary, t[g], UI);
  }
  // Accent button and accent graphics (the spine bar in the mark)
  check(theme, 'accent-text-on on accent', t['accent-text-on'], t.accent, TEXT);
  check(theme, 'accent-text-on on accent-hover', t['accent-text-on'], t['accent-hover'], TEXT);
  for (const g of ['bg', 'surface', 'surface-raised']) {
    check(theme, `accent graphic vs ${g}`, t.accent, t[g], UI);
  }
  // Mark itself (currentColor = text) on each ground
  for (const g of grounds) {
    check(theme, `mark (text color) on ${g}`, t.text, t[g], UI);
  }

  // Semantic states: label on tint, border against tint and against page
  for (const [name, v] of Object.entries(p.semantic)) {
    const s = v[theme];
    check(theme, `semantic ${name} fg on its bg`, s.fg, s.bg, TEXT);
    check(theme, `semantic ${name} border vs its bg`, s.border, s.bg, UI);
    check(theme, `semantic ${name} border vs page bg`, s.border, t.bg, UI);
    check(theme, `semantic ${name} bg vs page bg (text still sits on own bg)`, s.fg, t.bg, TEXT);
  }
  // Confidence chips: symbol + label (fg) on tint, border contrast
  for (const [name, v] of Object.entries(p.confidence)) {
    const s = v[theme];
    check(theme, `confidence ${name} (${v.symbol}) fg on its bg`, s.fg, s.bg, TEXT);
    check(theme, `confidence ${name} border vs its bg`, s.border, s.bg, UI);
    check(theme, `confidence ${name} border vs page bg`, s.border, t.bg, UI);
  }

  // Category accents: label on its tint and on every ground; chips and glyphs against grounds.
  const grounds4 = ['bg', 'surface', 'surface-raised', 'surface-sunken'];
  for (const [name, v] of Object.entries(p.category)) {
    const c = v[theme];
    check(theme, `category ${name} fg on its bg`, c.fg, c.bg, TEXT);
    for (const g of grounds4) check(theme, `category ${name} fg on ${g}`, c.fg, t[g], TEXT);
    check(theme, `category ${name} border vs its bg`, c.border, c.bg, UI);
    check(theme, `category ${name} border vs page bg`, c.border, t.bg, UI);
    for (const g of grounds4) check(theme, `category ${name} solid vs ${g}`, c.solid, t[g], UI);
    check(theme, `category ${name} solid vs its bg`, c.solid, c.bg, UI);
    check(theme, `category ${name} solid vs tint-2`, c.solid, p.tint[theme]['2'], UI);
  }
  // Orange is a secondary color: the same four tokens as the Memories rescue category, never an accent, and
  // measurably apart from the warning status (hue and perceptual distance), so the two never read as one.
  {
    const o = p.orange[theme];
    const mem = p.category.memories[theme];
    for (const k of Object.keys(o)) {
      if (o[k].toLowerCase() !== mem[k].toLowerCase()) { console.error(`FAIL  ${theme} orange.${k} must equal category memories ${k}`); fails++; }
    }
    const w = p.semantic.warning[theme];
    for (const [role, x, y] of [['fg', o.fg, w.fg], ['border', o.border, w.border], ['solid', o.solid, w.border]]) {
      const gap = hueGap(x, y);
      const de = deltaE(x, y);
      total++;
      const ok = gap >= MIN_HUE_GAP && de >= MIN_DELTA_E;
      if (!ok) fails++;
      out.push(`${ok ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} orange ${role} vs warning: hue gap ${gap.toFixed(0)} deg (min ${MIN_HUE_GAP}), distance ${de.toFixed(1)} (min ${MIN_DELTA_E})`);
    }
    const d = p.semantic.danger[theme];
    for (const [role, x, y] of [['fg', o.fg, d.fg], ['border', o.border, d.border], ['solid', o.solid, d.border]]) {
      const de = deltaE(x, y);
      total++;
      const ok = de >= MIN_DELTA_E_DANGER;
      if (!ok) fails++;
      out.push(`${ok ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} orange ${role} vs danger: distance ${de.toFixed(1)} (min ${MIN_DELTA_E_DANGER})`);
    }
    // Orange is never the brand accent or any accent-role token.
    for (const k of ['accent', 'accent-hover', 'accent-fg', 'link', 'focus-ring', 'primary']) {
      if (hueGap(t[k], o.solid) < 20 && Math.abs(deltaE(t[k], o.solid)) < 10) { console.error(`FAIL  ${theme} ${k} is too close to orange`); fails++; }
    }
  }
  // Violet tints: ink, muted text and violet text on each wash; violet fill on the two lighter washes.
  for (const n of ['1', '2', '3']) {
    const w = p.tint[theme][n];
    check(theme, `text on tint-${n}`, t.text, w, TEXT);
    check(theme, `text-muted on tint-${n}`, t['text-muted'], w, TEXT);
    check(theme, `accent-fg on tint-${n}`, t['accent-fg'], w, TEXT);
    if (n !== '3') check(theme, `accent graphic vs tint-${n}`, t.accent, w, UI);
  }
  // Quiet notices sit on a plain surface: status text and status borders against it.
  for (const [name, v] of Object.entries(p.semantic)) {
    for (const g of ['surface', 'surface-raised', 'surface-sunken']) {
      check(theme, `semantic ${name} fg on ${g} (quiet notice)`, v[theme].fg, t[g], TEXT);
    }
    for (const g of ['surface', 'surface-raised']) {
      check(theme, `semantic ${name} border vs ${g} (quiet notice)`, v[theme].border, t[g], UI);
    }
  }
  // cat-neutral scope: muted text and strong border on the sunken ground.
  check(theme, 'text-muted on surface-sunken (neutral chip)', t['text-muted'], t['surface-sunken'], TEXT);
  check(theme, 'border-strong vs surface-sunken (neutral chip)', t['border-strong'], t['surface-sunken'], UI);
  // The cleanup category is the brand accent: it must never drift from the accent tokens.
  const cl = p.category.cleanup[theme];
  if (cl.fg.toLowerCase() !== t['accent-fg'].toLowerCase() || cl.solid.toLowerCase() !== t.accent.toLowerCase()) {
    console.error(`FAIL  ${theme} category cleanup must equal accent-fg and accent`);
    fails++;
  }
  // The violet tint 2 is also the cleanup chip fill.
  if (p.tint[theme]['2'].toLowerCase() !== cl.bg.toLowerCase()) {
    console.error(`FAIL  ${theme} tint-violet-2 must equal category cleanup bg`);
    fails++;
  }
}

// tokens.css must carry the same category and tint values as tokens.json, in all three theme blocks.
{
  const css = readFileSync(join(dir, 'tokens.css'), 'utf8');
  const blocks = {
    light: css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')),
    'dark (os)': css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf(':root[data-theme="dark"]')),
    'dark (forced)': css.slice(css.indexOf(':root[data-theme="dark"]')),
  };
  const want = (theme, name) => {
    const m = {};
    for (const [cat, v] of Object.entries(p.category)) if (cat !== 'memories') for (const [k, hex] of Object.entries(v[theme])) m[`--cat-${cat}-${k}`] = hex;
    for (const [k, hex] of Object.entries(p.orange[theme])) m[`--orange-${k}`] = hex;
    for (const [k, hex] of Object.entries(p.tint[theme])) m[`--tint-violet-${k}`] = hex;
    return m;
  };
  for (const [name, block] of Object.entries(blocks)) {
    const theme = name === 'light' ? 'light' : 'dark';
    for (const k of ['fg', 'bg', 'border', 'solid']) {
      if (!new RegExp(`--cat-memories-${k}:\\s*var\\(--orange-${k}\\)\\s*;`).test(block)) {
        console.error(`FAIL  tokens.css (${name}) --cat-memories-${k} must be var(--orange-${k})`);
        fails++;
      }
    }
    for (const [prop, hex] of Object.entries(want(theme))) {
      const m = block.match(new RegExp(`${prop}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
      if (!m || m[1].toLowerCase() !== hex.toLowerCase()) {
        console.error(`FAIL  tokens.css (${name}) ${prop} is ${m ? m[1] : 'missing'}, tokens.json says ${hex}`);
        fails++;
      }
    }
  }
}

// App icon: bone bars and violet spine on ink ground
const b = p.brand;
check('icon', 'app-icon bone bars on ink', b.bone, b.ink, UI);
check('icon', 'app-icon violet spine on ink', b['violet-on-dark'], b.ink, UI);

const header = `Snappy palette: WCAG 2.x contrast report\nThresholds: text ${TEXT}:1, UI/graphics ${UI}:1\nSource: tokens.json\n`;
const footer = `\n${total - fails}/${total} pairs pass${fails ? `, ${fails} FAIL` : ' (all pass)'}\n`;
console.log(header + out.join('\n') + footer);
process.exit(fails ? 1 : 0);
