import { describe, expect, it } from "vitest";
import { validateExport } from "../../src/export/parse.ts";
import { emptyFriends } from "../../src/export/friends.ts";
import type { ParsedExport } from "../../src/types.ts";

const removed = (n: number) => Array.from({ length: n }, (_, i) => ({ username: `gone${i}` }));

function emptyWithDeleted(n = 3): ParsedExport {
  return {
    friends: { ...emptyFriends(), deletedFriends: removed(n) },
    chats: [],
    memories: [],
    fileList: ["friends.json", "chat_history.json", "snap_history.json", "memories_history.json"],
    issues: [],
  };
}

const find = (parsed: ParsedExport, hints = {}) => validateExport(parsed, hints).find((i) => i.code === "friends-empty-but-deleted");

describe("an empty friends list with removed friends can be overridden", () => {
  it("is an error that says it can be overridden", () => {
    expect(find(emptyWithDeleted())).toMatchObject({ severity: "error", overridable: true });
  });

  it("becomes a warning, with the same message and no override flag, when the option is set", () => {
    const blocked = find(emptyWithDeleted(2));
    const allowed = find(emptyWithDeleted(2), { allowEmptyFriends: true });
    expect(allowed?.severity).toBe("warning");
    expect(allowed?.message).toBe(blocked?.message);
    expect(allowed?.message).toContain("results may be wrong");
    expect(allowed?.overridable).toBeUndefined();
  });

  it("the option is off unless it is exactly true", () => {
    expect(find(emptyWithDeleted(), { allowEmptyFriends: false })?.severity).toBe("error");
    expect(find(emptyWithDeleted(), {})?.severity).toBe("error");
  });

  it("no other error is ever marked overridable, and the option changes nothing else", () => {
    const none: ParsedExport = { ...emptyWithDeleted(), friends: emptyFriends() };
    const out = validateExport(none, { allowEmptyFriends: true });
    expect(out.find((i) => i.code === "no-friends-section")).toMatchObject({ severity: "error" });
    expect(out.some((i) => i.overridable === true)).toBe(false);
    const withFriends: ParsedExport = { ...emptyWithDeleted(), friends: { ...emptyFriends(), friends: [{ username: "a" }], deletedFriends: removed(2) } };
    expect(validateExport(withFriends, { allowEmptyFriends: true }).map((i) => i.code)).toEqual(validateExport(withFriends).map((i) => i.code));
  });
});
