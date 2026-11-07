import { describe, expect, it } from "vitest";
import {
  deserializeLedger,
  diffSnapshots,
  findGhosts,
  normUser,
  openLedger,
  sealLedger,
} from "../../src/index.ts";
import { FIXED_NOW, runPipeline } from "./pipeline-helpers.ts";
import type { PipelineResult } from "./pipeline-helpers.ts";

const r: PipelineResult = runPipeline();

const keysOf = (c: { key: string }[]) => c.map((x) => x.key);
const withPrefix = (names: string[], prefix: string) => names.filter((n) => n.startsWith(prefix));

describe("pipeline: parsing", () => {
  it("parses both phases without errors", () => {
    expect(r.parsed1.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.parsed2.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.validateIssues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("derives export times from the zip, about 120 days apart", () => {
    expect(r.parsed1.exportedAt).toBeTypeOf("number");
    expect(r.parsed2.exportedAt).toBeTypeOf("number");
    const gap = (r.parsed2.exportedAt! - r.parsed1.exportedAt!) / 86_400_000;
    expect(gap).toBeGreaterThan(118);
    expect(gap).toBeLessThan(122);
  });

  it("produces chat events and memories", () => {
    expect(r.parsed2.chats.length).toBeGreaterThan(500);
    expect(r.parsed2.chats.some((c) => c.isGroup)).toBe(true);
    expect(r.parsed2.memories.length).toBeGreaterThan(100);
  });

  it("stores only normalised usernames in snapshots", () => {
    for (const s of [r.snap1, r.snap2]) {
      for (const f of s.friends) expect(f).toBe(normUser(f));
    }
  });
});

describe("pipeline: ledger", () => {
  it("diffs the two snapshots into ghosts vs user removals", () => {
    const d = diffSnapshots(r.snap1, r.snap2);
    expect(withPrefix(d.disappeared, "ghost_").length).toBeGreaterThan(0);
    expect(withPrefix(d.disappeared, "removed_")).toEqual([]);
    expect(withPrefix(d.removedByUser, "removed_").length).toBeGreaterThan(0);
    expect(withPrefix(d.added, "newfriend_").length).toBeGreaterThan(0);
  });

  it("round-trips through serialisation", () => {
    expect(deserializeLedger(r.serialized)).toEqual(r.ledger);
  });
});

describe("pipeline: detectors", () => {
  it("finds every ghost_* and never marks one 'high' with one prior snapshot", () => {
    const expected = withPrefix(r.snap1.friends, "ghost_");
    expect(expected.length).toBeGreaterThan(0);
    const found = keysOf(r.ghosts);
    for (const k of expected) expect(found).toContain(k);
    for (const c of r.ghosts) {
      expect(c.category).toBe("ghost");
      expect(c.confidence).not.toBe("high");
      expect(c.score).toBeLessThan(0.75);
    }
  });

  it("finds no ghosts from a single snapshot", () => {
    expect(r.ghostsOneSnapshot).toEqual([]);
  });

  it("does not flag removed_* (deleted by the user) as ghosts", () => {
    expect(withPrefix(keysOf(r.ghosts), "removed_")).toEqual([]);
  });

  it("does not flag anyone but ghost_* as a ghost", () => {
    const g = keysOf(r.ghosts);
    for (const p of ["newfriend_", "active_", "dormant_", "exfriend_", "oneway_"]) expect(withPrefix(g, p)).toEqual([]);
  });

  it("finds oneway_*", () => {
    const expected = withPrefix(r.snap2.sentRequests, "oneway_");
    expect(expected.length).toBeGreaterThan(0);
    const found = keysOf(r.oneWay);
    for (const k of expected) expect(found).toContain(k);
    for (const c of r.oneWay) {
      expect(c.category).toBe("one-way");
      expect(c.confidence).not.toBe("high");
    }
  });

  it("finds dormant_* and rates every one of them 'low'", () => {
    const expected = new Set(withPrefix(r.snap2.friends, "dormant_"));
    expect(expected.size).toBeGreaterThan(0);
    const found = keysOf(r.dormant);
    expect(found.some((k) => expected.has(k))).toBe(true);
    for (const c of r.dormant) {
      expect(c.category).toBe("dormant");
      expect(c.confidence).toBe("low");
    }
  });

  it("never flags active_* or newfriend_* as dormant or one-way", () => {
    const k = [...keysOf(r.dormant), ...keysOf(r.oneWay)];
    expect(withPrefix(k, "active_")).toEqual([]);
    expect(withPrefix(k, "newfriend_")).toEqual([]);
  });
});

describe("pipeline: cleanup queue", () => {
  const queued = () => r.queue.items.map((c) => c.key);
  const protectedKeys = () => r.queue.protectedItems.map((c) => c.key);

  it("excludes newfriend_* and removed_* entirely", () => {
    const all = [...queued(), ...protectedKeys()];
    expect(withPrefix(all, "newfriend_")).toEqual([]);
    expect(withPrefix(all, "removed_")).toEqual([]);
  });

  it("keeps active_* out of the removable items", () => {
    expect(withPrefix(queued(), "active_")).toEqual([]);
  });

  it("queues ghosts, one-way and dormant candidates, sorted by score", () => {
    const cats = new Set(r.queue.items.map((c) => c.category));
    expect(cats.has("ghost")).toBe(true);
    expect(cats.has("one-way")).toBe(true);
    const scores = r.queue.items.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(r.queue.generatedAt).toBe(FIXED_NOW);
    expect(r.queue.summary.protectedCount).toBe(r.queue.protectedItems.length);
  });

  it("honours the allowlist", () => {
    const target = r.queue.items[0]!.key;
    const q = runPipeline({ allowlist: [target] }).queue;
    expect(q.items.map((c) => c.key)).not.toContain(target);
    expect(q.protectedItems.find((c) => c.key === target)?.protectedBy).toContain("allowlist");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(runPipeline().queue)).toBe(JSON.stringify(r.queue));
  });
});

describe("pipeline: memories plan", () => {
  it("plans every unique memory with unique paths and reports duplicates", () => {
    const paths = r.plan.entries.map((e) => e.relativePath.toLowerCase());
    expect(new Set(paths).size).toBe(paths.length);
    expect(r.plan.entries.length + r.plan.duplicates.length).toBe(r.parsed2.memories.length);
    expect(r.plan.duplicates.length).toBeGreaterThan(0);
    expect(r.plan.counts.total).toBe(r.plan.entries.length);
    expect(r.plan.counts.images + r.plan.counts.videos + r.plan.counts.unknown).toBe(r.plan.counts.total);
  });

  it("phase 1 memories are a subset of phase 2 in size", () => {
    expect(r.parsed1.memories.length).toBeLessThanOrEqual(r.parsed2.memories.length);
  });
});

describe("pipeline: sealing", () => {
  it("round-trips the ledger through seal/open and rejects a wrong passphrase", async () => {
    const sealed = await sealLedger(r.ledger, "correct horse battery staple");
    const opened = await openLedger(sealed, "correct horse battery staple");
    expect(opened).toEqual(r.ledger);
    await expect(openLedger(sealed, "wrong passphrase")).rejects.toThrow();
  });

  it("detectors give the same answer on the reopened ledger", async () => {
    const sealed = await sealLedger(r.ledger, "pw-123456");
    const opened = await openLedger(sealed, "pw-123456");
    expect(JSON.stringify(findGhosts(opened.snapshots, { now: r.now }))).toBe(JSON.stringify(r.ghosts));
  });
});
