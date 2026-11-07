/**
 * Privacy tune-up: the checklist model and its page. The tool reads nothing from the export, so the tests check that
 * the marks (and only the marks) drive the progress, that a mark is saved only through the dashboard's tick
 * mechanism, that nothing is claimed as verified, and that no username reaches the page. Synthetic data only.
 */
import { insights } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../../src/actions.ts";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { Scope, runInScope } from "../../src/reactive.ts";
import { initialState } from "../../src/reducer.ts";
import type { State } from "../../src/reducer.ts";
import { createStore } from "../../src/store.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/privacy-tuneup/copy.ts";
import { descriptor } from "../../src/tools/privacy-tuneup/index.ts";
import { applyMarks, computePrivacyTuneup } from "../../src/tools/privacy-tuneup/model.ts";
import { view } from "../../src/tools/privacy-tuneup/view.ts";
import { collectCopy, lint, RULES } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { installFakeDom } from "../fake-dom.ts";
import { testTerminal } from "../terminal-fixture.ts";
import { emptyState, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
const saved: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));
vi.mock("../../src/download.ts", () => ({
  saveTextFile: (fileName: string) => {
    saved.push(fileName);
    return true;
  },
  saveBlob: () => true,
}));

const ITEMS = insights.privacyTuneup.PRIVACY_TUNEUP_ITEMS;
let sample: State;
let names: string[] = [];
beforeAll(async () => {
  sample = await sampleState();
  const ws = await sampleWorkspace();
  names = [...new Set((ws.latest?.friends.friends ?? []).map((f) => f.username))].filter((n) => n.length >= 5);
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const boxes = (root: FakeElement): FakeElement[] => root.querySelectorAll("input");

/** The page with real actions, so a mark goes through the dashboard's own tick mechanism. */
function open(state: State) {
  installFakeDom();
  const store = createStore(state);
  const actions = createActions(store, { vault: { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} }, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
  const root = runInScope(new Scope(true), () => view({ store, actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { root, store };
}

describe("the tool", () => {
  it("is a Checklists tool that needs nothing and shows the privacy command", () => {
    expect(descriptor).toMatchObject({ id: "privacy-tuneup", title: "Privacy tune-up", group: "checklists", category: "neutral", needs: [] });
    expect(COMMANDS.privacy.argv[0]).toBe("privacy");
  });

  it("has words for every setting core lists, and none for a setting core does not", () => {
    expect(Object.keys(copy.items).sort()).toEqual(ITEMS.map((i) => i.id).sort());
  });
});

describe("the model", () => {
  it("lists every setting with nothing marked, in core's order", () => {
    const r = computePrivacyTuneup(toolData(sample));
    expect(r.sections.flatMap((s) => s.items.map((i) => i.id))).toEqual(ITEMS.map((i) => i.id));
    expect(r.progress).toMatchObject({ total: ITEMS.length, done: 0, todo: ITEMS.length, percent: 0, complete: false });
  });

  it("is the same with no data at all (it reads nothing from an export)", () => {
    const a = computePrivacyTuneup(toolData(sample));
    const b = computePrivacyTuneup(toolData(emptyState()));
    expect(b.sections.map((s) => s.items.map((i) => i.id))).toEqual(a.sections.map((s) => s.items.map((i) => i.id)));
  });

  it("counts a mark for this tool as done, rounding the percent down, and reaches 100 only when all are done", () => {
    const some = applyMarks(["privacy-tuneup:contact-me", "privacy-tuneup:search"], 0).progress;
    expect(some).toMatchObject({ done: 2, percent: 22, complete: false });
    const all = applyMarks(ITEMS.map((i) => `privacy-tuneup:${i.id}`), 0).progress;
    expect(all).toMatchObject({ done: ITEMS.length, percent: 100, complete: true });
  });

  it("leaves out marks for other tools and for settings it does not know", () => {
    const r = applyMarks(["safety-checklist:contact-me", "privacy-tuneup:nope", "privacy-tuneup:", "contact-me"], 0);
    expect(r.progress.done).toBe(0);
    expect(r.notes.map((n) => n.code)).not.toContain("entries_ignored");
  });

  it("holds no username and no message text", () => {
    const json = JSON.stringify([computePrivacyTuneup(toolData(sample)), applyMarks(["privacy-tuneup:contact-me"], 0)]);
    for (const name of names) expect(json, name).not.toContain(name);
  });
});

describe("the page", () => {
  it("lists one checkbox per setting with its words and a hint, and the command", async () => {
    const { root } = await renderSettled(view, sample);
    expect(boxes(root)).toHaveLength(ITEMS.length);
    expect(text(root, ".mark-item label")).toEqual(ITEMS.map((i) => copy.items[i.id]?.label));
    expect(text(root, ".mark-item .caption")).toEqual(ITEMS.map((i) => copy.items[i.id]?.hint));
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toEqual([copy.progressHeading, copy.listHeading, tools.notesHeading, tools.commandHeading]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.privacy));
  });

  it("has no table, no download and no username: the list holds fixed words only", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).not.toContain(tools.downloadHeading);
    expect(root.querySelector("[data-key=tool-download]")).toBeNull();
    for (const name of names) expect(root.textContent, name).not.toContain(name);
  });

  it("runs with no export and says nothing is marked yet, in a short hedged note list", async () => {
    const { root } = await renderSettled(view, emptyState());
    expect(root.querySelector(".tool-result")).not.toBeNull();
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual([copy.nothingMarkedNote, copy.menusNote, copy.generalNote]);
    expect(notes.join(" ")).toMatch(/may/);
  });

  it("also runs on saved history alone, and shows 0 of 9 with every box unmarked", async () => {
    const { root } = await renderSettled(view, stateWith({ ledger: (await sampleWorkspace()).ledger }));
    expect(root.querySelector(".tool-result")).not.toBeNull();
    expect(text(root, ".stat-value")).toEqual([copy.unitOf(0, ITEMS.length), String(ITEMS.length), "0%"]);
    expect(boxes(root).every((b) => !b.hasAttribute("checked"))).toBe(true);
  });

  it("announces once, politely and without a name", async () => {
    await renderSettled(view, sample);
    expect(said).toEqual([copy.doneAnnounce(ITEMS.length)]);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
  });

  it("makes a mark through the tick mechanism, announces it, and moves the progress", async () => {
    const { root, store } = open(stateWith({}));
    await settled(root);
    said.length = 0;
    const first = boxes(root)[0] as FakeElement;
    first.checked = true;
    first.fire("change");
    expect(store.get().real.ticks).toEqual(["privacy-tuneup:contact-me"]);
    expect(said).toEqual([tools.markAnnounce(copy.items["contact-me"]?.label ?? "", true)]);
    await settled(root);
    expect(text(root, ".stat-value")).toEqual([copy.unitOf(1, ITEMS.length), String(ITEMS.length - 1), "11%"]);
    expect(root.querySelector(".progress")?.getAttribute("aria-valuenow")).toBe("11");
    expect(root.querySelector(".progress")?.getAttribute("aria-valuetext")).toBe(copy.progressText(1, ITEMS.length));
    expect(boxes(root)[0]?.hasAttribute("checked")).toBe(true);
    expect(text(root, ".tool-notes li")).not.toContain(copy.nothingMarkedNote);

    (boxes(root)[0] as FakeElement).checked = false;
    boxes(root)[0]?.fire("change");
    expect(store.get().real.ticks).toEqual([]);
    expect(said.at(-1)).toBe(tools.markAnnounce(copy.items["contact-me"]?.label ?? "", false));
  });

  it("keeps marks in the session list only, and nothing else is stored", async () => {
    const { root, store } = open(stateWith({}));
    await settled(root);
    for (const b of boxes(root)) {
      b.checked = true;
      b.fire("change");
    }
    const real = store.get().real;
    expect(real.ticks).toEqual(ITEMS.map((i) => `privacy-tuneup:${i.id}`).sort());
    expect(real.ledger.snapshots).toHaveLength(0);
    expect(real.allowlist).toEqual([]);
    expect(real.checkedOff).toEqual([]);
    expect(saved).toEqual([]);
  });

  it("says every setting is marked done when all are, and never claims anything was checked", async () => {
    const ticks = ITEMS.map((i) => `privacy-tuneup:${i.id}`);
    const { root } = await renderSettled(view, stateWith({ ticks }));
    expect(text(root, ".stat-value")).toEqual([copy.unitOf(ITEMS.length, ITEMS.length), "0", "100%"]);
    expect(text(root, ".tool-notes li")[0]).toBe(copy.allDoneNote);
    expect(root.querySelectorAll(".is-done")).toHaveLength(ITEMS.length);
    expect(root.textContent).not.toMatch(/verified|confirmed|checked for you|secure|safe\b/i);
    expect(root.textContent).toContain(tools.markNote);
  });

  it("ignores marks that belong to another tool", async () => {
    const { root } = await renderSettled(view, stateWith({ ticks: ["safety-checklist:contact-me"] }));
    expect(text(root, ".stat-value")[0]).toBe(copy.unitOf(0, ITEMS.length));
  });
});

describe("the privacy rules", () => {
  it("puts no username in a note, an announcement, the title or any label", async () => {
    const { root } = await renderSettled(view, sample);
    const title = root.querySelector("h1")?.textContent ?? "";
    const labels = root.descendants().map((el) => ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? "").join(" "));
    const all = [...said, title, ...text(root, ".tool-notes li"), ...labels].join(" ");
    for (const name of names) expect(all, name).not.toContain(name);
  });

  it("states nothing about reading settings, location or an account", async () => {
    const { root } = await renderSettled(view, sample);
    const page = root.textContent.replace(tools.readsNever, "");
    expect(page).not.toMatch(/\b(latitude|longitude|login history|ip address)\b/i);
  });
});

describe("the copy", () => {
  it("passes the copy lint", () => {
    const entries = collectCopy({ tool_privacy_tuneup: copy });
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("takes only counts, never a name, and says marks and mark, not the avoided words", () => {
    const all = collectCopy({ tool_privacy_tuneup: copy }).map((e) => e.text).join(" ");
    expect(all).not.toMatch(/\b(tick|ticked|ticks|verified|checked for you|unfriended|purge|dormant|locally)\b/i);
    expect(copy.doneAnnounce(9)).toBe("Privacy tune-up ready. 9 settings to review.");
    expect(copy.progressText(2, 9)).toBe("2 of 9 marked done");
  });

  it("starts from a fresh state without a mark", () => {
    expect(initialState().real.ticks).toEqual([]);
  });
});
