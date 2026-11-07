/**
 * Regression tests for defects found in review: what the JPEG writer keeps, hostile JSON that
 * is small in a zip but huge once parsed, username length, the inspector's media list, and the
 * words and number formats in evidence sentences.
 */
import { describe, expect, it } from "vitest";
import { MAX_USERNAME_LENGTH, describeStructure, embedJpegDate, findDormant, findGhosts, findOneWay, formatDay, groupDigits, parseExportFiles, parseFriendsJson } from "../../src/index.ts";
import { MAX_JSON_CONTAINERS, parseJsonBytes } from "../../src/export/json-util.ts";
import type { ChatEvent, ParsedExport, Snapshot } from "../../src/types.ts";
import { DAY_MS } from "../../src/util.ts";

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const seg = (marker: number, payload: number[]): number[] => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
const text = (b: Uint8Array): string => Buffer.from(b).toString("latin1");
const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

describe("embedJpegDate keeps a short list of structural segments and drops every other container", () => {
  const jpeg = Uint8Array.from([
    0xff, 0xd8,
    ...seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xe0, [...ascii("JFXX"), 0, 0x10, ...ascii("JFXXTHUMBSECRET")]),
    ...seg(0xe2, [...ascii("MPF"), 0, ...ascii("MPFSECRET")]),
    ...seg(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, 9, 9, 9]),
    ...seg(0xe3, [...ascii("Meta"), 0, ...ascii("GPSLatitude=13.37 META3SECRET")]),
    ...seg(0xe6, ascii("GoPro-vendor VENDOR6SECRET")),
    ...seg(0xeb, [...ascii("JUMBF"), 0, ...ascii("claim_generator=Jane.Doe@example.com C2PASECRET")]),
    ...seg(0xec, [...ascii("Ducky"), 0, ...ascii("Comment=CAPTIONSECRET")]),
    ...seg(0xee, [...ascii("Adobe"), 0, 100, 0, 0, 0, 0, 1]),
    ...seg(0xef, ascii("APP15SECRET")),
    ...seg(0xdb, [0, ...new Array(64).fill(8)]),
    ...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12, 0x34, 0xff, 0xd9,
  ]);
  const out = text(embedJpegDate(jpeg, Date.UTC(2020, 5, 15, 8, 30, 0)));

  it("drops MPF, Meta, vendor, JUMBF/C2PA, Ducky caption, JFXX and unknown APPn segments", () => {
    for (const secret of ["JFXXTHUMBSECRET", "MPFSECRET", "META3SECRET", "13.37", "VENDOR6SECRET", "C2PASECRET", "Jane.Doe", "CAPTIONSECRET", "APP15SECRET"]) {
      expect(out, secret).not.toContain(secret);
    }
  });

  it("keeps JFIF, the ICC profile, the Adobe flag and the new date", () => {
    expect(out).toContain("JFIF");
    expect(out).toContain("ICC_PROFILE");
    expect(out).toContain("Adobe");
    expect(out).toContain("2020:06:15 08:30:00");
  });
});

describe("hostile JSON that is tiny in a zip", () => {
  it("is refused when it opens more objects and lists than any real export does", () => {
    const bomb = new Uint8Array(MAX_JSON_CONTAINERS + 1).fill(0x5b); // "[[[[..."
    const r = parseJsonBytes("friends.json", bomb);
    expect(r.value).toBeUndefined();
    expect(r.issues.map((i) => [i.severity, i.code])).toEqual([["error", "json-too-complex"]]);
    expect(r.issues[0]?.message).not.toContain("[");
  });

  it("reaches the export as an error issue and yields no friends", () => {
    const parsed = parseExportFiles({ "json/friends.json": new Uint8Array(MAX_JSON_CONTAINERS + 1).fill(0x7b) });
    expect(parsed.issues.some((i) => i.severity === "error" && i.code === "json-too-complex")).toBe(true);
    expect(parsed.friends.friends).toEqual([]);
  });

  it("still reads a normal file", () => {
    const r = parseJsonBytes("friends.json", enc({ Friends: [{ Username: "a" }, { Username: "b" }] }));
    expect(r.issues).toEqual([]);
  });
});

describe("usernames", () => {
  it("longer than the cap are skipped as unusable, so one cannot fill the page and every export", () => {
    const { friends, issues } = parseFriendsJson({ Friends: [{ Username: "x".repeat(300_000) }, { Username: "x".repeat(MAX_USERNAME_LENGTH) }, { Username: "ok_name" }] });
    expect(friends.friends.map((f) => f.username.length)).toEqual([MAX_USERNAME_LENGTH, 7]);
    expect(issues.find((i) => i.code === "friends-invalid-entries")?.message).toContain("1 entry");
  });
});

describe("inspect treats every media extension the parser knows as media", () => {
  it.each(["bmp", "avi", "mkv"])("buckets the size of a .%s file instead of reporting its exact size", (ext) => {
    const report = describeStructure({ [`memories/photo.${ext}`]: new Uint8Array(355) });
    const file = report.files[0];
    expect(file?.kind).toBe("media");
    expect(file?.sizeBytes).toBeUndefined();
    expect(file?.sizeBucket).toBeDefined();
  });
});

describe("evidence sentences follow the brand guide", () => {
  const NOW = Date.UTC(2026, 10, 6);
  const empty = (): ParsedExport["friends"] => ({ friends: [], sentRequests: [], pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] });
  const parsed = (extra: Partial<ParsedExport>): ParsedExport => ({ friends: empty(), chats: [], memories: [], fileList: [], issues: [], ...extra });
  const details = (cs: { evidence: { detail: string }[] }[]): string => cs.flatMap((c) => c.evidence.map((e) => e.detail)).join("\n");

  const snap = (id: string, takenAt: number, friends: string[]): Snapshot => ({ id, takenAt, source: "export", friends, sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} });

  it("say remove, never unadd, and write dates as Nov 6, 2026", () => {
    const ghosts = findGhosts([snap("a", NOW - 120 * DAY_MS, ["gone_friend", "stay"]), snap("b", NOW, ["stay"])], { now: NOW });
    expect(ghosts).toHaveLength(1);
    const all = details(ghosts);
    expect(all).not.toMatch(/unadd/i);
    expect(all).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(all).toContain("Nov 6, 2026");
  });

  it("group long day counts and say one-to-one", () => {
    const chats: ChatEvent[] = [
      { conversation: "anchor", isGroup: false, direction: "received", kind: "TEXT", at: NOW - 3000 * DAY_MS },
      { conversation: "quiet_pal", isGroup: false, direction: "received", kind: "TEXT", at: NOW - 1191 * DAY_MS },
    ];
    const dormant = findDormant(parsed({ friends: { ...empty(), friends: [{ username: "quiet_pal", createdAt: NOW - 2000 * DAY_MS }] }, chats, exportedAt: NOW }), { now: NOW });
    const all = details(dormant);
    expect(all).toContain("1,191 days");
    expect(all).toContain("one-to-one");
    expect(all).not.toContain("1:1");
  });

  it("group the age of a request nobody accepted", () => {
    const req = findOneWay(parsed({ friends: { ...empty(), friends: [{ username: "a_friend" }], sentRequests: [{ username: "old_ask", createdAt: NOW - 1500 * DAY_MS }] }, exportedAt: NOW }), { now: NOW });
    expect(details(req)).toContain("1,500 days ago");
  });

  it("format days and counts in one place", () => {
    expect(formatDay(Date.UTC(2026, 10, 6, 23, 59))).toBe("Nov 6, 2026");
    expect(formatDay(Number.NaN)).toBe("an unknown date");
    expect(groupDigits(1191.9)).toBe("1,191");
    expect(groupDigits(7)).toBe("7");
  });
});
