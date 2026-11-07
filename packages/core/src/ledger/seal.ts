/**
 * Passphrase sealing for persisted ledgers (privacy contract rule 6): a ledger holds friend
 * usernames, so it is never written to disk in the clear.
 *
 * Format (all integers big-endian):
 *   "SNPL" | version u8 | PBKDF2 iterations u32 | salt 16 | iv 12 | AES-256-GCM ciphertext+tag
 * The whole header is bound to the ciphertext as GCM additional data, so editing any header
 * byte (including a downgraded iteration count) fails authentication.
 *
 * Web Crypto only; the sole randomness is crypto.getRandomValues.
 */
import type { Ledger } from "../types.ts";
import { deserializeLedger, serializeLedger } from "./ledger.ts";

/** Messages are fixed strings: an error here must never carry passphrases, usernames or bytes. */
export class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealError";
  }
}

const MAGIC = [0x53, 0x4e, 0x50, 0x4c]; // "SNPL"
const VERSION = 1;
const ITERATIONS = 600_000; // OWASP-recommended floor for PBKDF2-HMAC-SHA256
// Upper bound stops a tampered header from turning "open" into a CPU-exhaustion request.
const MAX_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + 4 + SALT_BYTES + IV_BYTES;

const FAILED = "decryption failed";

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new SealError("Web Crypto is unavailable");
  return s;
}

function requirePassphrase(passphrase: unknown): string {
  if (typeof passphrase !== "string" || passphrase === "") throw new SealError("a passphrase is required");
  return passphrase;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const s = subtle();
  // NFC so the same typed passphrase unlocks across platforms that compose accents differently.
  const raw = new TextEncoder().encode(passphrase.normalize("NFC"));
  try {
    const base = await s.importKey("raw", raw, "PBKDF2", false, ["deriveKey"]);
    return await s.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    raw.fill(0);
  }
}

/**
 * Seal any text (the ledger's JSON, or an adapter's own small companion file such as a saved
 * allowlist) with the same format and guarantees as a ledger. The text is never logged or echoed.
 */
export async function sealText(text: string, passphrase: string): Promise<Uint8Array> {
  const pass = requirePassphrase(passphrase);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC, 0);
  header[MAGIC.length] = VERSION;
  new DataView(header.buffer).setUint32(MAGIC.length + 1, ITERATIONS, false);
  header.set(salt, MAGIC.length + 5);
  header.set(iv, MAGIC.length + 5 + SALT_BYTES);

  const plain = new TextEncoder().encode(text);
  try {
    const key = await deriveKey(pass, salt, ITERATIONS);
    const cipher = new Uint8Array(
      await subtle().encrypt({ name: "AES-GCM", iv, additionalData: header, tagLength: TAG_BYTES * 8 }, key, plain),
    );
    const out = new Uint8Array(HEADER_BYTES + cipher.length);
    out.set(header, 0);
    out.set(cipher, HEADER_BYTES);
    return out;
  } catch (e) {
    if (e instanceof SealError) throw e;
    throw new SealError("encryption failed");
  } finally {
    plain.fill(0);
  }
}

/** Open text sealed by sealText. Every failure is the same opaque SealError. */
export async function openText(sealed: Uint8Array, passphrase: string): Promise<string> {
  const pass = requirePassphrase(passphrase);
  // Every failure below is the same opaque error: callers (and attackers) learn nothing
  // about whether the passphrase, the header or the ciphertext was at fault.
  if (!(sealed instanceof Uint8Array) || sealed.length < HEADER_BYTES + TAG_BYTES) throw new SealError(FAILED);
  // new Uint8Array(sealed) always COPIES into a fresh buffer at offset 0. sealed.slice() would not:
  // on a Node Buffer (fs.readFileSync) it is a view into a shared pool, and reading the header
  // through bytes.buffer would then look at the wrong bytes and reject the correct passphrase.
  const bytes = new Uint8Array(sealed);
  if (!MAGIC.every((b, i) => bytes[i] === b) || bytes[MAGIC.length] !== VERSION) throw new SealError(FAILED);

  const iterations = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length + 1, false);
  if (iterations < ITERATIONS || iterations > MAX_ITERATIONS) throw new SealError(FAILED);

  const header = bytes.slice(0, HEADER_BYTES);
  const salt = bytes.slice(MAGIC.length + 5, MAGIC.length + 5 + SALT_BYTES);
  const iv = bytes.slice(MAGIC.length + 5 + SALT_BYTES, HEADER_BYTES);
  const cipher = bytes.slice(HEADER_BYTES);

  let plain: Uint8Array;
  try {
    const key = await deriveKey(pass, salt, iterations);
    plain = new Uint8Array(
      await subtle().decrypt({ name: "AES-GCM", iv, additionalData: header, tagLength: TAG_BYTES * 8 }, key, cipher),
    );
  } catch {
    throw new SealError(FAILED);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  } catch {
    // A valid seal around undecodable text is corruption, but the caller-visible answer stays the same.
    throw new SealError(FAILED);
  } finally {
    plain.fill(0);
  }
}

export function sealLedger(ledger: Ledger, passphrase: string): Promise<Uint8Array> {
  return sealText(serializeLedger(ledger), passphrase);
}

export async function openLedger(sealed: Uint8Array, passphrase: string): Promise<Ledger> {
  const text = await openText(sealed, passphrase);
  try {
    return deserializeLedger(text);
  } catch (e) {
    // Ledger version errors carry only a number: pass them on.
    if (e instanceof Error && e.name === "LedgerFormatError") throw e;
    throw new SealError(FAILED);
  }
}
