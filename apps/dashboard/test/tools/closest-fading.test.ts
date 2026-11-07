/**
 * Closest and fading friends: what it computes from the export the page holds, and what its page shows.
 * Synthetic data only. Usernames and message-like strings carry canaries that must never reach a note, an
 * announcement or a title, and a username may appear only inside the two result tables.
 */
import type { ChatEvent, FriendRecord, ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { copy } from "../../src/tools/closest-fading/copy.ts";
import { descriptor } from "../../src/tools/closest-fading/index.ts";
import { computeClosestFading, DEFAULT_PARAMS, WINDOW_CHOICES } from "../../src/tools/closest-fading/model.ts";
import { view } from "../../src/tools/closest-fading/view.ts";
import { toolData } from "../../src/tools/data.ts";
import { RULES, collectCopy, lint } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));
vi.mock("../../src/download.ts", () => ({ saveTextFile: () => true, saveBlob: () => true }));

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

const exportDate = (): number => (base.latest as ParsedExport).exportedAt ?? base.now;

/** One event, a whole number of days before the export date. Odd days are sent, even days received. */
const event = (conversation: string, daysBack: number, group = false): ChatEvent => ({
  conversation,
  isGroup: group,
  direction: daysBack % 2 === 1 ? "sent" : "received",
  kind: "TEXT",
  at: exportDate() - daysBack * DAY,
});
const run = (name: string, from: number, count: number): ChatEvent[] => Array.from({ length: count }, (_, i) => event(name, from + i));
const friend = (username: string): FriendRecord => ({ username });

/**
 * A small made-up export on top of the sample's. With the default 90 days:
 *   zqclose  10 recent events: closest
 *   zqmid    5 recent events and 10 before (drop 50%): closest, not fading
 *   zqfade   2 recent and 20 before (drop 90%): fading, too few recent events for the closest list
 *   zqstop   no recent events and 10 before: fading, 100%
 *   zqedge   no recent events and exactly 8 before: fading (the smallest count that qualifies)
 *   zqshort  no recent events and 7 before: not fading
 *   zqfew    2 recent events only: neither
 * plus group events and events with someone who is not a friend, which are left out and counted.
 */
function craftedChats(): ChatEvent[] {
  return [
    ...run("zqclose", 1, 10),
    ...[31, 40, 51, 60, 71].map((d) => event("zqmid", d)),
    ...run("zqmid", 100, 10),
    ...run("zqfade", 5, 2),
    ...run("zqfade", 100, 20),
    ...run("zqstop", 100, 10),
    ...run("zqedge", 100, 8),
    ...run("zqshort", 100, 7),
    ...run("zqfew", 3, 2),
    ...run("group:zqgroup", 1, 4).map((e) => ({ ...e, isGroup: true })),
    ...run("zqstranger", 2, 2),
  ];
}
const CRAFTED_FRIENDS = ["zqclose", "zqmid", "zqfade", "zqstop", "zqedge", "zqshort", "zqfew"];

/** A real (not sample) export made from the sample's, with whatever is changed. */
function real(change: Partial<ParsedExport> = {}, ws: Partial<Workspace> = {}): State {
  const parsed = base.latest as ParsedExport;
  const latest = { ...parsed, ...change };
  return stateWith({ latest, now: base.now, issues: [], parts: 1, ...ws });
}
function crafted(extra: { friends?: string[]; chats?: ChatEvent[] } = {}, ws: Partial<Workspace> = {}): State {
  const parsed = base.latest as ParsedExport;
  const friends = { ...parsed.friends, friends: [...CRAFTED_FRIENDS, ...(extra.friends ?? [])].map(friend) };
  return real({ friends, chats: [...craftedChats(), ...(extra.chats ?? [])] }, ws);
}

const sampleNames = (): string[] => [...new Set((base.latest as ParsedExport).friends.friends.map((f) => f.username))].filter((n) => n.length >= 5);
const texts = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const cellsOf = (table: FakeElement): string[][] => table.querySelectorAll("tbody tr").map((tr) => [tr.querySelector("th")?.textContent ?? "", ...texts(tr, "td")]);

describe("the tool", () => {
  it("is a Friends tool that needs an export with friends and chats, and shows the closest command", () => {
    expect(descriptor).toMatchObject({ id: "closest-fading", title: "Closest and fading friends", group: "friends", category: "requests", needs: ["export", "friends", "chats"] });
    expect(descriptor.oneLiner.length).toBeLessThanOrEqual(56);
    expect(COMMANDS.closest.argv[0]).toBe("closest");
  });

  it("keeps its words within the copy lint", () => {
    const entries = collectCopy({ tool_closest_fading: copy });
    expect(entries.length).toBeGreaterThan(20);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("never takes a username: every copy function works from counts and dates", () => {
    for (const value of Object.values(copy)) {
      if (typeof value !== "function") continue;
      const text = String((value as (...a: unknown[]) => unknown)(3, "Nov 6, 2026"));
      expect(text).not.toMatch(/alice|zq/i);
    }
  });
});

describe("computeClosestFading", () => {
  it("ranks the sample's closest friends, highest score first, and finds who is fading", () => {
    const r = computeClosestFading(toolData(sample));
    expect(r.settings.windowDays).toBe(90);
    expect(r.closest).toHaveLength(10);
    expect(r.closest.map((f) => f.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.closest[0]?.relativeScore).toBe(1);
    for (let i = 1; i < r.closest.length; i++) expect((r.closest[i - 1]?.score ?? 0) >= (r.closest[i]?.score ?? 0)).toBe(true);
    expect(r.fading.length).toBeGreaterThan(0);
    expect(r.counts.friends).toBe(120);
  });

  it("measures back from the data's own date and never from a clock", () => {
    const data = toolData(sample);
    expect(computeClosestFading(data).asOf).toBe(data.now);
    // A later "now" does not move the end of the windows past the export's date.
    const later = toolData(crafted({}, { now: exportDate() + 10 * DAY }));
    const r = computeClosestFading(later);
    expect(r.asOf).toBe(exportDate());
    expect(r.notes).toContainEqual({ code: "measured-to-export-date", params: { daysBeforeNow: 10 } });
  });

  it("puts a friend in the closest list at three recent events and in the fading list at eight earlier ones", () => {
    const r = computeClosestFading(toolData(crafted()));
    expect(r.closest.map((f) => f.key)).toEqual(["zqclose", "zqmid"]);
    expect(r.closest[0]?.events).toEqual({ total: 10, sent: 5, received: 5, unknown: 0 });
    expect(r.fading.map((f) => f.key)).toEqual(["zqstop", "zqedge", "zqfade"]);
    expect(r.fading.find((f) => f.key === "zqfade")).toMatchObject({ earlierEvents: 20, recentEvents: 2, dropFraction: 0.9, stopped: false });
    expect(r.fading.find((f) => f.key === "zqstop")).toMatchObject({ dropFraction: 1, stopped: true });
    // A drop of 50% is below the 60% line, 7 earlier events is below 8, and 2 recent events is below 3.
    const all = [...r.closest, ...r.fading].map((f) => f.key);
    expect(all).not.toContain("zqshort");
    expect(all).not.toContain("zqfew");
    expect(r.fading.map((f) => f.key)).not.toContain("zqmid");
  });

  it("recomputes for another window", () => {
    const data = toolData(crafted());
    const wide = computeClosestFading(data, { windowDays: 180 });
    expect(wide.settings.windowDays).toBe(180);
    // With a 180 day recent window every event is recent, so nobody has an earlier window to fade from.
    expect(wide.fading).toEqual([]);
    expect(computeClosestFading(data, { windowDays: 30 }).closest.map((f) => f.key)).toEqual(["zqclose"]);
    expect(WINDOW_CHOICES).toContain(DEFAULT_PARAMS.windowDays);
  });

  it("leaves group events and people who are not friends out, and says how many", () => {
    const r = computeClosestFading(toolData(crafted()));
    expect(r.notes).toContainEqual({ code: "non-friend-events-ignored", params: { count: 2 } });
    expect(r.notes.map((n) => n.code)).toContain("history-starts-inside-earlier-window");
    expect([...r.closest, ...r.fading].map((f) => f.key)).not.toContain("zqstranger");
    expect(JSON.stringify(r)).not.toContain("zqgroup");
  });

  it("finds nothing when every saved chat is a group chat", () => {
    const groupOnly = real({ chats: run("group:zqgroup", 1, 20).map((e) => ({ ...e, isGroup: true })) });
    const r = computeClosestFading(toolData(groupOnly));
    expect(r.closest).toEqual([]);
    expect(r.fading).toEqual([]);
    expect(r.notes.map((n) => n.code)).toContain("no-one-to-one-activity");
  });

  it("holds no name in its counts, settings or notes", () => {
    const r = computeClosestFading(toolData(sample));
    const json = JSON.stringify({ notes: r.notes, counts: r.counts, settings: r.settings, asOf: r.asOf });
    for (const name of sampleNames()) expect(json, name).not.toContain(name);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeClosestFading(toolData(initialState()))).toThrow();
  });
});

describe("the page", () => {
  it("shows the sample as an overview, a closest table, a fading table, notes and the command", async () => {
    const { root } = await renderSettled(view, sample);
    expect(texts(root, ".section-title")).toEqual([copy.glanceHeading, copy.closestHeading, copy.fadingHeading, tools.notesHeading, tools.commandHeading]);
    expect(texts(root, ".fact dt")).toEqual([copy.factFriendsHeader, copy.factActiveHeader, copy.factFadingHeader]);
    expect(texts(root, ".fact dd")[0]).toBe("120");

    const [closest, fading] = root.querySelectorAll("table") as [FakeElement, FakeElement];
    expect(closest.querySelector("caption")?.textContent).toBe(copy.closestCaption);
    expect(texts(closest, "thead th")).toEqual([copy.friendHeader, copy.activityHeader, copy.sentHeader, copy.receivedHeader, copy.lastHeader]);
    const rows = cellsOf(closest);
    expect(rows).toHaveLength(10);
    // Each cell says what it is, because a phone shows the rows as cards without column names.
    expect(rows[0]).toEqual([expect.any(String), "100% of top", expect.stringMatching(/^\d+ sent$/), expect.stringMatching(/^\d+ received$/), expect.stringMatching(/^Last [A-Z][a-z]{2} \d{1,2}, \d{4}$/)]);
    for (const row of rows) expect(row[0]).toMatch(/^[a-z0-9_.-]+$/);
    // Each name is the shared username element, written as text.
    expect(closest.querySelectorAll("tbody th code.username")).toHaveLength(10);

    expect(fading.querySelector("caption")?.textContent).toBe(copy.fadingCaption);
    expect(texts(fading, "thead th")).toEqual([copy.friendHeader, copy.earlierHeader, copy.recentHeader, copy.changeHeader, copy.lastHeader]);
    expect(cellsOf(fading)[0]).toEqual([expect.any(String), expect.stringMatching(/^\d+ earlier$/), expect.stringMatching(/^\d+ recent$/), expect.stringMatching(/^Down \d+%$/), expect.stringMatching(/^Last /)]);

    expect(root.textContent).toContain("Recent means the last 90 days.");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.closest));
    expect(root.querySelectorAll(".command-head button").map((b) => b.textContent)).toEqual(["Copy", "Run"]);
  });

  it("shows each friend with the counts and dates the model found", async () => {
    const { root } = await renderSettled(view, crafted());
    const [closest, fading] = root.querySelectorAll("table") as [FakeElement, FakeElement];
    expect(cellsOf(closest)).toEqual([
      ["zqclose", "100% of top", "5 sent", "5 received", expect.stringMatching(/^Last Nov 5, 2026$/)],
      ["zqmid", expect.stringMatching(/^\d+% of top$/), "3 sent", "2 received", expect.stringMatching(/^Last Oct 6, 2026$/)],
    ]);
    expect(cellsOf(fading)).toEqual([
      ["zqstop", "10 earlier", "0 recent", "Down 100%", expect.stringMatching(/^Last /)],
      ["zqedge", "8 earlier", "0 recent", "Down 100%", expect.stringMatching(/^Last /)],
      ["zqfade", "20 earlier", "2 recent", "Down 90%", expect.stringMatching(/^Last /)],
    ]);
    expect(texts(root, ".fact dd")).toEqual(["7", "4", "3"]);
  });

  it("announces how many were found, politely, once and without a name", async () => {
    await renderSettled(view, sample);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^10 friends in the closest list, \d+ fading\.$/);
    for (const name of sampleNames()) expect(said[0], name).not.toContain(name);
  });

  it("offers four windows with 90 chosen, and recomputes the result when another is pressed", async () => {
    const { root } = await renderSettled(view, crafted());
    const group = root.querySelector(".segmented") as FakeElement;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe(copy.windowLabel);
    const buttons = group.querySelectorAll("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["30", "60", "90", "180"]);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["30 days", "60 days", "90 days", "180 days"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);

    said.length = 0;
    (buttons[0] as FakeElement).click();
    await settled(root);
    expect(root.textContent).toContain("Recent means the last 30 days.");
    expect(cellsOf(root.querySelectorAll("table")[0] as FakeElement).map((r) => r[0])).toEqual(["zqclose"]);
    // The control is the same element, so focus is not lost, and only the pressed state moved.
    expect(group.querySelectorAll("button")[0]).toBe(buttons[0]);
    expect(group.querySelectorAll("button").map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    expect(said).toEqual(["1 friend in the closest list, 0 fading."]);
  });

  it("says plainly when no friend is fading, and when nobody has enough recent activity", async () => {
    const wide = await renderSettled(view, crafted());
    (wide.root.querySelectorAll(".segmented button")[3] as FakeElement).click();
    await settled(wide.root);
    expect(wide.root.textContent).toContain(copy.noFadingLine);
    expect(wide.root.querySelectorAll("table")).toHaveLength(1);

    const quietOnly = await renderSettled(view, real({ friends: { ...(base.latest as ParsedExport).friends, friends: [friend("zqstop")] }, chats: run("zqstop", 100, 10) }));
    expect(quietOnly.root.textContent).toContain(copy.noClosestLine(3));
    expect(quietOnly.root.querySelectorAll("table")).toHaveLength(1);
    expect(texts(quietOnly.root, "tbody th")).toEqual(["zqstop"]);
  });

  it("shows an honest empty state, and not the tables or notes, when there is nothing to rank", async () => {
    const groupOnly = real({ chats: run("group:zqgroup", 1, 20).map((e) => ({ ...e, isGroup: true })) });
    const { root } = await renderSettled(view, groupOnly);
    expect(texts(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(texts(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelector(".tool-notes")).toBeNull();
    expect(said).toEqual([copy.emptyAnnounce]);
    // The windows and the command stay, so the person can try another window.
    expect(root.querySelectorAll(".segmented button")).toHaveLength(4);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.closest));
  });

  it("writes each note as a short hedged sentence, with no code and no name", async () => {
    const { root } = await renderSettled(view, crafted({}, { now: exportDate() + 10 * DAY }));
    const notes = texts(root, ".tool-notes li");
    expect(notes).toEqual(
      expect.arrayContaining([copy.measuredNote(10), copy.startsLateNote, copy.nonFriendNote(2), copy.fadingNote, copy.savedOnlyNote]),
    );
    expect(copy.nonFriendNote(2)).toBe("2 chats or Snaps are with people not on your friends list. Snappy leaves them out.");
    expect(copy.nonFriendNote(1)).toBe("1 chat or Snap is with someone not on your friends list. Snappy leaves it out.");
    expect(notes.join(" ")).toMatch(/may/);
    for (const n of notes) {
      expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
      expect(n).not.toMatch(/zq/);
    }
    expect(copy.fadingNote).toMatch(/not that a friendship ended/);
  });

  it("builds nothing to download: the page has no download button and holds no file", async () => {
    const { root } = await renderSettled(view, sample);
    expect(texts(root, ".section-title")).not.toContain(tools.downloadHeading);
    expect(root.querySelectorAll("button").map((b) => b.textContent).filter((t) => /download|save/i.test(t))).toEqual([]);
  });

  it("shows a username only in the two result tables, never in a note, a label, an announcement or a title", async () => {
    const canary = "zqcanary_name";
    const state = crafted({ friends: [canary], chats: run(canary, 1, 12) });
    const { root } = await renderSettled(view, state);
    const inTable = (el: FakeElement): boolean => {
      for (let n = el as FakeElement | null; n; n = n.parentNode as FakeElement | null) if (n.tagName === "table") return true;
      return false;
    };
    for (const el of root.descendants()) {
      const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
      if (/zq/.test(own)) expect(inTable(el), `${el.tagName}.${el.className} holds "${own}"`).toBe(true);
      for (const attr of ["aria-label", "title", "alt"]) expect(el.getAttribute(attr) ?? "", `${el.tagName} ${attr}`).not.toMatch(/zq/);
    }
    expect(texts(root, "tbody th").some((n) => n === canary)).toBe(true);
    expect(said.join(" ")).not.toMatch(/zq/);
    expect(root.querySelector("h1")?.textContent).toBe(copy.title);
    // Everything outside the tables, in one string.
    const outside = root.querySelectorAll(".tool-notes, .lead, .section-title, .fact, .tool-reads, .command").map((e) => e.textContent).join(" ");
    expect(outside).not.toMatch(/zq/);
  });

  it("writes a username as plain text, with invisible and direction-changing characters shown as question marks", async () => {
    const odd = "zqodd‮evil";
    const state = real({ friends: { ...(base.latest as ParsedExport).friends, friends: [friend(odd)] }, chats: run(odd, 1, 6) });
    const { root } = await renderSettled(view, state);
    const name = texts(root, "tbody th")[0] ?? "";
    expect(name).not.toContain("‮");
    expect(name).toContain("?");
    expect(root.querySelectorAll("a").filter((a) => (a.getAttribute("href") ?? "").startsWith("http"))).toHaveLength(0);
  });

  it("keeps the page's frame: one h1, no inline style, and nothing that reads message text", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelector(".tool-reads")?.textContent).toContain(copy.reads);
    for (const el of root.descendants()) expect(el.hasAttribute("style")).toBe(false);
  });
});

describe("without what it needs", () => {
  it("says so plainly and still offers the command", () => {
    const { root } = render(view, emptyState());
    expect(texts(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.closest));
    expect(root.querySelector(".tool-result")).toBeNull();
  });

  it("asks for chat history when the export has none, and for a friends list when it has none", async () => {
    const noChats = render(view, real({ chats: [] }));
    expect(texts(noChats.root, ".empty-title")).toEqual([tools.needs.chatsTitle]);
    expect(noChats.root.querySelector(".empty a")?.getAttribute("href")).toBe("#/tools/export-check");
    const parsed = base.latest as ParsedExport;
    const noFriends = render(view, real({ friends: { ...parsed.friends, friends: [] } }));
    expect(texts(noFriends.root, ".empty-title")).toEqual([tools.needs.friendsTitle]);
    await settled(noChats.root);
  });

  it("says saved history is not an export", () => {
    expect(texts(render(view, stateWith({ ledger: base.ledger })).root, ".empty-body")).toEqual([tools.needs.exportLedgerBody]);
  });
});
