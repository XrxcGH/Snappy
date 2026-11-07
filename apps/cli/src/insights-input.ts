/**
 * Shared input for the insight commands. It reads the export zips the same way `analyze` does (the
 * same path rules, readers and parser, from inputs.ts) and hands back what an insight needs, so no
 * command parses a zip itself. Read-only: nothing here writes a file, and the sealed ledger is
 * opened only when a command asks for it.
 *
 * Content-blind like the rest of the CLI: the result holds the parser's allowlisted fields, counts
 * and dates, and `issues` carry counts and codes, never a name or a value from the export.
 */
import type { ParseArgsConfig } from "node:util";
import { describeStructureFromReader, layoutSummary, listParts, validateExport } from "@snappy-export/core";
import type { ExportIssue, Ledger, LayoutSummary, ParsedExport, StructureReport } from "@snappy-export/core";
import { intOption, parseFlags } from "./args.ts";
import type { Parsed } from "./args.ts";
import { CliError } from "./errors.ts";
import type { Io } from "./io.ts";
import { newestMtime, parseParts, requireFirstPart, resolveZipPaths, withReaders } from "./inputs.ts";
import { defaultLedgerPath, isFreshStore, loadLedger } from "./ledger-store.ts";
import { resolvePassphrase } from "./prompt.ts";
import { createTerm } from "./term.ts";
import type { Term } from "./term.ts";

type OptionSpec = NonNullable<ParseArgsConfig["options"]>;

/** Flags every insight command accepts. --verbose is added by parseFlags itself. */
export interface CommonFlags {
  json?: boolean;
  "no-color"?: boolean;
  help?: boolean;
  verbose?: boolean;
}

export const COMMON_OPTIONS: OptionSpec = {
  json: { type: "boolean" },
  "no-color": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

/** For commands that compare the export with the friend count shown in the app. */
export interface FriendCountFlags {
  "friend-count"?: string;
}
export const FRIEND_COUNT_OPTIONS: OptionSpec = { "friend-count": { type: "string" } };

/** For the one command that reads the sealed ledger. */
export interface LedgerFlags {
  ledger?: string;
  "passphrase-file"?: string;
}
export const LEDGER_OPTIONS: OptionSpec = {
  ledger: { type: "string" },
  "passphrase-file": { type: "string" },
};

/** parseFlags with the common options added. `extra` holds the command's own options. */
export function parseInsightArgs<T>(command: string, args: string[], extra: OptionSpec = {}): Parsed<T & CommonFlags> {
  return parseFlags<T & CommonFlags>(command, args, { ...COMMON_OPTIONS, ...extra });
}

/** The terminal styling for this run (color is off for NO_COLOR, --no-color and pipes). */
export function insightTerm(flags: CommonFlags, io: Io): Term {
  return createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });
}

export interface PartsInfo {
  /** ZIP files read, in export order. */
  count: number;
  /** 0-based indexes of parts that could not be listed. Known only when `layout` was requested. */
  unreadable?: number[];
}

export interface InsightInput {
  /** Every part merged, exactly as `analyze` reads it. */
  parsed: ParsedExport;
  /** When the export says it was made, if it says. */
  exportedAt?: number;
  /** When the export's data was true: its own date, else the newest file date, else the clock. */
  takenAt: number;
  takenAtSource: "export" | "file" | "clock";
  /** The clock value from io.now(), read once so one run uses one "now". */
  now: number;
  /** Parser notes plus whole-export checks, de-duplicated. Counts and codes only. */
  issues: ExportIssue[];
  /** True when any issue is an error: the export is not safe to draw conclusions from. */
  broken: boolean;
  parts: PartsInfo;
  /** Present when `layout` was requested. */
  layout?: LayoutSummary;
  /** Present when `structure` was requested. */
  structure?: StructureReport;
  /** The sealed ledger, when `ledger` was requested and one has been saved. */
  ledger?: Ledger;
}

export interface LoadOptions {
  /** The friend count shown in the app, to catch a short export. */
  friendCount?: number;
  /** Also list each part's directory: unreadable parts and folder totals. Reads no file contents. */
  layout?: boolean;
  /** Also describe the JSON files' shape. Reads the small JSON files and streams the large ones. */
  structure?: boolean;
  /**
   * Also open the sealed ledger, read-only and after the export is read (so a path mistake is
   * reported before any passphrase is asked). A missing ledger leaves `ledger` undefined.
   */
  ledger?: { path?: string; passphraseFile?: string };
}

function dedupe(issues: ExportIssue[]): ExportIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const id = `${i.code}|${i.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Resolve the paths (ZIP files, a folder or a wildcard), read them and return the parsed export.
 * Throws the same calm CliErrors as `analyze` for a missing path, a non-zip or later parts alone.
 */
export async function loadInsightInput(paths: string[], io: Io, opts: LoadOptions = {}): Promise<InsightInput> {
  const zipPaths = await resolveZipPaths(paths);
  requireFirstPart(zipPaths);
  const now = io.now();

  let layout: LayoutSummary | undefined;
  let structure: StructureReport | undefined;
  let unreadable: number[] | undefined;
  const parsed = await withReaders(zipPaths, async (readers) => {
    const result = await parseParts(readers);
    if (opts.layout === true) {
      const listed = await listParts(readers);
      layout = layoutSummary(listed.parts);
      unreadable = listed.unreadable;
    }
    if (opts.structure === true) structure = await describeStructureFromReader(readers);
    return result;
  });

  const issues = dedupe([...parsed.issues, ...validateExport(parsed, { expectedFriendCount: opts.friendCount, now })]);
  let takenAt = parsed.exportedAt;
  let takenAtSource: InsightInput["takenAtSource"] = "export";
  if (takenAt === undefined) {
    const fileDate = await newestMtime(zipPaths);
    takenAt = fileDate ?? now;
    takenAtSource = fileDate === undefined ? "clock" : "file";
  }

  let ledger: Ledger | undefined;
  if (opts.ledger !== undefined) {
    const ledgerPath = opts.ledger.path ?? defaultLedgerPath(io.homedir());
    if (!(await isFreshStore(ledgerPath))) {
      const passphrase = await resolvePassphrase(io, { file: opts.ledger.passphraseFile, creating: false });
      ledger = await loadLedger(ledgerPath, passphrase);
    }
  }

  return {
    parsed,
    ...(parsed.exportedAt !== undefined && { exportedAt: parsed.exportedAt }),
    takenAt,
    takenAtSource,
    now,
    issues,
    broken: issues.some((i) => i.severity === "error"),
    parts: { count: zipPaths.length, ...(unreadable !== undefined && { unreadable }) },
    ...(layout !== undefined && { layout }),
    ...(structure !== undefined && { structure }),
    ...(ledger !== undefined && { ledger }),
  };
}

/** The friend count flag as a whole number, or undefined when it was not given. */
export function friendCountOf(flags: FriendCountFlags): number | undefined {
  return intOption("--friend-count", flags["friend-count"], 0, 10_000_000);
}

/**
 * Ids from a repeatable, comma-separated option such as --done a,b --done c, checked against the
 * ids the command knows. The typed value is never echoed, so a mistake cannot print anything odd.
 */
export function parseIdList(option: string, values: string[] | undefined, known: readonly string[]): string[] {
  const ids = [...new Set((values ?? []).flatMap((v) => v.split(",")).map((v) => v.trim().toLowerCase()).filter((v) => v !== ""))];
  if (ids.some((id) => !known.includes(id))) {
    throw new CliError("usage", `${option} has an id Snappy does not know. Run the command without ${option} to see the ids.`);
  }
  return ids;
}
