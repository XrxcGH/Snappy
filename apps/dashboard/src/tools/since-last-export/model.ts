/**
 * Since your last export: the pure step. It builds the snapshot of the export on the page, picks the export saved
 * just before it from the saved history the dashboard holds, and hands both, with the chats and Memories dates, to
 * core's sinceLastExport. The result is returned as it is: counts, dates and note codes, plus the people in the
 * deliberate result lists. The login history is not an input, and no message text, name or place is read.
 *
 * The page counts days in UTC, like every date it shows, so the days apart always agree with the dates beside them.
 */
import { insights, snapshotFromExport } from "@snappy-export/core";
import type { Snapshot } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type SinceLastExport = insights.sinceLastExport.SinceLastExport;
export type SinceNote = insights.sinceLastExport.SinceNote;
export type SincePerson = insights.sinceLastExport.SincePerson;

export interface SinceResult {
  result: SinceLastExport;
  /** Saving is on, so the exports compared are really saved. False means this session only, and nothing was compared. */
  savedHistory: boolean;
  /** The export has no date of its own, so the time of this session stands in for it. */
  dateGuessed: boolean;
  /** The export's own health notes include an error, so a short list may look like friends leaving. */
  exportHasErrors: boolean;
}

export type ChangeKind = "added" | "no-longer-listed" | "removed-by-you" | "blocked-by-you" | "request-accepted" | "request-pending" | "request-no-longer-listed";

/** The lists in the order they are shown and saved, with the kind of date each one carries. */
export const GROUPS: readonly { change: ChangeKind; date: "friends-since" | "removed-on" | "sent-on" }[] = [
  { change: "added", date: "friends-since" },
  { change: "no-longer-listed", date: "friends-since" },
  { change: "removed-by-you", date: "removed-on" },
  { change: "blocked-by-you", date: "friends-since" },
  { change: "request-accepted", date: "sent-on" },
  { change: "request-pending", date: "sent-on" },
  { change: "request-no-longer-listed", date: "sent-on" },
];

/** The people of each list, by change. Empty lists when nothing was compared. */
export function peopleByChange(r: SinceLastExport): Record<ChangeKind, SincePerson[]> {
  return {
    added: r.friends?.added ?? [],
    "no-longer-listed": r.friends?.disappeared ?? [],
    "removed-by-you": r.friends?.removedByYou ?? [],
    "blocked-by-you": r.friends?.blockedByYou ?? [],
    "request-accepted": r.requests?.accepted ?? [],
    "request-pending": r.requests?.stillPending ?? [],
    "request-no-longer-listed": r.requests?.vanished ?? [],
  };
}

/** What the person chose on the page: the saved export to compare with, or null for the latest one before this export. */
export interface SinceParams {
  previousId: string | null;
}
export const DEFAULT_PARAMS: SinceParams = { previousId: null };

/** The saved exports a person may pick from: every one except the snapshot of this very export, newest first. Empty when saving is off. */
export function pickableSnapshots(data: ToolData): Snapshot[] {
  const { parsed } = data;
  if (parsed === null || !data.savedHistory) return [];
  const current = snapshotFromExport(parsed, { takenAt: parsed.exportedAt ?? data.now });
  return data.ledger.snapshots.filter((s) => s.id !== current.id && Number.isFinite(s.takenAt)).sort((a, b) => b.takenAt - a.takenAt);
}

/** True when two exports were compared. */
export const isComparable = (r: SinceResult): boolean => r.result.comparable;

/**
 * The saved export to compare with: the newest one saved at or before this one, and never the snapshot of this very
 * export (same id). If every other saved export is newer, the nearest one is used and core notes that the order was swapped.
 */
export function choosePrevious(snapshots: readonly Snapshot[], current: Snapshot): Snapshot | undefined {
  let previous: Snapshot | undefined;
  let nearestNewer: Snapshot | undefined;
  for (const s of snapshots) {
    if (s.id === current.id || !Number.isFinite(s.takenAt)) continue;
    if (s.takenAt <= current.takenAt) {
      if (previous === undefined || s.takenAt >= previous.takenAt) previous = s;
    } else if (nearestNewer === undefined || s.takenAt < nearestNewer.takenAt) {
      nearestNewer = s;
    }
  }
  return previous ?? nearestNewer;
}

export function computeSinceLastExport(data: ToolData, params: SinceParams = DEFAULT_PARAMS): SinceResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const takenAt = parsed.exportedAt ?? data.now;
  const current = snapshotFromExport(parsed, { takenAt });
  // Only really saved exports count. With saving off the ledger holds this session's own imports, which are not history.
  // A chosen export that is no longer in the history (deleted since) is ignored, and the default one is used.
  const picked = params.previousId === null ? undefined : pickableSnapshots(data).find((s) => s.id === params.previousId);
  const previous = picked ?? (data.savedHistory ? choosePrevious(data.ledger.snapshots, current) : undefined);
  const result = insights.sinceLastExport.sinceLastExport({
    ...(previous !== undefined && { previous }),
    current,
    events: parsed.chats,
    memories: parsed.memories,
    now: data.now,
  });
  return { result, savedHistory: data.savedHistory, dateGuessed: parsed.exportedAt === undefined, exportHasErrors: data.issues.some((i) => i.severity === "error") };
}

/** YYYY-MM-DD in UTC, or an empty cell when the date is unknown. */
const isoDay = (ms: number | null): string => (ms === null ? "" : new Date(ms).toISOString().slice(0, 10));

/** One row per person: the name, the change code and the date. Every list, in the order the page shows them. */
export function csvRows(r: SinceLastExport): string[][] {
  const by = peopleByChange(r);
  return GROUPS.flatMap((g) => by[g.change].map((p) => [p.username, g.change, isoDay(p.at)]));
}

/** The file name: the day of the newer export in UTC, so the same comparison always gets the same name. No username. */
export function csvFileName(r: SinceLastExport): string {
  const day = isoDay(r.currentAt);
  return day === "" ? "snappy-since-last-export.csv" : `snappy-since-last-export-${day}.csv`;
}
