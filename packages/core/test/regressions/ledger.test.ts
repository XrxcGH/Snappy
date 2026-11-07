/**
 * Regression tests for the ledger and detectors: caps lost in the queue merge, a ghost and a
 * one-way candidate counted as two observations, blocked users, ui-scan snapshots, repeated
 * truncated exports, same-day re-imports, non-adjacent diffs and Buffer input to openLedger.
 */
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addSnapshot,
  buildCleanupQueue,
  deserializeLedger,
  diffSnapshots,
  emptyLedger,
  findGhosts,
  findOneWay,
  openLedger,
  sealLedger,
  serializeLedger,
  snapshotFromExport,
} from "../../src/index.ts";
import type { FriendRecord, ParsedExport, Snapshot } from "../../src/types.ts";
import { DAY_MS } from "../../src/util.ts";

const T0 = Date.UTC(2024, 0, 1);
const NOW = Date.UTC(2025, 6, 1);
const YEAR = 365 * DAY_MS;

function snap(id: string, day: number, p: Partial<Snapshot> = {}): Snapshot {
  return { id, takenAt: T0 + day * DAY_MS, source: "export", friends: [], sentRequests: [], deleted: {}, friendSince: {}, sentAt: {}, ...p };
}
const crowd = (n: number, prefix = "u") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const signals = (c: { evidence: { signal: string }[] }) => c.evidence.map((e) => e.signal);

function exp(p: Partial<ParsedExport["friends"]> = {}): ParsedExport {
  return {
    friends: { friends: [{ username: "basefriend" }], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [], ...p },
    chats: [],
    memories: [],
    fileList: [],
    issues: [],
  };
}
const rec = (username: string, createdAt?: number): FriendRecord => ({ username, ...(createdAt !== undefined ? { createdAt } : {}) });

describe("buildCleanupQueue keeps detector caps", () => {
  it("a mass-disappearance cap survives the merge", () => {
    const snaps = [snap("a", 0, { friends: crowd(10) }), snap("b", 30, { friends: crowd(2) })];
    const ghosts = findGhosts(snaps, { now: NOW });
    expect(ghosts).toHaveLength(8);
    for (const g of ghosts) expect(g.confidence).toBe("low");

    const q = buildCleanupQueue(ghosts, [], { now: NOW, minConfidence: "medium" });
    expect(q.items).toEqual([]);
    const all = buildCleanupQueue(ghosts, [], { now: NOW });
    expect(all.items).toHaveLength(8);
    for (const item of all.items) {
      expect(item.confidence).toBe("low");
      expect(item.score).toBeCloseTo(ghosts.find((g) => g.key === item.key)!.score, 10);
    }
  });

  it("a date-range cutoff cap survives the merge", () => {
    const friends = crowd(10);
    const snaps = [
      snap("a", 0, { friends: [...friends, "old1", "old2"], friendSince: { old1: T0 - 5 * YEAR, old2: T0 - 6 * YEAR, ...Object.fromEntries(friends.map((f) => [f, T0 - YEAR])) } }),
      snap("b", 30, { friends, friendSince: Object.fromEntries(friends.map((f) => [f, T0 - YEAR])) }),
    ];
    const ghosts = findGhosts(snaps, { now: NOW });
    expect(ghosts.length).toBe(2);
    expect(signals(ghosts[0]!)).toContain("looks-like-date-range-cutoff");
    const q = buildCleanupQueue(ghosts, [], { now: NOW, minConfidence: "medium" });
    expect(q.items).toEqual([]);
  });

  it("uncapped detector output still merges to the same score", () => {
    const friends = crowd(10);
    const ghosts = findGhosts([snap("a", 0, { friends: [...friends, "x"] }), snap("b", 30, { friends })], { now: NOW });
    const q = buildCleanupQueue(ghosts, [], { now: NOW });
    expect(q.items[0]!.score).toBeCloseTo(ghosts[0]!.score, 10);
  });
});

describe("a former friend still echoed in the sent list", () => {
  it("is not inflated to high by counting 'not a friend' twice", () => {
    const friends = crowd(10);
    const snaps = [
      snap("a", 0, { friends: [...friends, "x"], friendSince: { x: T0 - 3 * YEAR } }),
      snap("b", 30, { friends }),
    ];
    const ghost = findGhosts(snaps, { now: NOW });
    const oneWay = findOneWay(exp({ friends: friends.map((u) => rec(u)), sentRequests: [rec("x", NOW - 3 * YEAR)] }), { now: NOW });
    expect(ghost).toHaveLength(1);
    expect(oneWay).toHaveLength(1);
    expect(ghost[0]!.confidence).toBe("medium");
    expect(oneWay[0]!.confidence).toBe("medium");

    const q = buildCleanupQueue([...ghost, ...oneWay], [], { now: NOW });
    expect(q.items).toHaveLength(1);
    const item = q.items[0]!;
    expect(item.category).toBe("ghost");
    expect(item.confidence).toBe("medium");
    expect(item.score).toBeCloseTo(ghost[0]!.score, 10);
    // The one-way evidence is still shown, it just adds no score of its own.
    expect(signals(item)).toContain("request-never-accepted");
  });

  it("independent categories still combine", () => {
    const q = buildCleanupQueue(
      [
        { key: "p", category: "ghost", confidence: "low", score: 0.3, evidence: [{ signal: "g", detail: "g", weight: 0.3 }], protectedBy: [] },
        { key: "p", category: "dormant", confidence: "low", score: 0.3, evidence: [{ signal: "d", detail: "d", weight: 0.3 }], protectedBy: [] },
      ],
      [],
      { now: NOW },
    );
    expect(q.items[0]!.score).toBeCloseTo(1 - 0.7 * 0.7, 10);
  });
});

describe("blocked users are not ghosts", () => {
  const withFriends = (friends: string[], blocked: string[] = []): ParsedExport => exp({ friends: friends.map((u) => rec(u)), blocked: blocked.map((u) => rec(u)) });

  it("snapshotFromExport records the blocked list and omits it when empty", () => {
    expect(snapshotFromExport(withFriends(["a"], ["Blockedguy"]), { takenAt: T0 }).blocked).toEqual(["blockedguy"]);
    expect("blocked" in snapshotFromExport(withFriends(["a"]), { takenAt: T0 })).toBe(false);
  });

  it("findGhosts does not report someone the user blocked", () => {
    const base = crowd(10);
    const s1 = snapshotFromExport(withFriends([...base, "blockedguy", "gone"]), { takenAt: T0 });
    const s2 = snapshotFromExport(withFriends(base, ["blockedguy"]), { takenAt: T0 + 30 * DAY_MS });
    expect(findGhosts([s1, s2], { now: NOW }).map((c) => c.key)).toEqual(["gone"]);
  });

  it("the blocked list survives serialisation, and old ledgers without it still load", () => {
    const s = snapshotFromExport(withFriends(["a"], ["b"]), { takenAt: T0 });
    const back = deserializeLedger(serializeLedger(addSnapshot(emptyLedger(), s)));
    expect(back.snapshots[0]!.blocked).toEqual(["b"]);
    const legacy = JSON.parse(serializeLedger(addSnapshot(emptyLedger(), snap("old", 0)))) as { snapshots: Record<string, unknown>[] };
    expect("blocked" in legacy.snapshots[0]!).toBe(false);
    expect(deserializeLedger(JSON.stringify(legacy)).snapshots[0]!.blocked).toBeUndefined();
  });
});

describe("ui-scan snapshots cannot rule out a deletion by the user", () => {
  it("does not credit not-deleted-by-you and caps the score at low", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [snap("a", 0, { friends: [...friends, "x"] }), snap("b", 30, { source: "ui-scan", friends })],
      { now: NOW },
    );
    expect(out).toHaveLength(1);
    expect(signals(out[0]!)).not.toContain("not-deleted-by-you");
    expect(signals(out[0]!)).toContain("deletions-not-observable");
    expect(out[0]!.confidence).toBe("low");
  });

  it("a later export (which lists deletions) restores the normal evidence", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [snap("a", 0, { friends: [...friends, "x"] }), snap("b", 30, { source: "ui-scan", friends }), snap("c", 60, { friends })],
      { now: NOW },
    );
    expect(signals(out[0]!)).toContain("not-deleted-by-you");
  });
});

describe("repeated truncated exports", () => {
  it("20 -> 6 -> 5 friends stays flagged and capped", () => {
    const all = crowd(20);
    const out = findGhosts(
      [snap("a", 0, { friends: all }), snap("b", 30, { friends: all.slice(0, 6) }), snap("c", 60, { friends: all.slice(0, 5) })],
      { now: NOW },
    );
    expect(out).toHaveLength(15);
    for (const c of out) {
      expect(signals(c)).toContain("mass-disappearance");
      expect(c.confidence).toBe("low");
    }
  });

  it("a gradual real decline is not flagged", () => {
    const all = crowd(20);
    const out = findGhosts(
      [snap("a", 0, { friends: all }), snap("b", 30, { friends: all.slice(0, 12) }), snap("c", 60, { friends: all.slice(0, 8) }), snap("d", 90, { friends: all.slice(0, 5) })],
      { now: NOW },
    );
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(signals(c)).not.toContain("mass-disappearance");
  });
});

describe("same-day re-imports are not new sightings", () => {
  it("four imports of the same export count once", () => {
    const friends = crowd(10);
    const hours = (h: number) => h / 24;
    const out = findGhosts(
      [
        snap("a", 0, { friends: [...friends, "x"] }),
        snap("b", hours(1), { friends: [...friends, "x"] }),
        snap("c", hours(2), { friends: [...friends, "x"] }),
        snap("d", hours(3), { friends: [...friends, "x"] }),
        snap("e", 30, { friends }),
      ],
      { now: NOW },
    );
    const was = out[0]!.evidence.find((e) => e.signal === "was-friend-in-earlier-export")!;
    expect(was.weight).toBe(0.15);
    expect(was.detail).toContain("1 earlier export;");
  });

  it("distinct days still accumulate", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [0, 5, 10, 15].map((d, i) => snap(`s${i}`, d, { friends: [...friends, "x"] })).concat(snap("last", 60, { friends })),
      { now: NOW },
    );
    const was = out[0]!.evidence.find((e) => e.signal === "was-friend-in-earlier-export")!;
    expect(was.weight).toBeCloseTo(0.2, 10);
  });
});

describe("diffSnapshots across non-adjacent snapshots", () => {
  const s1 = snap("s1", 0, { friends: ["x", "y"] });
  const s2 = snap("s2", 10, { friends: ["y"], deleted: { x: null } });
  const s3 = snap("s3", 20, { friends: ["y"] });

  it("is unchanged for an adjacent pair", () => {
    expect(diffSnapshots(s1, s2).removedByUser).toEqual(["x"]);
  });

  it("uses the snapshots in between to explain a user deletion", () => {
    expect(diffSnapshots(s1, s3).disappeared).toEqual(["x"]); // no context: cannot know
    const d = diffSnapshots(s1, s3, [s2]);
    expect(d.disappeared).toEqual([]);
    expect(d.removedByUser).toEqual(["x"]);
  });
});

describe("openLedger with a Node Buffer", () => {
  it("opens a sealed ledger that is a view into a larger shared buffer", async () => {
    const ledger = addSnapshot(emptyLedger(), snap("a", 0, { friends: ["alice"] }));
    const sealed = await sealLedger(ledger, "correct horse");

    const pool = new Uint8Array(sealed.length + 128).fill(7);
    pool.set(sealed, 64);
    const view = Buffer.from(pool.buffer, 64, sealed.length);
    expect(view.byteOffset).toBe(64);
    expect(deserializeLedger(serializeLedger(await openLedger(view, "correct horse")))).toEqual(ledger);

    // And the common route: bytes read back from disk.
    const dir = mkdtempSync(join(tmpdir(), "snappy-seal-"));
    try {
      const file = join(dir, "ledger.bin");
      writeFileSync(file, sealed);
      expect((await openLedger(readFileSync(file), "correct horse")).snapshots).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("still rejects a wrong passphrase", async () => {
    const sealed = await sealLedger(emptyLedger(), "right");
    await expect(openLedger(Buffer.from(sealed), "wrong")).rejects.toThrow("decryption failed");
  }, 20_000);
});
