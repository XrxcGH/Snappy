import { describe, expect, it } from "vitest";
import { addSnapshot, deserializeLedger, emptyLedger, serializeLedger } from "@snappy-export/core";
import type { Snapshot } from "@snappy-export/core";
import { CHECKED_OFF_ID, KEEP_LIST_ID, mergeSaved, packSaved, sortedUnique, unpackSaved } from "../src/persist-codec.ts";

const snap = (id: string, takenAt: number, friends: string[]): Snapshot => ({ id, takenAt, source: "export", friends, sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} });

describe("packSaved / unpackSaved", () => {
  it("round-trips the ledger, keep list and checkmarks through core's own ledger format", () => {
    const ledger = addSnapshot(addSnapshot(emptyLedger(), snap("a", 1000, ["x", "y"])), snap("b", 2000, ["x"]));
    const saved = { ledger, allowlist: ["keeper", "zed"], checkedOff: ["done_1"] };
    const packed = deserializeLedger(serializeLedger(packSaved(saved)));
    expect(unpackSaved(packed)).toEqual(saved);
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
