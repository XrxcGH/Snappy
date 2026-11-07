/**
 * The frame every tool page shares, checked with a small made-up tool: what the frame always shows, the honest empty
 * states, waiting, announcing, remembering, parameters, downloads and failure. Synthetic sample data only.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { toolView } from "../../src/components/toolPage.ts";
import type { ToolPageOptions } from "../../src/components/toolPage.ts";
import { tools } from "../../src/copy.ts";
import { section } from "../../src/components/layout.ts";
import { h } from "../../src/dom.ts";
import type { State } from "../../src/reducer.ts";
import { reduce } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import type { ToolCopy, ToolMeta } from "../../src/tools/types.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: { text: string; assertive: boolean }[] = [];
const saved: { fileName: string; text: string; mime: string }[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string, assertive = false) => void said.push({ text, assertive }) }));
vi.mock("../../src/download.ts", () => ({
  saveTextFile: (fileName: string, text: string, mime: string) => {
    saved.push({ fileName, text, mime });
    return true;
  },
  saveBlob: () => true,
}));

const copy: ToolCopy = {
  title: "Sample tool",
  oneLiner: "Counts something.",
  description: "Counts the friends in your export.",
  reads: "Counts in your friends list.",
  empty: { title: "Nothing to count", body: "Your export has no friends to count." },
};
const meta: ToolMeta = { id: "sample-tool", group: "your-export", category: "cleanup", icon: "check", needs: ["export", "friends"] };

interface Result {
  friends: number;
  step: number;
}

let computed: { step: number }[];
function options(extra: Partial<ToolPageOptions<Result, { step: number }>> = {}): ToolPageOptions<Result, { step: number }> {
  return {
    meta,
    copy,
    params: { step: 1 },
    compute: (data, params) => {
      computed.push({ ...params });
      return { friends: data.parsed?.friends.friends.length ?? 0, step: params.step };
    },
    summary: (r) => `Counted ${r.friends} friends.`,
    render: (r) => [section("Result", h("p", { class: "tool-count" }, `${r.friends} counted, step ${r.step}`))],
    ...extra,
  };
}

let sample: State;
beforeAll(async () => {
  sample = await sampleState();
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  computed = [];
  said.length = 0;
  saved.length = 0;
});

const view = (extra?: Partial<ToolPageOptions<Result, { step: number }>>) => toolView(options(extra));
const text = (el: FakeElement, selector: string): string => el.querySelector(selector)?.textContent ?? "";

describe("the frame", () => {
  it("shows a back link, the one h1 with its icon tile, the description and what the tool reads", async () => {
    const { root } = await renderSettled(view(), sample);
    expect(root.classList.contains("tool")).toBe(true);
    expect(root.classList.contains("cat-cleanup")).toBe(true);
    expect(root.getAttribute("data-tool")).toBe("sample-tool");
    const back = root.querySelector(".tool-back a") as FakeElement;
    expect(back.getAttribute("href")).toBe("#/tools");
    expect(back.textContent).toBe(tools.backLink);
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelector("h1")?.getAttribute("id")).toBe("page-title");
    expect(root.querySelector("h1")?.textContent).toBe(copy.title);
    expect(root.querySelectorAll("header .chip-icon")).toHaveLength(1);
    expect(root.querySelector("header .lead")?.textContent).toBe(copy.description);
    const reads = root.querySelector(".tool-reads") as FakeElement;
    expect(reads.querySelector(".label")?.textContent).toBe(tools.readsHeading);
    expect(reads.textContent).toContain(copy.reads);
    expect(reads.textContent).toContain("message text, media, locations, display names or login history");
  });

  it("draws no inline style, handler attribute or markup string", async () => {
    const { root } = await renderSettled(view({ command: "check" }), sample);
    for (const el of root.descendants()) {
      expect(el.hasAttribute("style"), el.tagName).toBe(false);
      for (const attr of el.attrs.keys()) expect(attr).not.toMatch(/^on/i);
    }
  });
});

describe("when the export lacks what the tool needs", () => {
  it("asks for an export when nothing is loaded, and never runs the tool", async () => {
    const { root } = render(view(), emptyState());
    expect(root.querySelector(".empty-title")?.textContent).toBe(tools.needs.exportTitle);
    expect(root.querySelector(".empty-body")?.textContent).toBe(tools.needs.exportBody);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".tool-result")).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(computed).toEqual([]);
    expect(said).toEqual([]);
  });

  it("says saved history alone is not enough, and that a refused export was not added", async () => {
    const ws = await sampleWorkspace();
    expect(text(render(view(), stateWith({ ledger: ws.ledger })).root, ".empty-body")).toBe(tools.needs.exportLedgerBody);
    const refused = reduce(emptyState(), { type: "import-failed", message: "x" });
    expect(text(render(view(), refused).root, ".empty-body")).toBe(tools.needs.exportFailedBody);
  });

  it("names the missing list and points at the export check, which then does not point at itself", async () => {
    const parsed = sample.sample?.latest;
    if (!parsed) throw new Error("no sample export");
    const noFriends = stateWith({ latest: { ...parsed, friends: { ...parsed.friends, friends: [] } } });
    const { root } = render(view(), noFriends);
    expect(text(root, ".empty-title")).toBe(tools.needs.friendsTitle);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/tools/export-check");
    const own = render(toolView(options({ meta: { ...meta, id: "export-check" } })), noFriends).root;
    expect(own.querySelector(".empty a")).toBeNull();
  });

  it("repaints when an export arrives, without a reload", async () => {
    const r = render(view(), emptyState());
    expect(r.root.querySelector(".empty")).not.toBeNull();
    r.store.dispatch({ type: "sample-loaded", workspace: await sampleWorkspace() });
    await settled(r.root);
    expect(r.root.querySelector(".empty")).toBeNull();
    expect(text(r.root, ".tool-count")).toMatch(/counted/);
  });
});

describe("waiting, announcing and remembering", () => {
  it("paints a working line first, then the result, and says so politely once", async () => {
    const r = render(view(), sample);
    expect(r.root.querySelector(".tool-result")?.getAttribute("aria-busy")).toBe("true");
    expect(r.root.querySelector("[role=progressbar]")?.getAttribute("aria-label")).toBe(tools.workingLabel);
    expect(computed).toEqual([]);
    await settled(r.root);
    expect(r.root.querySelector(".tool-result")?.hasAttribute("aria-busy")).toBe(false);
    expect(r.root.querySelector("[role=progressbar]")).toBeNull();
    expect(computed).toHaveLength(1);
    expect(said).toEqual([{ text: expect.stringMatching(/^Counted \d+ friends\.$/), assertive: false }]);
  });

  it("does not compute again, or announce again, on a repaint or a return to the page", async () => {
    const r = await renderSettled(view(), sample);
    // A change the tool reads (the storage cap) repaints the region; the data is new, so it computes once more.
    r.store.dispatch({ type: "cap", gib: 8 });
    await settled(r.root);
    expect(computed).toHaveLength(2);
    said.length = 0;
    // The same state again: the held result is drawn at once.
    const again = render(view(), r.store.get());
    expect(again.root.querySelector(".tool-result")?.hasAttribute("aria-busy")).toBe(false);
    expect(computed).toHaveLength(2);
    expect(said).toEqual([]);
  });

  it("paints nothing and announces nothing for a page that was left before the result arrived", async () => {
    const r = render(view(), sample);
    r.scope.dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.root.querySelector(".tool-count")).toBeNull();
    expect(r.root.querySelector(".tool-result")?.getAttribute("aria-busy")).toBe("true");
    expect(said).toEqual([]);
  });
});

describe("parameters", () => {
  it("recompute on a change and repaint only the result, so the controls keep their place", async () => {
    const built: HTMLElement[] = [];
    const r = await renderSettled(
      view({
        controls: (ui) => {
          const input = h("input", { class: "input", type: "text", "data-key": "step" });
          input.addEventListener("input", () => ui.set({ step: 5 }));
          built.push(input);
          return h("div", { class: "tool-controls" }, input);
        },
      }),
      sample,
    );
    expect(text(r.root, ".tool-count")).toMatch(/step 1$/);
    const input = r.root.querySelector("input") as FakeElement;
    input.fire("input");
    expect(r.root.querySelector(".tool-result")?.getAttribute("aria-busy")).toBe("true");
    await settled(r.root);
    expect(text(r.root, ".tool-count")).toMatch(/step 5$/);
    expect(r.root.querySelector("input")).toBe(input);
    expect(built).toHaveLength(1);
    expect(computed.map((c) => c.step)).toEqual([1, 5]);
    // Going back to a value already computed is answered from memory.
    r.root.querySelector("input")?.fire("input");
    expect(computed).toHaveLength(2);
  });

  it("show only the newest result when changes arrive quickly", async () => {
    let ui: { set(patch: { step: number }): void } | undefined;
    const r = await renderSettled(
      view({
        controls: (u) => {
          ui = u;
          return null as never;
        },
      }),
      sample,
    );
    ui?.set({ step: 2 });
    ui?.set({ step: 3 });
    await settled(r.root);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(text(r.root, ".tool-count")).toMatch(/step 3$/);
  });
});

describe("empty results, notes and failure", () => {
  it("shows the tool's own empty state when it ran and found nothing", async () => {
    const { root } = await renderSettled(view({ isEmpty: (r) => r.friends > 0 }), sample);
    expect(text(root, ".empty-title")).toBe("Nothing to count");
    expect(text(root, ".empty-body")).toBe("Your export has no friends to count.");
    expect(root.querySelector(".tool-count")).toBeNull();
  });

  it("lists notes as a quiet list with a status icon each, under one heading", async () => {
    const { root } = await renderSettled(
      view({
        notes: () => [
          { kind: "info", text: "A plain observation." },
          { kind: "warning", text: "Something to look at." },
        ],
      }),
      sample,
    );
    const items = root.querySelectorAll(".tool-notes li");
    expect(items.map((li) => li.textContent)).toEqual(["A plain observation.", "Something to look at."]);
    expect(items.map((li) => li.classList.contains("tool-note-warning"))).toEqual([false, true]);
    for (const li of items) expect(li.querySelectorAll("svg")).toHaveLength(1);
    expect(root.querySelectorAll(".tool-result .section-title").map((t) => t.textContent)).toEqual(["Result", tools.notesHeading]);
    expect(root.querySelectorAll(".notice")).toHaveLength(0);
  });

  it("says only a fixed line when the work throws, never what it threw", async () => {
    const { root } = await renderSettled(
      view({
        compute: () => {
          throw new Error("ZQCANARY alice_01");
        },
      }),
      sample,
    );
    expect(text(root, ".tool-failed")).toBe(tools.failedNote);
    expect(root.querySelector(".tool-failed")?.getAttribute("role")).toBe("alert");
    expect(root.textContent).not.toContain("ZQCANARY");
    expect(said).toEqual([]);
  });
});

describe("the download", () => {
  it("is built only when the button is pressed, from the result, and says it was saved", async () => {
    let built = 0;
    const { root } = await renderSettled(
      view({
        download: {
          label: "Download JSON",
          note: "The file holds usernames.",
          build: (r) => {
            built++;
            return { fileName: "sample.json", text: JSON.stringify({ friends: r.friends }), mime: "application/json" };
          },
        },
      }),
      sample,
    );
    expect(built).toBe(0);
    const button = root.querySelectorAll("button").find((b) => b.textContent === "Download JSON") as FakeElement;
    expect(root.textContent).toContain("The file holds usernames.");
    said.length = 0;
    button.click();
    expect(built).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ fileName: "sample.json", mime: "application/json" });
    expect(JSON.parse(saved[0]?.text ?? "{}")).toEqual({ friends: expect.any(Number) });
    expect(said).toEqual([{ text: tools.downloadSaved, assertive: false }]);
  });

  it("offers nothing to download where there is no result", () => {
    const { root } = render(view({ download: { label: "Download JSON", build: () => ({ fileName: "x", text: "", mime: "text/plain" }) } }), emptyState());
    expect(root.querySelectorAll("button").filter((b) => b.textContent === "Download JSON")).toHaveLength(0);
  });
});

describe("the command block", () => {
  it("shows the catalog command with Copy and Run, whether or not an export is loaded", async () => {
    for (const state of [sample, emptyState()]) {
      const { root } = render(view({ command: "check" }), state);
      const block = root.querySelector(".command") as FakeElement;
      expect(block.querySelector("code")?.textContent).toBe(displayText(COMMANDS.check));
      expect(block.querySelector(".command-head")?.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Copy", "Run"]);
      expect(root.querySelectorAll(".section-title").map((x) => x.textContent)).toContain(tools.commandHeading);
    }
  });

  it("shows no command block for a tool with no command", async () => {
    const { root } = await renderSettled(view(), sample);
    expect(root.querySelectorAll(".command")).toHaveLength(0);
  });
});
