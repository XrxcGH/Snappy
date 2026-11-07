/**
 * Blocked and ignored review: what it computes from the friends lists the page holds, and what its page shows.
 * Synthetic data only. The usernames below carry a canary that must reach a result list and nowhere else.
 */
import type { FriendRecord, ParsedExport, ParsedFriends } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { initialState } from "../../src/reducer.ts";
import { SAMPLE_NOW } from "../../src/sample.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { copy } from "../../src/tools/blocked-review/copy.ts";
import { descriptor } from "../../src/tools/blocked-review/index.ts";
import { computeBlockedReview } from "../../src/tools/blocked-review/model.ts";
import { view } from "../../src/tools/blocked-review/view.ts";
import { toolData } from "../../src/tools/data.ts";
import { RULES, ancestors, collectCopy, lint, textOf } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { render, renderSettled, sampleState, sampleWorkspace, stateWith } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));

const DAY = 24 * 60 * 60 * 1000;
let base: Workspace;
let sample: State;
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
});

const rec = (username: string, daysAgo?: number): FriendRecord => ({ username, ...(daysAgo === undefined ? {} : { createdAt: SAMPLE_NOW - daysAgo * DAY }) });

/** A real (not sample) export made from the sample's, with its friends lists replaced. */
function real(friends: Partial<ParsedFriends>): State {
  const latest = base.latest as ParsedExport;
  return stateWith({ latest: { ...latest, friends: { ...latest.friends, ...friends } }, now: base.now, issues: [], parts: 1 });
}
const dataOf = (state: State) => toolData(state);
const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const names = (el: FakeElement): string[] => text(el, "code.username");

/** Lists with one person of each kind of conflict, all with canary names. */
const CRAFTED: Partial<ParsedFriends> = {
  friends: [rec("zqcanary_friend", 400), rec("zqcanary_other", 300)],
  pendingRequests: [rec("zqcanary_pending", 10)],
  sentRequests: [rec("zqcanary_sent", 10)],
  blocked: [rec("zqcanary_both", 900), rec("zqcanary_friend", 800), rec("zqcanary_pending", 700), rec("zqcanary_sent", 600), rec("zqcanary_solo", 500)],
  ignored: [rec("zqcanary_both", 200), rec("zqcanary_undated")],
  hiddenSuggestions: [],
};
const CANARIES = ["zqcanary_friend", "zqcanary_other", "zqcanary_pending", "zqcanary_sent", "zqcanary_both", "zqcanary_solo", "zqcanary_undated"];

describe("the tool", () => {
  it("is a Friends tool in the requests color that needs an export and shows the blocked command", () => {
    expect(descriptor).toMatchObject({ id: "blocked-review", title: "Blocked and ignored review", group: "friends", category: "requests", needs: ["export"] });
    expect(descriptor.oneLiner).toBe("Look over who you blocked or ignored.");
    expect(COMMANDS.blocked.argv[0]).toBe("blocked");
  });
});

describe("computeBlockedReview", () => {
  it("reviews the sample as core does: three lists, oldest first, no conflicts, and the page's own date as now", () => {
    const review = computeBlockedReview(dataOf(sample));
    expect(review.lists.map((l) => [l.id, l.count])).toEqual([["blocked", 4], ["ignored", 3], ["hiddenSuggestions", 6]]);
    expect(review.generatedAt).toBe(base.now);
    expect(review.totals).toEqual({ people: 13, conflicts: 0 });
    const blocked = review.lists[0];
    expect(blocked?.entries.map((e) => e.at)).toEqual([...(blocked?.entries.map((e) => e.at) ?? [])].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(review.lists[2]?.undatedCount).toBe(6);
    expect(review.reviewOrder.map((s) => s.code)).toEqual(["review-blocked", "review-ignored", "review-hidden-suggestions"]);
  });

  it("finds a person on two lists, and a person who is also a friend, a pending request or a sent request", () => {
    const review = computeBlockedReview(dataOf(real(CRAFTED)));
    const kinds = Object.fromEntries(review.conflicts.map((c) => [c.username, c.kinds]));
    expect(kinds).toEqual({
      zqcanary_both: ["multiple-lists"],
      zqcanary_friend: ["also-friend"],
      zqcanary_pending: ["also-pending"],
      zqcanary_sent: ["also-sent"],
    });
    expect(review.reviewOrder[0]).toMatchObject({ code: "review-conflicts", count: 4 });
  });

  it("is empty when every list is empty, and counts a repeated person (any letter case) once", () => {
    const none = computeBlockedReview(dataOf(real({ blocked: [], ignored: [], hiddenSuggestions: [] })));
    expect(none.totals.people).toBe(0);
    expect(none.notes.map((n) => n.code)).toContain("no-entries");
    const dupes = computeBlockedReview(dataOf(real({ blocked: [rec("ZQCanary_Solo", 30), rec("zqcanary_solo", 60)], ignored: [], hiddenSuggestions: [] })));
    expect(dupes.lists[0]?.count).toBe(1);
    expect(dupes.lists[0]?.caseDuplicates).toBe(1);
  });

  it("treats a date after now as no date, and keeps it out of the oldest and newest", () => {
    const review = computeBlockedReview(dataOf(real({ blocked: [rec("zqcanary_solo", -5), rec("zqcanary_other", 20)], ignored: [], hiddenSuggestions: [] })));
    const list = review.lists[0];
    expect(list?.futureCount).toBe(1);
    expect(list?.oldestAt).toBe(base.now - 20 * DAY);
    expect(list?.newestAt).toBe(base.now - 20 * DAY);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeBlockedReview(dataOf(initialState()))).toThrow();
  });

  it("puts no username in a note or a step: only counts, list names and codes", () => {
    const review = computeBlockedReview(dataOf(real(CRAFTED)));
    const json = JSON.stringify({ notes: review.notes, steps: review.reviewOrder });
    for (const name of CANARIES) expect(json, name).not.toContain(name);
  });
});

describe("the page", () => {
  it("shows the counts, what to look at first, each list oldest first with its date range, and the blocked command", async () => {
    const { root } = await renderSettled(view, sample);
    expect(text(root, ".section-title")).toEqual([copy.countsHeading, copy.firstHeading, copy.blockedHeading, copy.ignoredHeading, copy.hiddenHeading, tools.notesHeading, tools.commandHeading]);
    expect(text(root, ".fact dt")).toEqual(["Blocked", "Ignored", "Hidden suggestions", "Worth a look"]);
    expect(text(root, ".fact dd")).toEqual(["4", "3", "6", "0"]);
    expect(text(root, ".step-list li p")).toEqual([copy.blockedStep(4), copy.ignoredStep(3), copy.hiddenStep(6)]);
    expect(text(root, ".caption")).toHaveLength(2);
    expect(text(root, ".caption")[0]).toMatch(/^Oldest [A-Z][a-z]{2} \d{1,2}, \d{4}\. Newest [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.blocked));
  });

  it("lists the people in result lists, with their date or no date, in order", async () => {
    const { root } = await renderSettled(view, sample);
    const lists = root.querySelectorAll(".review-list");
    expect(lists).toHaveLength(3);
    expect(names(lists[0] as FakeElement)).toEqual(["blocked_3", "blocked_4", "blocked_1", "blocked_2"]);
    expect(names(lists[1] as FakeElement)).toEqual(["ignored_1", "ignored_3", "ignored_2"]);
    expect(names(lists[2] as FakeElement)).toHaveLength(6);
    expect(text(lists[0] as FakeElement, ".review-meta")[0]).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(text(lists[2] as FakeElement, ".review-meta")).toEqual(Array(6).fill(copy.noDateLine));
  });

  it("shows no way to change anything and no download: Snappy only lists", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelector("[data-key=tool-download]")).toBeNull();
    expect(text(root, ".section-title")).not.toContain(tools.downloadHeading);
    for (const list of root.querySelectorAll(".review-list")) expect(list.querySelectorAll("button")).toHaveLength(0);
    expect(root.querySelectorAll("a").filter((a) => (a.getAttribute("href") ?? "").startsWith("http"))).toHaveLength(0);
    expect(text(root, ".tool-notes li")[0]).toBe(copy.readOnlyNote);
  });

  it("puts the people worth a second look first, with the lists they are on and why", async () => {
    const { root } = await renderSettled(view, real(CRAFTED));
    expect(text(root, ".section-title").slice(0, 4)).toEqual([copy.countsHeading, copy.firstHeading, copy.conflictsHeading, copy.blockedHeading]);
    expect(text(root, ".step-list li p")[0]).toBe(copy.conflictsStep(4));
    expect(text(root, ".fact dd")[3]).toBe("4");
    const conflicts = root.querySelectorAll(".review-list")[0] as FakeElement;
    expect(names(conflicts)).toEqual(["zqcanary_both", "zqcanary_friend", "zqcanary_pending", "zqcanary_sent"]);
    const rows = conflicts.querySelectorAll(".review-row");
    expect(rows[0]?.textContent).toContain("Blocked, Ignored");
    expect(rows[0]?.textContent).toContain(copy.kinds["multiple-lists"]);
    expect(rows[1]?.textContent).toContain(copy.kinds["also-friend"]);
    expect(rows[2]?.textContent).toContain(copy.kinds["also-pending"]);
    expect(rows[3]?.textContent).toContain(copy.kinds["also-sent"]);
    // The hidden suggestions list is empty, so it has no section.
    expect(text(root, ".section-title")).not.toContain(copy.hiddenHeading);
  });

  it("shows a short first page of a long list, with Show more", async () => {
    const many = Array.from({ length: 60 }, (_, i) => rec(`zqcanary_${String(i).padStart(2, "0")}`, i + 1));
    const { root } = await renderSettled(view, real({ blocked: many, ignored: [], hiddenSuggestions: [], friends: [rec("zqcanary_x")] }));
    expect(root.querySelectorAll(".review-row")).toHaveLength(50);
    expect(root.querySelector(".more")?.textContent).toContain("Show 10 more");
    expect(root.querySelector(".fact dd")?.textContent).toBe("60");
  });

  it("announces the result politely once, and without a name", async () => {
    await renderSettled(view, sample);
    expect(said).toEqual([copy.doneAnnounce(13, 0)]);
    expect(said[0]).toBe("Review finished. 13 people in your lists.");
    said.length = 0;
    await renderSettled(view, real(CRAFTED));
    expect(said[0]).toBe("Review finished. 6 people in your lists, 4 may be worth a second look.");
    for (const name of CANARIES) expect(said[0], name).not.toContain(name);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
  });
});

describe("the notes", () => {
  it("say what is undated, in the future, repeated or blank, and that the friends list is empty, each hedged and short", async () => {
    const state = real({
      friends: [],
      blocked: [rec("zqcanary_solo", 30), rec("ZQCANARY_SOLO", 40), rec("zqcanary_future", -3), rec(" ", 10)],
      ignored: [rec("zqcanary_undated")],
      hiddenSuggestions: [],
    });
    const { root } = await renderSettled(view, state);
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(
      expect.arrayContaining([
        copy.readOnlyNote,
        copy.undatedNote(1, "ignored"),
        copy.futureNote(1, "blocked"),
        copy.duplicatesNote(1, "blocked"),
        copy.blankNote(1, "blocked"),
        copy.friendsEmptyNote,
      ]),
    );
    expect(notes.join(" ")).toMatch(/may/);
    for (const n of notes) {
      expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
      for (const name of CANARIES) expect(n, name).not.toContain(name);
    }
    const kinds = root.querySelectorAll(".tool-note").map((n) => (n.classList.contains("tool-note-warning") ? "warning" : "info"));
    expect(kinds).toContain("warning");
    expect(kinds).toContain("info");
  });

  it("says how many may be worth a second look", async () => {
    const { root } = await renderSettled(view, real(CRAFTED));
    expect(text(root, ".tool-notes li")).toContain(copy.conflictsNote(4));
  });

  it("uses the singular for one person", () => {
    expect(copy.undatedNote(1, "blocked")).toBe("1 person in your blocked list has no date. Snappy puts that person last.");
    expect(copy.undatedNote(3, "blocked")).toBe("3 people in your blocked list have no date. Snappy puts them last.");
    expect(copy.conflictsStep(1)).toBe("Look at the 1 person who shows up in more than one place.");
  });
});

describe("when nothing is found", () => {
  it("says so honestly instead of showing an empty result, and still offers the command", async () => {
    const { root } = await renderSettled(view, real({ blocked: [], ignored: [], hiddenSuggestions: [] }));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll(".review-list")).toHaveLength(0);
    expect(root.querySelector(".tool-notes")).toBeNull();
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.blocked));
    expect(said).toEqual([copy.doneAnnounce(0, 0)]);
  });
});

describe("without an export", () => {
  it("says so plainly, offers Add export and still offers the command", () => {
    const { root } = render(view, initialState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.blocked));
    expect(root.querySelector(".tool-result")).toBeNull();
  });

  it("says saved history is not an export", () => {
    expect(text(render(view, stateWith({ ledger: base.ledger })).root, ".empty-body")).toEqual([tools.needs.exportLedgerBody]);
  });
});

describe("privacy", () => {
  it("shows a username only in a result list, never in a note, an announcement, a label or a title", async () => {
    const { root } = await renderSettled(view, real(CRAFTED));
    const inLists = root.querySelectorAll(".review-list").flatMap((l) => names(l));
    for (const name of ["zqcanary_both", "zqcanary_solo", "zqcanary_undated"]) expect(inLists, name).toContain(name);
    const outside = root.descendants().filter((el) => {
      const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
      const labels = ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? "").join(" ");
      const inList = ancestors(el).some((a) => a.classList.contains("review-list")) || el.classList.contains("review-list");
      return !inList && CANARIES.some((n) => own.includes(n) || labels.includes(n));
    });
    expect(outside.map((el) => `${el.tagName}.${el.className}`)).toEqual([]);
    for (const note of root.querySelectorAll(".tool-note, .notice, .empty, .lead, .step-list, .caption")) {
      for (const name of CANARIES) expect(textOf(note), name).not.toContain(name);
    }
    for (const line of said) for (const name of CANARIES) expect(line, name).not.toContain(name);
    expect(root.querySelector(".tool-failed")).toBeNull();
  });

  it("holds a name that tries to be markup as text, and has no copy button that would name it in a label", async () => {
    const { root } = await renderSettled(view, real({ blocked: [rec("<b>zqcanary</b>", 10)], ignored: [], hiddenSuggestions: [], friends: [rec("zqcanary_x")] }));
    expect(names(root)).toEqual(["<b>zqcanary</b>"]);
    expect(root.querySelectorAll(".review-list b")).toHaveLength(0);
    expect(root.querySelectorAll("[aria-label]").filter((e) => (e.getAttribute("aria-label") ?? "").includes("zqcanary"))).toHaveLength(0);
  });
});

describe("its words", () => {
  it("pass the copy lint: sentence case, US English, quotes, punctuation and lengths", () => {
    const entries = collectCopy({ tool_blocked_review: copy });
    expect(entries.length).toBeGreaterThan(20);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("fit the hub: a short title, a one-sentence tile line and a short description", () => {
    expect(copy.title.length).toBeLessThanOrEqual(28);
    expect(copy.oneLiner.length).toBeLessThanOrEqual(56);
    expect(copy.description.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(copy.reads.split(/\s+/).length).toBeLessThanOrEqual(25);
  });
});
