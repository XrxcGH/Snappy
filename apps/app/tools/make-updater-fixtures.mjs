/**
 * Writes the signature fixtures that the updater's unit tests read
 * (apps/app/src-tauri/src/updater/testdata/signatures.json).
 *
 *   node apps/app/tools/make-updater-fixtures.mjs
 *
 * It makes THROWAWAY TEST keys in memory (Node's own ed25519 and BLAKE2b-512), signs a tiny stand-in
 * file in the minisign format with a range of trusted comments (right and wrong), and writes only
 * public material: the test public keys, the stand-in bytes and the signature texts. The private keys
 * are never written anywhere and are gone when the script ends, so running it again makes new,
 * equally valid fixtures. These keys can sign nothing that a real build trusts: release builds refuse
 * test keys (see build.rs), and the fixtures live only under src/updater/testdata.
 *
 * The format is the one `tauri signer sign` writes (checked once against the real tool: see the
 * "real tauri signature" fixture, made by hand with tauri-cli 2.12 and kept as a separate file).
 */
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "src-tauri", "src", "updater", "testdata");

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyId = randomBytes(8);
  const pubLine = b64(Buffer.concat([Buffer.from("Ed"), keyId, raw]));
  // The form Tauri's config holds: the whole two-line public key file, base64 encoded.
  const tauriPublic = b64(`untrusted comment: minisign public key: ${keyId.toString("hex").toUpperCase()}\n${pubLine}\n`);
  return { privateKey: createPrivateKey(privateKey.export({ format: "pem", type: "pkcs8" })), keyId, tauriPublic };
}

/** A signature in the form Tauri's `.sig` files hold: the whole minisign signature file, base64 encoded. */
function signature(key, content, trustedComment, { legacy = false } = {}) {
  const digest = legacy ? content : createHash("blake2b512").update(content).digest();
  const sig = sign(null, digest, key.privateKey);
  const algorithm = Buffer.from(legacy ? "Ed" : "ED");
  const global = sign(null, Buffer.concat([sig, Buffer.from(trustedComment)]), key.privateKey);
  const text =
    `untrusted comment: signature from test key\n${b64(Buffer.concat([algorithm, key.keyId, sig]))}\n` +
    `trusted comment: ${trustedComment}\n${b64(global)}\n`;
  return b64(text);
}

const content = Buffer.from("TEST-ONLY stand-in for an installer. Not a program.\n".repeat(20));
const x = makeKey();
const y = makeKey();
const z = makeKey();
const NAME = "Snappy_0.2.0_x64-setup.exe";
const comment = (...fields) => fields.join("\t");
const ts = "timestamp:1794120988";

const cases = {
  good: signature(x, content, comment(ts, `file:${NAME}`, "version:0.2.0")),
  extraField: signature(x, content, comment(ts, `file:${NAME}`, "version:0.2.0", "extra:1")),
  wrongOrder: signature(x, content, comment(ts, "version:0.2.0", `file:${NAME}`)),
  duplicateKey: signature(x, content, comment(ts, `file:${NAME}`, `file:${NAME}`, "version:0.2.0")),
  missingVersion: signature(x, content, comment(ts, `file:${NAME}`)),
  wrongFile: signature(x, content, comment(ts, "file:Snappy_0.2.0_x64_en-US.msi", "version:0.2.0")),
  wrongVersion: signature(x, content, comment(ts, `file:${NAME}`, "version:0.3.0")),
  spacesNotTabs: signature(x, content, `${ts} file:${NAME} version:0.2.0`),
  legacy: signature(x, content, comment(ts, `file:${NAME}`, "version:0.2.0"), { legacy: true }),
  signedByOtherKey: signature(y, content, comment(ts, `file:${NAME}`, "version:0.2.0")),
  tamperedAfterSigning: signature(x, Buffer.concat([content, Buffer.from("x")]), comment(ts, `file:${NAME}`, "version:0.2.0")),
};

mkdirSync(out, { recursive: true });
const fixtures = {
  note: "TEST-ONLY fixtures made by apps/app/tools/make-updater-fixtures.mjs. Public keys and signatures only. Never a release key.",
  keys: { x: x.tauriPublic, y: y.tauriPublic, z: z.tauriPublic },
  contentBase64: b64(content),
  signatures: cases,
};
writeFileSync(path.join(out, "signatures.json"), `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(`Wrote ${path.join(out, "signatures.json")} with ${Object.keys(cases).length} signatures.`);
