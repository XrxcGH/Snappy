/**
 * Friends backup: the pure step. It hands the three lists the dashboard already holds to core's friendsBackup and
 * returns the backup with its counts and note codes. The backup holds usernames (that is its purpose), so the page
 * never prints it: it is kept only so the download button can write the exact core text on a press.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type Backup = insights.friendsBackup.FriendsBackup;
export type BackupNote = insights.friendsBackup.BackupNote;
export type BackupListName = insights.friendsBackup.BackupListName;

export const LIST_NAMES: readonly BackupListName[] = ["friends", "blocked", "ignored"];

export interface FriendsBackupResult {
  backup: Backup;
  notes: BackupNote[];
  /** People in each list, and how many of them have a known date. Counts only. */
  counts: Record<BackupListName, { people: number; dated: number }>;
  total: number;
}

export function computeFriendsBackup(data: ToolData): FriendsBackupResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const { friends, blocked, ignored } = parsed.friends;
  const { backup, notes } = insights.friendsBackup.createFriendsBackup({ friends, blocked, ignored }, data.now);
  const count = (list: BackupListName) => ({ people: backup[list].length, dated: backup[list].filter((e) => e.createdAt !== undefined).length });
  const counts = { friends: count("friends"), blocked: count("blocked"), ignored: count("ignored") };
  return { backup, notes, counts, total: counts.friends.people + counts.blocked.people + counts.ignored.people };
}

/** The file name: the backup's day in UTC, so the same backup always gets the same name. No username. */
export function backupFileName(takenAt: number | null): string {
  const day = takenAt === null ? "" : new Date(takenAt).toISOString().slice(0, 10);
  return day === "" ? "snappy-friends-backup.json" : `snappy-friends-backup-${day}.json`;
}

// ------------------------------------------------------------------ compare ---

export type ComparisonNote = insights.friendsBackup.ComparisonNote;

/** What the comparison of one list comes to. Counts only, never a name. */
export type ListCounts = insights.friendsBackup.ListComparison["counts"];

export type CompareOutcome =
  | { ok: false; error: insights.friendsBackup.BackupParseError }
  | {
      ok: true;
      /** When the backup was made, or null when it holds no date. */
      takenAt: number | null;
      /** Every list that was compared matches the backup exactly. */
      identical: boolean;
      /** Counts per list, or null for a list the export does not hold, which is then not compared (it would make every backed-up name look gone). */
      lists: Record<BackupListName, ListCounts | null>;
      notes: ComparisonNote[];
    };

/** The largest file the page reads: the backup's own limit in characters, four bytes each at most. A bigger file is not a backup. */
export const MAX_BACKUP_BYTES = insights.friendsBackup.MAX_BACKUP_CHARS * 4;

/**
 * Compare a saved backup file's text with the lists the page holds, with core's own compare. Pure and read-only: nothing is saved or
 * sent, and the result holds counts and note codes only, so it names no one. A list the export lacks is left out, as the command does.
 */
export function compareBackupText(text: string, data: ToolData): CompareOutcome {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const read = insights.friendsBackup.parseFriendsBackup(text, { now: data.now });
  if (!read.ok) return { ok: false, error: read.error };
  const { friends, blocked, ignored } = parsed.friends;
  const current: insights.friendsBackup.BackupSource = { friends, ...(blocked.length > 0 && { blocked }), ...(ignored.length > 0 && { ignored }) };
  const cmp = insights.friendsBackup.compareFriendsBackup(read.backup, current);
  return {
    ok: true,
    takenAt: read.backup.takenAt,
    identical: cmp.identical,
    lists: { friends: cmp.friends.counts, blocked: cmp.blocked?.counts ?? null, ignored: cmp.ignored?.counts ?? null },
    notes: cmp.notes,
  };
}
