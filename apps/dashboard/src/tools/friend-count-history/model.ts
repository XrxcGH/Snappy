/**
 * Friend count history: the pure step. It hands the friends list, the removed friends and the saved
 * snapshots the dashboard already holds to core's friendCountHistory and returns its result as it is:
 * months, counts and codes, never a username. The login history is not an input.
 */
import { emptyLedger, insights, snapshotFromExport } from "@snappy-export/core";
import type { Ledger } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type FriendCountHistory = insights.friendCountHistory.FriendCountHistory;

export interface FriendCountResult {
  history: FriendCountHistory;
  /** The export's own health notes include an error, so the curve may be off. */
  exportHasErrors: boolean;
  /** Saving is on, so the snapshots compared are really saved. False means this session only, and nothing was compared. */
  savedHistory: boolean;
}

/** True when there is a curve to draw: at least one friend has a usable date. */
export const hasCurve = (r: FriendCountResult): boolean => r.history.totals.currentCount !== null;

/**
 * The snapshots worth comparing the curve with: only ones that are really saved, and never the snapshot of the export being
 * shown (it is made from the same lists, so it would agree with itself). Snapshot ids come from their content, so the shown
 * export's own snapshot is the one with the id it would get now.
 */
function savedBefore(data: ToolData, parsed: NonNullable<ToolData["parsed"]>): Ledger {
  if (!data.savedHistory) return emptyLedger();
  const own = snapshotFromExport(parsed, { takenAt: parsed.exportedAt ?? data.now }).id;
  return { ...data.ledger, snapshots: data.ledger.snapshots.filter((s) => s.id !== own) };
}

export function computeFriendCountHistory(data: ToolData): FriendCountResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const history = insights.friendCountHistory.buildFriendCountHistory({
    friends: parsed.friends.friends,
    deletedFriends: parsed.friends.deletedFriends,
    ledger: savedBefore(data, parsed),
    now: data.now,
  });
  return { history, exportHasErrors: data.issues.some((i) => i.severity === "error"), savedHistory: data.savedHistory };
}
