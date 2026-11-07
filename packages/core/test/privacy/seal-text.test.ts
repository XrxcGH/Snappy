import { describe, expect, it } from "vitest";
import { SealError, addSnapshot, emptyLedger, openLedger, openText, sealLedger, sealText } from "../../src/index.ts";

describe("sealText / openText", () => {
  it("round-trips text, including non-ASCII, and hides it in the output", async () => {
    const text = JSON.stringify({ allowlist: ["sam_01", "señal.李"] });
    const sealed = await sealText(text, "pass phrase");
    expect(Buffer.from(sealed).includes(Buffer.from("sam_01"))).toBe(false);
    expect(await openText(sealed, "pass phrase")).toBe(text);
  });

  it("fails every wrong-passphrase, tampering and truncation case with the same opaque error", async () => {
    const sealed = await sealText("hello", "right");
    const flipped = new Uint8Array(sealed);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] as number) ^ 1;
    const attempts = [() => openText(sealed, "wrong"), () => openText(flipped, "right"), () => openText(sealed.subarray(0, 20), "right")];
    for (const attempt of attempts) {
      const failure = await attempt().then(() => undefined, (e: unknown) => e);
      expect(failure).toBeInstanceOf(SealError);
      expect((failure as Error).message).toBe("decryption failed");
    }
  });

  it("uses a fresh salt and nonce each time", async () => {
    const [a, b] = await Promise.all([sealText("same", "p"), sealText("same", "p")]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("shares its format with sealLedger, so each opens the other's output", async () => {
    const ledger = addSnapshot(emptyLedger(), {
      id: "s1",
      takenAt: 1_700_000_000_000,
      source: "export",
      friends: ["a_b"],
      sentRequests: [],
      deleted: {},
      friendSince: {},
      sentAt: {},
    });
    const sealed = await sealLedger(ledger, "p");
    expect(JSON.parse(await openText(sealed, "p")).snapshots).toHaveLength(1);
    expect(await openLedger(await sealText(JSON.stringify(ledger), "p"), "p")).toEqual(ledger);
  });

  it("requires a passphrase", async () => {
    await expect(sealText("x", "")).rejects.toBeInstanceOf(SealError);
    await expect(openText(new Uint8Array(100), "")).rejects.toBeInstanceOf(SealError);
  });
});
