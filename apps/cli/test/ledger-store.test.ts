import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addSnapshot, emptyLedger } from "@snappy-export/core";
import type { Snapshot } from "@snappy-export/core";
import { allowlistPathFor, atomicWrite, defaultLedgerPath, isFreshStore, loadStore, saveStore } from "../src/ledger-store.ts";
import { makeIo, tempDir } from "./helpers.ts";

const io = makeIo();

const snapshot = (takenAt: number, friends: string[]): Snapshot => ({
  id: `s${takenAt}`,
  takenAt,
  source: "export",
  friends,
  sentRequests: [],
  deleted: {},
  friendSince: {},
  sentAt: {},
});

const withLedger = (...snaps: Snapshot[]) => ({ ledger: snaps.reduce((l, s) => addSnapshot(l, s), emptyLedger()), allowlist: [] as string[], checkedOff: [] as string[] });

describe("paths", () => {
  it("keeps the ledger under ~/.snappy", () => {
    expect(defaultLedgerPath(makeIo({ home: join("home", "me") }))).toBe(join("home", "me", ".snappy", "ledger.sealed"));
  });

  it("names the older companion file the way the older command line did", () => {
    expect(allowlistPathFor(join("a", "ledger.sealed"))).toBe(join("a", "ledger.allowlist.sealed"));
    expect(allowlistPathFor("custom.bin")).toBe("custom.bin.allowlist");
  });
});

describe("sealed saved history", () => {
  it("round-trips, creates missing folders, and never stores usernames in the clear", async () => {
    const path = join(tempDir("store"), "deep", "dir", "ledger.sealed");
    const saved = { ...withLedger(snapshot(1_700_000_000_000, ["visible_name_zq", "other_friend"])), allowlist: ["keeper_zq"], checkedOff: ["done_zq"] };
    await saveStore(io, path, saved, "pass phrase");

    const bytes = readFileSync(path);
    for (const name of ["visible_name_zq", "keeper_zq", "done_zq"]) expect(bytes.includes(Buffer.from(name))).toBe(false);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("SNPL");
    expect(await loadStore(io, path, "pass phrase")).toEqual(saved);
  });

  it("treats a missing file as nothing saved and a wrong passphrase as a calm, coded error", async () => {
    const path = join(tempDir("store"), "ledger.sealed");
    expect(await loadStore(io, path, "x")).toEqual({ ledger: emptyLedger(), allowlist: [], checkedOff: [] });
    expect(await isFreshStore(io, path)).toBe(true);

    await saveStore(io, path, withLedger(), "right");
    expect(await isFreshStore(io, path)).toBe(false);
    const failure = await loadStore(io, path, "zq-guess").catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: "wrong-passphrase" });
    expect(String((failure as Error).message)).not.toContain("zq-guess");
  });

  it("normalizes, sorts and de-duplicates the lists it saves", async () => {
    const path = join(tempDir("store"), "ledger.sealed");
    await saveStore(io, path, { ...withLedger(), allowlist: ["Zed_1", "amy.k", "ZED_1", " "], checkedOff: ["B", "a", "b"] }, "p");
    const loaded = await loadStore(io, path, "p");
    expect(loaded.allowlist).toEqual(["amy.k", "zed_1"]);
    expect(loaded.checkedOff).toEqual(["a", "b"]);
  });

  it("leaves no temp files behind and replaces the file in one step", async () => {
    const dir = tempDir("store");
    const path = join(dir, "ledger.sealed");
    await saveStore(io, path, withLedger(), "p");
    await saveStore(io, path, withLedger(snapshot(1, ["a_b"])), "p");
    expect(readdirSync(dir)).toEqual(["ledger.sealed"]);
    expect((await loadStore(io, path, "p")).ledger.snapshots).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")("writes owner-only files", async () => {
    const path = join(tempDir("store"), "ledger.sealed");
    await saveStore(io, path, withLedger(), "p");
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it("does not touch the old file when the write fails", async () => {
    const dir = tempDir("store");
    const path = join(dir, "ledger.sealed");
    await saveStore(io, path, withLedger(), "p");
    const before = readFileSync(path);
    // A folder where the temp/rename target would go makes the final rename fail.
    await expect(atomicWrite(io, dir, new Uint8Array([1]))).rejects.toBeTruthy();
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
