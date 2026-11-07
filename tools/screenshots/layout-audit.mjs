/**
 * Layout audit for the built dashboard. It MEASURES the real rendered page (getBoundingClientRect,
 * computed styles, text ranges) instead of guessing, for every route, in light and dark, at widths
 * 320, 360, 390, 768, 1024 and 1280, and then the wide pass at 1440, 1600, 1920 and 2560 (1280 and up is the wide layout), and prints every violation. Exit code 1 if there is any.
 *
 * Everything is made from Snappy's built-in SYNTHETIC sample data ("Use sample data"). The page
 * is served on 127.0.0.1 only and the browser refuses any other network request.
 *
 *   npm run build:dashboard
 *   PLAYWRIGHT_DIR=<folder with playwright installed> node tools/screenshots/layout-audit.mjs [options]
 *
 * Options
 *   --out FILE        also write the report to FILE
 *   --port N          local port for the static server (default 4339)
 *   --routes a,b      only these routes (default: all, including the Tools hub and each tool, written tools/<id>)
 *   --widths a,b      only these widths (default 320,360,390,768,1024,1280,1440,1600,1920,2560; 3440 for an ultra-wide window)
 *   --themes light    only this theme (default light,dark)
 *   --no-fresh        skip the "no export yet" pass (empty states)
 *   --quiet           print only the summary
 *   --build           rebuild the dashboard first (node apps/dashboard/build.mjs), so a stale copy is never audited
 *
 * What is measured (each violation names route, theme, width, the element and the numbers):
 *   menu-one-line          every menu item is one line, also in the opened phone menu
 *   title-vs-menu          the page title (h1) says the same as the active menu label
 *   icon-text-center       icon and text vertical centers differ by more than 1 px (buttons, chips,
 *                          menu items, notices, headings, summaries)
 *   icon-alone             an icon on a row with no text (except illustrations and icon-only buttons)
 *   clipped / page-wider / offscreen / clipped-by-ancestor   text or controls cut off or wider than the viewport
 *   touch-target           interactive controls under 44 px on touch widths (under 36 px with a mouse)
 *   select-arrow           select boxes: own arrow, 12 px or more from the right edge, text never under it
 *   select-visible         a select is cut off or shorter than 44 px on touch
 *   padding-like           like elements with different padding
 *   height-like            single-line buttons, inputs or menu items with different heights
 *   block-edges            sibling blocks in one column whose right (or left) edges differ by more than 2 px
 *   measure-too-wide       running text wider than about 80 characters per line
 *   unused-space           more than 25 percent of the content area unused beside the widest block
 *   button-stretch         a button wider than 2.5 times its content on widths of 768 and up
 *   gap-too-large          vertical gap between sibling blocks above 3 rem
 *   gap-off-scale          vertical gap not on the 4 px spacing scale
 *   gap-inconsistent       one kind of gap (heading, section, card) with more than one value on a page or between routes
 *   gutter                 uneven left and right gutters on phones, header gutters not matching the content
 *   orphan-word            the last line of a short text is one word
 *   text-contrast          text below 4.5:1 (3:1 for large text), measured against the composited background
 *   notice-contrast        notice body text below 7:1, or not in the normal text color
 *   notice-label           a notice starts with a visible "Note." or "Warning." label
 *   notice-count           more than two notices above the fold
 *   banner-slim            the sample-data strip is not a slim single row
 *   stat-grid              (see tile-rows)
 *   stat-repeat            the same number shown twice (two cards, or a card and a sentence)
 *   meter                  progress and strength meters need a name and a visible label and value
 *   form-row               input and button on one row: same height and center; button not stretched
 *   field-width            text inputs with different widths (one form-field width)
 *   segmented              radio choices stacked vertically, native radios shown, weak selected state
 *   table-*                table header weight, first-column wrapping, cell padding
 *   code-copy              a command's Copy and Run buttons sit together in the header row above its code, Copy first, content-sized,
 *                          inside the frame; the code scrolls sideways and never runs under them
 *   terminal-panel         the open terminal panel (Run pressed on the Export guide's help command): fits the page, panel buttons at touch size,
 *                          output at 4.5:1 on its ground, one exit chip with icon and words on one line, focus back on Run
 *   terminal-csp           while a command ran: a request other than data: or blob:, a security policy violation, or a console error
 *   tool-nav               a tool page (tools/<id>) keeps Tools marked in the menu, and the menu lists no tool
 *   nav-active             the active menu item has a clear state (3:1) and is bold
 *   nav-icon               menu icons that repeat another meaning (overview, privacy, guide)
 *   header-*               one tidy row, vertical centers, theme toggle (name, 44 px, focus ring, pressed state)
 *   tile-rows              tiles in one row: same height, one shared line for icon, title, number, description and action,
 *                          and the row fills the grid (no hole)
 *   tile-title-lines       tile titles in a row take the same number of lines, and one line at desktop widths
 *   tile-center            icon, title, number, description and action centered in their tile
 *   confirm-dialog         the delete confirmation: says what cannot be undone, exact action button, Cancel, focus on Cancel,
 *                          touch size, shares the column's edges
 *   theme-boot             a returning visitor's saved theme shows from the first frame; the policy blocks nothing
 *   dark-default           a first visit shows dark with no flash, whatever the operating system says
 *   duplicate-sentence     a sentence of more than 8 words appears twice on one rendered page
 *   duplicate-note         two notes repeat the same information
 *   legal-line             the independence line appears other than exactly once per page
 *   stale-name             "snappy" used as a command instead of snappy-export; a stale built page
 *   type-scale / color-count   too many text sizes or colors on one screen (reported as info)
 *   orange-scope           an orange color outside the Memories rescue area (orange is a secondary color: that area and
 *                          small illustration highlights only), or orange too close to the warning gold
 *   numerals               numeral style not decided for stat values (reported as info)
 *   wide-shell             (1280 and up) the shell is centered with left and right margins within 2 px of each other, never wider than 100 rem,
 *                          and the content area is the wide width (60 rem, 77 rem from 1600)
 *   wide-sidebar           the sidebar sits beside the content, never over it, and stays sticky
 *   wide-measure           running text, notices and fields wider than the 36 rem measure (plus 2 px)
 *   wide-columns           cards that are siblings in one grid with different widths where their spans are alike
 *   wide-orphan            a grid of cards whose last row holds one lone card that does not span the row
 *   wide-empty-card        a card (a people card too, unless it takes a whole row) whose right third is empty
 *   wide-steps             the Start page's three step cards: numbers, titles and bodies start at one top each, no dead gap under a title
 *                          (wide-columns also covers the Tools hub: one tile width across all its groups; and Export health: its notes
 *                          and its two parts side by side; wide-orphan also covers a lone last note)
 *
 * Playwright is not a dependency of this repository (see tools/mobile/ios-webkit.mjs).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// "tools/<id>" is a tool's page: it has its own title, and the menu keeps Tools marked.
// The hub and then every tool, in the hub's order. apps/dashboard/test/tools/contract.test.ts keeps the tool folders and the registry equal.
const TOOL_ROUTES = [
  "export-check", "export-reminder", "since-last-export", "year-in-review",
  "friends-backup", "friends-table", "friend-count-history", "closest-fading", "anniversaries", "blocked-review", "lookalike-usernames",
  "waiting-on-reply", "reply-speed", "reach-out-first", "habits", "activity-calendar",
  "storage-planner", "memories-on-this-day", "memories-gaps", "rescue-manifest",
  "safety-checklist", "privacy-tuneup",
].map((id) => `tools/${id}`);
const ALL_ROUTES = ["start", "overview", "disappeared", "requests", "quiet", "cleanup", "memories", "tools", ...TOOL_ROUTES, "guide", "privacy", "settings"];
const ALL_WIDTHS = [320, 360, 390, 768, 1024, 1280, 1440, 1600, 1920, 2560];
/** From this width the wide layout applies (--bp-wide, 80rem); the checks named wide-* run here and above. */
const WIDE_MIN = 1280;
const THEMES = ["light", "dark"];
/** Widths at and below this one are measured in a touch context (a phone). */
const TOUCH_MAX = 430;
/** Content, color and wording checks do not change with width, so they run at two widths only. */
const CONTENT_WIDTHS = new Set([390, 1280]);
/** Findings of these kinds are reported but do not fail the run. */
const INFO_CHECKS = new Set(["type-scale", "color-count", "numerals", "layout-summary"]);

function parseArgs(argv) {
  const out = { out: undefined, port: 4339, routes: ALL_ROUTES, widths: ALL_WIDTHS, themes: THEMES, fresh: true, quiet: false, build: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out.out = path.resolve(argv[++i]);
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--routes") out.routes = argv[++i].split(",");
    else if (a === "--widths") out.widths = argv[++i].split(",").map(Number);
    else if (a === "--themes") out.themes = argv[++i].split(",");
    else if (a === "--no-fresh") out.fresh = false;
    else if (a === "--quiet") out.quiet = true;
    else if (a === "--build") out.build = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return out;
}

function loadPlaywright() {
  for (const dir of [process.env.PLAYWRIGHT_DIR, root].filter(Boolean)) {
    try { return createRequire(path.join(path.resolve(dir), "noop.js"))("playwright"); } catch { /* next */ }
  }
  throw new Error("Playwright was not found. Set PLAYWRIGHT_DIR. See the install steps in tools/mobile/ios-webkit.mjs.");
}

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

/* ------------------------------------------------------------------------------------------ */
/* The measuring code. It runs inside the page, so it cannot use anything from this file.      */
/* ------------------------------------------------------------------------------------------ */
function measurePage(opts) {
  const { width, touch, route, fresh, contentChecks } = opts;
  const found = [];
  const facts = { gaps: {}, fieldWidths: [], header: null, gutters: null, unused: null, h1Text: "", fonts: {} };

  /* ---- helpers ---- */
  const R = (el) => el.getBoundingClientRect();
  const cs = (el, pseudo) => getComputedStyle(el, pseudo);
  const rootPx = parseFloat(cs(document.documentElement).fontSize) || 16;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const main = document.querySelector("main") || document.body;
  /** From 1280 the wide layout applies (80rem, --bp-wide). */
  const WIDE = width >= 1280;

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const textOf = (el) => norm(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").slice(0, 44);
  const selOf = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = [...el.classList].filter((c) => !/^cat-/.test(c)).slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    if (el.tagName === "INPUT" || el.tagName === "BUTTON") s += "[type=" + (el.getAttribute("type") || "text") + "]";
    if (el.tagName === "A" && el.getAttribute("href")) s += '[href="' + el.getAttribute("href") + '"]';
    const sectionHeading = el.closest("section, .section, .step-card, .card, details");
    if (sectionHeading && sectionHeading !== el) {
      const h = sectionHeading.querySelector("h2, h3, summary");
      if (h && h !== el) s = "(" + norm(h.textContent).slice(0, 22) + ") " + s;
    }
    return s;
  };
  // Repeated rows (one per person) would flood the report: keep two of a kind per state and count the rest.
  const kindCount = new Map();
  const add = (check, el, detail) => {
    const sel = el ? selOf(el) : "";
    const key = check + "|" + sel.replace(/\[href=.*?\]/, "") + "|" + detail.replace(/[\d.]+/g, "#").replace(/\[[^\]]*\]/g, "").slice(0, 80);
    const n = (kindCount.get(key) || 0) + 1;
    kindCount.set(key, n);
    if (n <= 2) found.push({ check, sel, text: el ? textOf(el) : "", detail });
    else if (n === 3) found.push({ check, sel, text: "", detail: "(more elements of the same kind have this problem on this page)" });
  };
  const px = (n) => (Math.round(n * 10) / 10) + "px";

  const hiddenByDetails = (el) => {
    const d = (el.tagName === "DETAILS" ? el.parentElement : el).closest("details");
    return !!(d && !d.open && !el.closest("summary"));
  };
  const visCache = new Map();
  const ownVisible = (el) => {
    const r = R(el);
    const s = cs(el);
    if (s.display === "contents") return true;
    if (r.width <= 1.5 || r.height <= 1.5) {
      // a thin box is hidden when it is clipped (a screen-reader-only style), a divider or bar otherwise
      if (s.overflow !== "visible" || (s.clipPath && s.clipPath !== "none") || (s.clip && s.clip !== "auto")) return false;
      if (r.width <= 1.5 && r.height <= 1.5) return false;
    }
    if (r.right <= 0) return false;
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
    return true;
  };
  const vis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (visCache.has(el)) return visCache.get(el);
    let ok = ownVisible(el) && !hiddenByDetails(el);
    if (ok && el.parentElement && el.parentElement !== document.documentElement && el.parentElement !== document.body) ok = vis(el.parentElement) || cs(el.parentElement).display === "contents" && vis(el.parentElement.parentElement);
    visCache.set(el, ok);
    return ok;
  };
  const isIllustration = (svg) => {
    const href = (svg.querySelector("use") && (svg.querySelector("use").getAttribute("href") || svg.querySelector("use").getAttribute("xlink:href"))) || "";
    return /^#g-/.test(href) || /spot|illustr|logo/.test(svg.getAttribute("class") || "") || !!svg.closest(".spot, [class*=spot], [class*=illustr], .brand, [class*=logo]");
  };
  const isSrOnly = (el) => !!el.closest(".sr-only, [class*=sr-only], .offscreen, .skip-link, .sprite");

  const walkerFor = (el) => document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim() && n.parentElement && !n.parentElement.closest("svg, script, style, noscript, .sr-only, .sprite") ? 1 : 2),
  });
  const textNodes = (el) => { const out = []; const w = walkerFor(el); for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n); return out; };

  function lineRects(el) {
    const rects = [];
    for (const n of textNodes(el)) {
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width > 0.5 && q.height > 0.5) rects.push(q);
    }
    rects.sort((a, b) => a.top - b.top || a.left - b.left);
    const lines = [];
    for (const q of rects) {
      const L = lines[lines.length - 1];
      const cy = (q.top + q.bottom) / 2;
      if (L && Math.abs(cy - L.cy) < Math.min(q.height, L.h) / 2) {
        L.left = Math.min(L.left, q.left); L.right = Math.max(L.right, q.right);
        L.top = Math.min(L.top, q.top); L.bottom = Math.max(L.bottom, q.bottom);
        L.cy = (L.top + L.bottom) / 2; L.h = L.bottom - L.top;
      } else lines.push({ top: q.top, bottom: q.bottom, left: q.left, right: q.right, cy, h: q.height });
    }
    return lines;
  }
  function wordLines(el) {
    const words = [];
    for (const n of textNodes(el)) {
      const re = /\S+/g;
      const text = n.nodeValue;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const r = document.createRange();
        r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const q = r.getBoundingClientRect();
        if (q.width > 0.5) words.push({ cy: (q.top + q.bottom) / 2, h: q.height, w: m[0] });
      }
    }
    const lines = [];
    for (const w of words) {
      const L = lines[lines.length - 1];
      if (L && Math.abs(w.cy - L.cy) < Math.min(w.h, L.h) / 2) L.words.push(w.w);
      else lines.push({ cy: w.cy, h: w.h, words: [w.w] });
    }
    return lines;
  }

  /* colors */
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx2 = canvas.getContext("2d", { willReadFrequently: true });
  const colorCache = new Map();
  const toRGBA = (str) => {
    if (colorCache.has(str)) return colorCache.get(str);
    ctx2.clearRect(0, 0, 1, 1);
    ctx2.fillStyle = "#000";
    ctx2.fillStyle = str;
    ctx2.fillRect(0, 0, 1, 1);
    const d = ctx2.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    // un-premultiply
    const c = a > 0 ? [Math.round(d[0] / a), Math.round(d[1] / a), Math.round(d[2] / a), a] : [0, 0, 0, 0];
    colorCache.set(str, c);
    return c;
  };
  const blend = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat([1]);
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  /** Background an element sits on, composited through its ancestors. null when a gradient or image is involved. */
  function bgOf(el) {
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.push(e);
    let base = [255, 255, 255, 1];
    let started = false;
    for (const e of chain.reverse()) {
      const s = cs(e);
      if (s.backgroundImage && s.backgroundImage !== "none" && !/^url\(/.test(s.backgroundImage)) return null;
      const c = toRGBA(s.backgroundColor);
      if (c[3] > 0) { base = started || c[3] < 1 ? blend(c, base) : c; started = true; }
    }
    return base;
  }
  function textColorOf(el, bg) {
    const s = cs(el);
    let c = toRGBA(s.color);
    let op = 1;
    for (let e = el; e; e = e.parentElement) op *= parseFloat(cs(e).opacity);
    if (c[3] * op < 1) c = blend([c[0], c[1], c[2], c[3] * op], bg);
    return c;
  }
  const rgbStr = (c) => "rgb(" + c.slice(0, 3).map(Math.round).join(",") + ")";

  /* the content blocks and stacks */
  const BLOCK_DISPLAY = /^(block|flex|grid|list-item|table|flow-root)$/;
  const flowChild = (c) => {
    if (!vis(c)) return false;
    const s = cs(c);
    if (!BLOCK_DISPLAY.test(s.display)) return false;
    if (s.position === "absolute" || s.position === "fixed" || s.float !== "none") return false;
    return true;
  };
  const stackKids = (el) => [...el.children].filter(flowChild).sort((a, b) => R(a).top - R(b).top);
  const isStack = (kids) => kids.every((k, i) => i === 0 || R(k).top >= R(kids[i - 1]).bottom - 1);
  const BLOCK_SEL = "p, ul, ol, dl, table, pre, form, details, section, header, h1, h2, h3, h4, fieldset, .notice, .notice-group, .card, .step-card, .stats, .cards, .table-wrap, .code-wrap, .code, .banner, .empty, .actions, [role=note], [class*=meter], .view";
  const HEADING_SEL = "h1, h2, h3, h4";
  /** Running text and the blocks that hold it: they keep the measure on a wide screen. */
  const TEXT_BLOCK = "p, ul:not(.card):not(.hbars):not(.review-list):not(.rows):not(.mark-list), ol:not(.step-list), .notice, .tool-reads, .caption, .summary, [role=note]";
  const chrome = (el) => {
    const s = cs(el);
    const bg = toRGBA(s.backgroundColor);
    const border = ["Top", "Right", "Bottom", "Left"].some((k) => parseFloat(s["border" + k + "Width"]) > 0 && toRGBA(s["border" + k + "Color"])[3] > 0);
    return bg[3] > 0.05 || border || (s.boxShadow && s.boxShadow !== "none");
  };
  const extCache = new Map();
  function extent(el) {
    if (extCache.has(el)) return extCache.get(el);
    let res = null;
    const r = R(el);
    const leafish = ![...el.children].some((c) => flowChild(c));
    if (chrome(el) || leafish) res = { top: r.top, bottom: r.bottom };
    else {
      for (const c of el.children) {
        if (!vis(c)) continue;
        const cs2 = cs(c);
        if (cs2.position === "absolute" || cs2.position === "fixed") continue;
        const e = extent(c);
        if (e) res = res ? { top: Math.min(res.top, e.top), bottom: Math.max(res.bottom, e.bottom) } : e;
      }
      if (!res) res = { top: r.top, bottom: r.bottom };
    }
    extCache.set(el, res);
    return res;
  }
  const stripCat = (el) => [...el.classList].filter((c) => !/^cat-|^is-|^slide-in$|^active$/.test(c)).sort().join(".");

  /* ---- 1. menu items ---- */
  const nav = document.querySelector("#site-nav, nav");
  const navLinks = nav ? [...nav.querySelectorAll("a[href^='#/']")].filter(vis) : [];
  const navNeedsOpen = navLinks.length === 0 && nav;
  for (const a of navLinks) {
    const lines = lineRects(a);
    const lh = parseFloat(cs(a).lineHeight) || R(a).height;
    if (lines.length > 1) add("menu-one-line", a, "wraps onto " + lines.length + " lines at " + width + "px (line " + px(lh) + ", item " + px(R(a).height) + " tall)");
    if (a.scrollWidth > a.clientWidth + 1) add("clipped", a, "menu item scrollWidth " + a.scrollWidth + " > clientWidth " + a.clientWidth);
  }
  if (navLinks.length) {
    const hs = navLinks.filter((a) => lineRects(a).length === 1).map((a) => R(a).height);
    if (hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 1) add("height-like", navLinks[0], "single-line menu items differ in height: " + px(Math.min(...hs)) + " to " + px(Math.max(...hs)));
    const cur = navLinks.find((a) => a.getAttribute("aria-current") === "page");
    const h1 = document.querySelector("h1");
    facts.h1Text = h1 ? norm(h1.textContent) : "";
    if (cur && h1 && route !== "start" && !route.includes("/")) {
      const label = norm(cur.textContent);
      if (label !== norm(h1.textContent)) add("title-vs-menu", h1, 'page title "' + norm(h1.textContent) + '" differs from menu label "' + label + '"');
    }
    // A tool's page keeps the one Tools item marked, and the menu never lists a tool.
    if (route.startsWith("tools/")) {
      if (!cur || norm(cur.textContent) !== "Tools") add("tool-nav", cur || document.body, 'a tool page should keep "Tools" marked in the menu, not "' + (cur ? norm(cur.textContent) : "nothing") + '"');
      if (navLinks.some((a) => (a.getAttribute("href") || "").startsWith("#/tools/"))) add("tool-nav", navLinks[0], "the menu lists a tool: only the Tools item belongs there");
    }
    // active item state
    if (cur) {
      const others = navLinks.filter((a) => a !== cur);
      const nb = nav ? bgOf(nav) : null;
      const sc = cs(cur);
      const so = others.length ? cs(others[0]) : null;
      const bold = parseInt(sc.fontWeight, 10);
      if (so && !(bold >= 600 && bold > parseInt(so.fontWeight, 10))) add("nav-active", cur, "active item is not bolder than the others (weight " + sc.fontWeight + " vs " + so.fontWeight + ")");
      let best = 0;
      let how = "none";
      const navBg = nb || [255, 255, 255, 1];
      const own = bgOf(cur);
      if (own && nb) { const r1 = ratio(own, navBg); if (r1 > best) { best = r1; how = "tint"; } }
      for (const pseudo of ["::before", "::after"]) {
        const ps = cs(cur, pseudo);
        if (ps.content !== "none" && parseFloat(ps.width) >= 2 && parseFloat(ps.height) >= 8) {
          const c = toRGBA(ps.backgroundColor);
          if (c[3] > 0.5) { const r2 = ratio(blend(c, own || navBg), own || navBg); if (r2 > best) { best = r2; how = "bar " + pseudo; } }
        }
      }
      if (best < 3) add("nav-active", cur, "active item state is only " + (Math.round(best * 100) / 100) + ":1 against its surroundings (best signal: " + how + "), needs 3:1");
    }
    // icon meanings
    if (!opts.navIconDone) {
      const symbolMarkup = (id) => { const s = document.getElementById(id); return s ? s.innerHTML.replace(/\s+/g, "") : null; };
      const iconOf = (href) => { const a = navLinks.find((x) => x.getAttribute("href") === href); const u = a && a.querySelector("svg use"); return u ? (u.getAttribute("href") || "").slice(1) : null; };
      const rules = [["#/overview", ["i-search", "i-list"], "a grid or home glyph, not a magnifier"], ["#/privacy", ["i-file", "i-file-zip", "i-list", "i-storage"], "a lock or seal glyph, not a document"], ["#/guide", ["i-file-zip", "i-storage", "i-file"], "a book or help glyph, not an archive box"]];
      for (const [href, banned, want] of rules) {
        const id = iconOf(href);
        const a = navLinks.find((x) => x.getAttribute("href") === href);
        if (!id || !a) continue;
        const mk = symbolMarkup(id);
        for (const b of banned) if (mk && mk === symbolMarkup(b)) add("nav-icon", a, "menu icon " + id + " draws the same glyph as " + b + "; use " + want);
      }
    }
  }

  /* ---- 2. icon and text centers; icons alone on a row ---- */
  const ICON_CONTAINERS = "button, a.btn, .btn, [role=button], .chip, .badge, .pill, .cat-tag, .status-pill, .nav-link, .notice, .banner, summary, h1, h2, h3, .section-title, .page-title-row, .stat-label, .card-title, .finding-head, label, [class*=title-row], [class*=-pill], [class*=chip]:not(.chip-icon)";
  const seen = new Set();
  for (const svg of main.ownerDocument.querySelectorAll("svg")) {
    if (!vis(svg) || isSrOnly(svg) || isIllustration(svg) || seen.has(svg)) continue;
    seen.add(svg);
    const container = svg.closest(ICON_CONTAINERS);
    if (!container || !vis(container)) continue;
    if (svg.closest(".tile")) continue; // an icon tile sits above its words, centered: measured by the tile checks
    const tileEl = svg.closest(".chip-icon, [class*=chip-icon]");
    const box = R(tileEl && container.contains(tileEl) ? tileEl : svg);
    // text that belongs to this container, not to a nested container of its own
    const lines = lineRects(container);
    if (lines.length === 0) continue;
    const icy = (box.top + box.bottom) / 2;
    const near = lines.reduce((b, L) => (Math.abs(L.cy - icy) < Math.abs(b.cy - icy) ? L : b), lines[0]);
    const blockCy = (lines[0].top + lines[lines.length - 1].bottom) / 2;
    const off = Math.min(Math.abs(near.cy - icy), Math.abs(blockCy - icy));
    if (off > 1.01) add("icon-text-center", container, "icon center " + px(icy) + " vs text center " + px(near.cy) + (lines.length > 1 ? " (block " + px(blockCy) + ")" : "") + ", offset " + px(off));
  }
  {
    const textRects = [];
    for (const n of textNodes(document.body)) {
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width > 0.5 && q.height > 0.5) textRects.push(q);
    }
    for (const svg of document.querySelectorAll("svg")) {
      if (!vis(svg) || isSrOnly(svg) || isIllustration(svg)) continue;
      if (svg.closest("button, a, summary, [role=button]")) continue; // a control: the button or link itself is checked below
      if (svg.closest(".tile")) continue; // tile icons sit above their words, centered: measured by the tile checks
      if (svg.parentElement && svg.parentElement.querySelector(":scope > select")) continue; // the chevron of a select belongs to the select
      // Deliberate illustrations: the empty-state and drop-zone art sit above their words on purpose.
      if (svg.closest(".empty, .dropzone, [class*=spot], [class*=illustration]")) continue;
      const tile = svg.closest(".chip-icon, [class*=chip-icon]");
      const b = R(tile || svg);
      const cy = (b.top + b.bottom) / 2;
      const sameRow = textRects.some((q) => Math.min(q.bottom, b.bottom) - Math.max(q.top, b.top) > Math.min(q.height, b.height) * 0.4 && Math.min(Math.abs(q.left - b.right), Math.abs(b.left - q.right)) < 500);
      if (!sameRow) add("icon-alone", tile || svg, "icon at y " + px(cy) + " (" + px(b.width) + " wide) has no text on its row");
    }
    for (const c of document.querySelectorAll("button, a.btn, .btn, [role=button]")) {
      if (!vis(c) || isSrOnly(c)) continue;
      if (lineRects(c).length === 0 && !(c.getAttribute("aria-label") || c.getAttribute("title"))) add("icon-alone", c, "icon-only control without an accessible name");
    }
  }

  /* ---- 3. clipping, overflow, off-screen ---- */
  if (document.documentElement.scrollWidth > vw + 1) add("page-wider", document.documentElement, "page scrollWidth " + document.documentElement.scrollWidth + " > viewport " + vw);
  const scrollers = new Set();
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("svg") || isSrOnly(el) || !vis(el)) continue;
    const s = cs(el);
    const ox = s.overflowX;
    if (ox === "auto" || ox === "scroll") scrollers.add(el);
    const r = R(el);
    if (s.display !== "inline" && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && ox !== "auto" && ox !== "scroll") {
      const input = el.tagName === "INPUT" || el.tagName === "SELECT";
      add("clipped", el, (input ? "control text" : "content") + " scrollWidth " + el.scrollWidth + " > clientWidth " + el.clientWidth + " (overflow-x " + ox + ")");
    }
    const inScroller = [...scrollers].some((sc) => sc !== el && sc.contains(el));
    if (!inScroller && (r.right > vw + 1.5 || r.left < -1.5) && s.position !== "fixed") add("offscreen", el, "box " + px(r.left) + " to " + px(r.right) + " is outside the " + vw + "px viewport");
    // clipped by an ancestor with overflow hidden (interactive and text leaves only)
    if (el.matches("a[href], button, input, select, textarea, summary, p, li, h1, h2, h3, dd, dt, label")) {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = cs(a);
        // an element with display: contents has no box, so its overflow clips nothing
        if (as.display === "contents") continue;
        if (as.overflowX !== "visible" || as.overflowY !== "visible") {
          const ar = R(a);
          const scroll = as.overflowX === "auto" || as.overflowX === "scroll";
          if (!scroll && (r.right > ar.right + 1.5 || r.left < ar.left - 1.5 || r.bottom > ar.bottom + 1.5 || r.top < ar.top - 1.5) && as.overflowY !== "auto" && as.overflowY !== "scroll") {
            add("clipped-by-ancestor", el, "box " + px(r.left) + "," + px(r.top) + " to " + px(r.right) + "," + px(r.bottom) + " leaves " + selOf(a) + " (" + px(ar.left) + "," + px(ar.top) + " to " + px(ar.right) + "," + px(ar.bottom) + ")");
            break;
          }
        }
      }
    }
  }

  /* ---- 4. touch targets ---- */
  const INTERACTIVE = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [role=radio], [role=checkbox]";
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!vis(el) && !(el.matches("input[type=radio], input[type=checkbox]") && el.labels && el.labels[0] && vis(el.labels[0]))) continue;
    if (isSrOnly(el)) continue;
    const s = cs(el);
    if (el.tagName === "A" && s.display === "inline" && el.closest("p, li, dd, td, span.caption, .caption, label")) continue; // a link inside a sentence
    let target = el;
    if (el.matches("input[type=radio], input[type=checkbox]") && el.labels && el.labels[0]) target = el.labels[0];
    const r = R(target);
    const need = touch ? 44 : 36;
    if (Math.min(r.width, r.height) < need - 0.5 && !(el.matches("input[type=radio], input[type=checkbox]") && !touch)) {
      add("touch-target", el, "target is " + px(r.width) + " by " + px(r.height) + ", needs " + need + " px" + (touch ? " on touch" : " with a mouse"));
    }
  }

  /* ---- 5. select boxes ---- */
  for (const sel of document.querySelectorAll("select")) {
    if (!vis(sel)) continue;
    const s = cs(sel);
    const r = R(sel);
    if (touch && r.height < 43.5) add("select-visible", sel, "select is " + px(r.height) + " tall, needs 44 px");
    if (r.right > vw + 1 || r.left < -1) add("select-visible", sel, "select box " + px(r.left) + " to " + px(r.right) + " is outside the viewport");
    const docH = document.documentElement.scrollHeight;
    if (r.bottom > docH + 1) add("select-visible", sel, "select bottom " + px(r.bottom) + " is below the page end " + docH);
    const padR = parseFloat(s.paddingRight);
    const bw = parseFloat(s.borderRightWidth) || 0;
    const appearance = s.appearance || s.webkitAppearance;
    let inset = null;
    let arrowW = null;
    let how = "";
    // an arrow drawn as a sibling svg inside a wrapper
    const wrap = sel.parentElement;
    const sibling = wrap && [...wrap.querySelectorAll("svg")].find((v) => vis(v) && !sel.contains(v));
    if (sibling && cs(wrap).position !== "static") {
      const sr = R(sibling);
      inset = r.right - sr.right;
      arrowW = sr.width;
      how = "sibling svg";
    } else if (s.backgroundImage && s.backgroundImage !== "none" && appearance === "none") {
      const sizeX = parseFloat((s.backgroundSize || "").split(" ")[0]);
      arrowW = Number.isFinite(sizeX) ? sizeX : 16;
      const pos = (s.backgroundPositionX || "").trim();
      const W = r.width - bw * 2;
      let m;
      if ((m = /^calc\(100% - ([\d.]+)px\)$/.exec(pos))) inset = parseFloat(m[1]) + bw;
      else if ((m = /^right ([\d.]+)px$/.exec(pos))) inset = parseFloat(m[1]) + bw;
      else if (/^100%$/.test(pos) || pos === "right") inset = bw;
      else if ((m = /^([\d.]+)%$/.exec(pos))) inset = (W - arrowW) * (1 - parseFloat(m[1]) / 100) + bw;
      else if ((m = /^([\d.]+)px$/.exec(pos))) inset = W - arrowW - parseFloat(m[1]) + bw;
      how = "background image at " + pos;
    }
    if (inset === null) add("select-arrow", sel, "native arrow (appearance " + appearance + "): its distance from the right edge cannot be guaranteed; draw a chevron at 12 px or more");
    else {
      if (inset < 12 - 0.5) add("select-arrow", sel, "arrow is " + px(inset) + " from the right edge (" + how + "), needs 12 px or more");
      const need = inset + (arrowW || 16);
      if (padR + bw < need - 0.5) add("select-arrow", sel, "text can run under the arrow: padding-right " + px(padR) + " (+ border " + px(bw) + ") < arrow zone " + px(need));
    }
  }

  /* ---- 6. like elements ---- */
  {
    const LIKE = [".btn", ".nav-link", ".notice", ".card", ".step-card", ".stat-card", ".input", "select", "textarea", ".chip", ".badge", ".pill", ".cat-tag", ".banner", ".candidate", ".finding", ".empty", "summary", ".segmented label", ".segmented button"];
    const pads = (s) => ["Top", "Right", "Bottom", "Left"].map((k) => parseFloat(s["padding" + k]));
    for (const selector of LIKE) {
      const groups = new Map();
      for (const el of document.querySelectorAll(selector)) {
        if (!vis(el) || isSrOnly(el)) continue;
        const key = el.tagName + "." + stripCat(el);
        (groups.get(key) || groups.set(key, []).get(key)).push(el);
      }
      for (const [key, els] of groups) {
        if (els.length < 2) continue;
        const tuples = els.map((e) => pads(cs(e)));
        const freq = new Map();
        for (const t of tuples) freq.set(t.map((v) => Math.round(v)).join(","), (freq.get(t.map((v) => Math.round(v)).join(",")) || 0) + 1);
        const mode = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
        els.forEach((e, i) => {
          if (tuples[i].some((v, k) => Math.abs(v - mode[k]) > 1)) add("padding-like", e, "padding " + tuples[i].map(px).join(" ") + " differs from the usual " + mode.map((v) => v + "px").join(" ") + " for " + key + " (" + els.length + " like elements)");
        });
      }
    }
    for (const [selector, label] of [[".btn, button.btn, a.btn", "buttons"], [".input, input[type=text], input[type=password], input[type=number], select", "inputs"]]) {
      const els = [...document.querySelectorAll(selector)].filter((e) => vis(e) && !isSrOnly(e) && lineRects(e).length <= 1 && !e.matches(".menu-button, [role=radio]"));
      const hs = els.map((e) => R(e).height);
      if (els.length > 1 && Math.max(...hs) - Math.min(...hs) > 1.5) {
        const lo = els[hs.indexOf(Math.min(...hs))];
        const hi = els[hs.indexOf(Math.max(...hs))];
        add("height-like", lo, "single-line " + label + " differ in height: " + px(Math.min(...hs)) + " (this one) to " + px(Math.max(...hs)) + " (" + selOf(hi) + ")");
      }
    }
    // tables: header and cell padding
    for (const table of document.querySelectorAll("table")) {
      if (!vis(table)) continue;
      const th = table.querySelector("thead th, th");
      const td = table.querySelector("tbody td, td");
      if (th && td && vis(th) && vis(td)) {
        const a = cs(th); const b = cs(td);
        if (parseInt(a.fontWeight, 10) >= 700) add("table-header", th, "header row is heavy (weight " + a.fontWeight + "); body weight " + b.fontWeight + ", use 600 or less");
        for (const k of ["Left", "Right"]) if (Math.abs(parseFloat(a["padding" + k]) - parseFloat(b["padding" + k])) > 1) add("table-padding", th, "header padding-" + k.toLowerCase() + " " + a["padding" + k] + " differs from body " + b["padding" + k]);
        if (Math.abs(parseFloat(a.paddingTop) - parseFloat(b.paddingTop)) > 4) add("table-padding", th, "header padding-top " + a.paddingTop + " differs from body " + b.paddingTop);
      }
      const rows = [...table.querySelectorAll("tbody tr")].filter(vis);
      if (width >= 768) {
        for (const tr of rows) {
          const first = tr.children[0];
          const second = tr.children[1];
          if (!first || !second || !vis(first)) continue;
          const lines = lineRects(first);
          if (lines.length > 1) add("table-first-column", first, "first column wraps onto " + lines.length + " lines at " + width + "px (cell " + px(R(first).width) + " wide, next column " + px(R(second).width) + " wide)");
        }
      }
    }
  }

  /* ---- 7. stacks: edges, gaps, unused space, measure ---- */
  const view = main.querySelector(".view") || main;
  const contentBox = (() => {
    const r = R(main);
    const s = cs(main);
    return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight), width: r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) };
  })();
  const SCALE = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48].map((v) => (v * rootPx) / 16);
  const kindOf = (a, b) => {
    if ((a.matches(HEADING_SEL) && !a.matches(".card-title")) || a.matches(".page-title-row, .section-title")) return "heading";
    if (a.matches("header, .page-header")) return "header";
    // a card is a card even when it is written as a <section> (the step cards); only plain sections count as sections
    if (a.matches(".card, .notice, .step-card, .empty, .notice-group, .banner, .candidate, .finding") && b.matches(".card, .notice, .step-card, .empty, .notice-group, .banner, .candidate, .finding")) return "card";
    if (a.matches("section, .section") && b.matches("section, .section")) return "section";
    return "other";
  };
  let widest = null;
  const gapKinds = { heading: [], section: [], card: [], header: [] };
  const containers = [view, ...view.querySelectorAll("*")].filter((e) => vis(e) && !e.closest("svg") && !e.closest(".tile"));
  for (const c of containers) {
    const kids = stackKids(c);
    if (kids.length < 2 || !isStack(kids)) continue;
    const cstyle = cs(c);
    // notes grouped in one frame are divided by hairlines, not by gaps
    if (c.matches(".notice-group")) continue;
    // a grid or a row of flex items is a layout, not a stack of blocks; only single-column ones count
    if (cstyle.display === "grid" && cstyle.gridTemplateColumns.split(" ").length > 1) continue;
    if (cstyle.display === "flex" && !/column/.test(cstyle.flexDirection)) continue;
    const shrink = ((cstyle.display === "flex" || cstyle.display === "grid") && !/^(normal|stretch)$/.test(cstyle.alignItems) && cstyle.flexDirection !== "row") || (cstyle.display === "grid" && !/^(normal|stretch)$/.test(cstyle.justifyItems)) || cstyle.textAlign === "center";
    // right and left edges of the content blocks that stack in this column
    const blocks = kids.filter((k) => k.matches(BLOCK_SEL) && !k.matches(".actions, .sr-only"));
    // On a wide screen running text keeps the measure while tables, tiles, cards and code use the whole width, so the two
    // kinds are compared among themselves; headings and headers take the width of what they head.
    const groups = WIDE
      ? [blocks.filter((k) => k.matches(TEXT_BLOCK)), blocks.filter((k) => !k.matches(TEXT_BLOCK) && !k.matches(HEADING_SEL + ", header, .page-header, .section-title, .page-title-row"))]
      : [blocks];
    for (const group of groups) {
      if (group.length < 2 || shrink) continue;
      const rights = group.map((k) => R(k).right);
      const lefts = group.map((k) => R(k).left);
      if (Math.max(...rights) - Math.min(...rights) > 2 || Math.max(...lefts) - Math.min(...lefts) > 2) {
        const list = group.map((k) => selOf(k) + " [" + textOf(k).slice(0, 16) + "] " + Math.round(R(k).left) + "-" + Math.round(R(k).right)).join("; ");
        add("block-edges", c, "sibling blocks do not share edges (left spread " + px(Math.max(...lefts) - Math.min(...lefts)) + ", right spread " + px(Math.max(...rights) - Math.min(...rights)) + "): " + list);
      }
    }
    for (const k of blocks) if (!widest || R(k).width > R(widest).width) widest = k;
    // gaps
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1]; const b = kids[i];
      if (b.matches(".sr-only") || a.matches(".sr-only")) continue;
      const ea = extent(a); const eb = extent(b);
      const gap = eb.top - ea.bottom;
      if (gap < -1) continue;
      const kind = kindOf(a, b);
      if (gapKinds[kind] && gap > 0.5) gapKinds[kind].push({ gap, a, b });
      if (gap > 3 * rootPx + 0.5) add("gap-too-large", b, "gap above is " + px(gap) + " (" + (Math.round((gap / rootPx) * 100) / 100) + " rem), more than 3 rem; previous block " + selOf(a) + " [" + textOf(a).slice(0, 20) + "]");
      else if (gap > 0.5 && !SCALE.some((v) => Math.abs(v - gap) <= 1.01)) add("gap-off-scale", b, "gap above is " + px(gap) + ", not on the 4 px scale; previous block " + selOf(a) + " [" + textOf(a).slice(0, 20) + "]");
    }
  }
  for (const [kind, list] of Object.entries(gapKinds)) {
    const vals = list.map((g) => Math.round(g.gap * 2) / 2);
    facts.gaps[kind] = vals;
    if (vals.length > 1 && Math.max(...vals) - Math.min(...vals) > 1.01 && kind !== "header") {
      const lo = list[vals.indexOf(Math.min(...vals))];
      const hi = list[vals.indexOf(Math.max(...vals))];
      add("gap-inconsistent", hi.b, kind + " gaps on this page range from " + px(Math.min(...vals)) + " (before " + selOf(lo.b) + ") to " + px(Math.max(...vals)) + " (before " + selOf(hi.b) + ")");
    }
  }
  if (widest && width >= 768) {
    const wr = R(widest);
    const left = Math.max(0, wr.left - contentBox.left);
    const right = Math.max(0, contentBox.right - wr.right);
    facts.unused = { left: left / contentBox.width, right: right / contentBox.width, widest: selOf(widest), widestW: wr.width, contentW: contentBox.width };
    if (left / contentBox.width > 0.25 || right / contentBox.width > 0.25) {
      add("unused-space", widest, "widest block " + px(wr.width) + " in a content area " + px(contentBox.width) + " leaves " + Math.round((left / contentBox.width) * 100) + "% unused on the left and " + Math.round((right / contentBox.width) * 100) + "% on the right");
    }
  }
  // running text measure
  // Characters per line are counted on the real text: the width of the paragraph divided by the average width of its own letters.
  const ch = (el) => { const f = cs(el).font; ctx2.font = f; const sample = norm(el.textContent).slice(0, 200) || "0"; return (ctx2.measureText(sample).width / sample.length) || 8; };
  for (const p of view.querySelectorAll("p, li, dd")) {
    if (!vis(p) || p.closest("table, .candidate, .stat, nav") || [...p.children].some((c) => c.matches("p, ul, ol, div"))) continue;
    const lines = lineRects(p);
    if (lines.length < 2) continue;
    const chars = R(p).width / ch(p);
    if (chars > 86) add("measure-too-wide", p, "running text is " + Math.round(chars) + " characters wide (" + px(R(p).width) + "), keep it near 70 to 80");
  }
  // inline-block-level items that stretch
  if (width >= 768) {
    for (const b of document.querySelectorAll("button, a.btn, .btn")) {
      if (!vis(b) || b.matches(".menu-button") || isSrOnly(b)) continue;
      const r = R(b);
      const range = document.createRange();
      range.selectNodeContents(b);
      const content = range.getBoundingClientRect();
      const s = cs(b);
      const contentW = content.width + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
      if (contentW > 0 && r.width > contentW * 2.5 && r.width > 120) add("button-stretch", b, "button is " + px(r.width) + " wide for " + px(contentW) + " of content (" + (Math.round((r.width / contentW) * 10) / 10) + " times)");
    }
  }

  /* ---- 8. orphans ---- */
  for (const el of view.querySelectorAll("p, li, dd, label, .notice-text, .caption")) {
    if (!vis(el) || [...el.children].some((c) => c.matches("p, ul, ol, div, table")) || el.querySelector(".finding, a.card") || el.closest(".tile")) continue;
    const wl = wordLines(el);
    const total = wl.reduce((n, l) => n + l.words.length, 0);
    if (width >= 360 && wl.length >= 2 && wl.length <= 4 && total >= 4 && wl[wl.length - 1].words.length === 1) add("orphan-word", el, 'last line is one word, "' + wl[wl.length - 1].words[0] + '" (' + wl.length + " lines)");
  }

  /* ---- 9. stat cards ---- */
  {
    const cards = [...document.querySelectorAll(".stat-card, .stats > .stat, .stat")].filter(vis);
    const uniq = [...new Set(cards)];
    // Tiles: the Overview findings and the count tiles. Every tile in one row shares its horizontal lines (icon, title,
    // number, description, action), titles take the same number of lines (one, at desktop widths), every part is centered
    // in its tile, and a row fills the grid (no hole at the right).
    const tiles = [...new Set([...document.querySelectorAll(".tile")].filter(vis))];
    const byParent = new Map();
    for (const t of tiles) (byParent.get(t.parentElement) || byParent.set(t.parentElement, []).get(t.parentElement)).push(t);
    const part = {
      icon: (t) => t.querySelector(".chip-icon"),
      title: (t) => t.querySelector(".tile-title, .stat-label > span"),
      figure: (t) => t.querySelector(".finding-figure, .stat-value"),
      text: (t) => t.querySelector(".finding-text"),
      action: (t) => t.querySelector(".tile-action"),
    };
    facts.tiles = { rows: 0, tiles: tiles.length };
    for (const [parent, list] of byParent) {
      const rows = [];
      for (const c of list.sort((p, q) => R(p).top - R(q).top || R(p).left - R(q).left)) {
        const row = rows.find((r2) => Math.abs(r2.top - R(c).top) < 4);
        if (row) row.cards.push(c); else rows.push({ top: R(c).top, cards: [c] });
      }
      facts.tiles.rows += rows.length;
      const pr = R(parent);
      for (const { cards: rowCards } of rows) {
        const lead = rowCards[0];
        const spread = (vals) => Math.max(...vals) - Math.min(...vals);
        // the tiles of a row are as tall as each other, and the row fills the grid
        const hs = rowCards.map((c) => R(c).height);
        if (spread(hs) > 1) add("tile-rows", lead, "tiles in one row have different heights: " + hs.map(px).join(", "));
        const bottoms = rowCards.map((c) => R(c).bottom);
        if (spread(bottoms) > 1) add("tile-rows", lead, "tiles in one row end at different heights: " + bottoms.map(px).join(", "));
        const rowLeft = Math.min(...rowCards.map((c) => R(c).left));
        const rowRight = Math.max(...rowCards.map((c) => R(c).right));
        // On a wide screen every tile of the Tools hub is one width (wide-columns checks that), so a group of two or five ends short by design.
        const hubShort = WIDE && parent.matches(".tiles-tools") && rowRight <= pr.right + 2;
        if (!hubShort && (Math.abs(rowLeft - pr.left) > 2 || Math.abs(rowRight - pr.right) > 2)) add("tile-rows", lead, "a row of tiles does not fill the grid (" + px(rowLeft) + " to " + px(rowRight) + " in " + px(pr.left) + " to " + px(pr.right) + "): a hole beside the last tile");
        // titles: the same number of lines in every tile of a row, and one line at desktop widths
        const lineCounts = rowCards.map((c) => { const t = part.title(c); return t ? lineRects(t).length : 0; });
        if (spread(lineCounts) > 0) add("tile-title-lines", lead, "tile titles in one row take different numbers of lines: " + rowCards.map((c, i) => textOf(part.title(c) || c).slice(0, 22) + " " + lineCounts[i]).join(", "));
        else if (width >= 768 && lineCounts[0] > 1) add("tile-title-lines", lead, "tile titles wrap onto " + lineCounts[0] + " lines at " + width + " px; they should take one line at desktop widths");
        // shared horizontal lines: icon, title, number and description start at the same y; actions end at the same y
        if (rowCards.length > 1) {
          for (const [role, edge] of [["icon", "top"], ["title", "top"], ["figure", "top"], ["text", "top"], ["action", "bottom"]]) {
            const els = rowCards.map((c) => part[role](c));
            if (els.some((e) => !e || !vis(e))) continue;
            const ys = els.map((e) => (role === "title" ? (lineRects(e)[0] || R(e))[edge] : R(e)[edge]));
            if (spread(ys) > 1) add("tile-rows", lead, role + " " + (edge === "bottom" ? "bottoms" : "tops") + " in one row sit at different heights: " + ys.map(px).join(", "));
          }
        }
        // everything in a tile is centered in it
        for (const c of rowCards) {
          const cr = R(c);
          const cx = (cr.left + cr.right) / 2;
          const off = [];
          for (const role of Object.keys(part)) {
            const e = part[role](c);
            if (!e || !vis(e)) continue;
            let centers;
            if (role === "icon") centers = [(R(e).left + R(e).right) / 2];
            else if (role === "action") {
              const ls = lineRects(e);
              const svg = e.querySelector("svg");
              const left = Math.min(...ls.map((L) => L.left), svg ? R(svg).left : Infinity);
              const right = Math.max(...ls.map((L) => L.right), svg ? R(svg).right : -Infinity);
              centers = [(left + right) / 2];
            } else centers = lineRects(e).map((L) => (L.left + L.right) / 2);
            for (const x of centers) if (Math.abs(x - cx) > 2.5) off.push(role + " is " + px(x - cx) + " off the tile center");
          }
          if (off.length) add("tile-center", c, "tile contents are not centered: " + [...new Set(off)].slice(0, 3).join("; "));
          const ta = cs(c).textAlign;
          if (ta !== "center") add("tile-center", c, "tile text-align is " + ta + ", not center");
        }
      }
    }
    if (contentChecks) {
      // the same number twice
      const vals = uniq.map((c) => { const v = c.querySelector(".stat-value, dd"); const l = c.querySelector(".stat-label, dt"); return { c, v: v ? norm(v.textContent) : "", l: l ? norm(l.textContent).toLowerCase() : "" }; });
      const words = (s) => new Set(s.split(/[^a-z]+/).filter((w) => w.length > 3 && !["with", "from", "that", "this", "have", "your", "their", "in", "the"].includes(w)));
      for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) {
        if (!/\d{2,}/.test(vals[i].v) || vals[i].v !== vals[j].v) continue;
        const a = words(vals[i].l); const b = words(vals[j].l);
        const stem = (w) => w.replace(/(ies|y|s)$/, "");
        const sa = new Set([...a].map(stem));
        if ([...b].some((w) => sa.has(stem(w)))) add("stat-repeat", vals[j].c, 'two cards show the same number "' + vals[i].v + '": "' + vals[i].l + '" and "' + vals[j].l + '"');
      }
      for (const { c, v } of vals) {
        if (!/^\d[\d,]{1,}$/.test(v)) continue;
        for (const p of view.querySelectorAll("p, li")) {
          if (!vis(p) || c.contains(p) || p.closest(".stat, .stat-card, .candidate, .guided-row, .findings") || norm(p.textContent).split(" ").length < 4) continue;
          if (new RegExp("(^|[^\\d,.])" + v.replace(/,/g, ",") + "([^\\d]|$)").test(norm(p.textContent))) { add("stat-repeat", p, 'a sentence repeats the number "' + v + '" that a card already shows'); break; }
        }
      }
    }
  }

  /* ---- 10. notices, banner, contrast ---- */
  {
    const notices = [...document.querySelectorAll(".notice, [role=note], [role=alert], .banner")].filter((n) => vis(n) && !n.closest(".sr-only"));
    const above = notices.filter((n) => R(n).top < vh && R(n).bottom > 0);
    if (above.length > 2) add("notice-count", above[2], above.length + " notices above the fold (" + above.map((n) => textOf(n).slice(0, 18)).join(" | ") + "), keep it to two");
    for (const n of notices) {
      // a visible leading label
      for (const el of n.querySelectorAll("strong, b, .notice-label, [class*=label]")) {
        if (vis(el) && !el.closest(".sr-only") && /^(note|warning|error|done|info)\.?:?$/i.test(norm(el.textContent))) add("notice-label", n, 'starts with the visible label "' + norm(el.textContent) + '"; the icon already says it');
      }
    }
    for (const n of notices.filter((x) => x.matches(".notice, [role=note], [role=alert]") && !x.matches(".banner"))) {
      const body = n.querySelector(".notice-text, .notice-body p, p") || n;
      const bg = bgOf(body);
      if (!bg) continue;
      const fg = textColorOf(body, bg);
      const r = ratio(fg, bg);
      if (r < 7) add("notice-contrast", n, "body text " + rgbStr(fg) + " on " + rgbStr(bg) + " is " + (Math.round(r * 100) / 100) + ":1, needs 7:1");
      const mainText = textColorOf(main, bgOf(main) || [255, 255, 255, 1]);
      const sameColor = fg.slice(0, 3).every((v, i) => Math.abs(v - mainText[i]) <= 2);
      if (!sameColor) add("notice-contrast", n, "body text color " + rgbStr(fg) + " is not the normal text color " + rgbStr(mainText) + " (only the icon, label, border and accent bar should carry the status color)");
    }
    for (const b of document.querySelectorAll(".banner, [data-banner], .banner-slot > *")) {
      if (!vis(b)) continue;
      const r = R(b);
      const lines = lineRects(b.querySelector("p, .banner-text") || b);
      const btn = b.querySelector("button");
      const limit = width >= 768 ? 56 : 96;
      if (r.height > limit) add("banner-slim", b, "sample-data strip is " + px(r.height) + " tall (" + (Math.round((r.height / vh) * 100)) + "% of the screen); limit " + limit + " px");
      if (width >= 768 && lines.length > 1) add("banner-slim", b, "sample-data strip text wraps onto " + lines.length + " lines on desktop");
      if (btn && vis(btn) && width >= 768 && R(btn).top > R(b).top + R(b).height / 2 + 4 && lines.length) add("banner-slim", btn, "the button sits under the text on desktop");
    }
  }
  if (contentChecks) {
    const seenText = new Set();
    for (const n of textNodes(document.body)) {
      const el = n.parentElement;
      if (!vis(el) || isSrOnly(el) || el.closest("[disabled], [aria-disabled=true]")) continue;
      const bg = bgOf(el);
      if (!bg) continue;
      const fg = textColorOf(el, bg);
      const s = cs(el);
      const size = parseFloat(s.fontSize);
      const bold = parseInt(s.fontWeight, 10) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      const r = ratio(fg, bg);
      const key = selOf(el) + "|" + norm(n.nodeValue).slice(0, 20);
      if (r < need - 0.005 && !seenText.has(key)) {
        seenText.add(key);
        add("text-contrast", el, "text " + rgbStr(fg) + " on " + rgbStr(bg) + " is " + (Math.round(r * 100) / 100) + ":1, needs " + need + ":1");
      }
      // long muted text: people need to read it
      if (el.matches(".muted, .caption, [class*=muted]") && !el.closest("footer") && norm(el.textContent).split(" ").length > 22 && !seenText.has("m" + key)) {
        seenText.add("m" + key);
        add("text-contrast", el, "long text (" + norm(el.textContent).split(" ").length + " words) is set in the muted caption style; people need to read it");
      }
    }
    // sizes and colors on this screen
    const sizes = new Map();
    const colors = new Map();
    for (const n of textNodes(view)) {
      const el = n.parentElement;
      if (!vis(el) || isSrOnly(el)) continue;
      const s = cs(el);
      const mono = /mono|courier|consolas/i.test(s.fontFamily) && !/Atkinson|Bricolage/.test(s.fontFamily.split(",")[0]);
      if (!mono) sizes.set(Math.round(parseFloat(s.fontSize) * 2) / 2, el);
      if (!el.closest("a, button, .btn, .badge, .chip, .pill, .notice-label")) colors.set(s.color, el);
    }
    if (sizes.size > 7) add("type-scale", view, sizes.size + " text sizes on one screen (" + [...sizes.keys()].sort((a, b) => a - b).join(", ") + " px), aim for five: title, section title, lead, body, caption");
    if (colors.size > 6) add("color-count", view, colors.size + " text colors on one screen: " + [...colors.keys()].join(" | "));
    // orange and vermilion
    const hsl = (c) => {
      const [r, g, b] = [c[0] / 255, c[1] / 255, c[2] / 255];
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 2;
      if (mx === mn) return { h: 0, s: 0, l };
      const d = mx - mn; const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return { h: h * 60, s, l };
    };
    // Orange is a secondary color. Orange-looking colors may appear only inside the Memories rescue area (its scope class)
    // and in a drawing's small highlight; anywhere else (violet accents, warnings, notices, buttons, links) they are a defect.
    // Tints count too: a peach or brown-orange warning surface is orange even when it is pale or dark. Gold (hue 48 and up) is fine.
    const inOrangeScope = (el) => !!el.closest(".cat-memories, .g-orange, .spot");
    for (const el of document.body.querySelectorAll("*")) {
      if (!vis(el) || inOrangeScope(el)) continue;
      const st = cs(el);
      const props = [st.color, st.backgroundColor, parseFloat(st.borderTopWidth) > 0 ? st.borderTopColor : null, parseFloat(st.borderLeftWidth) > 0 ? st.borderLeftColor : null, parseFloat(st.outlineWidth) > 0 ? st.outlineColor : null, el.closest("svg") ? st.fill : null, el.closest("svg") ? st.stroke : null];
      for (const p of props) {
        if (!p || p === "none") continue;
        const c = toRGBA(p);
        if (c[3] < 0.3) continue;
        const { h, s, l } = hsl(c);
        if (h >= 8 && h <= 40 && s >= 0.4 && l >= 0.08 && l <= 0.96) add("orange-scope", el, "color " + p + " (hue " + Math.round(h) + ", saturation " + Math.round(s * 100) + "%) is orange but sits outside the Memories rescue area; orange is a secondary color for that area and small illustration highlights only");
      }
    }
    // The orange palette stays measurably apart from the warning gold (hue angle and perceptual distance, OKLab).
    {
      const rootStyle = getComputedStyle(document.documentElement);
      const tok = (n) => toRGBA(rootStyle.getPropertyValue(n).trim());
      const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lab = (c) => {
        const [r, g, b] = [lin(c[0]), lin(c[1]), lin(c[2])];
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q];
      };
      const hueDeg = (c) => { const [, x, y] = lab(c); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };
      for (const [o, w] of [["--orange-fg", "--warning-fg"], ["--orange-border", "--warning-border"], ["--orange-solid", "--warning-border"]]) {
        const oc = tok(o); const wc = tok(w);
        if (oc[3] === 0 || wc[3] === 0) continue;
        const d = Math.abs(hueDeg(oc) - hueDeg(wc));
        const gap = Math.min(d, 360 - d);
        const p = lab(oc); const q = lab(wc);
        const de = 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        if (gap < 45 || de < 14) add("orange-scope", document.documentElement, o + " is too close to " + w + ": hue gap " + Math.round(gap) + " degrees (min 45), distance " + (Math.round(de * 10) / 10) + " (min 14)");
      }
    }
    // numerals
    const sv = document.querySelector(".stat-value");
    if (sv && vis(sv)) {
      const s = cs(sv);
      facts.fonts = { family: s.fontFamily, features: s.fontFeatureSettings, numeric: s.fontVariantNumeric };
      const primary = (s.fontFamily.split(",")[0] || "").replace(/["']/g, "").trim();
      if (s.fontFeatureSettings === "normal" && /Atkinson/i.test(primary) && !/slashed-zero|zero/.test(s.fontVariantNumeric)) add("numerals", sv, "stat values use " + primary + " with its default zero (slashed); decide: plain-zero feature, or another numeral style");
    }
  }

  /* ---- 11. meters, forms, segmented controls, code blocks ---- */
  for (const m of document.querySelectorAll("[role=progressbar], [role=meter], progress, meter, .meter-large, .strength, .progress")) {
    if (!vis(m) || m.closest("[role=progressbar], [role=meter]") !== null && m.closest("[role=progressbar], [role=meter]") !== m) continue;
    const named = m.getAttribute("aria-label") || m.getAttribute("aria-labelledby") || m.closest("label");
    const parent = m.parentElement;
    const r = R(m);
    const around = lineRects(parent).filter((L) => L.bottom <= r.top + 2 + 70 && L.top >= r.top - 70 && !(L.top > r.top && L.top < r.bottom));
    const above = around.filter((L) => L.bottom <= r.top + 2);
    const below = around.filter((L) => L.top >= r.bottom - 2);
    if (!named && m.getAttribute("role")) add("meter", m, "meter has no accessible name");
    if (above.length === 0 && below.length === 0) add("meter", m, "meter is a bare bar with no visible label or value next to it");
    else {
      const leaves = parent ? [...parent.querySelectorAll("*")].filter((e) => vis(e) && e.children.length === 0 && norm(e.textContent) && !m.contains(e)) : [];
      const valueLeaf = leaves.find((e) => /\d|%|weak|fair|good|strong|short|empty|none/i.test(norm(e.textContent))) || (leaves.length >= 2 ? leaves[leaves.length - 1] : undefined);
      if (!valueLeaf) add("meter", m, "the text next to the meter shows a label but no value (a number, a percent or a word like Strong)");
      else if (above.length) {
        const line = above[above.length - 1];
        const onLine = leaves.filter((e) => Math.abs((R(e).top + R(e).bottom) / 2 - line.cy) < line.h);
        if (onLine.length < 2) add("meter", m, "label and value are not together on one line above the bar (only " + onLine.length + " text item on the line above it)");
        const gapAbove = r.top - line.bottom;
        if (gapAbove > 24) add("meter", m, "the meter text sits " + px(gapAbove) + " above the bar; keep label and value tight on one line above it");
      } else add("meter", m, "label and value sit below the bar; put them on one line above it");
    }
  }
  {
    const fields = [...document.querySelectorAll("input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea")].filter(vis);
    for (const f of fields) facts.fieldWidths.push({ sel: selOf(f), w: R(f).width, type: f.getAttribute("type") || f.tagName.toLowerCase(), mode: f.getAttribute("inputmode") || "", text: textOf(f.closest(".field, label") || f) });
    const buttons = [...document.querySelectorAll("button, a.btn")].filter(vis);
    for (const f of fields) {
      const fr = R(f);
      if (width >= 768 && f.tagName === "INPUT" && f.scrollWidth > f.clientWidth + 1) add("form-row", f, "input text is clipped (scrollWidth " + f.scrollWidth + " > clientWidth " + f.clientWidth + ")");
      const form = f.closest("form, .form, .form-inline, .field, fieldset") || f.parentElement;
      const scope = form.closest("form, .form-inline, .form, section, .card") || form;
      for (const b of buttons) {
        if (!scope.contains(b) || b.matches(".menu-button")) continue;
        const br = R(b);
        const overlap = Math.min(br.bottom, fr.bottom) - Math.max(br.top, fr.top);
        const sameRow = overlap > Math.min(br.height, fr.height) * 0.3;
        if (sameRow) {
          if (Math.abs(br.height - fr.height) > 1.5) add("form-row", b, "button is " + px(br.height) + " tall next to a " + px(fr.height) + " input (" + selOf(f) + "); match the input height");
          if (Math.abs((br.top + br.bottom) / 2 - (fr.top + fr.bottom) / 2) > 1.5) add("form-row", b, "button center " + px((br.top + br.bottom) / 2) + " vs input center " + px((fr.top + fr.bottom) / 2));
        } else if (width >= 768 && f.matches("input[type=number]") && br.top > fr.bottom - 1 && br.top - fr.bottom < 40 && Math.abs(br.left - fr.left) < 8) {
          add("form-row", b, "the button sits on its own row under the " + px(fr.width) + " number box; label, input and button should share one aligned row");
        }
      }
    }
    // radio groups
    const radios = [...document.querySelectorAll("input[type=radio]")];
    const byName = new Map();
    for (const r of radios) (byName.get(r.name) || byName.set(r.name, []).get(r.name)).push(r);
    for (const [name, list] of byName) {
      const labels = list.map((r) => (r.labels && r.labels[0]) || r.closest("label") || r).filter(vis);
      if (labels.length < 2) continue;
      const tops = labels.map((l) => R(l).top);
      const lefts = labels.map((l) => R(l).left);
      const stacked = Math.max(...tops) - Math.min(...tops) > 8 && Math.max(...lefts) - Math.min(...lefts) < 8;
      if (stacked && width >= 360) add("segmented", labels[0], "radio choices " + name + " are stacked vertically (" + labels.length + " rows); use a compact segmented control");
      const nativeVisible = list.some((r) => { const s = cs(r); const rr = R(r); return rr.width >= 10 && rr.height >= 10 && parseFloat(s.opacity) > 0 && s.clip !== "rect(0px, 0px, 0px, 0px)" && !isSrOnly(r); });
      if (nativeVisible) add("segmented", labels[0], "native radio circles are visible for " + name + "; the unselected ring cannot reach 3:1");
      const checked = list.find((r) => r.checked);
      const chosenLabel = checked && ((checked.labels && checked.labels[0]) || checked.closest("label"));
      if (chosenLabel && vis(chosenLabel)) {
        const group = chosenLabel.parentElement;
        const around = bgOf(group) || [255, 255, 255, 1];
        const mine = bgOf(chosenLabel) || around;
        const s = cs(chosenLabel);
        const bc = toRGBA(s.borderTopColor);
        const rBg = ratio(mine, around);
        const rBorder = parseFloat(s.borderTopWidth) > 0 && bc[3] > 0 ? ratio(blend(bc, around), around) : 0;
        const others = labels.filter((l) => l !== chosenLabel);
        const weightDiff = others.length && parseInt(s.fontWeight, 10) > parseInt(cs(others[0]).fontWeight, 10);
        if (Math.max(rBg, rBorder) < 3 && !weightDiff) add("segmented", chosenLabel, "selected option stands out only " + (Math.round(Math.max(rBg, rBorder) * 100) / 100) + ":1 from its surroundings; needs 3:1");
        else if (Math.max(rBg, rBorder) < 3) add("segmented", chosenLabel, "selected option has bold text but its fill or border is only " + (Math.round(Math.max(rBg, rBorder) * 100) / 100) + ":1 against its surroundings; needs 3:1");
      }
    }
    // segmented controls made of pressed buttons: the chosen one is bold and has a 3:1 border or fill against its track
    for (const seg of document.querySelectorAll(".segmented")) {
      if (!vis(seg)) continue;
      const chosen = seg.querySelector("button[aria-pressed=true]");
      const others = [...seg.querySelectorAll("button[aria-pressed=false]")];
      if (!chosen) { add("segmented", seg, "no option is marked as chosen"); continue; }
      const track = bgOf(seg) || [255, 255, 255, 1];
      const s = cs(chosen);
      const bc = toRGBA(s.borderTopColor);
      const rBorder = parseFloat(s.borderTopWidth) >= 2 && bc[3] > 0 ? ratio(blend(bc, track), track) : 0;
      const rFill = ratio(bgOf(chosen) || track, track);
      if (Math.max(rBorder, rFill) < 3) add("segmented", chosen, "chosen option stands out only " + (Math.round(Math.max(rBorder, rFill) * 100) / 100) + ":1 from its track; needs 3:1");
      if (others.length && !(parseInt(s.fontWeight, 10) > parseInt(cs(others[0]).fontWeight, 10))) add("segmented", chosen, "chosen option is not bolder than the others");
    }
    // code blocks: the code scrolls sideways; a command's Copy and Run sit together in the header row above it
    for (const pre of document.querySelectorAll("pre")) {
      if (!vis(pre)) continue;
      const s = cs(pre);
      const pr = R(pre);
      if (!(s.overflowX === "auto" || s.overflowX === "scroll")) add("code-copy", pre, "code block does not scroll sideways (overflow-x " + s.overflowX + "); long lines get cut or spill");
      if (!/^pre$/.test(s.whiteSpace)) add("code-copy", pre, "code block wraps its text (white-space " + s.whiteSpace + "); it should scroll sideways instead");
      const frame = pre.closest(".command");
      if (!frame) continue; // other code (the page's policy text) has no buttons
      const fr = R(frame);
      const head = frame.querySelector(".command-head");
      const buttons = head ? [...head.querySelectorAll("button")].filter(vis) : [];
      const copy = buttons.find((x) => /^copy$/i.test(norm(x.textContent)));
      const runButton = buttons.find((x) => /^run$/i.test(norm(x.textContent)));
      if (!copy || !runButton) { add("code-copy", frame, "a command needs a Copy button and a Run button in the header row above its code"); continue; }
      const cr = R(copy);
      const rr = R(runButton);
      for (const [name, x, r] of [["Copy", copy, cr], ["Run", runButton, rr]]) {
        if (r.left < fr.left - 1 || r.right > fr.right + 1) add("code-copy", x, name + " button is outside the command frame");
        if (r.bottom > pr.top + 1) add("code-copy", x, name + " button is not above the code (the button ends at " + px(r.bottom) + ", the code starts at " + px(pr.top) + ")");
        if (r.width > fr.width * 0.5 && fr.width > 200) add("code-copy", x, name + " button is " + px(r.width) + " wide in a " + px(fr.width) + " frame; make it compact");
      }
      if (!(cr.left < rr.left - 1 || cr.top < rr.top - 1)) add("code-copy", copy, "Copy must come before Run");
      if (pr.right > fr.right + 1 || pr.left < fr.left - 1) add("code-copy", pre, "the code is wider than its frame (" + px(pr.left) + " to " + px(pr.right) + " in " + px(fr.left) + " to " + px(fr.right) + ")");
    }
  }

  /* ---- 12. header and gutters ---- */
  {
    const header = document.querySelector("header.site-header, body > header, #app > header");
    if (header && vis(header)) {
      const hr = R(header);
      const kids = [];
      const collect = (el, depth) => { for (const c of el.children) { if (!vis(c) || isSrOnly(c)) continue; if (c.matches("svg, button, a, span, p") || (c.children.length === 0 && norm(c.textContent))) kids.push(c); else if (depth < 2) collect(c, depth + 1); } };
      collect(header, 0);
      const brand = header.querySelector(".brand, a[href='#/start']");
      const toggle = [...header.querySelectorAll("button")].find((b) => vis(b) && (b.hasAttribute("aria-pressed") || /theme/i.test((b.getAttribute("aria-label") || "") + b.textContent)));
      const menuBtn = [...header.querySelectorAll("button")].find((b) => vis(b) && /menu/i.test((b.getAttribute("aria-label") || "") + b.textContent));
      const logo = brand && brand.querySelector("svg");
      const word = brand && (brand.querySelector(".wordmark") || [...brand.querySelectorAll("span")].find((e) => vis(e)));
      const items = [logo, word, toggle, menuBtn].filter((e) => e && vis(e));
      const cys = items.map((e) => { const L = e === logo || e.tagName === "BUTTON" ? R(e) : (lineRects(e)[0] || R(e)); return (L.top + L.bottom) / 2; });
      facts.header = { height: hr.height, toggle: !!toggle, menu: !!menuBtn };
      if (cys.length > 1 && Math.max(...cys) - Math.min(...cys) > 1.5) add("header-row", header, "header items are not vertically centered together: " + items.map((e, i) => selOf(e).slice(0, 18) + " " + px(cys[i])).join(", ") + " (spread " + px(Math.max(...cys) - Math.min(...cys)) + ")");
      const direct = [...header.children].filter((c) => vis(c) && !isSrOnly(c));
      const tops = direct.map((c) => R(c).top);
      if (direct.length > 1 && Math.max(...tops) - Math.min(...tops) > 12) add("header-row", header, "header is more than one row: item tops " + tops.map(px).join(", "));
      if (hr.height > 72) add("header-row", header, "header is " + px(hr.height) + " tall; keep one compact row (72 px or less)");
      const hc = header.querySelectorAll("*");
      let overflowItem = null;
      for (const e of hc) if (vis(e) && !isSrOnly(e) && R(e).right > vw + 1) overflowItem = e;
      if (overflowItem) add("header-row", overflowItem, "header item runs past the right edge (" + px(R(overflowItem).right) + " > " + vw + ")");
      if (!toggle) add("header-toggle", header, "no theme toggle in the header");
      else {
        const tr = R(toggle);
        if (touch && Math.min(tr.width, tr.height) < 43.5) add("header-toggle", toggle, "theme toggle is " + px(tr.width) + " by " + px(tr.height) + ", needs 44 px");
        const rightmost = Math.max(...[...header.querySelectorAll("button, a")].filter(vis).map((e) => R(e).right));
        // On a phone the toggle ends one gutter from the right edge. On wider windows it ends exactly where the content column ends.
        const colRight = view ? R(view).right : vw;
        const atRight = width < 768 ? vw - rightmost < 48 : Math.abs(rightmost - colRight) <= 2;
        if (!(tr.left > vw * 0.4 && atRight && tr.top < 80)) add("header-toggle", toggle, "theme toggle is not at the top right / not on the content column's right edge (box " + px(tr.left) + " to " + px(tr.right) + " of " + vw + ", rightmost header control ends at " + px(rightmost) + ", content column ends at " + px(colRight) + ")");
        const name = toggle.getAttribute("aria-label") || toggle.textContent;
        if (!/^switch to (light|dark) theme$/i.test(norm(name))) add("header-toggle", toggle, 'accessible name "' + norm(name) + '" should say what pressing it does ("Switch to light theme" or "Switch to dark theme")');
        if (!toggle.hasAttribute("aria-pressed") && !toggle.hasAttribute("aria-checked") && !toggle.hasAttribute("aria-current")) add("header-toggle", toggle, "no aria-pressed (or equivalent) stating the current theme");
        const ths = toggle.querySelectorAll("svg use");
        if (ths.length === 0) add("header-toggle", toggle, "theme toggle has no sun or moon icon");
      }
      const headerText = norm(header.innerText + " " + [...header.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).join(" "));
      if (/session only|nothing is saved/i.test(headerText)) add("header-badge", header, 'the "Session only: nothing is saved" badge is still in the header');
      // gutters
      const gl = brand ? R(brand).left : hr.left;
      const lastRight = Math.max(...[toggle, menuBtn].filter(Boolean).map((e) => R(e).right), 0);
      const gr = lastRight ? vw - lastRight : null;
      facts.gutters = { headerLeft: gl, headerRight: gr };
      if (width < 1024) {
        if (gr !== null && Math.abs(gl - gr) > 2.5 && width >= 320) add("gutter", header, "header gutters are uneven: left " + px(gl) + ", right " + px(gr));
      } else {
        // Beside the sidebar: the logo starts at the sidebar's left edge, and the toggle ends at the column's right edge.
        const navLeft = nav ? R(nav).left : gl;
        const colRight2 = view ? R(view).right : vw;
        if (Math.abs(gl - navLeft) > 2.5) add("gutter", header, "header logo starts at " + px(gl) + " but the sidebar starts at " + px(navLeft));
        if (lastRight && Math.abs(lastRight - colRight2) > 2.5) add("gutter", header, "header controls end at " + px(lastRight) + " but the content column ends at " + px(colRight2));
        const footerText = document.querySelector(".site-footer p, footer p");
        if (footerText && view && Math.abs(R(footerText).left - R(view).left) > 2.5) add("gutter", footerText, "footer text starts at " + px(R(footerText).left) + " but the content column starts at " + px(R(view).left));
      }
    }
    if (width < 768) {
      const blocks = stackKids(view).filter((k) => k.matches(BLOCK_SEL));
      if (blocks.length) {
        const lefts = blocks.map((k) => R(k).left);
        const rights = blocks.map((k) => vw - R(k).right);
        const lg = Math.min(...lefts); const rg = Math.min(...rights);
        facts.gutters = Object.assign(facts.gutters || {}, { contentLeft: lg, contentRight: rg });
        if (Math.abs(lg - rg) > 2.5) add("gutter", view, "content gutters are uneven on a phone: left " + px(lg) + ", right " + px(rg));
        if (facts.gutters.headerLeft !== undefined && Math.abs(facts.gutters.headerLeft - lg) > 2.5) add("gutter", header || view, "header left gutter " + px(facts.gutters.headerLeft) + " does not match the content gutter " + px(lg));
        if (facts.gutters.headerRight != null && Math.abs(facts.gutters.headerRight - rg) > 2.5) add("gutter", header || view, "header right gutter " + px(facts.gutters.headerRight) + " does not match the content gutter " + px(rg));
      }
    }
  }

  /* ---- 13. words on the page ---- */
  if (contentChecks) {
    const bodyText = document.body.innerText || "";
    const sentences = new Map();
    // Rows of a list (one per person) repeat their template sentences on purpose, so they are left out here.
    const nearestBlock = (node) => { let e = node.parentElement; while (e && !(BLOCK_DISPLAY.test(cs(e).display) || /^(table-cell|table-row)$/.test(cs(e).display))) e = e.parentElement; return e; };
    const blocksOfText = new Set();
    for (const n of textNodes(document.body)) { const e = nearestBlock(n); if (e && vis(e) && !e.closest(".candidate, .rows, .sr-only")) blocksOfText.add(e); }
    for (const e of blocksOfText) {
      for (const s of norm(e.innerText).split(/(?<=[.?!])\s+/)) {
        const n = norm(s).toLowerCase().replace(/[.?!]+$/, "");
        if (n.split(" ").length > 8) sentences.set(n, (sentences.get(n) || 0) + 1);
      }
    }
    for (const [s, n] of sentences) if (n > 1) found.push({ check: "duplicate-sentence", sel: "", text: s.slice(0, 60), detail: "appears " + n + " times on this page" });
    const legal = (bodyText.match(/is not affiliated with/gi) || []).length;
    if (legal !== 1) found.push({ check: "legal-line", sel: "", text: "independence line", detail: "appears " + legal + " times on this page, should be exactly once" });
    const notes = [...document.querySelectorAll(".notice, [role=note], .banner")].filter((n) => vis(n) && !n.closest(".sr-only"));
    const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "it", "this", "that", "for", "on", "with", "you", "your", "snappy", "not", "no", "be", "can", "may", "as"]);
    const bag = (n) => new Set(norm(n.innerText).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)));
    for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
      const a = bag(notes[i]); const b = bag(notes[j]);
      if (a.size < 4 || b.size < 4) continue;
      const inter = [...a].filter((w) => b.has(w)).length;
      const jac = inter / (a.size + b.size - inter);
      if (jac >= 0.6) add("duplicate-note", notes[j], "repeats the information of another note on this page: " + textOf(notes[i]).slice(0, 30) + " (" + Math.round(jac * 100) + "% shared words)");
    }
    const all = document.documentElement.textContent || "";
    const stale = [/\bnpm run (?!snappy-export\b)[\w:.-]*snappy[\w:.-]*/g, /\bsnappy (inspect|analyze|memories|keep|unkeep|ledger|demo|help)\b/g, /\bsnappy-cli\b/gi, /\bsnappy_export\b/g];
    for (const re of stale) for (const m of all.matchAll(re)) found.push({ check: "stale-name", sel: "", text: m[0], detail: "the command is called snappy-export" });
  }

  /* ---- 15. further measured checks ---- */
  {
    // the Menu button's icon is a square of 16 px or more (not squeezed by a flex row)
    const mb = document.querySelector(".menu-button");
    if (mb && vis(mb)) for (const s of mb.querySelectorAll("svg")) { const r = R(s); if (vis(s) && (Math.abs(r.width - r.height) > 0.5 || r.width < 16)) add("menu-icon", s, "menu icon is " + px(r.width) + " by " + px(r.height) + ", it must be a square of 16 px or more"); }
    // the two header controls are the same kind of control
    const tg = document.querySelector(".theme-toggle");
    if (tg && mb && vis(tg) && vis(mb)) {
      const a = cs(tg); const b = cs(mb);
      if (parseFloat(a.borderTopWidth) !== parseFloat(b.borderTopWidth) || a.borderTopColor !== b.borderTopColor) add("header-controls", tg, "theme toggle border " + a.borderTopWidth + " " + a.borderTopColor + " differs from the Menu button's " + b.borderTopWidth + " " + b.borderTopColor + "; the two must look like one kind of control");
    }
    // tables are rounded like cards, and stacked phone rows do not repeat the column names
    for (const wrap of document.querySelectorAll(".table-wrap")) {
      if (!vis(wrap)) continue;
      const rad = parseFloat(cs(wrap).borderTopLeftRadius);
      if (rad < 8) add("table-radius", wrap, "table frame radius is " + px(rad) + "; cards are 12 px");
      if (width <= 640) for (const td of wrap.querySelectorAll("td")) { const c = cs(td, "::before").content; if (c && c !== "none" && c !== "normal") { add("table-label", td, "a stacked row repeats its column name before the cell (" + c + ")"); break; } }
    }
    // section headings: a chip on every h2 or on none
    const h2s = [...main.querySelectorAll("h2.section-title")].filter(vis);
    const withChip = h2s.filter((h2) => h2.querySelector(".chip-icon")).length;
    if (withChip > 0 && withChip < h2s.length) add("heading-style", h2s[0], withChip + " of " + h2s.length + " section headings have an icon chip; use one on all of them or none");
    // the illustration ends on the column's right edge
    for (const sp of document.querySelectorAll(".spot-header")) {
      const hd = sp.closest(".page-header");
      if (hd && vis(sp) && Math.abs(R(sp).right - R(hd).right) > 1.5) add("spot-edge", sp, "illustration ends at " + px(R(sp).right) + " but the column ends at " + px(R(hd).right));
      if (hd && vis(sp) && R(sp).height > R(hd).height + 1) add("spot-edge", sp, "illustration is taller than its header");
    }
    // notices: the colored bar is the left border, and a one-line notice is not shorter than the minimum
    for (const n of document.querySelectorAll(".notice")) {
      if (!vis(n)) continue;
      if (parseFloat(cs(n).borderLeftWidth) < 3) add("notice-bar", n, "the status bar is not flush with the left border (border " + cs(n).borderLeftWidth + ")");
    }
    // phones: the lead is not larger than 17 px; running text reaches near the container's right edge
    if (width < 768) {
      for (const lead of document.querySelectorAll(".lead")) if (vis(lead) && parseFloat(cs(lead).fontSize) > 17.2) add("lead-size", lead, "lead is " + cs(lead).fontSize + " on a phone; keep it near body size");
      for (const p of view.querySelectorAll("p, li, dd")) {
        if (!vis(p) || p.closest("table, .candidate, .stat, nav, .finding") || [...p.children].some((c) => c.matches("p, ul, ol, div"))) continue;
        const lines = lineRects(p);
        if (lines.length < 3) continue;
        const inner = R(p).right - parseFloat(cs(p).paddingRight);
        const longest = Math.max(...lines.slice(0, -1).map((l) => l.right));
        if (inner - longest > 80) add("text-short", p, "text stops " + px(inner - longest) + " short of its container's right edge (" + lines.length + " lines)");
      }
    }
  }

  /* ---- 16. the wide layout (1280 and up) ---- */
  if (WIDE) {
    const rem = rootPx;
    const measure = 36 * rem + 2;
    const layout = document.querySelector(".layout");
    const content = document.querySelector(".content");
    if (layout) {
      const lr = R(layout);
      const left = lr.left;
      const right = vw - lr.right;
      // the shell is centered: equal margins, and never wider than 100 rem (96 rem is the cap)
      if (Math.abs(left - right) > 2) add("wide-shell", layout, "the shell is not centered: " + px(left) + " on the left and " + px(right) + " on the right");
      if (lr.width > 100 * rem + 1) add("wide-shell", layout, "the shell is " + px(lr.width) + " wide, more than 100 rem");
      const wantContent = (vw >= 100 * rem ? 77 : 60) * rem;
      if (view && Math.abs(R(view).width - wantContent) > 2) add("wide-shell", view, "the content area is " + px(R(view).width) + " wide, expected " + px(wantContent) + " at this width");
      for (const el of [document.querySelector(".site-header-inner"), document.querySelector(".site-footer-inner")]) {
        if (el && Math.abs(R(el).left - left) > 2 && Math.abs(R(el).left - lr.left) > 2) add("wide-shell", el, "header or footer row starts at " + px(R(el).left) + " but the shell starts at " + px(left));
      }
    }
    // the sidebar sits beside the content, never over it, and stays in view while the page scrolls
    if (nav && content && vis(nav)) {
      const nr = R(nav);
      const cr = R(content);
      if (nr.right > cr.left + 0.5) add("wide-sidebar", nav, "the sidebar ends at " + px(nr.right) + " but the content starts at " + px(cr.left) + ": they overlap");
      if (cs(nav).position !== "sticky") add("wide-sidebar", nav, "the sidebar is " + cs(nav).position + ", not sticky");
    }
    // running text, notices and fields keep the 36 rem measure
    const texts = [...view.querySelectorAll("p, li, dd, .notice, .tool-reads, input.input, select.input, .select-wrap")].concat([...document.querySelectorAll(".site-footer p")]);
    for (const el of texts) {
      if (!vis(el) || isSrOnly(el) || el.closest("table, .table-wrap, .tile, nav, pre, .t-log, .stat") || el.matches(".input-narrow") || (el.tagName === "LABEL" && el.matches(".check"))) continue;
      if (el.matches("select.input") && el.closest(".select-wrap")) continue;
      // rows of people (a name on the left, its dates on the right) and the notes of a grid are laid out, not running text; their words are checked as paragraphs
      if (el.matches(".review-row, .reply-row, .step-card, .mark-item, .candidate, .guided-row") || (el.matches(".notice") && el.closest(".stack, .notice-group"))) continue;
      if (el.matches("p, li, dd") && [...el.children].some((c) => c.matches("p, ul, ol, div"))) continue;
      const w = R(el).width;
      if (w > measure) add("wide-measure", el, "is " + px(w) + " wide (" + (Math.round((w / rem) * 10) / 10) + " rem); text blocks, notices and fields keep the 36 rem measure");
    }
    // cards that are siblings in one grid: equal widths for equal spans; no row of the grid ends with one lone card
    const CARD = ".card, .step-card, .tile, .candidate, .guided-row, .fact, .license";
    const spans = (el) => cs(el).gridColumnStart + "/" + cs(el).gridColumnEnd;
    for (const g of [view, ...view.querySelectorAll("*")]) {
      if (!vis(g) || g.closest("svg")) continue;
      const gs = cs(g);
      const kids = [...g.children].filter((c) => vis(c) && c.matches(CARD));
      if (kids.length < 2) continue;
      if (gs.display === "grid" && gs.gridTemplateColumns.split(" ").length > 1) {
        const bySpan = new Map();
        for (const k of kids) (bySpan.get(spans(k)) || bySpan.set(spans(k), []).get(spans(k))).push(k);
        for (const [span, list] of bySpan) {
          const ws = list.map((k) => R(k).width);
          if (Math.max(...ws) - Math.min(...ws) > 1.5) add("wide-columns", list[0], "cards with the same span (" + span + ") differ in width: " + ws.map(px).join(", "));
        }
        const rows = [];
        for (const k of kids.sort((a, b) => R(a).top - R(b).top || R(a).left - R(b).left)) {
          const row = rows.find((r2) => Math.abs(r2.top - R(k).top) < 4);
          if (row) row.items.push(k); else rows.push({ top: R(k).top, items: [k] });
        }
        const last = rows[rows.length - 1];
        // a numbered run of steps flows down its columns (1, 2, 3 | 4, 5), so its second column may be shorter by design
        if (!g.matches("ol.step-list") && rows.length >= 2 && last.items.length === 1 && R(last.items[0]).width < R(g).width * 0.9) add("wide-orphan", last.items[0], "the last row of a grid of " + kids.length + " cards holds one lone card (" + px(R(last.items[0]).width) + " of " + px(R(g).width) + "); let it span the row or share the row");
      }
    }
    // the two columns of a balanced flow, and a numbered run of steps, are equal
    for (const c of view.querySelectorAll(".cols, ol.step-list")) {
      if (!vis(c)) continue;
      const kids = [...c.children].filter((k) => vis(k));
      const ws = kids.map((k) => R(k).width);
      if (ws.length > 1 && Math.max(...ws) - Math.min(...ws) > 1.5) add("wide-columns", c, "the blocks of one column flow differ in width: " + ws.map(px).join(", "));
      const lefts = [...new Set(kids.map((k) => Math.round(R(k).left)))];
      if (lefts.length > 2) add("wide-columns", c, "a column flow has " + lefts.length + " columns, expected 2");
    }
    // the three steps of the Start page: their titles start at one top and so do their bodies (no field floats in the middle of a card)
    const stepCardsEl = [...view.querySelectorAll("div.step-list > .step-card")].filter((c) => vis(c));
    if (stepCardsEl.length > 1) {
      const tops = (sel) => stepCardsEl.map((c) => c.querySelector(sel)).filter(Boolean).map((e) => R(e).top);
      for (const [sel, what] of [[".step-content", "bodies"], [".step-num", "numbers"], ["h2", "titles"]]) {
        const t = tops(sel);
        if (t.length > 1 && Math.max(...t) - Math.min(...t) > 1.5) add("wide-steps", stepCardsEl[0], "the " + what + " of the step cards start at different heights: " + t.map(px).join(", "));
      }
      // the first line of each body sits directly under the shared title row: no dead gap above a body that is taller than the others' titles
      const gaps = stepCardsEl.map((c) => { const t = c.querySelector("h2"); const b = c.querySelector(".step-content"); return t && b ? R(b).top - R(t).bottom : 0; });
      if (Math.max(...gaps) > 3 * rem) add("wide-steps", stepCardsEl[0], "a step body starts " + px(Math.max(...gaps)) + " below its title: a dead gap");
    }
    // the Tools hub: one tile width on the whole page, in every group
    const hubTiles = [...view.querySelectorAll(".tiles-tools .tile")].filter((t) => vis(t));
    if (hubTiles.length > 1) {
      const ws = hubTiles.map((t) => R(t).width);
      if (Math.max(...ws) - Math.min(...ws) > 1.5) add("wide-columns", hubTiles[0], "tiles of the Tools hub differ in width across groups: " + [...new Set(ws.map((w) => Math.round(w)))].map(px).join(", "));
    }
    // the notes of Export health: a grid with no lone note in its last row, no note running past its column, and no card half empty
    for (const g of view.querySelectorAll(".health-notes")) {
      if (!vis(g)) continue;
      const cols = cs(g).gridTemplateColumns.split(" ").length;
      const notes = [...g.querySelectorAll(".notice")].filter((n) => vis(n));
      if (notes.length < 2) continue;
      const rows = [];
      for (const n of notes.sort((a, b) => R(a).top - R(b).top || R(a).left - R(b).left)) {
        const row = rows.find((r2) => Math.abs(r2.top - R(n).top) < 4);
        if (row) row.items.push(n); else rows.push({ top: R(n).top, items: [n] });
      }
      if (cols > 1 && rows.length >= 2 && rows[rows.length - 1].items.length === 1) add("wide-orphan", rows[rows.length - 1].items[0], "the last row of the " + notes.length + " notes holds one lone note");
      const ws = notes.map((n) => R(n).width);
      if (Math.max(...ws) - Math.min(...ws) > 1.5) add("wide-columns", notes[0], "notes of one grid differ in width: " + ws.map(px).join(", "));
    }
    // the Export health card: its two parts side by side, neither leaving the card half empty beside the other
    for (const body of view.querySelectorAll(".details-body")) {
      const left = body.querySelector(":scope > .health-notes");
      const right = body.querySelector(":scope > .subsection");
      if (!left || !right || !vis(left) || !vis(right)) continue;
      if (Math.abs(R(left).top - R(right).top) > 20) add("wide-columns", left, "the two parts of Export health do not start on one row (" + px(R(left).top) + " and " + px(R(right).top) + ")");
      if (Math.abs(R(left).width - R(right).width) > 1.5) add("wide-columns", left, "the two parts of Export health differ in width: " + px(R(left).width) + " and " + px(R(right).width));
    }
    // no card is empty on its right third: its content reaches into the last third of its width
    // (people cards count too, unless one takes a whole row on its own: that is the last card of an odd list)
    for (const card of view.querySelectorAll(".card, .step-card, .empty, .tool-reads, .confirm, .candidate, .guided-row")) {
      if (!vis(card) || card.closest(".tile, table") || card.parentElement?.closest(".candidate, .guided-row") || card.matches(".tile, .fact, .step-card-compact")) continue;
      if (card.matches(".candidate, .guided-row") && card.parentElement && R(card).width > R(card.parentElement).width * 0.8) continue;
      const cr = R(card);
      const st = cs(card);
      const innerRight = cr.right - parseFloat(st.paddingRight) - parseFloat(st.borderRightWidth);
      const innerLeft = cr.left + parseFloat(st.paddingLeft) + parseFloat(st.borderLeftWidth);
      let reach = innerLeft;
      for (const l of lineRects(card)) reach = Math.max(reach, l.right);
      for (const e of card.querySelectorAll("svg, button, a.btn, input, select, .dropzone, .pill, .actions, .code, .table-wrap, .meter, .progress")) if (vis(e) && !e.closest(".sr-only")) reach = Math.max(reach, R(e).right);
      const free = (innerRight - reach) / Math.max(1, innerRight - innerLeft);
      if (free > 0.34) add("wide-empty-card", card, "the right " + Math.round(free * 100) + "% of the card (" + px(innerRight - reach) + " of " + px(innerRight - innerLeft) + ") is empty");
    }
  }

  /* ---- 14. inline probes for the four notice kinds (clone one real notice) ---- */
  if (opts.probeNotices) {
    const template = main.querySelector(".notice");
    if (template) {
      const holder = main;
      const results = [];
      for (const kind of ["info", "success", "warning", "error"]) {
        for (const quiet of [true, false]) {
          const clone = template.cloneNode(true);
          clone.classList.remove("notice-error", "notice-warning", "notice-info", "notice-success", "notice-quiet", "bar-left");
          clone.classList.add("notice-" + kind);
          if (quiet) clone.classList.add("notice-quiet", "bar-left");
          holder.appendChild(clone);
          const body = clone.querySelector(".notice-text, .notice-body p, p") || clone;
          const bg = bgOf(body);
          if (bg) {
            const fg = textColorOf(body, bg);
            const r = ratio(fg, bg);
            results.push({ kind: kind + (quiet ? " (quiet)" : " (tinted)"), r, fg: rgbStr(fg), bg: rgbStr(bg) });
          }
          clone.remove();
        }
      }
      for (const x of results) if (x.r < 7) found.push({ check: "notice-contrast", sel: "div.notice.notice-" + x.kind.split(" ")[0], text: x.kind, detail: "body text " + x.fg + " on " + x.bg + " is " + (Math.round(x.r * 100) / 100) + ":1, needs 7:1 (probe of all four status notices)" });
    }
  }

  return { found, facts };
}

/* ------------------------------------------------------------------------------------------ */

async function openPage(browser, url, contextOptions, theme, { sample }) {
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: "block", reducedMotion: "reduce", colorScheme: theme });
  await context.route("**/*", (route) => (route.request().url().startsWith(url) ? route.continue() : route.abort()));
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  if (sample) {
    const button = page.locator("button", { hasText: /sample data/i }).first();
    await button.click();
    await page.waitForFunction(() => /#\/overview/.test(location.hash) || /sample data/i.test(document.body.innerText) && !/Reading|Building/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  // The theme is chosen the way a person chooses it: with the header toggle. Dark is the default, so only light needs a click.
  const current = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (current !== theme) {
    const toggle = page.locator("header button[aria-pressed]").first();
    if ((await toggle.count()) > 0) await toggle.click();
    else await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  }
  await page.waitForTimeout(150);
  const applied = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (applied !== theme) throw new Error("The header toggle did not set the " + theme + " theme (data-theme is " + applied + ").");
  return { context, page };
}

const bgIsDark = (page) => page.evaluate(() => {
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(document.body).backgroundColor);
  return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 < 110 : null;
});

async function runPass(page, { theme, width, touch, routes, fresh, mode, results, facts, navIconDone }) {
  for (const route of routes) {
    await page.evaluate((h) => { location.hash = h; }, `#/${route}`);
    await page.waitForTimeout(250);
    const dark = await bgIsDark(page);
    if (dark !== null && dark !== (theme === "dark")) results.push({ route, theme, width, check: "theme-applied", sel: "body", text: "", detail: `the ${theme} theme did not apply (body background reads ${dark ? "dark" : "light"}); measurements for this state are not valid` });
    // open the phone menu when the menu is collapsed
    const menuState = await page.evaluate(() => {
      const nav = document.querySelector("#site-nav, nav");
      const btn = document.querySelector("[aria-controls='site-nav'], .menu-button");
      const navVisible = nav && nav.getBoundingClientRect().width > 1 && getComputedStyle(nav).display !== "none" && getComputedStyle(nav).visibility !== "hidden";
      const btnVisible = btn && btn.getBoundingClientRect().width > 1 && getComputedStyle(btn).display !== "none";
      return { navVisible: !!navVisible, btnVisible: !!btnVisible };
    });
    let opened = false;
    if (!menuState.navVisible && menuState.btnVisible) {
      await page.locator("[aria-controls='site-nav'], .menu-button").first().click();
      await page.waitForTimeout(150);
      opened = true;
    }
    const opts = { width, touch, route, fresh, contentChecks: CONTENT_WIDTHS.has(width), probeNotices: CONTENT_WIDTHS.has(width) && width === 1280, navIconDone: navIconDone.has(`${theme}`) };
    let res;
    try {
      res = await page.evaluate(measurePage, opts);
      // A route change in flight can be measured half-applied (the menu's current item not yet styled): look once more before reporting it.
      if (res.found.some((f) => f.check === "nav-active")) {
        await page.waitForTimeout(500);
        res = await page.evaluate(measurePage, { ...opts, navIconDone: true });
      }
    } catch (e) {
      results.push({ route, theme, width, check: "audit-error", sel: "", text: "", detail: String(e.message).split("\n")[0] });
      continue;
    }
    if (opened) {
      // the menu was only opened to measure it: close it again so the next route starts clean
      await page.locator("[aria-controls='site-nav'], .menu-button").first().click().catch(() => {});
    }
    navIconDone.add(theme);
    if (route === "settings" && !fresh) await confirmPass(page, { theme, width, touch, results });
    if (route === "guide" && !fresh) await terminalPass(page, { theme, width, touch, results });
    for (const f of res.found) results.push({ route: fresh ? `${route} (no export)` : route, theme, width, ...f });
    facts.push({ route: fresh ? `${route}*` : route, theme, width, ...res.facts });
  }
}

/** Header probes that need real interaction: dark default with no flash, the toggle, and its focus ring. */
async function themeProbes(browser, url, results) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", serviceWorkers: "block", reducedMotion: "reduce" });
  await context.route("**/*", (route) => (route.request().url().startsWith(url) ? route.continue() : route.abort()));
  await context.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") window.__atInteractive = { theme: document.documentElement.getAttribute("data-theme"), bg: document.body ? getComputedStyle(document.body).backgroundColor : null };
    });
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(200);
  const first = await page.evaluate(() => ({ theme: document.documentElement.getAttribute("data-theme"), bg: getComputedStyle(document.body).backgroundColor, early: window.__atInteractive || null }));
  const dark = (bg) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(bg || ""); return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 < 110 : null; };
  const base = { route: "start (first visit, system theme light)", theme: "light", width: 1280 };
  if (first.theme !== "dark" || dark(first.bg) !== true) results.push({ ...base, check: "dark-default", sel: "html", text: "", detail: `first visit with a light operating system shows data-theme="${first.theme}" and a ${dark(first.bg) ? "dark" : "light"} background; dark must be the default` });
  if (first.early && (first.early.theme !== "dark" || dark(first.early.bg) === false)) results.push({ ...base, check: "dark-default", sel: "html", text: "", detail: `the theme was "${first.early.theme}" with a ${dark(first.early.bg) === false ? "light" : "unknown"} background when the page became interactive: a flash of the other theme is possible; set data-theme before first paint` });
  const toggle = page.locator("header button[aria-pressed], header button[aria-label*='theme' i]").first();
  if ((await toggle.count()) === 0) {
    results.push({ ...base, check: "header-toggle", sel: "header", text: "", detail: "no theme toggle to test (no button with aria-pressed or a theme name in the header)" });
  } else {
    const read = () => page.evaluate(() => {
      const t = [...document.querySelectorAll("header button")].find((b) => b.hasAttribute("aria-pressed") || /theme/i.test(b.getAttribute("aria-label") || ""));
      return { theme: document.documentElement.getAttribute("data-theme"), name: t ? (t.getAttribute("aria-label") || t.textContent).trim() : "", pressed: t ? t.getAttribute("aria-pressed") : null };
    });
    const before = await read();
    await toggle.click();
    await page.waitForTimeout(150);
    const after = await read();
    if (before.theme === after.theme) results.push({ ...base, check: "header-toggle", sel: "header button", text: before.name, detail: `pressing it left data-theme at "${before.theme}"` });
    if (before.name === after.name) results.push({ ...base, check: "header-toggle", sel: "header button", text: before.name, detail: `the accessible name did not change after pressing (still "${after.name}")` });
    if (before.pressed !== null && before.pressed === after.pressed && before.theme !== after.theme) results.push({ ...base, check: "header-toggle", sel: "header button", text: before.name, detail: "aria-pressed did not change after pressing" });
    // the choice is shared with Settings: its control must show the same theme
    await page.evaluate(() => { location.hash = "#/settings"; });
    await page.waitForTimeout(200);
    const shared = await page.evaluate(() => {
      const chosen = document.querySelector(".segmented-theme button[aria-pressed=true]");
      return chosen ? chosen.textContent.trim() : null;
    });
    const now = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    if (shared !== null && !new RegExp(now, "i").test(shared)) results.push({ ...base, check: "header-toggle", sel: "settings theme control", text: shared, detail: `Settings shows "${shared}" selected while the header toggle made the theme "${now}": they must share one state` });
    // focus ring on the toggle, reached by keyboard
    await page.evaluate(() => { location.hash = "#/start"; });
    await page.waitForTimeout(150);
    let ring = null;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      ring = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a || !a.closest("header")) return null;
        if (!(a.hasAttribute("aria-pressed") || /theme/i.test(a.getAttribute("aria-label") || ""))) return null;
        const s = getComputedStyle(a);
        return { width: parseFloat(s.outlineWidth), style: s.outlineStyle, color: s.outlineColor, shadow: s.boxShadow };
      });
      if (ring) break;
    }
    if (!ring) results.push({ ...base, check: "header-toggle", sel: "header button", text: "", detail: "the theme toggle could not be reached with the Tab key" });
    else if (!((ring.style !== "none" && ring.width >= 2) || (ring.shadow && ring.shadow !== "none"))) results.push({ ...base, check: "header-toggle", sel: "header button", text: "", detail: `no visible focus ring on the theme toggle (outline ${ring.style} ${ring.width}px)` });
  }
  await context.close();
}

/**
 * The delete-saved-data confirmation (an in-page panel, never window.confirm): opened by its button on Settings, measured, closed
 * again. It must say what cannot be undone, name the exact action on its button, offer Cancel, put focus on Cancel (the safe
 * choice), keep both buttons at touch size and on one row or stacked without overlap, and share the content column's edges.
 */
async function confirmPass(page, { theme, width, touch, results }) {
  const start = page.locator("[data-key=delete-start]").first();
  if ((await start.count()) === 0) {
    results.push({ route: "settings", theme, width, check: "confirm-dialog", sel: "[data-key=delete-start]", text: "", detail: "the Settings page has no Delete data button to open the confirmation" });
    return;
  }
  await start.scrollIntoViewIfNeeded();
  const startLabel = (await start.innerText()).trim();
  await start.click();
  await page.waitForTimeout(200);
  const found = await page.evaluate(({ touch, startLabel }) => {
    const out = [];
    const R = (e) => e.getBoundingClientRect();
    const px = (n) => Math.round(n * 10) / 10 + "px";
    const box = document.querySelector(".confirm");
    if (!box) return [{ sel: "", detail: "pressing Delete data did not open a confirmation panel (.confirm)" }];
    const view = document.querySelector("main .view") || document.querySelector("main");
    const r = R(box);
    const vw = document.documentElement.clientWidth;
    const heading = box.querySelector("h2, h3, h4");
    const labelledBy = box.getAttribute("aria-labelledby");
    const named = labelledBy ? document.getElementById(labelledBy) : null;
    if (!heading || !named || named.textContent.trim() === "") out.push({ sel: ".confirm", detail: "the confirmation has no heading naming it (role group needs aria-labelledby pointing at its heading)" });
    if (!box.hasAttribute("role")) out.push({ sel: ".confirm", detail: "the confirmation has no role" });
    const text = box.innerText || "";
    if (!/cannot be undone/i.test(text)) out.push({ sel: ".confirm", detail: "the confirmation does not say what cannot be undone (it must say \"cannot be undone\")" });
    const buttons = [...box.querySelectorAll("button")];
    const danger = buttons.find((b) => /danger/.test(b.className));
    const cancel = buttons.find((b) => /^cancel$/i.test(b.innerText.trim()));
    if (!danger) out.push({ sel: ".confirm", detail: "no destructive button in the confirmation" });
    if (!cancel) out.push({ sel: ".confirm", detail: "no Cancel button in the confirmation" });
    if (danger && danger.innerText.trim() !== startLabel) out.push({ sel: "button", detail: 'the confirming button says "' + danger.innerText.trim() + '" but the button that opened it says "' + startLabel + '": name the exact action once' });
    if (danger && cancel) {
      const a = R(danger); const c = R(cancel);
      const overlap = Math.min(a.right, c.right) - Math.max(a.left, c.left) > 0.5 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 0.5;
      if (overlap) out.push({ sel: ".confirm .actions", detail: "the two buttons overlap" });
      if (Math.abs(a.height - c.height) > 1) out.push({ sel: ".confirm .actions", detail: "the two buttons differ in height: " + px(a.height) + " and " + px(c.height) });
      const sameRow = Math.abs(a.top - c.top) < 4;
      const stacked = Math.abs(a.left - c.left) < 4 && c.top >= a.bottom - 1;
      if (!sameRow && !stacked) out.push({ sel: ".confirm .actions", detail: "the two buttons are neither on one row nor stacked cleanly" });
      const min = touch ? 43.5 : 35.5;
      for (const b of [a, c]) if (b.height < min) out.push({ sel: "button", detail: "a confirmation button is " + px(b.height) + " tall, needs " + (touch ? 44 : 36) + " px" });
      for (const b of [danger, cancel]) { const q = R(b); if (q.right > r.right - 1 || q.left < r.left + 1) out.push({ sel: "button", detail: "a confirmation button runs past the panel edge" }); }
    }
    if (cancel && document.activeElement !== cancel) out.push({ sel: "button", detail: "focus is not on Cancel (the safe choice) after the confirmation opens; it is on " + (document.activeElement ? document.activeElement.tagName.toLowerCase() + " " + (document.activeElement.innerText || "").trim().slice(0, 20) : "nothing") });
    // On a wide screen the confirmation lives in one column of the page (a balanced two-column flow), so it shares that column's edges.
    const column = box.closest(".cols > *");
    const frame = column && document.documentElement.clientWidth >= 1280 ? column : view;
    if (frame) {
      const vr = R(frame);
      if (Math.abs(r.left - vr.left) > 2 || Math.abs(r.right - vr.right) > 2) out.push({ sel: ".confirm", detail: "the panel spans " + px(r.left) + " to " + px(r.right) + " but the content column spans " + px(vr.left) + " to " + px(vr.right) });
    }
    if (r.right > vw + 1 || r.left < -1) out.push({ sel: ".confirm", detail: "the panel runs past the window edge" });
    if (parseFloat(getComputedStyle(box).borderTopLeftRadius) < 11.5) out.push({ sel: ".confirm", detail: "the panel is not rounded like every card (radius " + getComputedStyle(box).borderTopLeftRadius + ")" });
    if (!(parseFloat(getComputedStyle(box).borderTopWidth) > 0)) out.push({ sel: ".confirm", detail: "the panel has no visible edge" });
    return out;
  }, { touch, startLabel });
  for (const x of found) results.push({ route: "settings", theme, width, check: "confirm-dialog", sel: x.sel, text: "", detail: x.detail });
  const cancel = page.locator("[data-key=delete-cancel]").first();
  if ((await cancel.count()) > 0) await cancel.click();
  await page.waitForTimeout(100);
}

/**
 * The command block and its terminal panel, on the Export guide: Run is pressed on the "help" block and the open panel is measured
 * once the exit chip shows. It must fit the page (nothing wider than the window), keep every panel button at touch size, read at
 * 4.5 to 1 on its own ground, say how the Run ended on one line, and give focus back to Run. The page must make no request but data:
 * and blob:, report no security policy violation and no console error: this is the real-browser proof that the helper starts
 * under the policy and that sealing works in it.
 */
async function terminalPass(page, { theme, width, touch, results }) {
  const block = page.locator(".command", { hasText: /Show the commands/ }).first();
  const add = (check, sel, detail) => results.push({ route: "guide", theme, width, check, sel, text: "", detail });
  if ((await block.count()) === 0) {
    add("terminal-panel", ".command", "the Export guide has no command block for the help command");
    return;
  }
  const requests = [];
  const problems = [];
  const onRequest = (r) => {
    const u = r.url();
    if (!/^(data:|blob:)/.test(u) && !u.startsWith(page.url().split("#")[0])) requests.push(u);
  };
  const onConsole = (m) => { if (m.type() === "error") problems.push("console error: " + m.text().slice(0, 120)); };
  const onPageError = (e) => problems.push("page error: " + String(e.message).slice(0, 120));
  page.on("request", onRequest);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  await page.evaluate(() => {
    window.__policy = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__policy.push(e.violatedDirective + " " + (e.blockedURI || "").slice(0, 60)));
  });
  await block.scrollIntoViewIfNeeded();
  const run = block.locator(".command-head button", { hasText: /^Run$/ });
  await run.click();
  const done = await page.waitForSelector(".command-chip", { timeout: 20000, state: "attached" }).then(() => true, () => false);
  await page.waitForTimeout(250);
  page.off("request", onRequest);
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  if (!done) {
    add("terminal-panel", ".command-panel", "pressing Run on the help command did not end in an exit chip within 20 seconds");
    return;
  }
  const policy = await page.evaluate(() => window.__policy || []);
  for (const v of policy) add("terminal-csp", "page", "the security policy blocked something while a command ran: " + v);
  for (const u of requests) add("terminal-csp", "page", "a request other than data: or blob: was made while a command ran: " + u.slice(0, 80));
  for (const p of problems) add("terminal-csp", "page", p);
  const found = await page.evaluate(({ touch }) => {
    const out = [];
    const R = (e) => e.getBoundingClientRect();
    const px = (n) => Math.round(n * 10) / 10 + "px";
    const frame = [...document.querySelectorAll(".command")].find((f) => /Show the commands/.test(f.textContent));
    const panel = frame && frame.querySelector(".command-panel");
    if (!panel || panel.childNodes.length === 0) return [{ sel: ".command-panel", detail: "the panel is empty after the command ended" }];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push({ sel: "html", detail: "the page is " + document.documentElement.scrollWidth + " px wide in a " + vw + " px window with the panel open" });
    const log = panel.querySelector(".t-log");
    if (!log) out.push({ sel: ".t-log", detail: "the output area is missing" });
    else {
      const l = R(log); const f = R(frame);
      if (l.right > f.right + 1 || l.left < f.left - 1) out.push({ sel: ".t-log", detail: "the output area runs past its frame (" + px(l.left) + " to " + px(l.right) + " in " + px(f.left) + " to " + px(f.right) + ")" });
      if (log.getAttribute("role") !== "log" || log.getAttribute("aria-live") !== "off" || !log.getAttribute("aria-label")) out.push({ sel: ".t-log", detail: "the output area needs role log, aria-live off and a name" });
      if (!(log.scrollWidth <= log.clientWidth + 1) && getComputedStyle(log).overflowX !== "auto" && getComputedStyle(log).overflowX !== "scroll") out.push({ sel: ".t-log", detail: "long output lines neither fit nor scroll sideways" });
      if (log.innerText.trim() === "") out.push({ sel: ".t-log", detail: "the output area is empty after help ran" });
      // text contrast of every run against the output ground
      const parse = (c) => { const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(c); return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const ground = parse(getComputedStyle(log).backgroundColor);
      const seen = new Set();
      for (const run of log.querySelectorAll(".t-run")) {
        const fg = parse(getComputedStyle(run).color);
        if (!fg || !ground || seen.has(run.className)) continue;
        seen.add(run.className);
        const r = ratio(fg, ground);
        if (r < 4.5) out.push({ sel: "." + run.className.split(" ").join("."), detail: "output text reads " + (Math.round(r * 100) / 100) + ":1 on the output ground; needs 4.5:1" });
      }
    }
    const chips = [...panel.querySelectorAll(".command-chip")];
    if (chips.length !== 1) out.push({ sel: ".command-chip", detail: "expected one exit chip, found " + chips.length });
    for (const chip of chips) {
      const c = R(chip);
      const lineHeight = parseFloat(getComputedStyle(chip).lineHeight) || 20;
      if (c.height > lineHeight * 2 + 4) out.push({ sel: ".command-chip", detail: "the exit chip takes more than one line (" + px(c.height) + " tall, line height " + px(lineHeight) + ")" });
      if (!chip.querySelector("svg") || chip.querySelector(".command-chip-label").textContent.trim() === "") out.push({ sel: ".command-chip", detail: "the exit chip needs an icon and words, never color alone" });
      if (c.right > R(frame).right + 1) out.push({ sel: ".command-chip", detail: "the exit chip runs past the frame" });
    }
    const min = touch ? 43.5 : 35.5;
    for (const b of panel.querySelectorAll("button")) {
      const r = R(b);
      if (r.height < min) out.push({ sel: "button", detail: "the panel button " + JSON.stringify(b.innerText.trim()) + " is " + px(r.height) + " tall, needs " + (touch ? 44 : 36) + " px" });
      if (r.right > vw + 1 || r.left < -1) out.push({ sel: "button", detail: "the panel button " + JSON.stringify(b.innerText.trim()) + " is off the window" });
    }
    const labels = [...panel.querySelectorAll("button")].map((b) => b.innerText.trim());
    if (labels.join("|") !== "Copy output|Close") out.push({ sel: ".command-toolbar", detail: "the finished panel offers " + JSON.stringify(labels) + ', expected "Copy output" and "Close"' });
    const run = frame.querySelector(".command-head button:last-child");
    if (run && document.activeElement !== run) out.push({ sel: "button", detail: "focus did not return to the Run button when the command ended (it is on " + (document.activeElement ? document.activeElement.tagName.toLowerCase() + " " + (document.activeElement.innerText || "").trim().slice(0, 20) : "nothing") + ")" });
    return out;
  }, { touch });
  for (const x of found) add("terminal-panel", x.sel, x.detail);
  // put the page back as it was
  const close = block.locator(".command-panel button", { hasText: /^Close$/ });
  if ((await close.count()) > 0) await close.click();
  await page.waitForTimeout(100);
}

/**
 * A returning visitor who chose the light theme (or "match device") must not see a dark frame first. The page's head script reads the one
 * saved word before the first paint; this opens a page with each word already saved and checks the theme at the moment the page becomes
 * interactive, and that the content-security policy blocked nothing.
 */
async function bootProbes(browser, url, results) {
  const cases = [
    { saved: "light", scheme: "dark", expectTheme: "light", expectDark: false },
    { saved: "dark", scheme: "light", expectTheme: "dark", expectDark: true },
    { saved: "system", scheme: "light", expectTheme: null, expectDark: false },
    { saved: "system", scheme: "dark", expectTheme: null, expectDark: true },
  ];
  for (const c of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: c.scheme, serviceWorkers: "block", reducedMotion: "reduce" });
    await context.route("**/*", (route) => (route.request().url().startsWith(url) ? route.continue() : route.abort()));
    await context.addInitScript((saved) => {
      try { localStorage.setItem("snappy-theme", saved); } catch (e) { /* storage blocked */ }
      window.__violations = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__violations.push(e.violatedDirective + " " + (e.blockedURI || "")));
      document.addEventListener("readystatechange", () => {
        if (document.readyState === "interactive") window.__early = { theme: document.documentElement.getAttribute("data-theme"), bg: document.body ? getComputedStyle(document.body).backgroundColor : null };
      });
    }, c.saved);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(150);
    const got = await page.evaluate(() => ({ theme: document.documentElement.getAttribute("data-theme"), bg: getComputedStyle(document.body).backgroundColor, early: window.__early || null, violations: window.__violations || [] }));
    const isDark = (bg) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(bg || ""); return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 < 110 : null; };
    const base = { route: "start (returning visitor, saved theme " + c.saved + ", system " + c.scheme + ")", theme: c.expectDark ? "dark" : "light", width: 1280 };
    const early = got.early;
    if (early && (early.theme !== c.expectTheme || isDark(early.bg) !== c.expectDark)) results.push({ ...base, check: "theme-boot", sel: "html", text: "", detail: 'when the page became interactive data-theme was "' + early.theme + '" with a ' + (isDark(early.bg) ? "dark" : "light") + " background; a returning visitor with the saved choice should see the " + (c.expectDark ? "dark" : "light") + " theme from the first frame" });
    if (got.theme !== c.expectTheme || isDark(got.bg) !== c.expectDark) results.push({ ...base, check: "theme-boot", sel: "html", text: "", detail: 'after load data-theme is "' + got.theme + '" with a ' + (isDark(got.bg) ? "dark" : "light") + " background; expected the " + (c.expectDark ? "dark" : "light") + " theme" });
    if (got.violations.length) results.push({ ...base, check: "theme-boot", sel: "html", text: "", detail: "the content-security policy blocked something: " + got.violations.slice(0, 3).join("; ") });
    await context.close();
  }
}

function report(results, facts, opts, elapsed) {
  const lines = [];
  const real = results.filter((r) => !INFO_CHECKS.has(r.check));
  lines.push(`Snappy layout audit: ${results.length} findings (${real.length} violations, ${results.length - real.length} info) in ${(elapsed / 1000).toFixed(1)} s`);
  lines.push(`Routes: ${opts.routes.join(", ")}${opts.fresh ? " (and the empty states)" : ""}. Themes: ${opts.themes.join(", ")}. Widths: ${opts.widths.join(", ")}.`);
  lines.push("");
  const byCheck = new Map();
  for (const r of results) (byCheck.get(r.check) || byCheck.set(r.check, []).get(r.check)).push(r);
  lines.push("Summary by check");
  for (const [check, list] of [...byCheck].sort((a, b) => b[1].length - a[1].length)) lines.push(`  ${String(list.length).padStart(5)}  ${check}${INFO_CHECKS.has(check) ? " (info)" : ""}`);
  lines.push("");
  // collapse the same finding seen at several widths or in both themes into one line
  const collapsed = new Map();
  for (const r of results) {
    const key = [r.check, r.route, r.sel, r.text, r.detail.replace(/[\d.]+/g, "#")].join("");
    const entry = collapsed.get(key) || { ...r, seen: [] };
    if (!entry.seen.includes(`${r.theme} ${r.width}`)) entry.seen.push(`${r.theme} ${r.width}`);
    collapsed.set(key, entry);
  }
  lines.push("Findings (route | theme and width | element | measured). Identical findings at other widths or themes are listed on one line.");
  for (const [check, list] of [...byCheck].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push("");
    lines.push(`== ${check} (${list.length})${INFO_CHECKS.has(check) ? " [info]" : ""}`);
    for (const e of [...collapsed.values()].filter((c) => c.check === check)) {
      const where = e.seen.length > 3 ? `${e.seen.length} states: ${e.seen.slice(0, 3).join(", ")} ...` : e.seen.join(", ");
      lines.push(`  ${e.route} | ${where} | ${e.sel}${e.text ? ` "${e.text}"` : ""} | ${e.detail}`);
    }
  }
  // cross-route consistency and layout summary
  const extra = [];
  for (const theme of opts.themes) for (const width of opts.widths) {
    const here = facts.filter((f) => f.theme === theme && f.width === width && !f.route.endsWith("*"));
    for (const kind of ["heading", "section", "card", "header"]) {
      const all = here.flatMap((f) => (f.gaps[kind] || []).map((g) => ({ route: f.route, g })));
      if (all.length < 3) continue;
      const freq = new Map();
      for (const x of all) freq.set(x.g, (freq.get(x.g) || 0) + 1);
      const mode = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const bad = [...new Set(all.filter((x) => Math.abs(x.g - mode) > 1.01).map((x) => `${x.route} ${x.g}px`))];
      if (bad.length && theme === opts.themes[0]) extra.push({ route: "(all routes)", theme, width, check: "gap-inconsistent", sel: "", text: "", detail: `${kind} gap is ${mode}px on most routes but differs on: ${bad.slice(0, 8).join(", ")}` });
    }
    const fields = here.flatMap((f) => f.fieldWidths.map((x) => ({ ...x, route: f.route }))).filter((x) => /^(text|password|search|email|url)$/.test(x.type) && !/narrow|small|numeric/.test(x.sel + x.mode));
    if (fields.length > 1 && theme === opts.themes[0]) {
      const ws = [...new Set(fields.map((x) => Math.round(x.w)))];
      if (Math.max(...ws) - Math.min(...ws) > 2) extra.push({ route: "(all routes)", theme, width, check: "field-width", sel: "", text: "", detail: `text inputs use different widths: ${fields.map((x) => `${x.route} ${x.sel} ${Math.round(x.w)}px`).slice(0, 8).join("; ")}` });
    }
    const hs = here.map((f) => f.header && f.header.height).filter(Boolean);
    if (hs.length && theme === opts.themes[0]) facts.__header = (facts.__header || []).concat([[width, Math.min(...hs), Math.max(...hs)]]);
  }
  const headerRows = facts.__header || [];
  if (headerRows.length > 1) {
    const all = headerRows.flatMap((r) => [r[1], r[2]]);
    if (Math.max(...all) - Math.min(...all) > 8) extra.push({ route: "(all routes)", theme: opts.themes[0], width: 0, check: "header-row", sel: "header", text: "", detail: `header height varies from ${Math.min(...all)}px to ${Math.max(...all)}px across widths (${headerRows.map((r) => `${r[0]}: ${r[1]}`).join(", ")}); keep one compact row of consistent height` });
  }
  if (extra.length) {
    lines.push("");
    lines.push(`== cross-route consistency (${extra.length})`);
    for (const e of extra) lines.push(`  ${e.route} | ${e.theme} ${e.width} | ${e.check} | ${e.detail}`);
    for (const e of extra) results.push(e);
  }
  const unusedRows = facts.filter((f) => f.unused && f.theme === opts.themes[0]).sort((a, b) => a.route.localeCompare(b.route) || a.width - b.width);
  if (unusedRows.length) {
    lines.push("");
    lines.push("== layout-summary [info]: horizontal space unused beside the widest block (share of the content area, left / right)");
    for (const f of unusedRows) lines.push(`  ${f.route.padEnd(14)} ${String(f.width).padStart(5)}px  ${Math.round(f.unused.left * 100)}% / ${Math.round(f.unused.right * 100)}%  widest ${f.unused.widest} ${Math.round(f.unused.widestW)}px in ${Math.round(f.unused.contentW)}px${f.unused.left > 0.25 || f.unused.right > 0.25 ? "  <-- FLAG" : ""}`);
  }
  const font = facts.find((f) => f.fonts && f.fonts.family);
  if (font) lines.push("", `Numerals: stat values use ${font.fonts.family.split(",")[0]}, font-feature-settings ${font.fonts.features}, font-variant-numeric ${font.fonts.numeric}`);
  const tileFacts = facts.filter((f) => f.tiles);
  if (tileFacts.length) lines.push("", `Tiles measured: ${tileFacts.reduce((n, f) => n + f.tiles.tiles, 0)} tiles in ${tileFacts.reduce((n, f) => n + f.tiles.rows, 0)} rows, across ${tileFacts.length} page states.`);
  const failing = results.filter((r) => !INFO_CHECKS.has(r.check)).length;
  lines.push("", failing ? `FAIL: ${failing} violations` : "PASS: no violations");
  return { text: lines.join("\n") + "\n", failing };
}

async function main() {
  const t0 = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  if (opts.build) {
    const built = spawnSync(process.execPath, [path.join(root, "apps", "dashboard", "build.mjs")], { cwd: path.join(root, "apps", "dashboard"), stdio: "inherit" });
    if (built.status !== 0) throw new Error("The dashboard build failed.");
  }
  const distFile = path.join(root, "apps", "dashboard", "dist", "index.html");
  if (!existsSync(distFile)) throw new Error("The dashboard is not built. Run: npm run build:dashboard");
  const { chromium } = loadPlaywright();
  const results = [];
  const facts = [];
  const distTime = statSync(distFile).mtimeMs;
  const srcTime = Math.max(newestMtime(path.join(root, "apps", "dashboard", "src")), newestMtime(path.join(root, "brand", "tokens")), newestMtime(path.join(root, "brand", "icons")), newestMtime(path.join(root, "packages", "core", "src")));
  if (srcTime > distTime + 1000) results.push({ route: "(build)", theme: "-", width: 0, check: "stale-name", sel: "apps/dashboard/dist/index.html", text: "", detail: `the built page is older than its sources by ${Math.round((srcTime - distTime) / 1000)} s; run npm run build:dashboard before auditing (this audit measures the stale page)` });

  let server;
  if (!(await portOpen(opts.port))) {
    server = spawn(process.execPath, [path.join(root, "apps", "dashboard", "serve.mjs"), "--port", String(opts.port)], { stdio: "ignore" });
    for (let i = 0; i < 25 && !(await portOpen(opts.port)); i++) await sleep(200);
  }
  const url = `http://127.0.0.1:${opts.port}/`;
  const browser = await chromium.launch();
  try {
    await themeProbes(browser, url, results);
    await bootProbes(browser, url, results);
    for (const theme of opts.themes) {
      const navIconDone = new Set();
      const kinds = [
        { touch: true, widths: opts.widths.filter((w) => w <= TOUCH_MAX), ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
        { touch: false, widths: opts.widths.filter((w) => w > TOUCH_MAX), ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
      ];
      for (const k of kinds) {
        if (k.widths.length === 0) continue;
        const { context, page } = await openPage(browser, url, k.ctx, theme, { sample: true });
        for (const width of k.widths) {
          await page.setViewportSize({ width, height: k.touch ? 844 : 800 });
          await page.waitForTimeout(150);
          await runPass(page, { theme, width, touch: k.touch, routes: opts.routes, fresh: false, mode: "sample", results, facts, navIconDone });
        }
        await context.close();
        if (opts.fresh) {
          const fw = k.widths.filter((w) => w === 390 || w === 1280 || w === 1600 || w === 1920 || w === 2560 || (k.touch ? false : w === k.widths[0]));
          if (fw.length) {
            const f = await openPage(browser, url, k.ctx, theme, { sample: false });
            for (const width of fw) {
              await f.page.setViewportSize({ width, height: k.touch ? 844 : 800 });
              await f.page.waitForTimeout(150);
              await runPass(f.page, { theme, width, touch: k.touch, routes: opts.routes, fresh: true, mode: "fresh", results, facts, navIconDone });
            }
            await f.context.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
    server?.kill();
  }
  const { text, failing } = report(results, facts, opts, Date.now() - t0);
  if (opts.out) writeFileSync(opts.out, text);
  if (opts.quiet) console.log(text.split("\n== ")[0]);
  else process.stdout.write(text);
  process.exit(failing ? 1 : 0);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(2); });
