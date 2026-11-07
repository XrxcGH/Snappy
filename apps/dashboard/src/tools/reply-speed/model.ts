/**
 * Reply speed: the pure step. It hands the chats and the friends list the dashboard already holds to core's
 * replySpeed module, which reads only each event's conversation, direction and time, and returns its report.
 * Usernames are in the report's friend rows and rankings only, for the result tables; the counts, times and codes
 * beside them hold no name. The CSV is built here (pure) and handed to the page's download helper when the button is pressed.
 */
import { insights } from "@snappy-export/core";
import { toCsv } from "../../csv.ts";
import type { ToolData } from "../data.ts";
import { OFFSETS } from "../habits/model.ts";
import { copy } from "./copy.ts";

export type ReplySpeedReport = insights.replySpeed.ReplySpeedReport;

export interface ReplySpeedParams {
  /** Minutes east of UTC for the hour of day. 0 is UTC. */
  utcOffsetMinutes: number;
}

export const DEFAULT_PARAMS: ReplySpeedParams = { utcOffsetMinutes: 0 };

/** The time zones the page offers: the same list as the Habits tool, so both pages speak of one set of zones. */
export { OFFSETS };

/** How many friend rows the page lists. The CSV holds every one. */
export const FRIENDS_SHOWN = 25;

export interface ReplySpeedResult {
  report: ReplySpeedReport;
  /** The hours of the day that have at least one reply. */
  hours: ReplySpeedReport["byHour"];
  /** The first friend rows, most replies first. */
  shown: ReplySpeedReport["friends"];
}

export function computeReplySpeed(data: ToolData, params: ReplySpeedParams = DEFAULT_PARAMS): ReplySpeedResult {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  // Only current friends are listed. A missing friends list would leave everyone out, so it is not used as a filter.
  // The chats go in as they are, not copied first: core reads only each event's conversation, direction and time.
  const friends = parsed.friends.friends.map((f) => f.username);
  const report = insights.replySpeed.findReplySpeed(parsed.chats, {
    now: data.now,
    ...(friends.length > 0 && { friends }),
    utcOffsetMinutes: params.utcOffsetMinutes,
  });
  return {
    report,
    hours: report.byHour.filter((b) => b.youReplies + b.themReplies > 0),
    shown: report.friends.slice(0, FRIENDS_SHOWN),
  };
}

const seconds = (ms: number | undefined): string => (ms === undefined ? "" : String(Math.round(ms / 1000)));

/** Every friend row as CSV text: times in whole seconds, empty when a side has too few replies. */
export function friendsCsvText(report: ReplySpeedReport): string {
  return toCsv(
    copy.csvHeaders,
    report.friends.map((f) => [
      f.username,
      String(f.youReplies),
      seconds(f.you?.medianMs),
      seconds(f.you?.p90Ms),
      String(f.themReplies),
      seconds(f.them?.medianMs),
      seconds(f.them?.p90Ms),
    ]),
  );
}

/** The file name: the day of the report in UTC, so the same data always gets the same name. No username. */
export function csvFileName(asOf: number | null): string {
  const day = asOf === null || !Number.isFinite(asOf) ? "" : new Date(asOf).toISOString().slice(0, 10);
  return day === "" ? "snappy-reply-speed.csv" : `snappy-reply-speed-${day}.csv`;
}
