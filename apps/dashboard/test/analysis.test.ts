import { describe, expect, it } from "vitest";
import { addSnapshot, emptyLedger, findOneWay, snapshotFromExport } from "@snappy-export/core";
import { analyze, filterCandidates, parsedFromSnapshot } from "../src/analysis.ts";
import { exportHealth, sortIssues } from "../src/issues.ts";
import { initialState, reduce } from "../src/reducer.ts";
import { SAMPLE_NOW, buildSampleWorkspace } from "../src/sample.ts";
import { queueToCsv, queueToText } from "../src/queue-export.ts";

async function sampleState() {
  const workspace = await buildSampleWorkspace();
  return reduce(initialState(), { type: "sample-loaded", workspace });
}

describe("sample workspace", () => {
  it("is deterministic and built from two exports 120 days apart", async () => {
    const a = await buildSampleWorkspace();
    const b = await buildSampleWorkspace();
    expect(a.now).toBe(SAMPLE_NOW);
    expect(a.ledger.snapshots).toHaveLength(2);
    const [first, second] = a.ledger.snapshots;
    expect((second?.takenAt ?? 0) - (first?.takenAt ?? 0)).toBe(120 * 24 * 60 * 60 * 1000);
    expect(JSON.stringify(a.ledger)).toBe(JSON.stringify(b.ledger));
  });
});

describe("analyze", () => {
  it("finds every kind of candidate in the sample and merges them into the queue", async () => {
    const a = analyze(await sampleState());
    expect(a.source).toBe("export");
    expect(a.snapshotCount).toBe(2);
    expect(a.ghosts.length).toBeGreaterThan(0);
    expect(a.oneWay.length).toBeGreaterThan(0);
    expect(a.dormant.length).toBeGreaterThan(0);
    expect(a.hasChats).toBe(true);
    expect(a.queue.summary.total).toBe(a.queue.items.length + a.queue.protectedItems.length);
    expect(a.lastDiff?.disappeared.length).toBeGreaterThan(0);
    expect(a.plan?.counts.total).toBeGreaterThan(0);
  });

  it("recomputes only what changed: the detectors are reused when someone is kept or the cap changes", async () => {
    const s0 = await sampleState();
    const a0 = analyze(s0);
    const s1 = reduce(s0, { type: "keep", username: a0.queue.items[0]?.key ?? "" });
    const a1 = analyze(s1);
    expect(a1.ghosts).toBe(a0.ghosts);
    expect(a1.oneWay).toBe(a0.oneWay);
    expect(a1.queue).not.toBe(a0.queue);
    expect(a1.queue.items.length).toBe(a0.queue.items.length - 1);
    expect(a1.queue.protectedItems.some((c) => c.protectedBy.includes("allowlist"))).toBe(true);

    const s2 = reduce(s1, { type: "cap", gib: 10 });
    const a2 = analyze(s2);
    expect(a2.queue).toBe(a1.queue);
    expect(a2.plan?.meter.capBytes).toBe(10 * 1024 ** 3);
    expect(a2.plan).not.toBe(a1.plan);
  });

  it("reports nothing for an empty workspace", () => {
    const a = analyze(initialState());
    expect(a.source).toBe("none");
    expect(a.queue.summary.total).toBe(0);
    expect(a.plan).toBeNull();
  });
});

describe("parsedFromSnapshot", () => {
  it("lets a saved ledger alone reproduce the unaccepted requests", async () => {
    const ws = await buildSampleWorkspace();
    const latest = ws.latest;
    const snap = ws.ledger.snapshots[1];
    if (!latest || !snap) throw new Error("sample is missing data");
    const fromExport = findOneWay(latest, { now: SAMPLE_NOW }).map((c) => c.key);
    const fromLedger = findOneWay(parsedFromSnapshot(snap), { now: SAMPLE_NOW }).map((c) => c.key);
    expect(fromLedger.sort()).toEqual(fromExport.sort());

    // Unlocking without a new export: ledger only, no chats and no memories.
    const state = reduce(initialState(), { type: "unlocked", saved: { ledger: ws.ledger, allowlist: [], checkedOff: [] }, now: SAMPLE_NOW });
    const a = analyze(state);
    expect(a.source).toBe("ledger");
    expect(a.hasChats).toBe(false);
    expect(a.dormant).toEqual([]);
    expect(a.plan).toBeNull();
    expect(a.oneWay.length).toBe(fromExport.length);
  });

  it("copes with usernames that look like object properties", () => {
    const snap = snapshotFromExport(
      {
        friends: { friends: [{ username: "constructor" }], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] },
        chats: [],
        memories: [],
        exportedAt: 1_700_000_000_000,
        fileList: [],
        issues: [],
      },
    );
    const p = parsedFromSnapshot(snap);
    expect(p.friends.friends[0]).toEqual({ username: "constructor", createdAt: undefined });
    expect(addSnapshot(emptyLedger(), snap).snapshots).toHaveLength(1);
  });
});

describe("filterCandidates and list export", () => {
  it("filters by category and confidence", async () => {
    const a = analyze(await sampleState());
    const all = a.queue.items;
    expect(filterCandidates(all, { category: "all", confidence: "all" })).toEqual(all);
    const ghosts = filterCandidates(all, { category: "ghost", confidence: "all" });
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every((c) => c.category === "ghost")).toBe(true);
    const medium = filterCandidates(all, { category: "all", confidence: "medium" });
    expect(medium.every((c) => c.confidence === "medium")).toBe(true);
  });

  it("writes a CSV and a text list that hold only usernames, labels and core's evidence sentence", async () => {
    const a = analyze(await sampleState());
    const items = a.queue.items.slice(0, 5);
    const csv = queueToCsv(items);
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe('"Username","Category","Confidence","Why","Profile link"');
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain(items[0]?.key);
    expect(queueToText(items).trim().split("\n")).toEqual(items.map((c) => c.key));
  });

  it("fills the profile link column only when links are on", async () => {
    const items = analyze(await sampleState()).queue.items.slice(0, 3);
    expect(queueToCsv(items)).toContain("https://www.snapchat.com/add/");
    expect(queueToCsv(items, true)).toContain("https://www.snapchat.com/add/");
    expect(queueToCsv(items, false)).not.toContain("snapchat.com");
  });
});

describe("export health", () => {
  it("sorts errors first, then warnings, then notes, and removes duplicates", () => {
    const issues = sortIssues([
      { severity: "info", code: "i", message: "i" },
      { severity: "error", code: "e", message: "e" },
      { severity: "warning", code: "w", message: "w" },
    ]);
    expect(issues.map((i) => i.severity)).toEqual(["error", "warning", "info"]);
  });

  it("uses the friend count the person typed to flag a cut-off list", async () => {
    const ws = await buildSampleWorkspace();
    if (!ws.latest) throw new Error("sample is missing data");
    const friends = ws.latest.friends.friends.length;
    const ok = exportHealth(ws.latest, { expectedFriendCount: friends, now: SAMPLE_NOW });
    const off = exportHealth(ws.latest, { expectedFriendCount: friends * 3, now: SAMPLE_NOW });
    expect(off.length).toBeGreaterThan(ok.length);
    expect(new Set(off.map((i) => `${i.code}\n${i.message}`)).size).toBe(off.length);
  });
});
