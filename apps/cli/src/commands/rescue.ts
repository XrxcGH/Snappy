/**
 * snappy-export rescue: a manifest of a Memories rescue, and a check of a rescue folder against it.
 *
 * Build mode reads the Memories list of your export (the same list `memories` plans from) and, when
 * you add --out, writes a manifest: saved names, sizes and dates, never a photo or video. Verify mode
 * reads a manifest and a folder listing (names, sizes and file dates only) and compares them. Both are
 * read-only except for the one file --out names. The export's own file names and links never appear:
 * the manifest holds only the names Snappy generates for the saved files.
 */
import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { insights, planMemories } from "@snappy-export/core";
import { intOption } from "../args.ts";
import { CliError, fsError } from "../errors.ts";
import { formatCount, formatDate, hasHave, isAre, noun, plural, wasWere } from "../format.ts";
import type { InsightCommand } from "../insights-command.ts";
import { insightTerm, loadInsightInput, parseInsightArgs } from "../insights-input.ts";
import type { CommonFlags } from "../insights-input.ts";
import { checkOutputPath, saveInsightFile } from "../insights-output.ts";
import type { Io } from "../io.ts";
import { finish, jsonText, renderNotes, section } from "../render-insights.ts";
import type { NoteLine } from "../render-insights.ts";
import type { Term } from "../term.ts";

export const RESCUE_USAGE = `Usage: snappy-export rescue <ZIP files or folder...> [--folder <folder>] [--out <file>.json]
       snappy-export rescue --verify <file>.json --folder <folder> [options]

Lists the Memories your rescue saves, and checks a rescue folder against that list later. It
compares names, sizes and file dates only, and never opens a photo or video.

Options
  --folder <folder>   The rescue folder. Lists the files saved there.
  --out <file>        Save the manifest as a .json file. Needs the ZIP files.
  --force             Replace the manifest file if it exists.
  --layout <layout>   Folders: flat, year, or year-month. Default: year-month.
  --verify <file>     Check the folder against this manifest. Needs --folder.
  --list              With --verify: list the files that need attention.
  --tolerance <n>     With --verify: allowed file date gap in seconds. Default: 2.
  --json              Print JSON instead of text.
  --verbose           Add a short code to each note, for bug reports.
  --no-color          Plain text.

Exit codes: 0 done, 1 could not run, 2 the folder or export needs attention.
`;

interface Flags extends CommonFlags {
  folder?: string;
  out?: string;
  force?: boolean;
  layout?: string;
  verify?: string;
  list?: boolean;
  tolerance?: string;
}

type Note = insights.rescueManifest.RescueNote;
type Counts = insights.rescueManifest.ManifestCounts;
type Verified = insights.rescueManifest.VerifyResult;

/** What the build mode found. `savedTo` is the path as the person typed it. */
export interface BuildView {
  mode: "build";
  /** Memories in the plan, and whether the saved files were read from a folder. */
  planned: number;
  fromFolder: boolean;
  counts: Counts;
  notes: Note[];
  savedTo?: string;
  /** The person passed --out, so a manifest was expected. */
  wantedFile: boolean;
}

/** What the verify mode found. */
export interface VerifyView {
  mode: "verify";
  createdAt: number | null;
  manifestCounts: Counts;
  manifestNotes: Note[];
  result: Verified;
  list: boolean;
}

export type RescueView = BuildView | VerifyView;

/** The most rows listed per kind with --list. */
const LIST_LIMIT = 50;
/** Largest manifest Snappy reads, so a wrong file cannot fill memory. */
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 1_000_000;
const MAX_DEPTH = 12;
const DEFAULT_TOLERANCE_S = 2;

const num = (n: number | undefined): number => (typeof n === "number" ? n : 0);
const countOf = (n: Note): number => num(n.params.count);

/** The sentence for one note about a manifest. Hedged: Snappy compares names, sizes and dates only. */
function manifestNoteText(n: Note, fromFolder: boolean): NoteLine {
  const c = countOf(n);
  switch (n.code) {
    case "path-skipped":
      return { severity: "warning", code: n.code, text: `${plural(c, "item")} had no usable file name and ${wasWere(c)} left out.` };
    case "path-duplicate":
      return { severity: "warning", code: n.code, text: `${plural(c, "file name")} repeated another and ${wasWere(c)} left out.` };
    case "overlay-skipped":
      return { severity: "warning", code: n.code, text: `${plural(c, "overlay file")} had no usable name and ${wasWere(c)} left out.` };
    case "id-replaced":
      return { severity: "info", code: n.code, text: `${plural(c, "item")} got a new id, since ${noun(c, "its", "their")} id was missing or repeated.` };
    case "time-in-future":
      return { severity: "info", code: n.code, text: `${plural(c, "date")} ${isAre(c)} in the future, so ${noun(c, "it counts", "they count")} as missing.` };
    case "time-invalid":
      return { severity: "info", code: n.code, text: `${plural(c, "date")} could not be used, so ${noun(c, "it counts", "they count")} as missing.` };
    case "size-missing":
      return {
        severity: "info",
        code: n.code,
        text: fromFolder
          ? `${plural(c, "item")} ${hasHave(c)} no saved size, so a later check compares ${noun(c, "it", "them")} by name and date only.`
          : "Sizes were not recorded. Add --folder to record them, or a later check compares names and dates only.",
      };
    default:
      return { severity: "info", code: String(n.code), text: "Snappy noted something it cannot describe. Run it with --verbose and share the code." };
  }
}

/** The sentence for one note about a folder check. */
function verifyNoteText(n: Note): NoteLine {
  const c = countOf(n);
  switch (n.code) {
    case "size-not-checked":
      return { severity: "info", code: n.code, text: `${plural(c, "item")} ${hasHave(c)} no saved size, so ${noun(c, "its", "their")} size was not checked.` };
    case "time-not-checked":
      return { severity: "info", code: n.code, text: `${plural(c, "file")} ${hasHave(c)} no capture date, so ${noun(c, "its", "their")} date was not checked.` };
    case "case-differs":
      return { severity: "info", code: n.code, text: `${plural(c, "file name")} ${noun(c, "differs", "differ")} from the manifest only in letter case.` };
    case "duplicate-disk-entry":
      return { severity: "info", code: n.code, text: `${plural(c, "file")} ${wasWere(c)} listed twice in the folder.` };
    default:
      return { severity: "info", code: String(n.code), text: "Snappy noted something it cannot describe. Run it with --verbose and share the code." };
  }
}

const countRows = (c: Counts): string[][] => [
  ["Memories", formatCount(c.items)],
  ["Photos", formatCount(c.images)],
  ["Videos", formatCount(c.videos)],
  ["Other types", formatCount(c.unknown)],
  ["Overlay files", formatCount(c.overlayFiles)],
  ["Without a date", formatCount(c.undated)],
  ["With a saved size", formatCount(c.withSize)],
];

function renderBuild(v: BuildView, term: Term, verbose: boolean): string[] {
  const out: string[] = [term.bold("Rescue manifest")];
  const none = v.counts.items === 0;
  if (v.planned === 0) out.push("  This export has no Memories to list.", "");
  else if (none) out.push("  None of the planned files were found in that folder.", "");
  else {
    const found = v.fromFolder ? `${term.violet(formatCount(v.counts.items))} of ${plural(v.planned, "Memory", "Memories")} found in the folder.` : `${term.violet(plural(v.counts.items, "Memory", "Memories"))} listed from your export.`;
    out.push(`  ${found}`, "");
    out.push(...section(term, "What it holds", term.table([{ header: "Item" }, { header: "Count", align: "right" }], countRows(v.counts))));
  }

  const notes = renderNotes(
    v.notes.map((n) => manifestNoteText(n, v.fromFolder)),
    term,
    { heading: "Notes", verbose },
  );
  if (notes.length > 0) out.push(...notes, "");

  if (v.savedTo !== undefined) out.push(`  Saved to ${v.savedTo}.`, "");
  else if (v.wantedFile && none) out.push("  No manifest was saved, since it would be empty.", "");
  else if (!v.wantedFile && !none) out.push("  No file was saved. Add --out <file>.json to save the manifest.", "");
  if (v.savedTo !== undefined) out.push("  To check a rescue folder later, run rescue with --verify and --folder.", "");
  return out;
}

const PROBLEM_ROWS: { kind: "missing" | "extra" | "size" | "time"; label: string }[] = [
  { kind: "missing", label: "Missing" },
  { kind: "extra", label: "Not in manifest" },
  { kind: "size", label: "Wrong size" },
  { kind: "time", label: "Wrong date" },
];

function renderVerify(v: VerifyView, term: Term, verbose: boolean): string[] {
  const r = v.result;
  const c = r.counts;
  const out: string[] = [term.bold("Rescue check"), `  ${term.violet(r.ok ? "The folder matches the manifest." : "The folder may not match the manifest.")}`, ""];

  const made = v.createdAt === null ? [] : [`Manifest made ${formatDate(v.createdAt)}.`];
  out.push(
    ...section(term, "What was compared", [
      `${plural(r.expectedFiles, "file")} in the manifest, ${formatCount(r.diskFiles)} in the folder.`,
      ...made,
      ...term.table(
        [{ header: "Result" }, { header: "Files", align: "right" }],
        [
          ["Matched", formatCount(c.matched)],
          ["Missing", formatCount(c.missing)],
          ["Not in manifest", formatCount(c.extra)],
          ["Wrong size", formatCount(c.sizeMismatch)],
          ["Wrong date", formatCount(c.timeMismatch)],
        ],
      ),
    ]),
  );

  if (v.list && !r.ok) {
    const rows: string[][] = [];
    for (const p of PROBLEM_ROWS) {
      const items = p.kind === "missing" ? r.missing : p.kind === "extra" ? r.extra : p.kind === "size" ? r.sizeMismatch : r.timeMismatch;
      for (const row of items) rows.push([p.label, row.path]);
    }
    out.push(...section(term, "Files to look at", [...term.table([{ header: "Problem" }, { header: "File", flex: true }], rows), ...(r.truncated ? [`Each list stops at ${LIST_LIMIT} files. The counts are complete.`] : [])]));
  }

  const notes = renderNotes([...v.manifestNotes.filter((n) => n.code !== "size-missing").map((n) => manifestNoteText(n, true)), ...r.notes.map(verifyNoteText)], term, { heading: "Notes", verbose });
  if (notes.length > 0) out.push(...notes, "");

  const todo: string[] = [];
  if (c.missing > 0) todo.push("Run memories again with the same folder. It skips files already saved.");
  if (c.sizeMismatch > 0) todo.push("A file with the wrong size may be incomplete. Move it away, then run memories again.");
  if (c.timeMismatch > 0) todo.push("A different file date may mean the file was copied or edited after the rescue.");
  if (c.extra > 0) todo.push("Files the manifest does not list may come from another run or program.");
  if (todo.length > 0 && !v.list) todo.push("Add --list to see which files.");
  if (todo.length > 0) out.push(...section(term, "What to do", todo.map((t, i) => `${i + 1}. ${t}`)));
  return out;
}

export function renderRescueManifest(view: RescueView, term: Term, verbose: boolean): string {
  return finish(view.mode === "build" ? renderBuild(view, term, verbose) : renderVerify(view, term, verbose));
}

/** The folder's files as names relative to it, with sizes and file dates. Symbolic links are not followed. */
async function listFolder(root: string, typed: string): Promise<insights.rescueManifest.DiskEntry[]> {
  const found: insights.rescueManifest.DiskEntry[] = [];
  const pending: { dir: string; rel: string; depth: number }[] = [{ dir: root, rel: "", depth: 0 }];
  while (pending.length > 0) {
    const { dir, rel, depth } = pending.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      throw fsError(e, "read the folder", typed);
    }
    const files: { path: string; abs: string }[] = [];
    for (const d of entries) {
      const path = rel === "" ? d.name : `${rel}/${d.name}`;
      const abs = resolve(dir, d.name);
      if (d.isDirectory()) {
        if (depth < MAX_DEPTH) pending.push({ dir: abs, rel: path, depth: depth + 1 });
      } else if (d.isFile()) {
        files.push({ path, abs });
      }
    }
    if (found.length + files.length > MAX_FILES) {
      throw new CliError("too-many-files", "That folder holds more files than Snappy checks at once. Check a smaller folder.");
    }
    for (let i = 0; i < files.length; i += 64) {
      const batch = files.slice(i, i + 64);
      const infos = await Promise.all(
        batch.map(async (f) => {
          try {
            return await lstat(f.abs);
          } catch (e) {
            throw fsError(e, "read the folder", typed);
          }
        }),
      );
      batch.forEach((f, n) => found.push({ path: f.path, size: infos[n]!.size, mtimeMs: infos[n]!.mtimeMs }));
    }
  }
  return found;
}

async function requireFolder(path: string, option: string): Promise<string> {
  if (path.trim() === "") throw new CliError("usage", `${option} needs a folder name.`);
  const abs = resolve(path);
  let info;
  try {
    info = await lstat(abs);
  } catch (e) {
    throw fsError(e, "open", path);
  }
  if (!info.isDirectory()) throw new CliError("not-a-folder", `Snappy needs a folder at "${path}", but found a file. Choose a folder.`);
  return abs;
}

async function readManifestText(path: string): Promise<string> {
  if (path.trim() === "") throw new CliError("usage", "--verify needs a manifest file name.");
  const abs = resolve(path);
  try {
    const info = await lstat(abs);
    if (info.isDirectory()) throw Object.assign(new Error("dir"), { code: "EISDIR" });
    if (info.size > MAX_MANIFEST_BYTES) throw new CliError("manifest-too-large", "That file is too large to be a rescue manifest.");
    return await readFile(abs, "utf8");
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw fsError(e, "read", path);
  }
}

/** The manifest's own name relative to the folder, so the check does not count it as an extra file. */
function insideFolder(folder: string, file: string): string | undefined {
  const rel = relative(folder, resolve(file));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.replace(/\\/g, "/");
}

async function runBuild(flags: Flags, positionals: string[], io: Io, folder: string | undefined): Promise<{ view: BuildView; code: number }> {
  const layout = flags.layout ?? "year-month";
  const input = await loadInsightInput(positionals, io);
  if (input.broken) {
    throw new CliError("export-broken", 'This export has errors, so Snappy listed nothing. Run "snappy-export check" with the same files to see why.', 2);
  }
  const plan = planMemories(input.parsed.memories, { layout: layout as "flat" | "year" | "year-month", now: input.now });

  let entries = plan.entries;
  let sizes: Map<string, number> | undefined;
  let overlayNames: Set<string> | undefined;
  if (folder !== undefined) {
    const disk = await listFolder(folder, flags.folder ?? "");
    const byLower = new Map(disk.map((d) => [d.path.toLowerCase(), d]));
    sizes = new Map();
    overlayNames = new Set();
    entries = plan.entries.filter((e) => {
      const hit = byLower.get(e.relativePath.toLowerCase());
      if (hit) sizes!.set(e.relativePath, hit.size);
      return hit !== undefined;
    });
    for (const d of disk) overlayNames.add(d.path.toLowerCase());
  }
  let records = insights.rescueManifest.recordsFromPlan(entries, sizes);
  if (overlayNames !== undefined) {
    const present = overlayNames;
    records = records.map((r) => ({ ...r, overlays: (r.overlays ?? []).filter((o) => present.has(o.toLowerCase())) }));
  }
  const { manifest, notes } = insights.rescueManifest.buildRescueManifest(records, { now: input.now });

  const view: BuildView = { mode: "build", planned: plan.entries.length, fromFolder: folder !== undefined, counts: manifest.counts, notes, wantedFile: flags.out !== undefined };
  if (flags.out !== undefined && manifest.counts.items > 0) {
    await saveInsightFile(flags.out, insights.rescueManifest.serializeRescueManifest(manifest), { option: "--out", extension: ".json", force: flags.force === true });
    view.savedTo = flags.out;
  }
  const needsAttention = plan.entries.length > 0 && manifest.counts.items === 0;
  return { view, code: needsAttention ? 2 : 0 };
}

async function runVerify(flags: Flags, folder: string): Promise<{ view: VerifyView; code: number }> {
  const text = await readManifestText(flags.verify ?? "");
  const parsed = insights.rescueManifest.parseRescueManifest(text);
  if (!parsed.ok) {
    const why =
      parsed.code === "version-unsupported"
        ? "That manifest comes from a different version of Snappy, so it cannot be checked."
        : "That file is not a Snappy rescue manifest. Choose the file saved with --out.";
    throw new CliError("bad-manifest", why);
  }
  const disk = await listFolder(folder, flags.folder ?? "");
  const own = insideFolder(folder, flags.verify ?? "");
  const seconds = intOption("--tolerance", flags.tolerance, 0, 86_400) ?? DEFAULT_TOLERANCE_S;
  const result = insights.rescueManifest.verifyRescue(parsed.manifest, disk, {
    timeToleranceMs: seconds * 1000,
    listLimit: flags.list === true ? LIST_LIMIT : 0,
    ignore: own === undefined ? [] : [own],
  });
  const view: VerifyView = { mode: "verify", createdAt: parsed.manifest.createdAt, manifestCounts: parsed.manifest.counts, manifestNotes: parsed.notes, result, list: flags.list === true };
  return { view, code: result.ok ? 0 : 2 };
}

/** JSON for --json: counts and codes. File names appear only when --list was given. */
function jsonView(view: RescueView, generatedAt: string): unknown {
  if (view.mode === "build") {
    return { generatedAt, mode: "build", planned: view.planned, fromFolder: view.fromFolder, saved: view.savedTo !== undefined, counts: view.counts, notes: view.notes };
  }
  const r = view.result;
  const { missing, extra, sizeMismatch, timeMismatch, truncated, ...rest } = r;
  return {
    generatedAt,
    mode: "verify",
    manifestCreatedAt: view.createdAt === null ? null : new Date(view.createdAt).toISOString(),
    manifestCounts: view.manifestCounts,
    manifestNotes: view.manifestNotes,
    ...rest,
    ...(view.list && { missing, extra, sizeMismatch, timeMismatch, truncated }),
  };
}

export async function runRescue(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseInsightArgs<Flags>("rescue", args, {
    folder: { type: "string" },
    out: { type: "string" },
    force: { type: "boolean" },
    layout: { type: "string" },
    verify: { type: "string" },
    list: { type: "boolean" },
    tolerance: { type: "string" },
  });
  if (flags.help) {
    io.out.write(RESCUE_USAGE);
    return 0;
  }
  const term = insightTerm(flags, io);

  // Every option is checked before anything is read.
  const verifying = flags.verify !== undefined;
  const layout = flags.layout ?? "year-month";
  if (layout !== "flat" && layout !== "year" && layout !== "year-month") {
    throw new CliError("usage", "--layout must be flat, year, or year-month.");
  }
  if (verifying) {
    if (flags.folder === undefined) throw new CliError("usage", "--verify needs --folder, the rescue folder to check.");
    if (positionals.length > 0) throw new CliError("usage", "--verify reads no export. Remove the ZIP files, or remove --verify.");
    if (flags.out !== undefined || flags.force === true || flags.layout !== undefined) {
      throw new CliError("usage", "--out, --force and --layout belong to the manifest, not to --verify. Use them in a separate run.");
    }
  } else {
    if (flags.list === true || flags.tolerance !== undefined) throw new CliError("usage", "--list and --tolerance work only with --verify.");
    if (flags.force === true && flags.out === undefined) throw new CliError("usage", "--force replaces the file named by --out. Add --out <file>.json.");
  }
  intOption("--tolerance", flags.tolerance, 0, 86_400);
  if (flags.out !== undefined) {
    if (flags.out.trim() === "") throw new CliError("usage", "--out needs a file name, for example --out manifest.json.");
    await checkOutputPath(flags.out, { option: "--out", extension: ".json", force: flags.force === true });
  }
  const folder = flags.folder === undefined ? undefined : await requireFolder(flags.folder, "--folder");

  const { view, code } = verifying ? await runVerify(flags, folder!) : await runBuild(flags, positionals, io, folder);
  io.out.write(flags.json ? jsonText(jsonView(view, new Date(io.now()).toISOString())) : renderRescueManifest(view, term, flags.verbose === true));
  return code;
}

export const rescueCommand: InsightCommand = {
  name: "rescue",
  synopsis: "rescue <ZIP files...>",
  summary: "List a Memories rescue and check its folder.",
  group: "Memories",
  usage: RESCUE_USAGE,
  run: runRescue,
};
