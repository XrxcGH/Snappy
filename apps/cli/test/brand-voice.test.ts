/**
 * Brand gate for terminal text (docs/BRAND.md sections 2 and 8): sentence case, American English,
 * no emoji, no exclamation marks, and the word choices the guide requires.
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { makeIo, run, stripPaths, tempDir, writeDemoPair, writeSyntheticParts } from "./helpers.ts";

/** Synthetic usernames are data, not copy: they are removed before the wording checks. */
const USERNAMES = /\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b/g;
const ACRONYMS = new Set(["JSON", "HTML", "ZIP", "CSV", "AES", "NO", "SNAPPY"]);

/**
 * All-caps words that are not acronyms. File paths are removed first: they come from the machine
 * running the test, such as the Windows runner's temp folder (C:\Users\RUNNER~1\AppData\Local\Temp).
 */
function shoutingWords(text: string): string[] {
  const words = stripPaths(text).replace(USERNAMES, "").match(/\b[A-Z]{4,}\b/g) ?? [];
  return words.filter((w) => !ACRONYMS.has(w));
}

async function collect(): Promise<Record<string, string>> {
  const dir = tempDir("voice");
  const { earlier, later } = writeDemoPair(dir, { bundleMedia: true });
  const env = { SNAPPY_PASSPHRASE: "voice-test-passphrase" };
  const ledger = join(dir, "ledger.sealed");
  const outputs: Record<string, string> = {};
  const capture = async (name: string, args: string[], extra: Parameters<typeof makeIo>[0] = {}) => {
    const r = await run(args, makeIo({ env, ...extra }));
    outputs[name] = r.out + r.err;
  };

  await capture("help", ["help"]);
  for (const c of ["analyze", "memories", "inspect", "keep", "ledger", "demo"]) await capture(`help ${c}`, ["help", c]);
  await capture("analyze", ["analyze", later, "--earlier", earlier, "--no-save"]);
  await capture("analyze one export", ["analyze", later, "--no-save"]);
  await capture("analyze saved", ["analyze", later, "--ledger", ledger]);
  await capture("keep", ["keep", "ghost_1", "--ledger", ledger]);
  await capture("unkeep", ["unkeep", "ghost_1", "--ledger", ledger]);
  await capture("ledger", ["ledger", "status", "--ledger", ledger]);
  await capture("ledger none", ["ledger", "status", "--ledger", join(dir, "none.sealed")]);
  await capture("memories dry run", ["memories", later, "--dry-run"]);
  await capture("memories", ["memories", later, "--out", join(dir, "out")]);
  // The real export shape: three zips, no links, overlay files, Memories with no file.
  const parts = join(dir, "parts");
  writeSyntheticParts(parts);
  await capture("analyze parts", ["analyze", parts, "--no-save"]);
  await capture("memories parts dry run", ["memories", parts, "--dry-run", "--download"]);
  await capture("memories parts", ["memories", parts, "--out", join(dir, "parts-out"), "--download"]);
  await capture("memories parts again", ["memories", parts, "--out", join(dir, "parts-out")]);
  await capture("demo", ["demo", "--dir", join(dir, "demo")]);
  await capture("errors", ["analyze", join(dir, "missing.zip")]);
  await capture("usage", ["analyze", later, "--bogus"]);
  await capture("unknown", ["bogus"]);
  // The messages the in-app terminal adds: no network, and a stop request.
  await capture("no network", ["memories", later, "--out", join(dir, "net-out"), "--download"], { network: false });
  const stopped = new AbortController();
  stopped.abort();
  await capture("stopped", ["memories", parts, "--out", join(dir, "stop-out")], { signal: stopped.signal });
  return outputs;
}

let cached: Record<string, string> = {};
const everything = async (): Promise<Record<string, string>> => cached;

describe("terminal copy follows the brand guide", () => {
  beforeAll(async () => {
    cached = await collect();
  }, 60_000);

  it("uses no exclamation marks and no emoji", async () => {
    for (const [name, text] of Object.entries(await everything())) {
      expect(text, name).not.toContain("!");
      expect(/\p{Extended_Pictographic}/u.test(text), name).toBe(false);
    }
  });

  it("avoids the words the guide retires", async () => {
    const banned = /\b(ghosts?|unfriend\w*|unadded|purge\w*|oops|whoops|awesome|simply|just|stalker\w*|exposed|leaked|dormant|inactive|dead|failed adds?|data dump)\b/i;
    for (const [name, text] of Object.entries(await everything())) {
      // core's evidence sentences are quoted verbatim from a detector; those use "unadds" in a hedge.
      const copy = text.replace(USERNAMES, "").replace(/\bunadds?\b|\bunadded\b/gi, "");
      const hit = banned.exec(copy);
      expect(hit?.[0], `${name}: ${hit?.[0]}`).toBeUndefined();
    }
  });

  it("uses the feature names from the guide", async () => {
    const out = (await everything()).analyze as string;
    expect(out).toContain("Disappeared friends");
    expect(out).toContain("Unaccepted requests");
    expect(out).toContain("Quiet friends");
    expect(out).toContain("Cleanup queue");
    expect(out).toContain("They may have removed you, or their account may be gone.");
    const all = await everything();
    expect(all["memories dry run"]).toContain("Memories rescue");
    expect(all["memories dry run"]).toContain("Storage meter");
    expect(all["memories parts"]).toContain("overlay files saved next to their Memory, unchanged.");
  });

  it("writes in sentence case: no all-caps words apart from acronyms and environment variables", async () => {
    const outputs = await everything();
    for (const [name, text] of Object.entries(outputs)) {
      expect(shoutingWords(text), name).toEqual([]);
    }
  });

  it("does not mistake a file path for a shouting word", () => {
    const paths = [
      "File: C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\snappy-cli-voice-Ab12\\ledger.sealed",
      "CSV saved: c:/Users/RUNNER~1/AppData/Local/Temp/queue.csv",
      "Saved to \\\\BUILDHOST\\SHARE\\Snappy\\out",
      "Folder: ~/SNAPPY/ledger.sealed",
      "Saved in /home/RUNNER/work/_temp/snappy-out",
      "Short name RUNNER~1 only",
    ];
    for (const line of paths) {
      expect(shoutingWords(line), line).toEqual([]);
      expect(stripPaths(line), line).not.toMatch(/RUNNER|BUILDHOST|SHARE/);
    }
    // Shouting that sits next to a path is still caught.
    expect(shoutingWords("WARNING: saved in C:\\Users\\RUNNER~1\\Temp")).toEqual(["WARNING"]);
    expect(shoutingWords("Saved. Careful, ALWAYS check.")).toEqual(["ALWAYS"]);
  });

  it("uses American spelling", async () => {
    const british = /\b(colour\w*|grey|organis\w*|analys(?!is)\w*|cancelled|licence|centre|favourite|behaviour|catalogue|programme)\b/i;
    for (const [name, text] of Object.entries(await everything())) {
      expect(british.exec(stripPaths(text).replace(USERNAMES, ""))?.[0], name).toBeUndefined();
    }
  });

  it("says what happened and what to do in errors, without a developer code", async () => {
    const all = await everything();
    for (const name of ["errors", "usage", "unknown"]) {
      expect(all[name], name).not.toMatch(/\bcode\b/);
      expect(all[name], name).toMatch(/\.\n$/);
      expect(all[name], name).toMatch(/[Cc]heck|Run |Give it|try again/);
    }
  });

  it("carries the privacy lines where they matter", async () => {
    const all = await everything();
    expect(all.analyze).toContain("Your export stays on this device. Snappy reads friend names and dates, and skips messages, photos, and locations.");
    expect(all.analyze).toContain("Nothing here has left this device.");
    expect(all.analyze).toContain("Confidence is an estimate from your exports, not something Snapchat told Snappy.");
    expect(all["analyze saved"]).toContain("Saved history sealed with your passphrase.");
  });
});
