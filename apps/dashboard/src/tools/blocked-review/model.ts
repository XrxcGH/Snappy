/**
 * Blocked and ignored review: the pure step. It hands the friends lists of the export the dashboard already holds
 * to core's reviewBlocked and returns the review as it is: counts, dates and codes, plus the usernames of the
 * people in the lists, which only a result list on the page may show. Snappy only looks; nothing is changed.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type BlockedReview = insights.blockedReview.BlockedReview;
export type ReviewList = insights.blockedReview.ReviewList;
export type ReviewEntry = insights.blockedReview.ReviewEntry;
export type ReviewConflict = insights.blockedReview.ReviewConflict;

export function computeBlockedReview(data: ToolData): BlockedReview {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  return insights.blockedReview.reviewBlocked(parsed.friends, { now: data.now });
}
