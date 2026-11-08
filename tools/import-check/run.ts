/**
 * Import checks: a repeatable test of how the core reads exports that are not the ones it was
 * written against, and of how fast it reads a big one. Everything is generated here, at run time,
 * from made-up data; nothing is committed as data and no real export is touched.
 *
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning tools/import-check/run.ts [options]
 *
 *   --variants-only   run only the layout variants (a few seconds)
 *   --scale-only      run only the large exports
 *   --seconds <n>     time allowed for each large export (default 20)
 *
 * Variants: each layout (HTML only, nested ZIPs, localized names, flat Snap lists, a damaged part,
 * and so on) must report exactly the issue codes listed in variants.ts. The same table runs in the
 * core tests (packages/core/test/export/variants.test.ts).
 *
 * Scale: "real6", six ZIP parts with 40,000 Memories files and about 250,000 chat and Snap events,
 * once with the Memories times in the directory and once with them only in the local headers (the
 * slow path). Each must find everything and finish within the time allowed.
 *
 * The exit status is 1 when any check fails, so this can gate a release. It is not part of the
 * normal test run.
 */
import { REAL6, buildScale, runScale } from "./scale.ts";
import type { ScaleOptions } from "./scale.ts";
import { buildVariants, runVariant } from "./variants.ts";

const args = process.argv.slice(2);
const only = (flag: string): boolean => args.includes(flag);
const secondsAt = args.indexOf("--seconds");
const LIMIT = secondsAt >= 0 ? Number(args[secondsAt + 1]) : 20;

let failures = 0;
const fail = (message: string): void => {
  failures += 1;
  console.log(`  FAIL ${message}`);
};

async function variants(): Promise<void> {
  console.log("Variants");
  for (const v of buildVariants()) {
    const r = await runVariant(v);
    const problems: string[] = [];
    if (JSON.stringify(r.codes) !== JSON.stringify(v.expect)) problems.push(`codes ${JSON.stringify(r.codes)}, expected ${JSON.stringify(v.expect)}`);
    if (v.friends !== undefined && r.friends !== v.friends) problems.push(`friends ${r.friends}, expected ${v.friends}`);
    if (v.events !== undefined && JSON.stringify(r.events) !== JSON.stringify(v.events)) problems.push(`events ${JSON.stringify(r.events)}, expected ${JSON.stringify(v.events)}`);
    console.log(`  ${problems.length === 0 ? "ok  " : "FAIL"} ${v.id.padEnd(5)} ${v.title}`);
    for (const p of problems) fail(`${v.id}: ${p}`);
  }
}

async function scale(name: string, opts: ScaleOptions): Promise<void> {
  console.log(`Scale ${name}`);
  const { parts, expect } = buildScale(opts);
  const r = await runScale(parts);
  const m = r.merged;
  console.log(`  ${r.seconds.toFixed(1)} s, ${r.reads} reads, ${m.friends.friends.length} friends, ${m.chats.length} chat and Snap events, ${m.memories.length} Memories, ${m.memoriesPairing?.paired ?? 0} paired`);
  if (r.seconds > LIMIT) fail(`${name}: ${r.seconds.toFixed(1)} s is over the ${LIMIT} s allowed`);
  if (m.friends.friends.length !== expect.friends) fail(`${name}: ${m.friends.friends.length} friends, expected ${expect.friends}`);
  if (m.chats.length !== expect.chatEvents) fail(`${name}: ${m.chats.length} events, expected ${expect.chatEvents}`);
  if (m.memories.length !== expect.memories) fail(`${name}: ${m.memories.length} Memories, expected ${expect.memories}`);
  if ((m.memoriesPairing?.paired ?? 0) !== expect.paired) fail(`${name}: ${m.memoriesPairing?.paired ?? 0} paired, expected ${expect.paired}`);
  if (r.errors.length > 0) fail(`${name}: errors ${JSON.stringify(r.errors)}`);
}

if (!only("--scale-only")) await variants();
if (!only("--variants-only")) {
  await scale("real6 (times in the directory)", REAL6);
  await scale("real6 (times only in the local headers)", { ...REAL6, localOnlyTimes: true });
}
console.log(failures === 0 ? "All checks passed." : `${failures} check${failures === 1 ? "" : "s"} failed.`);
process.exit(failures === 0 ? 0 : 1);
