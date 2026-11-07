/**
 * Closest and fading friends: the pure step. It hands the export the dashboard already holds to core's
 * closestFading and returns its result as it is. The result names friends (the two result tables are about
 * people) and holds counts, dates and codes; no note, announcement or title is made from a name.
 *
 * The one input is the length of the recent window. Core measures back from the earlier of "now" and the
 * export's own date, so a clock is never read here.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type ClosestFadingResult = insights.closestFading.ClosestFadingResult;

export interface ClosestFadingParams {
  /** Days in the recent window, and in the earlier window before it. */
  windowDays: number;
}

/** The windows the page offers, shortest first. */
export const WINDOW_CHOICES: readonly number[] = [30, 60, 90, 180];

export const DEFAULT_PARAMS: ClosestFadingParams = { windowDays: 90 };

export function computeClosestFading(data: ToolData, params: ClosestFadingParams = DEFAULT_PARAMS): ClosestFadingResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  return insights.closestFading.findClosestAndFading(parsed, { now: data.now, windowDays: params.windowDays });
}
