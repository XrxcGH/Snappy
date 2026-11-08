import { describe, expect, it } from "vitest";
import { describeStructure, describeStructureFromReader, formatStructureReport, isSensitiveName } from "../../src/export/inspect.ts";
import { bytesReader, listZipEntries } from "../../src/export/zip-reader.ts";
import type { RandomAccessReader } from "../../src/export/zip-reader.ts";
import { enc, zipOf } from "./helpers.ts";

// Synthetic values only. Every one is a canary that may not appear in a report.
const LOGIN = {
  "Login History": [
    { IP: "203.0.113.77", Country: "Canaryland", Device: "canary-phone-9", Created: "2024-01-01 00:00:00 UTC" },
    { IP: "203.0.113.78", Country: "Canaryland", Device: "canary-phone-9", Created: "2024-01-02 00:00:00 UTC" },
  ],
  "Display Name Change": [{ "Display Name": "Canary Name", Date: "2024-01-03 00:00:00 UTC" }],
};
const LOCATION = {
  "Location History": [{ Latitude: "48.8566", Longitude: "2.3522", Time: "2024-01-01" }],
  "Frequent Locations": [{ City: "Canarytown", Region: "CR" }],
};
const FRIENDS = { Friends: [{ Username: "canary_friend", "Display Name": "Canary Friend", "Creation Timestamp": "2020-01-01 00:00:00 UTC" }] };

const FIELD_NAMES = ["Login History", "Display Name Change", "IP", "Country", "Device", "Created", "Latitude", "Longitude", "Location History", "Frequent Locations", "City", "Region"];

function expectNoSensitiveWords(text: string): void {
  for (const word of [...FIELD_NAMES, "canary", "203.0.113", "48.85", "Canaryland"]) {
    expect(text.toLowerCase(), `leaked ${word}`).not.toContain(word.toLowerCase());
  }
}

/** A reader that records every range read, so a test can tell which entries were opened. */
function recordingReader(bytes: Uint8Array): { reader: RandomAccessReader; ranges: [number, number][] } {
  const inner = bytesReader(bytes);
  const ranges: [number, number][] = [];
  return {
    ranges,
    reader: {
      size: inner.size,
      read(start, end) {
        ranges.push([start, end]);
        return inner.read(start, end);
      },
    },
  };
}

describe("inspect never describes login, location and similar files", () => {
  const files = {
    "json/friends.json": FRIENDS,
    "json/account_history.json": LOGIN,
    "json/location_history.json": LOCATION,
    // A name outside the allowlist, so the file is masked, but its section names still give it away.
    "json/mystery.json": LOGIN,
  };

  it("prints only the allowlisted name and a fixed remark for those files", async () => {
    const text = formatStructureReport(await describeStructureFromReader([bytesReader(zipOf(files))]));
    expectNoSensitiveWords(text);
    expect(text).toContain("json/account_history.json  [json]");
    expect(text).toContain("json/location_history.json  [json]");
    expect(text.match(/not described/g)).toHaveLength(3);
    // no byte size, no bucketed count for those three files
    const lines = text.split("\n");
    for (const name of ["json/account_history.json", "json/location_history.json", "<file-1>.json"]) {
      const line = lines.find((l) => l.startsWith(name));
      expect(line, name).toBeDefined();
      expect((line as string).slice(name.length)).toBe("  [json]");
    }
    // the friends list is still described
    expect(text).toContain("Friends: array[1-9]");
    expect(text).toContain("Username: string");
  });

  it("does not open a file named for login or location data", async () => {
    const zip = zipOf(files);
    const { entries } = await listZipEntries(bytesReader(zip));
    const byName = (n: string) => entries.find((e) => e.name === n)!;
    const { reader, ranges } = recordingReader(zip);
    await describeStructureFromReader([reader]);
    for (const name of ["json/account_history.json", "json/location_history.json"]) {
      const e = byName(name);
      const dataStart = e.localHeaderOffset;
      const dataEnd = e.localHeaderOffset + 30 + name.length + e.compressedSize;
      expect(ranges.some(([s, t]) => s < dataEnd && t > dataStart), `${name} was read`).toBe(false);
    }
    // the file with an unremarkable name is read (to find its section names) but never described
    const mystery = byName("json/mystery.json");
    expect(ranges.some(([s, t]) => s < mystery.localHeaderOffset + 30 + mystery.compressedSize + 20 && t > mystery.localHeaderOffset)).toBe(true);
  });

  it("describes other JSON by shape only, never by value", async () => {
    const zip = zipOf({
      "json/friends.json": { Friends: [{ Username: "canary_friend", "Display Name": "Canary Friend", Note: "canary-secret-note" }], "Blocked Users": [] },
      "json/memories_history.json": { "Saved Media": [{ Date: "2023-02-02 10:00:00 UTC", Location: "Latitude, Longitude: 48.85, 2.35", "Media Type": "Image" }] },
    });
    const text = formatStructureReport(await describeStructureFromReader([bytesReader(zip)], { showKeys: true }));
    expect(text).not.toContain("canary_friend");
    expect(text).not.toContain("canary-secret-note");
    expect(text).not.toContain("48.85");
    expect(text).toContain("Saved Media: array[1-9]");
    expect(text).toContain("Location: string");
  });

  it("the in-memory report also leaves them out", () => {
    const text = formatStructureReport(
      describeStructure({
        "json/friends.json": enc(FRIENDS),
        "json/account_history.json": enc(LOGIN),
        "json/location_history.json": enc(LOCATION),
        "json/mystery.json": enc(LOGIN),
      }),
    );
    expectNoSensitiveWords(text);
    expect(text.match(/not described/g)).toHaveLength(3);
    expect(text).toContain("Friends: array[1-9]");
  });

  it("does not treat a conversation name that sounds like a section as a reason to hide a chat history", async () => {
    const zip = zipOf({ "json/chat_history.json": { support: [{ From: "x", "Media Type": "TEXT", Created: "2024-01-01 00:00:00 UTC", Content: "hi", IsSender: true }] } });
    const text = formatStructureReport(await describeStructureFromReader([bytesReader(zip)]));
    expect(text).not.toContain("not described");
    expect(text).toContain("IsSender: boolean");
  });
});

describe("isSensitiveName", () => {
  it("matches whole words of login, location, purchase, support, My AI, ad, account and device names", () => {
    for (const name of ["account_history.json", "Login History", "LoginHistory", "location_history", "Shopping History", "support_notes.json", "snap_ai.json", "My AI", "Ad Interests", "Advertising Id", "Device Information"]) {
      expect(isSensitiveName(name), name).toBe(true);
    }
    for (const name of ["friends.json", "Friends", "Deleted Friends", "Saved Media", "memories_history.json", "chat_history.json", "snap_history.json", "Friend Requests Sent", "Blocked Users", "Added"]) {
      expect(isSensitiveName(name), name).toBe(false);
    }
  });
});
