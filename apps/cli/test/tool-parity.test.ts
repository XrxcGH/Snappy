/**
 * The command line and the dashboard's tool pages must agree on the numbers for one export. Each
 * insight command is run with --json, and the matching tool's model is run on the same parsed export,
 * both over the same synthetic export. The headline numbers of each pair are compared. A change to
 * one side that the other does not follow (a cap, a window, a filter, a rounding) fails here.
 *
 * terminal-parity (in the dashboard tests) pins what the commands print; this pins the tools' own
 * models against them. Synthetic data only.
 */
import { emptyLedger } from "@snappy-export/core";
import type { ExportIssue } from "@snappy-export/core";
import { beforeAll, describe, expect, it } from "vitest";
import * as calendar from "../../dashboard/src/tools/activity-calendar/model.ts";
import * as anniversaries from "../../dashboard/src/tools/anniversaries/model.ts";
import * as blocked from "../../dashboard/src/tools/blocked-review/model.ts";
import * as closest from "../../dashboard/src/tools/closest-fading/model.ts";
import type { ToolData } from "../../dashboard/src/tools/data.ts";
import * as check from "../../dashboard/src/tools/export-check/model.ts";
import * as reminder from "../../dashboard/src/tools/export-reminder/model.ts";
import * as friendCount from "../../dashboard/src/tools/friend-count-history/model.ts";
import * as backup from "../../dashboard/src/tools/friends-backup/model.ts";
import * as friendsTable from "../../dashboard/src/tools/friends-table/model.ts";
import * as habits from "../../dashboard/src/tools/habits/model.ts";
import * as lookalikes from "../../dashboard/src/tools/lookalike-usernames/model.ts";
import * as gaps from "../../dashboard/src/tools/memories-gaps/model.ts";
import * as onThisDay from "../../dashboard/src/tools/memories-on-this-day/model.ts";
import * as reachOut from "../../dashboard/src/tools/reach-out-first/model.ts";
import * as replySpeed from "../../dashboard/src/tools/reply-speed/model.ts";
import * as rescue from "../../dashboard/src/tools/rescue-manifest/model.ts";
import * as safety from "../../dashboard/src/tools/safety-checklist/model.ts";
import * as since from "../../dashboard/src/tools/since-last-export/model.ts";
import * as storage from "../../dashboard/src/tools/storage-planner/model.ts";
import * as waiting from "../../dashboard/src/tools/waiting-on-reply/model.ts";
import * as year from "../../dashboard/src/tools/year-in-review/model.ts";
import { INSIGHT_COMMANDS } from "../src/insight-commands.ts";
import { parseParts, resolveZipPaths, withReaders } from "../src/inputs.ts";
import { NOW, makeIo, run, tempDir, writeSyntheticParts } from "./helpers.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- results of two shapes are read by path, on purpose */
type Any = any;

/** The numbers that matter on each side, in the same order, with what they are. */
type Headline = [label: string, command: unknown, tool: unknown][];

interface Pair {
  /** The command that has --json. */
  command: string;
  /** The tool's model, run on the same data. */
  model: (data: ToolData) => unknown;
  headline: (cli: Any, tool: Any) => Headline;
}

const same = (a: unknown): unknown => JSON.parse(JSON.stringify(a ?? null));

const PAIRS: Pair[] = [
  {
    command: "calendar",
    model: (d) => calendar.computeCalendar(d),
    headline: (c, t) => [
      ["events", c.totals.events, t.result.totals.events],
      ["active days", c.totals.activeDays, t.result.totals.activeDays],
      ["years", c.years.length, t.result.years.length],
      ["longest quiet run", c.streaks.longestQuiet?.days, t.result.streaks.longestQuiet?.days],
    ],
  },
  {
    command: "anniversaries",
    model: (d) => anniversaries.computeAnniversaries(d),
    headline: (c, t) => [
      ["upcoming", c.counts.upcoming, t.upcoming],
      ["milestones", c.counts.milestones, t.milestones],
      ["dated friends", c.counts.dated, t.dated],
    ],
  },
  {
    command: "blocked",
    model: (d) => blocked.computeBlockedReview(d),
    headline: (c, t) => [
      ["people", c.totals.people, t.totals.people],
      ["conflicts", c.totals.conflicts, t.totals.conflicts],
      ["lists", c.lists.length, t.lists.length],
    ],
  },
  {
    command: "closest",
    model: (d) => closest.computeClosestFading(d),
    headline: (c, t) => [
      ["friends", c.counts.friends, t.counts.friends],
      ["events used", c.counts.eventsUsed, t.counts.eventsUsed],
      ["closest", c.closest.length, t.closest.length],
      ["fading", c.fading.length, t.fading.length],
    ],
  },
  {
    command: "check",
    model: (d) => check.computeExportCheck(d),
    headline: (c, t) => [
      ["status", c.status, t.check.status],
      ["parts", c.parts.count, t.check.parts.count],
      ["sections", same(c.sections), same(t.check.sections)],
      ["age", c.age.ageDays, t.check.age.ageDays],
    ],
  },
  {
    command: "remind",
    model: (d) => reminder.computeExportReminder(d),
    headline: (c, t) => [
      ["due date", c.dueAt, t.dueAt],
      ["interval", c.intervalMonths, t.intervalMonths],
    ],
  },
  {
    command: "friend-count",
    model: (d) => friendCount.computeFriendCountHistory(d),
    headline: (c, t) => [
      ["joined", c.totals.joined, t.history.totals.joined],
      ["left", c.totals.left, t.history.totals.left],
      ["current count", c.totals.currentCount, t.history.totals.currentCount],
      ["months", c.months.length, t.history.months.length],
      ["best month", c.best?.month, t.history.best?.month],
    ],
  },
  {
    command: "backup",
    model: (d) => backup.computeFriendsBackup(d),
    headline: (c, t) => [
      ["counts", same(c.counts), same(t.counts)],
      ["friends", c.counts.friends.people, t.backup.friends.length],
    ],
  },
  {
    command: "friends",
    model: (d) => friendsTable.computeFriendsTable(d),
    headline: (c, t) => [
      ["summary", same(c.summary), same(t.table.summary)],
      ["rows", c.matching, t.rows.length],
    ],
  },
  {
    command: "habits",
    model: (d) => habits.computeHabits(d),
    headline: (c, t) => [
      ["chats and Snaps", c.totals.total, t.result.totals.total],
      ["active days", c.activeDays, t.result.activeDays],
      ["median gap", c.medianGapMs, t.result.medianGapMs],
      ["sent share", c.sentShare, t.result.sentShare],
    ],
  },
  {
    command: "lookalikes",
    model: (d) => lookalikes.computeLookalikes(d),
    headline: (c, t) => [
      ["people", c.totals.people, t.totals.people],
      ["pairs", c.totals.pairs, t.totals.pairs],
    ],
  },
  {
    command: "gaps",
    model: (d) => gaps.computeMemoriesGaps(d),
    headline: (c, t) => [
      ["dated", c.counts.dated, t.counts.dated],
      ["longest gap", c.longestGapMonths, t.longestGapMonths],
      ["gaps", c.gaps.length, t.gaps.length],
      ["busiest month", c.busiestMonth?.count, t.busiestMonth?.count],
    ],
  },
  {
    command: "on-this-day",
    model: (d) => onThisDay.computeMemoriesOnThisDay(d),
    headline: (c, t) => [
      ["dated", c.counts.dated, t.counts.dated],
      ["total", c.total, t.total],
    ],
  },
  {
    command: "reach-out",
    model: (d) => reachOut.computeReachOutFirst(d),
    headline: (c, t) => [
      ["summary", same(c.summary), same(t.summary)],
      ["exchanges", c.overall.exchanges, t.overall.exchanges],
    ],
  },
  {
    command: "reply-speed",
    model: (d) => replySpeed.computeReplySpeed(d),
    headline: (c, t) => [
      ["summary", same(c.summary), same(t.report.summary)],
      ["listed", c.friends.length, t.report.friends.length],
      ["hours", c.byHour.length, t.hours.length],
    ],
  },
  {
    command: "rescue",
    model: (d) => rescue.computeRescueManifest(d),
    headline: (c, t) => [
      ["planned", c.planned, t.planned],
      ["items", c.counts.items, t.manifest.items.length],
    ],
  },
  {
    command: "safety",
    model: (d) => safety.computeSafetyChecklist(d),
    headline: (c, t) => [
      ["steps", c.progress.total, t.items.length],
      ["done", c.progress.done, t.items.filter((i: Any) => i.status === "done").length],
    ],
  },
  {
    command: "since",
    model: (d) => since.computeSinceLastExport(d),
    headline: (c, t) => [
      ["comparable", c.comparable, t.result.comparable],
      ["counts", same(c.counts), same(t.result.counts)],
    ],
  },
  {
    command: "storage",
    model: (d) => storage.computeStoragePlanner(d),
    headline: (c, t) => [
      ["totals", same(c.totals), same(t.plan.totals)],
      ["fit", same(c.fit), same(t.plan.fit)],
      ["goal", c.goalBytes, t.plan.goalBytes],
    ],
  },
  {
    command: "replies",
    model: (d) => waiting.computeWaitingOnReply(d),
    headline: (c, t) => [
      ["summary", same(c.summary), same(t.report.summary)],
      ["waiting on you", c.waitingOnYou.length, t.report.waitingOnYou.length],
    ],
  },
  {
    command: "year",
    model: (d) => year.computeYear(d),
    headline: (c, t) => [
      ["chats and Snaps", c.activity.total.total, t.tiles.chats],
      ["active days", c.activity.activeDays, t.tiles.activeDays],
      ["Memories", c.memories.total, t.tiles.memories],
      ["new friends", c.friends.added, t.tiles.newFriends],
      ["friends removed", c.friends.removed, t.tiles.removedFriends],
    ],
  },
];

let dir = "";
let data: ToolData;

beforeAll(async () => {
  dir = tempDir("tool-parity");
  writeSyntheticParts(dir);
  const io = makeIo();
  const paths = await resolveZipPaths(io, [dir]);
  const parsed = await withReaders(io, paths, (readers) => parseParts(readers, io));
  const issues: readonly ExportIssue[] = parsed.issues;
  data = { parsed, source: "export", sample: false, now: NOW, issues, ledger: emptyLedger(), parts: paths.length, capGiB: 5, importFailed: false, savedHistory: false };
}, 120_000);

describe("each insight command and its tool agree on the numbers", () => {
  it("covers every command that has a tool page, so a new command must be added here or named below", () => {
    const covered = new Set(PAIRS.map((p) => p.command));
    // privacy reads no export, so there is no number to compare. Its words are compared in the tool's own tests.
    const without = new Set(["privacy"]);
    const missing = INSIGHT_COMMANDS.map((c) => c.name).filter((name) => !covered.has(name) && !without.has(name));
    expect(missing).toEqual([]);
    for (const pair of PAIRS) expect(INSIGHT_COMMANDS.map((c) => c.name), pair.command).toContain(pair.command);
  });

  it.each(PAIRS.map((p) => [p.command, p] as const))("%s", async (_name, pair) => {
    const result = await run([pair.command, dir, "--json"]);
    expect(result.code, `${pair.command} ${result.err}`).toBe(0);
    const headline = pair.headline(JSON.parse(result.out), pair.model(data));
    expect(headline.length).toBeGreaterThan(0);
    for (const [label, fromCommand, fromTool] of headline) {
      expect(fromTool, `${pair.command}: ${label}`).toEqual(fromCommand);
    }
    // Not every number may be missing on both sides: that would compare nothing.
    expect(headline.some(([, a, b]) => a !== undefined && a !== null && b !== undefined && b !== null), `${pair.command} compared nothing`).toBe(true);
  });
});
