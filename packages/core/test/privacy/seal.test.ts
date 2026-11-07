import { beforeAll, describe, expect, it } from "vitest";
import { deserializeLedger, serializeLedger } from "../../src/ledger/ledger.ts";
import { openLedger, sealLedger, SealError } from "../../src/ledger/seal.ts";
import type { Ledger } from "../../src/types.ts";

// Synthetic canaries: if either appears in sealed bytes or in an error, privacy is broken.
const CANARY_USER = "canary_friend_zq9";
const CANARY_PASS = "correct horse canary battery";

const ledger: Ledger = {
  version: 1,
  snapshots: [
    {
      id: "snap-1",
      takenAt: Date.UTC(2024, 0, 1),
      source: "export",
      friends: [CANARY_USER, "other_pal"],
      sentRequests: [],
      deleted: {},
      friendSince: {},
      sentAt: {},
    },
  ],
};

const HEADER = 4 + 1 + 4 + 16 + 12;
const TIMEOUT = 60_000;

function flip(bytes: Uint8Array, index: number): Uint8Array {
  const copy = bytes.slice();
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

async function failure(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected rejection");
}

describe("ledger sealing", () => {
  let sealed: Uint8Array;

  beforeAll(async () => {
    sealed = await sealLedger(ledger, CANARY_PASS);
  }, TIMEOUT);

  it("writes the documented header", () => {
    expect(new TextDecoder().decode(sealed.slice(0, 4))).toBe("SNPL");
    expect(sealed[4]).toBe(1);
    const iterations = new DataView(sealed.buffer, sealed.byteOffset).getUint32(5, false);
    expect(iterations).toBeGreaterThanOrEqual(600_000);
    expect(sealed.length).toBeGreaterThan(HEADER + 16);
  });

  it("round-trips", async () => {
    const opened = await openLedger(sealed, CANARY_PASS);
    expect(opened).toEqual(deserializeLedger(serializeLedger(ledger)));
    expect(opened.snapshots[0]?.friends).toContain(CANARY_USER);
  }, TIMEOUT);

  it("does not leak plaintext into the sealed bytes", () => {
    const latin1 = new TextDecoder("latin1").decode(sealed);
    expect(latin1).not.toContain(CANARY_USER);
    expect(latin1).not.toContain("snap-1");
  });

  it("accepts an equivalent unicode form of the passphrase", async () => {
    const composed = await sealLedger(ledger, "caf\u00e9-pass");
    const decomposed = "cafe\u0301-pass";
    expect(await openLedger(composed, decomposed)).toEqual(deserializeLedger(serializeLedger(ledger)));
  }, TIMEOUT);

  it("rejects a wrong passphrase with an opaque error", async () => {
    const err = await failure(openLedger(sealed, CANARY_PASS + "x"));
    expect(err).toBeInstanceOf(SealError);
    expect(err.message).toBe("decryption failed");
    expect(err.message).not.toContain(CANARY_PASS);
    expect(err.message).not.toContain(CANARY_USER);
  }, TIMEOUT);

  it("rejects any tampered header byte", async () => {
    // magic, version, iterations (high and low byte), salt, iv
    for (const index of [0, 3, 4, 5, 8, 9, 24, 25, 36]) {
      const err = await failure(openLedger(flip(sealed, index), CANARY_PASS));
      expect(err, `header byte ${index}`).toBeInstanceOf(SealError);
      expect(err.message).toBe("decryption failed");
    }
  }, TIMEOUT);

  it("rejects tampered ciphertext and tag bytes", async () => {
    for (const index of [HEADER, HEADER + 5, sealed.length - 1]) {
      const err = await failure(openLedger(flip(sealed, index), CANARY_PASS));
      expect(err).toBeInstanceOf(SealError);
      expect(err.message).toBe("decryption failed");
    }
  }, TIMEOUT);

  it("rejects truncated and extended input", async () => {
    for (const bad of [
      new Uint8Array(0),
      sealed.slice(0, 10),
      sealed.slice(0, HEADER),
      sealed.slice(0, HEADER + 15),
      sealed.slice(0, sealed.length - 1),
      new Uint8Array([...sealed, 0]),
    ]) {
      const err = await failure(openLedger(bad, CANARY_PASS));
      expect(err).toBeInstanceOf(SealError);
      expect(err.message).toBe("decryption failed");
    }
  }, TIMEOUT);

  it("does not mutate the input buffer", async () => {
    const before = sealed.slice();
    await openLedger(sealed, CANARY_PASS);
    expect(sealed).toEqual(before);
  }, TIMEOUT);

  it("produces different seals of the same ledger", async () => {
    const again = await sealLedger(ledger, CANARY_PASS);
    expect(again).not.toEqual(sealed);
    expect(again.slice(9, 37)).not.toEqual(sealed.slice(9, 37)); // fresh salt + iv
  }, TIMEOUT);

  it("refuses an empty passphrase for both directions", async () => {
    const sealErr = await failure(sealLedger(ledger, ""));
    expect(sealErr).toBeInstanceOf(SealError);
    const openErr = await failure(openLedger(sealed, ""));
    expect(openErr).toBeInstanceOf(SealError);
  });
});
