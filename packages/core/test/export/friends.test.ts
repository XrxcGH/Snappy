import { describe, expect, it } from "vitest";
import { parseFriendsJson } from "../../src/export/parse.ts";
import { allMessages } from "./helpers.ts";

describe("parseFriendsJson", () => {
  it("projects only allowlisted fields and normalises usernames", () => {
    const { friends, issues } = parseFriendsJson({
      Friends: [
        { Username: "  Alice_01 ", "Display Name": "Alice Canary", "Creation Timestamp": "2023-04-01 12:30:00 UTC", "Last Modified Timestamp": "2023-05-01 00:00:00 UTC", Source: "Added by Quick Add" },
      ],
    });
    expect(friends.friends).toEqual([
      { username: "alice_01", createdAt: Date.UTC(2023, 3, 1, 12, 30), modifiedAt: Date.UTC(2023, 4, 1) },
    ]);
    expect(Object.keys(friends.friends[0]!).sort()).toEqual(["createdAt", "modifiedAt", "username"]);
    expect(issues).toEqual([]);
  });

  it("routes every known section and does not let 'Friends' absorb 'Deleted Friends'", () => {
    const { friends } = parseFriendsJson({
      Friends: [{ Username: "a" }],
      "Friend Requests Sent": [{ Username: "b" }],
      "Blocked Users": [{ Username: "c" }],
      "Deleted Friends": [{ Username: "d" }],
      "Ignored Snapchatters": [{ Username: "e" }],
      "Pending Requests": [{ Username: "f" }],
      "Hidden Friend Suggestions": [{ Username: "g" }],
    });
    expect(friends.friends.map((f) => f.username)).toEqual(["a"]);
    expect(friends.sentRequests.map((f) => f.username)).toEqual(["b"]);
    expect(friends.blocked.map((f) => f.username)).toEqual(["c"]);
    expect(friends.deletedFriends.map((f) => f.username)).toEqual(["d"]);
    expect(friends.ignored.map((f) => f.username)).toEqual(["e"]);
    expect(friends.pendingRequests.map((f) => f.username)).toEqual(["f"]);
    expect(friends.hiddenSuggestions.map((f) => f.username)).toEqual(["g"]);
  });

  it("tolerates mixed-case, punctuated and snake_case keys", () => {
    const { friends } = parseFriendsJson({
      "friends": [{ USERNAME: "X", creation_timestamp: 1680352200, "last modified timestamp": "1680352300000" }],
    });
    expect(friends.friends).toEqual([{ username: "x", createdAt: 1680352200000, modifiedAt: 1680352300000 }]);
  });

  it("accepts numeric usernames, drops non-string/blank ones and bare strings, and counts them", () => {
    const { friends, issues } = parseFriendsJson({
      Friends: [
        { Username: 12345 },
        { Username: { nested: "x" } },
        { Username: true },
        { Username: "   " },
        { Username: null },
        { "Display Name": "No Username" },
        "bare-string-name",
        42,
        null,
        { Username: "ok" },
      ],
    });
    expect(friends.friends.map((f) => f.username)).toEqual(["12345", "ok"]);
    const bad = issues.find((i) => i.code === "friends-invalid-entries");
    expect(bad?.message).toContain("8 entries");
    expect(allMessages(issues)).not.toContain("bare-string-name");
  });

  it("handles unicode usernames", () => {
    const { friends } = parseFriendsJson({ Friends: [{ Username: "ÉLODIE_ß" }, { Username: "名前" }] });
    expect(friends.friends.map((f) => f.username)).toEqual(["élodie_ß", "名前"]);
  });

  it("uses an explicit deletion date, else guesses from modified then created, and says so", () => {
    const { friends, issues } = parseFriendsJson({
      "Deleted Friends": [
        { Username: "a", "Creation Timestamp": "2020-01-01 00:00:00 UTC", Date: "2022-02-02 00:00:00 UTC" },
        { Username: "b", "Creation Timestamp": "2020-01-01 00:00:00 UTC", "Last Modified Timestamp": "2021-01-01 00:00:00 UTC" },
        { Username: "c", "Creation Timestamp": "2019-01-01 00:00:00 UTC" },
        { Username: "d" },
      ],
    });
    const byName = Object.fromEntries(friends.deletedFriends.map((d) => [d.username, d.deletedAt]));
    expect(byName).toEqual({ a: Date.UTC(2022, 1, 2), b: Date.UTC(2021, 0, 1), c: Date.UTC(2019, 0, 1), d: undefined });
    expect(issues.find((i) => i.code === "deleted-date-guessed")?.message).toContain("2 deleted-friend entries");
  });

  it("flags a pending-direction caveat and unknown/bad sections by count only", () => {
    const { issues } = parseFriendsJson({
      Friends: [{ Username: "a" }],
      "Pending Requests": [{ Username: "p" }],
      "Secret Canary Section": [{ Username: "zzz" }],
      "Blocked Users": "not a list",
    });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("pending-direction-unknown");
    expect(codes).toContain("friends-unknown-sections");
    expect(codes).toContain("friends-section-not-list");
    expect(allMessages(issues)).not.toMatch(/Canary|zzz/);
  });

  it("treats a bare top-level array as the friends list with a warning", () => {
    const { friends, issues } = parseFriendsJson([{ Username: "a" }]);
    expect(friends.friends).toHaveLength(1);
    expect(issues[0]?.code).toBe("friends-top-level-array");
  });

  it.each([null, undefined, 7, "text", true])("never throws on %s", (bad) => {
    const { friends, issues } = parseFriendsJson(bad);
    expect(friends.friends).toEqual([]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("reports unrecognised shapes without throwing", () => {
    const { issues } = parseFriendsJson({ foo: 1 });
    expect(issues.map((i) => i.code)).toContain("friends-no-sections");
  });

  it("does not choke on a hostile __proto__ key", () => {
    const obj = JSON.parse('{"Friends":[{"Username":"a","__proto__":{"username":"evil"}}]}') as unknown;
    expect(parseFriendsJson(obj).friends.friends).toEqual([{ username: "a" }]);
  });

  it("handles 5k friends quickly", () => {
    const list = Array.from({ length: 5000 }, (_, i) => ({ Username: `User${i}`, "Creation Timestamp": "2023-01-01 00:00:00 UTC" }));
    const t0 = performance.now();
    const { friends } = parseFriendsJson({ Friends: list });
    expect(friends.friends).toHaveLength(5000);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
