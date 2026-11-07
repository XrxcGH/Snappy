/**
 * Lookalike usernames: the pure step. It hands the friends, request and blocked lists of the export the dashboard
 * already holds to core's findLookalikeUsernames and returns the result as it is: counts and codes, plus the
 * usernames of each pair, which only a result list on the page may show. Snappy only compares; nothing is looked up.
 */
import { insights } from "@snappy-export/core";
import type { ToolData } from "../data.ts";

export type LookalikeContext = insights.lookalikeUsernames.LookalikeContext;
export type LookalikeLevel = insights.lookalikeUsernames.LookalikeLevel;
export type LookalikeListId = insights.lookalikeUsernames.LookalikeListId;
export type LookalikeNote = insights.lookalikeUsernames.LookalikeNote;
export type LookalikePair = insights.lookalikeUsernames.LookalikePair;
export type LookalikeReason = insights.lookalikeUsernames.LookalikeReason;
export type LookalikeUsernames = insights.lookalikeUsernames.LookalikeUsernames;
export type Lookalikes = LookalikeUsernames;

export function computeLookalikes(data: ToolData): Lookalikes {
  const { parsed } = data;
  if (parsed === null) throw new Error("needs an export");
  return insights.lookalikeUsernames.findLookalikeUsernames(parsed.friends, { now: data.now });
}
