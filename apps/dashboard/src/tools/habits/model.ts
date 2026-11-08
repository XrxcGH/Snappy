/**
 * Habits: the pure step. It hands core's habits module the chats and Snaps, of which core reads only the direction and
 * the time (never a conversation, kind or username), then shapes its result for the page: plain numbers, keys and counts.
 *
 * Peaks follow the same honesty rules as the command: a quietest hour or day is named only when it is the one
 * lowest value, and a quietest month only when it is neither the first nor the last (those may be partial).
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type HabitsResult = insights.habits.HabitsResult;

export interface HabitsParams {
  /** Minutes east of UTC. 0 is UTC. */
  utcOffsetMinutes: number;
}

export const DEFAULT_PARAMS: HabitsParams = { utcOffsetMinutes: 0 };

/** The time zones the page offers. They come from the shared list; the reply speed tool still reads them from here. */
export { OFFSETS } from "../timezone.ts";

/** How many recent months the page lists. */
export const MONTHS_SHOWN = 12;

export interface Peak {
  /** Hour 0..23, weekday 0..6 (0 is Sunday) or "YYYY-MM". */
  busiest: number | string;
  /** Other times share the busiest count. */
  tied: boolean;
  /** 0..1 */
  share: number;
  /** Null when the quietest is not clear enough to name. */
  quietest: number | string | null;
}

export interface HabitsView {
  result: HabitsResult;
  hour: Peak | null;
  weekday: Peak | null;
  month: Peak | null;
  /** The latest months, oldest first. */
  months: HabitsResult["byMonth"];
  /** More months exist than are listed. */
  monthsTotal: number;
}

type Rank<K> = insights.habits.Peak<K> | null;

function peakOf<K extends number | string>(busiest: Rank<K>, quietest: Rank<K>, allowQuiet: (key: K) => boolean): Peak | null {
  if (busiest === null) return null;
  const quiet = quietest !== null && quietest.ties === 0 && allowQuiet(quietest.key) ? quietest.key : null;
  return { busiest: busiest.key, tied: busiest.ties > 0, share: busiest.share, quietest: quiet };
}

export function computeHabits(data: ToolData, params: HabitsParams = DEFAULT_PARAMS): HabitsView {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  // The chats go in as they are, not copied into new objects first (a large export holds over a million): core reads only
  // each event's direction and time, and the result holds counts, never a conversation.
  const result = insights.habits.computeHabits(parsed.chats, { now: data.now, utcOffsetMinutes: params.utcOffsetMinutes });
  const keys = result.byMonth.map((m) => m.month);
  const interior = (m: string): boolean => m !== keys[0] && m !== keys[keys.length - 1];
  return {
    result,
    hour: peakOf(result.busiest.hour, result.quietest.hour, () => true),
    weekday: peakOf(result.busiest.weekday, result.quietest.weekday, () => true),
    month: peakOf(result.busiest.month, result.quietest.month, interior),
    months: result.byMonth.slice(-MONTHS_SHOWN),
    monthsTotal: result.byMonth.length,
  };
}
