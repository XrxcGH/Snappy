/**
 * Regression tests for the export reader: checksums, what is decoded, bounded streaming, local
 * header times, and merging parts. Everything here is synthetic.
 */
import { unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ZipEntryError,
  bytesReader,
  describeStructureFromReader,
  forgetMediaHandles,
  formatStructureReport,
  inflateSource,
  insights,
  inspectExport,
  listZipEntries,
  mergeParsedExports,
  parseExportFromReader,
  planMemories,
  projectConversations,
  projectShapes,
  readZipEntry,
  validateExport,
} from "../../src/index.ts";
import type { MemoryItem, ParsedExport, RandomAccessReader, StreamSource } from "../../src/index.ts";
import { crc32 } from "../../src/export/crc32.ts";
import { enc } from "./helpers.ts";
import { buildFixtureZip } from "./zip-fixture.ts";

afterEach(() => vi.restoreAllMocks());

/** Everything any TextDecoder turns into text while `fn` runs. */
async function decodedDuring(fn: () => Promise<unknown>): Promise<string> {
  const original = TextDecoder.prototype.decode;
  const seen: string[] = [];
  vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (this: TextDecoder, ...args: Parameters<TextDecoder["decode"]>) {
    const text = original.apply(this, args);
    seen.push(text);
    return text;
  });
  await fn();
  return seen.join("\u0001");
}

const once = (bytes: Uint8Array): StreamSource => {
  let done = false;
  return { next: async () => (done ? null : ((done = true), bytes)) };
};
const drain = async <T>(gen: AsyncGenerator<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
};

// -------------------------------------------------------------------- CRC-32 ---

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("entry checksums", () => {
  const payload = enc({ alice: [{ From: "alice", "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", IsSender: false }] });
  const stored = zipSync({ "json/chat_history.json": [payload, { level: 0 }] });
  const deflated = zipSync({ "json/chat_history.json": [enc(JSON.stringify({ a: "x".repeat(5000) })), { level: 6 }] });

  /** Offset of the first central directory record. */
  const centralAt = (zip: Uint8Array): number => {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i + 4 <= zip.length; i++) if (view.getUint32(i, true) === 0x02014b50) return i;
    throw new Error("no central directory");
  };

  it("lists the declared checksum of each entry", async () => {
    const { entries } = await listZipEntries(bytesReader(stored));
    expect(entries[0]?.crc32).toBe(crc32(payload));
  });

  it("reads entries whose checksum matches", async () => {
    for (const zip of [stored, deflated]) {
      const reader = bytesReader(zip);
      const entry = (await listZipEntries(reader)).entries[0]!;
      expect(await readZipEntry(reader, entry)).toEqual(unzipSync(zip)["json/chat_history.json"]);
    }
  });

  it("refuses a stored entry with one flipped byte (the size is unchanged, so only the checksum can tell)", async () => {
    const bad = stored.slice();
    const at = bad.indexOf(payload[10] as number, 30 + "json/chat_history.json".length); // inside the data
    bad[at] = (bad[at] as number) ^ 0x01;
    const reader = bytesReader(bad);
    const entry = (await listZipEntries(reader)).entries[0]!;
    await expect(readZipEntry(reader, entry)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("refuses a deflated entry whose declared checksum does not match what inflates", async () => {
    const bad = deflated.slice();
    const view = new DataView(bad.buffer);
    view.setUint32(centralAt(bad) + 16, view.getUint32(centralAt(bad) + 16, true) ^ 0xdeadbeef, true);
    const reader = bytesReader(bad);
    const entry = (await listZipEntries(reader)).entries[0]!;
    await expect(readZipEntry(reader, entry)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("makes a streamed history fail loudly instead of passing flipped data on", async () => {
    // A flipped digit in a timestamp still parses as JSON: only the checksum notices.
    const bad = stored.slice();
    const at = bad.indexOf(0x32, 30 + "json/chat_history.json".length + 20); // a '2' in the data
    bad[at] = 0x33;
    const parsed = await parseExportFromReader(bytesReader(bad));
    expect(parsed.chats).toEqual([]);
    expect(parsed.issues.some((i) => i.code === "zip-entry-unreadable")).toBe(true);

    const reader = bytesReader(bad);
    const entry = (await listZipEntries(reader)).entries[0]!;
    const source = inflateSource(reader, entry);
    await expect(
      (async () => {
        while ((await source.next()) !== null);
      })(),
    ).rejects.toBeInstanceOf(ZipEntryError);
  });

  it("still streams an intact history", async () => {
    const parsed = await parseExportFromReader(bytesReader(stored));
    expect(parsed.chats).toHaveLength(1);
    expect(parsed.issues.some((i) => i.code === "zip-entry-unreadable")).toBe(false);
  });
});

// ------------------------------------------------------------- streaming bounds ---

describe("streaming projection", () => {
  const FIELDS = ["From", "IsSender"];

  it("does not fail the whole file because one record has a huge field name that matches nothing", async () => {
    const huge = "x".repeat(2 * 1024 * 1024);
    const json = `{"alice":[{"From":"alice","${huge}":1,"IsSender":true},{"From":"bob","IsSender":false}]}`;
    const out = await drain(projectConversations(once(enc(json)), { keepFields: FIELDS }));
    expect(out.map((o) => o.record)).toEqual([{ From: "alice", IsSender: true }, { From: "bob", IsSender: false }]);
  });

  it("still matches kept names written with escapes, and ignores case", async () => {
    const out = await drain(projectConversations(once(enc('{"k":[{"Fr\\u006fm":"a","issender":true}]}')), { keepFields: FIELDS }));
    expect(out[0]?.record).toEqual({ From: "a", IsSender: true });
  });

  it("hands on a chunk of many tiny records piece by piece and loses none", async () => {
    const records = 50_000;
    const json = `{"k":[${Array.from({ length: records }, () => '{"From":"a"}').join(",")}]}`;
    const out = await drain(projectConversations(once(enc(json)), { keepFields: FIELDS }));
    expect(out).toHaveLength(records);
  });

  it("gives the same records however the document is chunked, with batches in play", async () => {
    const json = enc(`{"k":[${Array.from({ length: 9000 }, (_, i) => `{"From":"u${i}","IsSender":${i % 2 === 0}}`).join(",")}]}`);
    const whole = await drain(projectConversations(once(json), { keepFields: FIELDS }));
    const pieces: Uint8Array[] = [];
    for (let at = 0; at < json.length; at += 4099) pieces.push(json.subarray(at, at + 4099));
    let next = 0;
    const chunked = await drain(projectConversations({ next: async () => pieces[next++] ?? null }, { keepFields: FIELDS }));
    expect(chunked).toEqual(whole);
    expect(whole).toHaveLength(9000);
  });
});

describe("shape projection", () => {
  const CANARY = "ZZCANARY-MSG-77";

  it("reports field names and value kinds and never decodes a value", async () => {
    const json = enc({
      "ZZCANARY-KEY": [
        { From: "ZZCANARY-FROM", Content: `${CANARY} hello`, IsSender: true, "Conversation Title": null, Created: "2023-04-01 12:30:00 UTC", "Created(microseconds)": 1680352200000000 },
        { Content: null, Nested: { a: [1, 2] }, List: [CANARY] },
      ],
    });
    const decoded = await decodedDuring(async () => {
      const out = await drain(projectShapes(once(json)));
      expect(out).toHaveLength(2);
      expect(out[0]?.kinds).toEqual({ From: "string", Content: "string", IsSender: "boolean", "Conversation Title": "null", Created: "string", "Created(microseconds)": "number" });
      expect(out[1]?.kinds).toEqual({ Content: "null", Nested: "object", List: "array" });
      expect(out.map((o) => o.conversation)).toEqual([0, 0]);
    });
    expect(decoded).not.toContain("CANARY-MSG");
    expect(decoded).not.toContain("ZZCANARY-FROM");
    expect(decoded).not.toContain("2023-04-01");
  });

  it("reports a field name over 64 bytes as an empty name", async () => {
    const out = await drain(projectShapes(once(enc(`{"k":[{"${"y".repeat(80)}":1,"From":"a"}]}`))));
    expect(out[0]?.kinds).toEqual({ "": "number", From: "string" });
  });

  it("numbers each conversation, so counts per conversation can be told apart", async () => {
    const out = await drain(projectShapes(once(enc('{"a":[{"x":1},{"x":2}],"b":[{"x":3}]}'))));
    expect(out.map((o) => [o.conversation, o.conversationKey])).toEqual([[0, "a"], [0, "a"], [1, "b"]]);
  });
});

// ------------------------------------------------------------------- inspect ---

describe("snappy-export inspect on a history", () => {
  const CANARY = "ZZCANARY-INSPECT-MSG";
  const history = {
    alice: [
      { From: "alice", Content: `${CANARY} one`, "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", "Created(microseconds)": 1680352200000000, IsSender: false, IsSaved: true, "Conversation Title": null },
      { From: "me", Content: null, "Media Type": "MEDIA", Created: "2023-04-02 12:30:00 UTC", "Created(microseconds)": 1680438600000000, IsSender: true, IsSaved: false, "Conversation Title": null },
    ],
  };
  const zip = zipSync({ "json/chat_history.json": enc(history), "json/snap_history.json": enc({ alice: [{ From: "alice", "Media Type": "IMAGE", Created: "2023-04-01 12:30:00 UTC", IsSender: false, Content: CANARY }] }) });

  it("never decodes message text, and still describes both histories", async () => {
    let text = "";
    const decoded = await decodedDuring(async () => {
      text = formatStructureReport(await describeStructureFromReader([bytesReader(zip)]));
    });
    expect(decoded).not.toContain("CANARY-INSPECT");
    expect(decoded).not.toContain("CANARY");
    expect(text).not.toContain("CANARY");
    expect(text).toContain("json/chat_history.json");
    expect(text).toContain("Content: one of");
    expect(text).toContain("IsSaved: boolean");
    expect(text).toContain("json/snap_history.json");
  });

  it("describes a damaged history with a fixed remark", async () => {
    const bad = zipSync({ "json/chat_history.json": enc('{"alice":[{"Content":"x"') });
    const report = await describeStructureFromReader([bytesReader(bad)]);
    expect(report.files[0]?.note).toBe("unparseable json");
    expect(report.files[0]?.structure).toBeUndefined();
  });
});

// -------------------------------------------------------- local header times ---

describe("Memories file times kept only in the local headers", () => {
  const T0 = Date.UTC(2025, 2, 1, 10, 0, 0);
  const dates = [T0, T0 + 3_600_000, T0 + 7_200_000];
  const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC";
  const uuid = (n: number): string => `0000000${n}-0000-4000-8000-00000000000${n}`;
  const listZip = (): Uint8Array =>
    buildFixtureZip([{ name: "json/memories_history.json", data: enc({ "Saved Media": dates.map((d) => ({ Date: stamp(d), "Media Type": "Image" })) }) }]);
  const filesZip = (extra: (d: number) => object): Uint8Array =>
    buildFixtureZip(dates.map((d, i) => ({ name: `memories/2025-03-01_${uuid(i + 1)}-main.jpg`, data: enc("x"), ...extra(d) })));

  async function pair(files: Uint8Array): Promise<ParsedExport> {
    return mergeParsedExports([await parseExportFromReader(bytesReader(listZip()), { part: 1 }), await parseExportFromReader(bytesReader(files), { part: 2 })]);
  }

  it("pairs by exact UTC time when only the local headers carry the extended timestamp", async () => {
    const merged = await pair(filesZip((d) => ({ utcMs: d, utcInLocalOnly: true })));
    expect(merged.bundledMedia?.every((f) => f.timeKind === "utc")).toBe(true);
    expect(merged.memoriesPairing).toMatchObject({ method: "utc-time", paired: 3 });
  });

  it("pairs by exact UTC time from an NTFS extra field (what 7-Zip writes)", async () => {
    const merged = await pair(filesZip((d) => ({ ntfsMs: d })));
    expect(merged.bundledMedia?.map((f) => f.timeMs)).toEqual(dates);
    expect(merged.memoriesPairing).toMatchObject({ method: "utc-time", paired: 3 });
  });

  it("looks at only a few local headers when none of them has a time", async () => {
    const many = buildFixtureZip(Array.from({ length: 60 }, (_, i) => ({ name: `memories/2025-03-01_${String(i).padStart(8, "0")}-0000-4000-8000-000000000000-main.jpg`, data: enc("x") })));
    const inner = bytesReader(many);
    let headerReads = 0;
    const counting: RandomAccessReader = {
      size: inner.size,
      read(start, end) {
        if (end - start === 30) headerReads++;
        return inner.read(start, end);
      },
    };
    await parseExportFromReader(counting, { part: 2 });
    expect(headerReads).toBeGreaterThan(0);
    expect(headerReads).toBeLessThanOrEqual(16);
  });
});

// ------------------------------------------------------------- merging parts ---

describe("mergeParsedExports", () => {
  const friendsJson = { Friends: [{ Username: "alice" }, { Username: "bob" }, { Username: "alice" }] };

  it("keeps a repeated username repeated, so one zip or several give the same friends and the same warning", async () => {
    const lists = await parseExportFromReader(bytesReader(buildFixtureZip([{ name: "json/friends.json", data: enc(friendsJson) }])), { part: 1 });
    const media = await parseExportFromReader(bytesReader(buildFixtureZip([{ name: "memories/2025-03-01_00000001-0000-4000-8000-000000000001-main.jpg", data: enc("x") }])), { part: 2 });
    expect(lists.friends.friends).toHaveLength(3);
    expect(mergeParsedExports([lists]).friends).toEqual(lists.friends);
    const merged = mergeParsedExports([lists, media]);
    expect(merged.friends.friends.map((f) => f.username)).toEqual(["alice", "bob", "alice"]);
    for (const parsed of [lists, merged]) {
      expect(validateExport(parsed, { now: Date.UTC(2025, 5, 1) }).map((i) => i.code)).toContain("duplicate-usernames");
    }
  });

  it("still collapses the same friend seen in two parts", async () => {
    const a = await parseExportFromReader(bytesReader(buildFixtureZip([{ name: "json/friends.json", data: enc({ Friends: [{ Username: "alice", "Creation Timestamp": "2022-01-01 00:00:00 UTC" }] }) }])), { part: 1 });
    const b = await parseExportFromReader(bytesReader(buildFixtureZip([{ name: "json/friends.json", data: enc({ Friends: [{ Username: "alice", "Creation Timestamp": "2021-01-01 00:00:00 UTC" }] }) }])), { part: 2 });
    const merged = mergeParsedExports([a, b]);
    expect(merged.friends.friends).toHaveLength(1);
    expect(merged.friends.friends[0]?.createdAt).toBe(Date.UTC(2021, 0, 1));
  });

  it("returns the one populated part's events as they were, in order, without sharing the list", () => {
    const events = Array.from({ length: 1000 }, (_, i) => ({ conversation: "alice", isGroup: false, direction: "sent" as const, kind: "TEXT", at: 1_000 + (i % 7) }));
    const part = (chats: ParsedExport["chats"]): ParsedExport => ({ friends: { friends: [], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] }, chats, memories: [], fileList: [], issues: [] });
    const merged = mergeParsedExports([part([]), part(events), part([])]);
    expect(merged.chats).toEqual(events); // repeats inside one part stay, in the order they came
    expect(merged.chats).not.toBe(events);
    // Two populated parts still collapse what both hold.
    expect(mergeParsedExports([part(events), part(events)]).chats).toEqual(events);
  });
});

// ------------------------------------------------------- forgetting file handles ---

describe("forgetMediaHandles", () => {
  const parsed = (): ParsedExport => ({
    friends: { friends: [], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] },
    chats: [],
    memories: [
      { id: "a", date: Date.UTC(2025, 2, 1), mediaType: "image", zipPath: "memories/2025-03-01_AAAAAAAA-0000-4000-8000-000000000001-main.jpg", partIndex: 2, sizeBytes: 10, overlayPaths: ["memories/x-overlay.png"], overlayParts: [3] },
      { id: "b", date: Date.UTC(2025, 2, 2), mediaType: "video", downloadUrl: "https://example.invalid/signed?token=secret", sizeBytes: 20 },
      { id: "c", date: Date.UTC(2025, 2, 3), mediaType: "video", downloadUrl: "https://example.invalid/signed?token=secret" },
    ],
    bundledMedia: [{ path: "memories/2025-03-01_AAAAAAAA-0000-4000-8000-000000000001-main.jpg", part: 2, role: "main", timeKind: "utc", timeMs: 1, size: 10 }],
    fileList: [],
    issues: [],
  });

  it("drops the media list, paths and links, keeping counts, sizes and parts", () => {
    const out = forgetMediaHandles(parsed());
    expect(out.bundledMedia).toBeUndefined();
    const text = JSON.stringify(out);
    for (const secret of ["memories/", "AAAAAAAA", "example.invalid", "token=secret", "x-overlay"]) expect(text).not.toContain(secret);
    expect(out.memories[0]).toMatchObject({ id: "a", partIndex: 2, sizeBytes: 10 });
  });

  it("keeps how many overlays an item has, each with only its plain extension", () => {
    const input = parsed();
    input.memories[0] = { ...(input.memories[0] as MemoryItem), overlayPaths: ["memories/ZQSECRET-overlay.PNG", "memories/odd.name.toolongext", "memories/third.webp"], overlayParts: [3, 3, 4] };
    const out = forgetMediaHandles(input);
    const paths = out.memories[0]?.overlayPaths as string[];
    expect(paths).toHaveLength(3);
    expect(paths.map((p) => /(\.[a-z0-9]+)?$/.exec(p)?.[1] ?? "")).toEqual([".png", "", ".webp"]);
    expect(JSON.stringify(out)).not.toMatch(/ZQSECRET|memories\/|toolongext/);
    expect(out.memories[0]?.overlayParts).toBeUndefined();
    expect(forgetMediaHandles(out)).toEqual(out);
    // The manifest names the same overlay files as before the handles were forgotten.
    const entries = (m: ParsedExport) => insights.rescueManifest.recordsFromPlan(planMemories(m.memories, { layout: "year-month" }).entries);
    expect(entries(out)).toEqual(entries(input));
  });

  it("keeps what the plan needs: two items with one link are still one duplicate, and two files stay two", () => {
    const before = planMemories(parsed().memories, { now: Date.UTC(2026, 0, 1) });
    const after = planMemories(forgetMediaHandles(parsed()).memories, { now: Date.UTC(2026, 0, 1) });
    expect(after.counts).toEqual(before.counts);
    expect(after.duplicates.map((d) => d.item.id)).toEqual(before.duplicates.map((d) => d.item.id));
    expect(after.duplicates).toHaveLength(1);
  });

  it("is idempotent and leaves its input alone", () => {
    const input = parsed();
    const once = forgetMediaHandles(input);
    expect(forgetMediaHandles(once)).toEqual(once);
    expect(input).toEqual(parsed());
  });
});

// ------------------------------------------------- friends and Memories lists ---

describe("friends and Memories lists are streamed", () => {
  const C_DN = "ZZCANARY-DISPLAY-NAME";
  const C_LOC = "ZZCANARY-LOCATION-37.7749";
  const C_SRC = "ZZCANARY-SOURCE";
  const friends = {
    Friends: [
      { Username: "Alice", "Display Name": C_DN, "Creation Timestamp": "2022-01-01 00:00:00 UTC", "Last Modified Timestamp": "2023-01-01 00:00:00 UTC", Source: C_SRC },
      { Username: "bob", "Display Name": `${C_DN}-2`, "Creation Timestamp": "2021-06-01 00:00:00 UTC" },
    ],
    "Deleted Friends": [{ Username: "carl", "Display Name": C_DN, "Creation Timestamp": "2020-01-01 00:00:00 UTC", "Last Modified Timestamp": "2022-05-05 00:00:00 UTC" }],
    "Friend Requests Sent": [{ Username: "dana", "Display Name": C_DN, "Creation Timestamp": "2024-01-01 00:00:00 UTC" }],
    "Pending Requests": [],
    "Mystery Section": [],
  };
  const memories = {
    "Saved Media": [
      { Date: "2023-04-01 12:30:00 UTC", "Media Type": "Image", Location: `Latitude, Longitude: ${C_LOC}`, "Download Link": "", "Media Download URL": "https://example.invalid/m1.jpg" },
      { Date: "2023-04-02 12:30:00 UTC", "Media Type": "Video", Location: C_LOC, "Download Link": "", "Media Download URL": "" },
    ],
  };
  const zip = zipSync({ "json/friends.json": enc(friends), "json/memories_history.json": enc(memories), "json/chat_history.json": enc({ alice: [{ From: "alice", Content: C_DN, Created: "2023-04-01 12:30:00 UTC", IsSender: false }] }) });

  it("never decodes a display name, a source or a location", async () => {
    let parsed: ParsedExport | undefined;
    const decoded = await decodedDuring(async () => {
      parsed = await parseExportFromReader(bytesReader(zip));
    });
    expect(decoded).not.toContain("CANARY");
    expect(parsed?.friends.friends.map((f) => f.username)).toEqual(["alice", "bob"]);
    expect(parsed?.friends.deletedFriends.map((f) => f.username)).toEqual(["carl"]);
    expect(parsed?.friends.sentRequests.map((f) => f.username)).toEqual(["dana"]);
    expect(parsed?.memories.map((m) => m.mediaType)).toEqual(["image", "video"]);
    expect(JSON.stringify(parsed)).not.toContain("CANARY");
  });

  // The same notes and records as reading the whole file in memory, for the shapes the parsers know.
  const shapes: [string, unknown, unknown][] = [
    ["a full export", friends, memories],
    ["a bare list of friends and of memories", [{ Username: "alice", "Display Name": C_DN }], [{ Date: "2023-04-01 12:30:00 UTC", "Media Type": "Image", Location: C_LOC }]],
    ["only an empty friends list", { Friends: [] }, { "Saved Media": [] }],
    ["a section that is not a list, and an unknown one with content", { Friends: null, Extra: "text", "Blocked Users": { a: 1 } }, { Other: "text" }],
    ["spellings with underscores and other aliases", { friends_list: [{ user: "alice", creation_time: "2022-01-01 00:00:00 UTC" }], removed_friends: [{ username: "bob", deleted_date: "2022-02-02 00:00:00 UTC" }] }, { memories: [{ capture_date: "2023-04-01 12:30:00 UTC", type: "video" }] }],
    ["no known section at all", { Unknown: [{ Username: "x" }] }, { Unknown: [] }],
    ["a top level that is not a list or an object", "text", 5],
    ["entries without a username, and a date that cannot be read", { Friends: [{ "Display Name": C_DN }, { Username: "ok" }] }, { "Saved Media": [{ Date: "not a date", "Media Type": "Image" }] }],
  ];
  it.each(shapes)("gives what the in-memory parse gives for %s", async (_name, friendsJson, memoriesJson) => {
    const z = zipSync({ "json/friends.json": enc(friendsJson), "json/memories_history.json": enc(memoriesJson) });
    const { parseExportZip } = await import("../../src/export/parse.ts");
    const streamed = await parseExportFromReader(bytesReader(z));
    const whole = parseExportZip(z);
    expect(streamed.friends).toEqual(whole.friends);
    expect(streamed.memories).toEqual(whole.memories);
    const notes = (p: ParsedExport): string[] => p.issues.filter((i) => /^(friends|memories|deleted|pending)/.test(i.code)).map((i) => `${i.severity} ${i.code} ${i.message}`);
    expect(notes(streamed)).toEqual(notes(whole));
  });

  it("describes a damaged list with the same fixed note as the in-memory parse", async () => {
    const z = zipSync({ "json/friends.json": enc('{"Friends":[{"Username":"a"') });
    const { parseExportZip } = await import("../../src/export/parse.ts");
    const streamed = await parseExportFromReader(bytesReader(z));
    expect(streamed.issues.find((i) => i.code === "json-parse-failed")?.message).toBe(parseExportZip(z).issues.find((i) => i.code === "json-parse-failed")?.message);
    expect(streamed.friends.friends).toEqual([]);
  });

  it("keeps locations out of memory in the Memories checks of snappy-export inspect too", async () => {
    let text = "";
    const decoded = await decodedDuring(async () => {
      text = (await inspectExport([bytesReader(zip)], { memoryLinks: true, checksOnly: true })).text;
    });
    expect(decoded).not.toContain("CANARY");
    expect(text).toContain("Memories");
    expect(text).not.toContain("CANARY");
  });
});
