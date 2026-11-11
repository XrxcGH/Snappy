import { describe, expect, it } from "vitest";
import { failureClass, parseExportFiles, validateExport } from "../../src/export/parse.ts";
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

describe("a ZIP with no Snapchat export files", () => {
  const stray = ["readme.txt", "docs/a.json", "photos/x.jpg"].map((n, i) => (n.endsWith(".json") ? "<dir>/<file-1>.json" : `<file-${i}>`));

  it("gives one error and none of the notes that only follow from it", () => {
    expect(codes(parsed({ fileList: stray }))).toEqual(["no-export-files"]);
  });

  it("is what a real read of such a ZIP gives", () => {
    const bytes = new TextEncoder().encode("{}");
    const read = parseExportFiles({ "readme.txt": bytes, "docs/a.json": bytes, "photos/x.jpg": bytes });
    expect(validateExport(read).map((i) => i.code)).toEqual(["no-export-files"]);
  });

  it("names the class so the page shows that one line", () => {
    expect(failureClass([issue("error", "no-export-files")])).toBe("no-files");
  });

  it("still reports a missing friends list when a known export file is there", () => {
    expect(codes(parsed({ fileList: [...stray, "chat_history.json"] }))).toContain("no-friends-section");
  });

  it("leaves an HTML-only export with its own error", () => {
    expect(codes(parsed({ fileList: ["<file-1>.html"] }))).toEqual(["html-only-export"]);
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
