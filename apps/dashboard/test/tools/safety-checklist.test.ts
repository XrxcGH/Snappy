/**
 * Safety checklist: what it computes from the export (two counts, never a name) and what its page shows. The marks
 * are the person's own word and go only through actions.setTick. Synthetic data only; usernames carry canaries.
 */
import { insights } from "@snappy-export/core";
import type { ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderSafety } from "../../../cli/src/commands/safety.ts";
import { createTerm } from "../../../cli/src/term.ts";
import { createActions } from "../../src/actions.ts";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { Scope, runInScope } from "../../src/reactive.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { createStore } from "../../src/store.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/safety-checklist/copy.ts";
import { descriptor } from "../../src/tools/safety-checklist/index.ts";
import { computeSafetyChecklist, safetyProgress } from "../../src/tools/safety-checklist/model.ts";
import { view } from "../../src/tools/safety-checklist/view.ts";
import { RULES, collectCopy, lint, useNames } from "../copy-rules.ts";
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

const ID = "safety-checklist";
const ITEM_IDS = [...insights.safetyChecklist.SAFETY_ITEM_IDS];
const CANARIES = ["zqcanary_blocked_a", "zqcanary_blocked_b", "zqcanary_pending"];

let base: Workspace;
let sample: State;
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
  useNames([]);
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});

/** A real (not sample) export made from the sample's, with these lists of blocked people and pending requests. */
function withLists(blocked: string[], pending: string[], ws: Partial<Workspace> = {}): State {
  const parsed = base.latest as ParsedExport;
  const latest = { ...parsed, friends: { ...parsed.friends, blocked: blocked.map((username) => ({ username })), pendingRequests: pending.map((username) => ({ username })) } };
  return stateWith({ latest, now: base.now, issues: [], parts: 1, ...ws });
}

/** The page with the real actions, so a mark goes through the reducer as it does in the app. */
function open(state: State) {
  installFakeDom();
  const store = createStore(state);
  const actions = createActions(store, { vault: { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} }, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
  const root = runInScope(new Scope(true), () => view({ store, actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { root, store };
}

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const boxes = (root: FakeElement): FakeElement[] => root.querySelectorAll("input");
/** Marks a box as a person would, then waits for the page to repaint with the new marks. */
async function mark(root: FakeElement, index: number, on: boolean): Promise<void> {
  const box = boxes(root)[index] as FakeElement;
  box.checked = on;
  box.fire("change");
  await settled(root);
}
const progressLine = (root: FakeElement): string | undefined => root.querySelector(".meter-block .meter-text")?.textContent;

describe("the tool", () => {
  it("is a Checklists tool in the neutral color that needs nothing and shows the safety command", () => {
    expect(descriptor).toMatchObject({ id: ID, title: "Safety checklist", group: "checklists", category: "neutral", needs: [] });
    expect(COMMANDS.safety.argv[0]).toBe("safety");
  });

  it("keeps its copy inside the lint", () => {
    expect(RULES.flatMap((rule) => lint(collectCopy({ tool_safety: copy }), rule))).toEqual([]);
  });

  it("has a label and a hint for every item core lists, and no other item", () => {
    expect(Object.keys(copy.items)).toEqual(ITEM_IDS);
  });

  it("uses the labels and hints core holds, which the command line prints too", () => {
    const printed = renderSafety(insights.safetyChecklist.buildSafetyChecklist({ now: 0 }), createTerm({ env: {}, isTTY: false, columns: 200 }), false);
    for (const id of ITEM_IDS) {
      expect(copy.items[id], id).toEqual(insights.safetyChecklist.SAFETY_ITEM_TEXT[id]);
      expect(printed, id).toContain(copy.items[id].label);
    }
  });
});

describe("computeSafetyChecklist", () => {
  it("lists the seven items in core's order, with a count hint only where the export lists people", () => {
    const result = computeSafetyChecklist(toolData(withLists(["a_one", "a_two"], ["b_one"])));
    expect(result.hasExport).toBe(true);
    expect(result.items.map((i) => i.id)).toEqual(ITEM_IDS);
    expect(result.items.find((i) => i.id === "blocked-list")?.hint).toEqual({ kind: "blocked", count: 2 });
    expect(result.items.find((i) => i.id === "who-can-contact-you")?.hint).toEqual({ kind: "pending", count: 1 });
    expect(result.items.filter((i) => i.hint)).toHaveLength(2);
  });

  it("counts each person once, and gives no hint when the lists are empty", () => {
    const counted = computeSafetyChecklist(toolData(withLists(["Same_One", "same_one"], [])));
    expect(counted.items.find((i) => i.id === "blocked-list")?.hint).toEqual({ kind: "blocked", count: 1 });
    expect(counted.items.find((i) => i.id === "who-can-contact-you")?.hint).toBeUndefined();
    expect(computeSafetyChecklist(toolData(withLists([], []))).items.some((i) => i.hint)).toBe(false);
  });

  it("works with no export at all: the same seven items, no hints, and it says there is no export", () => {
    const result = computeSafetyChecklist(toolData(emptyState()));
    expect(result.hasExport).toBe(false);
    expect(result.items.map((i) => i.id)).toEqual(ITEM_IDS);
    expect(result.items.some((i) => i.hint)).toBe(false);
  });

  it("works with the sample", () => {
    const result = computeSafetyChecklist(toolData(sample));
    expect(result.hasExport).toBe(true);
    expect(result.items).toHaveLength(7);
  });

  it("holds no username", () => {
    const json = JSON.stringify(computeSafetyChecklist(toolData(withLists(CANARIES.slice(0, 2), CANARIES.slice(2)))));
    for (const name of CANARIES) expect(json).not.toContain(name);
  });
});

describe("safetyProgress", () => {
  const NOW = Date.UTC(2026, 10, 6, 12);
  it("counts this tool's marks only, once each, and ignores another tool's", () => {
    expect(safetyProgress([], NOW)).toMatchObject({ total: 7, done: 0, todo: 7, percent: 0 });
    const marks = [`${ID}:strong-password`, `${ID}:connected-apps`, "privacy-tuneup:strong-password", `${ID}:not-an-item`];
    expect(safetyProgress(marks, NOW)).toMatchObject({ total: 7, done: 2, stale: 0, todo: 5, percent: 29 });
    expect(safetyProgress(ITEM_IDS.map((id) => `${ID}:${id}`), NOW)).toMatchObject({ done: 7, todo: 0, percent: 100 });
  });
});

describe("the page", () => {
  it("shows the progress, one checkbox per step with its hint, the honest note and the command", async () => {
    const { root } = await renderSettled(view, sample);
    expect(text(root, ".section-title")).toEqual([copy.progressHeading, copy.stepsHeading, tools.commandHeading]);
    expect(progressLine(root)).toBe("0 of 7 marked done");
    expect(root.querySelector(".progress")?.getAttribute("aria-label")).toBe(copy.progressLabel);
    expect(root.querySelector(".progress")?.getAttribute("aria-valuenow")).toBe("0");
    expect(boxes(root)).toHaveLength(7);
    expect(text(root, ".mark-item label")).toEqual(ITEM_IDS.map((id) => copy.items[id].label));
    expect(text(root, ".mark-item .caption").filter((c) => c.length > 0)).toHaveLength(7);
    // The one honest note, once; never a claim that anything was checked.
    expect(text(root, ".mark-block .mark-note").filter((c) => c === tools.markNote)).toHaveLength(1);
    expect(root.textContent).not.toMatch(/verified|confirmed|checked for you|secure/i);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.safety));
    expect(root.querySelectorAll("table")).toHaveLength(0);
  });

  it("offers no download and builds no file", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelectorAll("button").map((b) => b.textContent).filter((t) => /download/i.test(t))).toEqual([]);
    expect(text(root, ".section-title")).not.toContain(tools.downloadHeading);
    expect(saved).toEqual([]);
  });

  it("announces that it is ready, once, politely and without a name", async () => {
    await renderSettled(view, sample);
    expect(said).toEqual([copy.readyAnnounce(7)]);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
  });

  it("marks through the session, announces each change, and shows the new progress after the repaint", async () => {
    const { root, store } = open(sample);
    await settled(root);
    said.length = 0;
    await mark(root, 2, true);
    await mark(root, 0, true);
    expect(store.get().sample?.ticks).toEqual([`${ID}:strong-password`, `${ID}:two-step-verification`]);
    expect(store.get().real.ticks).toEqual([]);
    expect(said).toEqual([tools.markAnnounce(copy.items["strong-password"].label, true), tools.markAnnounce(copy.items["two-step-verification"].label, true)]);
    expect(progressLine(root)).toBe("2 of 7 marked done");
    expect(root.querySelector(".progress")?.getAttribute("aria-valuenow")).toBe("29");
    expect(root.querySelector(".progress")?.getAttribute("aria-valuetext")).toBe("2 of 7 marked done");
    expect(boxes(root).map((b) => b.hasAttribute("checked"))).toEqual([true, false, true, false, false, false, false]);
    // The page repaints without announcing "ready" again.
    expect(said).toHaveLength(2);

    await mark(root, 2, false);
    expect(progressLine(root)).toBe("1 of 7 marked done");
    expect(store.get().sample?.ticks).toEqual([`${ID}:two-step-verification`]);
  });

  it("says all are marked done when every box is marked", async () => {
    const { root } = open(sample);
    await settled(root);
    for (let i = 0; i < 7; i++) await mark(root, i, true);
    expect(progressLine(root)).toBe("All 7 marked done");
    expect(root.querySelector(".progress")?.getAttribute("aria-valuenow")).toBe("100");
  });

  it("shows marks the person made before: boxes marked, progress counting only this tool's marks", async () => {
    const { root } = await renderSettled(view, stateWith({ ticks: [`${ID}:strong-password`, `${ID}:logged-in-devices`, "privacy-tuneup:strong-password"] }));
    expect(boxes(root).map((b) => b.hasAttribute("checked"))).toEqual([false, false, true, false, false, false, true]);
    expect(progressLine(root)).toBe("2 of 7 marked done");
    expect(root.querySelectorAll(".is-done")).toHaveLength(2);
  });

  it("adds the export's counts to two items as hints, in plain hedged words", async () => {
    const { root } = await renderSettled(view, withLists(CANARIES.slice(0, 2), CANARIES.slice(2)));
    const hints = text(root, ".mark-item .caption");
    expect(hints).toContain(copy.blockedHint(2));
    expect(hints).toContain(copy.pendingHint(1));
    expect(root.querySelectorAll(".tool-notes li")).toHaveLength(0);
  });

  it("works with no export: it runs, shows a quiet note that counts need an export, and no counts", async () => {
    const { root } = await renderSettled(view, emptyState());
    expect(boxes(root)).toHaveLength(7);
    expect(root.querySelector(".tool-result")).not.toBeNull();
    expect(text(root, ".tool-notes li")).toEqual([copy.noExportNote]);
    expect(text(root, ".mark-item .caption").join(" ")).not.toMatch(/Your export lists/);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.safety));
  });
});

describe("the privacy rules", () => {
  it("shows no username anywhere: not in a note, a hint, a label, an announcement or a title", async () => {
    const state = withLists(CANARIES.slice(0, 2), CANARIES.slice(2));
    const { root } = open(state);
    await settled(root);
    await mark(root, 5, true);
    const page = root.textContent;
    for (const name of CANARIES) {
      expect(page, name).not.toContain(name);
      for (const line of said) expect(line, name).not.toContain(name);
    }
    for (const el of root.descendants()) {
      for (const attr of ["aria-label", "aria-valuetext", "title", "alt"]) for (const name of CANARIES) expect(el.getAttribute(attr) ?? "", name).not.toContain(name);
    }
    expect(root.querySelectorAll("code.username")).toHaveLength(0);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(text(root, ".tool-notes li").join(" ")).not.toMatch(/zqcanary/i);
  });
});
