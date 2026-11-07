import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addSnapshot, emptyLedger } from "@snappy-export/core";
import type { Snapshot } from "@snappy-export/core";
import {
  allowlistPathFor,
  atomicWrite,
  defaultLedgerPath,
  isFreshStore,
  loadAllowlist,
  loadLedger,
  saveAllowlist,
  saveLedger,
  unlockStore,
} from "../src/ledger-store.ts";
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

describe("paths", () => {
  it("keeps the ledger under ~/.snappy and puts the allowlist next to it", () => {
    expect(defaultLedgerPath(makeIo({ home: join("home", "me") }))).toBe(join("home", "me", ".snappy", "ledger.sealed"));
    expect(allowlistPathFor(join("a", "ledger.sealed"))).toBe(join("a", "ledger.allowlist.sealed"));
    expect(allowlistPathFor("custom.bin")).toBe("custom.bin.allowlist");
  });
});

describe("sealed ledger", () => {
  it("round-trips, creates missing folders, and never stores usernames in the clear", async () => {
    const path = join(tempDir("store"), "deep", "dir", "ledger.sealed");
    const ledger = addSnapshot(emptyLedger(), snapshot(1_700_000_000_000, ["visible_name_zq", "other_friend"]));
    await saveLedger(io, path, ledger, "pass phrase");

    expect(readFileSync(path).includes(Buffer.from("visible_name_zq"))).toBe(false);
    expect(readFileSync(path).subarray(0, 4).toString("latin1")).toBe("SNPL");
    expect(await loadLedger(io, path, "pass phrase")).toEqual(ledger);
  });

  it("treats a missing ledger as none and a wrong passphrase as a calm, coded error", async () => {
    const path = join(tempDir("store"), "ledger.sealed");
    expect(await loadLedger(io, path, "x")).toBeUndefined();
    expect(await isFreshStore(io, path)).toBe(true);

    await saveLedger(io, path, emptyLedger(), "right");
    expect(await isFreshStore(io, path)).toBe(false);
    const failure = await loadLedger(io, path, "zq-guess").catch((e: unknown) => e);
    expect(failure).toMatchObject({ code: "wrong-passphrase" });
    expect(String((failure as Error).message)).not.toContain("zq-guess");
  });

  it("leaves no temp files behind and replaces the file in one step", async () => {
    const dir = tempDir("store");
    const path = join(dir, "ledger.sealed");
    await saveLedger(io, path, emptyLedger(), "p");
    await saveLedger(io, path, addSnapshot(emptyLedger(), snapshot(1, ["a_b"])), "p");
    expect(readdirSync(dir)).toEqual(["ledger.sealed"]);
    expect((await loadLedger(io, path, "p"))?.snapshots).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")("writes owner-only files", async () => {
    const path = join(tempDir("store"), "ledger.sealed");
    await saveLedger(io, path, emptyLedger(), "p");
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it("does not touch the old file when the write fails", async () => {
    const dir = tempDir("store");
    const path = join(dir, "ledger.sealed");
    await saveLedger(io, path, emptyLedger(), "p");
    const before = readFileSync(path);
    // A folder where the temp/rename target would go makes the final rename fail.
    await expect(atomicWrite(io, dir, new Uint8Array([1]))).rejects.toBeTruthy();
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("sealed allowlist", () => {
  it("round-trips normalized, sorted, de-duplicated names in a separate sealed file", async () => {
    const path = join(tempDir("store"), "ledger.sealed");
    await saveAllowlist(io, path, ["Zed_1", "amy.k", "ZED_1", " "], "p");
    const file = allowlistPathFor(path);
    expect(readFileSync(file).includes(Buffer.from("amy.k"))).toBe(false);
    expect(await loadAllowlist(io, path, "p")).toEqual(["amy.k", "zed_1"]);
    await expect(loadAllowlist(io, path, "nope")).rejects.toMatchObject({ code: "wrong-passphrase" });
  });

  it("is undefined until one is saved, and unlockStore reads both files with one passphrase", async () => {
    const path = join(tempDir("store"), "ledger.sealed");
    expect(await loadAllowlist(io, path, "p")).toBeUndefined();
    expect(await unlockStore(io, path, "p")).toEqual({ ledger: emptyLedger(), allowlist: [] });

    await saveLedger(io, path, addSnapshot(emptyLedger(), snapshot(5, ["x_y"])), "p");
    await saveAllowlist(io, path, ["x_y"], "p");
    const store = await unlockStore(io, path, "p");
    expect(store.ledger.snapshots).toHaveLength(1);
    expect(store.allowlist).toEqual(["x_y"]);
    await expect(unlockStore(io, path, "other")).rejects.toMatchObject({ code: "wrong-passphrase" });
  });
});
