/**
 * Friendship anniversaries: what it computes from the friends list the page holds, and what its page shows.
 * Synthetic data only. Usernames carry canaries that must never reach a note, an announcement or a title.
 */
import type { FriendRecord, ParsedExport } from "@snappy-export/core";
import { insights } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/anniversaries/copy.ts";
import { descriptor } from "../../src/tools/anniversaries/index.ts";
import { computeAnniversaries } from "../../src/tools/anniversaries/model.ts";
import { view } from "../../src/tools/anniversaries/view.ts";
import type { FakeElement } from "../fake-dom.ts";
import { RULES, collectCopy, hasClass, ancestors, lint, sentences, words } from "../copy-rules.ts";
import { render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
const saved: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));
vi.mock("../../src/download.ts", () => ({
  saveTextFile: (fileName: string) => {
    saved.push(fileName);
    return true;
  },
  saveBlob: () => true,
}));

let base: Workspace;
let sample: State;
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});

/** A creation date that makes the friendship reach `years` whole years `inDays` days after the sample's today. */
function created(years: number, inDays: number): number {
  const t = new Date(base.now);
  return Date.UTC(t.getUTCFullYear() - years, t.getUTCMonth(), t.getUTCDate() + inDays, 12);
}

/** Made-up friends; the names carry a canary so a leak into a note or a title would show. */
const friends = (): FriendRecord[] => [
  { username: "zqcanary_soon", createdAt: created(3, 5) },
  { username: "zqcanary_later", createdAt: created(4, 10) },
  { username: "zqcanary_far", createdAt: created(1, 60) },
  { username: "zqcanary_undated" },
  { username: "zqcanary_future", createdAt: base.now + 86_400_000 },
];

/** A real (not sample) export made from the sample's, with these friends in place of its own. */
function real(list: FriendRecord[], extra: Partial<ParsedExport> = {}, ws: Partial<Workspace> = {}): State {
  const parsed = base.latest as ParsedExport;
  const latest: ParsedExport = { ...parsed, ...extra, friends: { ...parsed.friends, friends: list } };
  return stateWith({ latest, now: base.now, issues: [], parts: 1, ...ws });
}
const dataOf = (state: State) => toolData(state);
const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
/** The usernames in the table, one per row (they are cells; the date names the row). */
const names = (root: FakeElement): string[] => root.querySelectorAll("tbody tr").map((tr) => text(tr, "td")[0] ?? "");
const params = (windowDays = 30, milestonesOnly = false) => ({ windowDays, milestonesOnly });

describe("the tool", () => {
  it("is a Friends tool in the requests color that needs a friends list and shows the anniversaries command", () => {
    expect(descriptor).toMatchObject({ id: "anniversaries", title: "Friendship anniversaries", group: "friends", category: "requests", needs: ["friends"] });
    expect(descriptor.oneLiner.length).toBeLessThanOrEqual(56);
    expect(COMMANDS.anniversaries.argv[0]).toBe("anniversaries");
  });

  it("has copy that passes the copy lint, with no username-taking function", () => {
    const entries = collectCopy({ tool_anniversaries: copy });
    expect(entries.length).toBeGreaterThan(10);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
    expect(words(copy.description).length).toBeLessThanOrEqual(25);
    expect(sentences(copy.reads)).toHaveLength(1);
    // Every copy function takes counts, never a name.
    for (const value of Object.values(copy)) if (typeof value === "function") expect(value.length, String(value)).toBeLessThanOrEqual(2);
  });
});

describe("computeAnniversaries", () => {
  it("finds what core finds for the friends list: soonest first, with the milestone marked", () => {
    const r = computeAnniversaries(dataOf(real(friends())), params(30));
    expect(r.rows.map((x) => [x.username, x.years, x.daysUntil, x.milestone])).toEqual([
      ["zqcanary_soon", 3, 5, true],
      ["zqcanary_later", 4, 10, false],
    ]);
    expect(r).toMatchObject({ upcoming: 2, milestones: 1, dated: 3, windowDays: 30, milestonesOnly: false, leapShifted: false });
    const core = insights.anniversaries.findAnniversaries(friends(), { now: base.now, windowDays: 30 });
    expect(r.rows).toEqual(core.upcoming);
    expect(r.notes.map((n) => n.code)).toEqual(core.notes.map((n) => n.code));
  });

  it("answers to the window: the edge day counts, and a longer window adds the later friendship", () => {
    const at = (days: number) => computeAnniversaries(dataOf(real(friends())), params(days)).rows.map((x) => x.username);
    expect(at(4)).toEqual([]);
    expect(at(5)).toEqual(["zqcanary_soon"]);
    expect(at(30)).toEqual(["zqcanary_soon", "zqcanary_later"]);
    expect(at(90)).toEqual(["zqcanary_soon", "zqcanary_later", "zqcanary_far"]);
  });

  it("shows only the milestones when asked, and still counts the others", () => {
    const r = computeAnniversaries(dataOf(real(friends())), params(90, true));
    expect(r.rows.map((x) => x.username)).toEqual(["zqcanary_soon", "zqcanary_far"]);
    expect(r.rows.every((x) => x.milestone)).toBe(true);
    expect(r.upcoming).toBe(3);
    expect(r.milestones).toBe(2);
  });

  it("finds nothing for no friends, and for friends with no usable date", () => {
    expect(computeAnniversaries(dataOf(real([])), params())).toMatchObject({ rows: [], upcoming: 0, dated: 0, notes: [] });
    const undated = computeAnniversaries(dataOf(real([{ username: "zqcanary_a" }, { username: "zqcanary_b" }])), params());
    expect(undated.rows).toEqual([]);
    expect(undated.notes).toEqual([{ code: "created-at-missing", params: { count: 2 } }]);
  });

  it("uses current friends only: a request or a deleted friend with a matching date is never listed", () => {
    const parsed = base.latest as ParsedExport;
    const trap: FriendRecord = { username: "zqcanary_trap", createdAt: created(2, 3) };
    const r = computeAnniversaries(dataOf(real([], { friends: { ...parsed.friends, friends: [], sentRequests: [trap], deletedFriends: [{ ...trap, deletedAt: base.now }], blocked: [trap] } })), params());
    expect(r.rows).toEqual([]);
  });

  it("merges repeats that differ by case, skips empty names, and reports both by count", () => {
    const r = computeAnniversaries(dataOf(real([{ username: "ZQCanary_Soon", createdAt: created(3, 5) }, ...friends(), { username: "  " }])), params());
    expect(r.rows.map((x) => x.username)).toEqual(["zqcanary_soon", "zqcanary_later"]);
    expect(r.notes.map((n) => n.code)).toEqual(expect.arrayContaining(["duplicate-usernames", "invalid-username", "created-at-missing", "created-at-future"]));
  });

  it("flags a Feb 29 friendship that is shown on Feb 28", () => {
    // 2024-02-29 reaches its second year on 2026-02-28 (2026 has no Feb 29); the sample's today is set to the week before.
    const now = Date.UTC(2026, 1, 25, 12);
    const state = real([{ username: "zqcanary_leap", createdAt: Date.UTC(2024, 1, 29, 12) }], {}, { now });
    const r = computeAnniversaries(dataOf(state), params(7));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ years: 2, on: "2026-02-28", leapDayShifted: true });
    expect(r.leapShifted).toBe(true);
  });

  it("holds no username in its notes, and refuses to run without an export", () => {
    const r = computeAnniversaries(dataOf(real([...friends(), { username: "zqcanary_soon", createdAt: 1 }])), params(90));
    expect(JSON.stringify(r.notes)).not.toContain("zqcanary");
    expect(() => computeAnniversaries(dataOf(initialState()))).toThrow();
  });

  it("reads time from the data, never a clock", () => {
    const later = computeAnniversaries(dataOf(real(friends(), {}, { now: base.now + 6 * 86_400_000 })), params(30));
    expect(later.rows[0]).toMatchObject({ username: "zqcanary_later", daysUntil: 4 });
  });
});

describe("the page", () => {
  it("shows the counts, the result table with its caption and headers, and the command", async () => {
    const { root } = await renderSettled(view, real(friends()));
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toEqual([copy.glanceHeading, copy.upcomingHeading, tools.notesHeading, tools.commandHeading]);
    const facts = root.querySelectorAll(".fact");
    expect(facts.map((f) => [f.querySelector("dt")?.textContent, f.querySelector("dd")?.textContent])).toEqual([
      [copy.upcomingFact, "2"],
      [copy.milestoneFact, "1"],
      [copy.datedFact, "3"],
    ]);
    const table = root.querySelector("table") as FakeElement;
    expect(table.querySelector("caption")?.textContent).toBe(copy.upcomingCaption);
    expect(text(table, "thead th")).toEqual([copy.dateHeader, copy.friendHeader, copy.reachesHeader, copy.whenHeader]);
    expect(text(table, "tbody th")).toEqual(["Nov 11, 2026", "Nov 16, 2026"]);
    const cells = table.querySelectorAll("tbody tr").map((tr) => text(tr, "td"));
    expect(cells[0]).toEqual(["zqcanary_soon", "3 years, milestone", "In 5 days"]);
    expect(cells[1]).toEqual(["zqcanary_later", "4 years", "In 10 days"]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.anniversaries));
  });

  it("says today and tomorrow in words", async () => {
    const two = [{ username: "zqcanary_a", createdAt: created(2, 0) }, { username: "zqcanary_b", createdAt: created(1, 1) }];
    const { root } = await renderSettled(view, real(two));
    expect(text(root, "tbody tr").length).toBe(2);
    expect(root.querySelectorAll("tbody tr").map((tr) => text(tr, "td")[2])).toEqual(["Today", "Tomorrow"]);
  });

  it("works with the built-in sample and announces once, politely, with no name", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelector(".tool-result")).not.toBeNull();
    expect(root.querySelector(".tool-failed")).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^(No anniversaries|\d+ anniversar(y|ies)) in the next 30 days\.$/);
  });

  it("announces the count and the window", async () => {
    await renderSettled(view, real(friends()));
    expect(said).toEqual([copy.foundAnnounce(2, 30)]);
    expect(copy.foundAnnounce(2, 30)).toBe("2 anniversaries in the next 30 days.");
    expect(copy.foundAnnounce(1, 366)).toBe("1 anniversary in the next year.");
    expect(copy.noneAnnounce(90)).toBe("No anniversaries in the next 90 days.");
  });

  it("writes each note as a short hedged sentence, with counts and no code", async () => {
    const { root } = await renderSettled(view, real(friends()));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual([copy.caveatNote, copy.missingNote(1), copy.futureNote(1)]);
    expect(notes.join(" ")).toMatch(/may not match/);
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
    expect(root.querySelectorAll(".tool-notes .tool-note-warning")).toHaveLength(2);
  });

  it("tells about the Feb 28 shift only when a row has one", async () => {
    const leap = real([{ username: "zqcanary_leap", createdAt: Date.UTC(2024, 1, 29, 12) }], {}, { now: Date.UTC(2026, 1, 25, 12) });
    expect(text((await renderSettled(view, leap)).root, ".tool-notes li")).toContain(copy.leapNote);
    expect(text((await renderSettled(view, real(friends()))).root, ".tool-notes li")).not.toContain(copy.leapNote);
  });

  it("trims a long list to the first rows and says so", async () => {
    const many: FriendRecord[] = Array.from({ length: 60 }, (_, i) => ({ username: `zqcanary_${String(i).padStart(2, "0")}`, createdAt: created(2, i % 20) }));
    const { root } = await renderSettled(view, real(many));
    expect(root.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(root.querySelector(".caption")?.textContent).toBe(copy.moreLine(50, 60));
    expect(root.querySelectorAll(".fact dd")[0]?.textContent).toBe("60");
  });

  it("offers no download, and builds no file", async () => {
    const { root } = await renderSettled(view, real(friends()));
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).not.toContain(tools.downloadHeading);
    expect(root.querySelectorAll("button").filter((b) => /download/i.test(b.textContent))).toHaveLength(0);
    expect(saved).toEqual([]);
  });
});

describe("the controls", () => {
  const control = (root: FakeElement) => ({ select: root.querySelector("select") as FakeElement, box: root.querySelector("input.check-input") as FakeElement });

  it("start at 30 days with all anniversaries, with a label for each control", async () => {
    const { root } = await renderSettled(view, real(friends()));
    const { select } = control(root);
    expect(text(select, "option")).toEqual(copy.windowOptions.map((o) => o.label));
    expect(select.getAttribute("id")).toBe("anniversaries-window");
    expect(root.querySelector("label[for=anniversaries-window]")?.textContent).toBe(copy.windowLabel);
    expect(root.querySelector(".check span")?.textContent).toBe(copy.milestonesLabel);
    expect(root.querySelector(".controls")?.getAttribute("aria-label")).toBe(copy.controlsLabel);
  });

  it("recompute for a longer window and repaint only the result, so the controls keep their place", async () => {
    const r = await renderSettled(view, real(friends()));
    const { select } = control(r.root);
    select.value = "90";
    select.fire("change");
    expect(r.root.querySelector(".tool-result")?.getAttribute("aria-busy")).toBe("true");
    await settled(r.root);
    expect(names(r.root)).toEqual(["zqcanary_soon", "zqcanary_later", "zqcanary_far"]);
    expect(control(r.root).select).toBe(select);
    expect(said.at(-1)).toBe(copy.foundAnnounce(3, 90));
  });

  it("recompute for milestones only", async () => {
    const r = await renderSettled(view, real(friends()));
    const { select, box } = control(r.root);
    select.value = "90";
    select.fire("change");
    await settled(r.root);
    box.checked = true;
    box.fire("change");
    await settled(r.root);
    expect(names(r.root)).toEqual(["zqcanary_soon", "zqcanary_far"]);
    expect(r.root.querySelectorAll(".fact dd")[0]?.textContent).toBe("3");
  });

  it("keep the controls when the result is empty, so the window can be widened", async () => {
    const r = await renderSettled(view, real([{ username: "zqcanary_far", createdAt: created(1, 60) }]));
    expect(r.root.querySelector(".empty-title")?.textContent).toBe(copy.empty.title);
    expect(control(r.root).select).not.toBeNull();
    const { select } = control(r.root);
    select.value = "90";
    select.fire("change");
    await settled(r.root);
    expect(r.root.querySelector(".empty")).toBeNull();
    expect(names(r.root)).toEqual(["zqcanary_far"]);
  });
});

describe("when nothing is coming up", () => {
  it("shows an honest empty state instead of a blank result, and still shows the command", async () => {
    const { root } = await renderSettled(view, real([{ username: "zqcanary_undated" }]));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelector("table")).toBeNull();
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.anniversaries));
    expect(said).toEqual([copy.noneAnnounce(30)]);
  });
});

describe("without what it needs", () => {
  it("asks for an export when nothing is loaded, and offers the command", () => {
    const { root } = render(view, initialState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.anniversaries));
    expect(root.querySelector(".tool-result")).toBeNull();
    expect(root.querySelector("select")).toBeNull();
  });

  it("names the missing friends list, and runs from saved history, which holds friends", async () => {
    const none = render(view, real([]));
    expect(text(none.root, ".empty-title")).toEqual([tools.needs.friendsTitle]);
    expect(none.root.querySelector(".tool-result")).toBeNull();
    const fromLedger = await renderSettled(view, stateWith({ ledger: base.ledger }));
    expect(fromLedger.root.querySelector(".tool-result")).not.toBeNull();
  });
});

describe("privacy", () => {
  it("shows a username only in the result table: never in a note, an announcement, a title or a label", async () => {
    const { root } = await renderSettled(view, real(friends()));
    const where = (el: FakeElement): string[] => [el.tagName, ...ancestors(el).map((a) => `${a.tagName}.${a.className}`)];
    let inTable = 0;
    for (const el of root.descendants()) {
      const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
      const labels = ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? "").join(" ");
      expect(labels, where(el).join(" ")).not.toContain("zqcanary");
      if (!own.includes("zqcanary")) continue;
      inTable++;
      expect(ancestors(el).some((a) => hasClass(a, "table-wrap")), `${el.tagName} is in a table`).toBe(true);
      expect(ancestors(el).some((a) => hasClass(a, "tool-notes") || hasClass(a, "notice") || hasClass(a, "empty") || hasClass(a, "lead"))).toBe(false);
    }
    expect(inTable).toBe(2);
    expect(root.querySelector("h1")?.textContent).toBe(copy.title);
    for (const line of said) expect(line).not.toContain("zqcanary");
  });

  it("shows no username in the empty state or the notes of the sample", async () => {
    const parsed = base.latest as ParsedExport;
    const names = [...new Set(parsed.friends.friends.map((f) => f.username))].filter((n) => n.length >= 5);
    const { root } = await renderSettled(view, sample);
    const outsideTable = root.descendants().filter((el) => !ancestors(el).some((a) => hasClass(a, "table-wrap")) && !hasClass(el, "table-wrap"));
    const page = outsideTable.flatMap((el) => el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data)).join(" ");
    for (const name of names) expect(page, name).not.toContain(name);
    for (const line of said) for (const name of names) expect(line, name).not.toContain(name);
  });

  it("writes a hostile username as text, with invisible and direction-changing characters hidden", async () => {
    const hostile = "<img src=x onerror=alert(1)>‮zq";
    const { root } = await renderSettled(view, real([{ username: hostile, createdAt: created(2, 3) }]));
    const name = root.querySelector("tbody td") as FakeElement;
    expect(name.textContent).toBe("<img src=x onerror=alert(1)>?zq");
    expect(root.querySelectorAll("img")).toHaveLength(0);
    for (const el of root.descendants()) for (const attr of el.attrs.keys()) expect(attr).not.toMatch(/^on/i);
  });
});
