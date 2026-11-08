/**
 * Storage planner: what it computes from the Memories list the page holds, and what its page shows.
 * Synthetic data only. Memory ids, links and paths carry canaries that must never reach a result or the page.
 */
import type { MemoryItem, ParsedExport } from "@snappy-export/core";
import { insights } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { gibToBytes } from "../../src/format.ts";
import { initialState } from "../../src/reducer.ts";
import type { State } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/storage-planner/copy.ts";
import { descriptor } from "../../src/tools/storage-planner/index.ts";
import { computeStoragePlanner, DEFAULT_PARAMS } from "../../src/tools/storage-planner/model.ts";
import { view } from "../../src/tools/storage-planner/view.ts";
import { RULES, collectCopy, lint, useNames } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));

const MIB = 1024 ** 2;
const NOW = Date.UTC(2026, 5, 1);
let base: ParsedExport;
let sample: State;
beforeAll(async () => {
  base = (await sampleWorkspace()).latest as ParsedExport;
  sample = await sampleState();
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
});

let counter = 0;
/** One made-up Memory. Its id, link and path hold a canary that must never be shown. */
function memory(year: number | null, mediaType: MemoryItem["mediaType"], mib: number | null, extra: Partial<MemoryItem> = {}): MemoryItem {
  counter++;
  return {
    id: `ZQCANARY-id-${counter}`,
    date: year === null ? null : Date.UTC(year, 2, 1 + (counter % 28)),
    mediaType,
    downloadUrl: `https://example.invalid/ZQCANARY/${counter}`,
    zipPath: `memories/ZQCANARY-${counter}.bin`,
    ...(mib === null ? {} : { sizeBytes: mib * MIB }),
    ...extra,
  };
}

/** Three photos in 2026, two videos in 2025, one photo in 2024, one photo with no date, and one photo with no size. */
function crafted(): MemoryItem[] {
  // Dates rise with the counter, so the order inside a year is the order written here.
  counter = 0;
  return [
    memory(2026, "image", 400, { partIndex: 1 }),
    memory(2026, "image", 400, { partIndex: 1 }),
    memory(2026, "image", 400, { partIndex: 2 }),
    memory(2025, "video", 700, { partIndex: 2 }),
    memory(2025, "video", 700, { partIndex: 3 }),
    memory(2024, "image", 100, { partIndex: 3 }),
    memory(null, "image", 50),
    memory(2025, "image", null),
  ];
}

/** A real (not sample) export made from the sample's, holding these Memories. */
function real(memories: MemoryItem[], capGiB?: number): State {
  const state = stateWith({ latest: { ...base, memories }, now: NOW, issues: [], parts: 3 });
  return capGiB === undefined ? state : { ...state, capGiB };
}
const dataOf = (state: State) => toolData(state);

describe("the tool", () => {
  it("is a Memories tool in the memories color that needs an export and Memories, and shows the storage command", () => {
    expect(descriptor).toMatchObject({ id: "storage-planner", title: "Storage planner", group: "memories", category: "memories", needs: ["export", "memories"] });
    expect(descriptor.oneLiner).toBe("Plan how to save your Memories.");
    expect(COMMANDS.storage.argv[0]).toBe("storage");
  });
});

describe("computeStoragePlanner", () => {
  it("plans the Memories as core does, with the goal in GB turned into bytes", () => {
    const data = dataOf(real(crafted()));
    const { plan, goalGiB } = computeStoragePlanner(data, { goalGiB: 2, order: "newest-first" });
    const core = insights.storagePlanner.planMemoryStorage(crafted().map((m, i) => ({ ...m, id: `x${i}` })), gibToBytes(2), { now: NOW });
    expect(goalGiB).toBe(2);
    expect(plan.goalBytes).toBe(gibToBytes(2));
    expect(plan.totals).toEqual(core.totals);
    expect(plan.byYear.map((y) => [y.year, y.items])).toEqual([[2024, 1], [2025, 3], [2026, 3], [null, 1]]);
    expect(plan.fit).toMatchObject({ fitsAll: false, items: 4, deferredItems: 3 });
    expect(plan.byPart.map((p) => p.part)).toEqual([1, 2, 3, null]);
    expect(plan.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["lower-bound", "over-goal", "undated-items"]));
  });

  it("starts at the free storage cap, lets a goal replace it, and ignores a goal that cannot be used", () => {
    const data = dataOf(real(crafted(), 3));
    expect(computeStoragePlanner(data).goalGiB).toBe(3);
    expect(computeStoragePlanner(data, DEFAULT_PARAMS).plan.goalBytes).toBe(gibToBytes(3));
    expect(computeStoragePlanner(data, { goalGiB: 8, order: "newest-first" }).goalGiB).toBe(8);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(computeStoragePlanner(data, { goalGiB: bad, order: "newest-first" }).goalGiB, String(bad)).toBe(3);
  });

  it("saves the newest year first by default and the oldest first when asked", () => {
    const data = dataOf(real(crafted()));
    expect(computeStoragePlanner(data).plan.priority[0]).toMatchObject({ year: 2026, type: "image" });
    const oldest = computeStoragePlanner(data, { goalGiB: null, order: "oldest-first" }).plan;
    expect(oldest.order).toBe("oldest-first");
    expect(oldest.priority[0]).toMatchObject({ year: 2024 });
  });

  it("marks totals as a floor when sizes are missing, and plans nothing when none is known", () => {
    const some = computeStoragePlanner(dataOf(real(crafted()))).plan;
    expect(some.totals).toMatchObject({ unsized: 1, isLowerBound: true });
    const none = computeStoragePlanner(dataOf(real([memory(2025, "image", null), memory(2024, "video", null)]))).plan;
    expect(none.totals).toMatchObject({ items: 2, unsized: 2, knownBytes: 0 });
    expect(none.batches).toEqual([]);
  });

  it("holds no Memory id, link or path, and no username", () => {
    const names = [...new Set(base.friends.friends.map((f) => f.username))].filter((n) => n.length >= 5);
    const json = JSON.stringify(computeStoragePlanner(dataOf(real(crafted())), { goalGiB: 0.5, order: "newest-first" }));
    expect(json).not.toContain("ZQCANARY");
    expect(json).not.toMatch(/itemIds|https?:|memories\//);
    for (const name of names) expect(json, name).not.toContain(name);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeStoragePlanner(dataOf(initialState()))).toThrow();
  });
});

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const headings = (root: FakeElement): string[] => text(root, ".section-title");
const rowsOf = (table: FakeElement): string[][] => table.querySelectorAll("tbody tr").map((tr) => [...tr.querySelectorAll("th"), ...tr.querySelectorAll("td")].map((c) => c.textContent));

describe("the page", () => {
  it("shows the goal, the tables, the notes and the command for the sample, and says nothing was downloaded", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelector(".tool-result")?.hasAttribute("aria-busy")).toBe(false);
    expect(headings(root)).toEqual(expect.arrayContaining([copy.goalHeading, copy.byYearHeading, copy.byTypeHeading, copy.orderHeading]));
    expect(root.querySelectorAll("table").length).toBeGreaterThanOrEqual(3);
    expect(root.querySelector("[role=progressbar]")?.getAttribute("aria-label")).toBe(copy.meterLabel);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.storage));
    expect(headings(root)).not.toContain(tools.downloadHeading);
    expect(root.querySelectorAll("button").filter((b) => /^Download/.test(b.textContent))).toHaveLength(0);
  });

  it("shows the goal against the known size, how much fits and how much waits", async () => {
    const { root } = await renderSettled(view, real(crafted(), 2));
    const p = text(root, ".section p");
    expect(text(root, ".meter-head .meter-name")).toEqual([copy.meterName]);
    expect(text(root, ".meter-head .meter-text")).toEqual(["At least 2.69 GB of 2 GB (134%)"]);
    expect(p).toContain(copy.fitsPartLine(4, 3));
    expect(text(root, ".facts dt")).toEqual([copy.countedHeader, copy.fitsHeader, copy.waitsHeader]);
    expect(text(root, ".facts dd")).toEqual(["8", "4", "3"]);
    expect(root.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("100");
    expect(root.querySelector("[role=progressbar]")?.getAttribute("aria-valuetext")).toBe("At least 2.69 GB of 2 GB (134%)");
  });

  it("says everything fits when it does", async () => {
    const { root } = await renderSettled(view, real(crafted(), 10));
    expect(text(root, ".section p")).toContain(copy.fitsAllLine);
    expect(text(root, ".facts dd")).toEqual(["8", "7", "0"]);
  });

  it("lists the years with a pill for each, so what fits is never shown by color alone", async () => {
    const { root } = await renderSettled(view, real(crafted(), 2));
    const table = root.querySelectorAll("table")[0] as FakeElement;
    expect(table.querySelector("caption")?.textContent).toBe(copy.byYearCaption);
    expect(text(table, "thead th")).toEqual([copy.yearHeader, copy.memoriesHeader, copy.sizeHeader, copy.shareHeader, copy.fitHeader]);
    const rows = rowsOf(table);
    expect(rows.map((r) => r[0])).toEqual(["2024", "2025", "2026", "No date"]);
    expect(rows[2]).toEqual(["2026", "3 Memories", "1.17 GB", "44% of total", "Fits"]);
    // 2025 holds a photo with no size: its size is a floor.
    expect(rows[1]?.[2]).toBe("At least 1.37 GB");
    expect(text(table, ".pill")).toEqual(["Waits", "Partly fits", "Fits", "Waits"]);
    expect(table.querySelectorAll(".pill-yes")).toHaveLength(1);
    expect(table.querySelectorAll(".pill-no")).toHaveLength(2);
    expect(table.querySelectorAll(".pill-optional")).toHaveLength(1);
    for (const pill of table.querySelectorAll(".pill")) expect(pill.querySelectorAll("svg")).toHaveLength(1);
  });

  it("lists the types, the ZIP parts, the download order and the batches", async () => {
    const { root } = await renderSettled(view, real(crafted(), 2));
    expect(headings(root)).toEqual([copy.goalHeading, copy.byYearHeading, copy.byTypeHeading, copy.byPartHeading, copy.orderHeading, copy.batchesHeading, tools.notesHeading, tools.commandHeading]);
    const [, types, parts, order, batches] = root.querySelectorAll("table") as [FakeElement, FakeElement, FakeElement, FakeElement, FakeElement];
    expect(rowsOf(types).map((r) => r[0])).toEqual(["Photos", "Videos"]);
    expect(rowsOf(parts)).toEqual([
      ["Part 1", "2 Memories", "800 MB"],
      ["Part 2", "2 Memories", "1.07 GB"],
      ["Part 3", "2 Memories", "800 MB"],
      ["No file", "2 Memories", "At least 50 MB"],
    ]);
    expect(rowsOf(order).map((r) => r.slice(0, 2))).toEqual([
      ["Step 1", "Photos, 2026"],
      ["Step 2", "Photos, 2025"],
      ["Step 3", "Videos, 2025"],
      ["Step 4", "Photos, 2024"],
      ["Step 5", "Photos, no date"],
    ]);
    // The 2025 photo has no size, so it cannot be budgeted and its row says so.
    expect(rowsOf(order)[1]).toEqual(["Step 2", "Photos, 2025", "1 Memory", "Size unknown", "Size unknown"]);
    expect(text(root, ".section p")).toContain(copy.orderNewestNote);
    expect(text(root, ".section p")).toContain(copy.batchesLine(3, "1 GB"));
    expect(rowsOf(batches).map((r) => r.slice(0, 2))).toEqual([["Batch 1", "2 Memories"], ["Batch 2", "1 Memory"], ["Batch 3", "1 Memory"]]);
    // A batch never passes 1 GB, so the third photo of 2026 starts the second batch.
    expect(rowsOf(batches)[0]).toEqual(["Batch 1", "2 Memories", "800 MB", "Year 2026", "Part 1"]);
    expect(rowsOf(batches)[1]).toEqual(["Batch 2", "1 Memory", "400 MB", "Year 2026", "Part 2"]);
    expect(rowsOf(batches)[2]).toEqual(["Batch 3", "1 Memory", "700 MB", "Year 2025", "Part 2"]);
  });

  it("lists only the first steps and batches when there are many, and says that more follow", async () => {
    const many: MemoryItem[] = [];
    for (let year = 2000; year < 2020; year++) many.push(memory(year, "image", 300), memory(year, "video", 300));
    const { root } = await renderSettled(view, real(many, 100));
    const order = root.querySelectorAll("table").find((t) => rowsOf(t)[0]?.[0] === "Step 1") as FakeElement;
    const batches = root.querySelectorAll("table").find((t) => rowsOf(t)[0]?.[0] === "Batch 1") as FakeElement;
    expect(rowsOf(order)).toHaveLength(12);
    expect(rowsOf(batches)).toHaveLength(10);
    expect(text(root, ".caption")).toEqual([copy.moreStepsLine(28), copy.moreBatchesLine(4), copy.batchSizeLine("1 GB")]);
  });

  it("says the batch size is fixed on this page and names the option of the command line tool", async () => {
    const many: MemoryItem[] = [];
    for (let year = 2000; year < 2005; year++) many.push(memory(year, "image", 300));
    const { root } = await renderSettled(view, real(many, 100));
    const line = text(root, ".caption").find((t) => t.startsWith("Batches are up to"));
    expect(line).toBe("Batches are up to 1 GB here. The command line tool changes that with --batch-gb.");
  });

  it("says oldest first when asked to", async () => {
    const r = render(view, real(crafted(), 2));
    await settled(r.root);
    const select = r.root.querySelector("select") as FakeElement;
    select.value = "oldest-first";
    said.length = 0;
    select.fire("change");
    await settled(r.root);
    expect(text(r.root, ".section p")).toContain(copy.orderOldestNote);
    const order = r.root.querySelectorAll("table").find((t) => rowsOf(t)[0]?.[0] === "Step 1") as FakeElement;
    expect(rowsOf(order)[0]?.[1]).toBe("Photos, 2024");
    expect(said).toHaveLength(1);
  });

  it("announces the plan politely once, in one short sentence", async () => {
    await renderSettled(view, real(crafted(), 2));
    expect(said).toEqual(["Storage plan ready. At least 2.69 GB of 2 GB, and 3 Memories would wait for more space."]);
    said.length = 0;
    await renderSettled(view, real(crafted(), 10));
    expect(said).toEqual(["Storage plan ready. At least 2.69 GB of 10 GB, and everything with a known size fits."]);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
  });

  it("writes each note as a short hedged sentence, and no note shows a code, a name or an id", async () => {
    const future = memory(2026, "image", 10, { date: NOW + 40 * 24 * 60 * 60 * 1000 });
    const big = memory(2023, "video", 1500);
    const items = crafted();
    const dup = { ...items[0], id: "ZQCANARY-dup" } as MemoryItem;
    const { root } = await renderSettled(view, real([...items, future, big, dup], 20));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.unsizedNote(1), copy.undatedNote(1), copy.futureNote(1), copy.oversizeNote(1)]));
    expect(notes.some((n) => /duplicate/.test(n))).toBe(true);
    for (const n of notes) {
      expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
      expect(n).not.toContain("ZQCANARY");
    }
    // The goal section says what would wait, so the notes do not say it again.
    expect(notes.join(" ")).not.toMatch(/would not fit/);
    expect(notes.join(" ")).toMatch(/may be short/);
  });

  it("shows an honest empty state, with its controls, when no Memory has a known size", async () => {
    const { root } = await renderSettled(view, real([memory(2025, "image", null), memory(2024, "video", null)]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelector("input")).not.toBeNull();
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.storage));
  });
});

describe("the controls", () => {
  it("start at the storage cap and change the plan when a goal is sent, keeping focus where it was", async () => {
    const r = render(view, real(crafted(), 2));
    await settled(r.root);
    const input = r.root.querySelector("input") as FakeElement;
    expect(input.getAttribute("value")).toBe("2");
    expect(r.root.querySelector("label[for=storage-goal]")?.textContent).toBe(copy.goalHeader);
    expect(input.getAttribute("aria-describedby")).toContain("storage-goal-help");
    expect(text(r.root, ".facts dd")).toEqual(["8", "4", "3"]);

    said.length = 0;
    input.value = "10";
    (r.root.querySelector("form") as FakeElement).fire("submit");
    await settled(r.root);
    expect(text(r.root, ".facts dd")).toEqual(["8", "7", "0"]);
    expect(r.root.querySelector("input")).toBe(input);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("of 10 GB");
  });

  it("refuses a goal that is not a number, says so, and keeps the plan it had", async () => {
    const r = render(view, real(crafted(), 2));
    await settled(r.root);
    const input = r.root.querySelector("input") as FakeElement;
    said.length = 0;
    for (const bad of ["", "abc", "0", "-3", "20000", "1e3"]) {
      input.value = bad;
      (r.root.querySelector("form") as FakeElement).fire("submit");
      expect(r.root.querySelector(".field-error")?.textContent, bad).toBe(copy.goalError);
      expect(input.getAttribute("aria-invalid"), bad).toBe("true");
    }
    expect(r.root.querySelector(".field-error")?.getAttribute("role")).toBe("alert");
    expect(text(r.root, ".facts dd")).toEqual(["8", "4", "3"]);
    expect(said).toEqual([]);
    input.value = "3";
    (r.root.querySelector("form") as FakeElement).fire("submit");
    expect(r.root.querySelector(".field-error")?.textContent).toBe("");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("has a button and a select with names, and no inline style", async () => {
    const { root } = await renderSettled(view, real(crafted()));
    expect(text(root, "form button")).toEqual([copy.updateButton]);
    expect(root.querySelector("label[for=storage-order]")?.textContent).toBe(copy.orderHeader);
    expect(text(root, "option")).toEqual([copy.newestLine, copy.oldestLine]);
    for (const el of root.descendants()) expect(el.hasAttribute("style"), el.tagName).toBe(false);
  });
});

describe("without what it needs", () => {
  it("asks for an export, says saved history is not enough, and still offers the command", async () => {
    const none = render(view, initialState());
    expect(text(none.root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(none.root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(none.root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.storage));
    expect(none.root.querySelector(".tool-result")).toBeNull();
    expect(text(render(view, stateWith({ ledger: (await sampleWorkspace()).ledger })).root, ".empty-body")).toEqual([tools.needs.exportLedgerBody]);
    await settled(none.root);
  });

  it("names the missing Memories list and points at the export check", () => {
    const { root } = render(view, real([]));
    expect(text(root, ".empty-title")).toEqual([tools.needs.memoriesTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/tools/export-check");
    expect(root.querySelector(".tool-result")).toBeNull();
  });
});

describe("the privacy rules", () => {
  it("shows no username, Memory id, link or path anywhere, and no name in an announcement or title", async () => {
    const names = [...new Set(base.friends.friends.map((f) => f.username))].filter((n) => n.length >= 5);
    for (const state of [sample, real(crafted(), 2)]) {
      said.length = 0;
      const { root } = await renderSettled(view, state);
      const page = root.textContent;
      for (const name of names) expect(page, name).not.toContain(name);
      expect(page).not.toContain("ZQCANARY");
      expect(page).not.toMatch(/https?:|\.bin\b|memories\//);
      expect(root.querySelectorAll("code.username")).toHaveLength(0);
      for (const el of root.descendants()) for (const attr of ["aria-label", "title", "alt"]) expect(el.getAttribute(attr) ?? "").not.toContain("ZQCANARY");
      for (const line of said) for (const name of names) expect(line, name).not.toContain(name);
      expect(root.querySelector("h1")?.textContent).toBe(copy.title);
    }
  });
});

describe("its copy", () => {
  it("passes the copy lint", () => {
    useNames([]);
    const entries = collectCopy({ tool_storage_planner: copy });
    expect(entries.length).toBeGreaterThan(30);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("has no function that takes a username", () => {
    for (const [key, value] of Object.entries(copy)) {
      if (typeof value === "function") expect(value.toString(), key).not.toMatch(/user/i);
    }
  });
});
