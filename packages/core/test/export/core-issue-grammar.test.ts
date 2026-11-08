/**
 * Every notice the core produces, rendered with a count of 1 and of 2 (a count of 0 gives no notice),
 * must read as a sentence: "1 message could not be matched", "2 messages could not be matched",
 * never "1 messages" or "have could not". The scenarios below build the real notices from real
 * (synthetic) input, so a change to the wording of one of them is checked here as well.
 */
import { describe, expect, it } from "vitest";
import { parseChatHistoryJson, parseSnapHistoryJson } from "../../src/export/chats.ts";
import { parseFriendsJson } from "../../src/export/friends.ts";
import { attachBundledMedia, parseMemoriesJson } from "../../src/export/memories.ts";
import { classifyMemoryMedia } from "../../src/memories/pair.ts";
import type { MemoryItem } from "../../src/types.ts";
import type { ExportIssue } from "../../src/types.ts";
import { bytesReader, listZipEntries } from "../../src/export/zip-reader.ts";
import { buildFixtureZip } from "./zip-fixture.ts";

const T = "2024-02-01 10:00:00 UTC";
const times = <V>(n: number, make: (i: number) => V): V[] => Array.from({ length: n }, (_, i) => make(i));
const good = { From: "amy_1", "Media Type": "TEXT", Created: T, IsSender: false };

type Scenario = [name: string, code: string, make: (n: number) => ExportIssue[]];

const pick = (issues: ExportIssue[], code: string): ExportIssue[] => issues.filter((i) => i.code === code);

const chat = (parse: typeof parseChatHistoryJson, prefix: string): Scenario[] => [
  [`${prefix} invalid entries`, `${prefix}-invalid-entries`, (n) => parse({ amy_1: [good, ...times(n, () => "not an entry")] }).issues],
  [`${prefix} bad timestamps`, `${prefix}-bad-timestamp`, (n) => parse({ amy_1: [good, ...times(n, () => ({ From: "amy_1", IsSender: false }))] }).issues],
  [`${prefix} non-list values`, `${prefix}-non-list-values`, (n) => parse({ amy_1: [good], ...Object.fromEntries(times(n, (i) => [`k${i}`, "x"])) }).issues],
  [`${prefix} unknown direction`, `${prefix}-direction-unknown`, (n) => parse({ amy_1: times(n, () => ({ From: "amy_1", "Media Type": "TEXT", Created: T })) }).issues],
  [`${prefix} unmatched`, `${prefix}-conversation-unknown`, (n) => parse([good, ...times(n, () => ({ From: "me_user", "Media Type": "TEXT", Created: T, IsSender: true }))]).issues],
  [`${prefix} all groups`, `${prefix}-all-groups`, (n) => parse(Object.fromEntries(times(n, (i) => [`Group Number ${i}`, [{ From: "x_1", "Media Type": "TEXT", Created: T, IsSender: false }]]))).issues],
];

const friends: Scenario[] = [
  ["friends sections that are not lists", "friends-section-not-list", (n) => parseFriendsJson({ Friends: [{ Username: "amy" }], ...Object.fromEntries(times(n, (i) => [["Blocked Users", "Ignored Snapchatters"][i], "x"])) }).issues],
  ["friends entries without a username", "friends-invalid-entries", (n) => parseFriendsJson({ Friends: [{ Username: "amy" }, ...times(n, () => ({ "Display Name": "x" }))] }).issues],
  ["friends sections it does not know", "friends-unknown-sections", (n) => parseFriendsJson({ Friends: [{ Username: "amy" }], ...Object.fromEntries(times(n, (i) => [`Mystery ${i}`, [{ a: 1 }]])) }).issues],
  ["removed friends without a date", "deleted-date-guessed", (n) => parseFriendsJson({ Friends: [{ Username: "amy" }], "Deleted Friends": times(n, (i) => ({ Username: `gone${i}`, "Creation Timestamp": T })) }).issues],
];

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const T0 = Date.UTC(2025, 2, 4, 10, 20, 30);
const list = (n: number, extra: Partial<MemoryItem> = {}): MemoryItem[] =>
  times(n, (i) => ({ id: `m${i}`, date: T0 + i * 60_000, mediaType: i % 2 === 0 ? ("image" as const) : ("video" as const), ...extra }));
const filesFor = (items: MemoryItem[], indexes: number[], timed: "utc" | "dos" = "utc", shiftHours = 0) =>
  classifyMemoryMedia(
    indexes.map((i) => {
      const time = (items[i] as MemoryItem).date as number;
      return { name: `memories/${day(time)}_0000000${i}-aaaa-bbbb-cccc-00000000000${i}-main.jpg`, size: 10 + i, ...(timed === "utc" ? { mtimeUtcMs: time } : { mtimeDosMs: time + shiftHours * 3_600_000 }) };
    }),
    1,
  );

const memories: Scenario[] = [
  ["Memories entries that cannot be read", "memories-invalid-entries", (n) => parseMemoriesJson({ "Saved Media": [{ Date: T, "Media Type": "Image" }, ...times(n, () => "x")] }).issues],
  ["Memories with a bad date", "memories-bad-date", (n) => parseMemoriesJson({ "Saved Media": [{ Date: T, "Media Type": "Image" }, ...times(n, () => ({ Date: "not a date", "Media Type": "Image" }))] }).issues],
  ["Memories with no file or link", "memories-no-media-source", (n) => attachBundledMedia(list(n), []).issues],
  ["Memories missing from the files", "memories-unmatched-items", (n) => {
    const items = list(n + 9);
    return attachBundledMedia(items, filesFor(items, times(9, (i) => i))).issues;
  }],
  ["Memories that share a time", "memories-ambiguous-items", (n) => {
    // Two list entries a day apart from each other's file, so only the date and type can pair them, and several share a day.
    // A day with n entries and one file. For n = 1 a second entry on that day has a link, so it is not missing: exactly one is ambiguous.
    const items: MemoryItem[] = [
      { id: "a", date: Date.UTC(2024, 0, 1, 9), mediaType: "image" },
      ...times(n, (i) => ({ id: `d${i}`, date: Date.UTC(2024, 0, 2, 9 + i), mediaType: "image" as const })),
      ...(n === 1 ? [{ id: "linked", date: Date.UTC(2024, 0, 2, 20), mediaType: "image" as const, downloadUrl: "https://example.invalid/x" }] : []),
    ];
    const files = classifyMemoryMedia(
      [
        { name: "memories/2024-01-01_00000001-aaaa-bbbb-cccc-000000000001-main.jpg", size: 5 },
        { name: "memories/2024-01-02_00000002-aaaa-bbbb-cccc-000000000002-main.jpg", size: 5 },
      ],
      1,
    );
    return attachBundledMedia(items, files).issues;
  }],
  ["Memories clock offset", "memories-time-offset", (n) => {
    const items = list(12);
    return attachBundledMedia(items, filesFor(items, times(10, (i) => i), "dos", -n)).issues;
  }],
];

/** A zip whose directory says it holds `declared` entries while it holds two. */
async function mismatch(declared: number): Promise<ExportIssue[]> {
  const zip = buildFixtureZip([{ name: "a.json", data: new Uint8Array(3) }, { name: "b.json", data: new Uint8Array(3) }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      view.setUint16(i + 8, declared, true);
      view.setUint16(i + 10, declared, true);
      break;
    }
  }
  return (await listZipEntries(bytesReader(zip))).issues;
}

const SCENARIOS: Scenario[] = [...chat(parseChatHistoryJson, "chat"), ...chat(parseSnapHistoryJson, "snap"), ...friends, ...memories];

/** The things a notice must not say. */
const BAD: [string, RegExp][] = [
  ["a plural noun after 1", /\b1 (?!of\b)[A-Za-z]+(?:ies|s)\b(?!\.)/],
  ["a singular noun after 2 or more", /\b(?:[2-9]|\d{2,}) (?:message|Snap|friend|section|entry|item|Memory|file|conversation|hour)\b/],
  ["a verb that does not agree", /\b(?:has|have|is|are|was|were) (?:could|does|do|has|have)\b/],
  ["a doubled word", /\b(\w+) \1\b/i],
];

describe("every count-dependent notice reads as a sentence for 1 and for 2", () => {
  for (const [name, code, make] of SCENARIOS) {
    for (const n of [1, 2]) {
      it(`${name}: ${n}`, () => {
        const hits = pick(make(n), code);
        expect(hits, `no ${code} notice for ${n}`).toHaveLength(1);
        const message = (hits[0] as ExportIssue).message;
        for (const [what, re] of BAD) expect(message, `${what}: ${message}`).not.toMatch(re);
        expect(message.startsWith(String(n)) || /^(?:Snappy|The|\d)/.test(message), message).toBe(true);
      });
    }
    // A clock that is the same as UTC is still a clock Snappy allowed for, so zero hours has its own note.
    if (code !== "memories-time-offset") {
      it(`${name}: none for 0`, () => {
        expect(pick(make(0), code)).toEqual([]);
      });
    }
  }

  it("the ZIP count mismatch notice", async () => {
    for (const declared of [1, 5]) {
      const message = pick(await mismatch(declared), "zip-entry-count-mismatch")[0]?.message ?? "";
      expect(message).toBe(`The ZIP file says it holds ${declared} ${declared === 1 ? "item" : "items"}, but Snappy found 2. It may be damaged.`);
    }
  });
});

describe("the notices that were wrong", () => {
  it("1 and 60 messages that could not be matched", () => {
    const flat = (n: number) => parseChatHistoryJson([good, ...times(n, () => ({ From: "me_user", "Media Type": "TEXT", Created: T, IsSender: true }))]).issues;
    expect(pick(flat(1), "chat-conversation-unknown")[0]?.message).toBe("1 message could not be matched to a conversation and was skipped.");
    expect(pick(flat(2), "chat-conversation-unknown")[0]?.message).toBe("2 messages could not be matched to a conversation and were skipped.");
    expect(pick(parseSnapHistoryJson([{ ...good }, { From: "me_user", "Media Type": "IMAGE", Created: T, IsSender: true }]).issues, "snap-conversation-unknown")[0]?.message).toBe("1 Snap could not be matched to a conversation and was skipped.");
  });

  it("Memories that share a time: Memory shares, Its file is / Memories share, Their files are", () => {
    const render = (n: number) => pick(memories[4]![2](n), "memories-ambiguous-items")[0]?.message;
    expect(render(1)).toBe("1 saved Memory shares a time with others, so Snappy did not guess. Its file is in your ZIP files.");
    expect(render(2)).toBe("2 saved Memories share a time with others, so Snappy did not guess. Their files are in your ZIP files.");
  });

  it("a clock offset of 1 hour, of 2 hours and of none", () => {
    const render = (n: number) => pick(memories[5]![2](n), "memories-time-offset")[0]?.message;
    expect(render(1)).toBe("The Memories files keep their times on a clock 1 hour behind UTC. Snappy allowed for that.");
    expect(render(2)).toBe("The Memories files keep their times on a clock 2 hours behind UTC. Snappy allowed for that.");
    expect(render(0)).toBe("The Memories files keep their times on a clock set to UTC. Snappy allowed for that.");
  });

  it("the only conversation, and one saved Memory", () => {
    expect(pick(chat(parseChatHistoryJson, "chat")[5]![2](1), "chat-all-groups")[0]?.message).toBe(
      "Snappy treated the only conversation as a group chat. The export layout may differ from what it expects.",
    );
    expect(pick(attachBundledMedia(list(1), filesFor(list(1), [])).issues, "memories-unmatched-items")).toEqual([]);
    const one = list(1);
    const r = attachBundledMedia(one, classifyMemoryMedia([{ name: "memories/2020-01-01_00000001-aaaa-bbbb-cccc-000000000001-main.jpg", size: 5, mtimeUtcMs: Date.UTC(2020, 0, 1) }], 1));
    expect(pick(r.issues, "memories-unmatched-items")[0]?.message).toBe("1 of 1 saved Memory has no file in your ZIP files.");
  });
});
