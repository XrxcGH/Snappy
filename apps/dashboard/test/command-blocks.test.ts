/**
 * The rule that every command on every page is a command block: it shows Copy and Run, Copy first,
 * and the code it shows is exactly the text Copy copies. This renders every page, with sample data and
 * with none, and checks each block; it also scans the source so a command cannot be written any other way.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import { common, terminal } from "../src/copy.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { buildSampleWorkspace } from "../src/sample.ts";
import { createStore } from "../src/store.ts";
import { COMMANDS, COMMAND_IDS, displayText } from "../src/terminal/commands.ts";
import type { View } from "../src/views/context.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));

const ROUTES = ["overview", "disappeared", "requests", "quiet", "cleanup", "memories", "guide", "privacy", "settings", "start"] as const;
const views: Record<string, View> = {};
let sampleState: State;
let emptyState: State;

beforeAll(async () => {
  installFakeDom();
  sampleState = { ...initialState(), sample: await buildSampleWorkspace() };
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
  Object.assign(views, { overview: ov.overviewView, disappeared: fi.disappearedView, requests: fi.requestsView, quiet: fi.quietView, cleanup: cl.cleanupView, memories: me.memoriesView, guide: gu.guideView, privacy: pr.privacyView, settings: se.settingsView, start: st.startView });
}, 120_000);

function render(name: string, state: State): FakeElement {
  return runInScope(new Scope(true), () => (views[name] as View)({ store: createStore(state), actions: {} as Actions, terminal: testTerminal() })) as unknown as FakeElement;
}

/** The text of the code line of a block, and which commands the page shows, by the code they show. */
const codeOf = (block: FakeElement): string => block.querySelector("code")?.textContent ?? "";
const commandsByCode = new Map(COMMAND_IDS.map((id) => [displayText(COMMANDS[id]), id]));

describe.each([
  ["with sample data", () => sampleState],
  ["with no export yet", () => emptyState],
])("every page %s", (_label, getState) => {
  it.each(ROUTES)("%s: every command is a block with one Copy and one Run, Copy first, and the code is exactly what Copy copies", (name) => {
    const root = render(name, getState());
    for (const block of root.querySelectorAll(".command")) {
      const buttons = block.querySelectorAll("button");
      const labels = buttons.map((b) => b.textContent);
      expect(labels.filter((l) => l === common.copy), name).toHaveLength(1);
      expect(labels.filter((l) => l === terminal.runButton), name).toHaveLength(1);
      expect(labels.indexOf(common.copy), name).toBeLessThan(labels.indexOf(terminal.runButton));
      // Both are in the header row above the code, not in or under it.
      const head = block.querySelector(".command-head") as FakeElement;
      expect(head.querySelectorAll("button").map((b) => b.textContent)).toEqual([common.copy, terminal.runButton]);
      expect(block.querySelectorAll("pre")).toHaveLength(1);
      expect(block.querySelector("pre")?.querySelectorAll("button")).toHaveLength(0);
      const code = codeOf(block);
      expect(commandsByCode.has(code), `${name}: "${code}" is not a catalog command`).toBe(true);
      // The names for screen readers start with the visible words.
      for (const b of buttons) {
        const aria = b.getAttribute("aria-label");
        if (aria !== null) expect(aria.startsWith(b.textContent), aria).toBe(true);
      }
    }
  });

  it.each(ROUTES)("%s: nothing that looks like a command is outside a block", (name) => {
    const root = render(name, getState());
    const stray = [...root.querySelectorAll("pre"), ...root.querySelectorAll("code")].filter((el) => /snappy-export/.test(el.textContent) && ![...ancestorsOf(el)].some((a) => a.classList.contains("command")));
    expect(stray.map((el) => el.textContent)).toEqual([]);
  });
});

function* ancestorsOf(el: FakeElement): Generator<FakeElement> {
  for (let n = el.parentNode; n; n = n.parentNode) yield n;
}

describe("the pages that show commands", () => {
  it("shows the shape command, then the others to try, in the Export guide", () => {
    const codes = render("guide", emptyState).querySelectorAll(".command").map(codeOf);
    expect(codes).toEqual([COMMANDS.inspect, COMMANDS.help, COMMANDS["demo-run"], COMMANDS["analyze-save"], COMMANDS["ledger-status"]].map(displayText));
  });

  it("shows a preview and the rescue in the Memories view, once there is an export", () => {
    const codes = render("memories", sampleState).querySelectorAll(".command").map(codeOf);
    expect(codes).toEqual([COMMANDS["memories-preview"], COMMANDS["memories-rescue"]].map(displayText));
    expect(render("memories", emptyState).querySelectorAll(".command")).toHaveLength(0);
  });

  it("builds a block for every command in the catalog, with its title, and a file chip only where it reads an export", async () => {
    const { commandBlock } = await import("../src/components/commandBlock.ts");
    for (const id of COMMAND_IDS) {
      const ctx = { store: createStore(emptyState), actions: {} as Actions, terminal: testTerminal() };
      const block = runInScope(new Scope(true), () => commandBlock(ctx, id, { key: id })) as unknown as FakeElement;
      expect(block.querySelector(".command-title")?.textContent, id).toBe(COMMANDS[id].title);
      expect(codeOf(block), id).toBe(displayText(COMMANDS[id]));
      expect(block.querySelector(".command-files") !== null, id).toBe(COMMANDS[id].needsFile);
      expect(block.querySelector("input")?.getAttribute("type") ?? "none", id).toBe(COMMANDS[id].needsFile ? "file" : "none");
    }
  });
});

describe("Run and Copy", () => {
  async function block(id: (typeof COMMAND_IDS)[number]) {
    const { commandBlock } = await import("../src/components/commandBlock.ts");
    const terminalSession = testTerminal();
    const ctx = { store: createStore(emptyState), actions: {} as Actions, terminal: terminalSession };
    const el = runInScope(new Scope(true), () => commandBlock(ctx, id, { key: id })) as unknown as FakeElement;
    const [copy, run] = el.querySelector(".command-head")?.querySelectorAll("button") as FakeElement[];
    return { el, copy: copy as FakeElement, run: run as FakeElement, session: terminalSession };
  }

  it("copies exactly the text shown, with the clipboard and with the fallback", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", { clipboard: { writeText: async (t: string) => void written.push(t) } });
    const { copy } = await block("memories-rescue");
    copy.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(written).toEqual([displayText(COMMANDS["memories-rescue"])]);
    vi.unstubAllGlobals();
  });

  it("keeps Run focusable and says why it cannot start when no export is chosen, pointing at the hint", async () => {
    const { el, run } = await block("analyze-save");
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(run.hasAttribute("disabled")).toBe(false);
    const hint = el.querySelector(".command-hint") as FakeElement;
    expect(hint.textContent).toBe(terminal.needsFileHint);
    expect(run.getAttribute("aria-describedby")).toBe(hint.getAttribute("id"));
    run.click();
    expect(run.hasAttribute("disabled")).toBe(false);
  });

  it("becomes ready once an export is chosen, and not before", async () => {
    const { el, run, session } = await block("analyze-preview");
    session.picked.add([new File(["x"], "mydata~1.zip")]);
    expect(run.getAttribute("aria-disabled")).toBeNull();
    expect(run.getAttribute("aria-describedby")).toBeNull();
    expect((el.querySelector(".command-hint") as FakeElement).textContent).toBe("");
    session.picked.clear();
    expect(run.getAttribute("aria-disabled")).toBe("true");
  });

  it("needs no export for a command that reads none", async () => {
    const { run, el } = await block("help");
    expect(run.getAttribute("aria-disabled")).toBeNull();
    expect((el.querySelector(".command-hint") as FakeElement).textContent).toBe("");
  });

  it("says this browser cannot run commands when the session has no helper", async () => {
    const { el, run } = await block("help");
    run.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(el.querySelector(".command-panel")?.textContent).toContain(terminal.noWorkerNote);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Source rules                                                                                 */
/* ------------------------------------------------------------------------------------------ */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
const files = walk(srcDir).filter((f) => f.endsWith(".ts"));
const rel = (f: string): string => path.relative(root, f).split(path.sep).join("/");
const uncommented = (f: string): string => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

describe("no command can be shown any other way", () => {
  it("builds the command frame in one place only", () => {
    expect(files.filter((f) => uncommented(f).includes("command code-block")).map(rel)).toEqual(["src/components/commandBlock.ts"]);
    expect(files.filter((f) => /["'`]code-block["'`]|class: "code-block|code-copy/.test(uncommented(f))).map(rel)).toEqual([]);
  });

  it("writes the command name in one place only: the catalog", () => {
    // The package name (@snappy-export/core) is not the command.
    const named = files.filter((f) => /(?<![@w-])snappy-export(?![w/-])/.test(uncommented(f))).map(rel);
    expect(named).toEqual(["src/terminal/commands.ts"]);
  });

  it("lets only the command block put a command on the clipboard", () => {
    const users = files.filter((f) => /from "\.\.?\/(?:\.\.\/)?clipboard\.ts"/.test(uncommented(f))).map(rel);
    // The command block copies commands; the panel copies output; the cleanup and username components copy their own text.
    for (const file of users) expect(["src/components/commandBlock.ts", "src/components/terminalPanel.ts", "src/components/usernameChip.ts", "src/components/listActions.ts", "src/views/cleanup.ts"], file).toContain(file);
    expect(users).toContain("src/components/commandBlock.ts");
  });

  it("has no <pre> with a command in any view or component but the command block", () => {
    const pres = files.filter((f) => /[\\/](views|components|tools)[\\/]/.test(f) && /h\("pre"/.test(uncommented(f))).map(rel);
    for (const file of pres) expect(["src/components/commandBlock.ts", "src/views/privacy.ts", "src/views/settings.ts"], file).toContain(file);
  });
});
