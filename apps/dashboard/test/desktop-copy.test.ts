/**
 * The desktop app's own wording (platform().desktop, set by the shell): where it differs from the web text, and
 * proof that it differs nowhere else. The web strings are pinned word for word below, so a change to them fails
 * here; every other string must be the same on both platforms; the desktop wording passes the same copy rules as
 * the rest; and no page the desktop app draws talks about a browser, a tab or an npm script.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as copy from "../src/copy.ts";
import { platform, setPlatform } from "../src/platform.ts";
import type { Platform } from "../src/platform.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { COMMANDS, COMMAND_IDS, CLI_PREFIX, DESKTOP_CLI_PREFIX, displayText } from "../src/terminal/commands.ts";
import { TOOLS } from "../src/tools/registry.ts";
import type { View } from "../src/views/context.ts";
import { RULES, SAMPLE_ARGS, collectCopy, lint, loadCopyModules, useNames } from "./copy-rules.ts";
import type { Entry } from "./copy-rules.ts";
import type { FakeElement } from "./fake-dom.ts";
import { render, renderSettled, sampleState } from "./tools/harness.ts";

vi.mock("snappy:licenses", () => ({ licenses: [] }));
vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

const WEB: Platform = {};
const DESKTOP: Platform = { desktop: "windows", profileLinks: false, release: { version: "0.1.0-beta.2", beta: true } };
const DESKTOP_MAC: Platform = { desktop: "macos" };
const DESKTOP_OTHER: Platform = { desktop: "other" };

afterEach(() => setPlatform({}));

/** Every string reachable from a copy object, by path. Functions are called with a few sample values, like the copy lint does. */
function flatten(value: unknown, at: string, out: Map<string, string> = new Map()): Map<string, string> {
  if (typeof value === "string") out.set(at, value);
  else if (typeof value === "function") {
    for (const args of SAMPLE_ARGS) {
      try {
        const result = (value as (...a: unknown[]) => unknown)(...args);
        if (typeof result === "string") out.set(`${at}(${args.map((a) => JSON.stringify(a)).join(", ")})`, result);
        else flatten(result, `${at}(${args.map((a) => JSON.stringify(a)).join(", ")})`, out);
      } catch {
        // A function that rejects these sample arguments contributes nothing for them.
      }
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${at}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, at === "" ? k : `${at}.${k}`, out);
  return out;
}

const copyModules = await loadCopyModules(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src"));
const toolCopies = await Promise.all(TOOLS.map(async (t) => [t.id, ((await import(`../src/tools/${t.id}/copy.ts`)) as { copy: unknown }).copy] as const));

/** All the words of the interface (the copy module and every tool's own copy), read under one platform. */
function allText(p: Platform): Map<string, string> {
  setPlatform(p);
  const out = flatten(copy, "");
  for (const m of copyModules) flatten(m, "", out);
  for (const [id, c] of toolCopies) flatten(c, `toolcopy.${id}`, out);
  setPlatform({});
  return out;
}

/**
 * Every string that differs in the desktop app: path, the web text (pinned: the web build must not change) and the
 * desktop text. Nothing else may differ.
 */
const DIFFERENCES: readonly (readonly [path: string, web: string, desktop: string])[] = [
  ["start.trustChips[2]", "Works without internet", "Works offline"],
  ["start.sampleBody", "Builds two made-up exports in your browser so you can see every screen. The sample is never saved.", "Builds two made-up exports in this window so you can see every screen. The sample is never saved."],
  ["start.sessionOnlyBody", "Closing this tab clears your results. To keep your history, save it with a passphrase in Settings.", "Closing Snappy clears your results. To keep your history, save it with a passphrase in Settings."],
  ["tools.failedNote", "Snappy could not finish this. Reload the page and try again.", "Snappy could not finish this. Restart Snappy and try again."],
  ["tools.downloadFailedNote", "Snappy could not save the file. Your browser may block downloads.", "Snappy could not save the file. Try again."],
  [
    "memories.rescueCommandLabel",
    "Replace the parts in angle brackets, then copy the command into a terminal. Or press Run to try it here.",
    "For your real folder, copy the command into a terminal where the command line tool is installed. Replace the parts in angle brackets.",
  ],
  ["guide.tryBody", "Press Run to try a command here, or copy it into a terminal with the command line tool.", "Press Run to try a command here. Copy is for the separate command line tool."],
  [
    "privacy.networkUnknown",
    "Snappy could not confirm this page’s security policy. Open the page again from a copy you trust.",
    "Snappy could not confirm this page’s security policy. Install Snappy again from a copy you trust.",
  ],
  ["privacy.sealBody[0]", "By default Snappy keeps your results in memory only. Closing the tab clears them.", "By default Snappy keeps your results in memory only. Closing Snappy clears them."],
  [
    "privacy.sealBody[1]",
    "With a passphrase, Snappy saves your friend history, keep list, and checklist marks in this browser, encrypted.",
    "With a passphrase, Snappy saves your friend history, keep list, and checklist marks on this device, encrypted.",
  ],
  ["privacy.sealBody[3]", "A passphrase typed into a command here is kept in memory only until the page closes.", "A passphrase typed into a command here is kept in memory only until you close Snappy."],
  ["privacy.themeNote", "Your theme choice is remembered in this browser, apart from your saved history.", "Your theme choice is remembered on this device, apart from your saved history."],
  ["settings.themeNote", "Your theme choice is remembered in this browser, apart from your saved history.", "Your theme choice is remembered on this device, apart from your saved history."],
  ["settings.storageSession", "Your results are not saved. Closing this tab clears them.", "Your results are not saved. Closing Snappy clears them."],
  ["settings.storageUnsupported", "This browser does not allow saving. Your results last only while this tab is open.", "Saving is not available here. Your results last only while Snappy is open."],
  ["settings.deleteFailed", "Snappy could not delete the saved history. Close other Snappy tabs and try again.", "Snappy could not delete the saved history. Close other Snappy windows and try again."],
  ["vaultMessages.storageUnavailable", "This browser does not allow saving, so Snappy is in session-only mode.", "Saving is not available here, so Snappy is in session-only mode."],
  ["vaultMessages.saveFailed", "Snappy could not save. Your results are on screen, but closing this tab clears them.", "Snappy could not save. Your results are on screen, but closing Snappy clears them."],
  [
    "vaultMessages.savedElsewhere",
    "Saved history already exists here, maybe from another tab. Unlock it first, or delete it in Settings.",
    "Saved history already exists here, maybe from another window. Unlock it first, or delete it in Settings.",
  ],
  ["terminal.noWorkerNote", "This browser cannot run commands here.", "This window cannot run commands here."],
  [
    "terminal.confirmStoreBody",
    "This changes the saved history in this browser. It locks the dashboard until you unlock it again.",
    "This changes the saved history on this device. It locks the dashboard until you unlock it again.",
  ],
];

describe("desktop wording versus web wording", () => {
  it("keeps the web text word for word and changes exactly the listed strings in the desktop app", () => {
    const web = allText(WEB);
    const desktop = allText(DESKTOP);
    expect([...desktop.keys()].sort()).toEqual([...web.keys()].sort());
    for (const [path, webText, desktopText] of DIFFERENCES) {
      expect(web.get(path), `web ${path}`).toBe(webText);
      expect(desktop.get(path), `desktop ${path}`).toBe(desktopText);
    }
    // The confirmation before a command writes takes a size, so it is checked for every size it was called with: "this page"
    // is a browser word, and the app says Snappy.
    const BY_SIZE = /^terminal\.confirmFolderBody\(/;
    const bySize = [...web.keys()].filter((k) => BY_SIZE.test(k));
    expect(bySize.length).toBeGreaterThan(3);
    for (const k of bySize) expect(desktop.get(k), k).toBe((web.get(k) ?? "").replace("in this page", "in Snappy"));
    const changed = [...web.keys()].filter((k) => web.get(k) !== desktop.get(k) && !BY_SIZE.test(k)).sort();
    expect(changed).toEqual(DIFFERENCES.map(([path]) => path).sort());
  });

  it("lists every string of the interface that says page, window, screen, tab or browser, each one reviewed", () => {
    // Each of these names a part of Snappy (the Start page), the app's own window, or is hidden on the desktop (the profile
    // link and the developer tools hint). A new string with one of these words fails here until someone has read it in the app.
    const REVIEWED = new Set([
      "themeNote", // the web sentence; the app reads desktopThemeNote
      "common.openInSnapchatFor", // the profile link is not drawn in the app
      "start.sampleBody", // "this window" is Snappy's own window
      "overview.healthMemoriesNote", // "the Memories page" is a page of Snappy
      "tools.noExportNote", // "the Start page"
      "tools.needs.exportFailedBody", // "the Start page"
      "privacy.networkOk", // "Snappy's page" is the page the app shows
      "privacy.networkUnknown", // the page's policy could not be read
      "privacy.desktopOwnPage", // says the app shows only its own page
      "privacy.networkDetail", // developer tools hint, not drawn in the app
      "privacy.policyLabel", // inside Technical details
      "privacy.policyWorker", // inside Technical details
      "settings.storageLocked", // "the Start page"
      "settings.lockedAnnounce", // "cleared from the screen"
      "settings.lockBody", // "from the screen"
      "settings.deleteBody", // "clears the screen"
      "settings.deleteFailed", // "other Snappy windows"
      "vaultMessages.saveFailed", // "on screen"
      "vaultMessages.savedElsewhere", // "another window"
      "terminal.noWorkerNote", // "This window cannot run commands here."
    ]);
    const found = [...new Set([...allText(DESKTOP)].filter(([p, t]) => !p.startsWith("toolcopy.") && /\b(page|pages|window|windows|screen|tab|tabs|browser)\b/.test(t)).map(([p]) => p.replace(/\(.*\)$/, "")))].sort();
    expect(found).toEqual([...REVIEWED].sort());
  });

  it("does not call the app's own page a page where the app has no browser: the folder confirmation and the network line", () => {
    const desktop = allText(DESKTOP);
    expect(desktop.get("terminal.confirmFolderBody(5)")).toBe("Files stay in Snappy until you save them. Up to 5 MB.");
    expect(desktop.get("privacy.networkOk")).toBe("Snappy’s page cannot connect to the internet. A built-in rule blocks every connection.");
    expect(desktop.get("privacy.networkOk")).not.toMatch(/security policy/i);
  });

  it("gives macOS and Linux the same desktop wording as Windows, apart from the engine note on the Privacy page (which is not in the list above)", () => {
    const windows = allText(DESKTOP);
    for (const system of [DESKTOP_MAC, DESKTOP_OTHER]) {
      const other = allText(system);
      expect([...other.entries()].filter(([k, v]) => windows.get(k) !== v).map(([k]) => k)).toEqual([]);
    }
  });

  it("reads the platform at the moment of use, so setting it back brings the web text back", () => {
    setPlatform(DESKTOP);
    expect(copy.start.trustChips[2]).toBe("Works offline");
    setPlatform({});
    expect(platform()).toEqual({});
    expect(copy.start.trustChips[2]).toBe("Works without internet");
    expect(copy.themeNote).toBe("Your theme choice is remembered in this browser, apart from your saved history.");
  });

  it("passes the same writing rules as the rest of the interface", () => {
    setPlatform(DESKTOP);
    const entries: Entry[] = [...collectCopy(copy as unknown as Record<string, unknown>)];
    setPlatform({});
    useNames(entries.filter((e) => e.kind === "button" || e.kind === "menu" || e.kind === "title").map((e) => e.text).sort((a, b) => b.length - a.length));
    const desktopEntries = entries.filter((e) => DIFFERENCES.some(([, , text]) => text === e.text || e.text === "Works offline"));
    expect(desktopEntries.length).toBeGreaterThanOrEqual(DIFFERENCES.length - 2);
    for (const rule of RULES) expect(lint(desktopEntries, rule), rule[0]).toEqual([]);
  });

  it("never mentions a browser, a tab, an npm script or developer tools in the desktop wording", () => {
    for (const [path, , desktop] of DIFFERENCES) expect(desktop, path).not.toMatch(/\bbrowsers?\b|\btabs?\b|\bnpm\b|developer tools/i);
  });
});

describe("the command line shown in the desktop app", () => {
  it("is the plain snappy-export on every command, the same words after it, and the web form is unchanged", () => {
    for (const id of COMMAND_IDS) {
      setPlatform({});
      const web = displayText(COMMANDS[id]);
      setPlatform(DESKTOP);
      const desktop = displayText(COMMANDS[id]);
      expect(web.startsWith(`${CLI_PREFIX} `)).toBe(true);
      expect(desktop.startsWith(`${DESKTOP_CLI_PREFIX} `), id).toBe(true);
      expect(desktop).not.toMatch(/npm|--\s/);
      expect(desktop.slice(DESKTOP_CLI_PREFIX.length)).toBe(web.slice(CLI_PREFIX.length));
    }
    expect(DESKTOP_CLI_PREFIX).toBe("snappy-export");
  });
});

describe("the pages the desktop app draws", () => {
  const FORBIDDEN = /\bbrowsers?\b|\btabs?\b|\bnpm\b|developer tools|index\.html|\bclone\b/i;
  /** Where the web wording is kept on purpose: the profile link and the developer tools hint are not drawn on desktop at all. */
  const views: Record<string, View> = {};
  let sample: State;

  beforeAll(async () => {
    sample = await sampleState();
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
      overview: ov.overviewView, disappeared: fi.disappearedView, requests: fi.requestsView, quiet: fi.quietView, cleanup: cl.cleanupView,
      memories: me.memoriesView, guide: gu.guideView, privacy: pr.privacyView, settings: se.settingsView, start: st.startView, tools: to.toolsView,
    });
  }, 120_000);

  const text = (root: FakeElement): string => root.textContent;
  /** The rendered text of a page, and of its accessible names, which a screen reader speaks. */
  const everything = (root: FakeElement): string => [text(root), ...root.descendants().map((el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`)].join("\n");

  it("draw no word about a browser, a tab or an npm script, on any page or any tool", async () => {
    setPlatform(DESKTOP);
    const problems: string[] = [];
    for (const [name, view] of Object.entries(views)) {
      for (const state of [initialState(), sample]) {
        const root = (await renderSettled(view, state)).root;
        for (const line of everything(root).split("\n")) {
          const m = FORBIDDEN.exec(line);
          if (m) problems.push(`${name}: "${m[0]}" in "${line.slice(0, 90)}"`);
        }
      }
    }
    for (const tool of TOOLS) {
      for (const state of [initialState(), sample]) {
        const root = (await renderSettled(tool.view, state)).root;
        for (const line of everything(root).split("\n")) {
          const m = FORBIDDEN.exec(line);
          if (m) problems.push(`tools/${tool.id}: "${m[0]}" in "${line.slice(0, 90)}"`);
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it("show the plain snappy-export command in the Export guide and on the Memories page", async () => {
    setPlatform(DESKTOP);
    for (const name of ["guide", "memories"] as const) {
      const root = render(views[name] as View, sample).root;
      const codes = root.querySelectorAll("pre.code code").map((c) => c.textContent);
      expect(codes.length, name).toBeGreaterThan(0);
      for (const code of codes) expect(code.startsWith("snappy-export "), `${name}: ${code}`).toBe(true);
    }
  });

  it("draw the web wording on the same pages when no platform is set", async () => {
    setPlatform(WEB);
    const start = (await renderSettled(views.start as View, initialState())).root;
    expect(text(start)).toContain("Works without internet");
    expect(text(start)).toContain("Closing this tab clears your results");
    const guide = render(views.guide as View, sample).root;
    for (const code of guide.querySelectorAll("pre.code code")) expect(code.textContent.startsWith("npm run snappy-export -- ")).toBe(true);
  });

  it("show the desktop wording on Start, Settings and Privacy", async () => {
    setPlatform(DESKTOP);
    const start = text((await renderSettled(views.start as View, initialState())).root);
    expect(start).toContain("Works offline");
    expect(start).toContain("Closing Snappy clears your results");
    const settings = text((await renderSettled(views.settings as View, initialState())).root);
    expect(settings).toContain("Closing Snappy clears them.");
    expect(settings).toContain("Version 0.1.0-beta.2");
    const privacy = text((await renderSettled(views.privacy as View, initialState())).root);
    expect(privacy).toContain("Closing Snappy clears them.");
    expect(privacy).toContain("on this device, encrypted");
  });

  it("show the build's version on Settings only when the shell names one, and keep the web version otherwise", async () => {
    setPlatform({});
    expect(text((await renderSettled(views.settings as View, initialState())).root)).toContain(`Version ${copy.brand.version}`);
    setPlatform({ desktop: "windows", release: { version: "9.9.9", beta: false } });
    expect(text((await renderSettled(views.settings as View, initialState())).root)).toContain("Version 9.9.9");
  });
});
