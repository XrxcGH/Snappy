/**
 * Waiting on a reply: the pure step. It hands the chats and the friends list the dashboard already holds to
 * core's waitingOnReply and returns its report with the limits it used. Usernames are in the report's lists
 * only, for the result lists; the counts, dates and codes beside them hold no name.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type WaitingReport = insights.waitingOnReply.WaitingReport;

export interface WaitingResult {
  report: WaitingReport;
  /** The limits core used, so the page can say them. */
  limits: { youDays: number; themDays: number; maxDays: number; windowDays: number; sharePercent: number };
}

export function computeWaitingOnReply(data: ToolData): WaitingResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const d = insights.waitingOnReply.WAITING_DEFAULTS;
  // Only current friends are listed. A missing friends list would leave everyone out, so it is not used as a filter.
  const friends = parsed.friends.friends.map((f) => f.username);
  const report = insights.waitingOnReply.findWaitingOnReply(parsed.chats, {
    now: data.now,
    ...(parsed.exportedAt !== undefined && { exportedAt: parsed.exportedAt }),
    ...(friends.length > 0 && { friends }),
  });
  return {
    report,
    limits: { youDays: d.waitingOnYouDays, themDays: d.waitingOnThemDays, maxDays: d.maxWaitDays, windowDays: d.windowDays, sharePercent: Math.round(d.dominantShare * 100) },
  };
}
