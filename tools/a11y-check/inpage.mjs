/**
 * The checks that run inside the page. Both functions are passed to Playwright's page.evaluate, which sends their
 * source text to the browser, so each one is self-contained: it may use nothing from this file or from Node.
 *
 *   auditInPage(options)   structure and measurements of the page as drawn: unnamed controls, positive tabindex,
 *                          text contrast, target size, the number of h1 elements and the document title
 *   describeFocus()        what the browser shows for the element that has keyboard focus right now
 *
 * The thresholds are the ones the project states (docs/BRAND.md): text at 4.5:1 (3:1 for large text), a focus
 * ring at 3:1, touch targets of 44 px.
 */

/**
 * @param {{ touch: boolean, minTarget: number }} options  `touch` turns on the target-size check (a phone width).
 * @returns {{ found: { check: string, sel: string, text: string, detail: string }[], facts: { h1: number, title: string } }}
 */
export function auditInPage(options) {
  const { touch, minTarget } = options;
  const found = [];
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const cs = (el) => getComputedStyle(el);

  /* ---- what is visible at all ---- */
  const hiddenByDetails = (el) => {
    const d = el.closest("details");
    return Boolean(d && !d.open && !el.closest("summary"));
  };
  const visible = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const s = cs(e);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") return false;
      if (e.getAttribute("aria-hidden") === "true" && e === el) return false;
    }
    if (hiddenByDetails(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1.5 && r.height > 1.5;
  };
  /** Text kept for screen readers only (clipped to a point) is not on screen. */
  const srOnly = (el) => {
    const r = el.getBoundingClientRect();
    return r.width <= 1.5 || r.height <= 1.5;
  };

  /* ---- naming things for the report ---- */
  const selOf = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length > 0) s += "." + cls.join(".");
    if (el.tagName === "A" && el.getAttribute("href")) s += '[href="' + el.getAttribute("href") + '"]';
    return s;
  };
  const textOf = (el) => norm(el.innerText || el.textContent || el.getAttribute("aria-label") || "").slice(0, 40);
  // Repeated rows (one per person) would flood the report: keep two of a kind and say there are more.
  const kinds = new Map();
  const add = (check, el, detail) => {
    const sel = selOf(el);
    const key = check + "|" + sel.replace(/\[href=.*?\]/, "") + "|" + detail.replace(/[\d.]+/g, "#").slice(0, 60);
    const n = (kinds.get(key) || 0) + 1;
    kinds.set(key, n);
    if (n <= 2) found.push({ check, sel, text: textOf(el), detail });
    else if (n === 3) found.push({ check, sel, text: "", detail: "more elements of the same kind have this problem on this page" });
  };

  /* ---- 1. controls need a name ---- */
  const contentName = (el) => {
    let out = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        if (n.getAttribute("aria-hidden") === "true" || cs(n).display === "none") continue;
        if (n.tagName === "IMG") out += " " + (n.getAttribute("alt") || "");
        else if (n.namespaceURI === "http://www.w3.org/2000/svg") {
          const label = n.getAttribute("aria-label");
          const title = n.querySelector && n.querySelector("title");
          out += " " + (label || (title ? title.textContent : "") || "");
        } else out += " " + (n.getAttribute("aria-label") || contentName(n));
      }
    }
    return norm(out);
  };
  const nameOf = (el) => {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = norm(by.split(/\s+/).map((id) => (document.getElementById(id) ? document.getElementById(id).textContent : "")).join(" "));
      if (t) return t;
    }
    const label = el.getAttribute("aria-label");
    if (label && label.trim()) return label.trim();
    if (el.labels && el.labels.length > 0) {
      const t = norm([...el.labels].map((l) => l.textContent).join(" "));
      if (t) return t;
    }
    if (el.tagName === "INPUT" && ["button", "submit", "reset"].includes(el.type) && el.value.trim()) return el.value.trim();
    if (el.tagName === "INPUT" && el.type === "image" && (el.getAttribute("alt") || "").trim()) return el.getAttribute("alt").trim();
    const content = contentName(el);
    if (content) return content;
    const title = el.getAttribute("title");
    return title && title.trim() ? title.trim() : "";
  };

  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="combobox"], [role="textbox"], [tabindex]:not([tabindex="-1"])';
  const controls = [...document.querySelectorAll(INTERACTIVE)];
  for (const el of controls) {
    // A check box inside a switch may be drawn invisibly while its label is the control: judge the label then.
    const box = el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
    if (!visible(el) && !(box && el.labels && el.labels.length > 0)) continue;
    if (nameOf(el) === "") add("unnamed-control", el, "no accessible name (no text, aria-label, label or title)");
  }

  /* ---- 2. positive tabindex ---- */
  for (const el of document.querySelectorAll("[tabindex]")) {
    const n = Number(el.getAttribute("tabindex"));
    if (Number.isFinite(n) && n > 0) add("positive-tabindex", el, "tabindex=" + n + " changes the tab order");
  }

  /* ---- 3. text contrast (4.5:1, large text 3:1) ---- */
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const g2 = canvas.getContext("2d", { willReadFrequently: true });
  const colorCache = new Map();
  const rgba = (str) => {
    if (colorCache.has(str)) return colorCache.get(str);
    g2.clearRect(0, 0, 1, 1);
    g2.fillStyle = "#000";
    g2.fillStyle = str;
    g2.fillRect(0, 0, 1, 1);
    const d = g2.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    const c = a > 0 ? [Math.round(d[0] / a), Math.round(d[1] / a), Math.round(d[2] / a), a] : [0, 0, 0, 0];
    colorCache.set(str, c);
    return c;
  };
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat([1]);
  const lum = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  /** The color an element sits on, layered through its ancestors. Null when a gradient or picture is behind it. */
  const backgroundOf = (el) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.push(e);
    let base = [255, 255, 255, 1];
    for (const e of chain.reverse()) {
      const s = cs(e);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) base = c[3] < 1 ? over(c, base) : c;
    }
    return base;
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= parseFloat(cs(e).opacity);
    return o;
  };

  const textEls = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.trim() && n.parentElement && !n.parentElement.closest("svg, script, style, noscript") ? 1 : 2),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textEls.add(n.parentElement);
  for (const el of textEls) {
    if (!visible(el) || srOnly(el)) continue;
    if (el.closest("[disabled], [aria-disabled='true']") && el.closest("button, input, select, textarea")) continue; // disabled controls are exempt
    const s = cs(el);
    const bg = backgroundOf(el);
    if (bg === null) continue;
    const c = rgba(s.color);
    const fg = over([c[0], c[1], c[2], c[3] * opacityOf(el)], bg);
    const size = parseFloat(s.fontSize);
    const bold = parseInt(s.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    if (r < need - 0.005) add("text-contrast", el, r.toFixed(2) + ":1 is under " + need + ":1 (" + size.toFixed(0) + "px)");
  }

  /* ---- 4. target size on touch widths ---- */
  if (touch) {
    const insideText = (el) => {
      // A link that sits in a sentence is exempt (WCAG 2.5.8), as long as it is drawn inline with words around it.
      if (el.tagName !== "A" || cs(el).display !== "inline") return false;
      const parent = el.parentElement;
      return Boolean(parent) && norm(parent.textContent).length > norm(el.textContent).length + 3;
    };
    for (const el of controls) {
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      let target = el;
      const box = el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
      const r0 = el.getBoundingClientRect();
      if (box && (r0.width <= 1.5 || r0.height <= 1.5 || cs(el).opacity === "0") && el.labels && el.labels.length > 0) target = el.labels[0];
      // A check box inside (or named by) a label is pressed through the label: the larger of the two is the target.
      else if (box && el.labels && el.labels.length > 0) {
        const l = el.labels[0].getBoundingClientRect();
        if (l.width * l.height > r0.width * r0.height) target = el.labels[0];
      }
      if (!visible(target) || insideText(target) || target.closest(".skip-link")) continue;
      const r = target.getBoundingClientRect();
      if (r.width < minTarget - 0.5 || r.height < minTarget - 0.5) add("small-target", target, r.width.toFixed(0) + " by " + r.height.toFixed(0) + " px, under " + minTarget);
    }
  }

  /* ---- 5. one h1 and a title ---- */
  const h1 = [...document.querySelectorAll("h1")].filter((h) => visible(h)).length;
  if (h1 !== 1) found.push({ check: "h1-count", sel: "h1", text: "", detail: h1 + " visible h1 elements (there must be exactly one)" });
  const title = document.title.trim();
  if (title === "") found.push({ check: "missing-title", sel: "title", text: "", detail: "the document has no title" });

  return { found, facts: { h1, title } };
}

/**
 * What the browser shows for the focused element: its outline and shadow, and whether the outline is at least 3:1 against what it sits on.
 * @returns {{ none: boolean, key: string, sel: string, text: string, seen: boolean, ring: boolean, detail: string }}
 */
export function describeFocus() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { none: true, key: "", sel: "", text: "", seen: false, ring: true, detail: "" };
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  let sel = el.tagName.toLowerCase();
  if (el.id) sel += "#" + el.id;
  const cls = [...el.classList].slice(0, 2);
  if (cls.length > 0) sel += "." + cls.join(".");
  if (el.tagName === "A" && el.getAttribute("href")) sel += '[href="' + el.getAttribute("href") + '"]';
  const text = norm(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").slice(0, 40);
  window.__a11ySeen = window.__a11ySeen || new WeakSet();
  const seen = window.__a11ySeen.has(el);
  window.__a11ySeen.add(el);

  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const g2 = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (str) => {
    g2.clearRect(0, 0, 1, 1);
    g2.fillStyle = "#000";
    g2.fillStyle = str;
    g2.fillRect(0, 0, 1, 1);
    const d = g2.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    return a > 0 ? [Math.round(d[0] / a), Math.round(d[1] / a), Math.round(d[2] / a), a] : [0, 0, 0, 0];
  };
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat([1]);
  const lum = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const surface = () => {
    const chain = [];
    for (let e = el.parentElement; e; e = e.parentElement) chain.push(e);
    let base = [255, 255, 255, 1];
    for (const e of chain.reverse()) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) base = c[3] < 1 ? over(c, base) : c;
    }
    return base;
  };

  const outlineWidth = parseFloat(s.outlineWidth) || 0;
  const outline = s.outlineStyle !== "none" && outlineWidth >= 1 && rgba(s.outlineColor)[3] > 0;
  const shadow = s.boxShadow && s.boxShadow !== "none";
  let ring = true;
  let detail = "";
  if (r.width <= 1.5 || r.height <= 1.5) {
    ring = false;
    detail = "the focused element has no size on screen (focus is invisible)";
  } else if (!outline && !shadow) {
    ring = false;
    detail = "no outline and no shadow while focused";
  } else if (outline && !shadow) {
    const under = surface();
    const c = over(rgba(s.outlineColor), under);
    const q = ratio(c, under);
    if (q < 3 - 0.005 || outlineWidth < 2) {
      ring = false;
      detail = "focus outline " + outlineWidth.toFixed(0) + "px at " + q.toFixed(2) + ":1 (needs 2px and 3:1)";
    }
  }
  return { none: false, key: sel + "|" + text, sel, text, seen, ring, detail };
}
