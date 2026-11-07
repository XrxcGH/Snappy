import { describe, expect, it } from "vitest";
import {
  bytesReader,
  describeStructureFromReader,
  formatLayoutSummary,
  formatMemoryLinkCheck,
  formatMemoryTimeCheck,
  formatStructureReport,
  inspectExport,
  layoutSummary,
  listParts,
  memoriesListOf,
  memoryLinkCheck,
  memoryTimeCheck,
  nameShape,
} from "../../src/index.ts";
import type { RandomAccessReader } from "../../src/index.ts";
import { enc } from "./helpers.ts";
import { buildFixtureZip } from "./zip-fixture.ts";
import type { FixtureEntry } from "./zip-fixture.ts";

// ------------------------------------------------------------------ fixtures ---

/** A UUID-shaped id, different for every n. */
const uuid = (n: number): string => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const pad = (n: number): string => String(n).padStart(2, "0");
const dateText = (i: number): string => `2025-03-${pad(i)} 10:00:00 UTC`;
const dateMs = (i: number): number => Date.UTC(2025, 2, i, 10, 0, 0);
const kindOf = (i: number): "Image" | "Video" => (i % 2 === 0 ? "Video" : "Image");
const HOUR = 3_600_000;

interface Link {
  download?: string;
  media?: string;
}

/** A memories_history.json with `count` entries, one per day. */
function memoriesJson(count: number, links: (i: number) => Link = () => ({ download: "", media: "" })): unknown {
  return {
    "Saved Media": Array.from({ length: count }, (_, k) => {
      const i = k + 1;
      const l = links(i);
      return { Date: dateText(i), "Media Type": kindOf(i), Location: "Latitude, Longitude: 13.371337, 73.37", "Download Link": l.download ?? "", "Media Download URL": l.media ?? "" };
    }),
  };
}

type TimeMode = "utc" | "dos-offset" | "unrelated";

/** The main file for entry i, with the stored time the mode asks for. */
function memoryFile(i: number, mode: TimeMode, offsetHours = 0): FixtureEntry {
  const ext = kindOf(i) === "Image" ? "jpg" : "mp4";
  const name = `memories/2025-03-${pad(i)}_${uuid(i)}-main.${ext}`;
  const data = new Uint8Array(40).fill(0x61);
  if (mode === "utc") return { name, data, utcMs: dateMs(i) };
  if (mode === "dos-offset") return { name, data, dosMs: dateMs(i) + offsetHours * HOUR };
  return { name, data, utcMs: dateMs(i) + 1_234_567_000 };
}

/** Part 1 (json) and part 2 (memories media), like a real multi-part export. */
function twoParts(count: number, mode: TimeMode, offsetHours = 0, links?: (i: number) => Link): RandomAccessReader[] {
  const files = Array.from({ length: count }, (_, k) => memoryFile(k + 1, mode, offsetHours));
  return [
    bytesReader(buildFixtureZip([{ name: "json/memories_history.json", data: enc(memoriesJson(count, links)) }, { name: "json/friends.json", data: enc({ Friends: [] }) }])),
    bytesReader(buildFixtureZip([...files, { name: `memories/2025-03-01_${uuid(1)}-overlay.png`, data: new Uint8Array(10), utcMs: dateMs(1) }, { name: "memories/index.html", data: enc("<p>x</p>") }])),
  ];
}

/** The list inside a memories_history.json built by memoriesJson. */
const listOf = (json: unknown): unknown[] => memoriesListOf(json) as unknown[];

const allOn = { layout: true, memoryLinks: true, mtimeCheck: true } as const;

// ---------------------------------------------------------------- name shapes ---

describe("nameShape", () => {
  it("masks digits and letters of every script and keeps only a few punctuation marks", () => {
    expect(nameShape("2024-03-01_ab12CD")).toBe("9999-99-99_aa99AA");
    expect(nameShape("Ünal李-7.jpg")).toBe("Aaaaa-9.aaa");
    expect(nameShape("bob@example.com +1")).toBe("aaa?aaaaaaa.aaa ?9");
    expect(nameShape("é")).toBe("a");
    expect(nameShape("x".repeat(200))).toHaveLength(60);
  });
});

// --------------------------------------------------------------------- layout ---

describe("layoutSummary", () => {
  const SECRET = "zqcanary-private";
  const entries = async () => {
    const zip = buildFixtureZip([
      { name: "json/friends.json", data: enc({}) },
      { name: "html/index.html", data: enc("<p>x</p>") },
      { name: "html/sub/page.html", data: enc("<p>y</p>") },
      { name: `chat_media/${SECRET}-1.jpg`, data: new Uint8Array(2000) },
      { name: `chat_media/${SECRET}-2.jpg`, data: new Uint8Array(1000) },
      { name: "chat_media/clip.MP4", data: new Uint8Array(500) },
      { name: `${SECRET}_folder/a.bob99`, data: new Uint8Array(5) },
      { name: `${SECRET}_folder/b`, data: new Uint8Array(5) },
      { name: "other_private/c.txt", data: new Uint8Array(5) },
      { name: "index.html", data: enc("<p>z</p>") },
      { name: "dir/", data: new Uint8Array(0) },
    ]);
    return (await listParts([bytesReader(zip)])).parts;
  };

  it("counts files, sizes and extensions per folder, and numbers folders it does not know", async () => {
    const summary = layoutSummary(await entries());
    expect(summary.parts).toHaveLength(1);
    const part = summary.parts[0]!;
    expect(part.files).toBe(10); // the directory entry is not a file
    const by = Object.fromEntries(part.folders.map((f) => [f.label, f]));
    expect(Object.keys(by).sort()).toEqual(["(top level)", "<folder-1>", "<folder-2>", "chat_media", "html", "json"]);
    expect(by["chat_media"]).toMatchObject({ files: 3, bytes: 3500, inSubfolders: 0 });
    expect(by["chat_media"]!.extensions).toEqual([{ label: "jpg", count: 2 }, { label: "mp4", count: 1 }]);
    expect(by["html"]).toMatchObject({ files: 2, inSubfolders: 1 });
    // Unknown folders are numbered in name order: other_private first, then the private folder.
    expect(by["<folder-1>"]!.extensions).toEqual([{ label: "txt", count: 1 }]);
    expect(by["<folder-2>"]!.extensions).toEqual([{ label: "(none)", count: 1 }, { label: "(other)", count: 1 }]); // a.bob99 is not a vocabulary extension
    // Shapes seen fewer than three times are not listed (a rare one could point at a single file); they are only counted.
    expect(by["chat_media"]!.nameShapes).toEqual([]);
    expect(by["chat_media"]!.rareShapeFiles).toBe(3);
    expect(by["json"]!.nameShapes).toEqual([]); // JSON and HTML pages have no shapes
    expect(by["json"]!.rareShapeFiles).toBe(0);
  });

  it("prints no name, only shapes", async () => {
    const text = formatLayoutSummary(layoutSummary(await entries()));
    expect(text.toLowerCase()).not.toContain("zqcanary");
    expect(text.toLowerCase()).not.toContain("bob99");
    expect(text.toLowerCase()).not.toContain("other_private");
    expect(text).toContain("Folder totals (names of files are never shown)");
    expect(text).toContain("part 1: 10 files");
    expect(text).toContain("  chat_media/  3 files, 3 KB  [jpg 2, mp4 1]");
    expect(text).toContain("      3 more with name shapes seen fewer than 3 times (not listed)");
    expect(text).toContain("  (top level)  1 files, 8 bytes  [html 1]");
  });

  it("lists a shape only when three files share it, and never shows the digit and letter pattern of an id", async () => {
    const hex = (n: number): string => (n * 2654435761 >>> 0).toString(16).padStart(8, "0");
    const named = (n: number): string => `memories/2025-03-0${(n % 9) + 1}_${uuid(n)}-main.jpg`;
    const zip = buildFixtureZip([
      ...Array.from({ length: 6 }, (_, n) => ({ name: named(n + 1), data: new Uint8Array(3) })),
      ...Array.from({ length: 3 }, (_, n) => ({ name: `chat_media/word~${hex(n + 7)}.jpg`, data: new Uint8Array(3) })),
      { name: `chat_media/other~${hex(99)}.jpg`, data: new Uint8Array(3) },
    ]);
    const summary = layoutSummary((await listParts([bytesReader(zip)])).parts);
    const folders = Object.fromEntries(summary.parts[0]!.folders.map((f) => [f.label, f]));
    expect(folders["memories"]!.nameShapes).toEqual([{ label: "9999-99-99_<uuid>-aaaa.jpg", count: 6 }]);
    expect(folders["chat_media"]!.nameShapes).toEqual([{ label: "aaaa~<hex>.jpg", count: 3 }]);
    expect(folders["chat_media"]!.rareShapeFiles).toBe(1); // "other~..." is a different shape seen once
    const text = formatLayoutSummary(summary);
    // No letter-or-digit pattern of a 32-character id survives anywhere in the report.
    expect(text).not.toMatch(/[9aA]{8}-[9aA]{4}-/);
    expect(text).toContain("name shape 6x: 9999-99-99_<uuid>-aaaa.jpg");
  });

  it("numbers unknown folders the same way whatever order the entries come in", async () => {
    const parts = await entries();
    const reversed = [[...(parts[0] ?? [])].reverse()];
    expect(formatLayoutSummary(layoutSummary(reversed))).toBe(formatLayoutSummary(layoutSummary(parts)));
  });

  it("reports each part on its own", async () => {
    const readers = twoParts(4, "utc");
    const { parts } = await listParts(readers);
    const summary = layoutSummary(parts);
    expect(summary.parts.map((p) => p.files)).toEqual([2, 6]);
    expect(summary.parts[1]!.folders.map((f) => f.label)).toEqual(["memories"]);
  });
});

// ---------------------------------------------------------------- list helper ---

describe("memoriesListOf", () => {
  it("finds the saved-media list in the shapes a file may have", () => {
    expect(memoriesListOf({ "Saved Media": [1, 2] })).toEqual([1, 2]);
    expect(memoriesListOf({ Other: [9], "saved media": [1] })).toEqual([1]);
    expect(memoriesListOf({ Whatever: [3] })).toEqual([3]);
    expect(memoriesListOf([5])).toEqual([5]);
    expect(memoriesListOf({ a: 1 })).toBeUndefined();
    expect(memoriesListOf("x")).toBeUndefined();
    expect(memoriesListOf(null)).toBeUndefined();
  });
});

// ----------------------------------------------------------------- link check ---

describe("memoryLinkCheck", () => {
  const HOST = "zqcanary-cdn.example";

  it("matches entries to files by an ID in the link and prints only masked patterns", async () => {
    const links = (i: number): Link => ({ download: i <= 3 ? `https://${HOST}/dl/${uuid(i)}?mid=${uuid(i)}&sig=ZQSECRET${i}` : "", media: i === 4 ? "not a link" : "" });
    const { parts } = await listParts(twoParts(5, "utc", 0, links));
    const c = memoryLinkCheck(listOf(memoriesJson(5, links)), parts);
    expect(c).toMatchObject({ entries: 5, mediaFiles: 6, distinctFileIds: 5, entriesWithLinkText: 4, entriesWithId: 3, matchedById: 3, filesMatchedById: 3 });
    expect(c.idParameters).toEqual([{ label: "<path>", count: 3 }, { label: "mid", count: 3 }]);
    expect(c.mediaTypes).toEqual([{ label: "image", count: 3 }, { label: "video", count: 2 }]);
    expect(c.matchedByDate).toBe(5);

    const text = formatMemoryLinkCheck(c);
    for (const secret of [HOST, "zqcanary", "ZQSECRET", uuid(1), uuid(2), "example"]) expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    expect(text).toContain("parameters mid[99999999-999, 36 chars]");
    expect(text).toContain("1x Media Download URL: not a URL");
    expect(text).not.toContain("Result: no entry has an ID");
  });

  it("says plainly when every link is empty, as in a 2026 export", async () => {
    const readers = twoParts(6, "utc");
    const { parts } = await listParts(readers);
    const c = memoryLinkCheck(listOf(memoriesJson(6)), parts);
    expect(c).toMatchObject({ entries: 6, entriesWithLinkText: 0, entriesWithId: 0, matchedById: 0, filesMatchedById: 0 });
    expect(c.linkPatterns).toEqual([{ label: "Download Link: empty", count: 6 }, { label: "Media Download URL: empty", count: 6 }]);
    const text = formatMemoryLinkCheck(c);
    expect(text).toContain("6x Download Link: empty");
    expect(text).toContain("Result: no entry has an ID in its links, so links cannot pair entries with files.");
    expect(text).toContain("link parameter names that carry an ID: none");
  });

  it("tolerates entries that are not objects, odd types and missing fields", async () => {
    const { parts } = await listParts(twoParts(2, "utc"));
    const c = memoryLinkCheck([null, 7, "x", { "Media Type": 5, "Download Link": 9 }, { Date: "garbage" }], parts);
    expect(c.entries).toBe(5);
    expect(c.entriesWithLinkText).toBe(0);
    expect(c.mediaTypes.map((t) => t.label).sort()).toEqual(["missing"]);
  });
});

// ----------------------------------------------------------------- time check ---

describe("memoryTimeCheck", () => {
  const run = async (readers: RandomAccessReader[], count = 6) => {
    const { parts } = await listParts(readers);
    return memoryTimeCheck(readers, parts, listOf(memoriesJson(count)));
  };

  it("pairs by the stored UTC time when it equals the list's date to the second", async () => {
    const c = await run(twoParts(6, "utc"));
    expect(c).toMatchObject({ entries: 6, mediaFiles: 7, unreadableHeaders: 0, filesWithUtc: 7, filesWithDosOnly: 0, mainFiles: 6, distinctMainTimes: 6, verdict: "direct" });
    expect(c.pairing).toMatchObject({ method: "utc-time", offsetHours: 0, paired: 6, unmatchedItems: 0, unmatchedFiles: 0, overlays: 1 });
    expect(c.dayVsName).toEqual({ same: 6, earlier: 0, later: 0, other: 0 });
    expect(c.roles).toEqual([{ label: "main", count: 6 }, { label: "overlay", count: 1 }]);
    expect(c.entriesSharingASecond).toBe(0);
    expect(formatMemoryTimeCheck(c)).toContain("Result: stored times match the list's dates directly");
  });

  it("detects a whole-hour offset when only DOS wall-clock times exist", async () => {
    for (const hours of [2, -5, 9]) {
      const c = await run(twoParts(6, "dos-offset", hours));
      expect(c.verdict, `offset ${hours}`).toBe("offset");
      expect(c.pairing).toMatchObject({ method: "offset-time", offsetHours: hours, paired: 6 });
      expect(c.filesWithDosOnly).toBe(6);
      const text = formatMemoryTimeCheck(c);
      expect(text).toContain(`whole-hour offset ${hours >= 0 ? "+" : ""}${hours} h`);
    }
  });

  it("falls back to file-name date and type when times do not match, and says so", async () => {
    const c = await run(twoParts(6, "unrelated"));
    expect(c.verdict).toBe("fallback");
    expect(c.pairing.method).toBe("date-type");
    expect(formatMemoryTimeCheck(c)).toContain("falls back to the date in the file name plus the media type");
  });

  it("reports no files and no readable dates without throwing", async () => {
    const onlyJson = [bytesReader(buildFixtureZip([{ name: "json/memories_history.json", data: enc(memoriesJson(3)) }]))];
    expect((await run(onlyJson, 3)).verdict).toBe("no-files");
    const readers = twoParts(3, "utc");
    const { parts } = await listParts(readers);
    const noDates = await memoryTimeCheck(readers, parts, [{ "Media Type": "Image" }, null]);
    expect(noDates.verdict).toBe("no-list");
    expect(noDates.entriesWithUnreadableDate).toBe(2);
  });

  it("counts list entries that share a second (they cannot be told apart by time)", async () => {
    const readers = twoParts(3, "utc");
    const { parts } = await listParts(readers);
    const same = [{ Date: dateText(1) }, { Date: dateText(1) }, { Date: dateText(2) }];
    expect((await memoryTimeCheck(readers, parts, same)).entriesSharingASecond).toBe(2);
  });

  it("buckets how the stored day differs from the day in the file name", async () => {
    const readers = [
      bytesReader(
        buildFixtureZip([
          { name: `memories/2025-03-01_${uuid(1)}-main.jpg`, utcMs: dateMs(1) },
          { name: `memories/2025-03-01_${uuid(2)}-main.jpg`, utcMs: dateMs(2) },
          { name: `memories/2025-03-03_${uuid(3)}-main.jpg`, utcMs: dateMs(2) },
          { name: `memories/2025-03-20_${uuid(4)}-main.jpg`, utcMs: dateMs(2) },
        ]),
      ),
    ];
    const { parts } = await listParts(readers);
    const c = await memoryTimeCheck(readers, parts, []);
    expect(c.dayVsName).toEqual({ same: 1, earlier: 1, later: 1, other: 1 });
  });

  it("reads only each entry's header: no byte of media data is requested", async () => {
    const marker = Uint8Array.from("MEDIABYTES-NEVER".split("").map((ch) => ch.charCodeAt(0)));
    const files: FixtureEntry[] = Array.from({ length: 4 }, (_, k) => ({ ...memoryFile(k + 1, "utc"), data: marker }));
    const zip = buildFixtureZip([{ name: "json/memories_history.json", data: enc(memoriesJson(4)) }, ...files]);
    const forbidden: [number, number][] = [];
    for (let at = 0; at + marker.length <= zip.length; at++) {
      if (marker.every((b, k) => zip[at + k] === b)) forbidden.push([at, at + marker.length]);
    }
    expect(forbidden).toHaveLength(4);
    const inner = bytesReader(zip);
    const reader: RandomAccessReader = {
      size: inner.size,
      read(start, end) {
        if (forbidden.some(([a, b]) => start < b && end > a)) return Promise.reject(new Error("media data was requested"));
        return inner.read(start, end);
      },
    };
    const { parts } = await listParts([reader]);
    const c = await memoryTimeCheck([reader], parts, listOf(memoriesJson(4)));
    expect(c.verdict).toBe("direct");
    expect(c.unreadableHeaders).toBe(0);
  });

  it("counts a header that cannot be read instead of failing", async () => {
    const zip = buildFixtureZip([{ name: `memories/2025-03-01_${uuid(1)}-main.jpg`, utcMs: dateMs(1) }]);
    const bad = zip.slice();
    bad.fill(0, 0, 4); // the local header signature
    const readers = [bytesReader(bad)];
    const { parts } = await listParts(readers);
    const c = await memoryTimeCheck(readers, parts, []);
    expect(c.unreadableHeaders).toBe(1);
    expect(formatMemoryTimeCheck(c)).toContain("1 with an unreadable stored time");
  });
});

// ----------------------------------------------------------- the whole report ---

describe("inspectExport", () => {
  it("prints the structure by default and nothing else", async () => {
    const out = await inspectExport(twoParts(4, "utc"));
    expect(out.readable).toBe(true);
    expect(out.text).toContain("Snappy export structure report");
    expect(out.text).toContain("Left out on purpose: 1 HTML, 5 photo/video/audio and 0 other files (not opened).");
    expect(out.text).not.toContain("Folder totals");
    expect(out.text).not.toContain("Memories link check");
    expect(out.text.endsWith("\n")).toBe(true);
  });

  it("adds each check in order after the structure, and --checks-only drops the structure", async () => {
    const full = await inspectExport(twoParts(4, "utc"), allOn);
    const order = ["Snappy export structure report", "Folder totals", "Memories link check", "Memories file-time check"].map((h) => full.text.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const checks = await inspectExport(twoParts(4, "utc"), { ...allOn, checksOnly: true });
    expect(checks.text).not.toContain("Snappy export structure report");
    expect(checks.text.startsWith("Folder totals")).toBe(true);
    expect(checks.readable).toBe(true);
  });

  it("says calmly when memories_history.json is missing or is not a list", async () => {
    const none = [bytesReader(buildFixtureZip([{ name: "json/friends.json", data: enc({}) }]))];
    const text = (await inspectExport(none, { memoryLinks: true, mtimeCheck: true, checksOnly: true })).text;
    expect(text).toContain("Memories link check\n  memories_history.json was not found in these zips.");
    expect(text).toContain("Memories file-time check\n  memories_history.json was not found in these zips.");

    const odd = [bytesReader(buildFixtureZip([{ name: "json/memories_history.json", data: enc("not json at all") }]))];
    const unreadable = (await inspectExport(odd, { memoryLinks: true, checksOnly: true })).text;
    expect(unreadable).toContain("memories_history.json could not be read as a list of saved media.");
    expect(unreadable).not.toContain("Unexpected");
  });

  it("is not readable when no zip can be read, in both modes", async () => {
    const garbage = [bytesReader(new Uint8Array(300).fill(7))];
    const structure = await inspectExport(garbage);
    expect(structure.readable).toBe(false);
    expect(structure.text).toContain("note: zip unreadable");
    const checks = await inspectExport(garbage, { layout: true, checksOnly: true });
    expect(checks.readable).toBe(false);
    expect(checks.text).toContain("note: zip unreadable");
  });

  it("notes the unreadable part by number and still reports the others", async () => {
    const readers = [...twoParts(3, "utc"), bytesReader(new Uint8Array(300).fill(7))];
    const out = await inspectExport(readers, { layout: true, checksOnly: true });
    expect(out.readable).toBe(true);
    expect(out.text).toContain("note: part 3: zip unreadable");
    expect(out.text).toContain("part 1: 2 files");
    expect(out.text).toContain("part 3: 0 files");
  });
});

// ------------------------------------------------- structure: what is left out ---

describe("describeStructureFromReader leaves HTML, media and other files out", () => {
  const html = new TextEncoder().encode("HTMLPAGE-NEVER-OPENED");
  const entries = (): FixtureEntry[] => [
    { name: "json/friends.json", data: enc({ Friends: [{ Username: "u1" }] }) },
    { name: "json/chat_history.json", data: enc({}) },
    { name: "html/index.html", data: html },
    { name: "html/chat/zqcanary-title.html", data: html },
    { name: "chat_media/zqcanary-photo.jpg", data: new Uint8Array(2000) },
    { name: "memories/2025-03-01_x-main.mp4", data: new Uint8Array(2000) },
    { name: "chat_media/voice.aac", data: new Uint8Array(20) },
    { name: "notes.bin", data: new Uint8Array(20) },
    { name: "shared_story/readme", data: new Uint8Array(20) },
    { name: "folder/", data: new Uint8Array(0) },
  ];

  it("describes only the JSON files and counts the rest", async () => {
    const report = await describeStructureFromReader([bytesReader(buildFixtureZip(entries()))]);
    expect(report.files.map((f) => f.name)).toEqual(["json/chat_history.json", "json/friends.json"]);
    expect(report.files.every((f) => f.kind === "json")).toBe(true);
    expect(report.leftOut).toEqual({ html: 2, media: 3, other: 2 });
    const text = formatStructureReport(report);
    expect(text).toContain("files: 2\n");
    expect(text).toContain("\n\nLeft out on purpose: 2 HTML, 3 photo/video/audio and 2 other files (not opened).\n");
    expect(text).not.toContain("<media-");
    expect(text).not.toContain("zqcanary");
    expect(text).not.toContain("html/index.html");
  });

  it("never requests the bytes of an HTML page or of media", async () => {
    const zip = buildFixtureZip(entries());
    const forbidden: [number, number][] = [];
    for (let at = 0; at + html.length <= zip.length; at++) if (html.every((b, k) => zip[at + k] === b)) forbidden.push([at, at + html.length]);
    expect(forbidden).toHaveLength(2);
    const inner = bytesReader(zip);
    const reader: RandomAccessReader = {
      size: inner.size,
      read(start, end) {
        if (forbidden.some(([a, b]) => start < b && end > a)) return Promise.reject(new Error("an HTML page was read"));
        return inner.read(start, end);
      },
    };
    const report = await describeStructureFromReader([reader]);
    expect(report.notes).toEqual([]);
    expect(report.files).toHaveLength(2);
  });

  it("adds the counts of every part and keeps the line out of reports that never counted", async () => {
    const a = bytesReader(buildFixtureZip([{ name: "json/friends.json", data: enc({}) }, { name: "a.jpg" }, { name: "a.html" }]));
    const b = bytesReader(buildFixtureZip([{ name: "b.mp4" }, { name: "b.png" }, { name: "b.txt" }]));
    const report = await describeStructureFromReader([a, b]);
    expect(report.leftOut).toEqual({ html: 1, media: 3, other: 1 });
    const empty = await describeStructureFromReader([]);
    expect(formatStructureReport(empty)).toContain("Left out on purpose: 0 HTML, 0 photo/video/audio and 0 other files (not opened).");
  });
});

// --------------------------------------------------------------------- canary ---

describe("no planted personal string appears in any report variant", () => {
  const PLANTED = [
    "zqcanary_user_alpha", "ZQCANARY Display", "ZQCANARY-MSG text", "ZQCANARY-GRP title", "13.371337", "73.37",
    "zqcanary-cdn", "ZQSECRETSIG", "zqcanary_file", "zqcanary_folder", "zqcanary-page", "zqcanary@demo",
  ];

  function plantedZips(): Uint8Array[] {
    const friends = { Friends: [{ Username: PLANTED[0], "Display Name": PLANTED[1], "Creation Timestamp": "2024-01-01 00:00:00 UTC", "Last Modified Timestamp": "2024-01-02 00:00:00 UTC", Source: PLANTED[3] }] };
    const convo = (key: string) => ({ [key]: [{ From: PLANTED[0], Created: "2024-01-01 00:00:00 UTC", "Created(microseconds)": 1, IsSender: true, "Media Type": "TEXT", "Conversation Title": PLANTED[3], Content: PLANTED[2], IsSaved: false }] });
    const memories = memoriesJson(8, (i) => ({ download: `https://zqcanary-cdn.example/x/${uuid(i)}?mid=${uuid(i)}&sig=ZQCANARYZQSECRETSIG`, media: "" }));
    const part1 = buildFixtureZip([
      { name: "json/friends.json", data: enc(friends) },
      { name: "json/chat_history.json", data: enc({ ...convo(PLANTED[0] as string), ...convo(PLANTED[3] as string) }) },
      { name: "json/snap_history.json", data: enc(convo(PLANTED[3] as string)) },
      { name: "json/memories_history.json", data: enc(memories) },
      { name: "json/zqcanary_file.json", data: enc({ a: PLANTED[2] }) },
      { name: "html/zqcanary-page.html", data: enc(`<p>${PLANTED[2]}</p>`) },
      { name: "chat_media/zqcanary_file.jpg", data: new Uint8Array(30) },
      { name: "chat_media/zqcanary@demo.invalid.txt", data: new Uint8Array(30) },
      { name: "zqcanary_folder/zqcanary_file.png", data: new Uint8Array(30) },
    ]);
    const part2 = buildFixtureZip([
      ...Array.from({ length: 8 }, (_, k) => memoryFile(k + 1, "utc")),
      { name: "memories/2025-03-09_zqcanary_file-main.jpg", data: new Uint8Array(30), utcMs: 1_000_000_000_000 },
    ]);
    return [part1, part2];
  }
  const plantedParts = (): RandomAccessReader[] => plantedZips().map(bytesReader);

  const variants: { label: string; opts: Parameters<typeof inspectExport>[1] }[] = [
    { label: "default", opts: {} },
    { label: "show keys", opts: { showKeys: true } },
    { label: "all checks", opts: allOn },
    { label: "all checks and keys", opts: { ...allOn, showKeys: true } },
    { label: "checks only", opts: { ...allOn, checksOnly: true } },
    { label: "layout only", opts: { layout: true, checksOnly: true } },
  ];

  it("plants every canary in the raw export, so the test proves something", () => {
    const raw = plantedZips().map((z) => Buffer.from(z).toString("latin1")).join("\n");
    for (const p of PLANTED) expect(raw, `${p} is not planted`).toContain(p);
  });

  for (const v of variants) {
    it(`variant: ${v.label}`, async () => {
      const { text } = await inspectExport(plantedParts(), v.opts);
      const lower = text.toLowerCase();
      for (const p of [...PLANTED, uuid(1), uuid(5), "2024-01", "2025-03", "example", "demo.invalid"]) {
        expect(lower, `leaked ${p}`).not.toContain(p.toLowerCase());
      }
      expect(lower).not.toContain("zqcanary");
    });
  }
});
