/**
 * Writing-quality checks on every string the interface can show: capitalization (sentence case),
 * grammar and punctuation basics, American English, whitespace, curly quotes, and maximum lengths
 * for menu labels, buttons and notes. The strings come from the copy module (functions are called
 * with sample values) and from the controls the views actually render.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import * as copy from "../src/copy.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { buildSampleWorkspace } from "../src/sample.ts";
import { createStore } from "../src/store.ts";
import type { View } from "../src/views/context.ts";
import { TOOLS } from "../src/tools/registry.ts";
import { loadCopyModules } from "./copy-rules.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { renderToolPages } from "./tools/harness.ts";
import type { RenderedToolPage } from "./tools/harness.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));
vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

interface Entry {
  path: string;
  text: string;
  /** Produced by calling a copy function: it may start with a name or a number. */
  computed: boolean;
}

/** Every string reachable from the copy module, with the path it came from. */
function collect(value: unknown, at: string, computed: boolean, out: Entry[] = []): Entry[] {
  if (typeof value === "string") out.push({ path: at, text: value, computed });
  else if (typeof value === "function") {
    for (const args of [[1], [2], ["alice", 3], [0, 0], [3, 12, 5], ["x", "y", "z"], ["alice", true, "3 of 12 done"], [true], [false]]) {
      try {
        collect((value as (...a: unknown[]) => unknown)(...args), `${at}()`, true, out);
      } catch {
        // A function that rejects these sample arguments simply contributes nothing for them.
      }
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => collect(v, `${at}[${i}]`, computed, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collect(v, at === "" ? k : `${at}.${k}`, computed, out);
  return out;
}

/** The twenty-two tools keep their words in their own copy.ts, so those are read here too, under "toolcopy.<id>". */
const toolCopy = await Promise.all(TOOLS.map(async (t) => [t.id, ((await import(`../src/tools/${t.id}/copy.ts`)) as { copy: unknown }).copy] as const));
const copyModules = await loadCopyModules(srcDir);
const entries = [...collect(copy, "", false), ...copyModules.flatMap((m) => collect(m, "", false)), ...toolCopy.flatMap(([id, c]) => collect(c, `toolcopy.${id}`, false))].filter((e) => e.text.trim() !== "");

/** Command lines and similar code: straight quotes and lowercase starts are right here. */
const CODE_PATHS = new Set<string>();
/** The independence line is fixed, word for word (docs/BRAND.md). */
const FIXED_LINES = new Set(["brand.nonAffiliation"]);
/** Written to be joined to a number or name, so it ends with a space on purpose. */
const JOINERS = new Set(["common.stepPrefix()"]);
/** Values that are never shown as written: a word joined to another, a file name, internal kind names. */
// common.noFigure is a decorative dash that holds a tile's number row when there is nothing to count; it is not a sentence.
// A tool's unit… keys are pieces its code joins into a sentence, noValue is a dash that holds an empty table cell, and a file name is a name.
// shellCopy.unitThen is the word between the two keys of a shortcut ("g then d"): the dialog draws it between two key caps, never alone.
const NOT_SHOWN_AS_WRITTEN = /^(common\.confidenceSuffix|common\.noFigure|start\.dropAlt|cleanup\.csvFile|lists\.areas\.[a-z-]+\.csvFile|guide\.tickKinds\[\d+\]|shellCopy\.unitThen|toolcopy\.[a-z-]+\.(unit\w*|noValue))$/;

const prose = entries.filter((e) => !CODE_PATHS.has(e.path));

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
const sentences = (s: string): string[] => s.split(/(?<=[.?!])\s+(?=[A-Z0-9])/).filter(Boolean);

describe("whitespace and punctuation", () => {
  it("has no leading or trailing space, double space, tab or line break", () => {
    expect(prose.filter((e) => !JOINERS.has(e.path) && (e.text !== e.text.trim() || /\s{2,}|[\t\n\r]/.test(e.text))).map((e) => e.path)).toEqual([]);
  });

  it("has no space before a period, comma, semicolon, colon, question mark or percent sign", () => {
    expect(prose.filter((e) => /\s[,;:?%]|\s\.(?![a-z]{3})/.test(e.text)).map((e) => `${e.path}: ${e.text}`)).toEqual([]);
  });

  it("has no doubled punctuation and no ellipsis made of dots", () => {
    expect(prose.filter((e) => /([.,;:?])\1/.test(e.text.replace(/\.\.\./g, "")) || /\.\.\./.test(e.text)).map((e) => e.path)).toEqual([]);
  });

  it("never uses etc.", () => {
    expect(prose.filter((e) => /\betc\b/i.test(e.text)).map((e) => e.path)).toEqual([]);
  });

  it("uses curly apostrophes and quotes in prose, so straight and curly are never mixed", () => {
    expect(prose.filter((e) => /['"]/.test(e.text)).map((e) => `${e.path}: ${e.text}`)).toEqual([]);
    // A curly opening quote needs its closing partner.
    expect(prose.filter((e) => (e.text.match(/“/g) ?? []).length !== (e.text.match(/”/g) ?? []).length).map((e) => e.path)).toEqual([]);
  });

  it("ends every full sentence with a period, question mark or colon", () => {
    const full = prose.filter((e) => !JOINERS.has(e.path) && (words(e.text).length >= 9 || /[.?!] [A-Z]/.test(e.text)));
    expect(full.filter((e) => !/[.?:)]$/.test(e.text)).map((e) => `${e.path}: ${e.text}`)).toEqual([]);
  });

  it("starts every written string with a capital letter (code and strings built around a name excepted)", () => {
    const fixed = prose.filter((e) => !e.computed && !JOINERS.has(e.path) && !NOT_SHOWN_AS_WRITTEN.test(e.path));
    expect(fixed.filter((e) => !/^[A-Z0-9]/.test(e.text)).map((e) => `${e.path}: ${e.text}`)).toEqual([]);
  });
});

describe("capitalization", () => {
  /** Words that are capitalized wherever they appear, because they are names or Snapchat's own labels. */
  const NAMES = ["Snappy", "Snapchat", "Snaps", "Snap", "Memories", "Memory", "JSON", "ZIP", "CSV", "GB", "HTML", "AES", "PBKDF2", "My Data", "My AI", "All Time", "Cleanup queue", "Settings", "Profile", "Friends", "Done", "User information"];
  const stripNames = (s: string): string => NAMES.reduce((t, n) => t.split(n).join(" "), s);

  it("keeps labels, buttons and headings in sentence case: only the first word and names are capitalized", () => {
    const short = prose.filter((e) => {
      const n = words(e.text).length;
      return n >= 2 && n <= 8 && !/[.?!] [A-Z]/.test(e.text) && !e.computed;
    });
    const title = short.filter((e) => words(stripNames(e.text)).slice(1).some((w) => /^[A-Z][a-z]/.test(w)));
    expect(title.map((e) => `${e.path}: ${e.text}`)).toEqual([]);
  });

  it("has no word in all capitals longer than four letters", () => {
    expect(prose.filter((e) => /\b[A-Z]{5,}\b/.test(e.text)).map((e) => e.path)).toEqual([]);
  });

  it("writes the first word of each sentence with a capital letter", () => {
    const bad: string[] = [];
    for (const e of prose.filter((p) => !p.computed && !NOT_SHOWN_AS_WRITTEN.test(p.path))) for (const s of sentences(e.text)) if (/^[a-z]/.test(s)) bad.push(`${e.path}: ${s}`);
    expect(bad).toEqual([]);
  });
});

describe("American English", () => {
  const BRITISH = /\b(colour|centre|organis|behaviour|favourite|licence|grey|whilst|learnt|catalogue|analyse|analysing|cancelled|travelling|metre|programme|neighbour|honour|labour|defence|offence|practise|judgement|ageing|towards|amongst|tick|ticked|ticks)\w*/i;
  const ISE_OK = /^(otherwise|precise|exercise|promise|advise|likewise|enterprise|raise|arise|noise|premise|surprise|wise|rise|paradise|disguise|compromise|revise|supervise|franchise|expertise|concise|treatise|demise|merchandise|praise|cruise)$/i;

  it("uses US spelling and wording", () => {
    expect(prose.filter((e) => BRITISH.test(e.text)).map((e) => `${e.path}: ${e.text}`)).toEqual([]);
  });

  it("has no -ise, -ised, -ising or -isation word", () => {
    const hits = prose.flatMap((e) => (e.text.match(/\b[A-Za-z]+(?:isation|ising|ised|ises|ise)\b/g) ?? []).filter((w) => !ISE_OK.test(w)).map((w) => `${e.path}: ${w}`));
    expect(hits).toEqual([]);
  });
});

describe("maximum lengths", () => {
  it("keeps every menu label on one line: 20 characters or fewer, and the title says the same words", () => {
    for (const [id, route] of Object.entries(copy.routes)) {
      expect(route.label.length, `${id} label "${route.label}"`).toBeLessThanOrEqual(20);
      expect(route.title, `${id} title`).toBe(route.label);
    }
    for (const group of [copy.shell.navFindings, copy.shell.navMore, copy.shell.menu]) expect(group.length).toBeLessThanOrEqual(20);
  });

  it("keeps every note to two sentences and about 20 words (the fixed legal line excepted)", () => {
    const long = prose
      .filter((e) => !FIXED_LINES.has(e.path))
      .filter((e) => sentences(e.text).length > 2 || sentences(e.text).some((s) => words(s).length > 20) || words(e.text).length > 24)
      .map((e) => `${e.path} (${words(e.text).length} words): ${e.text}`);
    expect(long).toEqual([]);
  });

  it("keeps table cells and button-like labels short", () => {
    const labels = [
      copy.common.copy, copy.common.keep, copy.common.unkeep, copy.common.openInSnapchat, copy.common.addExport, copy.common.openSettings, copy.common.openGuide,
      copy.start.choose, copy.start.sampleButton, copy.start.unlockButton, copy.start.sessionOnlyAction, copy.overview.emptyAction, copy.overview.healthMemoriesLink,
      copy.cleanup.saveList, copy.cleanup.copyList, copy.cleanup.clearChecks, copy.memories.capUpdate, copy.terminal.runButton, copy.terminal.copyOutputButton, copy.guide.addLink,
      copy.settings.setButton, copy.settings.changeButton, copy.settings.deleteButton, copy.settings.deleteConfirm, copy.settings.deleteCancel, copy.shell.lockNow, copy.shell.clearSampleShort,
    ];
    for (const label of labels) {
      expect(words(label).length, label).toBeLessThanOrEqual(4);
      expect(label.length, label).toBeLessThanOrEqual(24);
      expect(label, label).not.toMatch(/[.!?:]$/);
    }
  });
});

// --------------------------------------------------------------------------------------------
// The controls the views really render.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe("words in the source", () => {
  // A tool's copy.ts is where its sentences belong, so it is read above and left out here.
  const files = walk(srcDir).filter((f) => /[\\/](views|components)[\\/].*\.ts$/.test(f) || (/[\\/]tools[\\/].*\.ts$/.test(f) && !/[\\/]copy\.ts$/.test(f)) || /(main|app-shell|actions)\.ts$/.test(f));
  const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("keeps sentence-like text in copy.ts: no readable sentence is written inside a view or component", () => {
    const hits: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
        const text = match[1] ?? match[2] ?? "";
        // Three or more capitalized-or-lowercase words in a row with a space is prose; CSS class lists and ids have no capitals or spaces in these patterns.
        if (/^[A-Z][a-z]+ [a-z]+ [a-z]+/.test(text) && !/\$\{/.test(text)) hits.push(`${path.basename(file)}: ${text.slice(0, 60)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("uses no straight apostrophe or quote inside readable text in views and components", () => {
    const hits: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
        const text = match[1] ?? match[2] ?? "";
        if (/[A-Za-z]'[a-z]/.test(text) && /[A-Za-z]{3,} [A-Za-z]{2,}/.test(text)) hits.push(`${path.basename(file)}: ${text.slice(0, 60)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("keeps the stylesheet and the page free of the old command name", () => {
    const everything = [...walk(srcDir)].filter((f) => /\.(ts|html|css)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(everything).not.toMatch(/npm run snappy(?!-export)\b/);
    // The command people copy starts with one prefix constant; the commands are words after it.
    expect(everything).toMatch(/CLI_PREFIX = "npm run snappy-export --"/);
    expect(everything).toMatch(/\["inspect", exportSlot\(SHAPE_EXAMPLE\)\]/);
    expect(everything).toMatch(/\["memories", exportSlot\(\), "--out", outSlot\]/);
    expect(root).toBeTruthy();
  });
});

let sampleState: State;
const views: Record<string, View> = {};
const VIEW_IDS = ["overview", "disappeared", "requests", "quiet", "cleanup", "memories", "guide", "privacy", "settings", "start", "tools"] as const;
let toolPages: RenderedToolPage[] = [];

beforeAll(async () => {
  installFakeDom();
  sampleState = { ...initialState(), sample: await buildSampleWorkspace() };
  toolPages = await renderToolPages();
  const load = async <T>(file: string): Promise<T> => (await import(`../src/views/${file}.ts`)) as T;
  const [ov, fi, cl, me, gu, pr, se, st, to] = await Promise.all([
    load<{ overviewView: View }>("overview"),
    load<{ disappearedView: View; requestsView: View; quietView: View }>("findings"),
    load<{ cleanupView: View }>("cleanup"),
    load<{ memoriesView: View }>("memories"),
    load<{ guideView: View }>("guide"),
    load<{ privacyView: View }>("privacy"),
    load<{ settingsView: View }>("settings"),
    load<{ startView: View }>("start"),
    load<{ toolsView: View }>("tools"),
  ]);
  Object.assign(views, {
    tools: to.toolsView,
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
});

function render(name: string, state: State): FakeElement {
  const view = views[name];
  if (!view) throw new Error(`no view ${name}`);
  const store = createStore(state);
  return runInScope(new Scope(true), () => view({ store, actions: {} as Actions, terminal: testTerminal() })) as unknown as FakeElement;
}

describe("rendered controls", () => {
  /** Buttons that name a choice rather than an action. */
  const CHOICES = new Set(["Guided removal", "Dark", "Light", "Match device", "Menu"]);
  const VERBS = new Set(["Add", "Change", "Choose", "Clear", "Copy", "Delete", "Download", "Keep", "Lock", "Open", "Review", "Run", "Save", "Seal", "Set", "Show", "Try", "Undo", "Unlock", "Update", "Use", "Cancel", "Switch"]);

  const controls = (state: State): { view: string; text: string; choice: boolean }[] =>
    [
      ...VIEW_IDS.map((view) => ({ view, el: render(view, state) })),
      ...toolPages.filter((p) => p.state === (state.sample ? "sample" : "empty")).map((p) => ({ view: `tools/${p.id}`, el: p.root })),
    ].flatMap(({ view, el }) => {
      return [...el.querySelectorAll("button"), ...el.querySelectorAll("a")]
        .filter((c) => c.classList.contains("btn"))
        // An icon-only button (copy username) has no visible words; it must carry an accessible name instead.
        .filter((c) => {
          const visible = c.textContent.replace(/\s+/g, " ").trim();
          if (visible === "") expect((c.getAttribute("aria-label") ?? "").length, `${view}: icon-only button needs a name`).toBeGreaterThan(0);
          return visible !== "";
        })
        // On a tool page, a button that holds a pressed state names a choice in a group ("30", "90"), not an action.
        .map((c) => ({ view, text: c.textContent.replace(/\s+/g, " ").trim(), choice: view.startsWith("tools/") && c.hasAttribute("aria-pressed") }));
    });

  it.each([
    ["sample data", () => sampleState],
    ["no export", () => initialState()],
  ])("gives every button a verb and a short noun, in sentence case (%s)", (_name, getState) => {
    const found = controls(getState());
    expect(found.length).toBeGreaterThan(5);
    for (const { view, text, choice } of found) {
      expect(text.length, `${view}: "${text}" is empty or too long`).toBeGreaterThan(0);
      expect(text.length, `${view}: "${text}" is too long`).toBeLessThanOrEqual(24);
      expect(words(text).length, `${view}: "${text}" has too many words`).toBeLessThanOrEqual(4);
      expect(text, `${view}: "${text}" ends like a sentence`).not.toMatch(/[.!?]$/);
      expect(words(text).slice(1).filter((w) => /^[A-Z][a-z]/.test(w) && !["Memories", "Snapchat", "ZIP", "Snappy"].includes(w)), `${view}: "${text}" is Title Case`).toEqual([]);
      if (!CHOICES.has(text) && !choice) expect(VERBS.has(words(text)[0] ?? ""), `${view}: "${text}" should start with a verb`).toBe(true);
    }
  });

  it("keeps the sidebar labels to one short line each", () => {
    for (const route of Object.values(copy.routes)) expect(route.label.length).toBeLessThanOrEqual(20);
  });
});
