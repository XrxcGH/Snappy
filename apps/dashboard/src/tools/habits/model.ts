/**
 * Habits: the pure step. It hands core's habits module only the direction and the time of each chat and Snap
 * (no conversation, no kind, no username), then shapes its result for the page: plain numbers, keys and counts.
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

/** The time zones the page offers, in minutes east of UTC: every whole hour, plus the half and quarter hours in common use. */
export const OFFSETS: readonly number[] = [
  -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 840,
];

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
  const events = parsed.chats.map((c) => ({ direction: c.direction, at: c.at }));
  const result = insights.habits.computeHabits(events, { now: data.now, utcOffsetMinutes: params.utcOffsetMinutes });
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
