/**
 * Who reaches out first: what it computes from the chats the page holds, and what its page shows. Synthetic data only.
 * The people in the tables are made-up friends; their usernames are canaries that may appear in the two result tables
 * and nowhere else (not in a note, an announcement, a label or a document title).
 */
import type { ChatEvent, FriendRecord, ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/reach-out-first/copy.ts";
import { descriptor } from "../../src/tools/reach-out-first/index.ts";
import { computeReachOutFirst, DEFAULT_PARAMS, GAP_CHOICES } from "../../src/tools/reach-out-first/model.ts";
import { view } from "../../src/tools/reach-out-first/view.ts";
import { RULES, collectCopy, lint } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 6, 12);
let base: Workspace;
let sample: State;
let names: string[];
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
  names = (base.latest as ParsedExport).friends.friends.map((f) => f.username).filter((n) => n.length >= 5);
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
});

const ev = (conversation: string, direction: ChatEvent["direction"], hoursAgo: number): ChatEvent => ({ conversation, isGroup: false, direction, kind: "TEXT", at: NOW - hoursAgo * HOUR });

/** `count` exchanges one day apart, each opened by `opener` and answered an hour later. */
function exchanges(who: string, opener: "sent" | "received", count: number, from = 1): ChatEvent[] {
  const reply = opener === "sent" ? "received" : "sent";
  return Array.from({ length: count }, (_, i) => [ev(who, opener, (from + i) * 24), ev(who, reply, (from + i) * 24 - 1)]).flat();
}

/** A real (not sample) export made from the sample's, with crafted chats and, where given, crafted friends. */
function real(chats: ChatEvent[], friends?: readonly string[]): State {
  const parsed = base.latest as ParsedExport;
  const first = parsed.friends.friends[0] as FriendRecord;
  const list = friends ? friends.map((username) => ({ ...first, username })) : parsed.friends.friends;
  const latest: ParsedExport = { ...parsed, chats, exportedAt: NOW, friends: { ...parsed.friends, friends: list } };
  return stateWith({ latest, now: NOW, issues: [], parts: 1 });
}

/**
 * Four friends in four situations: one who starts six exchanges, one you start six, one with three exchanges (too few to
 * judge) and one where you each start three. Totals: 4 chats, 21 exchanges, you 12 and they 9.
 */
function crafted(): { state: State; who: [string, string, string, string] } {
  const who = names.slice(0, 4) as [string, string, string, string];
  const [a, b, c, d] = who;
  const chats: ChatEvent[] = [
    ...exchanges(a, "received", 6),
    ...exchanges(b, "sent", 6),
    ...exchanges(c, "sent", 3),
    ...exchanges(d, "sent", 3),
    ...exchanges(d, "received", 3, 4),
    { conversation: "group:abc", isGroup: true, direction: "sent", kind: "TEXT", at: NOW - DAY },
    { conversation: "group:abc", isGroup: true, direction: "received", kind: "TEXT", at: NOW - 2 * DAY },
  ];
  return { state: real(chats), who };
}

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const tableNames = (el: FakeElement): string[] => text(el, "tbody th code.username");
const cellsOf = (table: FakeElement): string[][] => table.querySelectorAll("tbody tr").map((tr) => [tr.querySelector("th")?.textContent ?? "", ...text(tr, "td")]);

describe("the tool", () => {
  it("is a Chats tool in the quiet color that needs chats and shows the reach-out command", () => {
    expect(descriptor).toMatchObject({ id: "reach-out-first", title: "Who reaches out first", group: "chats", category: "quiet", needs: ["chats"] });
    expect(descriptor.oneLiner).toBe(copy.oneLiner);
    expect(descriptor.oneLiner.length).toBeLessThanOrEqual(56);
    expect(COMMANDS["reach-out"].argv[0]).toBe("reach-out");
  });

  it("passes the copy lint on its own words", () => {
    const entries = collectCopy({ reachOutFirst: copy });
    expect(entries.length).toBeGreaterThan(20);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });
});

describe("computeReachOutFirst", () => {
  it("counts who starts the exchanges, as core does", () => {
    const { state, who } = crafted();
    const report = computeReachOutFirst(toolData(state));
    expect(report.mostlyThem.map((p) => [p.username, p.byThem, p.byYou])).toEqual([[who[0], 6, 0]]);
    expect(report.mostlyYou.map((p) => [p.username, p.byYou, p.byThem])).toEqual([[who[1], 6, 0]]);
    expect(report.overall).toEqual({ exchanges: 21, byYou: 12, byThem: 9, unknown: 0, youShare: 0.57 });
    expect(report.summary).toEqual({ people: 4, mostlyThem: 1, mostlyYou: 1 });
    expect(report.settings).toEqual({ gapHours: 6, minExchanges: 5, mostlyShare: 0.7 });
    expect(report.asOf).toBe(NOW);
    expect(report.notes.map((n) => n.code)).toEqual(["group-events-skipped", "people-too-few-exchanges"]);
    expect(DEFAULT_PARAMS.gapHours).toBe(6);
    expect(GAP_CHOICES).toContain(DEFAULT_PARAMS.gapHours);
  });

  it("merges exchanges that are closer than the chosen gap", () => {
    const { state, who } = crafted();
    const wide = computeReachOutFirst(toolData(state), { gapHours: 24 });
    expect(wide.settings.gapHours).toBe(24);
    expect(wide.people.find((p) => p.username === who[0])).toMatchObject({ exchanges: 1, byThem: 1 });
    expect(wide.mostlyThem).toEqual([]);
    const narrow = computeReachOutFirst(toolData(state), { gapHours: 3 });
    expect(narrow.mostlyThem.map((p) => p.username)).toEqual([who[0]]);
  });

  it("leaves out people who are not friends, and counts them", () => {
    const [a, b] = names as [string, string];
    const state = real([...exchanges(a, "received", 6), ...exchanges(b, "received", 6)], [b]);
    const report = computeReachOutFirst(toolData(state));
    expect(report.people.map((p) => p.username)).toEqual([b]);
    expect(report.notes.find((n) => n.code === "people-not-in-friends")?.params.count).toBe(1);
  });

  it("measures up to the export's date, so later events are left out", () => {
    const a = names[0] as string;
    const parsed = base.latest as ParsedExport;
    const latest: ParsedExport = { ...parsed, chats: [...exchanges(a, "received", 6, 3), ev(a, "sent", 1)], exportedAt: NOW - 2 * DAY };
    const report = computeReachOutFirst(toolData(stateWith({ latest, now: NOW, issues: [], parts: 1 })));
    expect(report.asOf).toBe(NOW - 2 * DAY);
    expect(report.notes.find((n) => n.code === "events-in-future")?.params.count).toBe(1);
  });

  it("holds no message text: the report keeps only names, counts and codes", () => {
    const { state } = crafted();
    expect(JSON.stringify(computeReachOutFirst(toolData(state)))).not.toMatch(/TEXT|kind|group:abc/);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeReachOutFirst(toolData(emptyState()))).toThrow();
  });
});

describe("the page", () => {
  it("shows the counts, the share, a table for each side and the command", async () => {
    const { state, who } = crafted();
    const { root } = await renderSettled(view, state);
    expect(text(root, ".section-title")).toEqual([copy.glanceHeading, copy.themHeading, copy.youHeading, tools.notesHeading, tools.commandHeading]);
    expect(text(root, ".fact dd")).toEqual(["4", "21", "12", "9"]);
    expect(text(root, ".fact dt")).toEqual([copy.chatsLabel, copy.exchangesLabel, copy.youLabel, copy.themLabel]);
    expect(root.textContent).toContain(copy.shareLine("57%", "43%"));
    expect(root.textContent).toContain(copy.methodLine("Nov 6, 2026", 6));
    const tables = root.querySelectorAll("table");
    expect(tables.map(tableNames)).toEqual([[who[0]], [who[1]]]);
    expect(cellsOf(tables[0] as FakeElement)).toEqual([[who[0], "0 exchanges", "6 exchanges", "100% of exchanges"]]);
    expect(cellsOf(tables[1] as FakeElement)).toEqual([[who[1], "6 exchanges", "0 exchanges", "100% of exchanges"]]);
    expect(text(tables[0] as FakeElement, "thead th")).toEqual([copy.friendHeader, copy.youStartedHeader, copy.theyStartedHeader, copy.shareHeader]);
    expect(root.textContent).toContain(copy.themRuleLine(5, 70));
    expect(root.textContent).toContain(copy.youRuleLine(5, 70));
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["reach-out"]));
    expect(root.querySelector("button.btn-secondary[data-key='tool-download']")).toBeNull();
  });

  it("offers four gaps with six hours pressed, and recomputes when one is chosen", async () => {
    const { state, who } = crafted();
    const { root } = await renderSettled(view, state);
    const buttons = root.querySelectorAll(".segmented button");
    expect(buttons.map((b) => b.textContent)).toEqual(GAP_CHOICES.map(String));
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false"]);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(GAP_CHOICES.map(copy.unitGap));

    (buttons[3] as FakeElement).click();
    await settled(root);
    expect(root.querySelectorAll(".segmented button").map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true"]);
    expect(root.textContent).toContain(copy.methodLine("Nov 6, 2026", 24));
    // A day-long gap joins each friend's exchanges into one, so neither side has five.
    expect(text(root, ".tool-result p")).toEqual(expect.arrayContaining([copy.themNoneLine, copy.youNoneLine]));
    expect(root.querySelectorAll("table")).toHaveLength(0);

    (root.querySelectorAll(".segmented button")[0] as FakeElement).click();
    await settled(root);
    expect(root.textContent).toContain(copy.methodLine("Nov 6, 2026", 3));
    expect(root.querySelectorAll("table").map(tableNames)).toEqual([[who[0]], [who[1]]]);
  });

  it("says in a line when one side has no chats, rather than leaving a heading with nothing", async () => {
    const a = names[0] as string;
    const { root } = await renderSettled(view, real(exchanges(a, "received", 6)));
    expect(text(root, ".tool-result p")).toContain(copy.youNoneLine);
    expect(root.textContent).not.toContain(copy.themNoneLine);
    expect(root.querySelectorAll("table")).toHaveLength(1);
  });

  it("shows the strongest fifty and says how many it left out", async () => {
    const people = Array.from({ length: 55 }, (_, i) => `zq.person.${String(i).padStart(2, "0")}`);
    const { root } = await renderSettled(view, real(people.flatMap((p) => exchanges(p, "sent", 5)), people));
    expect(root.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(text(root, ".caption")).toContain(copy.moreLine(5));
  });

  it("writes each note as a short hedged sentence, from counts alone", async () => {
    const { state } = crafted();
    const { root } = await renderSettled(view, state);
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual([copy.hintNote, copy.groupNote(2), copy.tooFewNote(1)]);
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
  });

  it("shows each kind of note with its count", async () => {
    const [a, b, c] = names as [string, string, string];
    const events: ChatEvent[] = [
      ev(a, "unknown", 50),
      { ...ev(b, "sent", 40), at: Number.NaN },
      ev(c, "sent", -30),
      ev("", "sent", 20),
      ev("someone.outside.the.list", "received", 50),
      ev(a, "sent", 100),
      ev(c, "sent", 200),
      ev(c, "received", 200),
      ...exchanges(b, "sent", 1),
    ];
    const { root } = await renderSettled(view, real(events, [a, b, c]));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(
      expect.arrayContaining([copy.noTimeNote(1), copy.futureNote(1), copy.noPersonNote(1), copy.notFriendsNote(1), copy.starterUnknownNote(1), copy.starterTiedNote(1), copy.tooFewNote(3)]),
    );
  });

  it("announces the counts politely once, and without a name", async () => {
    const { state } = crafted();
    await renderSettled(view, state);
    expect(said).toEqual(["Reach-out checked. They mostly reach out first in 1 chat, and you in 1 chat."]);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
    for (const name of names) expect(said[0], name).not.toContain(name);
  });
});

describe("when no exchange has a known starter", () => {
  it("shows the honest empty state with its notes, instead of empty tables", async () => {
    const a = names[0] as string;
    const { root } = await renderSettled(view, real([ev(a, "unknown", 50), ev(a, "unknown", 10)]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(text(root, ".tool-notes li")).toEqual([copy.hintNote, copy.starterUnknownNote(2), copy.tooFewNote(1)]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["reach-out"]));
    expect(said).toEqual([copy.emptyAnnounce]);
  });

  it("says so for chats that are all group chats too", async () => {
    const group: ChatEvent = { conversation: "group:abc", isGroup: true, direction: "received", kind: "TEXT", at: NOW - 5 * DAY };
    const { root } = await renderSettled(view, real([group]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".tool-notes li")).toEqual([copy.hintNote, copy.noOneToOneNote, copy.groupNote(1)]);
  });
});

describe("without chats", () => {
  it("says plainly that an export is needed, and offers the next step", async () => {
    const { root } = render(view, emptyState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".tool-result")).toBeNull();
    await settled(root);
  });

  it("names the chats when the export has friends but no chat history", async () => {
    const { root } = await renderSettled(view, real([]));
    expect(text(root, ".empty-title")).toEqual([tools.needs.chatsTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/tools/export-check");
  });
});

describe("privacy", () => {
  it("shows a username only in the two result tables, and in no note, announcement, label, title or heading", async () => {
    const { state } = crafted();
    const { root } = await renderSettled(view, state);
    const shown = new Set(tableNames(root));
    expect(shown.size).toBe(2);
    for (const el of root.descendants()) {
      const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
      const labels = ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? "").join(" ");
      for (const name of shown) {
        expect(labels, name).not.toContain(name);
        if (own.includes(name)) expect(el.tagName === "code" && el.classList.contains("username") && inTable(el), `${el.tagName}.${el.className}`).toBe(true);
      }
    }
    for (const name of shown) {
      expect(said.join(" "), name).not.toContain(name);
      expect(text(root, ".tool-notes li, .notice, h1, h2, h3, .lead, .tool-reads, .empty-body, .caption, caption").join(" "), name).not.toContain(name);
    }
    expect(root.querySelector("title")).toBeNull();
  });

  it("shows no username for the sample outside its tables, and holds no link or message text", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.textContent).not.toMatch(/https?:|\.(jpg|mp4|png)\b/i);
    for (const name of names) {
      for (const el of root.descendants()) {
        const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
        if (own.includes(name)) expect(inTable(el), name).toBe(true);
      }
    }
  });

  it("shows an unusual username as plain text, with invisible characters made visible", async () => {
    const odd = "zq‮evil<b>x</b>";
    const { root } = await renderSettled(view, real(exchanges(odd, "received", 6), [odd]));
    expect(tableNames(root)[0]).toBe("zq?evil<b>x</b>");
    expect(root.querySelectorAll("b")).toHaveLength(0);
  });
});

function inTable(el: FakeElement): boolean {
  for (let n: { parentNode: unknown } | null = el; n; n = n.parentNode as typeof n) {
    if ((n as FakeElement).tagName === "table") return true;
  }
  return false;
}
