/**
 * Who reaches out first: the pure step. It hands the chats and the friends list the dashboard already holds to
 * core's reach-out module, which reads only each event's conversation, direction and time, and returns its report.
 * Usernames are in the report's two lists only, for the result tables; the counts, shares and codes hold no name.
 * A gap between messages is a plain length of time, so there is no time zone parameter.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type ReachOutReport = insights.reachOutFirst.ReachOutReport;
export type ReachOutPerson = insights.reachOutFirst.ReachOutPerson;
export type ReachOutNote = insights.reachOutFirst.ReachOutNote;

export interface ReachOutParams {
  /** Hours of silence that start a new exchange. */
  gapHours: number;
}

export const DEFAULT_PARAMS: ReachOutParams = { gapHours: insights.reachOutFirst.REACH_OUT_DEFAULTS.gapHours };

/** The gaps the page offers, in hours. The default is one of them. */
export const GAP_CHOICES: readonly number[] = [3, 6, 12, 24];

export function computeReachOutFirst(data: ToolData, params: ReachOutParams = DEFAULT_PARAMS): ReachOutReport {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  // Only current friends are listed. A missing friends list would leave everyone out, so it is not used as a filter.
  const friends = parsed.friends.friends.map((f) => f.username);
  return insights.reachOutFirst.findWhoReachesOutFirst(parsed.chats, {
    now: data.now,
    ...(parsed.exportedAt !== undefined && { exportedAt: parsed.exportedAt }),
    ...(friends.length > 0 && { friends }),
    gapHours: params.gapHours,
  });
}
