/**
 * The terminal text of the 14 insight commands, collected once from real runs through the CLI's own
 * dispatch (runCli), on synthetic data only. The copy lint, the brand-voice gate, the plural check
 * and the canary gate read these; nothing here asserts anything itself.
 *
 * Each command is run the ways a person would meet it: the default output, its options, its help
 * text, and the mistakes it can report (bad value, missing file, file that already exists).
 */
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { INSIGHT_COMMANDS } from "../src/insight-commands.ts";
import { makeIo, run, tempDir, writeDemoPair, writeSyntheticParts } from "./helpers.ts";
import { sharedRuns } from "./shared-runs.ts";
import { describeZips } from "./verify-memories-output.ts";

const PASSPHRASE = "insight-outputs-passphrase";

/** The files a rescue folder would hold, made from a saved manifest: the listed paths with the capture dates. */
function populateRescueFolder(folder: string, manifestPath: string): void {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { items: { path: string; overlayFiles: string[]; capturedAt: number | null }[] };
  for (const item of manifest.items) {
    for (const name of [item.path, ...item.overlayFiles]) {
      const target = join(folder, ...name.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "x".repeat(10));
      if (item.capturedAt !== null) utimesSync(target, new Date(item.capturedAt), new Date(item.capturedAt));
    }
  }
}

export interface InsightOutputs {
  /** What each run printed (standard output and error together), by a name that says which run it was. */
  outputs: Record<string, string>;
  /** The runs that print JSON. JSON is data, not copy, so the wording checks leave it out and the leak checks keep it. */
  json: Record<string, string>;
  /** Files the runs wrote on purpose (a backup, a manifest, a calendar file), by path. */
  files: Record<string, string>;
  /** Every entry name inside the zips the runs read (the three-part export and the single export), so a gate can look for any of them in the output. */
  entryNames: string[];
}

export async function collectInsightRuns(): Promise<InsightOutputs> {
  const dir = tempDir("insights");
  const { earlier, later } = writeDemoPair(dir, { bundleMedia: true });
  const parts = join(dir, "parts");
  const partZips = writeSyntheticParts(parts);
  const env = { SNAPPY_PASSPHRASE: PASSPHRASE };
  const ledger = join(dir, "ledger.sealed");
  const outputs: Record<string, string> = {};
  const json: Record<string, string> = {};
  const files: Record<string, string> = {};
  const capture = async (name: string, args: string[]): Promise<void> => {
    const r = await run(args, makeIo({ env }));
    (args.includes("--json") ? json : outputs)[name] = r.out + r.err;
  };
  const written = (...paths: string[]): void => {
    for (const p of paths) files[p] = readFileSync(p, "utf8");
  };

  // A sealed ledger made by two real analyze runs, the way a person would make one. friend-count reads it,
  // and backup is given it as a file that is not a backup.
  await run(["analyze", earlier, "--ledger", ledger], makeIo({ env }));
  await run(["analyze", later, "--ledger", ledger], makeIo({ env }));

  // Every insight command has help text, reached both ways.
  for (const c of INSIGHT_COMMANDS) await capture(`help ${c.name}`, ["help", c.name]);
  for (const c of INSIGHT_COMMANDS) await capture(`${c.name} --help`, [c.name, "--help"]);

  // check
  await capture("check", ["check", later]);
  await capture("check parts", ["check", parts, "--verbose"]);
  await capture("check error not found", ["check", join(dir, "missing.zip")]);

  // storage
  await capture("storage", ["storage", later]);
  await capture("storage parts", ["storage", parts]);
  await capture("storage options", ["storage", parts, "--goal-gb", "0.00003", "--batch-gb", "0.0000001", "--oldest-first", "--verbose"]);
  await capture("storage error number", ["storage", later, "--goal-gb", "x"]);
  await capture("storage error not found", ["storage", join(dir, "missing.zip")]);

  // backup
  const backupDir = join(dir, "backup");
  const backup = join(backupDir, "bk.json");
  await capture("backup", ["backup", parts]);
  // The saved file comes from the export that holds download links, so a link leaking into it can be seen.
  await capture("backup saved", ["backup", later, "--out", backup]);
  await capture("backup saved parts", ["backup", parts, "--out", join(backupDir, "bk-parts.json"), "--list"]);
  await capture("backup compare", ["backup", later, "--compare", backup]);
  await capture("backup compare other export", ["backup", parts, "--compare", backup, "--friend-count", "300"]);
  await capture("backup error exists", ["backup", later, "--out", backup]);
  await capture("backup error not a backup", ["backup", parts, "--compare", ledger]);
  written(backup, join(backupDir, "bk-parts.json"));

  // replies
  await capture("replies", ["replies", later]);
  await capture("replies options", ["replies", later, "--you-days", "0", "--them-days", "0", "--limit", "2", "--verbose"]);
  await capture("replies long waits", ["replies", later, "--you-days", "30", "--them-days", "30"]);
  await capture("replies error number", ["replies", later, "--limit", "x"]);
  await capture("replies error no input", ["replies"]);

  // habits
  await capture("habits", ["habits", later]);
  await capture("habits detail", ["habits", parts, "--detail", "--utc-offset=-5:30"]);
  await capture("remind offset", ["remind", "--last-export", "2026-10-31", "--utc-offset=-5"]);
  await capture("habits months", ["habits", parts, "--months", "2", "--verbose"]);
  await capture("habits error offset", ["habits", later, "--utc-offset=99"]);

  // closest
  await capture("closest", ["closest", parts]);
  await capture("closest options", ["closest", parts, "--window", "7", "--top", "2", "--verbose"]);
  await capture("closest error number", ["closest", parts, "--window", "x"]);

  // safety
  await capture("safety", ["safety"]);
  await capture("safety done", ["safety", "--done", "blocked-list,connected-apps"]);
  await capture("safety export", ["safety", later, "--done", "blocked-list"]);
  await capture("safety export only", ["safety", later]);
  await capture("safety error id", ["safety", "--done", "x"]);

  // anniversaries
  await capture("anniversaries", ["anniversaries", later]);
  await capture("anniversaries options", ["anniversaries", later, "--days", "366", "--limit", "3", "--verbose"]);
  await capture("anniversaries milestones", ["anniversaries", later, "--days", "366", "--milestones"]);
  await capture("anniversaries none", ["anniversaries", later, "--days", "0"]);
  await capture("anniversaries error number", ["anniversaries", later, "--days", "x"]);

  // on-this-day
  await capture("on-this-day date", ["on-this-day", parts, "--date", "2026-10-15"]);
  await capture("on-this-day window", ["on-this-day", parts, "--date", "2026-10-15", "--window", "5"]);
  await capture("on-this-day year", ["on-this-day", parts, "--year", "2025"]);
  await capture("on-this-day by year", ["on-this-day", parts, "--by-year", "--utc-offset", "5:30"]);
  await capture("on-this-day", ["on-this-day", parts]);
  await capture("on-this-day error date", ["on-this-day", parts, "--date", "x"]);
  await capture("on-this-day error offset", ["on-this-day", parts, "--utc-offset", "99"]);
  await capture("on-this-day error year and by-year", ["on-this-day", parts, "--year", "2025", "--by-year"]);
  await capture("on-this-day error not found", ["on-this-day", join(dir, "missing.zip")]);

  // blocked
  await capture("blocked", ["blocked", later]);
  await capture("blocked counts", ["blocked", later, "--counts", "--limit", "1"]);
  await capture("blocked parts", ["blocked", parts, "--verbose"]);
  await capture("blocked error number", ["blocked", later, "--limit", "x"]);
  await capture("blocked json", ["blocked", later, "--json"]);

  // friend-count
  await capture("friend-count ledger", ["friend-count", later, "--ledger", ledger]);
  await capture("friend-count", ["friend-count", later, "--no-save"]);
  await capture("friend-count parts", ["friend-count", parts, "--no-save", "--months", "6", "--verbose"]);
  await capture("friend-count error number", ["friend-count", later, "--months", "x"]);
  await capture("friend-count error not found", ["friend-count", join(dir, "missing.zip")]);

  // rescue: the folder is the one a rescue would have saved, made from the manifest.
  const rescueDir = join(dir, "rescue");
  const manifest = join(rescueDir, "manifest.json");
  const manifest2 = join(rescueDir, "manifest2.json");
  const manifest3 = join(rescueDir, "manifest3.json");
  const manifestParts = join(rescueDir, "manifest-parts.json");
  const folder = join(rescueDir, "saved");
  await capture("rescue", ["rescue", later]);
  await capture("rescue parts", ["rescue", parts, "--verbose"]);
  await capture("rescue saved", ["rescue", later, "--out", manifest]);
  populateRescueFolder(folder, manifest);
  await capture("rescue with folder", ["rescue", later, "--folder", folder, "--out", manifest2]);
  await capture("rescue verify", ["rescue", "--verify", manifest, "--folder", folder]);
  await capture("rescue verify list", ["rescue", "--verify", manifest, "--folder", folder, "--list", "--verbose"]);
  await capture("rescue error not found", ["rescue", join(dir, "missing.zip")]);
  await capture("rescue error layout", ["rescue", later, "--layout", "bad"]);
  await capture("rescue error exists", ["rescue", later, "--out", manifest]);
  written(manifest, manifest2);

  // privacy
  await capture("privacy", ["privacy"]);
  await capture("privacy done", ["privacy", "--done", "search,quick-add"]);
  await capture(
    "privacy all done",
    ["privacy", "--done", "contact-me,group-invites,view-story,quick-add,search,map-location,spotlight-profile,personalized-ads,data-sharing"],
  );
  await capture("privacy json", ["privacy", "--json", "--verbose"]);
  await capture("privacy error id", ["privacy", "--done", "nope"]);

  // remind
  const calendar = join(dir, "reminders", "r.ics");
  const calendarParts = join(dir, "reminders", "r-parts.ics");
  await capture("remind", ["remind"]);
  await capture("remind saved", ["remind", later, "--time", "09:30", "--alarm", "1", "--out", calendar]);
  await capture("remind saved parts", ["remind", parts, "--out", calendarParts]);
  await capture("remind last export", ["remind", "--last-export", "2020-01-01", "--verbose"]);
  await capture("remind error months", ["remind", "--months", "0"]);
  await capture("remind json", ["remind", "--json"]);
  written(calendar, calendarParts);

  // JSON of every command, with --verbose and the list variants. Each one is read over the export that holds
  // download links ("<name> json") and over the three-part export that holds entry names ("<name> json parts"),
  // since a leak of either kind would show in only one of them.
  const sources: Array<[string, string]> = [["", later], [" parts", parts]];
  for (const [label, source] of sources) {
    const cases: Array<[string, string[]]> = [
      ["check", ["check", source, "--friend-count", "300"]],
      ["storage", ["storage", source, "--goal-gb", "0.00003", "--oldest-first"]],
      ["backup", ["backup", source]],
      ["backup list", ["backup", source, "--list"]],
      ["backup compare", ["backup", source, "--compare", backup, "--list"]],
      ["replies", ["replies", source, "--you-days", "0", "--them-days", "0"]],
      ["habits", ["habits", source, "--detail", "--utc-offset=-5:30"]],
      ["closest", ["closest", source]],
      ["safety", ["safety", source, "--done", "blocked-list"]],
      ["anniversaries", ["anniversaries", source, "--days", "366"]],
      ["on-this-day", ["on-this-day", source]],
      ["on-this-day days", ["on-this-day", source, "--date", "2026-10-15", "--window", "5"]],
      ["on-this-day by year", ["on-this-day", source, "--by-year"]],
      ["blocked", ["blocked", source]],
      ["blocked counts", ["blocked", source, "--counts"]],
      ["friend-count", ["friend-count", source, "--no-save"]],
      ["rescue", ["rescue", source]],
      ["rescue folder", ["rescue", source, "--folder", folder]],
      ["remind", ["remind", source]],
    ];
    for (const [name, args] of cases) await capture(`${name} json${label}`, [...args, "--json", "--verbose"]);
  }
  await capture("friend-count ledger json", ["friend-count", later, "--ledger", ledger, "--json", "--verbose"]);
  await capture("rescue verify json", ["rescue", "--verify", manifest, "--folder", folder, "--list", "--json", "--verbose"]);
  await capture("rescue saved json", ["rescue", later, "--out", manifest3, "--json"]);
  await capture("rescue saved parts", ["rescue", parts, "--out", manifestParts]);
  await capture("privacy done json", ["privacy", "--done", "search,quick-add", "--json"]);
  written(manifest3, manifestParts);

  return { outputs, json, files, entryNames: describeZips([later, ...partZips]).names };
}

let cached: Promise<InsightOutputs> | undefined;

/**
 * The runs, made once. Test files run in separate workers, and five of them need these runs, so the first
 * one to ask makes them and the others take its result from the shared folder that global-setup.ts provides.
 * Without that folder (the file run on its own with another runner) each file makes its own.
 */
export function insightRuns(): Promise<InsightOutputs> {
  cached ??= sharedRuns("insight-runs", collectInsightRuns);
  return cached;
}

/** Just the printed text, named so that it can sit beside the other commands' outputs. */
export async function collectInsightOutputs(): Promise<Record<string, string>> {
  return (await insightRuns()).outputs;
}
