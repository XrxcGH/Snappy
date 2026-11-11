/**
 * Friend count history: what it computes from the friends lists and saved snapshots the page holds, and what its
 * page shows. Synthetic data only. Crafted usernames carry a canary that must never reach a note, an announcement or
 * the page: this tool has no table of people, so no username belongs anywhere on it.
 */
import { snapshotFromExport } from "@snappy-export/core";
import type { Ledger, ParsedExport, Snapshot } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/friend-count-history/copy.ts";
import { descriptor } from "../../src/tools/friend-count-history/index.ts";
import { computeFriendCountHistory } from "../../src/tools/friend-count-history/model.ts";
import { view } from "../../src/tools/friend-count-history/view.ts";
import { RULES, collectCopy, lint, useNames } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { phrase } from "./cell-text.ts";
import { emptyState, render, renderSettled, sampleState, sampleWorkspace, stateWith } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));

const NOW = Date.UTC(2026, 5, 15, 12);
const at = (y: number, m: number, d = 10): number => Date.UTC(y, m - 1, d, 12);
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
});

const person = (name: string, createdAt?: number) => ({ username: `${CANARY}_${name}`, ...(createdAt !== undefined && { createdAt }) });

function snapshot(id: string, takenAt: number, size: number): Snapshot {
  return { id, takenAt, source: "export", friends: Array.from({ length: size }, (_, i) => `${CANARY}_s${id}_${i}`), sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} };
}
const ledgerOf = (...snapshots: Snapshot[]): Ledger => ({ version: 1, snapshots });

interface Lists {
  friends?: ReturnType<typeof person>[];
  deleted?: (ReturnType<typeof person> & { deletedAt?: number })[];
}

/**
 * A real (not sample) export with only these friends: three friends added Jan, Jan and Mar 2025, and one added
 * Jan 2025 and removed Feb 2025. The curve is 3 at the end of Jan, 2 in Feb, 3 from Mar.
 */
function real(lists: Lists = {}, ws: Partial<Workspace> = {}, saving = true): State {
  const friends = lists.friends ?? [person("a", at(2025, 1)), person("b", at(2025, 1)), person("c", at(2025, 3))];
  const deletedFriends = lists.deleted ?? [{ ...person("d", at(2025, 1)), deletedAt: at(2025, 2) }];
  const latest: ParsedExport = { ...(base.latest as ParsedExport), friends: { ...(base.latest as ParsedExport).friends, friends, deletedFriends } };
  const state = stateWith({ latest, now: NOW, issues: [], parts: 1, ledger: ledgerOf(), ...ws });
  // Saving is on and unlocked unless a test says otherwise: only then is the ledger really saved history.
  return { ...state, vault: { ...state.vault, phase: saving ? "unlocked" : "session" } };
}
const dataOf = (state: State) => toolData(state);
const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map(phrase);

describe("the tool", () => {
  it("is a Friends tool that needs an export with friends and shows the friend-count command", () => {
    expect(descriptor).toMatchObject({ id: "friend-count-history", title: "Friend count history", group: "friends", category: "requests", needs: ["export", "friends"] });
    expect(COMMANDS["friend-count"].argv[0]).toBe("friend-count");
  });

  it("has copy that passes the lint", () => {
    const problems = RULES.flatMap((rule) => lint(collectCopy({ copy }), rule));
    expect(problems).toEqual([]);
  });
});

describe("computeFriendCountHistory", () => {
  it("draws the curve from the dates: joined, left, the count at the end of each month, and the best and worst month", () => {
    const { history } = computeFriendCountHistory(dataOf(real()));
    expect(history.months[0]?.month).toBe("2025-01");
    expect(history.months.at(-1)?.month).toBe("2026-06");
    expect(history.months.at(-1)?.partial).toBe(true);
    expect(history.months.map((m) => m.count).slice(0, 3)).toEqual([3, 2, 3]);
    expect(history.totals).toMatchObject({ joined: 4, left: 1, net: 3, currentCount: 3 });
    expect(history.best).toEqual({ month: "2025-01", net: 3 });
    expect(history.worst).toEqual({ month: "2025-02", net: -1 });
  });

  it("works on the sample, with its two saved snapshots set against the curve", () => {
    const result = computeFriendCountHistory(dataOf(sample));
    expect(result.history.totals.currentCount).not.toBeNull();
    expect(result.history.months.length).toBeGreaterThan(0);
    expect(result.history.comparisons.length).toBeGreaterThan(0);
    expect(result.exportHasErrors).toBe(false);
  });

  it("has no curve when no friend has a usable date, and says so by code", () => {
    const { history } = computeFriendCountHistory(dataOf(real({ friends: [person("a"), person("b")], deleted: [] })));
    expect(history.totals.currentCount).toBeNull();
    expect(history.months).toEqual([]);
    expect(history.notes.map((n) => n.code)).toContain("no-dated-friendships");
  });

  it("calls a snapshot different only when the gap is more than 5 friends and more than 10% of the snapshot", () => {
    // The curve holds 3 friends from Mar 2025. A snapshot of 8 is a gap of 5 (close); 9 is a gap of 6 (differs).
    const close = computeFriendCountHistory(dataOf(real({}, { ledger: ledgerOf(snapshot("1", at(2025, 5), 8)) }))).history;
    expect(close.comparisons[0]).toMatchObject({ snapshotCount: 8, curveCount: 3, gap: 5, disagrees: false });
    expect(close.notes.map((n) => n.code)).toContain("sources-agree");
    const far = computeFriendCountHistory(dataOf(real({}, { ledger: ledgerOf(snapshot("1", at(2025, 5), 9)) }))).history;
    expect(far.comparisons[0]).toMatchObject({ gap: 6, disagrees: true });
    expect(far.notes.find((n) => n.code === "sources-disagree")?.params).toEqual({ compared: 1, disagreeing: 1, largestGap: 6 });
  });

  it("compares only snapshots that are really saved: with saving off this session's own imports are not history", () => {
    const earlier = ledgerOf(snapshot("1", at(2025, 5), 8));
    const off = computeFriendCountHistory(dataOf(real({}, { ledger: earlier }, false)));
    expect(off.savedHistory).toBe(false);
    expect(off.history.comparisons).toEqual([]);
    expect(off.history.notes.map((n) => n.code)).toContain("no-snapshots");
    expect(computeFriendCountHistory(dataOf(real({}, { ledger: earlier }, true))).history.comparisons).toHaveLength(1);
  });

  it("never compares the curve with the snapshot of the export it was drawn from", () => {
    const state = real();
    const parsed = state.real.latest as ParsedExport;
    const own = snapshotFromExport(parsed, { takenAt: parsed.exportedAt ?? state.real.now });
    const alone = computeFriendCountHistory(dataOf({ ...state, real: { ...state.real, ledger: ledgerOf(own) } }));
    expect(alone.history.comparisons).toEqual([]);
    expect(alone.history.notes.map((n) => n.code)).toContain("no-snapshots");
    const withEarlier = computeFriendCountHistory(dataOf({ ...state, real: { ...state.real, ledger: ledgerOf(snapshot("1", at(2025, 5), 3), own) } }));
    expect(withEarlier.history.comparisons).toHaveLength(1);
    expect(withEarlier.history.comparisons[0]?.takenAt).toBe(at(2025, 5));
  });

  it("notes an export with errors, and passes on nothing else from the issues", () => {
    expect(computeFriendCountHistory(dataOf(real({}, { issues: [{ severity: "error", code: "x", message: `${CANARY} message` }] }))).exportHasErrors).toBe(true);
    expect(computeFriendCountHistory(dataOf(real({}, { issues: [{ severity: "warning", code: "x", message: "m" }] }))).exportHasErrors).toBe(false);
  });

  it("holds no username", () => {
    const json = JSON.stringify(computeFriendCountHistory(dataOf(real({}, { ledger: ledgerOf(snapshot("1", at(2025, 5), 4)), issues: [{ severity: "error", code: "x", message: `${CANARY} message` }] }))));
    expect(json).not.toContain(CANARY);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeFriendCountHistory(dataOf(emptyState()))).toThrow();
  });
});

describe("the page", () => {
  it("shows the summary, the month table and the comparison table for the sample, then the notes and the command", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toEqual([copy.summaryHeading, copy.monthsHeading, copy.compareHeading, tools.notesHeading, tools.commandHeading]);
    expect(text(root, ".fact dt")).toEqual(expect.arrayContaining([copy.nowHeader, copy.addedHeader, copy.removedHeader]));

    const [months, compare] = root.querySelectorAll("table") as [FakeElement, FakeElement];
    expect(months.querySelector("caption")?.textContent).toBe(copy.monthsCaption);
    expect(text(months, "thead th")).toEqual([copy.monthHeader, copy.monthAddedHeader, copy.monthRemovedHeader, copy.monthFriendsHeader]);
    expect(text(months, "tbody th")[0]).toMatch(/^[A-Z][a-z]+ \d{4}$/);
    expect(text(months, "tbody th").at(-1)).toMatch(/\(so far\)$/);
    expect(compare.querySelector("caption")?.textContent).toBe(copy.compareCaption);
    expect(text(compare, "thead th")).toEqual([copy.savedOnHeader, copy.savedHeader, copy.curveHeader, copy.gapHeader, copy.resultHeader]);
    expect(compare.querySelectorAll(".pill").length).toBeGreaterThan(0);

    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["friend-count"]));
    expect(root.querySelector(".tool-download, [data-key='tool-download']")).toBeNull();
  });

  it("says what each cell counts, so a stacked card on a phone still reads", async () => {
    const { root } = await renderSettled(view, real());
    const first = (root.querySelectorAll("table")[0] as FakeElement).querySelectorAll("tbody tr")[0] as FakeElement;
    expect([first.querySelector("th")?.textContent, ...text(first, "td")]).toEqual(["Jan 2025", "3 added", "0 removed", "3 friends"]);
    const summary = text(root, ".fact");
    expect(summary.join(" ")).toContain("Jan 2025, up 3");
    expect(summary.join(" ")).toContain("Feb 2025, down 1");
  });

  it("shows the friends with no start date beside the totals, so Now equals them plus Added minus Removed", async () => {
    const friends = [person("a", at(2025, 1)), person("b"), person("c")];
    const { root } = await renderSettled(view, real({ friends, deleted: [{ ...person("d", at(2025, 1)), deletedAt: at(2025, 2) }] }));
    const facts = Object.fromEntries(root.querySelectorAll(".fact").map((f) => [text(f, "dt")[0], text(f, "dd")[0]]));
    expect(facts).toMatchObject({ [copy.nowHeader]: "3", [copy.addedHeader]: "2", [copy.removedHeader]: "1", [copy.undatedHeader]: "2" });
    const plain = await renderSettled(view, real());
    expect(text(plain.root, ".fact dt")).not.toContain(copy.undatedHeader);
  });

  it("marks a snapshot that differs from the curve with a no pill and one that is close with a yes pill", async () => {
    const ledger = ledgerOf(snapshot("1", at(2025, 5), 3), snapshot("2", at(2025, 9), 30));
    const { root } = await renderSettled(view, real({}, { ledger }));
    const compare = root.querySelectorAll("table")[1] as FakeElement;
    const rows = compare.querySelectorAll("tbody tr");
    expect(rows.map((r) => r.querySelector(".pill")?.textContent)).toEqual(["Close", "Differs"]);
    expect(rows.map((r) => r.querySelector(".pill")?.className.replace("pill ", ""))).toEqual(["pill-yes", "pill-no"]);
    expect(text(rows[1] as FakeElement, "td")).toEqual(["30 saved", "3 on the curve", "27 more saved", "Differs"]);
    expect(text(root, ".tool-notes li")).toContain(copy.disagreeNote(1, 2, 27));
  });

  it("leaves out the comparison table when nothing was saved, and says so in a note", async () => {
    const { root } = await renderSettled(view, real({}, {}, false));
    expect(root.querySelectorAll("table")).toHaveLength(1);
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).not.toContain(copy.compareHeading);
    expect(text(root, ".tool-notes li")).toContain(copy.noSnapshotsNote);
  });

  it("does not call this session's imports saved, and says there is no earlier export when saving is on", async () => {
    const off = await renderSettled(view, real({}, { ledger: ledgerOf(snapshot("1", at(2025, 5), 3), snapshot("2", at(2025, 9), 30)) }, false));
    expect(off.root.querySelectorAll("table")).toHaveLength(1);
    expect(text(off.root, ".tool-notes li")).toEqual(expect.arrayContaining([copy.noSnapshotsNote]));
    expect(off.root.textContent).not.toMatch(/\d+ saved/);
    const on = await renderSettled(view, real());
    expect(text(on.root, ".tool-notes li")).toContain(copy.noEarlierNote);
    expect(text(on.root, ".tool-notes li")).not.toContain(copy.noSnapshotsNote);
  });

  it("shows only the latest 24 months and says how many there are", async () => {
    const friends = [person("a", at(2023, 1)), person("b", at(2025, 2))];
    const { root } = await renderSettled(view, real({ friends, deleted: [] }));
    const rows = (root.querySelectorAll("table")[0] as FakeElement).querySelectorAll("tbody tr");
    expect(rows).toHaveLength(24);
    expect(text(root, ".caption")).toContain(copy.monthsShownLine(24, 42));
    // The 24 is fixed on the page; the command lists more, and the line names the option.
    expect(copy.monthsShownLine(24, 42)).toBe("Showing the latest 24 months of 42. The command lists more with --months.");
  });

  it("calls what a passphrase protects the saved history, never a snapshot or turned saving on", () => {
    const strings: string[] = [];
    for (const value of Object.values(copy)) {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") for (const n of [0, 1, 2]) strings.push(String((value as (...a: number[]) => unknown)(n, n, n)));
    }
    expect(strings.length).toBeGreaterThan(40);
    expect(strings.filter((t) => /snapshot|turned saving on|saving turned on|turn saving on/i.test(t))).toEqual([]);
    expect(copy.noSnapshotsNote).toBe("No saved history was compared. Save your history with a passphrase in Settings to keep exports.");
    expect(copy.compareCaption).toBe("Saved exports compared with the curve");
    expect(copy.oneSnapshotNote).toBe("Only one saved export was found, so the comparison is a single point.");
    expect(copy.disagreeNote(1, 2, 27)).toBe("The curve and your saved history differ at 1 of 2 saved exports. The largest gap is 27 friends.");
  });

  it("writes each note as a short hedged sentence that shows no code", async () => {
    const lists: Lists = {
      friends: [person("a", at(2025, 1)), person("b"), person("c", at(2030, 1))],
      deleted: [{ ...person("c", at(2025, 2)), deletedAt: at(2025, 3) }, { ...person("e", at(2025, 4)), deletedAt: at(2025, 3) }, person("f", at(2025, 1))],
    };
    const { root } = await renderSettled(view, real(lists, { ledger: ledgerOf(snapshot("1", at(2025, 5), 3)), issues: [{ severity: "error", code: "x", message: "m" }] }));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(
      expect.arrayContaining([copy.curveHighNote, copy.exportErrorsNote, copy.undatedJoinsNote(1), copy.undatedLeavesNote(1), copy.badDatesNote(1), copy.leaveBeforeJoinNote(1), copy.reAddedNote(1), copy.oneSnapshotNote]),
    );
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
    expect(notes.join(" ")).toMatch(/may/);
    // Warnings and plain observations are told apart.
    expect(root.querySelectorAll(".tool-note-warning").length).toBeGreaterThan(0);
    expect(root.querySelectorAll(".tool-note-info").length).toBeGreaterThan(0);
  });

  it("announces the count politely once, and without a name", async () => {
    await renderSettled(view, real());
    expect(said).toEqual(["Friend count finished. Your list holds 3 friends."]);
  });
});

describe("when no friend has a date", () => {
  it("shows the honest empty state instead of a blank result, and still offers the command", async () => {
    const { root } = await renderSettled(view, real({ friends: [person("a"), person("b")], deleted: [] }));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll("table")).toHaveLength(0);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["friend-count"]));
    expect(said).toEqual([copy.emptyAnnounce]);
  });
});

describe("without an export", () => {
  it("says so plainly, offers Add export and still offers the command", () => {
    const { root } = render(view, emptyState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["friend-count"]));
    expect(root.querySelector(".tool-result")).toBeNull();
  });

  it("says saved history is not an export", () => {
    expect(text(render(view, stateWith({ ledger: base.ledger })).root, ".empty-body")).toEqual([tools.needs.exportLedgerBody]);
  });

  it("says a friends list is missing when the export has none", () => {
    const state = real({ friends: [], deleted: [] });
    expect(text(render(view, state).root, ".empty-title")).toEqual([tools.needs.friendsTitle]);
  });
});

describe("the privacy rules", () => {
  it("shows no username anywhere: not in a table, a note, an announcement or a label", async () => {
    const friends = [person("a", at(2025, 1)), person("b", at(2025, 2)), person("c")];
    const deleted = [{ ...person("d", at(2025, 1)), deletedAt: at(2025, 2) }];
    const { root } = await renderSettled(view, real({ friends, deleted }, { ledger: ledgerOf(snapshot("1", at(2025, 5), 4)), issues: [{ severity: "error", code: "x", message: `${CANARY} message` }] }));
    expect(root.textContent).not.toContain(CANARY);
    expect(said.join(" ")).not.toContain(CANARY);
    expect(root.querySelectorAll("code.username")).toHaveLength(0);
    for (const el of root.descendants()) for (const attr of ["aria-label", "title", "alt"]) expect(el.getAttribute(attr) ?? "").not.toContain(CANARY);
  });

  it("shows none of the sample's usernames either", async () => {
    const names = [...new Set((base.latest as ParsedExport).friends.friends.map((f) => f.username))].filter((n) => n.length >= 5);
    const { root } = await renderSettled(view, sample);
    for (const name of names) expect(root.textContent, name).not.toContain(name);
    expect(said.join(" ")).not.toMatch(/\balice\b/i);
  });
});
