/**
 * The Overview's Next steps card (a static list of links, in order) and its Copy summary button: the counts as one
 * hedged line, never a username, and only the counts that could be worked out.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../src/analysis.ts";
import { lists } from "../src/copy-lists.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { all, byLabel, mount, sampleStateOf, textOf } from "./lists-harness.ts";
import { sampleWorkspace } from "./tools/harness.ts";

const copied: string[] = [];
const spoken: string[] = [];
vi.mock("../src/announce.ts", () => ({ announce: (m: string) => void spoken.push(m) }));
vi.mock("../src/clipboard.ts", () => ({
  copyText: async (text: string) => {
    copied.push(text);
    return true;
  },
}));

let overviewView: View;
let summaryText: (a: ReturnType<typeof analyze>) => string;
let sample: State;

beforeAll(async () => {
  const mod = (await import("../src/views/overview.ts")) as { overviewView: View; summaryText: typeof summaryText };
  overviewView = mod.overviewView;
  summaryText = mod.summaryText;
  sample = await sampleStateOf();
}, 120_000);
beforeEach(() => {
  copied.length = 0;
  spoken.length = 0;
});

describe("the summary line", () => {
  it("holds the counts, hedged, and no username", () => {
    const a = analyze(sample);
    const text = summaryText(a);
    expect(text).toBe(`${a.ghosts.length} may have removed me, ${a.oneWay.length} unaccepted requests, ${a.dormant.length} quiet, ${a.queue.items.length} to review.`);
    expect(text).toContain("10 may have removed me");
    for (const c of [...a.ghosts, ...a.oneWay, ...a.dormant, ...a.queue.items]) expect(text).not.toContain(c.key);
    expect(text).toMatch(/^[\d a-z,.]+$/);
  });

  it("leaves out a count that could not be worked out", async () => {
    const ws = await sampleWorkspace();
    const base = initialState();
    // One snapshot and no chat history: no disappeared count and no quiet count.
    const onlyOne = { ...ws, ledger: { ...ws.ledger, snapshots: ws.ledger.snapshots.slice(-1) }, latest: { ...ws.latest!, chats: [] } };
    const text = summaryText(analyze({ ...base, real: onlyOne }));
    expect(text).not.toContain("may have removed me");
    expect(text).not.toContain("quiet");
    expect(text).toContain("unaccepted request");
    expect(text).toContain("to review");
  });

  it("says one request in the singular", () => {
    expect(lists.summaryRequests(1)).toBe("1 unaccepted request");
    expect(lists.summaryRequests(2)).toBe("2 unaccepted requests");
  });
});

describe("the Next steps card", () => {
  it("lists the steps in order as links, the queue first", () => {
    const { root } = mount(overviewView, sample);
    const list = all(root, "ol.next-list")[0]!;
    expect(all(list, "a").map((a) => [textOf(a), a.getAttribute("href")])).toEqual([
      [lists.nextCleanup, "#/cleanup"],
      [lists.nextBackup, "#/tools/friends-backup"],
      [lists.nextReminder, "#/tools/export-reminder"],
      [lists.nextOnThisDay, "#/tools/memories-on-this-day"],
    ]);
    expect(all(root, "h2").map((h) => textOf(h))).toContain(lists.nextHeading);
  });

  it("copies the summary when Copy summary is pressed, and says so", async () => {
    const { root } = mount(overviewView, sample);
    byLabel(root, lists.copySummaryButton)!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(copied).toEqual([summaryText(analyze(sample))]);
    expect(spoken).toEqual([lists.summaryCopied]);
    expect(textOf(root)).toContain(lists.summaryNote);
  });

  it("is not drawn before there is an export", () => {
    const { root } = mount(overviewView, initialState());
    expect(all(root, "ol.next-list")).toHaveLength(0);
    expect(byLabel(root, lists.copySummaryButton)).toBeUndefined();
  });
});
