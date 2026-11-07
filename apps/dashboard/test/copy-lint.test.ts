/**
 * Permanent copy lint for the dashboard. It scans the REAL copy module (every string reachable from
 * copy.ts, functions called with sample values), the text the views actually render (in the small
 * fake DOM used by view-rendering.test.ts, with the synthetic sample data), the string literals in
 * the views, and the built page. Each failure names the string.
 *
 * What it checks (the owner's list):
 *   capitalization        sentence case: no Title Case menu items, headings or buttons, no stray capitals
 *   grammar, punctuation  double spaces, space before punctuation, no space after punctuation, repeated
 *                         words, "etc.", lowercase after a full stop, missing final period on full sentences
 *   typographic quotes    curly quotes and apostrophes in prose, never a mix of straight and curly
 *   American English      colour, centre, organise, behaviour, -ise endings, whilst, learnt, and so on
 *   whitespace            leading, trailing and doubled spaces, tabs, line breaks, odd space characters
 *   maximum lengths       menu labels, button labels, headings, notes (words and sentences), stat labels
 *   one-line menu labels  length here; the layout audit measures the real rendered line count
 *   repeats               no sentence of more than 8 words twice on one rendered view, no near-duplicate notes
 *   notices               no leading visible "Note." or "Warning." label; no developer codes outside a
 *                         collapsed Details area; notice text stays in the normal text color
 *   stale names           the command is snappy-export everywhere, and the built page is not stale
 *
 * Deliberately NOT checked: the words ghost, friend and unfriended (owner decision), so the existing
 * brand-voice rules in copy.test.ts stay exactly as they are.
 *
 * The limits sit in LIMITS and the allow-lists in PROPER_WORDS, ACRONYMS and CODE_PATHS, so they are
 * easy to tune and short enough to review. The CLI has its own copy of these rules in
 * apps/cli/test/copy-lint.test.ts.
 */
import { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import * as copy from "../src/copy.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { buildSampleWorkspace } from "../src/sample.ts";
import { createStore } from "../src/store.ts";
import type { View } from "../src/views/context.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, FakeText, installFakeDom } from "./fake-dom.ts";
import type { FakeNode } from "./fake-dom.ts";

// The license texts come from a virtual module the build provides.
vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(here, "..");
const srcDir = path.join(dashboardRoot, "src");

import {
  ACRONYMS, LIMITS, RULES, TITLE_MAY_DIFFER, ancestors, clip, collectCopy, hasClass, lint, partsOf, renderedKind, sentences, strayCapitals, textBlocks, textOf, useNames, words,
  americanProblems, punctuationProblems, quoteProblems, whitespaceProblems, capitalizationProblems, lengthProblems,
} from "./copy-rules.ts";
import type { Entry, Kind } from "./copy-rules.ts";


const copyEntries = collectCopy(copy);
/** Names of buttons and pages that sentences may quote with their capital letter ("Use Copy list", "on the Start page"). */
const NAMED: string[] = copyEntries
  .filter((e) => e.kind === "button" || e.kind === "menu" || e.kind === "title")
  .map((e) => e.text)
  .sort((a, b) => b.length - a.length);
useNames(NAMED);

/* ------------------------------------------------------------------------------------------ */
/* Rendering the views in the fake DOM                                                         */
/* ------------------------------------------------------------------------------------------ */

const views: Record<string, View> = {};
let sampleState: State;
let emptyState: State;
let sampleCodes: string[] = [];
const ALL_VIEWS = ["start", "overview", "disappeared", "requests", "quiet", "cleanup", "memories", "guide", "privacy", "settings"] as const;

beforeAll(async () => {
  installFakeDom();
  const sample = await buildSampleWorkspace();
  sampleCodes = sample.issues.map((i) => i.code);
  sampleState = { ...initialState(), sample };
  emptyState = initialState();
  const load = async <T>(file: string): Promise<T> => (await import(`../src/views/${file}.ts`)) as T;
  const [ov, fi, cl, me, gu, pr, se, st] = await Promise.all([
    load<{ overviewView: View }>("overview"),
    load<{ disappearedView: View; requestsView: View; quietView: View }>("findings"),
    load<{ cleanupView: View }>("cleanup"),
    load<{ memoriesView: View }>("memories"),
    load<{ guideView: View }>("guide"),
    load<{ privacyView: View }>("privacy"),
    load<{ settingsView: View }>("settings"),
    load<{ startView: View }>("start"),
  ]);
  Object.assign(views, {
    overview: ov.overviewView,
    disappeared: fi.disappearedView,
    requests: fi.requestsView,
    quiet: fi.quietView,
    cleanup: cl.cleanupView,
    memories: me.memoriesView,
    guide: gu.guideView,
    privacy: pr.privacyView,
    settings: se.settingsView,
    start: st.startView,
  });
  // Building the sample workspace does real PBKDF2 and zip work, so under a loaded full run it can pass the default 10 s hook limit.
}, 120_000);

function render(name: string, state: State): FakeElement {
  const view = views[name];
  if (!view) throw new Error(`no view ${name}`);
  const store = createStore(state);
  return runInScope(new Scope(true), () => view({ store, actions: {} as Actions, terminal: testTerminal() })) as unknown as FakeElement;
}


interface RenderedView {
  name: string;
  state: "sample" | "empty";
  root: FakeElement;
  entries: Entry[];
}

function renderAll(): RenderedView[] {
  const out: RenderedView[] = [];
  for (const [state, label] of [[sampleState, "sample"], [emptyState, "empty"]] as const) {
    for (const name of ALL_VIEWS) {
      const root = render(name, state);
      const entries: Entry[] = [];
      for (const el of textBlocks(root)) {
        const text = textOf(el);
        if (text === "" || /^\d[\d,.%]*$/.test(text)) continue;
        const userText = el.descendants().some((d) => hasClass(d, "username") || d.tagName === "code");
        const parts = partsOf(el);
        entries.push({ id: `${name} (${label}): ${renderedKind(el)} <${el.tagName}${el.className ? `.${el.className.split(" ")[0]}` : ""}>`, text, kind: userText ? "code" : renderedKind(el), parts });
      }
      for (const el of root.descendants()) for (const attr of ["aria-label", "title"]) {
        const v = el.getAttribute(attr);
        if (v) entries.push({ id: `${name} (${label}): ${attr} of <${el.tagName}>`, text: v, kind: "aria" });
      }
      out.push({ name, state: label, root, entries });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Tests on the copy module                                                                    */
/* ------------------------------------------------------------------------------------------ */

describe("copy module: the real strings", () => {
  it("has strings of every kind to check", () => {
    expect(copyEntries.length).toBeGreaterThan(250);
    for (const kind of ["menu", "title", "heading", "button", "note", "text", "label"] as const) expect(copyEntries.filter((e) => e.kind === kind).length, kind).toBeGreaterThan(2);
  });

  for (const rule of RULES) {
    it(`${rule[0]}: every string passes`, () => {
      expect(lint(copyEntries, rule)).toEqual([]);
    });
  }

  it("keeps menu labels short and page titles consistent with them", () => {
    const bad: string[] = [];
    for (const [id, route] of Object.entries(copy.routes)) {
      if (route.label.length > LIMITS.menuChars) bad.push(`routes.${id}.label: "${route.label}" is ${route.label.length} characters, the limit is ${LIMITS.menuChars}`);
      if (!TITLE_MAY_DIFFER.has(id) && route.title !== route.label) bad.push(`routes.${id}: title "${route.title}" differs from menu label "${route.label}"`);
    }
    expect(bad).toEqual([]);
  });

  it("writes buttons as a verb plus a short noun, never a sentence", () => {
    expect(lint(copyEntries.filter((e) => e.kind === "button"), RULES[5] as (typeof RULES)[number])).toEqual([]);
  });

  it("names the theme toggle by what pressing it does", () => {
    const all = copyEntries.map((e) => e.text);
    expect(all, "a string for the light switch").toContain("Switch to light theme");
    expect(all, "a string for the dark switch").toContain("Switch to dark theme");
  });

  it("does not show the old session badge text in the shell strings that name the header", () => {
    // The badge moves to the Start session card and Settings; the header strings must not carry it any more.
    const shellStrings = copyEntries.filter((e) => e.id.startsWith("shell.")).map((e) => `${e.id}: ${e.text}`);
    expect(shellStrings.filter((s) => /Session only: nothing is saved/.test(s))).toEqual([]);
  });

  it("writes stat labels that fit one line", () => {
    const rendered = renderAll();
    const bad: string[] = [];
    for (const v of rendered) for (const el of v.root.descendants()) {
      if (!hasClass(el, "stat-label") && !(el.tagName === "dt" && ancestors(el).some((a) => hasClass(a, "stats")))) continue;
      const t = textOf(el);
      if (t.length > LIMITS.statLabelChars) bad.push(`${v.name} (${v.state}): stat label "${t}" is ${t.length} characters, the limit is ${LIMITS.statLabelChars}`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Tests on what the views render                                                              */
/* ------------------------------------------------------------------------------------------ */

describe("rendered views: the words people actually see", () => {
  let rendered: RenderedView[] = [];
  beforeAll(() => {
    rendered = renderAll();
  });

  it("renders text for every view in both states", () => {
    expect(rendered.length).toBe(ALL_VIEWS.length * 2);
    for (const v of rendered) expect(v.entries.length, `${v.name} (${v.state})`).toBeGreaterThan(2);
  });

  for (const rule of RULES) {
    it(`${rule[0]}: every rendered string passes (including notices that come from core)`, () => {
      const all = new Map<string, Entry>();
      for (const v of rendered) for (const e of v.entries) all.set(`${e.kind}|${e.text}`, e);
      expect(lint([...all.values()], rule)).toEqual([]);
    });
  }

  it("shows no sentence of more than 8 words twice on one rendered view", () => {
    const bad: string[] = [];
    for (const v of rendered) {
      const seen = new Map<string, number>();
      for (const el of textBlocks(v.root)) {
        if (ancestors(el).some((a) => hasClass(a, "candidate") || hasClass(a, "rows"))) continue; // one row per person repeats its template on purpose
        for (const s of sentences(textOf(el))) {
          const n = s.toLowerCase().replace(/[.?!]+$/, "");
          if (words(n).length > 8) seen.set(n, (seen.get(n) ?? 0) + 1);
        }
      }
      for (const [s, n] of seen) if (n > 1) bad.push(`${v.name} (${v.state}): "${clip(s)}" appears ${n} times`);
    }
    expect(bad).toEqual([]);
  });

  it("shows no two notes that repeat the same information on one view", () => {
    const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "it", "this", "that", "for", "on", "with", "you", "your", "snappy", "not", "no", "be", "can", "may", "as"]);
    const bag = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== "" && !STOP.has(w)));
    const bad: string[] = [];
    for (const v of rendered) {
      const notes = v.root.descendants().filter((el) => hasClass(el, "notice") || hasClass(el, "banner") || el.getAttribute("role") === "note").map(textOf);
      for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
        const a = bag(notes[i] ?? "");
        const b = bag(notes[j] ?? "");
        if (a.size < 4 || b.size < 4) continue;
        const shared = [...a].filter((w) => b.has(w)).length;
        if (shared / (a.size + b.size - shared) >= 0.6) bad.push(`${v.name} (${v.state}): "${clip(notes[i] ?? "")}" and "${clip(notes[j] ?? "")}" repeat each other`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("starts no notice with a visible Note. or Warning. label (the icon says it; a screen-reader label is fine)", () => {
    const bad: string[] = [];
    for (const v of rendered) {
      for (const n of v.root.descendants().filter((el) => hasClass(el, "notice"))) {
        for (const el of n.descendants()) {
          if (ancestors(el).some((a) => hasClass(a, "sr-only")) || hasClass(el, "sr-only")) continue;
          if (/^(Note|Warning|Error|Done|Info)[.:]?\s*$/.test(textOf(el))) bad.push(`${v.name} (${v.state}): notice "${clip(textOf(n))}" starts with the visible label "${textOf(el)}"`);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("shows no developer code outside a collapsed Details area inside the notice", () => {
    const bad: string[] = [];
    const codePattern = sampleCodes.length > 0 ? new RegExp(`\\b(${[...new Set(sampleCodes)].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`) : null;
    for (const v of rendered) {
      for (const el of v.root.descendants()) {
        const own = el.childNodes.filter((c): c is FakeText => c instanceof FakeText).map((c) => c.data).join(" ");
        const shows = /\bCode:\s/.test(own) || (codePattern?.test(own) ?? false) || (el.tagName === "code" && codePattern !== null && codePattern.test(el.textContent));
        if (!shows) continue;
        const notice = ancestors(el).find((a) => hasClass(a, "notice"));
        const details = ancestors(el).find((a) => a.tagName === "details" && (!notice || notice.contains(a)));
        const insideNoticeDetails = notice !== undefined && details !== undefined && notice.contains(details) && !details.open;
        if (!insideNoticeDetails) bad.push(`${v.name} (${v.state}): shows a developer code to people: "${clip(el.textContent)}"`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("keeps stat labels on one line and shows each fact once", () => {
    const bad: string[] = [];
    for (const v of rendered) {
      const cards = v.root.descendants().filter((el) => hasClass(el, "stat") || hasClass(el, "stat-card"));
      const seen: { label: string; value: string }[] = [];
      for (const c of cards) {
        const label = textOf(c.descendants().find((d) => hasClass(d, "stat-label") || d.tagName === "dt") ?? c);
        const value = textOf(c.descendants().find((d) => hasClass(d, "stat-value") || d.tagName === "dd") ?? c);
        if (label.length > LIMITS.statLabelChars) bad.push(`${v.name} (${v.state}): stat label "${label}" is ${label.length} characters, the limit is ${LIMITS.statLabelChars}`);
        const stem = (w: string): string => w.replace(/(ies|y|s)$/, "");
        for (const prev of seen) {
          if (!/\d{2,}/.test(value) || prev.value !== value) continue;
          const a = new Set(prev.label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).map(stem));
          if (label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).some((w) => a.has(stem(w)))) bad.push(`${v.name} (${v.state}): two cards show ${value}: "${prev.label}" and "${label}"`);
        }
        seen.push({ label, value });
      }
      // a sentence that repeats a count a card already shows
      for (const s of seen) {
        if (!/^\d[\d,]+$/.test(s.value)) continue;
        for (const el of textBlocks(v.root)) {
          if (ancestors(el).some((a) => hasClass(a, "stat") || hasClass(a, "stat-card")) || el.tagName === "button") continue;
          const t = textOf(el);
          if (words(t).length >= 4 && new RegExp(`(^|[^\\d,.])${s.value.replace(/,/g, ",")}([^\\d]|$)`).test(t)) bad.push(`${v.name} (${v.state}): "${clip(t)}" repeats the ${s.value} that the "${s.label}" card shows`);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Source literals, the HTML shell and the stylesheet                                          */
/* ------------------------------------------------------------------------------------------ */

function walkFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe("literals in the views and components", () => {
  const files = walkFiles(srcDir).filter((f) => (/[\\/](views|components)[\\/].*\.ts$/.test(f) || /[\\/]main\.ts$/.test(f)) && !/[\\/]copy\.ts$/.test(f));

  it("hold no sentence-like text of their own that breaks the text rules", () => {
    const bad: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
      for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
        const text = (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, "x");
        if (!/^[A-Z][A-Za-z]*(?: [A-Za-z]+)+[.?!:]?$/.test(text.split(/[.?!] /)[0] ?? "")) continue; // sentences only, not class names, selectors or ids
        const entry: Entry = { id: `${path.basename(file)} literal`, text, kind: "text" };
        for (const rule of [whitespaceProblems, punctuationProblems, quoteProblems, americanProblems]) for (const p of rule(entry)) bad.push(`${entry.id}: "${clip(text)}" ${p}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("the HTML shell", () => {
  const html = readFileSync(path.join(srcDir, "index.html"), "utf8");

  it("has noscript and description text that follows the rules", () => {
    const texts: Entry[] = [];
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? "";
    texts.push({ id: "index.html noscript", text: noscript.replace(/<[^>]+>/g, "").trim(), kind: "note" });
    texts.push({ id: "index.html description", text: /name="description" content="([^"]*)"/.exec(html)?.[1] ?? "", kind: "note" });
    const bad = texts.flatMap((e) => [whitespaceProblems, punctuationProblems, quoteProblems, americanProblems, capitalizationProblems, lengthProblems].flatMap((r) => r(e).map((p) => `${e.id}: "${clip(e.text)}" ${p}`)));
    expect(bad).toEqual([]);
  });
});

describe("stylesheet: notices keep the normal text color", () => {
  it("sets no status color on notice body text (only the icon, label, border and bar carry it)", () => {
    const css = readFileSync(path.join(srcDir, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const bad: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (m[1] ?? "").trim().replace(/\s+/g, " ");
      const decls = m[2] ?? "";
      if (!/\.notice/.test(selector) || /\.icon|label|strong|::before|::after|\.bar|svg|badge/.test(selector)) continue;
      const color = /(?:^|[;\s])color:\s*([^;]+)/.exec(decls)?.[1]?.trim();
      if (color && /-fg\)|--(info|danger|warning|success|error)/.test(color)) bad.push(`${selector} { color: ${color} }`);
    }
    expect(bad).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Stale names                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** "snappy" used as the command, or an old package name. The command and package are snappy-export. */
const STALE = [/\bnpm run (?!snappy-export\b)[\w:.-]*snappy[\w:.-]*/g, /\bsnappy (?:inspect|analyze|memories|keep|unkeep|ledger|demo|help)\b/g, /\bsnappy-cli\b/gi, /\bsnappy_export\b/g, /\bnpx snappy\b/g];
const stale = (text: string): string[] => STALE.flatMap((re) => [...text.matchAll(re)].map((m) => m[0]));

describe("stale names", () => {
  it("says snappy-export in every copy string", () => {
    expect(copyEntries.flatMap((e) => stale(e.text).map((s) => `${e.id}: "${s}"`))).toEqual([]);
  });

  it("says snappy-export in every rendered view", () => {
    const bad: string[] = [];
    for (const v of renderAllCached()) for (const e of v.entries) for (const s of stale(e.text)) bad.push(`${v.name} (${v.state}): "${s}"`);
    expect([...new Set(bad)]).toEqual([]);
  });

  it("says snappy-export in the source files and the page shell", () => {
    const bad: string[] = [];
    for (const file of walkFiles(srcDir).filter((f) => /\.(ts|html|css)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      for (const s of stale(text)) bad.push(`${path.relative(dashboardRoot, file)}: "${s}"`);
    }
    expect(bad).toEqual([]);
  });

  it("ships a built page that matches its sources, with no stale command in it", async () => {
    const dist = path.join(dashboardRoot, "dist", "index.html");
    if (!existsSync(dist)) return; // nothing is built yet; the build test covers building
    const tmp = mkdtempSync(path.join(tmpdir(), "snappy-lint-"));
    try {
      const build = (await import(pathToFileURL(path.join(dashboardRoot, "build.mjs")).href)) as { buildDashboard: (o: { outDir: string }) => Promise<{ file: string }> };
      const fresh = readFileSync((await build.buildDashboard({ outDir: path.join(tmp, "fresh") })).file, "utf8");
      const shipped = readFileSync(dist, "utf8");
      expect(stale(shipped), "stale command in apps/dashboard/dist/index.html").toEqual([]);
      expect(shipped === fresh, "apps/dashboard/dist/index.html is older than the sources: run npm run build:dashboard").toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});

let renderedCache: RenderedView[] | null = null;
function renderAllCached(): RenderedView[] {
  renderedCache ??= renderAll();
  return renderedCache;
}

/* ------------------------------------------------------------------------------------------ */
/* The rules themselves                                                                        */
/* ------------------------------------------------------------------------------------------ */

describe("the lint rules catch what they should", () => {
  const e = (text: string, kind: Kind = "text"): Entry => ({ id: "x", text, kind });
  const problems = (text: string, kind: Kind = "text"): string => RULES.flatMap(([, fn, skip]) => (skip?.(e(text, kind)) ? [] : fn(e(text, kind)))).join(" | ");

  it("flags capitalization", () => {
    expect(problems("Unaccepted Requests", "menu")).toMatch(/capitals/);
    expect(problems("Copy List", "button")).toMatch(/capitals/);
    expect(problems("Snappy reads your export in Snapchat, then Settings.", "note")).not.toMatch(/capitals/);
    expect(problems("Open in Snapchat", "button")).not.toMatch(/capitals/);
  });
  it("flags punctuation and grammar", () => {
    expect(problems("Two  spaces here.")).toMatch(/double space/);
    expect(problems("Trailing space. ")).toMatch(/trailing/);
    expect(problems("A space before , a comma.")).toMatch(/before punctuation/);
    expect(problems("It is the the best way.")).toMatch(/repeats a word/);
    expect(problems("Tidy lists, files, etc. are sorted.")).toMatch(/etc/);
    expect(problems("This ends. and then starts low.")).toMatch(/lowercase/);
  });
  it("flags straight and mixed quotes, but not code", () => {
    expect(problems("Snapchat's cap.")).toMatch(/straight/);
    expect(problems("Snapchat\u2019s cap and \"this\".")).toMatch(/mixes/);
    expect(problems("Snapchat\u2019s cap.")).not.toMatch(/straight|mixes/);
    expect(problems("npm run snappy-export -- inspect \"a\"", "code")).toBe("");
  });
  it("flags British spellings and -ise endings", () => {
    expect(problems("The colour of the centre.")).toMatch(/British/);
    expect(problems("Organise your files whilst you wait.")).toMatch(/-ise|British/);
    expect(problems("Otherwise, promise to exercise.")).not.toMatch(/-ise/);
  });
  it("flags lengths", () => {
    expect(problems("Requests that nobody has accepted yet", "menu")).toMatch(/limit/);
    expect(problems("Copy the whole list now", "button")).toMatch(/limit|verb/);
    expect(problems("Yes, delete all data", "button")).toMatch(/punctuation|limit/);
    expect(problems(`${"word ".repeat(26)}end.`, "note")).toMatch(/limit/);
    expect(problems("A short note that ends well.", "note")).toBe("");
    expect(problems("A short note without a stop", "note")).toMatch(/final period/);
  });
});
