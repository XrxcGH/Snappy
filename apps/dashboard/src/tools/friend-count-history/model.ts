/**
 * Friend count over time: the pure step. It hands the friends list, the removed friends and the saved
 * snapshots the dashboard already holds to core's friendCountHistory and returns its result as it is:
 * months, counts and codes, never a username. The login history is not an input.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type FriendCountHistory = insights.friendCountHistory.FriendCountHistory;

export interface FriendCountResult {
  history: FriendCountHistory;
  /** The export's own health notes include an error, so the curve may be off. */
  exportHasErrors: boolean;
}

/** True when there is a curve to draw: at least one friend has a usable date. */
export const hasCurve = (r: FriendCountResult): boolean => r.history.totals.currentCount !== null;

export function computeFriendCountHistory(data: ToolData): FriendCountResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const history = insights.friendCountHistory.buildFriendCountHistory({
    friends: parsed.friends.friends,
    deletedFriends: parsed.friends.deletedFriends,
    ledger: data.ledger,
    now: data.now,
  });
  return { history, exportHasErrors: data.issues.some((i) => i.severity === "error") };
}
