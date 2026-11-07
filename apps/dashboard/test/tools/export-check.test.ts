/**
 * Export check, the reference tool: what it computes from the export the page holds, and what its page shows.
 * Synthetic data only. Usernames and issue messages carry canaries that must never reach a result or the page.
 */
import type { ExportIssue, ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/export-check/copy.ts";
import { descriptor } from "../../src/tools/export-check/index.ts";
import { computeExportCheck } from "../../src/tools/export-check/model.ts";
import { view } from "../../src/tools/export-check/view.ts";
import type { FakeElement } from "../fake-dom.ts";
import { render, renderSettled, sampleState, sampleWorkspace, settled, stateWith } from "./harness.ts";

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

/** A real (not sample) export made from the sample's, with whatever is changed. */
function real(change: Partial<ParsedExport> = {}, ws: Partial<Workspace> = {}): State {
  const latest = { ...(base.latest as ParsedExport), ...change };
  return stateWith({ latest, now: base.now, issues: [], parts: 1, ...ws });
}
const dataOf = (state: State) => toolData(state);

describe("the tool", () => {
  it("is a Your export tool in the brand violet that needs an export and shows the check command", () => {
    expect(descriptor).toMatchObject({ id: "export-check", title: "Export check", group: "your-export", category: "cleanup", needs: ["export"] });
    expect(descriptor.oneLiner).toBe("Check that your export is complete.");
    expect(COMMANDS.check.argv[0]).toBe("check");
  });
});

describe("computeExportCheck", () => {
  it("checks the sample as core does: five sections, dates for chats, Snaps and Memories, and a verdict", () => {
    const { check, partsKnown } = computeExportCheck(dataOf(sample));
    expect(partsKnown).toBe(false);
    expect(check.sections.map((s) => s.id)).toEqual(["friends", "chat_history", "snap_history", "memories_list", "memories_files"]);
    expect(check.sections.every((s) => s.status === "present")).toBe(true);
    expect(check.coverage.chats.dated).toBeGreaterThan(0);
    expect(check.coverage.snaps.dated).toBeGreaterThan(0);
    expect(check.coverage.memories.dated).toBeGreaterThan(0);
    expect(["ready", "ready-with-notes"]).toContain(check.status);
    expect(check.age.basis).toBe("export-time");
  });

  it("holds no username, link or file name, and not the text of an issue", () => {
    const parsed = base.latest as ParsedExport;
    const issues: ExportIssue[] = [{ severity: "warning", code: "friend-count-mismatch", message: "ZQCANARY-message alice_zq" }];
    const names = [...parsed.friends.friends.map((f) => f.username), ...parsed.chats.slice(0, 200).map((c) => c.conversation)].filter((n) => n.length >= 5);
    const json = JSON.stringify(computeExportCheck(dataOf(real({}, { issues }))));
    expect(json).not.toContain("ZQCANARY");
    for (const name of new Set(names)) expect(json, name).not.toContain(name);
    expect(json).not.toMatch(/https?:|\.zip|\.json|memories\//i);
  });

  it("says how many parts it read when the import knew, so a lone part with Memories and no files may be a short export", () => {
    const noMedia = { bundledMedia: undefined, memoriesPairing: undefined };
    const known = computeExportCheck(dataOf(real(noMedia)));
    expect(known.partsKnown).toBe(true);
    expect(known.check.parts.count).toBe(1);
    expect(known.check.notes.map((n) => n.code)).toContain("more-parts-may-exist");
    expect(known.check.todo.map((t) => t.code)).toContain("add-other-parts");
    // With the count unknown (sample data) the page does not guess.
    const unknown = computeExportCheck(dataOf(real(noMedia, { parts: undefined })));
    expect(unknown.partsKnown).toBe(false);
    expect(unknown.check.notes.map((n) => n.code)).not.toContain("more-parts-may-exist");
  });

  it("passes on the export's own health notes by code, and calls the export incomplete when the count may be short", () => {
    const issues: ExportIssue[] = [
      { severity: "warning", code: "friend-count-mismatch", message: "m" },
      { severity: "info", code: "some-private-code", message: "m" },
    ];
    const { check } = computeExportCheck(dataOf(real({}, { issues })));
    expect(check.status).toBe("incomplete");
    expect(check.notes.map((n) => n.code)).toContain("friend-count-mismatch");
    expect(check.notes.map((n) => n.code)).not.toContain("some-private-code");
    expect(check.todo.map((t) => t.code)).toContain("choose-all-time");
  });

  it("calls an old export stale, and an HTML-only one unusable", () => {
    const old = computeExportCheck(dataOf(real({}, { now: (base.latest?.exportedAt ?? 0) + 200 * DAY }))).check;
    expect(old.age.level).toBe("stale");
    expect(old.notes.map((n) => n.code)).toContain("export-stale");
    expect(old.todo.map((t) => t.code)).toContain("request-newer-export");

    const html = computeExportCheck(
      dataOf(real({ fileList: ["html/chat_history.html", "html/friends.html"], friends: { ...(base.latest as ParsedExport).friends, friends: [], deletedFriends: [], sentRequests: [] }, chats: [], memories: [], bundledMedia: undefined, memoriesPairing: undefined })),
    ).check;
    expect(html.status).toBe("unusable");
    expect(html.notes[0]?.code).toBe("html-only-export");
    expect(html.todo.map((t) => t.code)).toContain("request-json-export");
  });

  it("asks for the missing history by section when the export has none", () => {
    const { check } = computeExportCheck(dataOf(real({ chats: [], fileList: ["json/friends.json"] })));
    const chat = check.sections.find((s) => s.id === "chat_history");
    const snap = check.sections.find((s) => s.id === "snap_history");
    expect(chat?.status).toBe("missing");
    expect(snap?.status).toBe("missing");
    expect(check.status).toBe("incomplete");
    expect(check.todo.find((t) => t.code === "request-sections")?.params.sections).toEqual(expect.arrayContaining(["chat_history", "snap_history"]));
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeExportCheck(dataOf(initialState()))).toThrow();
  });
});

const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);

describe("the page", () => {
  it("shows the verdict, what was found as a table with a pill for each section, the dates and the command", async () => {
    const { root } = await renderSettled(view, sample);
    const verdict = root.querySelector(".notice") as FakeElement;
    expect(verdict.classList.contains("notice-success") || verdict.classList.contains("notice-info")).toBe(true);
    expect(verdict.textContent).toMatch(/Your export looks (ready to use|usable, with a few notes)\./);
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toEqual([copy.foundHeading, copy.datesHeading, tools.notesHeading, tools.commandHeading]);

    const found = root.querySelectorAll("table")[0] as FakeElement;
    expect(found.querySelector("caption")?.textContent).toBe(copy.foundCaption);
    expect(text(found, "thead th")).toEqual([copy.sectionHeader, copy.statusHeader, copy.itemsHeader]);
    expect(text(found, "tbody th")).toEqual(["Friends list", "Chat history", "Snap history", "Memories list", "Memories files"]);
    expect(found.querySelectorAll(".pill-yes")).toHaveLength(5);
    for (const pill of found.querySelectorAll(".pill")) expect(pill.querySelectorAll("svg")).toHaveLength(1);

    const dates = root.querySelectorAll("table")[1] as FakeElement;
    expect(text(dates, "tbody th")).toEqual(["Chats", "Snaps", "Memories"]);
    expect(dates.textContent).toMatch(/\d{4}/);
    expect(root.textContent).toMatch(/Made [A-Z][a-z]{2} \d{1,2}, \d{4}, today\./);

    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.check));
  });

  it("says nothing about the number of parts for sample data, and states it for a real import", async () => {
    expect((await renderSettled(view, sample)).root.textContent).not.toMatch(/ZIP files? read/);
    const real3 = await renderSettled(view, real({}, { parts: 3 }));
    expect(real3.root.querySelector(".caption")?.textContent).toBe("3 ZIP files read.");
    expect((await renderSettled(view, real({}, { parts: 1 }))).root.querySelector(".caption")?.textContent).toBe("1 ZIP file read.");
  });

  it("announces the verdict politely once, and without a name", async () => {
    await renderSettled(view, sample);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^Export check finished\. Your export looks (ready to use|usable, with a few notes)\.$/);
  });

  it("marks a missing section with a no pill and an optional one with a dash, never by color alone", async () => {
    const { root } = await renderSettled(view, real({ chats: [], fileList: ["json/friends.json"], bundledMedia: undefined, memoriesPairing: undefined }));
    const found = root.querySelectorAll("table")[0] as FakeElement;
    const rows = found.querySelectorAll("tbody tr");
    const status = (row: FakeElement): string => row.querySelector(".pill")?.textContent ?? "";
    expect(rows.map(status)).toEqual(["Found", "Not found", "Not found", "Found", "Not found"]);
    expect(rows.map((r) => r.querySelector(".pill")?.className.replace("pill ", ""))).toEqual(["pill-yes", "pill-no", "pill-no", "pill-yes", "pill-optional"]);
    expect(root.querySelector(".notice")?.classList.contains("notice-warning")).toBe(true);
    // What to do comes as numbered steps, the request for the missing sections first.
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toContain(copy.todoHeading);
    expect(text(root, ".step-list li").some((s) => /Request your data again and include: chat history, Snap history\./.test(s))).toBe(true);
  });

  it("writes each note as a short hedged sentence, and no note shows a code", async () => {
    const issues: ExportIssue[] = [
      { severity: "warning", code: "friend-count-mismatch", message: "m" },
      { severity: "warning", code: "possibly-date-limited", message: "m" },
      { severity: "warning", code: "future-timestamps", message: "m" },
    ];
    const { root } = await renderSettled(view, real({}, { issues, now: (base.latest?.exportedAt ?? 0) + 100 * DAY }));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(
      expect.arrayContaining([copy.friendCountNote, copy.dateLimitedNote, copy.futureStampsNote, copy.staleNote(100)]),
    );
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
    // Snappy infers from files, so it says "may", not "is".
    expect(notes.join(" ")).toMatch(/may/);
    expect(root.querySelector(".notice")?.classList.contains("notice-warning")).toBe(true);
  });

  it("shows the right kind of verdict for each status", async () => {
    const friends = (base.latest as ParsedExport).friends;
    const unusable = real({ fileList: ["html/friends.html"], friends: { ...friends, friends: [], deletedFriends: [], sentRequests: [] }, chats: [], memories: [], bundledMedia: undefined, memoriesPairing: undefined });
    const incomplete = real({ chats: [], fileList: ["json/friends.json"] });
    const kindOf = async (state: State): Promise<string | undefined> => {
      const notice = (await renderSettled(view, state)).root.querySelector(".notice");
      return ["success", "info", "warning", "error"].find((k) => notice?.classList.contains(`notice-${k}`));
    };
    expect(await kindOf(real({ fileList: [...(base.latest as ParsedExport).fileList] }))).toBe("info");
    expect(await kindOf(incomplete)).toBe("warning");
    expect(await kindOf(unusable)).toBe("error");
    expect((await renderSettled(view, unusable)).root.querySelector(".notice")?.textContent).toContain(copy.verdict.unusable);
  });

  it("never shows a username, a link or a file name", async () => {
    const parsed = base.latest as ParsedExport;
    const names = [...new Set([...parsed.friends.friends.map((f) => f.username), ...parsed.chats.slice(0, 200).map((c) => c.conversation)])].filter((n) => n.length >= 5);
    const { root } = await renderSettled(view, sample);
    const page = root.textContent;
    for (const name of names) expect(page, name).not.toContain(name);
    expect(root.querySelectorAll("code.username")).toHaveLength(0);
    expect(root.querySelectorAll("a").filter((a) => (a.getAttribute("href") ?? "").startsWith("http"))).toHaveLength(0);
  });
});

describe("without an export", () => {
  it("says so plainly, offers Add export and still offers the command", () => {
    const { root } = render(view, initialState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.check));
    expect(root.querySelector(".tool-result")).toBeNull();
  });

  it("says saved history is not an export, and that a refused export was not added", async () => {
    expect(text(render(view, stateWith({ ledger: base.ledger })).root, ".empty-body")).toEqual([tools.needs.exportLedgerBody]);
    const refused = { ...initialState(), import: { phase: "failed" as const, step: 0, steps: 1, sample: false } };
    expect(text(render(view, refused).root, ".empty-body")).toEqual([tools.needs.exportFailedBody]);
    await settled(render(view, initialState()).root);
  });
});
