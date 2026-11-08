/**
 * Save list and Copy list above each finding list (Disappeared, Unaccepted requests, Quiet), with the file names
 * snappy-<area>.csv, holding the rows that are showing. The Cleanup queue keeps its own file name.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../src/analysis.ts";
import { cleanup } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { clearSearches } from "../src/components/listSearch.ts";
import { queueToCsv, queueToText } from "../src/queue-export.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import type { FakeElement } from "./fake-dom.ts";
import { all, byLabel, mount, sampleStateOf } from "./lists-harness.ts";

const saved: { name: string; text: string; mime: string }[] = [];
const copied: string[] = [];
vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));
vi.mock("../src/download.ts", () => ({
  saveTextFile: (name: string, text: string, mime: string) => {
    saved.push({ name, text, mime });
    return true;
  },
}));
vi.mock("../src/clipboard.ts", () => ({
  copyText: async (text: string) => {
    copied.push(text);
    return true;
  },
}));

let views: Record<string, View>;
let sample: State;

beforeAll(async () => {
  const { disappearedView, requestsView, quietView } = (await import("../src/views/findings.ts")) as Record<string, View>;
  const { cleanupView } = (await import("../src/views/cleanup.ts")) as Record<string, View>;
  views = { ghost: disappearedView!, "one-way": requestsView!, dormant: quietView!, queue: cleanupView! };
  sample = await sampleStateOf();
}, 120_000);
beforeEach(() => {
  saved.length = 0;
  copied.length = 0;
  clearSearches();
});
afterEach(() => vi.useRealTimers());

const itemsOf = (key: string): ReturnType<typeof analyze>["ghosts"] => {
  const a = analyze(sample);
  return key === "ghost" ? a.ghosts : key === "one-way" ? a.oneWay : key === "dormant" ? a.dormant : a.queue.items;
};
const buttonsOf = (root: FakeElement): { save: FakeElement; copy: FakeElement } => ({
  save: byLabel(root, cleanup.saveList)!,
  copy: byLabel(root, cleanup.copyList)!,
});

describe.each([
  ["ghost", "snappy-disappeared.csv"],
  ["one-way", "snappy-requests.csv"],
  ["dormant", "snappy-quiet.csv"],
])("the %s list page", (key, fileName) => {
  it("has Save list and Copy list, enabled, above the rows", () => {
    const { root } = mount(views[key]!, sample);
    const { save, copy } = buttonsOf(root);
    expect(save).toBeDefined();
    expect(copy).toBeDefined();
    expect(save.hasAttribute("disabled")).toBe(false);
    expect(copy.hasAttribute("disabled")).toBe(false);
    const order = root.descendants();
    expect(order.indexOf(save)).toBeLessThan(order.indexOf(all(root, "li.candidate")[0]!));
  });

  it("saves the rows as a spreadsheet file with the area's name, and copies the names one per line", async () => {
    const { root } = mount(views[key]!, sample);
    const items = itemsOf(key);
    const { save, copy } = buttonsOf(root);
    save.click();
    expect(saved).toEqual([{ name: fileName, text: queueToCsv(items), mime: "text/csv" }]);
    copy.click();
    await Promise.resolve();
    expect(copied).toEqual([queueToText(items)]);
  });

  it("holds only the rows that match the search", async () => {
    vi.useFakeTimers();
    const { root } = mount(views[key]!, sample);
    const items = itemsOf(key);
    const part = items[0]!.key.slice(0, 5);
    const box = all(root, "input[type=search]")[0]!;
    box.value = part;
    box.fire("input");
    vi.advanceTimersByTime(120);
    const matching = items.filter((c) => c.key.toLowerCase().includes(part.toLowerCase()));
    buttonsOf(root).save.click();
    expect(saved[0]?.text).toBe(queueToCsv(matching));
    expect(saved[0]?.name).toBe(fileName);
  });
});

describe("the Cleanup queue", () => {
  it("keeps its own file name", () => {
    const { root } = mount(views.queue!, sample);
    buttonsOf(root).save.click();
    expect(saved[0]?.name).toBe(cleanup.csvFile);
    expect(lists.areas.ghost.csvFile).not.toBe(cleanup.csvFile);
  });
});
