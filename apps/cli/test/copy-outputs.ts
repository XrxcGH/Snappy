/**
 * Every kind of terminal text the CLI prints, collected once from real runs on synthetic data.
 * The copy-lint test reads these; nothing here asserts anything itself.
 */
import { join } from "node:path";
import { makeIo, run, tempDir, writeDemoPair, writeSyntheticParts } from "./helpers.ts";

export async function collectOutputs(): Promise<Record<string, string>> {
  const dir = tempDir("copy");
  const { earlier, later } = writeDemoPair(dir, { bundleMedia: true });
  const env = { SNAPPY_PASSPHRASE: "copy-test-passphrase" };
  const ledger = join(dir, "ledger.sealed");
  const outputs: Record<string, string> = {};
  const capture = async (name: string, args: string[], extra: Parameters<typeof makeIo>[0] = {}) => {
    const r = await run(args, makeIo({ env, ...extra }));
    outputs[name] = r.out + r.err;
  };

  await capture("help", ["help"]);
  for (const c of ["analyze", "memories", "inspect", "keep", "unkeep", "ledger", "demo"]) await capture(`help ${c}`, ["help", c]);
  await capture("version", ["--version"]);
  await capture("analyze", ["analyze", later, "--earlier", earlier, "--no-save"]);
  await capture("analyze one export", ["analyze", later, "--no-save"]);
  await capture("analyze saved", ["analyze", later, "--ledger", ledger]);
  await capture("analyze limited", ["analyze", later, "--earlier", earlier, "--no-save", "--limit", "2"]);
  await capture("keep", ["keep", "ghost_1", "--ledger", ledger]);
  await capture("keep again", ["keep", "ghost_1", "--ledger", ledger]);
  await capture("unkeep", ["unkeep", "ghost_1", "--ledger", ledger]);
  await capture("ledger", ["ledger", "status", "--ledger", ledger]);
  await capture("ledger none", ["ledger", "status", "--ledger", join(dir, "none.sealed")]);
  await capture("memories dry run", ["memories", later, "--dry-run"]);
  await capture("memories", ["memories", later, "--out", join(dir, "out")]);
  const parts = join(dir, "parts");
  writeSyntheticParts(parts);
  await capture("analyze parts", ["analyze", parts, "--no-save"]);
  await capture("memories parts dry run", ["memories", parts, "--dry-run", "--download"]);
  await capture("memories parts", ["memories", parts, "--out", join(dir, "parts-out"), "--download"]);
  await capture("memories parts again", ["memories", parts, "--out", join(dir, "parts-out")]);
  await capture("demo", ["demo", "--dir", join(dir, "demo")]);
  // Errors: each one a person could meet.
  await capture("error not found", ["analyze", join(dir, "missing.zip")]);
  await capture("error no input", ["analyze"]);
  await capture("error not zip", ["analyze", join(dir, "ledger.sealed")]);
  await capture("error option", ["analyze", later, "--bogus"]);
  await capture("error option value", ["analyze", later, "--limit"]);
  await capture("error number", ["analyze", later, "--limit", "x"]);
  await capture("error confidence", ["analyze", later, "--min-confidence", "x"]);
  await capture("error csv", ["analyze", later, "--no-save", "--csv", join(dir, "x.txt")]);
  await capture("error keep", ["keep"]);
  await capture("error out", ["memories", later]);
  await capture("error layout", ["memories", later, "--dry-run", "--layout", "x"]);
  await capture("error ledger", ["ledger", "history"]);
  await capture("error help topic", ["help", "bogus"]);
  await capture("error unknown command", ["bogus"]);
  await capture("error wrong passphrase", ["ledger", "status", "--ledger", ledger], { env: { SNAPPY_PASSPHRASE: "not-the-passphrase" } });
  return outputs;
}
