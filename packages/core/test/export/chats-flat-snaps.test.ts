import { describe, expect, it } from "vitest";
import { parseChatHistoryJson, parseSnapHistoryJson } from "../../src/export/chats.ts";

const T = "2024-03-01 10:00:00 UTC";
const MS = Date.UTC(2024, 2, 1, 10, 0, 0);

describe("flat Snap History sections", () => {
  const history = {
    "Received Snap History": [
      { From: "amy_1", "Media Type": "IMAGE", Created: T },
      { From: "Bob_2", "Media Type": "VIDEO", Created: T },
    ],
    "Sent Snap History": [
      { To: "amy_1", "Media Type": "IMAGE", Created: T },
      { To: "cy_3", "Media Type": "VIDEO", Created: T },
    ],
  };

  it("files received Snaps under the sender and sent Snaps under the recipient, direction from the section name", () => {
    const { chats, issues } = parseSnapHistoryJson(history);
    expect(chats).toEqual([
      { conversation: "amy_1", isGroup: false, direction: "received", kind: "IMAGE", at: MS },
      { conversation: "bob_2", isGroup: false, direction: "received", kind: "VIDEO", at: MS },
      { conversation: "amy_1", isGroup: false, direction: "sent", kind: "IMAGE", at: MS },
      { conversation: "cy_3", isGroup: false, direction: "sent", kind: "VIDEO", at: MS },
    ]);
    expect(issues.filter((i) => i.severity !== "info")).toEqual([]);
    expect(issues.map((i) => i.code)).not.toContain("snap-all-groups");
  });

  it("does not file them as two fake group conversations", () => {
    const { chats } = parseSnapHistoryJson(history);
    expect(chats.some((c) => c.isGroup)).toBe(false);
  });

  it("the plain Snap History name is a flat section too, and a sent entry there is read by its flag", () => {
    const { chats } = parseSnapHistoryJson({
      "Snap History": [
        { From: "amy_1", "Media Type": "IMAGE", Created: T, IsSender: false },
        { To: "cy_3", "Media Type": "IMAGE", Created: T, IsSender: true },
      ],
    });
    expect(chats.map((c) => [c.conversation, c.direction])).toEqual([["amy_1", "received"], ["cy_3", "sent"]]);
  });

  it("the section name wins over a missing IsSender, but an entry that says otherwise is believed", () => {
    const { chats } = parseSnapHistoryJson({ "Sent Snap History": [{ To: "cy_3", "Media Type": "IMAGE", Created: T, IsSender: true }, { From: "dee_4", "Media Type": "IMAGE", Created: T, IsSender: false }] });
    expect(chats.map((c) => [c.conversation, c.direction])).toEqual([["cy_3", "sent"], ["dee_4", "received"]]);
  });
});

describe("flat saved chat sections and bare lists", () => {
  it("read the recipient of a sent entry", () => {
    const { chats } = parseChatHistoryJson({
      "Received Saved Chat History": [{ From: "amy_1", "Media Type": "TEXT", Created: T, Text: "never read" }],
      "Sent Saved Chat History": [{ To: "amy_1", "Media Type": "TEXT", Created: T, Text: "never read" }],
    });
    expect(JSON.stringify(chats)).not.toContain("never read");
    expect(chats.map((c) => [c.conversation, c.direction])).toEqual([["amy_1", "received"], ["amy_1", "sent"]]);
  });

  it("a bare list reads sent entries by their recipient", () => {
    const { chats, issues } = parseSnapHistoryJson([
      { From: "amy_1", "Media Type": "IMAGE", Created: T, IsSender: false },
      { To: "cy_3", "Media Type": "IMAGE", Created: T, IsSender: true },
    ]);
    expect(chats.map((c) => [c.conversation, c.direction])).toEqual([["amy_1", "received"], ["cy_3", "sent"]]);
    expect(issues.map((i) => i.code)).toContain("snap-top-level-array");
  });

  it("a sent entry that names no recipient is still counted as unmatched", () => {
    const { chats, issues } = parseSnapHistoryJson({ "Sent Snap History": [{ "Media Type": "IMAGE", Created: T }] });
    expect(chats).toEqual([]);
    expect(issues.map((i) => i.code)).toContain("snap-conversation-unknown");
  });

  it("a recipient is only read in a flat list: a per-conversation file keeps its own key", () => {
    const { chats } = parseSnapHistoryJson({ amy_1: [{ To: "someone_else", From: "me_user", "Media Type": "IMAGE", Created: T, IsSender: true }] });
    expect(chats.map((c) => c.conversation)).toEqual(["amy_1"]);
  });

  it("a friend called like a section is still a username when the key is not the section name", () => {
    const { chats } = parseSnapHistoryJson({ snapfan: [{ From: "snapfan", "Media Type": "IMAGE", Created: T, IsSender: false }] });
    expect(chats.map((c) => c.conversation)).toEqual(["snapfan"]);
  });
});
