/**
 * Friends backup: what it computes from the export the page holds, and what its page shows and downloads.
 * Synthetic data only. The backup holds usernames by design, so the page must show none of them: they live
 * only in the file that a button press writes.
 */
import { insights } from "@snappy-export/core";
import type { FriendRecord, ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText, displayTextWith } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/friends-backup/copy.ts";
import { descriptor } from "../../src/tools/friends-backup/index.ts";
import { backupFileName, computeFriendsBackup } from "../../src/tools/friends-backup/model.ts";
import { view } from "../../src/tools/friends-backup/view.ts";
import { RULES, collectCopy, lint, useNames } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { phrase, shown } from "./cell-text.ts";
import { render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

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
  saved.length = 0;
});

const person = (username: string, createdAt?: number): FriendRecord => (createdAt === undefined ? { username } : { username, createdAt });

/** A real (not sample) export made from the sample's, with its friends lists replaced. */
function real(lists: Partial<ParsedExport["friends"]>): State {
  const latest = base.latest as ParsedExport;
  return stateWith({ latest: { ...latest, friends: { ...latest.friends, ...lists } }, now: base.now, issues: [], parts: 1 });
}
const dataOf = (state: State) => toolData(state);
const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map(phrase);

/** Names that must appear only in the file. */
const CANARIES = ["zqcanary_ann", "zqcanary_bo", "zqcanary_cy", "zqcanary_di"];
const crafted = (): State =>
  real({
    friends: [person("zqcanary_ann", base.now - 30 * DAY), person("ZQCanary_Ann", base.now - 10 * DAY), person("zqcanary_bo"), person("zqcanary_cy", base.now + 5 * DAY), person("  ")],
    blocked: [person("zqcanary_cy")],
    ignored: [person("zqcanary_di", 0)],
  });

describe("the tool", () => {
  it("is a Friends tool in the requests color that needs an export with friends and shows the backup command", () => {
    expect(descriptor).toMatchObject({ id: "friends-backup", title: "Friends backup", group: "friends", category: "requests", needs: ["export", "friends"] });
    expect(descriptor.oneLiner.length).toBeLessThanOrEqual(56);
    expect(COMMANDS.backup.argv[0]).toBe("backup");
  });

  it("passes the copy lint on its own words", () => {
    const entries = collectCopy({ tool_friends_backup: copy });
    useNames([]);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });
});

describe("computeFriendsBackup", () => {
  it("backs up the sample as core does and counts each list", () => {
    const parsed = base.latest as ParsedExport;
    const result = computeFriendsBackup(dataOf(sample));
    const core = insights.friendsBackup.createFriendsBackup({ friends: parsed.friends.friends, blocked: parsed.friends.blocked, ignored: parsed.friends.ignored }, base.now);
    expect(result.backup).toEqual(core.backup);
    expect(result.notes).toEqual(core.notes);
    expect(result.counts.friends.people).toBe(core.backup.friends.length);
    expect(result.counts.friends.people).toBeGreaterThan(0);
    expect(result.total).toBe(core.backup.friends.length + core.backup.blocked.length + core.backup.ignored.length);
    expect(result.backup.takenAt).toBe(base.now);
  });

  it("merges repeats, drops unusable names and dates, and says how many of each by code and count", () => {
    const result = computeFriendsBackup(dataOf(crafted()));
    expect(result.counts.friends).toEqual({ people: 3, dated: 1 });
    expect(result.counts.blocked).toEqual({ people: 1, dated: 0 });
    expect(result.counts.ignored).toEqual({ people: 1, dated: 0 });
    const codes = Object.fromEntries(result.notes.map((n) => [n.code, n.params.count ?? 0]));
    expect(codes).toMatchObject({ "usernames-skipped": 1, "duplicates-merged": 1, "timestamps-in-future": 1, "lists-overlap": 1 });
    expect(result.notes.map((n) => n.code)).not.toContain("friends-empty");
  });

  it("holds no username in its notes or counts, only in the backup it keeps for the file", () => {
    const { backup, ...rest } = computeFriendsBackup(dataOf(crafted()));
    const json = JSON.stringify(rest);
    for (const name of CANARIES) expect(json, name).not.toContain(name);
    expect(JSON.stringify(backup)).toContain("zqcanary_ann");
  });

  it("calls an empty friends list out, and uses a date-less clock as unknown", () => {
    const empty = computeFriendsBackup(dataOf(real({ friends: [], blocked: [], ignored: [] })));
    expect(empty.total).toBe(0);
    expect(empty.notes.map((n) => n.code)).toContain("friends-empty");
    expect(computeFriendsBackup(dataOf(real({ friends: [person("zqcanary_ann")] }))).notes).toEqual([]);
  });

  it("keeps a date only up to now: a date equal to now stays, one a day later goes", () => {
    const at = (t: number) => computeFriendsBackup(dataOf(real({ friends: [person("zqcanary_ann", t)], blocked: [], ignored: [] }))).counts.friends.dated;
    expect(at(base.now)).toBe(1);
    expect(at(base.now + DAY)).toBe(0);
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeFriendsBackup(dataOf(initialState()))).toThrow();
  });

  it("names the file for the day it was made, and has a plain name when the time is unknown", () => {
    expect(backupFileName(Date.UTC(2026, 10, 7, 23, 59))).toBe("snappy-friends-backup-2026-11-07.json");
    expect(backupFileName(null)).toBe("snappy-friends-backup.json");
  });
});

describe("the page", () => {
  it("shows what the backup holds as a table of counts, the next steps, the download and the command", async () => {
    const { root } = await renderSettled(view, sample);
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toEqual([copy.contentsHeading, copy.nextHeading, copy.compareHeading, tools.downloadHeading, tools.commandHeading]);
    const table = root.querySelector("table") as FakeElement;
    expect(table.querySelector("caption")?.textContent).toBe(copy.contentsCaption);
    expect(text(table, "thead th")).toEqual([copy.listHeader, copy.peopleHeader, copy.datedHeader]);
    expect(text(table, "tbody th")).toEqual(["Friends", "Blocked", "Ignored"]);
    const first = table.querySelectorAll("tbody tr")[0] as FakeElement;
    const { friends } = computeFriendsBackup(dataOf(sample)).counts;
    // At phone width the column names are not repeated, so each cell says what it counts.
    expect(text(first, "td")).toEqual([copy.unitPeople(friends.people), copy.unitDated(friends.dated)]);
    // A wide page shows the bare number; the words stay for assistive technology and for a phone.
    expect(first.querySelectorAll("td").map(shown)).toEqual([friends.people.toLocaleString("en-US"), friends.dated.toLocaleString("en-US")]);
    expect(root.textContent).toMatch(/Made [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    expect(text(root, ".step-list li p")).toEqual([copy.saveStep, copy.keepStep, copy.compareStep]);
    expect(root.textContent).toContain(copy.downloadNote);
    const run = root.querySelectorAll(".command").find((c) => !c.classList.contains("command-copy-only")) as FakeElement;
    expect(run.querySelector("code")?.textContent).toBe(displayText(COMMANDS.backup));
    expect(run.querySelector(".command-head")?.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Copy", "Run"]);
  });

  it("names the compare option in the step and gives a Copy-only command for it, which says it needs a terminal", async () => {
    const { root } = await renderSettled(view, sample);
    expect(copy.compareStep).toContain("--compare");
    const block = root.querySelector(".command-copy-only") as FakeElement;
    expect(block).not.toBeNull();
    // The command is the catalog's backup command with the flag and a file to name, and the title says what it does.
    expect(block.querySelector("code")?.textContent).toBe(displayTextWith(COMMANDS.backup, ["--compare", "<file.json>"]));
    expect(block.querySelector("code")?.textContent).toMatch(/ backup .*--compare "<file\.json>"$/);
    expect(block.querySelector(".command-title")?.textContent).toBe(copy.compareTitle);
    // Copy only: no Run, no file chip, no output, and a line that says why.
    expect(block.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Copy"]);
    expect(block.textContent).toContain("This needs a terminal.");
    expect(text(root, ".section-title")).toContain(copy.compareHeading);
  });

  it("offers no compare command when there is nothing to back up", async () => {
    const { root } = await renderSettled(view, real({ friends: [person("  ")], blocked: [], ignored: [] }));
    expect(root.querySelector(".command-copy-only")).toBeNull();
  });

  it("announces the counts politely once, and without a name", async () => {
    await renderSettled(view, crafted());
    expect(said).toEqual(["Backup ready: 3 friends, 1 blocked, 1 ignored."]);
  });

  it("writes each note as a short sentence and shows no code", async () => {
    const { root } = await renderSettled(view, crafted());
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.skippedNote(1), copy.duplicatesNote(1), copy.futureDatesNote(1), copy.overlapNote(1)]));
    expect(root.querySelectorAll(".tool-note-warning")).toHaveLength(1);
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
    expect(notes.join(" ")).toMatch(/may/);
  });

  it("shows an honest empty state when no usable usernames are left, and no download", async () => {
    const { root } = await renderSettled(view, real({ friends: [person("  ")], blocked: [], ignored: [] }));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelector("table")).toBeNull();
    expect(root.querySelectorAll("button").filter((b) => b.textContent === copy.downloadLabel)).toHaveLength(0);
  });

  it("builds the file only on the press, and writes the exact core text", async () => {
    const state = crafted();
    const { root } = await renderSettled(view, state);
    expect(saved).toHaveLength(0);
    const button = root.querySelectorAll("button").find((b) => b.textContent === copy.downloadLabel) as FakeElement;
    said.length = 0;
    button.click();
    expect(saved).toHaveLength(1);
    const { backup } = computeFriendsBackup(dataOf(state));
    expect(saved[0]).toEqual({ fileName: backupFileName(base.now), text: insights.friendsBackup.backupToJson(backup), mime: "application/json" });
    const file = JSON.parse(saved[0]?.text ?? "{}") as { format: string; friends: { username: string }[] };
    expect(file.format).toBe("snappy-friends-backup");
    expect(file.friends.map((f) => f.username)).toContain("zqcanary_ann");
    expect(said).toEqual([tools.downloadSaved]);
  });

  it("never shows a username: not in a table, a note, the announcement or the page", async () => {
    const { root } = await renderSettled(view, crafted());
    const page = root.textContent;
    for (const name of CANARIES) {
      expect(page, name).not.toContain(name);
      for (const line of said) expect(line, name).not.toContain(name);
    }
    expect(root.querySelectorAll("code.username")).toHaveLength(0);
    expect(root.querySelectorAll("[aria-label],[title]").map((e) => `${e.getAttribute("aria-label") ?? ""}${e.getAttribute("title") ?? ""}`).join(" ")).not.toContain("zqcanary");
    // The sample's own friend names stay out of the page too.
    const parsed = base.latest as ParsedExport;
    for (const name of new Set(parsed.friends.friends.map((f) => f.username).filter((n) => n.length >= 5))) expect((await renderSettled(view, sample)).root.textContent, name).not.toContain(name);
  });
});

describe("without an export", () => {
  it("says so plainly, offers Add export and still offers the command", async () => {
    const { root } = render(view, initialState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.backup));
    expect(root.querySelector(".tool-result")).toBeNull();
    expect(root.querySelectorAll("button").filter((b) => b.textContent === copy.downloadLabel)).toHaveLength(0);
    await settled(root);
  });

  it("says saved history is not an export, and that an export with no friends has none", async () => {
    expect(text(render(view, stateWith({ ledger: base.ledger })).root, ".empty-body")).toEqual([tools.needs.exportLedgerBody]);
    expect(text(render(view, real({ friends: [] })).root, ".empty-title")).toEqual([tools.needs.friendsTitle]);
  });
});
