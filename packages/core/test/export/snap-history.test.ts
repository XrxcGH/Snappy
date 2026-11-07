/**
 * snap_history.json: the same per-conversation layout as the chat history, without message text.
 * Snaps become the same metadata-only events as chats (kind = media type), through the same reader
 * that the streaming front end uses. Synthetic data only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HISTORY_KEEP_FIELDS, HistoryReader, parseChatHistoryJson, parseSnapHistoryJson } from "../../src/export/chats.ts";
import { compileAllow, readAllowed } from "../../src/export/json-util.ts";
import { projectConversations } from "../../src/export/json-stream.ts";
import type { StreamSource } from "../../src/export/json-stream.ts";
import { allMessages, enc } from "./helpers.ts";

const T = Date.UTC(2026, 9, 1, 12, 0, 0);
const us = (ms: number): number => ms * 1000;

const snap = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  From: "alice",
  "Media Type": "IMAGE",
  Created: "2026-10-01 12:00:00 UTC",
  "Created(microseconds)": us(T),
  IsSender: false,
  "Conversation Title": null,
  ...over,
});

const bytesSource = (bytes: Uint8Array, chunk = 7): StreamSource => {
  let at = 0;
  return {
    next: () => {
      if (at >= bytes.length) return Promise.resolve(null);
      const out = bytes.subarray(at, at + chunk);
      at += chunk;
      return Promise.resolve(out);
    },
  };
};

/** The streaming front end's way of reading a history: the projector feeding a HistoryReader. */
async function viaStream(doc: unknown, history: "chat" | "snap") {
  const reader = new HistoryReader(history);
  for await (const { conversationKey, record } of projectConversations(bytesSource(enc(doc)), { keepFields: [...HISTORY_KEEP_FIELDS] })) {
    reader.add(conversationKey, record);
  }
  return reader.finish();
}

afterEach(() => vi.restoreAllMocks());

describe("parseSnapHistoryJson", () => {
  it("reads Snaps as events whose kind is the media type", () => {
    const { chats, issues } = parseSnapHistoryJson({
      Alice: [snap(), snap({ IsSender: true, From: "demo_user", "Media Type": "VIDEO", "Created(microseconds)": us(T + 1000) })],
    });
    expect(issues).toEqual([]);
    expect(chats).toEqual([
      { conversation: "alice", isGroup: false, direction: "received", kind: "IMAGE", at: T },
      { conversation: "alice", isGroup: false, direction: "sent", kind: "VIDEO", at: T + 1000 },
    ]);
  });

  it("gives the same events as the chat reader for the same entries", () => {
    const doc = {
      alice: [snap(), snap({ IsSender: true, From: "me", "Media Type": "VIDEO" })],
      "Weekend Crew": [
        snap({ From: "bob", "Conversation Title": "Weekend Crew" }),
        snap({ From: "cleo", "Conversation Title": "Weekend Crew", "Created(microseconds)": us(T + 5000) }),
      ],
    };
    expect(parseSnapHistoryJson(doc).chats).toEqual(parseChatHistoryJson(doc).chats);
  });

  it("files a group under a hash and never keeps its title", () => {
    const { chats } = parseSnapHistoryJson({ "ZQCANARY-GRP-1 Crew": [snap({ From: "bob", "Conversation Title": "ZQCANARY-GRP-1 Crew" }), snap({ From: "cleo", "Conversation Title": "ZQCANARY-GRP-1 Crew" })] });
    expect(chats.every((c) => c.isGroup && /^group:[0-9a-f]{8}$/.test(c.conversation))).toBe(true);
    expect(JSON.stringify(chats)).not.toContain("ZQCANARY");
  });

  it("drops what it cannot place, by count, in words about Snaps and this file", () => {
    const { chats, issues } = parseSnapHistoryJson({
      alice: [snap(), snap({ Created: "not a time", "Created(microseconds)": undefined }), snap({ IsSender: undefined }), "junk"],
      other: 5,
    });
    expect(chats).toHaveLength(2); // the Snap without IsSender still counts as activity
    expect(chats.map((c) => c.direction)).toEqual(["received", "unknown"]);
    expect(issues.map((i) => [i.severity, i.code, i.message])).toEqual([
      ["warning", "snap-invalid-entries", "1 entry in snap_history.json was not an object and skipped."],
      ["warning", "snap-bad-timestamp", "1 Snap has no readable timestamp and was skipped."],
      ["info", "snap-non-list-values", "1 top-level snap_history.json value is not a Snap list and was skipped."],
      ["info", "snap-direction-unknown", "1 Snap has no IsSender flag, so whether it was sent or received is unknown; it still counts as activity."],
    ]);
    expect(allMessages(issues)).not.toContain("chat_history");
  });

  it("warns about a bare list and about a shape it cannot use, without a chat_history mention", () => {
    expect(parseSnapHistoryJson([snap()]).issues.map((i) => i.code)).toEqual(["snap-top-level-array"]);
    const bad = parseSnapHistoryJson("nope");
    expect(bad.chats).toEqual([]);
    expect(bad.issues).toEqual([{ severity: "warning", code: "snap-unexpected-shape", message: "snap_history.json has an unexpected top-level shape; no Snaps were read." }]);
  });

  it.each([null, undefined, 5, "s", [], {}, [null, 3, "x", {}], { a: null, b: [null], c: {} }])("never throws on %j", (bad) => {
    expect(() => parseSnapHistoryJson(bad)).not.toThrow();
  });

  it("does not echo a conversation key or a sender into any message", () => {
    const { issues } = parseSnapHistoryJson({ "ZQCANARY-KEY": [snap({ From: "ZQCANARY-FROM", Created: "x", "Created(microseconds)": undefined })] });
    expect(allMessages(issues)).not.toContain("ZQCANARY");
  });
});

describe("the fields the streaming reader keeps", () => {
  it("are the allowlisted ones: every kept name is an allowlist alias", () => {
    const allow = compileAllow({ any: ["issender", "from", "sender", "username", "mediatype", "type", "createdmicroseconds", "created", "createdat", "timestamp", "date", "conversationtitle", "title", "groupname"] });
    for (const name of HISTORY_KEEP_FIELDS) {
      expect(Object.keys(readAllowed({ [name]: "x" }, allow)), name).toEqual(["any"]);
    }
  });

  it("include the real spellings, in any letter case, and never message text", () => {
    const kept = new Set(HISTORY_KEEP_FIELDS.map((n) => n.toLowerCase()));
    for (const real of ["IsSender", "From", "Media Type", "Created(microseconds)", "Created", "Conversation Title"]) {
      expect(kept.has(real.toLowerCase()), real).toBe(true);
    }
    expect([...kept].filter((n) => /content|text|caption|body|message|location/.test(n))).toEqual([]);
  });
});

describe("the streaming reader gives what the in-memory parse gives", () => {
  const docs: [string, unknown][] = [
    ["conversations with groups", {
      alice: [snap(), snap({ IsSender: true, "Created(microseconds)": us(T + 10) })],
      Bob: [snap({ From: "bob", "Media Type": "VIDEO", "Created(microseconds)": us(T + 20) })],
      "Study Squad 📚": [snap({ From: "cleo", "Conversation Title": "Study Squad 📚" }), snap({ From: "dan", "Conversation Title": "Study Squad 📚", "Created(microseconds)": us(T + 30) })],
    }],
    ["other spellings of the field names", {
      alice: [{ from: "alice", media_type: "IMAGE", created_at: "2026-10-01 12:00:00 UTC", is_sender: false }, { FROM: "alice", MediaType: "VIDEO", Created: "2026-10-02 12:00:00 UTC", IS_SENDER: "true" }],
    }],
    ["a flat list named after a saved-chat section", { SavedChatHistory: [snap({ From: "alice" }), snap({ IsSender: true, "Conversation Title": "A Group" })] }],
    ["entries with no direction or no time", { alice: [snap({ IsSender: undefined }), snap({ Created: "x", "Created(microseconds)": undefined }), snap()] }],
    ["a conversation that only the owner wrote in", { "A Long Title With Spaces": [snap({ IsSender: true, From: "me" })], zed: [snap({ IsSender: true, From: "me" })] }],
    ["nothing at all", {}],
  ];

  it.each(docs)("%s", async (_name, doc) => {
    for (const history of ["chat", "snap"] as const) {
      const whole = history === "chat" ? parseChatHistoryJson(doc) : parseSnapHistoryJson(doc);
      expect(await viaStream(doc, history)).toEqual(whole);
    }
  });

  it("never decodes message text, raw or escaped, in a field it skips", async () => {
    const decoded: string[] = [];
    const real = TextDecoder.prototype.decode;
    vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (this: TextDecoder, ...args: Parameters<typeof real>) {
      const out = real.apply(this, args);
      decoded.push(out);
      return out;
    });
    const doc = { alice: [{ ...snap(), Content: "ZQCANARY-MSG-raw señal", Nested: { Content: "ZQCANARY-MSG-nested" } }, { ...snap({ IsSender: true }), Content: "\\u005aQCANARY-MSG-escaped" }] };
    const text = JSON.stringify(doc).replace("ZQCANARY-MSG-raw", "\\u005aQCANARY-MSG-esc2");
    const reader = new HistoryReader("chat");
    for await (const { conversationKey, record } of projectConversations(bytesSource(enc(text), 64), { keepFields: [...HISTORY_KEEP_FIELDS] })) reader.add(conversationKey, record);
    const out = reader.finish();
    expect(out.chats).toHaveLength(2);
    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded.join("\n").toLowerCase()).not.toContain("canary");
    expect(JSON.stringify(out)).not.toContain("CANARY");
  });
});
