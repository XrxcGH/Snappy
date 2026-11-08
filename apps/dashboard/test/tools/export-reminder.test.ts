/**
 * Export reminder: what it computes from the settings and the export date, and what its page shows. Synthetic data only.
 * Usernames of the sample export are canaries: none may reach a result, a note, an announcement or the page.
 */
import { insights } from "@snappy-export/core";
import type { ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { formatDate } from "../../src/format.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import type { ToolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/export-reminder/copy.ts";
import { descriptor } from "../../src/tools/export-reminder/index.ts";
import { buildReminderFile, computeExportReminder, DEFAULT_PARAMS, OFFSETS } from "../../src/tools/export-reminder/model.ts";
import type { ReminderParams } from "../../src/tools/export-reminder/model.ts";
import { view } from "../../src/tools/export-reminder/view.ts";
import { RULES, collectCopy, lint, useNames } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";
import type { Rendered } from "./harness.ts";

const said: { text: string; assertive: boolean }[] = [];
const saved: { fileName: string; text: string; mime: string }[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string, assertive = false) => void said.push({ text, assertive }) }));
vi.mock("../../src/download.ts", () => ({
  saveTextFile: (fileName: string, text: string, mime: string) => {
    saved.push({ fileName, text, mime });
    return true;
  },
  saveBlob: () => true,
}));

const NOW = Date.UTC(2026, 6, 1, 12);
const EXPORTED = Date.UTC(2026, 5, 15, 12);
const DAY = 24 * 60 * 60 * 1000;
const UTC: ReminderParams = { ...DEFAULT_PARAMS, offset: "0" };

let base: Workspace;
let sample: State;
let names: string[];
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
  const parsed = base.latest as ParsedExport;
  names = [...new Set([...parsed.friends.friends.map((f) => f.username), ...parsed.chats.slice(0, 200).map((c) => c.conversation)])].filter((n) => n.length >= 5);
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});

/** A real (not sample) export made from the sample's, exported and read on fixed days. */
function real(change: Partial<ParsedExport> = {}, ws: Partial<Workspace> = {}): State {
  const latest = { ...(base.latest as ParsedExport), exportedAt: EXPORTED, ...change };
  return stateWith({ latest, now: NOW, issues: [], parts: 1, ...ws });
}
const dataOf = (state: State, patch: Partial<ToolData> = {}): ToolData => ({ ...toolData(state), ...patch });
const codes = (r: ReturnType<typeof computeExportReminder>): string[] => r.notes.map((n) => n.code);
const dayAt = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);

describe("the tool", () => {
  it("is a Your export tool in the brand violet that needs nothing and shows the remind command", () => {
    expect(descriptor).toMatchObject({ id: "export-reminder", title: "Export reminder", group: "your-export", category: "cleanup", needs: [] });
    expect(descriptor.oneLiner.length).toBeLessThanOrEqual(56);
    expect(COMMANDS.remind.argv[0]).toBe("remind");
  });

  it("offers time zones that core accepts, each one once", () => {
    expect(new Set(OFFSETS).size).toBe(OFFSETS.length);
    for (const minutes of OFFSETS) expect(minutes).toBeGreaterThanOrEqual(-insights.exportReminder.MAX_OFFSET_MINUTES);
    expect(copy.unitZone(0)).toBe("UTC");
    expect(copy.unitZone(-300)).toBe("UTC-5:00");
    expect(copy.unitZone(330)).toBe("UTC+5:30");
    expect(copy.unitClock(0, 5)).toBe("12:05 AM");
    expect(copy.unitClock(13, 30)).toBe("1:30 PM");
  });
});

describe("computeExportReminder", () => {
  it("counts three months from the day of the export, as core does, with no notes", () => {
    const r = computeExportReminder(dataOf(real()), UTC);
    const core = insights.exportReminder.buildExportReminder({ now: NOW, lastExportAt: EXPORTED, intervalMonths: 3, utcOffsetMinutes: 0 });
    expect(r.dueAt).toBe(core.dueAt);
    expect(r.dueAt).toBe(dayAt(2026, 9, 15));
    expect(r).toMatchObject({ intervalMonths: 3, allDay: true, timed: null, alertDays: null, lastSource: "export", lastDayAt: dayAt(2026, 6, 15) });
    expect(r.notes).toEqual([]);
  });

  it("counts from today and says so when no export date is known, with no export at all, and still runs", () => {
    const r = computeExportReminder(dataOf(initialState(), { now: NOW }), UTC);
    expect(r.lastSource).toBe("none");
    expect(r.lastDayAt).toBeNull();
    expect(codes(r)).toEqual(["no-last-export"]);
    expect(r.dueAt).toBe(dayAt(2026, 10, 1));
    const undated = computeExportReminder(dataOf(real({ exportedAt: undefined as unknown as number })), UTC);
    expect(codes(undated)).toContain("no-last-export");
    expect(undated.lastSource).toBe("none");
  });

  it("uses a typed date over the export's, and a typed date is read as a day in the chosen zone", () => {
    const typed = computeExportReminder(dataOf(real()), { ...UTC, lastExport: "2026-06-01" });
    expect(typed.lastSource).toBe("typed");
    expect(typed.lastDayAt).toBe(dayAt(2026, 6, 1));
    expect(typed.dueAt).toBe(dayAt(2026, 9, 1));
    const west = computeExportReminder(dataOf(real()), { ...UTC, lastExport: "2026-06-01", offset: "-300" });
    expect(west.lastDayAt).toBe(dayAt(2026, 6, 1));
    expect(west.options.lastExportAt).toBe(Date.UTC(2026, 5, 1, 17));
  });

  it("puts an evening export on the person's own calendar day when the zone is west of UTC", () => {
    const late = real({ exportedAt: Date.UTC(2026, 5, 11, 2) });
    expect(computeExportReminder(dataOf(late), UTC).lastDayAt).toBe(dayAt(2026, 6, 11));
    expect(computeExportReminder(dataOf(late), { ...UTC, offset: "-300" }).lastDayAt).toBe(dayAt(2026, 6, 10));
  });

  it("repairs a date it cannot use and says so: a made-up day, a day in the future", () => {
    const bad = computeExportReminder(dataOf(real()), { ...UTC, lastExport: "2026-02-31" });
    expect(codes(bad)).toEqual(["last-export-invalid"]);
    expect(bad.lastSource).toBe("none");
    expect(bad.lastDayAt).toBeNull();
    const future = computeExportReminder(dataOf(real()), { ...UTC, lastExport: "2030-01-01" });
    expect(codes(future)).toEqual(["last-export-in-future"]);
    expect(future.lastDayAt).toBeNull();
    expect(future.dueAt).toBe(dayAt(2026, 10, 1));
  });

  it("clamps a day that the reminder month does not have, and moves a date that has passed to tomorrow", () => {
    const clamped = computeExportReminder(dataOf(real({ exportedAt: dayAt(2026, 5, 31) + 12 * 3_600_000 })), { ...UTC, months: "1" });
    // May 31 plus a month is June 30, which is before "today" (July 1), so the reminder moves to tomorrow.
    expect(codes(clamped)).toEqual(["day-clamped", "due-date-passed"]);
    expect(clamped.dueAt).toBe(dayAt(2026, 7, 2));
    const clampedAhead = computeExportReminder(dataOf(real({ exportedAt: dayAt(2026, 5, 31) + 12 * 3_600_000 })), { ...UTC, months: "9" });
    expect(codes(clampedAhead)).toEqual(["day-clamped"]);
    expect(clampedAhead.dueAt).toBe(dayAt(2027, 2, 28));
    const old = computeExportReminder(dataOf(real({ exportedAt: NOW - 400 * DAY })), UTC);
    expect(codes(old)).toEqual(["due-date-passed"]);
    expect(old.dueAt).toBe(dayAt(2026, 7, 2));
    expect(old.lastDayAt).not.toBeNull();
  });

  it("takes months from 1 to 120 and falls back to 3 with a note for anything else; empty means the default", () => {
    const months = (m: string) => computeExportReminder(dataOf(real()), { ...UTC, months: m });
    expect(months("1").intervalMonths).toBe(1);
    expect(months("120").intervalMonths).toBe(120);
    expect(months("").intervalMonths).toBe(3);
    expect(months("").notes).toEqual([]);
    for (const bad of ["0", "121", "2.5", "abc", "-4"]) {
      const r = months(bad);
      expect(r.intervalMonths, bad).toBe(3);
      expect(codes(r), bad).toEqual(["interval-adjusted"]);
    }
  });

  it("makes a timed event from a 24-hour time and shows the time the file holds", () => {
    const timed = computeExportReminder(dataOf(real()), { ...UTC, time: "09:30" });
    expect(timed.allDay).toBe(false);
    expect(timed.timed).toEqual({ hour: 9, minute: 30, durationMinutes: insights.exportReminder.DEFAULT_TIME.durationMinutes });
    expect(timed.notes).toEqual([]);
    const late = computeExportReminder(dataOf(real()), { ...UTC, time: "23:59" });
    expect(late.timed).toMatchObject({ hour: 23, minute: 59 });
    for (const bad of ["25:00", "9:75", "noon"]) {
      const r = computeExportReminder(dataOf(real()), { ...UTC, time: bad });
      expect(codes(r), bad).toEqual(["time-adjusted"]);
      expect(r.timed, bad).toMatchObject({ hour: 9, minute: 0 });
    }
    expect(computeExportReminder(dataOf(real()), UTC).timed).toBeNull();
  });

  it("takes an alert of 0 to 30 days, none when empty, and sets the same day when it cannot use it", () => {
    const alert = (a: string) => computeExportReminder(dataOf(real()), { ...UTC, alert: a });
    expect(alert("").alertDays).toBeNull();
    expect(alert("0").alertDays).toBe(0);
    expect(alert("30").alertDays).toBe(30);
    expect(alert("30").notes).toEqual([]);
    for (const bad of ["31", "-1", "1.5", "soon"]) {
      expect(alert(bad).alertDays, bad).toBe(0);
      expect(codes(alert(bad)), bad).toEqual(["alarm-adjusted"]);
    }
  });

  it("uses UTC days for a time zone that is not in the list, without a note the person could not cause", () => {
    expect(computeExportReminder(dataOf(real()), { ...UTC, offset: "100" }).options.utcOffsetMinutes).toBe(0);
    expect(computeExportReminder(dataOf(real()), { ...UTC, offset: "" }).options.utcOffsetMinutes).toBe(0);
    expect(computeExportReminder(dataOf(real()), { ...UTC, offset: "330" }).options.utcOffsetMinutes).toBe(330);
  });

  it("holds no username, link or text of a message, and no calendar file text until one is asked for", () => {
    const json = JSON.stringify(computeExportReminder(dataOf(sample), { ...UTC, time: "09:00", alert: "1" }));
    for (const name of names) expect(json, name).not.toContain(name);
    expect(json).not.toMatch(/BEGIN:VCALENDAR|https?:|\.zip|\.json/i);
  });

  it("builds the calendar file exactly as core does, for the same options", () => {
    const params: ReminderParams = { ...UTC, months: "6", time: "08:15", alert: "2" };
    const result = computeExportReminder(dataOf(real()), params);
    const file = buildReminderFile(result);
    const core = insights.exportReminder.buildExportReminder({ now: NOW, lastExportAt: EXPORTED, intervalMonths: 6, timed: { hour: 8, minute: 15 }, alarmDaysBefore: 2, utcOffsetMinutes: 0 });
    expect(file).toEqual({ fileName: insights.exportReminder.REMINDER_FILE_NAME, text: core.ics, mime: "text/calendar" });
    expect(file.text.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(insights.exportReminder.validateIcs(file.text).valid).toBe(true);
    // No personal data goes in: the file is the same whatever the export holds.
    expect(buildReminderFile(computeExportReminder(dataOf(sample, { now: NOW }), { ...params, lastExport: "2026-06-15" })).text).toBe(file.text);
  });
});

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const field = (r: Rendered, id: string): FakeElement => r.root.querySelector(`#${id}`) as FakeElement;

/** Types into a control the way a person does, then waits for the result to repaint. */
async function enter(r: Rendered, id: string, value: string, event = "input"): Promise<void> {
  const el = field(r, id);
  el.value = value;
  el.fire(event);
  await settled(r.root);
}

/** A page in UTC, so the dates do not depend on the zone of the machine running the tests. */
async function utcPage(state: State): Promise<Rendered> {
  const r = await renderSettled(view, state);
  await enter(r, "reminder-zone", "0", "change");
  said.length = 0;
  return r;
}

describe("the page", () => {
  it("shows the settings, the due date, the facts, a download and the command", async () => {
    const r = await utcPage(real());
    const { root } = r;
    expect(text(root, ".section-title")).toEqual([copy.settingsHeading, copy.reminderHeading, tools.downloadHeading, tools.commandHeading]);
    expect(text(root, ".tool-result .summary")).toEqual([copy.dueLine(formatDate(dayAt(2026, 9, 15)))]);
    expect(text(root, ".facts dt")).toEqual([copy.lastExportFact, copy.waitFact, copy.eventFact, copy.alertFact]);
    expect(text(root, ".facts dd")).toEqual([formatDate(dayAt(2026, 6, 15)), "3 months", copy.allDayLine, copy.noAlertLine]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.remind));
    expect(root.querySelector(".command-head")?.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Copy", "Run"]);
    expect(root.querySelectorAll(".tool-notes")).toHaveLength(0);
  });

  it("counts from today, never from 1970, when the workspace holds no read date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      const r = computeExportReminder(dataOf(emptyState()), UTC);
      expect(dataOf(emptyState()).now).toBe(0);
      expect(r.dueAt).toBe(dayAt(2026, 10, 1));
      expect(r.dueAt).toBeGreaterThan(dayAt(2000, 1, 1));
      const page = await renderSettled(view, emptyState());
      expect(text(page.root, ".tool-result .summary")[0]).toBe(copy.dueLine(formatDate(dayAt(2026, 10, 1))));
      expect(page.root.querySelector(".tool-result .summary")?.textContent).not.toContain("1970");
    } finally {
      vi.useRealTimers();
    }
  });

  it("works with the sample data and with no data at all, and says when no date is known", async () => {
    const withSample = await renderSettled(view, sample);
    expect(withSample.root.querySelector(".tool-result .summary")?.textContent).toMatch(/^Request your next export on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
    const none = await renderSettled(view, emptyState());
    expect(none.root.querySelector(".tool-result")).not.toBeNull();
    expect(none.root.querySelector(".empty")).toBeNull();
    expect(text(none.root, ".facts dd")[0]).toBe(copy.unknownLine);
    expect(text(none.root, ".tool-notes li")).toEqual([copy.noLastNote]);
    // The command is there with or without an export.
    expect(none.root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.remind));
  });

  it("announces the due date politely once, with no name", async () => {
    await renderSettled(view, real());
    expect(said).toHaveLength(1);
    expect(said[0]?.assertive).toBe(false);
    expect(said[0]?.text).toMatch(/^Your next export reminder is due on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
    expect(said[0]?.text.length).toBeLessThanOrEqual(140);
    for (const name of names) expect(said[0]?.text).not.toContain(name);
  });

  it("recomputes when a setting changes, repaints only the result and keeps the controls in place", async () => {
    const r = await utcPage(real());
    const months = field(r, "reminder-months");
    await enter(r, "reminder-months", "6");
    expect(text(r.root, ".tool-result .summary")).toEqual([copy.dueLine(formatDate(dayAt(2026, 12, 15)))]);
    expect(text(r.root, ".facts dd")[1]).toBe("6 months");
    expect(field(r, "reminder-months")).toBe(months);
    expect(r.root.querySelectorAll("input")).toHaveLength(4);

    await enter(r, "reminder-time", "09:30");
    await enter(r, "reminder-alert", "2");
    expect(text(r.root, ".facts dd").slice(2)).toEqual(["9:30 AM, 30 minutes", "2 days before"]);
    await enter(r, "reminder-alert", "0");
    expect(text(r.root, ".facts dd")[3]).toBe(copy.sameDayLine);
    await enter(r, "reminder-time", "");
    expect(text(r.root, ".facts dd")[2]).toBe(copy.allDayLine);

    await enter(r, "reminder-last", "2026-01-31");
    expect(text(r.root, ".facts dd")[0]).toBe(formatDate(dayAt(2026, 1, 31)));
    expect(said.length).toBeGreaterThan(1);
  });

  it("changes the day when the time zone changes", async () => {
    const r = await utcPage(real({ exportedAt: Date.UTC(2026, 5, 11, 2) }));
    expect(text(r.root, ".facts dd")[0]).toBe(formatDate(dayAt(2026, 6, 11)));
    const zone = field(r, "reminder-zone");
    expect(zone.querySelectorAll("option")).toHaveLength(OFFSETS.length);
    await enter(r, "reminder-zone", "-300", "change");
    expect(text(r.root, ".facts dd")[0]).toBe(formatDate(dayAt(2026, 6, 10)));
    expect(field(r, "reminder-zone")).toBe(zone);
  });

  it("shows each note as one short hedged sentence, a warning where the date is moved or looks wrong", async () => {
    const r = await utcPage(real({ exportedAt: NOW - 400 * DAY }));
    expect(text(r.root, ".tool-notes li")).toEqual([copy.passedNote]);
    expect(r.root.querySelector(".tool-note")?.classList.contains("tool-note-warning")).toBe(true);
    expect(text(r.root, ".section-title")).toContain(tools.notesHeading);

    await enter(r, "reminder-months", "500");
    expect(text(r.root, ".tool-notes li")).toContain(copy.monthsAdjustedNote(3));
    await enter(r, "reminder-time", "09:00");
    await enter(r, "reminder-alert", "99");
    expect(text(r.root, ".tool-notes li")).toContain(copy.alertAdjustedNote);
    await enter(r, "reminder-last", "2030-01-01");
    expect(text(r.root, ".tool-notes li")).toContain(copy.futureLastNote);
    expect(r.root.querySelectorAll(".tool-note-warning").length).toBeGreaterThan(0);
    // With no date at all, a date that has passed is not blamed on an export.
    for (const note of text(r.root, ".tool-notes li")) expect(note).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
    const none = await renderSettled(view, stateWith({ now: NOW - 400 * DAY }));
    expect(text(none.root, ".tool-notes li")).toEqual([copy.noLastNote]);
  });

  it("builds the calendar file only when the button is pressed, and it is core's text", async () => {
    const r = await utcPage(real());
    await enter(r, "reminder-months", "6");
    await enter(r, "reminder-time", "07:45");
    await enter(r, "reminder-alert", "1");
    expect(saved).toHaveLength(0);
    expect(r.root.textContent).not.toContain("BEGIN:VCALENDAR");
    const button = r.root.querySelectorAll("button").find((b) => b.textContent === copy.downloadLabel) as FakeElement;
    expect(r.root.textContent).toContain(copy.downloadNote);
    said.length = 0;
    button.click();
    const core = insights.exportReminder.buildExportReminder({ now: NOW, lastExportAt: EXPORTED, intervalMonths: 6, timed: { hour: 7, minute: 45 }, alarmDaysBefore: 1, utcOffsetMinutes: 0 });
    expect(saved).toEqual([{ fileName: "snappy-export-reminder.ics", text: core.ics, mime: "text/calendar" }]);
    expect(said).toEqual([{ text: tools.downloadSaved, assertive: false }]);
  });

  it("shows no username anywhere, not even the sample's, and no link", async () => {
    const { root } = await renderSettled(view, sample);
    for (const name of names) expect(root.textContent, name).not.toContain(name);
    expect(root.querySelectorAll("code.username")).toHaveLength(0);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelectorAll("a").filter((a) => (a.getAttribute("href") ?? "").startsWith("http"))).toHaveLength(0);
    for (const label of root.descendants().flatMap((e) => ["aria-label", "title", "alt"].map((a) => e.getAttribute(a) ?? ""))) {
      for (const name of names) expect(label).not.toContain(name);
    }
  });

  it("labels every control and ties its help to it", async () => {
    const { root } = await renderSettled(view, emptyState());
    for (const id of ["reminder-last", "reminder-months", "reminder-time", "reminder-alert", "reminder-zone"]) {
      expect(root.querySelector(`label[for="${id}"]`), id).not.toBeNull();
      expect(field({ root } as Rendered, id).getAttribute("aria-describedby")).toBe(`${id}-help`);
      expect(root.querySelector(`#${id}-help`), id).not.toBeNull();
    }
    expect(text(root, "label")).toEqual([copy.lastExportHeader, copy.monthsHeader, copy.timeHeader, copy.alertHeader, copy.zoneHeader]);
    expect(field({ root } as Rendered, "reminder-last").getAttribute("type")).toBe("date");
    expect(field({ root } as Rendered, "reminder-time").getAttribute("type")).toBe("time");
  });
});

describe("its words", () => {
  it("pass the copy lint: sentence case, US English, quotes, punctuation and lengths", () => {
    const entries = collectCopy({ tool_exportReminder: copy });
    useNames([]);
    expect(entries.length).toBeGreaterThan(20);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("hold no username and take none: the functions only take numbers and dates", () => {
    for (const value of Object.values(copy)) {
      if (typeof value !== "function") continue;
      const out = (value as (...a: unknown[]) => string)("Nov 6, 2026", 3);
      expect(typeof out).toBe("string");
      expect(out).not.toMatch(/alice|@/);
    }
  });
});
