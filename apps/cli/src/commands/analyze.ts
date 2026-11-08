/**
 * snappy-export analyze: read the export, update the sealed ledger, and print the cleanup queue.
 * Content-blind: the parsers keep only usernames, dates and categories, and every line printed
 * here is a count, a code, a date or a username.
 */
import { addSnapshot, emptyLedger, normUser, snapshotFromExport, validateExport } from "@snappy-export/core";
import type { Confidence, Ledger, ParsedExport, Saved } from "@snappy-export/core";
import { analyzeExport } from "../analysis.ts";
import type { AnalysisResult } from "../analysis.ts";
import { intOption, parseFlags } from "../args.ts";
import type { OptionSpec } from "../args.ts";
import { CliError } from "../errors.ts";
import type { Io } from "../io.ts";
import { newestMtime, parseParts, requireFirstPart, resolveZipPaths, withReaders } from "../inputs.ts";
import { atomicWrite, defaultLedgerPath, HISTORY_PATH_OPTIONS, historyPathFlag, isFreshStore, loadStore, saveStore, withLedgerLock } from "../ledger-store.ts";
import { resolvePassphrase } from "../prompt.ts";
import { PRIVACY_RESULTS, renderIssues, wrapText } from "../render.ts";
import type { LabeledIssue } from "../render.ts";
import { analysisToJson, queueToCsv, renderAnalysisText } from "../render-analysis.ts";
import { createTerm } from "../term.ts";

export const ANALYZE_USAGE = `Usage: snappy-export analyze <ZIP files or folder...> [options]

Finds friends worth reviewing and saves your export to your saved history.
Several ZIP files, or a folder of them, are the parts of one export.

Options
  --earlier <path>          An earlier export to compare with. Repeatable.
  --no-save                 Skip your saved history. Nothing is written, no passphrase asked.
  --history <path>          Saved history file. Default: ~/.snappy/ledger.sealed
  --passphrase-file <path>  Use the first line of this file as the passphrase.
  --friend-count <n>        The friend count shown in Snapchat, to catch a short export.
  --min-confidence <level>  Hide results below low, medium, or high. Default: low.
  --allow <name,...>        Leave these friends out this run. Use keep to save them.
  --limit <n>               Rows to print. Default: 50. Use 0 for all.
  --json                    Print JSON instead of the table.
  --csv <path>              Also save the queue as a CSV file.
  --verbose                 Add a short code to notes and errors, for bug reports.
  --no-color                Plain text.

The passphrase comes from --passphrase-file, then SNAPPY_PASSPHRASE, then a hidden prompt.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

/** The options this command accepts, shared with the in-app command catalog's checks. */
export const ANALYZE_OPTIONS: OptionSpec = {
  earlier: { type: "string", multiple: true },
  "no-save": { type: "boolean" },
  ...HISTORY_PATH_OPTIONS,
  "passphrase-file": { type: "string" },
  "friend-count": { type: "string" },
  "min-confidence": { type: "string" },
  allow: { type: "string", multiple: true },
  limit: { type: "string" },
  json: { type: "boolean" },
  verbose: { type: "boolean" },
  csv: { type: "string" },
  "no-color": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

interface Flags {
  earlier?: string[];
  "no-save"?: boolean;
  history?: string;
  ledger?: string;
  "passphrase-file"?: string;
  "friend-count"?: string;
  "min-confidence"?: string;
  allow?: string[];
  limit?: string;
  json?: boolean;
  verbose?: boolean;
  csv?: string;
  "no-color"?: boolean;
  help?: boolean;
}

const CONFIDENCES: readonly string[] = ["low", "medium", "high"];

function dedupe(issues: LabeledIssue[]): LabeledIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const id = `${i.source}|${i.code}|${i.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function issuesFor(parsed: ParsedExport, source: string, io: Io, expectedFriendCount?: number): LabeledIssue[] {
  const found = [...parsed.issues, ...validateExport(parsed, { expectedFriendCount, now: io.now() })];
  return dedupe(found.map((i) => ({ ...i, source })));
}

/** Parse one export (its parts merged) and return it with its issues and the date it was made. */
async function readExport(paths: string[], source: string, io: Io, friendCount?: number) {
  const parsed = await withReaders(io, paths, (readers) => parseParts(readers, io));
  const issues = issuesFor(parsed, source, io, friendCount);
  let takenAt = parsed.exportedAt;
  if (takenAt === undefined) {
    // No date inside the export: the file's own date is the next best "when was this true".
    takenAt = (await newestMtime(io, paths)) ?? io.now();
    issues.push({
      severity: "warning",
      code: "export-time-from-file",
      message: "Snappy could not find the export date, so it used the file date. That may be wrong if you copied the file.",
      source,
    });
  }
  return { parsed, issues, takenAt };
}

function parseAllow(values: string[] | undefined): string[] {
  const names = (values ?? []).flatMap((v) => v.split(",")).map((v) => normUser(v.trim())).filter((v) => v !== "");
  for (const name of names) {
    if (/\s/.test(name) || name.length > 100) {
      throw new CliError("usage", "--allow takes usernames separated by commas, like --allow sam_01,alex.k");
    }
  }
  return names;
}

export async function analyzeCommand(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseFlags<Flags>("analyze", args, ANALYZE_OPTIONS);
  if (flags.help) {
    io.out.write(ANALYZE_USAGE);
    return 0;
  }

  const friendCount = intOption("--friend-count", flags["friend-count"], 0, 10_000_000);
  const limit = intOption("--limit", flags.limit, 0, 1_000_000) ?? 50;
  const minConfidence = (flags["min-confidence"] ?? "low").toLowerCase();
  if (!CONFIDENCES.includes(minConfidence)) {
    throw new CliError("usage", "--min-confidence must be low, medium, or high.");
  }
  if (flags.csv !== undefined && !flags.csv.toLowerCase().endsWith(".csv")) {
    throw new CliError("usage", "--csv needs a file name ending in .csv, so no other file is overwritten.");
  }
  const allow = parseAllow(flags.allow);
  const noSave = flags["no-save"] === true;
  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });

  const currentPaths = await resolveZipPaths(io, positionals);
  requireFirstPart(currentPaths);
  const earlierSets: string[][] = [];
  for (const value of flags.earlier ?? []) earlierSets.push(await resolveZipPaths(io, [value]));

  // Read everything first: a broken export should stop the run before any passphrase is asked.
  const issues: LabeledIssue[] = [];
  const earlier: Awaited<ReturnType<typeof readExport>>[] = [];
  for (const [i, paths] of earlierSets.entries()) {
    const read = await readExport(paths, `earlier export ${i + 1}`, io);
    issues.push(...read.issues);
    earlier.push(read);
  }
  const current = await readExport(currentPaths, "your export", io, friendCount);
  issues.push(...current.issues);

  if (issues.some((i) => i.severity === "error")) {
    if (flags.json) {
      io.out.write(JSON.stringify({ generatedAt: new Date(io.now()).toISOString(), issues, stopped: "export-errors" }, null, 2) + "\n");
    } else {
      const stop = wrapText(
        "Snappy stopped. It will not suggest removals from a broken export, so nothing was saved. Fix the problems above and run it again.",
        term.columns - 2,
      );
      io.out.write([...renderIssues(issues, term, flags.verbose === true), "", ...stop, PRIVACY_RESULTS].join("\n") + "\n");
    }
    return 2;
  }

  // The ledger: read and updated unless --no-save, in which case it exists only in memory.
  const ledgerPath = historyPathFlag(flags) ?? defaultLedgerPath(io);
  const passphrase = noSave ? undefined : await resolvePassphrase(io, { file: flags["passphrase-file"], creating: await isFreshStore(io, ledgerPath) });
  const update = async (): Promise<AnalysisResult> => {
    let store: Saved = { ledger: emptyLedger(), allowlist: [], checkedOff: [] };
    if (passphrase !== undefined) store = await loadStore(io, ledgerPath, passphrase);
    let ledger: Ledger = store.ledger;
    for (const e of earlier) ledger = addSnapshot(ledger, snapshotFromExport(e.parsed, { takenAt: e.takenAt }));
    const snapshot = snapshotFromExport(current.parsed, { takenAt: current.takenAt });
    const newestOther = Math.max(0, ...ledger.snapshots.filter((s) => s.id !== snapshot.id).map((s) => s.takenAt));
    ledger = addSnapshot(ledger, snapshot);
    if (newestOther > snapshot.takenAt) {
      issues.push({
        severity: "warning",
        code: "older-than-ledger",
        message: "This export is older than one in your saved history, so Snappy compares with the newer one.",
        source: "your export",
      });
    }

    const analyzed = analyzeExport({
      parsed: current.parsed,
      ledger,
      allowlist: [...new Set([...store.allowlist, ...allow])],
      now: io.now(),
      minConfidence: minConfidence as Confidence,
    });

    // The keep list and the checkmarks are saved as they were: analyze changes only the snapshots.
    if (passphrase !== undefined) await saveStore(io, ledgerPath, { ...store, ledger }, passphrase);
    return analyzed;
  };
  // Held from the first read to the save, so another run at the same time cannot lose this one's snapshots.
  const result = passphrase === undefined ? await update() : await withLedgerLock(io, ledgerPath, update);
  if (flags.csv !== undefined) await atomicWrite(io, flags.csv, new TextEncoder().encode(queueToCsv(result)));

  const ledgerState = noSave ? "skipped" : "saved";
  if (flags.json) {
    io.out.write(analysisToJson(result, { issues, ledger: ledgerState, generatedAt: io.now() }));
  } else {
    io.out.write(renderAnalysisText(result, { term, issues, limit, ledger: ledgerState, csvPath: flags.csv, verbose: flags.verbose === true }));
  }
  return 0;
}
