import { describe, expect, it } from "vitest";
import { parseChatHistoryJson, parseSnapHistoryJson } from "../../src/export/chats.ts";
import { parseFriendsJson } from "../../src/export/friends.ts";
import { parseMemoriesJson } from "../../src/export/memories.ts";
import { toMs, toMsCounting } from "../../src/util.ts";

const loose = (value: unknown): number => {
  let n = 0;
  toMsCounting(value, () => void n++);
  return n;
};

describe("toMs says when it had to guess", () => {
  it.each([
    "2023-04-01 12:30:00 UTC",
    "2023-04-01T12:30:00.250Z",
    "2023/04/01 12:30",
    "2023-04-01",
    "2023-04-01T12:30:00+02:00",
    "2023-04-01T12:30:00-0800",
    "2023-04-01T12:30Z",
    1_680_352_200,
    1_680_352_200_000,
    "1680352200",
    null,
    "",
    "not a date",
    "2023-13-45 10:00:00 UTC",
  ])("is not told for %s", (value) => {
    expect(loose(value)).toBe(0);
  });

  it.each(["04/05/2023", "05.04.2023 14:30", "Apr 5, 2023 10:00 PM", "5 April 2023", "Wed, 05 Apr 2023 10:00:00 GMT", "2023-04-01 12:30:00 +0200"])("is told once for %s", (value) => {
    expect(loose(value)).toBe(1);
    expect(toMs(value)).toBeTypeOf("number");
  });

  it("gives the same answer with or without the callback", () => {
    expect(toMsCounting("04/05/2023", () => undefined)).toBe(toMs("04/05/2023"));
  });

  it("toMs itself keeps its one-argument shape, so it can still be handed to map", () => {
    expect(["2023-04-01", "04/05/2023", "x"].map(toMs)).toEqual([Date.UTC(2023, 3, 1), Date.UTC(2023, 3, 5), undefined]);
  });

  it("is not told for a guess that is rejected as implausible", () => {
    expect(loose("04/05/1850")).toBe(0);
  });
});

const T = "2024-02-01 10:00:00 UTC";
const times = <V>(n: number, make: (i: number) => V): V[] => Array.from({ length: n }, (_, i) => make(i));
const note = (issues: { code: string; message: string }[]) => issues.filter((i) => i.code === "dates-read-loosely");

describe("the note about dates that were read by a guess", () => {
  it("friends.json: counts every date field of every entry", () => {
    const { issues } = parseFriendsJson({
      Friends: [{ Username: "a", "Creation Timestamp": "04/05/2023", "Last Modified Timestamp": "05.04.2023 14:30" }, { Username: "b", "Creation Timestamp": T }],
      "Deleted Friends": [{ Username: "c", Date: "Apr 5, 2023 10:00 PM" }],
    });
    expect(note(issues)).toEqual([{ severity: "info", code: "dates-read-loosely", message: "3 dates in friends.json had an unusual format. Snappy read them as UTC, so they may be a day off." }]);
  });

  it("friends.json: one date reads in the singular", () => {
    const { issues } = parseFriendsJson({ Friends: [{ Username: "a", "Creation Timestamp": "04/05/2023" }] });
    expect(note(issues)[0]?.message).toBe("1 date in friends.json had an unusual format. Snappy read it as UTC, so it may be a day off.");
  });

  it("chat and Snap histories name their own file", () => {
    const doc = { amy_1: times(2, () => ({ From: "amy_1", "Media Type": "TEXT", Created: "04/05/2023", IsSender: false })) };
    expect(note(parseChatHistoryJson(doc).issues)[0]?.message).toContain("2 dates in chat_history.json");
    expect(note(parseSnapHistoryJson(doc).issues)[0]?.message).toContain("2 dates in snap_history.json");
  });

  it("memories_history.json", () => {
    const { issues } = parseMemoriesJson({ "Saved Media": [{ Date: "04/05/2023", "Media Type": "Image" }, { Date: T, "Media Type": "Image" }] });
    expect(note(issues)[0]?.message).toBe("1 date in memories_history.json had an unusual format. Snappy read it as UTC, so it may be a day off.");
  });

  it("is absent when every date has a known shape, whatever the file", () => {
    const exact = [T, "2024-02-01T10:00:00+02:00", 1_706_781_600];
    expect(note(parseFriendsJson({ Friends: exact.map((d, i) => ({ Username: `u${i}`, "Creation Timestamp": d })) }).issues)).toEqual([]);
    expect(note(parseChatHistoryJson({ amy_1: exact.map((d) => ({ From: "amy_1", Created: d, IsSender: false })) }).issues)).toEqual([]);
    expect(note(parseMemoriesJson({ "Saved Media": exact.map((d) => ({ Date: d })) }).issues)).toEqual([]);
  });

  it("never carries a date or a name", () => {
    const { issues } = parseFriendsJson({ Friends: [{ Username: "secret_name", "Creation Timestamp": "04/05/2023" }] });
    expect(JSON.stringify(issues)).not.toMatch(/secret_name|2023/);
  });
});
