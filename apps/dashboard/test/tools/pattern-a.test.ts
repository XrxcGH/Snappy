/**
 * The shared wording and format rules, held for the eleven tool pages of this group (activity calendar, anniversaries,
 * blocked review, closest and fading, export check, friend count history, friends backup, friends table, habits,
 * lookalike usernames and memories gaps). One assertion per rule, so a later edit cannot bring an old wording back.
 * Synthetic data only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { common, tools } from "../../src/copy.ts";
import { OFFSETS } from "../../src/tools/timezone.ts";
import type { FakeElement } from "../fake-dom.ts";
import { TOOLS } from "../../src/tools/registry.ts";
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

import { textOf } from "../copy-rules.ts";
import { shown } from "./cell-text.ts";
import { renderSettled, sampleState, sampleWorkspace } from "./harness.ts";

const toolsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "tools");

// A page announces its result; what it says is checked in each tool's own test.
vi.mock("../../src/announce.ts", () => ({ announce: () => undefined }));

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

/** The strings of the eleven tools whose text matches, as "tool: path: text" (the key path is not matched). */
export const hits = (re: RegExp, args: readonly unknown[][] = SMALL): string[] =>
  Object.entries(COPIES).flatMap(([id, c]) => stringsOf(c, args).filter(([, text]) => re.test(text)).map(([path, text]) => `${id}: ${path}: ${text}`));

describe("where a person checks", () => {
  it("says Snapchat, never the app, which inside Snappy means Snappy", () => {
    expect(hits(/\bin the app\b|\bthe app\b/i)).toEqual([]);
  });
});

describe("the buttons that make a file", () => {
  it("say Save, because the app has no download and its file dialog says save", () => {
    expect(friendsTable.downloadLabel).toBe("Save CSV");
    expect(friendsBackup.downloadLabel).toBe("Save JSON");
    expect(hits(/\bdownload/i)).toEqual([]);
  });
});

/** A year, as the pages write one. */
const isYear = (digits: string): boolean => digits.length === 4 && Number(digits) >= 1900 && Number(digits) <= 2100;
/** The 4-digit-or-longer numbers in a text that are not a year: a count with no thousands separator. */
const bareCounts = (text: string): string[] => (text.match(/\b\d{4,}\b/g) ?? []).filter((d) => !isYear(d));
/** The functions that take a year, not a count: a year is written without a separator on purpose. */
const YEAR_FUNCTIONS = /^(yearHeading|yearRunsCaption|unitMonth|unitMonthYear|yearColumnHeader|unitInYear|yearAdjustedNote|yearEmptyNote)\(/;

describe("counts", () => {
  it("go through formatCount in every string that interpolates one, so 12345 is written 12,345", () => {
    const n = 12345;
    const said = [
      anniversaries.moreLine(n, n),
      memoriesGaps.moreLine(n, n),
      lookalikeUsernames.truncatedNote(n, n),
      friendsBackup.doneAnnounce(n, n, n),
      blockedReview.doneAnnounce(n, n),
      friendCountHistory.unitGain("Mar 2026", n),
      friendCountHistory.unitDrop("Mar 2026", n),
      friendCountHistory.unitAdded(n),
      friendCountHistory.unitRemoved(n),
      friendCountHistory.monthsShownLine(n, n),
      friendCountHistory.unitSaved(n),
      friendCountHistory.unitCurve(n),
      friendCountHistory.unitGap(n),
      friendCountHistory.unitGap(-n),
      friendCountHistory.comparisonsShownLine(n, n),
      friendCountHistory.disagreeNote(n, n, n),
    ];
    expect(said.filter((s) => bareCounts(s).length > 0)).toEqual([]);
    expect(friendCountHistory.unitAdded(n)).toBe("12,345 added");
    expect(blockedReview.doneAnnounce(n, n)).toContain("12,345 may be worth a second look");
  });

  it("hold in the pages as drawn: no number of four digits or more that is not a year, in any tool of the group", async () => {
    await sampleWorkspace();
    const sample = await sampleState();
    const pages: string[] = [];
    for (const id of Object.keys(COPIES)) {
      const tool = TOOLS.find((t) => t.id === id);
      expect(tool, id).toBeDefined();
      const { root } = await renderSettled((tool as (typeof TOOLS)[number]).view, sample);
      pages.push(`${id}: ${bareCounts(textOf(root)).join(", ")}`);
    }
    expect(pages.filter((p) => !p.endsWith(": "))).toEqual([]);
    // The sample holds counts past a thousand, so the check above has something to catch.
    const { root } = await renderSettled((TOOLS.find((t) => t.id === "export-check") as (typeof TOOLS)[number]).view, sample);
    expect(root.textContent).toMatch(/\b\d{1,3}(,\d{3})+\b/);
  }, 60_000);
});

const pageOf = async (id: string): Promise<FakeElement> => {
  await sampleWorkspace();
  return (await renderSettled((TOOLS.find((t) => t.id === id) as (typeof TOOLS)[number]).view, await sampleState())).root;
};

describe("formats", () => {
  it("write a clock as AM or PM", () => {
    expect(habits.unitHour(0)).toBe("12 AM");
    expect(habits.unitHour(12)).toBe("12 PM");
    expect(habits.unitHour(19)).toBe("7 PM");
    expect(hits(/\b\d{1,2}(:\d\d)? ?(am|pm)\b/)).toEqual([]);
  });

  it("write the empty value as the one en dash, never a hyphen", () => {
    expect(common.noFigure).toBe("–");
    expect(habits.noValue).toBe(common.noFigure);
    expect(activityCalendar.noValue).toBe(common.noFigure);
    for (const id of Object.keys(COPIES)) {
      for (const file of ["view.ts", "copy.ts"]) {
        const text = readFileSync(path.join(toolsDir, id, file), "utf8");
        expect(text, `${id}/${file}`).not.toMatch(/noValue: "-"|\? "-" :|: "-"\)/);
      }
    }
  });

  it("name every time zone as UTC, UTC+2:00 or UTC-5:30 under the label Time zone, in all three tools that offer one", async () => {
    for (const [id, selectId] of [["habits", "habits-zone"], ["activity-calendar", "calendar-zone"], ["memories-gaps", "gaps-offset"]] as const) {
      const root = await pageOf(id);
      const select = root.querySelector(`#${selectId}`) as FakeElement;
      expect(select, id).not.toBeNull();
      const labels = select.querySelectorAll("option").map((o) => o.textContent);
      expect(labels.length, id).toBe(OFFSETS.length);
      expect(labels.filter((l) => !/^UTC([+-]\d{1,2}:\d{2})?$/.test(l)), id).toEqual([]);
      expect(root.querySelector(`label[for=${selectId}]`)?.textContent, id).toBe("Time zone");
    }
  });

  it("write a month as a short month in a table and in a fact: Jan 2025, never January 2025", async () => {
    const long = /\b(January|February|March|April|June|July|August|September|October|November|December) \d{4}\b/;
    expect(hits(long)).toEqual([]);
    for (const id of Object.keys(COPIES)) {
      const root = await pageOf(id);
      const cells = root.querySelectorAll("td, th, dd").map((c) => c.textContent).filter((t) => long.test(t));
      expect(cells, id).toEqual([]);
    }
  });

  it("write a length of time by one rule: minutes up to two hours, hours up to two days", () => {
    expect(habits.unitGap(83 * 60_000)).toBe("83 minutes");
    expect(habits.unitGap(120 * 60_000)).toBe("2 hours");
    expect(habits.unitGap(47 * 3_600_000)).toBe("47 hours");
    expect(habits.unitGap(48 * 3_600_000)).toBe("2 days");
    expect(habits.unitGap(500)).toBe("Under 1 second");
    expect(habits.unitGap(Number.NaN)).toBe("");
  });
});

describe("table cells", () => {
  it("never repeat their column header on a wide page: the bare value is shown and the full phrase is kept for assistive technology", async () => {
    const repeats: string[] = [];
    let labeled = 0;
    for (const id of Object.keys(COPIES)) {
      const root = await pageOf(id);
      for (const table of root.querySelectorAll("table")) {
        const heads = table.querySelectorAll("thead th").map((th) => th.textContent);
        for (const row of table.querySelectorAll("tbody tr")) {
          row.querySelectorAll("td").forEach((td, i) => {
            const word = (heads[i + 1] ?? "").split(/\s+/)[0] ?? "";
            const seen = shown(td);
            if (td.querySelector(".cell-short") !== null) {
              labeled++;
              const long = td.querySelector(".cell-long") as FakeElement;
              expect(td.querySelector(".cell-short")?.getAttribute("aria-hidden"), `${id} ${seen}`).toBe("true");
              expect(long.classList.contains("sr-only"), `${id} ${seen}`).toBe(true);
              if (seen !== common.noFigure) expect(long.textContent.toLowerCase(), `${id} ${seen}`).toContain(seen.toLowerCase());
            }
            if (word.length >= 3 && new RegExp(`\\b${word}`, "i").test(seen)) repeats.push(`${id}: "${seen}" under ${heads[i + 1]}`);
          });
        }
      }
    }
    expect(labeled).toBeGreaterThan(60);
    expect(repeats).toEqual([]);
  }, 60_000);
});

describe("the note for something a page cannot describe, and the word for what is left out", () => {
  it("is the one shared note, which points to the export check; the export check itself does not point to itself", () => {
    expect(hits(/noted something/i)).toEqual([]);
    for (const [id, c] of Object.entries(COPIES)) {
      // The calendar's own otherNote is about chat media; its catch-all is unknownNote.
      const note = id === "activity-calendar" ? c.unknownNote : c.otherNote;
      if (typeof note !== "string") continue;
      if (id === "export-check") expect(note).toBe("Snappy found something it could not describe.");
      else expect(note, id).toBe(tools.otherNote);
    }
    expect(tools.otherNote).toBe("Snappy found something it could not describe. The export check can say more.");
  });

  it("says left out for a record, a date or a gap that is not counted, and skipped only for a file", () => {
    expect(hits(/\bSnappy (ignores?|ignored|skips?|skipped|drops?|dropped)\b|\bso it (ignored|skipped)\b/i)).toEqual([]);
  });
});
