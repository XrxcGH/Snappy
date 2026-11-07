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
}

// App icon: bone bars and violet spine on ink ground
const b = p.brand;
check('icon', 'app-icon bone bars on ink', b.bone, b.ink, UI);
check('icon', 'app-icon violet spine on ink', b['violet-on-dark'], b.ink, UI);

const header = `Snappy palette: WCAG 2.x contrast report\nThresholds: text ${TEXT}:1, UI/graphics ${UI}:1\nSource: tokens.json\n`;
const footer = `\n${total - fails}/${total} pairs pass${fails ? `, ${fails} FAIL` : ' (all pass)'}\n`;
console.log(header + out.join('\n') + footer);
process.exit(fails ? 1 : 0);
