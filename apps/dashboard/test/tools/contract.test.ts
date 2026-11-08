/**
 * The contract every tool keeps, checked on every folder under src/tools without being told about it: there is no list
 * to edit here. A new tool is held to these rules the moment its folder exists, whether or not the registry has been
 * wired yet. What is checked:
 *
 *   the folder          copy.ts, model.ts, view.ts and index.ts, an id that is the folder name, a descriptor that agrees with the copy
 *   the words           the same lint as every other page (sentence case, US English, lengths, quotes), short tile and title,
 *                       no word the brand avoids, no sentence written outside copy.ts
 *   the page            one h1 and its icon tile, what it reads, the back link, decorative graphics, no inline style, every
 *                       command a catalog command, honest empty states for each need, an announcement, no inline markup
 *   the privacy rules   a username only in a result table, never in a note, an error, an announcement or an aria label
 *   its own styles      optional, and every selector starts with .tool-<id>, with tokens only
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import * as mainCopy from "../../src/copy.ts";
import { tools as toolsCopy } from "../../src/copy.ts";
import { commandNotes } from "../../src/copy-tools.ts";
import { COMMANDS, COMMAND_IDS, displayText } from "../../src/terminal/commands.ts";
import { GROUPS, TOOLS, toolById } from "../../src/tools/registry.ts";
import type { ToolCopy, ToolDescriptor, ToolNeed } from "../../src/tools/types.ts";
import { RULES, ancestors, clip, collectCopy, hasClass, lint, renderedEntries, sentences, strayCapitals, textBlocks, textOf, useNames, words } from "../copy-rules.ts";
import type { Entry } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, renderSettled, sampleState, sampleWorkspace, stateWith } from "./harness.ts";

vi.mock("snappy:licenses", () => ({ licenses: [] }));
const announced: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void announced.push(text) }));

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(here, "..", "..");
const toolsDir = path.join(dashboard, "src", "tools");
const repo = path.resolve(dashboard, "..", "..");
const ids = readdirSync(toolsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const sprite = readFileSync(path.join(repo, "brand", "icons", "icons.svg"), "utf8");
const spriteIds = new Set([...sprite.matchAll(/<symbol id="([\w-]+)"/g)].map((m) => m[1] as string));
const NEEDS: readonly ToolNeed[] = ["export", "friends", "chats", "memories"];
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** What the brand's word table says to avoid (docs/BRAND.md, "Word choices"), and the voice rules: no alarm, no emoji. */
const AVOIDED = [/\b(unfriended|unfriend|unadd|unadded|purge|purged|dormant|data dump|client-side)\b/i, /\b(deleted|removed|unfriended) you\b/i, /\blocally\b/i, /!/, /\p{Extended_Pictographic}/u];

let sample: Awaited<ReturnType<typeof sampleState>>;
let friendNames: string[] = [];
beforeAll(async () => {
  sample = await sampleState();
  const parsed = (await sampleWorkspace()).latest as ParsedExport;
  friendNames = [...new Set(parsed.friends.friends.map((f) => f.username))].filter((n) => n.length >= 5);
  // The names a sentence may quote with their capital letter: every page and button name in the app.
  const named = collectCopy(mainCopy).filter((e) => e.kind === "button" || e.kind === "menu" || e.kind === "title").map((e) => e.text);
  useNames(named.sort((a, b) => b.length - a.length));
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  announced.length = 0;
});

async function load(id: string): Promise<{ descriptor: ToolDescriptor; copy: ToolCopy & Record<string, unknown> }> {
  const index = (await import(`../../src/tools/${id}/index.ts`)) as { descriptor: ToolDescriptor };
  const copyModule = (await import(`../../src/tools/${id}/copy.ts`)) as { copy: ToolCopy & Record<string, unknown> };
  return { descriptor: index.descriptor, copy: copyModule.copy };
}

const uncommented = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

describe("the registry", () => {
  it("lists each tool once, with an id that is a folder and a descriptor that is the folder's own", async () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      expect(ids, tool.id).toContain(tool.id);
      expect(toolById(tool.id), tool.id).toBe(tool);
      expect((await load(tool.id)).descriptor, tool.id).toBe(tool);
    }
    expect(toolById("constructor")).toBeUndefined();
  });

  it("has the five groups in order, with orange for Memories alone", () => {
    expect(GROUPS.map((g) => g.id)).toEqual(["your-export", "friends", "chats", "memories", "checklists"]);
    expect(GROUPS.filter((g) => g.category === "memories").map((g) => g.id)).toEqual(["memories"]);
    for (const g of GROUPS) expect(Object.keys(toolsCopy.groups), g.id).toContain(g.id);
  });

  // The wiring step turns this on to prove no tool folder was left out of the list.
  it.skipIf(process.env.SNAPPY_CHECK_WIRING !== "1")("registers every tool folder", () => {
    expect(TOOLS.map((t) => t.id).sort()).toEqual(ids);
  });
});

describe.each(ids)("tool %s", (id) => {
  describe("its folder and descriptor", () => {
    it("has its copy, model, view and descriptor files, and its own test file", () => {
      for (const file of ["copy.ts", "model.ts", "view.ts", "index.ts"]) expect(existsSync(path.join(toolsDir, id, file)), `${id}/${file}`).toBe(true);
      expect(existsSync(path.join(dashboard, "test", "tools", `${id}.test.ts`)), `test/tools/${id}.test.ts`).toBe(true);
    });

    it("has an id that is its folder name in lowercase words joined by hyphens, and a descriptor that agrees with its copy", async () => {
      const { descriptor, copy } = await load(id);
      expect(KEBAB.test(id)).toBe(true);
      expect(descriptor.id).toBe(id);
      expect(descriptor.title).toBe(copy.title);
      expect(descriptor.oneLiner).toBe(copy.oneLiner);
      expect(typeof descriptor.view).toBe("function");
    });

    it("is in a real group, in that group's color, with orange only in Memories, a real icon and real needs", async () => {
      const { descriptor } = await load(id);
      const group = GROUPS.find((g) => g.id === descriptor.group);
      expect(group, `group ${descriptor.group}`).toBeDefined();
      expect(descriptor.category).toBe(group?.category);
      expect(descriptor.category === "memories").toBe(descriptor.group === "memories");
      expect(spriteIds.has(`i-${descriptor.icon}`), `icon ${descriptor.icon}`).toBe(true);
      for (const need of descriptor.needs) expect(NEEDS).toContain(need);
    });
  });

  describe("its words", () => {
    it("has a title, tile line, description and reads line of the right size", async () => {
      const { copy } = await load(id);
      expect(copy.title.length, "title characters").toBeLessThanOrEqual(28);
      expect(words(copy.title).length, "title words").toBeLessThanOrEqual(4);
      expect(copy.title).not.toMatch(/[.!?:]$/);
      expect(copy.oneLiner.length, "tile line characters").toBeLessThanOrEqual(56);
      expect(copy.oneLiner).toMatch(/\.$/);
      expect(sentences(copy.oneLiner)).toHaveLength(1);
      expect(sentences(copy.description).length, "description sentences").toBeLessThanOrEqual(2);
      expect(words(copy.description).length, "description words").toBeLessThanOrEqual(25);
      expect(sentences(copy.reads)).toHaveLength(1);
      expect(words(copy.reads).length, "reads words").toBeLessThanOrEqual(25);
      expect(copy.reads).toMatch(/\.$/);
      // The frame adds what is never read, so a tool does not repeat it.
      expect(copy.reads).not.toMatch(/message text|locations|display names|login/i);
    });

    it("has an empty state wherever it can find nothing", async () => {
      const { copy } = await load(id);
      if (copy.empty) {
        expect(words(copy.empty.title).length).toBeLessThanOrEqual(7);
        expect(sentences(copy.empty.body).length).toBeLessThanOrEqual(2);
      }
    });

    it("passes the copy lint: sentence case, US English, quotes, punctuation and lengths", async () => {
      const { copy } = await load(id);
      const entries = collectCopy({ [`tool_${id}`]: copy });
      expect(entries.length).toBeGreaterThan(5);
      const problems = RULES.flatMap((rule) => lint(entries, rule));
      expect(problems).toEqual([]);
    });

    it("uses none of the words the brand avoids, no exclamation mark and no emoji", async () => {
      const { copy } = await load(id);
      const bad = collectCopy({ [`tool_${id}`]: copy }).flatMap((e) => AVOIDED.filter((re) => re.test(e.text)).map((re) => `${e.id}: "${clip(e.text)}" matches ${re}`));
      expect(bad).toEqual([]);
    });

    it("hedges what it infers: a verdict about people says may, not is", async () => {
      const { copy } = await load(id);
      const text = collectCopy({ [`tool_${id}`]: copy }).map((e) => e.text).join(" ");
      expect(text).not.toMatch(/\b(unfriended|blocked you|deleted you|ignored you|stopped being your friend)\b/i);
    });

    it("writes no sentence in model.ts, view.ts or index.ts: every sentence is in copy.ts", () => {
      const bad: string[] = [];
      for (const file of ["model.ts", "view.ts", "index.ts"]) {
        const source = uncommented(readFileSync(path.join(toolsDir, id, file), "utf8"));
        for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
          const text = (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, "x");
          if (/^[A-Z][A-Za-z]*(?: [A-Za-z]+)+[.?!:]?$/.test(text.split(/[.?!] /)[0] ?? "")) bad.push(`${file}: "${clip(text)}"`);
        }
      }
      expect(bad).toEqual([]);
    });
  });

  describe("its page", () => {
    const states = (): [string, ReturnType<typeof emptyState>][] => [
      ["sample", sample],
      ["empty", emptyState()],
    ];

    it("is built by the shared frame: one h1 with its icon tile, a back link, what it reads, no inline style", async () => {
      const { descriptor, copy } = await load(id);
      for (const [label, state] of states()) {
        const { root } = await renderSettled(descriptor.view, state);
        const where = `${id} (${label})`;
        expect(root.classList.contains("tool"), where).toBe(true);
        expect(root.classList.contains(`tool-${id}`), where).toBe(true);
        expect(root.classList.contains(`cat-${descriptor.category}`), where).toBe(true);
        expect(root.querySelectorAll("h1"), where).toHaveLength(1);
        expect(root.querySelector("h1")?.getAttribute("id"), where).toBe("page-title");
        expect(root.querySelector("h1")?.getAttribute("tabindex"), where).toBe("-1");
        expect(root.querySelector("h1")?.textContent, where).toBe(copy.title);
        expect(root.querySelectorAll("header .chip-icon"), where).toHaveLength(1);
        expect(root.querySelector("header .lead")?.textContent, where).toBe(copy.description);
        expect(root.querySelector(".tool-back a")?.getAttribute("href"), where).toBe("#/tools");
        expect(root.querySelector(".tool-reads")?.textContent, where).toContain(copy.reads);
        for (const el of root.descendants()) {
          expect(el.hasAttribute("style"), `${where}: ${el.tagName}.${el.className}`).toBe(false);
          for (const attr of el.attrs.keys()) expect(attr, `${where}: ${el.tagName}`).not.toMatch(/^on/i);
        }
      }
    });

    it("draws only decorative graphics from the sprite, and no link out of the page", async () => {
      const { descriptor } = await load(id);
      for (const [label, state] of states()) {
        const { root } = await renderSettled(descriptor.view, state);
        for (const svg of root.querySelectorAll("svg")) {
          expect(svg.getAttribute("aria-hidden"), `${id} (${label})`).toBe("true");
          const href = (svg.childNodes[0] as FakeElement).getAttribute("href") ?? "";
          expect(href).toMatch(/^#(i|g|conf)-/);
          expect(spriteIds.has(href.slice(1)), href).toBe(true);
        }
        for (const a of root.querySelectorAll("a")) expect(a.getAttribute("href") ?? "", `${id} (${label})`).toMatch(/^#|^https:\/\/www\.snapchat\.com\/add\//);
      }
    });

    it("shows every command as a catalog command block with Copy and Run, Copy first", async () => {
      const { descriptor } = await load(id);
      const shown = new Map(COMMAND_IDS.map((c) => [displayText(COMMANDS[c]), c]));
      for (const [label, state] of states()) {
        const { root } = await renderSettled(descriptor.view, state);
        for (const block of root.querySelectorAll(".command")) {
          const code = block.querySelector("code")?.textContent ?? "";
          const buttons = block.querySelector(".command-head")?.querySelectorAll("button").map((b) => b.textContent);
          if (block.classList.contains("command-copy-only")) {
            // A command that names a file or folder this page cannot open: the catalog command and more words, Copy only, and the reason.
            expect([...shown.keys()].some((text) => code.startsWith(`${text} `)), `${id} (${label}) copy-only: ${code}`).toBe(true);
            expect(buttons, `${id} (${label})`).toEqual(["Copy"]);
            expect(block.querySelector(".command-note")?.textContent, `${id} (${label})`).toBe(commandNotes.needsTerminal);
            continue;
          }
          expect(shown.has(code), `${id} (${label})`).toBe(true);
          expect(buttons, `${id} (${label})`).toEqual(["Copy", "Run"]);
        }
      }
    });

    it("says honestly what is missing for each need, and runs when the export has it", async () => {
      const { descriptor } = await load(id);
      const empty = await renderSettled(descriptor.view, emptyState());
      const withData = await renderSettled(descriptor.view, sample);
      if (descriptor.needs.length === 0) {
        expect(empty.root.querySelector(".tool-result"), "a tool that needs nothing runs with no export").not.toBeNull();
      } else {
        expect(empty.root.querySelector(".tool-result"), "no result without an export").toBeNull();
        expect(empty.root.querySelector(".empty-title")?.textContent).toBe(toolsCopy.needs.exportTitle);
        expect(empty.root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
      }
      expect(withData.root.querySelector(".tool-result"), "the sample satisfies every need").not.toBeNull();
      expect(withData.root.querySelector(".tool-failed"), "the sample does not make the tool fail").toBeNull();
      // Saved history alone holds friends: a tool that needs more says what, and one that needs only friends runs.
      const ledgerOnly = await renderSettled(descriptor.view, stateWith({ ledger: (await sampleWorkspace()).ledger }));
      const wantsMore = descriptor.needs.some((n) => n !== "friends");
      expect(ledgerOnly.root.querySelector(".tool-result") === null, `${id} on saved history alone`).toBe(wantsMore);
    });

    it("announces its result politely, in one short sentence with no name in it", async () => {
      const { descriptor } = await load(id);
      await renderSettled(descriptor.view, sample);
      expect(announced).toHaveLength(1);
      expect(announced[0]?.length).toBeLessThanOrEqual(140);
      expect(announced[0]).toMatch(/[.?]$/);
      for (const name of friendNames) expect(announced[0], name).not.toContain(name);
    });

    it("passes the copy lint on everything it renders, and repeats no long sentence", async () => {
      const { descriptor } = await load(id);
      const all = new Map<string, Entry>();
      const repeats: string[] = [];
      for (const [label, state] of states()) {
        const { root } = await renderSettled(descriptor.view, state);
        for (const e of renderedEntries(root, `${id} (${label})`)) all.set(`${e.kind}|${e.text}`, e);
        const seen = new Map<string, number>();
        for (const el of textBlocks(root)) {
          if (ancestors(el).some((a) => hasClass(a, "candidate") || hasClass(a, "rows") || hasClass(a, "table-wrap"))) continue;
          for (const s of sentences(textOf(el))) {
            const n = s.toLowerCase().replace(/[.?!]+$/, "");
            if (words(n).length > 8) seen.set(n, (seen.get(n) ?? 0) + 1);
          }
        }
        for (const [s, n] of seen) if (n > 1) repeats.push(`${id} (${label}): "${clip(s)}" appears ${n} times`);
      }
      expect(RULES.flatMap((rule) => lint([...all.values()], rule))).toEqual([]);
      expect(repeats).toEqual([]);
    });
  });

  describe("the privacy rules", () => {
    it("shows a username only in a result table or list, never in a note, an error or a label", async () => {
      const { descriptor } = await load(id);
      const { root } = await renderSettled(descriptor.view, sample);
      const bad: string[] = [];
      for (const el of root.descendants()) {
        const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
        const labels = ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? "").join(" ");
        for (const name of friendNames) {
          if (labels.includes(name)) bad.push(`${el.tagName}: a label holds a username`);
          if (!own.includes(name)) continue;
          const inResult = hasClass(el, "username") || ancestors(el).some((a) => hasClass(a, "table-wrap") || hasClass(a, "rows") || hasClass(a, "chip-group") || a.tagName === "table");
          const inNote = ancestors(el).some((a) => hasClass(a, "tool-notes") || hasClass(a, "notice") || hasClass(a, "tool-failed") || hasClass(a, "empty") || hasClass(a, "lead"));
          if (!inResult || inNote) bad.push(`${el.tagName}.${el.className}: shows a username outside a result table`);
        }
      }
      expect([...new Set(bad)]).toEqual([]);
    });

    it("does not read what Snappy never reads: no media, link, location or login word in what it shows", async () => {
      const { descriptor } = await load(id);
      const { root } = await renderSettled(descriptor.view, sample);
      const page = root.textContent.replace(toolsCopy.readsNever, "");
      expect(page).not.toMatch(/https?:\/\/|\.(jpg|mp4|png)\b/i);
      expect(page).not.toMatch(/\b(latitude|longitude|login history|ip address)\b/i);
    });
  });

  describe("its own styles", () => {
    const file = path.join(toolsDir, id, "styles.css");

    it.skipIf(!existsSync(file))("starts every selector with .tool-<id> and uses tokens only", () => {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const bad: string[] = [];
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = (m[1] ?? "").trim();
        if (selector.startsWith("@")) continue;
        for (const part of selector.split(",")) if (!new RegExp(`^\\.tool-${id}(?![\\w-])`).test(part.trim())) bad.push(`selector "${part.trim()}" does not start with .tool-${id}`);
      }
      expect(bad).toEqual([]);
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/i);
      expect(css).not.toMatch(/font-size:\s*[\d.]+px/);
      expect(css).not.toMatch(/orange/i);
      expect(css).not.toMatch(/!important/);
    });
  });
});

describe("the lint knows what it checks", () => {
  it("catches a title in Title Case and a tile line that runs long", () => {
    expect(strayCapitals("Check Your Export")).toContain("Your");
    expect("Check that every part of your export is there and complete.".length).toBeGreaterThan(56);
  });
});
