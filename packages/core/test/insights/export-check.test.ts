import { describe, expect, it } from "vitest";
import { checkExport } from "../../src/insights/export-check.ts";
import type { ExportCheckInput } from "../../src/insights/export-check.ts";
import { emptyFriends } from "../../src/export/friends.ts";
import { describeStructure } from "../../src/export/inspect.ts";
import { parseExportFiles, validateExport } from "../../src/export/parse.ts";
import type { LayoutSummary } from "../../src/export/layout-report.ts";
import { buildSyntheticExport } from "../../src/testing/synthetic-export.ts";
import type { ChatEvent, ExportIssue, MemoryItem, ParsedExport } from "../../src/types.ts";
import { DAY_MS } from "../../src/util.ts";

const NOW = Date.UTC(2026, 5, 1);
const ALL_FILES = ["json/friends.json", "json/chat_history.json", "json/snap_history.json", "json/memories_history.json"];

type Parsed = ExportCheckInput["parsed"];
type Over = Partial<Omit<Parsed, "friends">> & { friends?: Partial<ParsedExport["friends"]> };

function mk(over: Over = {}): Parsed {
  return { chats: [], memories: [], fileList: ALL_FILES, ...over, friends: { ...emptyFriends(), ...over.friends } };
}
const friends = (n: number) => Array.from({ length: n }, (_, i) => ({ username: `u${i}` }));
const ev = (daysAgo: number, kind = "TEXT", extra: Partial<ChatEvent> = {}): ChatEvent => ({
  conversation: "u0",
  isGroup: false,
  direction: "sent",
  kind,
  at: NOW - daysAgo * DAY_MS,
  ...extra,
});
const mem = (daysAgo: number | null, i = 0): MemoryItem => ({ id: `m${i}`, date: daysAgo === null ? null : NOW - daysAgo * DAY_MS, mediaType: "image" });

/** A complete, fresh export that other tests then break in one way. */
function good(over: Over = {}): Parsed {
  return mk({
    friends: { friends: friends(5) },
    chats: [ev(400), ev(10, "TEXT"), ev(20, "IMAGE"), ev(15, "VIDEO")],
    memories: [mem(900, 1), mem(30, 2)],
    exportedAt: NOW - 5 * DAY_MS,
    bundledMedia: [{ part: 2, path: "memories/a.jpg" } as never],
    ...over,
  });
}
const run = (parsed: Parsed, extra: Partial<ExportCheckInput> = {}) => checkExport({ parsed, now: NOW, partCount: 3, ...extra });
const codes = (r: ReturnType<typeof checkExport>) => r.notes.map((n) => n.code);
const section = (r: ReturnType<typeof checkExport>, id: string) => r.sections.find((s) => s.id === id);

describe("checkExport status", () => {
  it("is ready for a complete, fresh export", () => {
    const r = run(good());
    expect(r.status).toBe("ready");
    expect(r.todo).toEqual([]);
    expect(r.sections.map((s) => [s.id, s.status])).toEqual([
      ["friends", "present"],
      ["chat_history", "present"],
      ["snap_history", "present"],
      ["memories_list", "present"],
      ["memories_files", "present"],
    ]);
    expect(r.parts).toEqual({ count: 3, unreadable: 0, empty: 0 });
  });

  it("is unusable for empty input and says what to do", () => {
    const r = checkExport({ parsed: mk({ fileList: [] }), now: NOW });
    expect(r.status).toBe("unusable");
    expect(r.parts.count).toBe(0);
    expect(r.todo[0]?.code).toBe("add-export-files");
    expect(r.age).toEqual({ basis: "none", at: null, ageDays: null, level: "unknown" });
    expect(r.coverage.chats).toMatchObject({ count: 0, oldest: null, newest: null, spanDays: null });
  });

  it("is unusable without friends, and asks for that section", () => {
    const r = run(mk({ chats: [ev(5)], fileList: ["json/chat_history.json"] }));
    expect(r.status).toBe("unusable");
    expect(section(r, "friends")?.status).toBe("missing");
    expect(r.todo.find((a) => a.code === "request-sections")?.params).toEqual({ sections: expect.arrayContaining(["friends", "snap_history", "memories_list"]) });
  });

  it("is unusable for an HTML-only export", () => {
    const r = run(mk({ fileList: ["index.html", "html/friends.html"] }));
    expect(r.status).toBe("unusable");
    expect(codes(r)).toContain("html-only-export");
    expect(r.todo.map((a) => a.code)).toContain("request-json-export");
    expect(r.todo.map((a) => a.code)).not.toContain("request-sections");
  });

  it("is incomplete when a recommended section is missing", () => {
    const r = run(good({ fileList: ["json/friends.json", "json/chat_history.json", "json/memories_history.json"], chats: [ev(5, "TEXT")] }));
    expect(r.status).toBe("incomplete");
    expect(section(r, "snap_history")?.status).toBe("missing");
    expect(r.todo).toContainEqual({ code: "request-sections", params: { sections: ["snap_history"] } });
  });

  it("tells an empty file from a missing one", () => {
    const r = run(good({ chats: [ev(5, "IMAGE")] }));
    expect(section(r, "chat_history")).toMatchObject({ status: "empty", count: 0 });
    expect(r.status).toBe("incomplete");
    // An empty file is not something a new request would fix.
    expect(r.todo.some((a) => a.code === "request-sections")).toBe(false);
  });

  it("flags unreadable files from the structure report", () => {
    const structure = { showKeys: false, notes: [], files: [{ name: "json/chat_history.json", kind: "json" as const, note: "unparseable json" }] };
    const r = run(good({ chats: [ev(5, "IMAGE")], fileList: [] }), { structure });
    expect(section(r, "chat_history")?.status).toBe("unreadable");
    expect(r.todo).toContainEqual({ code: "request-sections", params: { sections: ["chat_history"] } });
  });

  it("is ready-with-notes for a stale but complete export", () => {
    const r = run(good({ exportedAt: NOW - 200 * DAY_MS, chats: [ev(400, "TEXT"), ev(300, "IMAGE")], memories: [mem(500)] }));
    expect(r.status).toBe("ready-with-notes");
    expect(r.age).toMatchObject({ basis: "export-time", ageDays: 200, level: "stale" });
    expect(codes(r)).toContain("export-stale");
    expect(r.todo.map((a) => a.code)).toEqual(["request-newer-export"]);
  });
});

describe("parts", () => {
  it("counts unreadable and empty parts", () => {
    const layout: LayoutSummary = { parts: [{ files: 10, folders: [] }, { files: 0, folders: [] }, { files: 0, folders: [] }] };
    const r = run(good(), { partCount: undefined, layout, unreadableParts: [2, 2, 9, -1, 1.5] });
    expect(r.parts).toEqual({ count: 3, unreadable: 1, empty: 1 });
    expect(r.status).toBe("incomplete");
    expect(r.todo).toContainEqual({ code: "reread-parts", params: { count: 1 } });
    expect(codes(r)).toEqual(expect.arrayContaining(["parts-unreadable", "parts-empty"]));
  });

  it("is unusable when every part is unreadable", () => {
    const r = run(good(), { partCount: 2, unreadableParts: [0, 1] });
    expect(r.status).toBe("unusable");
    expect(r.todo[0]?.code).toBe("add-export-files");
  });

  it("reads unreadable parts from the structure report when no list is given", () => {
    const structure = { showKeys: false, notes: ["part 2: zip unreadable"], files: [] };
    expect(run(good(), { structure, partCount: 2 }).parts.unreadable).toBe(1);
  });

  it("marks the part the structure report names, so an unreadable empty part is not counted twice", () => {
    const layout: LayoutSummary = { parts: [{ files: 10, folders: [] }, { files: 0, folders: [] }, { files: 0, folders: [] }] };
    const structure = { showKeys: false, notes: ["part 3: zip unreadable", "part 3: zip unreadable", "part 9: zip unreadable"], files: [] };
    const r = run(good(), { partCount: undefined, layout, structure });
    // Part 3 is unreadable; only part 2 is a readable part with no files.
    expect(r.parts).toEqual({ count: 3, unreadable: 1, empty: 1 });
    const first = run(good(), { partCount: undefined, layout, structure: { ...structure, notes: ["part 1: zip has too many entries to describe"] } });
    expect(first.parts).toEqual({ count: 3, unreadable: 1, empty: 2 });
  });

  it("reads a single unreadable zip without a part prefix", () => {
    const structure = { showKeys: false, notes: ["zip unreadable"], files: [] };
    const r = run(good(), { partCount: 1, structure });
    expect(r.parts.unreadable).toBe(1);
    expect(r.status).toBe("unusable");
  });

  it("hints that more parts may exist when a lone part has a Memories list but no files", () => {
    const r = run(good({ bundledMedia: undefined }), { partCount: 1 });
    expect(codes(r)).toEqual(expect.arrayContaining(["more-parts-may-exist", "memories-files-not-found"]));
    expect(r.todo.map((a) => a.code)).toContain("add-other-parts");
    expect(codes(run(good({ bundledMedia: undefined }), { partCount: 3 }))).not.toContain("more-parts-may-exist");
  });

  it("does not hint at more parts when the part count was only guessed", () => {
    const guessed = checkExport({ parsed: good({ bundledMedia: undefined }), now: NOW });
    expect(guessed.parts.count).toBe(1);
    expect(codes(guessed)).not.toContain("more-parts-may-exist");
    expect(guessed.todo.map((a) => a.code)).not.toContain("add-other-parts");
    // A layout with one part is a real count.
    const layout: LayoutSummary = { parts: [{ files: 10, folders: [] }] };
    const known = checkExport({ parsed: good({ bundledMedia: undefined }), now: NOW, layout });
    expect(codes(known)).toContain("more-parts-may-exist");
  });

  it("falls back to one part when files exist and no count is given", () => {
    expect(checkExport({ parsed: good(), now: NOW }).parts.count).toBe(1);
  });
});

describe("date coverage", () => {
  it("reports oldest, newest and span for chats, Snaps and Memories separately", () => {
    const r = run(good());
    expect(r.coverage.chats).toMatchObject({ count: 2, dated: 2, oldest: NOW - 400 * DAY_MS, newest: NOW - 10 * DAY_MS, spanDays: 390 });
    expect(r.coverage.snaps).toMatchObject({ count: 2, oldest: NOW - 20 * DAY_MS, newest: NOW - 15 * DAY_MS, spanDays: 5 });
    expect(r.coverage.memories).toMatchObject({ count: 2, oldest: NOW - 900 * DAY_MS, newest: NOW - 30 * DAY_MS });
  });

  it("handles a single item", () => {
    const r = run(good({ chats: [ev(7)] }));
    expect(r.coverage.chats).toMatchObject({ count: 1, oldest: NOW - 7 * DAY_MS, newest: NOW - 7 * DAY_MS, spanDays: 0 });
  });

  it("reports the span in whole days, rounded down", () => {
    const r = run(good({ chats: [ev(10), ev(10 - 1.6)], memories: [mem(3), mem(3 - 0.999, 2)] }));
    expect(r.coverage.chats.spanDays).toBe(1);
    expect(r.coverage.memories.spanDays).toBe(0);
  });

  it("counts items without a usable date and leaves them out of the range", () => {
    const r = run(good({ chats: [ev(5), ev(0, "TEXT", { at: Number.NaN }), ev(0, "TEXT", { at: undefined as unknown as number })], memories: [mem(null), mem(null, 2)] }));
    expect(r.coverage.chats).toMatchObject({ count: 3, dated: 1, undated: 2 });
    expect(r.coverage.memories).toMatchObject({ count: 2, dated: 0, undated: 2, oldest: null, spanDays: null });
    expect(r.notes).toContainEqual({ code: "dates-missing", severity: "info", params: { section: "memories_list", count: 2 } });
  });

  it("leaves future dates out of the range and warns", () => {
    const r = run(good({ chats: [ev(5), ev(-10), ev(-400)] }));
    expect(r.coverage.chats).toMatchObject({ count: 3, dated: 1, future: 2, newest: NOW - 5 * DAY_MS });
    expect(r.notes).toContainEqual({ code: "dates-in-future", severity: "warning", params: { section: "chat_history", count: 2 } });
    expect(r.status).toBe("incomplete"); // Snap history is empty here
  });

  it("allows a small clock slack", () => {
    const r = run(good({ memories: [mem(-1), mem(5, 2)] }));
    expect(r.coverage.memories.future).toBe(0);
  });

  it("treats exactly now plus 2 days as dated and one millisecond more as future", () => {
    const at = (offset: number): ChatEvent => ev(0, "TEXT", { at: NOW + 2 * DAY_MS + offset });
    const edge = run(good({ chats: [at(0)], memories: [{ id: "m", date: NOW + 2 * DAY_MS, mediaType: "image" }] }));
    expect(edge.coverage.chats).toMatchObject({ dated: 1, future: 0, newest: NOW + 2 * DAY_MS });
    expect(edge.coverage.memories).toMatchObject({ dated: 1, future: 0 });
    const over = run(good({ chats: [at(1)], memories: [{ id: "m", date: NOW + 2 * DAY_MS + 1, mediaType: "image" }] }));
    expect(over.coverage.chats).toMatchObject({ dated: 0, future: 1, newest: null });
    expect(over.coverage.memories).toMatchObject({ dated: 0, future: 1 });
  });

  it("warns about future dates in Snaps and Memories too", () => {
    const r = run(good({ chats: [ev(5, "TEXT"), ev(-30, "IMAGE"), ev(-31, "VIDEO")], memories: [mem(5), mem(-40, 2), mem(-41, 3), mem(-42, 4)] }));
    expect(r.notes).toContainEqual({ code: "dates-in-future", severity: "warning", params: { section: "snap_history", count: 2 } });
    expect(r.notes).toContainEqual({ code: "dates-in-future", severity: "warning", params: { section: "memories_list", count: 3 } });
    expect(r.notes.some((n) => n.code === "dates-in-future" && n.params.section === "chat_history")).toBe(false);
  });
});

describe("age", () => {
  it("uses the export time when known", () => {
    expect(run(good({ exportedAt: NOW - 45 * DAY_MS })).age).toEqual({ basis: "export-time", at: NOW - 45 * DAY_MS, ageDays: 45, level: "aging" });
    expect(run(good({ exportedAt: NOW - 30 * DAY_MS })).age.level).toBe("fresh");
    expect(run(good({ exportedAt: NOW - 91 * DAY_MS })).age.level).toBe("stale");
  });

  it("switches level exactly after 30 and 90 whole days", () => {
    const level = (days: number) => run(good({ exportedAt: NOW - days * DAY_MS })).age.level;
    expect([29, 30, 31].map(level)).toEqual(["fresh", "fresh", "aging"]);
    expect([89, 90, 91].map(level)).toEqual(["aging", "aging", "stale"]);
    // Whole days: 30 days and 23 hours is still day 30.
    expect(run(good({ exportedAt: NOW - 31 * DAY_MS + 1 })).age).toMatchObject({ ageDays: 30, level: "fresh" });
  });

  it("allows an export time up to now plus 2 days and flags anything later", () => {
    expect(run(good({ exportedAt: NOW + 2 * DAY_MS })).age).toMatchObject({ ageDays: 0, level: "fresh" });
    expect(run(good({ exportedAt: NOW + 2 * DAY_MS + 1 })).age).toMatchObject({ ageDays: null, level: "future" });
  });

  it("falls back to the newest dated item and says so", () => {
    const r = run(good({ exportedAt: undefined }));
    expect(r.age).toMatchObject({ basis: "newest-activity", at: NOW - 10 * DAY_MS, level: "fresh" });
    expect(codes(r)).toContain("age-from-activity");
    const old = run(good({ exportedAt: undefined, chats: [ev(500), ev(400, "IMAGE")], memories: [mem(600)] }));
    expect(old.age.level).toBe("stale");
    expect(old.todo.map((a) => a.code)).not.toContain("request-newer-export");
  });

  it("treats an export time in the future as suspect, not as age zero", () => {
    const r = run(good({ exportedAt: NOW + 30 * DAY_MS }));
    expect(r.age).toMatchObject({ level: "future", ageDays: null });
    expect(codes(r)).toContain("export-date-in-future");
    expect(r.todo.map((a) => a.code)).toContain("check-export-date");
    expect(r.status).toBe("ready-with-notes");
  });

  it("is unknown without a usable now", () => {
    const r = checkExport({ parsed: good(), now: Number.NaN, partCount: 3 });
    expect(r.age.level).toBe("unknown");
    expect(r.coverage.chats.future).toBe(0);
  });
});

describe("validation results", () => {
  const issue = (code: string, severity: ExportIssue["severity"] = "warning"): ExportIssue => ({ code, severity, message: "m" });

  it("passes on known codes only and asks for All Time", () => {
    const r = run(good(), { validation: [issue("possibly-date-limited"), issue("zz-unknown-code"), issue("memories-missing", "info")] });
    expect(r.status).toBe("incomplete");
    expect(codes(r)).toContain("possibly-date-limited");
    expect(codes(r)).not.toContain("zz-unknown-code");
    expect(codes(r)).not.toContain("memories-missing");
    expect(r.todo).toContainEqual({ code: "choose-all-time", params: {} });
  });

  it.each(["friends-empty-but-deleted", "possibly-date-limited", "friend-count-mismatch"])("treats %s as a sign of a limited export", (code) => {
    const r = run(good(), { validation: [issue(code)] });
    expect(r.status).toBe("incomplete");
    expect(codes(r)).toContain(code);
    expect(r.todo).toContainEqual({ code: "choose-all-time", params: {} });
  });

  it.each(["duplicate-usernames", "future-timestamps"])("passes on %s without calling the export limited", (code) => {
    const r = run(good(), { validation: [issue(code)] });
    expect(r.status).toBe("ready-with-notes");
    expect(codes(r)).toContain(code);
    expect(r.todo.map((a) => a.code)).not.toContain("choose-all-time");
  });

  it("passes on a validation code with empty params and raises info to warning", () => {
    const r = run(good(), { validation: [issue("possibly-date-limited", "info"), issue("future-timestamps", "error")] });
    expect(r.notes).toContainEqual({ code: "possibly-date-limited", severity: "warning", params: {} });
    expect(r.notes).toContainEqual({ code: "future-timestamps", severity: "error", params: {} });
  });

  it("orders notes by severity, then by first appearance", () => {
    const r = run(good({ exportedAt: NOW - 60 * DAY_MS }), { partCount: 1, validation: [issue("duplicate-usernames"), issue("friends-empty-but-deleted", "error")] });
    const ranks = r.notes.map((n) => n.severity);
    expect(ranks).toEqual([...ranks].sort((a, b) => ["error", "warning", "info"].indexOf(a) - ["error", "warning", "info"].indexOf(b)));
    expect(r.notes[0]?.code).toBe("friends-empty-but-deleted");
  });

  it("works on real validateExport output", () => {
    const parsed = parseExportFiles(buildSyntheticExport({ now: NOW, realisticMemories: true, friendCount: 40, memoryCount: 60 }));
    const r = checkExport({ parsed, now: NOW, validation: validateExport(parsed, { now: NOW }), partCount: 1 });
    expect(["ready", "ready-with-notes"]).toContain(r.status);
    expect(section(r, "friends")?.count).toBeGreaterThan(0);
  });
});

describe("real parser and inspect output", () => {
  it("accepts a StructureReport and checks a synthetic export", () => {
    const files = buildSyntheticExport({ now: NOW, realisticMemories: true, friendCount: 40, memoryCount: 60 });
    const parsed = parseExportFiles(files);
    const r = checkExport({ parsed, now: NOW, structure: describeStructure(files), partCount: 3 });
    expect(r.parts.count).toBe(3);
    expect(r.coverage.chats.count).toBeGreaterThan(0);
    expect(r.coverage.snaps.count).toBeGreaterThan(0);
    expect(r.coverage.memories.count).toBeGreaterThan(0);
    expect(r.age.basis).toBe("newest-activity");
  });

  it("reports the older export of a phase pair as aging next to the later one", () => {
    const parse = (phase: 1 | 2) => parseExportFiles(buildSyntheticExport({ now: NOW, phase, friendCount: 40, memoryCount: 60 }));
    const p2 = parse(2);
    const r1 = checkExport({ parsed: parse(1), now: NOW, partCount: 1 });
    const r2 = checkExport({ parsed: p2, now: NOW, partCount: 1 });
    expect((r1.age.ageDays ?? 0) - (r2.age.ageDays ?? 0)).toBe(120);
    expect(r1.age.level).toBe("stale");
  });
});

describe("duplicates and counts", () => {
  it("counts friends that differ only by case once and notes it", () => {
    const r = run(good({ friends: { friends: [{ username: "Bob" }, { username: "bob" }, { username: "BOB" }, { username: "amy" }] } }));
    expect(section(r, "friends")?.count).toBe(2);
    expect(r.notes).toContainEqual({ code: "duplicate-usernames", severity: "warning", params: { count: 2 } });
    expect(r.status).toBe("ready-with-notes");
  });

  it("counts repeats in sent requests like validateExport does, without changing the friend count", () => {
    const parsed = good({ friends: { friends: [{ username: "amy" }, { username: "bob" }], sentRequests: [{ username: "cy" }, { username: "CY" }, { username: "cy" }] } });
    const r = run(parsed);
    expect(section(r, "friends")?.count).toBe(2);
    expect(r.notes).toContainEqual({ code: "duplicate-usernames", severity: "warning", params: { count: 2 } });
    const both = run(good({ friends: { friends: [{ username: "amy" }, { username: "Amy" }], sentRequests: [{ username: "cy" }, { username: "cy" }] } }));
    expect(both.notes).toContainEqual({ code: "duplicate-usernames", severity: "warning", params: { count: 2 } });
    // Same count as validateExport reports for the same lists (no case differences here).
    const plain = good({ friends: { friends: [{ username: "amy" }, { username: "amy" }], sentRequests: [{ username: "cy" }, { username: "cy" }] } });
    const v = validateExport(plain as unknown as ParsedExport, { now: NOW }).find((i) => i.code === "duplicate-usernames");
    expect(v?.message.startsWith("2 ")).toBe(true);
    expect(run(plain).notes.find((n) => n.code === "duplicate-usernames")?.params.count).toBe(2);
  });

  it("reports unmatched Memories entries as a count", () => {
    const r = run(good({ memoriesPairing: { items: 9, mainFiles: 5, paired: 5, unmatchedItems: 4, unmatchedFiles: 0, overlays: 0, ambiguous: 0, method: "utc-time", offsetHours: 0 } }));
    expect(r.notes).toContainEqual({ code: "memories-without-file", severity: "info", params: { count: 4 } });
  });
});

describe("large input and determinism", () => {
  it("handles 20 000 events and Memories and gives the same result twice", () => {
    const chats = Array.from({ length: 20_000 }, (_, i) => ev(i % 700, i % 3 === 0 ? "IMAGE" : "TEXT"));
    const memories = Array.from({ length: 20_000 }, (_, i) => mem(i % 2000, i));
    const parsed = good({ chats, memories, friends: { friends: friends(12_000) } });
    // No wall-clock bound: the check is one linear pass, and a timing assert is flaky on a busy machine.
    const a = run(parsed);
    expect(a.coverage.chats.count + a.coverage.snaps.count).toBe(20_000);
    expect(a.coverage.memories.spanDays).toBe(1999);
    expect(section(a, "friends")?.count).toBe(12_000);
    expect(run(parsed)).toEqual(a);
  });

  it("does not change its input", () => {
    const parsed = good();
    const before = JSON.stringify(parsed);
    run(parsed);
    expect(JSON.stringify(parsed)).toBe(before);
  });
});

describe("privacy", () => {
  const CANARY = "zzcanary_rowan";

  it("never puts a username, file name or message text into a result", () => {
    const secret = "ZQCANARY-MSG-1";
    const parsed = good({
      friends: { friends: [{ username: CANARY }, { username: `${CANARY}_2` }], sentRequests: [{ username: `${CANARY}_3` }] },
      chats: [ev(5, "TEXT", { conversation: CANARY }), ev(6, "IMAGE", { conversation: `group:${CANARY}`, isGroup: true })],
      fileList: [...ALL_FILES, `memories/${CANARY}.jpg`, `chat_media/${secret}.jpg`],
    });
    const hostile: ExportIssue[] = [
      { severity: "error", code: `${CANARY}-code`, message: `${CANARY} ${secret}` },
      { severity: "warning", code: "possibly-date-limited", message: `${CANARY} ${secret}` },
    ];
    const structure = { showKeys: false, notes: [`part 1: ${CANARY}`], files: [{ name: `${CANARY}.json`, kind: "json" as const, note: CANARY }] };
    const r = run(parsed, { validation: hostile, structure });
    const text = JSON.stringify(r);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain(secret);
    expect(text.toLowerCase()).not.toContain("zzcanary");
    // Every string in the result is a code or id defined by the module.
    const strings: string[] = [];
    JSON.stringify(r, (_k, v) => (typeof v === "string" && strings.push(v), v));
    for (const s of strings) expect(s).toMatch(/^[a-z_-]+$/);
  });
});
