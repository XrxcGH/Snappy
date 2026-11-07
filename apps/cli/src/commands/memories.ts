/**
 * snappy-export memories: plan the Memories rescue, show the storage meter, and (unless --dry-run)
 * write the files that are bundled in the export, each with its exact capture time restored.
 * With --download it also downloads the rest from the links older exports carry, the one place
 * Snappy uses the network.
 *
 * Content-blind: media is opaque bytes. Output names items by number, never by link, title or
 * file name, and the report holds counts and statuses only.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ZipEntryError, listZipEntries, planMemories, readZipEntry } from "@snappy-export/core";
import type { MemoriesPlan, PlannedMemory, RandomAccessReader, ZipEntryInfo } from "@snappy-export/core";
import { intOption, parseFlags } from "../args.ts";
import { CliError, fsError } from "../errors.ts";
import { formatBytes, formatCount, formatDate, formatPercent, plural } from "../format.ts";
import type { Io } from "../io.ts";
import { parseParts, requireFirstPart, resolveZipPaths, withReaders } from "../inputs.ts";
import { atomicWrite } from "../ledger-store.ts";
import { DOWNLOAD_NOTICE, DownloadError, downloadToFile } from "../memories-download.ts";
import { fixFileTime, overlayTarget, pathExists, placeMedia, placeOverlay, targetInside } from "../memories-write.ts";
import { PRIVACY_RESULTS, describePairing, renderIssues, wrapText } from "../render.ts";
import type { LabeledIssue } from "../render.ts";
import { createTerm } from "../term.ts";
import type { Term } from "../term.ts";

export const MEMORIES_USAGE = `Usage: snappy-export memories <zips or folder...> --out <folder> [options]

Plans your Memories rescue and shows the storage meter. Memories bundled in your export are
copied to the folder with their exact capture time restored, as the date inside the file and as
the file's own date. Snappy never looks at the photos or videos themselves, and never reads or
writes locations.

Give it every part of your export in one command (a folder or a wildcard such as "mydata*.zip"
works too): the Memories are spread over the parts, and the list that names their dates is in
the first one.

Options
  --out <folder>        Where to save the files. Files already there are skipped, so you can run it again.
  --dry-run             Show the plan and write nothing.
  --layout <layout>     flat, year or year-month. Default: year-month.
  --download            Older exports only: also download Memories that are only available as links.
                        This is the only command that uses the network, and it contacts only the
                        links in your export. Newer exports have no links and need no download.
  --concurrency <n>     Downloads at once, 1 to 8. Default: 3.
  --cap-gb <n>          Storage cap for the meter, in GB. Default: 5.
  --no-color            Plain text.

A report with counts and statuses (no names, dates or places) is saved as memories-report.json.

Exit codes: 0 done, 1 could not run, 3 finished but some items failed.
`;

interface Flags {
  out?: string;
  "dry-run"?: boolean;
  layout?: string;
  download?: boolean;
  concurrency?: string;
  "cap-gb"?: string;
  "no-color"?: boolean;
  help?: boolean;
}

/** Largest bundled file Snappy will read into memory in one piece. */
const MAX_BUNDLED_BYTES = 512 * 1024 * 1024;

const NO_LINKS =
  "This export has no download links, so --download has nothing to download and Snappy did not use the network. Snappy saves the Memories it finds inside your zip files.";

/** Items shown by number in the terminal when they fail; the rest are in the report. */
const FAILURES_SHOWN = 20;

type Status = "extracted" | "downloaded" | "skipped-existing" | "repaired" | "failed" | "link-only" | "no-file";

/**
 * What a failure code means and what to do about it, in words that name no file, link or place.
 * Printed once per code (a full disk would otherwise repeat for every remaining item).
 */
function failureAdvice(code: string): string {
  if (/^http-(401|403|404|410)$/.test(code)) return "The link has expired. Request a new export from Snapchat and run again.";
  if (code.startsWith("http-")) return "Snapchat's server refused or was busy. Wait a while and run again; finished items are skipped.";
  switch (code) {
    case "too-large":
      return `A file in your zips is larger than the ${formatBytes(MAX_BUNDLED_BYTES)} Snappy reads at once, so it was not copied. Take that file out of the zip with another tool; the others were saved.`;
    case "missing-file":
      return "The list names a file that is not in the zips you gave. Add every part of your export and run again; finished items are skipped.";
    case "corrupt":
      return "A zip looks damaged: a file inside does not match its checksum. Download that part again and run again; finished items are skipped.";
    case "encrypted":
    case "unsupported-method":
      return "A file in your zips is encrypted or uses a compression Snappy does not support, so it was not copied.";
    case "disk-full":
    case "disk":
      return "The disk ran out of space. Free some space and run again; finished items are skipped.";
    case "network":
    case "timeout":
      return "The connection failed. Check it and run again; finished items are skipped.";
    case "bad-link":
    case "not-media":
      return "The link did not lead to a photo or video. Request a new export from Snapchat.";
    case "unsafe-path":
      return "Snappy could not build a safe place to save it, so nothing was written for it.";
    default:
      return "Snappy could not save it. Run again; if it repeats, the zip may be damaged.";
  }
}

interface Outcome {
  item: number;
  status: Status;
  /** Failure code: a fixed short word, never a link or a name. */
  reason?: string;
  /** How the capture time reached the file: "embedded" (inside the file), "file-time-only" or "none". */
  dateStatus?: string;
  /** Overlay files written for this item. */
  overlays?: number;
}

/**
 * Zip entries of the parts, looked up by part number and the name stored in the zip. A zip that
 * repeats a name (an archive that was appended to) has several entries under one key.
 */
type EntryIndex = Map<string, ZipEntryInfo[]>;

const entryKey = (part: number, name: string): string => `${part}\0${name}`;
const partOf = (e: PlannedMemory): number => e.item.partIndex ?? 1;
/** The zip part holding an item's n-th overlay: its own when the split fell between the main file and it, else the main file's. */
const overlayPartOf = (e: PlannedMemory, n: number): number => e.item.overlayParts?.[n] ?? partOf(e);

/**
 * Find the zip entries the plan needs, in the parts it names. Only the zips' directories are read,
 * and only the wanted entries are kept, so a heavy export does not cost memory for its other files.
 */
async function indexEntries(plan: MemoriesPlan, readers: RandomAccessReader[]): Promise<EntryIndex> {
  const wanted = new Set<string>();
  for (const e of plan.entries) {
    if (e.item.zipPath === undefined) continue;
    wanted.add(entryKey(partOf(e), e.item.zipPath));
    (e.item.overlayPaths ?? []).forEach((name, n) => wanted.add(entryKey(overlayPartOf(e, n), name)));
  }
  const index: EntryIndex = new Map();
  if (wanted.size === 0) return index;
  for (const [i, reader] of readers.entries()) {
    for (const info of (await listZipEntries(reader)).entries) {
      const key = entryKey(i + 1, info.name);
      if (!wanted.has(key)) continue;
      const same = index.get(key);
      if (same === undefined) index.set(key, [info]);
      else same.push(info);
    }
  }
  return index;
}

/** How many planned files are already in the output folder (a run can be resumed). */
async function countExisting(entries: PlannedMemory[], outDir: string): Promise<number> {
  let n = 0;
  for (const e of entries) {
    const target = targetInside(outDir, e.relativePath);
    if (target !== undefined && (await pathExists(target))) n++;
  }
  return n;
}

/** Run `work` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await work(items[index] as T, index);
    }
  });
  await Promise.all(workers);
}

function meterLines(plan: MemoriesPlan, term: Term): string[] {
  const m = plan.meter;
  const lines = [
    term.bold("Storage meter"),
    `  ${term.meter(m.fractionOfCap, 20)}  ${formatBytes(m.knownBytes)} of ${formatBytes(m.capBytes)} (${formatPercent(m.fractionOfCap)})`,
  ];
  if (m.unknownSizeCount > 0) {
    lines.push(`  ${plural(m.unknownSizeCount, "Memory", "Memories")} ${m.unknownSizeCount === 1 ? "has" : "have"} no known size, so the real total is higher.`);
    lines.push(`  The cap is your own storage goal (change it with --cap-gb); Snappy does not enforce it.`);
  }
  if (m.fractionOfCap >= 1) lines.push("  Your Memories are at or past the cap.");
  else if (m.projectedCapAt !== null) {
    lines.push(`  At your recent pace you would reach the cap around ${formatDate(m.projectedCapAt)}.`);
  }
  return lines;
}

export async function memoriesCommand(args: string[], io: Io): Promise<number> {
  const { values: flags, positionals } = parseFlags<Flags>("memories", args, {
    out: { type: "string" },
    "dry-run": { type: "boolean" },
    layout: { type: "string" },
    download: { type: "boolean" },
    concurrency: { type: "string" },
    "cap-gb": { type: "string" },
    "no-color": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  });
  if (flags.help) {
    io.out.write(MEMORIES_USAGE);
    return 0;
  }

  const dryRun = flags["dry-run"] === true;
  const layout = flags.layout ?? "year-month";
  if (layout !== "flat" && layout !== "year" && layout !== "year-month") {
    throw new CliError("usage", "--layout must be flat, year or year-month.");
  }
  const concurrency = intOption("--concurrency", flags.concurrency, 1, 8) ?? 3;
  let capBytes: number | undefined;
  if (flags["cap-gb"] !== undefined) {
    const gb = Number(flags["cap-gb"]);
    if (!Number.isFinite(gb) || gb <= 0 || gb > 100_000) throw new CliError("usage", "--cap-gb must be a number above 0, for example --cap-gb 5.");
    capBytes = gb * 1024 ** 3;
  }
  if (flags.out !== undefined && flags.out.trim() === "") {
    // An empty value (an unset shell variable, say) would otherwise mean the current folder.
    throw new CliError("usage", "--out needs a folder name, for example --out memories-backup.");
  }
  if (flags.out === undefined && !dryRun) {
    throw new CliError("usage", "Say where to save the files with --out <folder>, or add --dry-run to see the plan first.");
  }
  const outDir = flags.out === undefined ? undefined : resolve(flags.out);
  const term = createTerm({ env: io.env, isTTY: io.interactive, columns: io.columns, noColorFlag: flags["no-color"] });

  const paths = await resolveZipPaths(positionals);
  requireFirstPart(paths);
  return withReaders(paths, async (readers) => {
    const parsed = await parseParts(readers);
    const now = io.now();
    const plan = planMemories(parsed.memories, { layout, capBytes, now });
    const out: string[] = [];

    // The advice about Memories with no file is written in the user's words by core and shown once, below.
    const unmatchedAdvice = parsed.issues.find((i) => i.code === "memories-unmatched-items")?.message;
    const issues: LabeledIssue[] = parsed.issues
      .filter((i) => i.severity !== "info" && i.code !== "memories-unmatched-items")
      .map((i) => ({ ...i, source: "your export" }));
    if (issues.length > 0) out.push(...renderIssues(issues, term), "");

    // Which planned items have bytes in a zip, which only a link, which neither.
    const index = await indexEntries(plan, readers);
    const inZip = (e: PlannedMemory): boolean => e.item.zipPath !== undefined && index.has(entryKey(partOf(e), e.item.zipPath));
    const counts = {
      bundled: plan.entries.filter(inZip).length,
      links: plan.entries.filter((e) => !inZip(e) && e.item.downloadUrl !== undefined).length,
      neither: plan.entries.filter((e) => !inZip(e) && e.item.downloadUrl === undefined).length,
    };
    // An export without links (every 2026 export so far) has nothing to download: say so, and stay offline.
    const download = flags.download === true && counts.links > 0;

    const c = plan.counts;
    const width = term.columns - 4;
    out.push(term.bold("Memories rescue"));
    if (c.total === 0) {
      out.push("  No Memories found in this export. Request your export again with Memories selected, and choose JSON.");
    } else {
      out.push(`  ${plural(c.total, "Memory", "Memories")}: ${formatCount(c.images)} photos, ${formatCount(c.videos)} videos, ${formatCount(c.unknown)} of unknown type.`);
      out.push(`  ${formatCount(c.withDate)} have a capture date; ${formatCount(c.total - c.withDate)} do not, and will be saved undated.`);
      out.push(`  ${plural(plan.duplicates.length, "probable duplicate")} skipped, matched by metadata only.`);
      out.push(`  ${formatCount(counts.bundled)} are in your zips, ${formatCount(counts.links)} are only links${counts.neither > 0 && parsed.memoriesPairing === undefined ? `, ${formatCount(counts.neither)} have no file or link` : ""}.`);
      if (parsed.memoriesPairing !== undefined) for (const line of wrapText(describePairing(parsed.memoriesPairing), width)) out.push(`  ${line}`);
      if (unmatchedAdvice !== undefined) for (const line of wrapText(unmatchedAdvice, width)) out.push(`  ${line}`);
      if (flags.download === true && !parsed.memories.some((m) => m.downloadUrl !== undefined)) {
        for (const line of wrapText(NO_LINKS, width)) out.push(`  ${line}`);
      }
    }
    out.push("", ...meterLines(plan, term), "");

    if (dryRun || outDir === undefined) {
      const existing = outDir === undefined ? 0 : await countExisting(plan.entries, outDir);
      out.push(
        `Dry run: nothing was written. A real run would copy ${formatCount(counts.bundled)} files from your zips${download ? ` and download ${formatCount(counts.links)} more` : ""}.`,
      );
      if (existing > 0) out.push(`${plural(existing, "item")} already in the output folder would be skipped.`);
      if (flags.download !== true && counts.links > 0) out.push("Add --download to download the items that are only links.");
      out.push(outDir === undefined ? "To save the files, run the same command again with --out <folder> and without --dry-run." : "To save the files, run the same command again without --dry-run.");
      out.push(PRIVACY_RESULTS);
      io.out.write(out.join("\n") + "\n");
      return 0;
    }

    io.out.write(out.join("\n") + "\n");
    if (download) io.out.write(DOWNLOAD_NOTICE.join("\n") + "\n\n");
    try {
      await mkdir(outDir, { recursive: true });
    } catch (e) {
      throw fsError(e, "create the output folder", flags.out ?? outDir);
    }

    const outcomes: Outcome[] = new Array(plan.entries.length);
    let done = 0;
    // Shown before the first item finishes, so a long first file does not look like a hang; with no
    // terminal there is no bar, but the count and the place are said once.
    const total = plan.entries.length;
    const progress = (): void => {
      if (io.interactive) io.out.write(`\r\x1b[2K  ${term.meter(done / total, 20)} ${formatCount(done)} of ${plural(total, "Memory", "Memories")} done`);
    };
    if (io.interactive) progress();
    else io.out.write(`Saving ${plural(total, "Memory", "Memories")}...\n`);

    /** A zip entry with the reader of the part it is in; undefined when the part or the entry is not there. */
    const sourceOf = (part: number, name: string, dateMs: number | null): { reader: RandomAccessReader; info: ZipEntryInfo; name: string } | undefined => {
      const same = index.get(entryKey(part, name));
      const reader = readers[part - 1];
      if (same === undefined || reader === undefined) return undefined;
      // A repeated name: the entry whose stored time is the Memory's date is the one that was paired, not the first.
      const matched = dateMs === null ? undefined : same.find((e) => e.mtimeUtcMs !== undefined && Math.floor(e.mtimeUtcMs / 1000) === Math.floor(dateMs / 1000));
      return { reader, info: matched ?? (same[0] as ZipEntryInfo), name };
    };
    const overlaySources = (entry: PlannedMemory): (ReturnType<typeof sourceOf>)[] =>
      (entry.item.overlayPaths ?? []).map((name, n) => sourceOf(overlayPartOf(entry, n), name, entry.item.date));

    /** Write the overlays that are not on disk yet, each from the part that holds it. */
    const writeOverlays = async (entry: PlannedMemory, target: string, sources: NonNullable<ReturnType<typeof sourceOf>>[]): Promise<number> => {
      let written = 0;
      for (const [i, o] of sources.entries()) {
        const overlay = overlayTarget(target, i + 1, o.name);
        if (await pathExists(overlay)) continue;
        await placeOverlay(overlay, await readZipEntry(o.reader, o.info, { maxBytes: MAX_BUNDLED_BYTES }), entry.item.date);
        written++;
      }
      return written;
    };

    /** Take the main file and its overlays out of their zip and put them in place; the main file last, so it marks a finished item. */
    const extract = async (entry: PlannedMemory, target: string, base: { item: number }): Promise<Outcome> => {
      const main = sourceOf(partOf(entry), entry.item.zipPath as string, entry.item.date);
      const overlays = overlaySources(entry);
      // Overlays were looked up with the main file, but a zip may hold one and not the other.
      if (main === undefined || overlays.some((o) => o === undefined)) return { ...base, status: "failed", reason: "missing-file" };
      const written = await writeOverlays(entry, target, overlays as NonNullable<ReturnType<typeof sourceOf>>[]);
      const bytes = await readZipEntry(main.reader, main.info, { maxBytes: MAX_BUNDLED_BYTES });
      return { ...base, status: "extracted", dateStatus: await placeMedia(target, { bytes }, entry.item.date), overlays: written };
    };

    /**
     * The main file marks a finished item, but a file there may have been written by a run that
     * lacked an overlay (a part was not given) or stopped before the file time was set. Add what is
     * missing; an item that needs nothing is skipped.
     */
    const resume = async (entry: PlannedMemory, target: string, base: { item: number }): Promise<Outcome> => {
      const overlays = overlaySources(entry);
      const written = inZip(entry) && overlays.every((o) => o !== undefined) ? await writeOverlays(entry, target, overlays as NonNullable<ReturnType<typeof sourceOf>>[]) : 0;
      const retimed = await fixFileTime(target, entry.item.date);
      return written > 0 || retimed ? { ...base, status: "repaired", overlays: written } : { ...base, status: "skipped-existing" };
    };

    const handle = async (entry: PlannedMemory, n: number): Promise<Outcome> => {
      const base = { item: n };
      const target = targetInside(outDir, entry.relativePath);
      if (target === undefined) return { ...base, status: "failed", reason: "unsafe-path" };
      try {
        if (await pathExists(target)) return await resume(entry, target, base);
        if (inZip(entry)) return await extract(entry, target, base);
        if (entry.item.downloadUrl === undefined) {
          return entry.item.zipPath === undefined ? { ...base, status: "no-file" } : { ...base, status: "failed", reason: "missing-file" };
        }
        if (!download) return { ...base, status: "link-only" };
        const partPath = `${target}.part`;
        await mkdir(dirname(target), { recursive: true });
        await downloadToFile(entry.item.downloadUrl, partPath, { transport: io.transport, sleep: io.sleep });
        return { ...base, status: "downloaded", dateStatus: await placeMedia(target, { partPath }, entry.item.date) };
      } catch (e) {
        // Only fixed codes survive: error text can carry paths, names or links.
        const reason = e instanceof DownloadError || e instanceof ZipEntryError || e instanceof CliError ? e.code : "error";
        return { ...base, status: "failed", reason };
      }
    };

    await pool(plan.entries, download ? concurrency : 1, async (entry, i) => {
      outcomes[i] = await handle(entry, i + 1);
      done++;
      progress();
    });
    if (io.interactive) io.out.write("\r\x1b[2K");

    const tally = (s: Status): number => outcomes.filter((o) => o.status === s).length;
    const failures = outcomes.filter((o) => o.status === "failed");
    const result = {
      planned: plan.entries.length,
      paired: plan.entries.filter((e) => e.item.zipPath !== undefined).length,
      extracted: tally("extracted"),
      downloaded: tally("downloaded"),
      skippedExisting: tally("skipped-existing"),
      ...(tally("repaired") > 0 && { repaired: tally("repaired") }),
      failed: failures.length,
      linkOnly: tally("link-only"),
      unmatchedItems: tally("no-file"),
      overlaysWritten: outcomes.reduce((sum, o) => sum + (o.overlays ?? 0), 0),
    };
    // Counts and statuses only: no path, name, link, place or capture date can reach this file.
    const report = {
      layout,
      download,
      pairing: parsed.memoriesPairing ?? null,
      counts: { ...result, probableDuplicates: plan.duplicates.length },
      meter: {
        knownBytes: plan.meter.knownBytes,
        unknownSizeCount: plan.meter.unknownSizeCount,
        capBytes: plan.meter.capBytes,
        fractionOfCap: plan.meter.fractionOfCap,
      },
      failures: failures.map((o) => ({ item: o.item, reason: o.reason })),
      items: outcomes.map((o) => ({ item: o.item, status: o.status, ...(o.reason ? { reason: o.reason } : {}), ...(o.dateStatus ? { dateStatus: o.dateStatus } : {}) })),
    };
    const reportPath = join(outDir, "memories-report.json");
    await atomicWrite(reportPath, new TextEncoder().encode(JSON.stringify(report, null, 2) + "\n"), { sync: false });

    const lines: string[] = [term.bold("Result")];
    lines.push(
      `  ${formatCount(result.extracted)} saved from your zips${download ? `, ${formatCount(result.downloaded)} downloaded` : ""}, ${formatCount(result.skippedExisting)} already there, ${formatCount(result.failed)} failed.`,
    );
    if (tally("repaired") > 0) lines.push(`  ${plural(tally("repaired"), "item")} already there ${tally("repaired") === 1 ? "was" : "were"} completed (a missing overlay added or the file date set).`);
    if (result.overlaysWritten > 0) lines.push(`  ${plural(result.overlaysWritten, "overlay file")} saved next to ${result.overlaysWritten === 1 ? "its" : "their"} Memory, unchanged.`);
    if (result.linkOnly > 0) lines.push(`  ${plural(result.linkOnly, "item")} only available as links: run again with --download to download them.`);
    if (result.unmatchedItems > 0) {
      lines.push(`  ${plural(result.unmatchedItems, "Memory", "Memories")} had neither a file nor a link, so ${result.unmatchedItems === 1 ? "it was" : "they were"} not saved. ${result.unmatchedItems === 1 ? "It is" : "They are"} still in your Snapchat account; if part of your export is missing, add it and run again.`);
    }
    for (const f of failures.slice(0, FAILURES_SHOWN)) lines.push(`  item ${f.item} failed (${f.reason})`);
    if (failures.length > FAILURES_SHOWN) lines.push(`  ${plural(failures.length - FAILURES_SHOWN, "more failure")} are listed in the report.`);
    for (const code of [...new Set(failures.map((f) => f.reason ?? "error"))]) lines.push(`  ${code}: ${failureAdvice(code)}`);
    // With --download the links in the export were contacted, so the plain results line would overstate.
    lines.push(`  Report: ${reportPath}`, "", download ? "Only the links in your export, and the secure addresses they forwarded to, were contacted. Nothing else has left your device." : PRIVACY_RESULTS);
    io.out.write(lines.join("\n") + "\n");
    return failures.length > 0 ? 3 : 0;
  });
}
