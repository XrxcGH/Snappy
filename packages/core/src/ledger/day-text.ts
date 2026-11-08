import { groupDigits } from "../util.ts";

/** "1 day" or "1,520 days": a count of whole days for the evidence sentences, with the singular right. */
export function daysText(days: number): string {
  return Math.floor(days) === 1 ? "1 day" : `${groupDigits(days)} days`;
}
