/**
 * One shared saved-history file: the command line and the dashboard read and write the same bytes,
 * and an older command line's separate keep-list file is read once and then left alone.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEEP_LIST_ID, addSnapshot, deserializeLedger, emptyLedger, hasSavedLists, openLedger, openText, packSaved, sealLedger, sealText, serializeLedger, unpackSaved } from "@snappy-export/core";
import type { Snapshot } from "@snappy-export/core";
import { allowlistPathFor, isFreshStore, loadStore, saveStore } from "../src/ledger-store.ts";
import { LATER, makeIo, run, tempDir, writeDemoPair } from "./helpers.ts";

const PASS = "a long shared passphrase";
const io = makeIo();

const snap = (takenAt: number, friends: string[]): Snapshot => ({ id: `s${takenAt}`, takenAt, source: "export", friends, sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} });

/** What an older command line wrote: a pure ledger, plus its keep list in a second sealed file. */
async function writeOlderFiles(ledgerPath: string, names: string[]): Promise<void> {
  writeFileSync(ledgerPath, await sealLedger(addSnapshot(emptyLedger(), snap(1000, ["x_y"])), PASS));
  writeFileSync(allowlistPathFor(ledgerPath), await sealText(JSON.stringify({ allowlist: names }), PASS));
}

describe("the shared format", () => {
  it("is the dashboard's own sealed blob: the lists ride as reserved pseudo-snapshots", async () => {
    const path = join(tempDir("saved"), "ledger.sealed");
    await saveStore(io, path, { ledger: addSnapshot(emptyLedger(), snap(1000, ["x_y"])), allowlist: ["k"], checkedOff: ["c"] }, PASS);
    const packed = await openLedger(readFileSync(path), PASS);
    expect(hasSavedLists(packed)).toBe(true);
    expect(packed.snapshots.map((s) => s.id)).toContain(KEEP_LIST_ID);
    // The same bytes decode with core's codec, as the dashboard does it.
    expect(unpackSaved(deserializeLedger(serializeLedger(packed)))).toEqual({ ledger: addSnapshot(emptyLedger(), snap(1000, ["x_y"])), allowlist: ["k"], checkedOff: ["c"] });
  });

  it("reads a blob the dashboard wrote", async () => {
    const path = join(tempDir("saved"), "ledger.sealed");
    const saved = { ledger: addSnapshot(emptyLedger(), snap(2000, ["a_b"])), allowlist: ["keep_1"], checkedOff: ["gone_1"] };
    writeFileSync(path, await sealLedger(packSaved(saved), PASS));
    expect(await loadStore(io, path, PASS)).toEqual(saved);
  });
});

describe("an older command line's separate keep list", () => {
  it("is read once when the ledger has no lists yet, and neither file is rewritten by reading", async () => {
    const dir = tempDir("saved");
    const path = join(dir, "ledger.sealed");
    await writeOlderFiles(path, ["old_keep", "other_keep"]);
    const before = [readFileSync(path), readFileSync(allowlistPathFor(path))];
    const loaded = await loadStore(io, path, PASS);
    expect(loaded.allowlist).toEqual(["old_keep", "other_keep"]);
    expect(loaded.ledger.snapshots).toHaveLength(1);
    expect(readFileSync(path).equals(before[0] as Buffer)).toBe(true);
    expect(readFileSync(allowlistPathFor(path)).equals(before[1] as Buffer)).toBe(true);
    expect(await isFreshStore(io, path)).toBe(false);
  });

  it("is merged into the shared file on the next save, and then ignored, so unkeep cannot bring a name back", async () => {
    const dir = tempDir("saved");
    const path = join(dir, "ledger.sealed");
    await writeOlderFiles(path, ["old_keep", "other_keep"]);
    const env = { SNAPPY_PASSPHRASE: PASS };

    expect((await run(["unkeep", "old_keep", "--ledger", path], makeIo({ env }))).code).toBe(0);
    expect((await loadStore(io, path, PASS)).allowlist).toEqual(["other_keep"]);
    // The older file is still there, untouched, and no longer consulted.
    expect(readdirSync(dir).sort()).toEqual(["ledger.allowlist.sealed", "ledger.sealed"]);
    expect(JSON.parse(await openText(readFileSync(allowlistPathFor(path)), PASS)).allowlist).toEqual(["old_keep", "other_keep"]);
  });

  it("is read even when no ledger exists yet", async () => {
    const path = join(tempDir("saved"), "ledger.sealed");
    writeFileSync(allowlistPathFor(path), await sealText(JSON.stringify({ allowlist: ["solo"] }), PASS));
    expect(await isFreshStore(io, path)).toBe(false);
    expect(await loadStore(io, path, PASS)).toEqual({ ledger: emptyLedger(), allowlist: ["solo"], checkedOff: [] });
  });

  it("fails calmly on a wrong passphrase or a damaged file, changing nothing", async () => {
    const path = join(tempDir("saved"), "ledger.sealed");
    await writeOlderFiles(path, ["k"]);
    await expect(loadStore(io, path, "not the passphrase")).rejects.toMatchObject({ code: "wrong-passphrase" });
    writeFileSync(allowlistPathFor(path), await sealText("not json", PASS));
    await expect(loadStore(io, path, PASS)).rejects.toMatchObject({ code: "allowlist-unreadable" });
  });
});

describe("commands over the shared file", () => {
  it("analyze keeps the keep list and the checkmarks as they were", async () => {
    const dir = tempDir("saved");
    const { earlier, later } = writeDemoPair(dir);
    const path = join(dir, "ledger.sealed");
    const env = { SNAPPY_PASSPHRASE: PASS };
    await run(["analyze", earlier, "--ledger", path], makeIo({ env }));
    const seeded = await loadStore(io, path, PASS);
    await saveStore(io, path, { ...seeded, allowlist: ["keep_me"], checkedOff: ["ticked_off"] }, PASS);

    expect((await run(["analyze", later, "--ledger", path], makeIo({ env }))).code).toBe(0);
    const after = await loadStore(io, path, PASS);
    expect(after.allowlist).toEqual(["keep_me"]);
    expect(after.checkedOff).toEqual(["ticked_off"]);
    expect(after.ledger.snapshots).toHaveLength(2);
  });

  it("keep and unkeep change only the keep list", async () => {
    const dir = tempDir("saved");
    const { later } = writeDemoPair(dir);
    const path = join(dir, "ledger.sealed");
    const env = { SNAPPY_PASSPHRASE: PASS };
    await run(["analyze", later, "--ledger", path], makeIo({ env }));
    const seeded = await loadStore(io, path, PASS);
    await saveStore(io, path, { ...seeded, checkedOff: ["ticked_off"] }, PASS);

    await run(["keep", "friend_a", "friend_b", "--ledger", path], makeIo({ env }));
    await run(["unkeep", "friend_a", "--ledger", path], makeIo({ env }));
    const after = await loadStore(io, path, PASS);
    expect(after.allowlist).toEqual(["friend_b"]);
    expect(after.checkedOff).toEqual(["ticked_off"]);
    expect(after.ledger).toEqual(seeded.ledger);
  });

  it("ledger status counts real snapshots only and names one file", async () => {
    const dir = tempDir("saved");
    const path = join(dir, "ledger.sealed");
    const env = { SNAPPY_PASSPHRASE: PASS };
    // A new saved history that only has a keep list: no exports yet, and the two lists are not counted as exports.
    await run(["keep", "friend_a", "--ledger", path], makeIo({ env }));
    const empty = await run(["ledger", "status", "--ledger", path, "--no-color"], makeIo({ env }));
    expect(empty.out).toContain("No exports saved yet.");
    expect(empty.out).toContain("1 friend on your keep list");
    expect(empty.out).not.toContain("allowlist");

    const { later } = writeDemoPair(dir);
    await run(["analyze", later, "--ledger", path], makeIo({ env }));
    const status = await run(["ledger", "status", "--ledger", path, "--no-color"], makeIo({ env }));
    expect(status.out).toContain("1 export in your history.");
    expect(status.out).toContain(path);
    expect(readdirSync(dir).filter((n) => n.includes("sealed"))).toEqual(["ledger.sealed"]);
    void LATER;
  });
});
