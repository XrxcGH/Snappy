import { describe, expect, it } from "vitest";
import { failureClass, validateExport } from "../../src/export/parse.ts";
import { emptyFriends } from "../../src/export/friends.ts";
import type { ExportIssue, ParsedExport } from "../../src/types.ts";

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ username: `u${i}` }));
const issue = (severity: ExportIssue["severity"], code: string): ExportIssue => ({ severity, code, message: "x" });

function parsed(over: Partial<ParsedExport> = {}): ParsedExport {
  return { friends: emptyFriends(), chats: [], memories: [], fileList: [], issues: [], ...over };
}

const codes = (p: ParsedExport) => validateExport(p).map((i) => i.code);

describe("one root cause per failure", () => {
  it("an unreadable ZIP gives no friends-list or not-found notes", () => {
    expect(codes(parsed({ issues: [issue("error", "zip-unreadable")] }))).toEqual([]);
  });

  it("a file that cannot be opened gives no friends-list or not-found notes", () => {
    expect(codes(parsed({ fileList: ["friends.json"], issues: [issue("error", "zip-entry-unreadable")] }))).toEqual([]);
  });

  it("an HTML-only export gives only its own error", () => {
    expect(codes(parsed({ fileList: ["index.html", "friends.html"] }))).toEqual(["html-only-export"]);
  });

  it("without a root cause the dependent notes stay", () => {
    expect(codes(parsed())).toEqual(["no-friends-section", "chat-history-missing", "snap-history-missing", "memories-missing"]);
  });

  it("one unreadable part does not hide the notes about a friends list that was read", () => {
    const out = validateExport(parsed({ friends: { ...emptyFriends(), friends: people(5) }, issues: [issue("error", "zip-unreadable")] }));
    // not-found notes would be wrong here (the file may be in the damaged part), nothing else is invented
    expect(out.map((i) => i.code)).toEqual([]);
  });

  it("still reports real problems next to a root cause", () => {
    const out = validateExport(parsed({ friends: { ...emptyFriends(), friends: [{ username: "a" }, { username: "a" }] }, issues: [issue("error", "zip-unreadable")] }));
    expect(out.map((i) => i.code)).toEqual(["duplicate-usernames"]);
  });
});

describe("failureClass", () => {
  it("names the remedy: download again for damaged files, request again for HTML only", () => {
    expect(failureClass([issue("error", "zip-unreadable")])).toBe("unreadable");
    expect(failureClass([issue("error", "zip-entry-unreadable")])).toBe("unreadable");
    expect(failureClass([issue("error", "html-only-export")])).toBe("html-only");
    expect(failureClass([issue("error", "html-only-export"), issue("error", "zip-unreadable")])).toBe("unreadable");
    expect(failureClass([issue("warning", "duplicate-usernames")])).toBeUndefined();
    expect(failureClass([])).toBeUndefined();
  });
});
