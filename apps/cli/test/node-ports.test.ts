import { describe, expect, it } from "vitest";
import { createNodeFs, createNodeLock, createNodePath } from "../src/node-ports.ts";
import { tempDir } from "./helpers.ts";
import { portsConformance } from "./ports-conformance.ts";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

portsConformance("Node adapter", async () => ({ fs: createNodeFs(), path: createNodePath(), root: tempDir("ports") }));

describe("Node lock", () => {
  it("runs the work and releases the lock, even when the work fails", async () => {
    const name = join(tempDir("lock"), "ledger.sealed");
    const lock = createNodeLock();
    expect(await lock.withLock(name, { waitMs: 200 }, async () => 7)).toBe(7);
    await expect(
      lock.withLock(name, { waitMs: 200 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await lock.withLock(name, { waitMs: 200 }, async () => "again")).toBe("again");
  });

  it("stops with a calm message when another run holds the lock", async () => {
    const dir = tempDir("lock");
    const name = join(dir, "ledger.sealed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${name}.lock`, String(process.pid));
    await expect(createNodeLock().withLock(name, { waitMs: 100 }, async () => 1)).rejects.toMatchObject({ code: "ledger-busy" });
  });
});
