/**
 * Proves that the web build (apps/dashboard/dist/index.html) is byte for byte what an earlier commit built.
 *
 *   node apps/app/tools/check-web-build-unchanged.mjs <git ref>      (for example: main)
 *
 * The desktop app adds its update interface from the outside (apps/app/src), so the web page must not change when it
 * is added. This builds the web page from the sources at <git ref> and from the working tree (each copied to a
 * temporary folder of the same depth, so the build location cannot make a difference) and compares the SHA-256 and the
 * size of the two files. It exits 1 when they differ. It needs git and tar, and the repository's node_modules (linked
 * into the temporary copies, so nothing is installed or downloaded).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ref = process.argv[2];
if (!ref) {
  console.error("usage: node apps/app/tools/check-web-build-unchanged.mjs <git ref>");
  process.exit(2);
}

const PATHS = ["apps/dashboard", "packages", "brand", "apps/cli", "package.json", "tsconfig.base.json"];
const BIG = 512 * 1024 * 1024;
const tmp = mkdtempSync(path.join(os.tmpdir(), "snappy-web-unchanged-"));

/** Unpacks tar data into `dir` and links the repository's node_modules next to it. */
function unpack(dir, tarBytes) {
  mkdirSync(dir);
  // Run inside the folder, so tar is never given a "C:" path (GNU tar reads that as a host name).
  const untar = spawnSync("tar", ["-x"], { cwd: dir, input: tarBytes, maxBuffer: BIG });
  if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);
  symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "junction");
}

function buildWeb(from, out) {
  execFileSync(process.execPath, [path.join(from, "apps", "dashboard", "build.mjs"), "--out", out], { stdio: "pipe" });
  const bytes = readFileSync(path.join(out, "index.html"));
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

try {
  unpack(path.join(tmp, "before"), execFileSync("git", ["archive", "--format=tar", ref, ...PATHS], { cwd: root, maxBuffer: BIG }));
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...PATHS], { cwd: root, maxBuffer: BIG });
  const packed = spawnSync("tar", ["-c", "--null", "-T", "-"], { cwd: root, input: listed, maxBuffer: BIG });
  if (packed.status !== 0) throw new Error(`tar failed: ${packed.stderr}`);
  unpack(path.join(tmp, "after_"), packed.stdout);

  const before = buildWeb(path.join(tmp, "before"), path.join(tmp, "out-before"));
  const now = buildWeb(path.join(tmp, "after_"), path.join(tmp, "out-after_"));
  console.log(`${ref.padEnd(12)} ${before.sha256}  ${before.bytes} bytes`);
  console.log(`${"working tree".padEnd(12)} ${now.sha256}  ${now.bytes} bytes`);
  if (before.sha256 !== now.sha256) {
    console.log("FAIL: the web build changed.");
    process.exitCode = 1;
  } else {
    console.log("ok: the web build is byte for byte the same.");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
