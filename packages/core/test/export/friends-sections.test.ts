/**
 * friends.json as the real export has it: every entry has the same five fields, there is a section
 * with a name nobody knows that is always empty, and Deleted Friends has no deletion field.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { parseFriendsJson } from "../../src/export/friends.ts";

const entry = (name: string, n: number): Record<string, string> => ({
  Username: name,
  "Display Name": `ZQCANARY-DN-${n}`,
  "Creation Timestamp": `2023-0${(n % 9) + 1}-01 10:00:00 UTC`,
  "Last Modified Timestamp": `2024-0${(n % 9) + 1}-15 11:30:00 UTC`,
  Source: `ZQCANARY-SRC-${n}`,
});

const real = (): Record<string, unknown> => ({
  Friends: [entry("Alice", 1), entry("bob", 2)],
  "Friend Requests Sent": [entry("carl", 3)],
  "Deleted Friends": [entry("dana", 4)],
  "Blocked Users": [entry("eve", 5)],
  "Ignored Snapchatters": [entry("fay", 6)],
  "Pending Requests": [entry("gus", 7)],
  "Hidden Friend Suggestions": [entry("hal", 8)],
  "Some Section Nobody Knows": [],
});

describe("friends.json of the real shape", () => {
  it("reads every known section and says nothing about the unknown empty one", () => {
    const { friends, issues } = parseFriendsJson(real());
    expect(friends.friends.map((f) => f.username)).toEqual(["alice", "bob"]);
    expect(friends.sentRequests.map((f) => f.username)).toEqual(["carl"]);
    expect(friends.pendingRequests.map((f) => f.username)).toEqual(["gus"]);
    expect(friends.blocked.map((f) => f.username)).toEqual(["eve"]);
    expect(friends.ignored.map((f) => f.username)).toEqual(["fay"]);
    expect(friends.hiddenSuggestions.map((f) => f.username)).toEqual(["hal"]);
    expect(issues.map((i) => i.code).sort()).toEqual(["deleted-date-guessed", "pending-direction-unknown"]);
    expect(issues.every((i) => i.severity === "info")).toBe(true);
  });

  it("uses the last-modified time as the deletion date and flags that it is a guess", () => {
    const { friends, issues } = parseFriendsJson(real());
    expect(friends.deletedFriends).toEqual([{ username: "dana", createdAt: Date.UTC(2023, 4, 1, 10), modifiedAt: Date.UTC(2024, 4, 15, 11, 30), deletedAt: Date.UTC(2024, 4, 15, 11, 30) }]);
    expect(issues.find((i) => i.code === "deleted-date-guessed")?.message).toBe(
      "1 deleted-friend entry has no explicit deletion date; used the created/modified timestamp instead.",
    );
  });

  it("never reads display names or sources", () => {
    const { friends, issues } = parseFriendsJson(real());
    const text = JSON.stringify([friends, issues]);
    expect(text).not.toContain("ZQCANARY");
    for (const list of Object.values(friends)) for (const r of list) expect(Object.keys(r).sort()).toEqual(expect.arrayContaining(["username"]));
    expect(Object.keys(friends.friends[0] as object).sort()).toEqual(["createdAt", "modifiedAt", "username"]);
  });

  it.each([[[]], [{}], [null]])("stays quiet about an unknown section that holds %j", (empty) => {
    const { issues } = parseFriendsJson({ ...real(), "Another Unknown": empty });
    expect(issues.map((i) => i.code)).not.toContain("friends-unknown-sections");
  });

  it("still mentions an unknown section that holds something, by count only", () => {
    const { issues } = parseFriendsJson({ ...real(), "Unexpected Names": [entry("zed", 9)], "Unexpected Other": { a: 1 } });
    const hit = issues.find((i) => i.code === "friends-unknown-sections");
    expect(hit).toEqual({ severity: "info", code: "friends-unknown-sections", message: "Ignored 2 unrecognized top-level keys in friends.json." });
    expect(JSON.stringify(issues)).not.toMatch(/Unexpected|\bzed\b/);
  });

  it("does not let an empty unknown section hide that no known section exists", () => {
    const { issues } = parseFriendsJson({ "Some Section Nobody Knows": [] });
    expect(issues.map((i) => i.code)).toEqual(["friends-no-sections"]);
    expect(issues[0]?.message).toBe("No known friend sections were found in friends.json (0 unrecognized top-level keys).");
  });
});
