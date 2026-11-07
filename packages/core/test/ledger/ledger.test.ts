import { describe, expect, it } from "vitest";
import type { Ledger, ParsedExport, Snapshot } from "../../src/types.ts";
import {
  LedgerFormatError,
  addSnapshot,
  deserializeLedger,
  diffSnapshots,
  emptyLedger,
  serializeLedger,
  snapshotFromExport,
} from "../../src/ledger/ledger.ts";

const T0 = Date.UTC(2024, 0, 1);

function snap(id: string, takenAt: number, p: Partial<Snapshot> = {}): Snapshot {
  return { id, takenAt, source: "export", friends: [], sentRequests: [], deleted: {}, friendSince: {}, sentAt: {}, ...p };
}

function parsed(p: Partial<ParsedExport["friends"]> = {}, extra: Partial<ParsedExport> = {}): ParsedExport {
  return {
    friends: { friends: [], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [], ...p },
    chats: [],
    memories: [],
    fileList: [],
    issues: [],
    ...extra,
  };
}

describe("emptyLedger", () => {
  it("is version 1 with no snapshots, fresh each call", () => {
    expect(emptyLedger()).toEqual({ version: 1, snapshots: [] });
    expect(emptyLedger()).not.toBe(emptyLedger());
  });
});

describe("snapshotFromExport", () => {
  it("normalises and dedupes usernames and keeps only timestamps", () => {
    const s = snapshotFromExport(
      parsed({
        friends: [
          { username: "Alice_X", createdAt: 500 },
          { username: " alice_x ", createdAt: 300 },
          { username: "Bob" },
          { username: "   " },
        ],
        sentRequests: [{ username: "Carol", createdAt: 700 }],
        deletedFriends: [
          { username: "Dan", deletedAt: 900 },
          { username: "dan", deletedAt: 1200 },
          { username: "Eve" },
        ],
      }),
      { takenAt: T0 },
    );
    expect(s.friends).toEqual(["alice_x", "bob"]);
    expect(s.sentRequests).toEqual(["carol"]);
    expect(s.deleted).toEqual({ dan: 1200, eve: null });
    expect(s.friendSince).toEqual({ alice_x: 300 });
    expect(s.sentAt).toEqual({ carol: 700 });
    expect(s.source).toBe("export");
    expect(s.takenAt).toBe(T0);
  });

  it("never copies unlisted fields from records into the snapshot", () => {
    const rec = { username: "Alice", createdAt: 5, displayName: "CANARY-NAME", text: "CANARY-TEXT" } as never;
    const s = snapshotFromExport(parsed({ friends: [rec] }), { takenAt: T0 });
    expect(Object.keys(s).sort()).toEqual(["deleted", "friendSince", "friends", "id", "sentAt", "sentRequests", "source", "takenAt"]);
    expect(JSON.stringify(s)).not.toContain("CANARY");
  });

  it("skips records whose username is not a string", () => {
    const s = snapshotFromExport(parsed({ friends: [{ username: 5 } as never, { username: "ok" }] }), { takenAt: T0 });
    expect(s.friends).toEqual(["ok"]);
  });

  it("takes takenAt from exportedAt, explicit option wins, and throws when unknown", () => {
    expect(snapshotFromExport(parsed({}, { exportedAt: 123456789000 })).takenAt).toBe(123456789000);
    expect(snapshotFromExport(parsed({}, { exportedAt: 1 }), { takenAt: T0 }).takenAt).toBe(T0);
    expect(() => snapshotFromExport(parsed())).toThrow(/takenAt/);
    expect(() => snapshotFromExport(parsed(), { takenAt: NaN })).toThrow(/takenAt/);
  });

  it("does not put usernames in the thrown error", () => {
    expect.assertions(1);
    try {
      snapshotFromExport(parsed({ friends: [{ username: "canary_user_77" }] }));
    } catch (e) {
      expect((e as Error).message).not.toContain("canary_user_77");
    }
  });

  it("derives a stable default id that depends on time and friends but not order", () => {
    const a = snapshotFromExport(parsed({ friends: [{ username: "a" }, { username: "b" }] }), { takenAt: T0 });
    const b = snapshotFromExport(parsed({ friends: [{ username: "B" }, { username: "A" }] }), { takenAt: T0 });
    const c = snapshotFromExport(parsed({ friends: [{ username: "a" }] }), { takenAt: T0 });
    const d = snapshotFromExport(parsed({ friends: [{ username: "a" }, { username: "b" }] }), { takenAt: T0 + 1 });
    expect(a.id).toMatch(/^export-[0-9a-f]{8}$/);
    expect(a.id).toBe(b.id);
    expect(new Set([a.id, c.id, d.id]).size).toBe(3);
    expect(snapshotFromExport(parsed(), { takenAt: T0, id: "mine" }).id).toBe("mine");
  });

  it("is safe with usernames that collide with Object.prototype members", () => {
    const s = snapshotFromExport(
      parsed({ friends: [{ username: "constructor" }, { username: "__proto__" }], deletedFriends: [{ username: "toString", deletedAt: 5 }] }),
      { takenAt: T0 },
    );
    expect(Object.hasOwn(s.deleted, "tostring")).toBe(true);
    expect(Object.getPrototypeOf(s.deleted)).toBe(Object.prototype);
    const back = deserializeLedger(serializeLedger(addSnapshot(emptyLedger(), s)));
    expect(back.snapshots[0]?.friends).toEqual(["constructor", "__proto__"]);
    expect(Object.hasOwn(back.snapshots[0]!.deleted, "tostring")).toBe(true);
  });
});

describe("addSnapshot", () => {
  it("is immutable and keeps snapshots sorted by takenAt", () => {
    const l0 = emptyLedger();
    const l1 = addSnapshot(l0, snap("b", 200));
    const l2 = addSnapshot(l1, snap("a", 100));
    const l3 = addSnapshot(l2, snap("c", 300));
    expect(l0.snapshots).toHaveLength(0);
    expect(l1.snapshots.map((s) => s.id)).toEqual(["b"]);
    expect(l3.snapshots.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("replaces a snapshot with the same id", () => {
    const l = addSnapshot(addSnapshot(emptyLedger(), snap("a", 100, { friends: ["x"] })), snap("a", 150, { friends: ["y"] }));
    expect(l.snapshots).toHaveLength(1);
    expect(l.snapshots[0]?.friends).toEqual(["y"]);
  });

  it("keeps identical-content snapshots taken within a minute", () => {
    const l = addSnapshot(addSnapshot(emptyLedger(), snap("a", 1000, { friends: ["x"] })), snap("b", 1000 + 30_000, { friends: ["x"] }));
    expect(l.snapshots.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("diffSnapshots", () => {
  it("reports every field per the contract", () => {
    const prev = snap("p", 100, {
      friends: ["stay", "gone", "byme", "bye2"],
      sentRequests: ["accepted", "ghosted", "pending", "deletedreq", "stay"],
    });
    const next = snap("n", 200, {
      friends: ["stay", "new", "accepted"],
      sentRequests: ["pending"],
      deleted: { byme: 150, bye2: null, deletedreq: 160 },
    });
    expect(diffSnapshots(prev, next)).toEqual({
      from: "p",
      to: "n",
      disappeared: ["gone"],
      removedByUser: ["bye2", "byme"],
      added: ["accepted", "new"],
      requestsAccepted: ["accepted"],
      requestsVanished: ["ghosted"],
    });
  });

  it("does not treat existing friends echoed in the sent list as requests", () => {
    const prev = snap("p", 1, { friends: ["a"], sentRequests: ["a"] });
    const next = snap("n", 2, { friends: [], sentRequests: [] });
    const d = diffSnapshots(prev, next);
    expect(d.requestsVanished).toEqual([]);
    expect(d.requestsAccepted).toEqual([]);
    expect(d.disappeared).toEqual(["a"]);
  });

  it("is empty for identical snapshots and tolerates duplicate entries", () => {
    const s = snap("s", 1, { friends: ["a", "a", "b"] });
    const d = diffSnapshots(s, { ...s, id: "t" });
    expect(d).toEqual({ from: "s", to: "t", disappeared: [], removedByUser: [], added: [], requestsAccepted: [], requestsVanished: [] });
  });

  it("does not confuse prototype-named users with deleted entries", () => {
    const prev = snap("p", 1, { friends: ["constructor"] });
    const next = snap("n", 2, { friends: [] });
    expect(diffSnapshots(prev, next).disappeared).toEqual(["constructor"]);
  });

  it("handles unicode usernames", () => {
    const prev = snap("p", 1, { friends: ["josé", "李雷", "😀"] });
    const next = snap("n", 2, { friends: ["josé"], deleted: { "李雷": 5 } });
    const d = diffSnapshots(prev, next);
    expect(d.removedByUser).toEqual(["李雷"]);
    expect(d.disappeared).toEqual(["😀"]);
  });
});

describe("serialisation", () => {
  const ledger: Ledger = addSnapshot(
    addSnapshot(
      emptyLedger(),
      snap("a", 100, {
        friends: ["x", "josé"],
        sentRequests: ["y"],
        deleted: { z: null, w: 50 },
        friendSince: { x: 10 },
        sentAt: { y: 20 },
      }),
    ),
    snap("b", 200, { source: "ui-scan", friends: ["x"] }),
  );

  it("round-trips", () => {
    expect(deserializeLedger(serializeLedger(ledger))).toEqual(ledger);
  });

  it("writes only contract fields and drops legacy name data on load", () => {
    const names = { x: { username: "X", displayName: "CANARY" } };
    const dirty = { ...snap("a", 1, { friends: ["x"] }), names } as Snapshot;
    const json = serializeLedger({ version: 1, snapshots: [dirty] });
    expect(json).not.toContain("CANARY");

    const legacy = JSON.stringify({ version: 1, snapshots: [{ ...JSON.parse(json).snapshots[0], names }] });
    const back = deserializeLedger(legacy);
    expect(back.snapshots).toHaveLength(1);
    expect("names" in back.snapshots[0]!).toBe(false);
    expect(serializeLedger(back)).not.toContain("CANARY");
  });

  it("returns an empty ledger for garbage without throwing", () => {
    const garbage = ["", "not json", "null", "42", "[]", '"str"', "{}", '{"version":1}', '{"version":"1","snapshots":[]}', '{"version":1,"snapshots":{}}'];
    for (const bad of garbage) {
      expect(deserializeLedger(bad)).toEqual(emptyLedger());
    }
  });

  it("throws LedgerFormatError only for a wrong numeric version", () => {
    expect(() => deserializeLedger('{"version":2,"snapshots":[]}')).toThrow(LedgerFormatError);
    expect(() => deserializeLedger('{"version":0,"snapshots":[]}')).toThrow(LedgerFormatError);
    expect.assertions(5);
    try {
      deserializeLedger('{"version":987654,"snapshots":[]}');
    } catch (e) {
      expect(e).toBeInstanceOf(LedgerFormatError);
      expect((e as LedgerFormatError).foundVersion).toBe(987654);
      // The message must not echo values read from the stored file.
      expect((e as Error).message).not.toContain("987654");
    }
  });

  it("drops malformed snapshots but keeps good ones", () => {
    const good = JSON.parse(serializeLedger(ledger)).snapshots[0];
    const raw = JSON.stringify({
      version: 1,
      snapshots: [
        null,
        42,
        "x",
        { ...good, id: "" },
        { ...good, id: "no-time", takenAt: "soon" },
        { ...good, id: "bad-source", source: "carrier-pigeon" },
        { ...good, id: "no-friends", friends: "alice" },
        { ...good, id: "no-deleted", deleted: undefined },
        { ...good, id: "no-sent", sentRequests: undefined },
        good,
      ],
    });
    const l = deserializeLedger(raw);
    expect(l.snapshots.map((s) => s.id)).toEqual(["a"]);
  });

  it("cleans member data: non-string friends, bad maps, case, duplicate ids, order", () => {
    const late = {
      id: "late",
      takenAt: 300,
      source: "export",
      friends: ["A", "a", 5, null, ""],
      sentRequests: [],
      deleted: { B: "garbled", C: 7 },
      friendSince: { A: "x", a2: 5 },
      sentAt: null,
    };
    const early = { id: "early", takenAt: 100, source: "export", friends: [], sentRequests: [], deleted: {} };
    const lateReplaced = { id: "late", takenAt: 400, source: "export", friends: ["z"], sentRequests: [], deleted: {} };

    const l = deserializeLedger(JSON.stringify({ version: 1, snapshots: [late, early, lateReplaced] }));
    expect(l.snapshots.map((s) => s.id)).toEqual(["early", "late"]);
    expect(l.snapshots[1]?.friends).toEqual(["z"]);

    const first = deserializeLedger(JSON.stringify({ version: 1, snapshots: [late] })).snapshots[0]!;
    expect(first.friends).toEqual(["a"]);
    expect(first.deleted).toEqual({ b: null, c: 7 });
    expect(first.friendSince).toEqual({ a2: 5 });
    expect(first.sentAt).toEqual({});
  });
});
