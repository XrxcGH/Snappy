/**
 * The shared wording and format rules, held for the eleven tool pages of this group (activity calendar, anniversaries,
 * blocked review, closest and fading, export check, friend count history, friends backup, friends table, habits,
 * lookalike usernames and memories gaps). One assertion per rule, so a later edit cannot bring an old wording back.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { copy as activityCalendar } from "../../src/tools/activity-calendar/copy.ts";
import { copy as anniversaries } from "../../src/tools/anniversaries/copy.ts";
import { copy as blockedReview } from "../../src/tools/blocked-review/copy.ts";
import { copy as closestFading } from "../../src/tools/closest-fading/copy.ts";
import { copy as exportCheck } from "../../src/tools/export-check/copy.ts";
import { copy as friendCountHistory } from "../../src/tools/friend-count-history/copy.ts";
import { copy as friendsBackup } from "../../src/tools/friends-backup/copy.ts";
import { copy as friendsTable } from "../../src/tools/friends-table/copy.ts";
import { copy as habits } from "../../src/tools/habits/copy.ts";
import { copy as lookalikeUsernames } from "../../src/tools/lookalike-usernames/copy.ts";
import { copy as memoriesGaps } from "../../src/tools/memories-gaps/copy.ts";

export const COPIES: Record<string, Record<string, unknown>> = {
  "activity-calendar": activityCalendar,
  anniversaries,
  "blocked-review": blockedReview,
  "closest-fading": closestFading,
  "export-check": exportCheck,
  "friend-count-history": friendCountHistory,
  "friends-backup": friendsBackup,
  "friends-table": friendsTable,
  habits,
  "lookalike-usernames": lookalikeUsernames,
  "memories-gaps": memoriesGaps,
};

/** Argument sets for the copy functions: small counts, then counts past a thousand (where a missing separator shows). */
const SMALL: unknown[][] = [[1], [2], [0], [1, 2], [3, 12], [1, 2, 3], ["alice"], ["Nov 6, 2026"], [3, true], [0, 3, 0.5], [2, 3]];
const BIG: unknown[][] = [[12345], [12345, 12345], [12345, 12345, 12345], [12345, 3], [3, 12345], [12345, true], [true, 12345], ["12,345", 12345], [12345, "12,345"]];

/** Every string a tool's copy can say, with the key path, calling each function with the given argument sets. */
export function stringsOf(source: unknown, args: readonly unknown[][], at = ""): [string, string][] {
  const out: [string, string][] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") out.push([path, value]);
    else if (typeof value === "function") {
      for (const a of args) {
        try {
          walk((value as (...x: unknown[]) => unknown)(...a), `${path}(${a.map((x) => JSON.stringify(x)).join(", ")})`);
        } catch {
          // A function that rejects these arguments says nothing for them.
        }
      }
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, path === "" ? k : `${path}.${k}`);
  };
  walk(source, at);
  return out;
}

/** Every string of the eleven tools, as "tool: path: text". */
export const everyString = (args: readonly unknown[][] = SMALL): string[] =>
  Object.entries(COPIES).flatMap(([id, c]) => stringsOf(c, args).map(([path, text]) => `${id}: ${path}: ${text}`));

export const bigStrings = (): string[] => everyString(BIG);

describe("where a person checks", () => {
  it("says Snapchat, never the app, which inside Snappy means Snappy", () => {
    expect(everyString().filter((s) => /\bin the app\b|\bthe app\b/i.test(s))).toEqual([]);
  });
});
