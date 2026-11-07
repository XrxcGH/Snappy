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
