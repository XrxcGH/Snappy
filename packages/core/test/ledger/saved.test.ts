import { describe, expect, it } from "vitest";
import {
  CHECKED_OFF_ID,
  KEEP_LIST_ID,
  addSnapshot,
  crc32,
  deserializeLedger,
  emptyLedger,
  hasSavedLists,
  mergeSaved,
  openLedger,
  packSaved,
  sealLedger,
  serializeLedger,
  sortedUnique,
  unpackSaved,
} from "../../src/index.ts";
import type { Snapshot } from "../../src/index.ts";

const snap = (id: string, takenAt: number, friends: string[]): Snapshot => ({ id, takenAt, source: "export", friends, sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} });

describe("packSaved / unpackSaved", () => {
  it("round-trips the ledger, keep list and checkmarks through the ledger format", () => {
    const ledger = addSnapshot(addSnapshot(emptyLedger(), snap("a", 1000, ["x", "y"])), snap("b", 2000, ["x"]));
    const saved = { ledger, allowlist: ["keeper", "zed"], checkedOff: ["done_1"] };
    const packed = deserializeLedger(serializeLedger(packSaved(saved)));
    expect(unpackSaved(packed)).toEqual(saved);
  });

  it("survives sealing and opening with a passphrase", async () => {
    const saved = { ledger: addSnapshot(emptyLedger(), snap("a", 1000, ["x"])), allowlist: ["k"], checkedOff: ["c"] };
    expect(unpackSaved(await openLedger(await sealLedger(packSaved(saved), "pass phrase"), "pass phrase"))).toEqual(saved);
  });

  it("never lets the reserved lists reach the detectors", () => {
    const packed = packSaved({ ledger: addSnapshot(emptyLedger(), snap("a", 1000, ["x"])), allowlist: ["k"], checkedOff: [] });
    expect(packed.snapshots.map((s) => s.id)).toContain(KEEP_LIST_ID);
    expect(packed.snapshots.map((s) => s.id)).toContain(CHECKED_OFF_ID);
    expect(unpackSaved(packed).ledger.snapshots.map((s) => s.id)).toEqual(["a"]);
  });

  it("drops a reserved id smuggled in as a real snapshot", () => {
    const sneaky = addSnapshot(emptyLedger(), snap(KEEP_LIST_ID, 5, ["evil"]));
    expect(packSaved({ ledger: sneaky, allowlist: [], checkedOff: [] }).snapshots.find((s) => s.id === KEEP_LIST_ID)?.friends).toEqual([]);
  });

  it("recognizes the shared format by the keep-list marker", () => {
    expect(hasSavedLists(packSaved({ ledger: emptyLedger(), allowlist: [], checkedOff: [] }))).toBe(true);
    expect(hasSavedLists(addSnapshot(emptyLedger(), snap("a", 1000, ["x"])))).toBe(false);
    expect(hasSavedLists(emptyLedger())).toBe(false);
  });
});

describe("sortedUnique", () => {
  it("normalises, de-duplicates and sorts", () => {
    expect(sortedUnique(["B", "a", " b ", "", "A"])).toEqual(["a", "b"]);
  });
});

describe("mergeSaved", () => {
  it("combines saved data with what was added before unlocking, without changing either", () => {
    const saved = { ledger: addSnapshot(emptyLedger(), snap("old", 1000, ["x"])), allowlist: ["k1"], checkedOff: [] as string[] };
    const session = { ledger: addSnapshot(emptyLedger(), snap("new", 2000, ["y"])), allowlist: ["k2"], checkedOff: ["c"] };
    const before = JSON.stringify([saved, session]);
    const merged = mergeSaved(saved, session);
    expect(merged.ledger.snapshots.map((s) => s.id)).toEqual(["old", "new"]);
    expect(merged.allowlist).toEqual(["k1", "k2"]);
    expect(merged.checkedOff).toEqual(["c"]);
    expect(JSON.stringify([saved, session])).toBe(before);
  });
});

describe("crc32", () => {
  it("is exported with the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
