/**
 * safety and privacy can read the marks the dashboard saved with the history, when the person names
 * the file with --history. Read only: the file is never changed, nothing is opened without the option,
 * and only the marks of the right checklist are used. Synthetic data only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyLedger } from "@snappy-export/core";
import { privacyCommand } from "../src/commands/privacy.ts";
import { safetyCommand } from "../src/commands/safety.ts";
import { saveStore } from "../src/ledger-store.ts";
import { makeIo, tempDir } from "./helpers.ts";
import { runInsight } from "./insights-helpers.ts";

const PASS = "correct horse battery staple";
const env = { SNAPPY_PASSPHRASE: PASS };

/** A saved history that holds checklist marks, some for the other checklist and some for no item at all. */
async function savedWith(ticks: string[]): Promise<string> {
  const file = join(tempDir("marks"), "h.sealed");
  await saveStore(makeIo(), file, { ledger: emptyLedger(), allowlist: [], checkedOff: [], ticks }, PASS);
  return file;
}

const TICKS = ["safety-checklist:strong-password", "safety-checklist:blocked-list", "privacy-tuneup:search", "privacy-tuneup:contact-me", "safety-checklist:not-an-item", "other-tool:x"];

describe("safety --history", () => {
  it("counts the safety marks saved with the history, with the ones typed, and says so", async () => {
    const file = await savedWith(TICKS);
    const { code, out } = await runInsight(safetyCommand, ["--history", file, "--done", "connected-apps"], makeIo({ env }));
    expect(code).toBe(0);
    expect(out).toContain("3 of 7 items marked done");
    expect(out).toContain("2 marks read from your saved history.");
    for (const name of ["strong-password", "blocked-list", "connected-apps"]) expect(out).toMatch(new RegExp(`Done +${name}`));
    expect(out).toMatch(/To do +two-step-verification/);
  });

  it("takes only this checklist's marks, once each, and only for items it knows", async () => {
    const file = await savedWith([...TICKS, "safety-checklist:strong-password"]);
    const json = JSON.parse((await runInsight(safetyCommand, ["--history", file, "--json"], makeIo({ env }))).out) as { progress: { done: number }; marksFromHistory: number };
    expect(json.marksFromHistory).toBe(2);
    expect(json.progress.done).toBe(2);
  });

  it("opens nothing without the option, and changes nothing with it", async () => {
    const file = await savedWith(TICKS);
    const before = readFileSync(file);
    const io = makeIo({ env });
    const plain = await runInsight(safetyCommand, [], io);
    expect(plain.out).toContain("0 of 7 items marked done");
    expect(plain.out).not.toContain("read from your saved history");
    expect(JSON.parse((await runInsight(safetyCommand, ["--json"], makeIo({ env }))).out)).not.toHaveProperty("marksFromHistory");
    await runInsight(safetyCommand, ["--ledger", file], makeIo({ env }));
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("stops calmly for a missing file or a wrong passphrase", async () => {
    const missing = await runInsight(safetyCommand, ["--history", join(tempDir("marks"), "none.sealed")], makeIo({ env }));
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("found no saved history at that path");
    const file = await savedWith(TICKS);
    const wrong = await runInsight(safetyCommand, ["--history", file], makeIo({ env: { SNAPPY_PASSPHRASE: "not it" } }));
    expect(wrong).toMatchObject({ code: 1, out: "" });
    expect(wrong.err).toContain("could not unlock your saved history");
  });

  it("lists the option in its help", async () => {
    expect(safetyCommand.usage).toContain("--history <path>");
    expect(safetyCommand.usage).not.toMatch(/ledger/i);
  });
});

describe("privacy --history", () => {
  it("counts the privacy marks saved with the history, with the ones typed, and says so", async () => {
    const file = await savedWith(TICKS);
    const { code, out } = await runInsight(privacyCommand, ["--history", file, "--done", "quick-add"], makeIo({ env }));
    expect(code).toBe(0);
    expect(out).toContain("3 of 9 settings marked done");
    expect(out).toContain("2 marks read from your saved history.");
    for (const name of ["search", "contact-me", "quick-add"]) expect(out).toMatch(new RegExp(`Done +${name}`));
    expect(out).toMatch(/To do +group-invites/);
  });

  it("takes only this checklist's marks, and records the count in the JSON", async () => {
    const file = await savedWith(TICKS);
    const json = JSON.parse((await runInsight(privacyCommand, ["--ledger", file, "--json"], makeIo({ env }))).out) as { progress: { done: number }; marksFromHistory: number };
    expect(json.marksFromHistory).toBe(2);
    expect(json.progress.done).toBe(2);
  });

  it("opens nothing without the option", async () => {
    const plain = await runInsight(privacyCommand, [], makeIo({ env }));
    expect(plain.out).toContain("0 of 9 settings marked done");
    expect(plain.out).not.toContain("read from your saved history");
    expect(JSON.parse((await runInsight(privacyCommand, ["--json"])).out)).not.toHaveProperty("marksFromHistory");
  });

  it("stops calmly for a missing file", async () => {
    const missing = await runInsight(privacyCommand, ["--history", join(tempDir("marks"), "none.sealed")], makeIo({ env }));
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toContain("found no saved history at that path");
  });
});
