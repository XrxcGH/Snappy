/**
 * Friendship anniversaries: the pure step. It hands the current friends list to core's anniversaries insight and
 * returns what the page shows: the rows (usernames only here, for the result table), counts and note codes.
 *
 * Current friends only: the other lists in an export hold request dates, which would give wrong anniversaries.
 * Days are read in UTC, as the command does, so the page and the command agree. Time is data.now, never a clock.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type AnniversaryRow = insights.anniversaries.AnniversaryRow;
export type AnniversaryNote = insights.anniversaries.AnniversaryNote;

export interface AnniversaryParams {
  /** How far ahead to look, in days. */
  windowDays: number;
  /** Show only the milestone years (1, 2, 3, 5 and 10). */
  milestonesOnly: boolean;
}

export const DEFAULT_PARAMS: AnniversaryParams = { windowDays: 30, milestonesOnly: false };

export interface AnniversariesResult {
  windowDays: number;
  milestonesOnly: boolean;
  /** The rows to show, soonest first: every anniversary in the window, or only the milestones. */
  rows: AnniversaryRow[];
  /** All anniversaries in the window, whatever is shown. */
  upcoming: number;
  milestones: number;
  /** Friends with a usable date. */
  dated: number;
  /** A Feb 29 friendship is shown on Feb 28 in at least one row. */
  leapShifted: boolean;
  notes: AnniversaryNote[];
}

export function computeAnniversaries(data: ToolData, params: AnniversaryParams = DEFAULT_PARAMS): AnniversariesResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  const found = insights.anniversaries.findAnniversaries(parsed.friends.friends, { now: data.now, windowDays: params.windowDays });
  const rows = params.milestonesOnly ? found.milestones : found.upcoming;
  return {
    windowDays: found.windowDays,
    milestonesOnly: params.milestonesOnly,
    rows,
    upcoming: found.counts.upcoming,
    milestones: found.counts.milestones,
    dated: found.counts.dated,
    leapShifted: rows.some((r) => r.leapDayShifted),
    notes: found.notes,
  };
}
