/**
 * Since your last export: what it computes from the export on the page and the saved history, and what its page
 * shows and downloads. Synthetic data only. Crafted usernames carry a canary that may appear only in the result
 * tables and the CSV, never in a note, an announcement, a label or a title.
 */
import type { ChatEvent, Ledger, MemoryItem, ParsedExport, Snapshot } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/since-last-export/copy.ts";
import { descriptor } from "../../src/tools/since-last-export/index.ts";
import { choosePrevious, computeSinceLastExport, csvFileName, csvRows, peopleByChange } from "../../src/tools/since-last-export/model.ts";
import { view } from "../../src/tools/since-last-export/view.ts";
import { RULES, collectCopy, lint, useNames } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, render, renderSettled, sampleState, sampleWorkspace, stateWith } from "./harness.ts";

const said: string[] = [];
const saved: { fileName: string; text: string; mime: string }[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));
vi.mock("../../src/download.ts", () => ({
  saveTextFile: (fileName: string, text: string, mime: string) => {
    saved.push({ fileName, text, mime });
    return true;
  },
  saveBlob: () => true,
}));

const DAY = 86_400_000;
const at = (y: number, m: number, d = 10): number => Date.UTC(y, m - 1, d, 12);
const NOW = at(2026, 6, 15);
const PREVIOUS_AT = at(2026, 3, 1);
const CURRENT_AT = at(2026, 5, 1);
const CANARY = "zqcanary";

let base: Workspace;
let sample: State;
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
  useNames([]);
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});

const name = (s: string): string => `${CANARY}_${s}`;
const friend = (s: string, createdAt?: number) => ({ username: name(s), ...(createdAt !== undefined && { createdAt }) });

function snapshot(id: string, takenAt: number, friends: string[], sentRequests: string[] = []): Snapshot {
  return { id, takenAt, source: "export", friends: friends.map(name), sentRequests: sentRequests.map(name), deleted: {}, friendSince: {}, sentAt: {} };
}
const ledgerOf = (...snapshots: Snapshot[]): Ledger => ({ version: 1, snapshots });

const chat = (direction: ChatEvent["direction"], time: number): ChatEvent => ({ conversation: name("chat"), isGroup: false, direction, kind: "TEXT", at: time });
const memory = (i: number, date: number | null): MemoryItem => ({ id: `m${i}`, date, mediaType: "image" });

interface Crafted {
  friends?: ReturnType<typeof friend>[];
  sentRequests?: ReturnType<typeof friend>[];
  chats?: ChatEvent[];
  memories?: MemoryItem[];
  /** The time the export says it was made; "none" leaves it out. */
  exportedAt?: number | "none";
  ledger?: Ledger;
  saving?: boolean;
  issues?: Workspace["issues"];
}

/**
 * A real (not sample) export. Between the saved export (Mar 1) and this one (May 1): `d` was added, `a` is no longer
 * listed, `c` is listed under another spelling, request `r1` is no longer listed, and chats and Memories fall in both periods.
 */
function real(o: Crafted = {}): State {
  const latestBase = base.latest as ParsedExport;
  const { exportedAt: _drop, ...rest } = latestBase;
  const friends = o.friends ?? [friend("b", at(2025, 1)), { username: name("C").toUpperCase() }, friend("d", at(2026, 4))];
  const chats = o.chats ?? [
    chat("sent", CURRENT_AT - 20 * DAY),
    chat("sent", CURRENT_AT - 10 * DAY),
    chat("sent", CURRENT_AT - 5 * DAY),
    chat("received", CURRENT_AT - 3 * DAY),
    chat("received", CURRENT_AT - 2 * DAY),
    chat("unknown", CURRENT_AT - DAY),
    chat("sent", PREVIOUS_AT - 20 * DAY),
    chat("received", PREVIOUS_AT - 70 * DAY),
  ];
  const memories = o.memories ?? [memory(1, PREVIOUS_AT + 5 * DAY), memory(2, CURRENT_AT - DAY), memory(3, PREVIOUS_AT - 30 * DAY), memory(4, null)];
  const exportedAt = o.exportedAt === "none" ? undefined : (o.exportedAt ?? CURRENT_AT);
  const latest: ParsedExport = {
    ...rest,
    ...(exportedAt !== undefined && { exportedAt }),
    friends: { ...latestBase.friends, friends, sentRequests: o.sentRequests ?? [friend("r2", at(2026, 1))], deletedFriends: [], blocked: [] },
    chats,
    memories,
  };
  const ledger = o.ledger ?? ledgerOf(snapshot("p", PREVIOUS_AT, ["a", "b", "c"], ["r1", "r2"]));
  const state = stateWith({ latest, now: NOW, issues: o.issues ?? [], parts: 1, ledger });
  // Saving is on and unlocked unless a test says otherwise: only then is the ledger really saved history.
  return { ...state, vault: { ...state.vault, phase: o.saving === false ? "session" : "unlocked" } };
}
const dataOf = (state: State) => toolData(state);
const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const titles = (el: FakeElement): string[] => text(el, ".section-title");

describe("the tool", () => {
  it("is a Your export tool that needs an export with friends and shows the since command", () => {
    expect(descriptor).toMatchObject({ id: "since-last-export", title: "Since your last export", group: "your-export", category: "cleanup", needs: ["export", "friends"] });
    expect(COMMANDS.since.argv[0]).toBe("since");
    expect(COMMANDS.since.needsFile).toBe(true);
  });

  it("has copy that passes the lint", () => {
    const problems = RULES.flatMap((rule) => lint(collectCopy({ copy }), rule));
    expect(problems).toEqual([]);
  });
});

describe("choosePrevious", () => {
  const current = snapshot("now", 1000, []);
  const at1 = (id: string, t: number): Snapshot => snapshot(id, t, []);

  it("takes the newest saved export at or before this one, and never this export itself", () => {
    expect(choosePrevious([at1("a", 100), at1("b", 400), at1("now", 1000), at1("c", 700)], current)?.id).toBe("c");
    expect(choosePrevious([at1("a", 100), at1("b", 1000)], current)?.id).toBe("b");
    expect(choosePrevious([at1("a", 100), at1("z", 5000)], current)?.id).toBe("a");
  });

  it("falls back to the nearest newer export, and finds nothing for an empty or lone history or an odd time", () => {
    expect(choosePrevious([at1("later", 9000), at1("late", 5000)], current)?.id).toBe("late");
    expect(choosePrevious([], current)).toBeUndefined();
    expect(choosePrevious([at1("now", 1000)], current)).toBeUndefined();
    expect(choosePrevious([at1("bad", Number.NaN)], current)).toBeUndefined();
  });

  it("is quick on a long history", () => {
    const list = Array.from({ length: 20_000 }, (_, i) => at1(`s${i}`, i));
    const started = Date.now();
    expect(choosePrevious(list, at1("now", 15_000))?.id).toBe("s15000");
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("computeSinceLastExport", () => {
  it("compares with the export saved before it: who was added, who is no longer listed, and the requests", () => {
    const { result } = computeSinceLastExport(dataOf(real()));
    expect(result).toMatchObject({ comparable: true, previousAt: PREVIOUS_AT, currentAt: CURRENT_AT, daysBetween: 61 });
    const by = peopleByChange(result);
    expect(by.added.map((p) => p.username)).toEqual([name("d")]);
    expect(by["no-longer-listed"].map((p) => p.username)).toEqual([name("a")]);
    expect(by["request-no-longer-listed"].map((p) => p.username)).toEqual([name("r1")]);
    expect(by["request-pending"].map((p) => p.username)).toEqual([name("r2")]);
    expect(result.friends).toMatchObject({ previousCount: 3, currentCount: 3, net: 0 });
    expect(result.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["friends-may-have-left", "requests-may-be-declined", "memories-dates-unusable"]));
  });

  it("counts new Memories by capture date, and chats and Snaps against the period before", () => {
    const { result } = computeSinceLastExport(dataOf(real()));
    expect(result.memories).toEqual({ total: 4, newCount: 2, totalChange: null });
    expect(result.activity?.since).toEqual({ sent: 3, received: 2, unknown: 1 });
    expect(result.activity?.earlier).toEqual({ sent: 1, received: 0, unknown: 0 });
    expect(result.activity?.change).toEqual({ sent: 2, received: 2 });
  });

  it("works on the sample, whose saved history holds the export before it", () => {
    const { result, savedHistory, exportHasErrors } = computeSinceLastExport(dataOf(sample));
    expect(result.comparable).toBe(true);
    expect(result.notes.map((n) => n.code)).not.toContain("order-swapped");
    expect(result.friends?.added.length).toBeGreaterThan(0);
    expect(result.friends?.disappeared.length).toBeGreaterThan(0);
    expect(savedHistory).toBe(true);
    expect(exportHasErrors).toBe(false);
  });

  it("compares nothing when saving is off: this session's imports are not history", () => {
    const off = computeSinceLastExport(dataOf(real({ saving: false })));
    expect(off.savedHistory).toBe(false);
    expect(off.result.comparable).toBe(false);
    expect(off.result.notes.map((n) => n.code)).toContain("no-previous-export");
  });

  it("never compares an export with its own snapshot", async () => {
    const state = real();
    const own = (await import("@snappy-export/core")).snapshotFromExport(state.real.latest as ParsedExport, { takenAt: CURRENT_AT });
    const alone = computeSinceLastExport(dataOf({ ...state, real: { ...state.real, ledger: ledgerOf(own) } }));
    expect(alone.result.comparable).toBe(false);
    const withEarlier = computeSinceLastExport(dataOf({ ...state, real: { ...state.real, ledger: ledgerOf(snapshot("p", PREVIOUS_AT, ["a"]), own) } }));
    expect(withEarlier.result.previousAt).toBe(PREVIOUS_AT);
  });

  it("withholds activity and Memories, and says so by code, when the saved export is newer", () => {
    const { result } = computeSinceLastExport(dataOf(real({ ledger: ledgerOf(snapshot("p", at(2026, 5, 20), ["a", "b"])) })));
    expect(result.comparable).toBe(true);
    expect(result.notes.map((n) => n.code)).toContain("order-swapped");
    expect(result.activity).toBeNull();
    expect(result.memories).toBeNull();
    expect(result.counts.newMemories).toBeNull();
    expect(result.friends).not.toBeNull();
    expect(result.notes.map((n) => n.code)).not.toContain("no-activity-data");
  });

  it("uses the time of this session when the export has no date, and says so", () => {
    const r = computeSinceLastExport(dataOf(real({ exportedAt: "none" })));
    expect(r.dateGuessed).toBe(true);
    expect(r.result.currentAt).toBe(NOW);
    expect(computeSinceLastExport(dataOf(real())).dateGuessed).toBe(false);
  });

  it("copes with no chats and no Memories: friends and requests still show, with a note for each", () => {
    const { result } = computeSinceLastExport(dataOf(real({ chats: [], memories: [] })));
    expect(result.activity).toBeNull();
    expect(result.memories).toBeNull();
    expect(result.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["no-activity-data", "no-memories-data"]));
    expect(result.friends?.added).toHaveLength(1);
  });

  it("notes an export with errors, and passes on nothing else from the issues", () => {
    expect(computeSinceLastExport(dataOf(real({ issues: [{ severity: "error", code: "x", message: `${CANARY} message` }] }))).exportHasErrors).toBe(true);
    expect(computeSinceLastExport(dataOf(real({ issues: [{ severity: "warning", code: "x", message: "m" }] }))).exportHasErrors).toBe(false);
  });

  it("is quick on a large export", () => {
    const friends = Array.from({ length: 10_000 }, (_, i) => friend(`f${i}`, at(2025, 1)));
    const chats = Array.from({ length: 50_000 }, (_, i) => chat(i % 3 === 0 ? "sent" : "received", CURRENT_AT - (i % 120) * DAY));
    const previous = snapshot("p", PREVIOUS_AT, Array.from({ length: 9_000 }, (_, i) => `f${i}`));
    const started = Date.now();
    const { result } = computeSinceLastExport(dataOf(real({ friends, chats, ledger: ledgerOf(previous) })));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.friends?.added).toHaveLength(1000);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeSinceLastExport(dataOf(emptyState()))).toThrow();
  });
});

describe("the CSV", () => {
  it("has one row per person in every list, in the order the page shows them, with the change and the date", () => {
    const { result } = computeSinceLastExport(dataOf(real()));
    expect(csvRows(result)).toEqual([
      [name("d"), "added", "2026-04-10"],
      [name("a"), "no-longer-listed", ""],
      [name("r2"), "request-pending", "2026-01-10"],
      [name("r1"), "request-no-longer-listed", ""],
    ]);
    expect(csvFileName(result)).toBe("snappy-since-last-export-2026-05-01.csv");
  });

  it("is named without a date when none is known, and has no rows when nothing was compared", () => {
    const { result } = computeSinceLastExport(dataOf(real({ saving: false })));
    expect(csvRows(result)).toEqual([]);
    expect(csvFileName({ ...result, currentAt: null })).toBe("snappy-since-last-export.csv");
  });
});

describe("the page", () => {
  it("shows the facts, the people, the Memories, the activity, the notes, the download and the command for the sample", async () => {
    const { root } = await renderSettled(view, sample);
    expect(titles(root)).toEqual([copy.glanceHeading, copy.friendsHeading, copy.memoriesHeading, copy.activityHeading, tools.notesHeading, tools.downloadHeading, tools.commandHeading]);
    expect(text(root, ".fact dt")).toEqual([copy.factDaysHeader, copy.factFriendsHeader, copy.factAddedHeader, copy.factLeftHeader, copy.factAcceptedHeader, copy.factMemoriesHeader]);
    expect(root.querySelectorAll(".subheading").length).toBeGreaterThan(1);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.since));
    expect(root.querySelectorAll("button").filter((b) => b.textContent === copy.downloadLabel)).toHaveLength(1);
    expect(root.querySelectorAll("table").length).toBeGreaterThan(2);
  });

  it("says what each cell holds, so a stacked card on a phone still reads", async () => {
    const { root } = await renderSettled(view, real());
    const tables = root.querySelectorAll("table");
    const people = tables.filter((t) => t.querySelector("caption")?.textContent !== copy.activityCaption);
    expect(people.map((t) => t.querySelector("caption")?.textContent)).toEqual([copy.addedCaption, copy.leftCaption, copy.pendingCaption, copy.vanishedCaption]);
    const rowOf = (t: FakeElement): string[] => text(t.querySelector("tbody tr") as FakeElement, "td");
    expect(people.map(rowOf)).toEqual([[copy.friendsSinceCell("Apr 10, 2026")], [copy.noDateCell], [copy.sentOnCell("Jan 10, 2026")], [copy.noDateCell]]);
    const activity = tables.find((t) => t.querySelector("caption")?.textContent === copy.activityCaption) as FakeElement;
    expect(text(activity, "thead th")).toEqual([copy.periodHeader, copy.sentHeader, copy.receivedHeader, copy.unknownHeader]);
    expect(text(activity, "tbody th")).toEqual([copy.sinceRow, copy.earlierRow]);
    expect(text(activity.querySelectorAll("tbody tr")[0] as FakeElement, "td")).toEqual([copy.sentCell(3), copy.receivedCell(2), copy.unknownCell(1)]);
    expect(root.textContent).toContain(copy.changeLine(2, 2));
    expect(root.textContent).toContain(copy.memoriesLine(4, 2));
    expect(root.textContent).toContain(copy.compareLine("Mar 1, 2026", "May 1, 2026", 61));
  });

  it("names people only in the result tables, as safe username text", async () => {
    const { root } = await renderSettled(view, real());
    const named = root.descendants().filter((el) => el.childNodes.some((c) => "data" in c && (c as unknown as { data: string }).data.includes(CANARY)));
    expect(named.length).toBeGreaterThan(0);
    for (const el of named) {
      expect(el.classList.contains("username"), el.tagName).toBe(true);
      expect(el.parentNode && (el.parentNode as FakeElement).tagName).toBe("th");
    }
  });

  it("shows only the first 25 of a long list and says how many were left out", async () => {
    const friends = Array.from({ length: 30 }, (_, i) => friend(`n${String(i).padStart(2, "0")}`, at(2026, 4)));
    const { root } = await renderSettled(view, real({ friends }));
    const added = root.querySelectorAll("table").find((t) => t.querySelector("caption")?.textContent === copy.addedCaption) as FakeElement;
    expect(added.querySelectorAll("tbody tr")).toHaveLength(25);
    expect(text(root, ".caption")).toContain(copy.moreLine(5));
  });

  it("says nothing changed when the two lists match", async () => {
    const friends = [friend("a"), friend("b"), friend("c")];
    const { root } = await renderSettled(view, real({ friends, sentRequests: [], ledger: ledgerOf(snapshot("p", PREVIOUS_AT, ["a", "b", "c"])) }));
    expect(text(root, "p")).toContain(copy.noChangeLine);
    expect(root.querySelectorAll(".subheading")).toHaveLength(0);
  });

  it("leaves out Memories and activity, and says why, when the saved export is newer", async () => {
    const { root } = await renderSettled(view, real({ ledger: ledgerOf(snapshot("p", at(2026, 5, 20), ["a", "b"])) }));
    expect(titles(root)).not.toContain(copy.memoriesHeading);
    expect(titles(root)).not.toContain(copy.activityHeading);
    expect(text(root, ".fact dt")).not.toContain(copy.factMemoriesHeader);
    expect(text(root, ".tool-notes li")).toContain(copy.orderNote);
    expect(root.querySelectorAll(".tool-note-warning").length).toBeGreaterThan(0);
  });

  it("shows no earlier period when the chats do not reach back, and notes it", async () => {
    const chats = [chat("sent", CURRENT_AT - DAY), chat("received", CURRENT_AT - 2 * DAY)];
    const { root } = await renderSettled(view, real({ chats }));
    const activity = root.querySelectorAll("table").find((t) => t.querySelector("caption")?.textContent === copy.activityCaption) as FakeElement;
    expect(text(activity, "tbody th")).toEqual([copy.sinceRow]);
    expect(text(root, ".tool-notes li")).toContain(copy.notCoveredNote);
    expect(root.textContent).not.toContain(copy.earlierLine);
  });

  it("writes each note as a short hedged sentence that shows no code and no name", async () => {
    const { root } = await renderSettled(view, real({ exportedAt: "none", issues: [{ severity: "error", code: "x", message: "m" }] }));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.exportErrorsNote, copy.dateGuessedNote, copy.leftNote(1), copy.declinedNote(1), copy.badMemoryDatesNote(1)]));
    for (const n of notes) {
      expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
      expect(n).not.toContain(CANARY);
    }
    expect(notes.join(" ")).toMatch(/may/);
    expect(root.querySelectorAll(".tool-note-warning").length).toBeGreaterThan(0);
    expect(root.querySelectorAll(".tool-note-info").length).toBeGreaterThan(0);
  });

  it("announces the counts politely once, and without a name", async () => {
    await renderSettled(view, real());
    expect(said).toEqual([copy.doneAnnounce(1, 1)]);
    expect(said.join(" ")).not.toContain(CANARY);
  });

  it("builds the CSV only on the press, with every cell neutralized, and says the file is saved", async () => {
    const friends = [friend("b"), { username: "=cmd|zqcanary_f" }, { username: `${CANARY}_‮g` }];
    const { root } = await renderSettled(view, real({ friends }));
    expect(saved).toHaveLength(0);
    said.length = 0;
    (root.querySelectorAll("button").find((b) => b.textContent === copy.downloadLabel) as FakeElement).click();
    expect(saved).toHaveLength(1);
    const file = saved[0]!;
    expect(file.fileName).toBe("snappy-since-last-export-2026-05-01.csv");
    expect(file.mime).toBe("text/csv");
    expect(file.text.startsWith("﻿\"username\",\"change\",\"date\"\r\n")).toBe(true);
    expect(file.text).toContain(`"'=cmd|zqcanary_f","added",""`);
    expect(file.text).toContain(`"${CANARY}_?g","added",""`);
    expect(file.text).not.toContain("‮");
    expect(said).toEqual([tools.downloadSaved]);
  });
});

describe("when nothing can be compared", () => {
  it("shows the honest empty state and no download when saving is off, and still offers the command", async () => {
    const { root } = await renderSettled(view, real({ saving: false }));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelectorAll("button").filter((b) => b.textContent === copy.downloadLabel)).toHaveLength(0);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.since));
    expect(said).toEqual([copy.emptyAnnounce]);
  });

  it("shows it too when the saved history holds only this export", async () => {
    const { root } = await renderSettled(view, real({ ledger: ledgerOf() }));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
  });
});

describe("without an export", () => {
  it("says so plainly, offers Add export and still offers the command", () => {
    const { root } = render(view, emptyState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.since));
    expect(root.querySelector(".tool-result")).toBeNull();
  });

  it("says saved history is not an export", () => {
    expect(text(render(view, stateWith({ ledger: base.ledger })).root, ".empty-body")).toEqual([tools.needs.exportLedgerBody]);
  });

  it("says a friends list is missing when the export has none", () => {
    expect(text(render(view, real({ friends: [] })).root, ".empty-title")).toEqual([tools.needs.friendsTitle]);
  });
});

describe("the privacy rules", () => {
  it("shows a username only in a result table: not in a note, the announcement, a label or a title", async () => {
    const { root } = await renderSettled(view, real({ issues: [{ severity: "error", code: "x", message: `${CANARY} message` }] }));
    for (const el of root.descendants()) {
      for (const attr of ["aria-label", "title", "alt"]) expect(el.getAttribute(attr) ?? "").not.toContain(CANARY);
    }
    for (const selector of [".tool-notes", ".lead", ".tool-reads", ".section-title", ".subheading", ".caption", ".fact", ".empty"]) {
      expect(text(root, selector).join(" "), selector).not.toContain(CANARY);
    }
    expect(said.join(" ")).not.toContain(CANARY);
  });

  it("shows none of the sample's usernames outside its tables", async () => {
    const names = [...new Set((base.latest as ParsedExport).friends.friends.map((f) => f.username))].filter((n) => n.length >= 5);
    const { root } = await renderSettled(view, sample);
    const outside = [".tool-notes", ".lead", ".section-title", ".subheading", ".caption", ".fact"].flatMap((s) => text(root, s)).join(" ");
    for (const n of names) expect(outside, n).not.toContain(n);
    expect(said.join(" ")).not.toMatch(/\balice\b/i);
  });
});
