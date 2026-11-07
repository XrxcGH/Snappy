/**
 * snappy-export analyze: read the export, update the sealed ledger, and print the cleanup queue.
 * Content-blind: the parsers keep only usernames, dates and categories, and every line printed
 * here is a count, a code, a date or a username.
 */
import { addSnapshot, emptyLedger, normUser, snapshotFromExport, validateExport } from "@snappy-export/core";
import type { Confidence, Ledger, ParsedExport } from "@snappy-export/core";
import { analyzeExport } from "../analysis.ts";
import type { AnalysisResult } from "../analysis.ts";
import { intOption, parseFlags } from "../args.ts";
import { CliError } from "../errors.ts";
import type { Io } from "../io.ts";
import { newestMtime, parseParts, requireFirstPart, resolveZipPaths, withReaders } from "../inputs.ts";
import { acquireLedgerLock, atomicWrite, defaultLedgerPath, isFreshStore, saveLedger, unlockStore } from "../ledger-store.ts";
import { resolvePassphrase } from "../prompt.ts";
import { PRIVACY_RESULTS, renderIssues, wrapText } from "../render.ts";
import type { LabeledIssue } from "../render.ts";
import { analysisToJson, queueToCsv, renderAnalysisText } from "../render-analysis.ts";
import { createTerm } from "../term.ts";

export const ANALYZE_USAGE = `Usage: snappy-export analyze <zips or folder...> [options]

Reads your export, compares it with earlier ones, and lists friends worth reviewing.
Several zips (or a folder of zips) are the parts of ONE export. Saved chats and Snaps both count
as recent activity. It also shows how the Memories list matches the files in the zips (counts only).

Options
  --earlier <path>          An earlier export to compare with (zips or a folder). Repeatable.
  --no-save                 Do not read or write the ledger. Nothing is written and no passphrase is asked.
  --ledger <path>           Sealed ledger file. Default: ~/.snappy/ledger.sealed
  --passphrase-file <path>  Read the passphrase from the first line of this file.
                            Otherwise SNAPPY_PASSPHRASE, otherwise a hidden prompt.
  --friend-count <n>        The friend count you see in the app, to catch an incomplete export.
  --min-confidence <level>  Hide results below low, medium or high. Default: low.
  --allow <name,...>        Never list these friends (this run only; use snappy-export keep to save them).
  --limit <n>               Rows to print in the queue table. Default: 50. Use 0 for all.
  --json                    Print a machine-readable result instead of the table.
  --csv <path>              Also write the queue as a CSV file (username, category, confidence, score).
  --no-color                Plain text.

Exit codes: 0 done, 1 could not run, 2 the export has errors.
`;

interface Flags {
  earlier?: string[];
  "no-save"?: boolean;
  ledger?: string;
  "passphrase-file"?: string;
  "friend-count"?: string;
  "min-confidence"?: string;
  allow?: string[];
  limit?: string;
  json?: boolean;
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
  const parsed = await withReaders(paths, parseParts);
  const issues = issuesFor(parsed, source, io, friendCount);
  let takenAt = parsed.exportedAt;
  if (takenAt === undefined) {
    // No date inside the export: the file's own date is the next best "when was this true".
    takenAt = (await newestMtime(paths)) ?? io.now();
    issues.push({
      severity: "warning",
      code: "export-time-from-file",
      message: "Snappy could not find when this export was made, so it used the date of the file. If you copied or re-downloaded the file, the date may be wrong.",
      source,
    });
  }
  return { parsed, issues, takenAt };
}

function parseAllow(values: string[] | undefined): string[] {
  const names = (values ?? []).flatMap((v) => v.split(",")).map((v) => normUser(v.trim())).filter((v) => v !== "");
  for (const name of names) {
    if (/\s/.test(name) || name.length > 100) {
      throw new CliError("usage", "--allow takes usernames separated by commas, for example --allow sam_01,alex.k");
    }
  }
  return names;
}

export async function analyzeCommand(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseFlags<Flags>("analyze", args, {
    earlier: { type: "string", multiple: true },
    "no-save": { type: "boolean" },
    ledger: { type: "string" },
    "passphrase-file": { type: "string" },
    "friend-count": { type: "string" },
    "min-confidence": { type: "string" },
    allow: { type: "string", multiple: true },
    limit: { type: "string" },
    json: { type: "boolean" },
    csv: { type: "string" },
    "no-color": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (flags.help) {
    io.out.write(ANALYZE_USAGE);
    return 0;
  }

  const friendCount = intOption("--friend-count", flags["friend-count"], 0, 10_000_000);
  const limit = intOption("--limit", flags.limit, 0, 1_000_000) ?? 50;
  const minConfidence = (flags["min-confidence"] ?? "low").toLowerCase();
  if (!CONFIDENCES.includes(minConfidence)) {
    throw new CliError("usage", "--min-confidence must be low, medium or high.");
  }
  if (flags.csv !== undefined && !flags.csv.toLowerCase().endsWith(".csv")) {
    throw new CliError("usage", "--csv needs a file name ending in .csv, so Snappy never overwrites another kind of file.");
  }
  const allow = parseAllow(flags.allow);
  const noSave = flags["no-save"] === true;
  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });

  const currentPaths = await resolveZipPaths(positionals);
  requireFirstPart(currentPaths);
  const earlierSets: string[][] = [];
  for (const value of flags.earlier ?? []) earlierSets.push(await resolveZipPaths([value]));

  // Read everything first: a broken export should stop the run before any passphrase is asked.
  const issues: LabeledIssue[] = [];
  const earlier = [];
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
        "Snappy stopped before building the cleanup queue, because it will not suggest removing anyone based on a broken export. Fix the problems above and run it again. Nothing was saved.",
        term.columns - 2,
      );
      io.out.write([...renderIssues(issues, term), "", ...stop, PRIVACY_RESULTS].join("\n") + "\n");
    }
    return 2;
  }

  // The ledger: read and updated unless --no-save, in which case it exists only in memory.
  const ledgerPath = flags.ledger ?? defaultLedgerPath(io.homedir());
  let ledger: Ledger = emptyLedger();
  let saved: string[] = [];
  let passphrase: string | undefined;
  let release: (() => Promise<void>) | undefined;
  if (!noSave) {
    passphrase = await resolvePassphrase(io, { file: flags["passphrase-file"], creating: await isFreshStore(ledgerPath) });
    // Held from the first read to the save, so another run at the same time cannot lose this one's snapshots.
    release = await acquireLedgerLock(ledgerPath);
  }
  let result: AnalysisResult;
  try {
    if (passphrase !== undefined) {
      const store = await unlockStore(ledgerPath, passphrase);
      ledger = store.ledger;
      saved = store.allowlist;
    }
    for (const e of earlier) ledger = addSnapshot(ledger, snapshotFromExport(e.parsed, { takenAt: e.takenAt }));
    const snapshot = snapshotFromExport(current.parsed, { takenAt: current.takenAt });
    const newestOther = Math.max(0, ...ledger.snapshots.filter((s) => s.id !== snapshot.id).map((s) => s.takenAt));
    ledger = addSnapshot(ledger, snapshot);
    if (newestOther > snapshot.takenAt) {
      issues.push({
        severity: "warning",
        code: "older-than-ledger",
        message: "This export is older than the newest one in your ledger, so friends are compared with the newer export.",
        source: "your export",
      });
    }

    result = analyzeExport({
      parsed: current.parsed,
      ledger,
      allowlist: [...new Set([...saved, ...allow])],
      now: io.now(),
      minConfidence: minConfidence as Confidence,
    });

    if (passphrase !== undefined) await saveLedger(ledgerPath, ledger, passphrase);
  } finally {
    await release?.();
  }
  if (flags.csv !== undefined) await atomicWrite(flags.csv, new TextEncoder().encode(queueToCsv(result)));

  const ledgerState = noSave ? "skipped" : "saved";
  if (flags.json) {
    io.out.write(analysisToJson(result, { issues, ledger: ledgerState, generatedAt: io.now() }));
  } else {
    io.out.write(renderAnalysisText(result, { term, issues, limit, ledger: ledgerState, csvPath: flags.csv }));
  }
  return 0;
}
