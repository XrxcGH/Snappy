/**
 * Builds the dashboard for the desktop shell into apps/app/frontend/index.html.
 *
 * Same single self-contained file as the web build (same sources, same strict policy, with the
 * same hashes computed from the exact inlined text).
 *
 *   node scripts/build-frontend.mjs [--out <dir>]
 *
 * The reader is chosen by SNAPPY_READER:
 *   (unset) or "input"  the dashboard's own file input and background worker. The default.
 *   "native"            the fallback: pick and read through the shell's read-only commands.
 * The content policy (`connect-src 'none'`) is the same either way and cannot be changed from here.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboard } from "../../dashboard/build.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const flag = process.argv.indexOf("--out");
const outDir = flag >= 0 ? path.resolve(process.argv[flag + 1]) : path.join(here, "..", "frontend");

const READERS = { input: "entry.ts", native: "entry-native-reader.ts" };
const reader = process.env.SNAPPY_READER || "input";
if (!Object.hasOwn(READERS, reader)) throw new Error(`SNAPPY_READER must be "input" or "native", not "${reader}".`);
if (reader === "native" && process.env.CI && !process.env.SNAPPY_ALLOW_NATIVE_READER) {
  throw new Error("The native reader is a fallback and is not built in CI unless SNAPPY_ALLOW_NATIVE_READER=1 is set on purpose.");
}

const result = await buildDashboard({ outDir, entry: path.join(here, "..", "src", READERS[reader]) });
console.log(`Built ${result.file} (${(result.bytes / 1024).toFixed(0)} KB) for the desktop shell, reader: ${reader}.`);
console.log(`CSP: ${result.csp.replace(/'sha256-[^']+'/g, "'sha256-...'")}`);
