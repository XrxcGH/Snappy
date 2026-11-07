/**
 * The shared checklist for tools whose steps are done in the Snapchat app: one checkbox per item, ticks through the
 * session or saved-history mechanism, one honest note, and no claim that anything was checked. Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActions } from "../../src/actions.ts";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tickList } from "../../src/components/tickList.ts";
import { toolView } from "../../src/components/toolPage.ts";
import { section } from "../../src/components/layout.ts";
import { tools } from "../../src/copy.ts";
import { initialState } from "../../src/reducer.ts";
import { Scope, runInScope } from "../../src/reactive.ts";
import { createStore } from "../../src/store.ts";
import type { ToolCopy, ToolMeta } from "../../src/tools/types.ts";
import type { FakeElement } from "../fake-dom.ts";
import { installFakeDom } from "../fake-dom.ts";
import { settled } from "./harness.ts";
import { testTerminal } from "../terminal-fixture.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));

const copy: ToolCopy = { title: "Sample list", oneLiner: "Tick what you did.", description: "A short list to tick off.", reads: "Nothing from your export." };
const meta: ToolMeta = { id: "sample-list", group: "checklists", category: "neutral", icon: "check", needs: [] };
const ITEMS = [
  { id: "one", label: "Turn on the first setting", hint: "Found in Settings." },
  { id: "two", label: "Review the second setting" },
];

function open() {
  installFakeDom();
  const store = createStore(initialState());
  const actions = createActions(store, { vault: { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} }, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {} });
  const view = toolView<null, Record<string, never>>({ meta, copy, compute: () => null, summary: () => "Ready.", render: (_r, ui) => [section("Steps", tickList(ui, meta.id, ITEMS))] });
  const root = runInScope(new Scope(true), () => view({ store, actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { root, store, actions };
}
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
});

const boxes = (root: FakeElement): FakeElement[] => root.querySelectorAll("input");

describe("the checklist", () => {
  it("has one checkbox per item with its words, a hint where there is one, and the honest note once", async () => {
    const { root } = open();
    await settled(root);
    expect(boxes(root)).toHaveLength(2);
    expect(root.querySelectorAll(".mark-item label").map((l) => l.textContent)).toEqual(ITEMS.map((i) => i.label));
    expect(root.querySelectorAll(".mark-item .caption").map((c) => c.textContent)).toEqual(["Found in Settings."]);
    expect(root.querySelectorAll(".mark-block .caption").map((c) => c.textContent)).toEqual(["Found in Settings.", tools.markNote]);
    expect(tools.markNote).toMatch(/your own word/);
    expect(root.textContent).not.toMatch(/verified|confirmed|checked for you|secure/i);
    for (const b of boxes(root)) expect(b.getAttribute("type")).toBe("checkbox");
  });

  it("ticks through the session, announces each change, and shows the tick again after the page repaints", async () => {
    const { root, store } = open();
    await settled(root);
    said.length = 0;
    const first = boxes(root)[0] as FakeElement;
    first.checked = true;
    first.fire("change");
    expect(store.get().real.ticks).toEqual(["sample-list:one"]);
    expect(said).toEqual([tools.markAnnounce("Turn on the first setting", true)]);
    await settled(root);
    // A new page is drawn with the box ticked (the attribute is what a browser reads for a fresh checkbox).
    expect(boxes(root).map((b) => b.hasAttribute("checked"))).toEqual([true, false]);
    expect(root.querySelectorAll(".is-done")).toHaveLength(1);

    const again = boxes(root)[0] as FakeElement;
    again.checked = false;
    again.fire("change");
    expect(store.get().real.ticks).toEqual([]);
    expect(said.at(-1)).toBe(tools.markAnnounce("Turn on the first setting", false));
  });

  it("keeps keyboard focus on the same box across the repaint, by its key", async () => {
    const { root } = open();
    await settled(root);
    expect(boxes(root).map((b) => b.getAttribute("data-key"))).toEqual(["mark:sample-list:one", "mark:sample-list:two"]);
  });
});
