import { describe, expect, it } from "vitest";
import { parseExportFiles, parseExportZip, validateExport } from "../../src/export/parse.ts";
import { hashString } from "../../src/util.ts";
import { enc, zipOf } from "./helpers.ts";

/** Strings that must never appear anywhere in the parsed output. */
const CANARY = {
  text: "CANARY_MESSAGE_TEXT_8f3a",
  display: "CANARY_DISPLAY_NAME_51bc",
  location: "CANARY_LOCATION_77de",
  gps: "CANARY_GPS_99.12345",
  title: "CANARY_GROUP_TITLE_2c40",
  source: "CANARY_SOURCE_a1b2",
  extra: "CANARY_EXTRA_FIELD_c3d4",
  email: "canary_email@example.invalid",
  media: "CANARY_MEDIA_BYTES_e5f6",
  otherFile: "CANARY_OTHER_JSON_0a1b",
  mediaTypeAbuse: "CANARY-MEDIA-TYPE-ABUSE",
  sectionKey: "CANARY_SECTION_KEY_d7e8",
};
const ALL = Object.values(CANARY);

const T = "2023-04-01 12:30:00 UTC";

const salted = {
  friends: {
    Friends: [
      { Username: "Alice", "Display Name": CANARY.display, "Creation Timestamp": T, "Last Modified Timestamp": T, Source: CANARY.source, Email: CANARY.email, extra: { deep: CANARY.extra } },
    ],
    "Deleted Friends": [{ Username: "carl", "Display Name": CANARY.display, Date: T, Source: CANARY.source }],
    "Friend Requests Sent": [{ Username: "dora", "Display Name": CANARY.display }],
    [CANARY.sectionKey]: [{ Username: "zed", "Display Name": CANARY.display }],
  },
  chats: {
    alice: [
      { From: "alice", "Media Type": "TEXT", Created: T, Content: CANARY.text, IsSender: false, "Conversation Title": null, Extra: CANARY.extra },
      { From: "me", "Media Type": CANARY.mediaTypeAbuse, Created: T, Content: CANARY.text, IsSender: true, "Conversation Title": null },
    ],
    [CANARY.title]: [
      { From: "bob", "Media Type": "TEXT", Created: T, Content: CANARY.text, IsSender: false, "Conversation Title": CANARY.title },
      { From: "carol", "Media Type": "MEDIA", Created: T, Content: CANARY.text, IsSender: false, "Conversation Title": CANARY.title },
    ],
    "Saved Chat History": [
      { From: "me", "Media Type": "TEXT", Created: T, Content: CANARY.text, IsSender: true, "Conversation Title": `${CANARY.title}_flat` },
    ],
  },
  memories: {
    "Saved Media": [
      {
        Date: T,
        "Media Type": "Image",
        Location: `Latitude, Longitude: ${CANARY.gps}, ${CANARY.location}`,
        "Download Link": "https://example.invalid/page",
        "Media Download Url": "https://example.invalid/media",
        Caption: CANARY.text,
        extra: CANARY.extra,
      },
    ],
  },
};

describe("canary: unknown fields never reach the parsed export", () => {
  const files = {
    "json/friends.json": enc(salted.friends),
    "json/chat_history.json": enc(salted.chats),
    "json/memories_history.json": enc(salted.memories),
    "json/account.json": enc({ Email: CANARY.otherFile }),
    "memories/2023-04-01_abc-main.jpg": enc(`JFIF ${CANARY.media}`),
    "chat_media/photo.jpg": enc(`JFIF ${CANARY.media}`),
  };

  const check = (parsed: ReturnType<typeof parseExportFiles>) => {
    const dump = JSON.stringify(parsed) + JSON.stringify(validateExport(parsed, { expectedFriendCount: 50 }));
    for (const c of ALL) expect(dump, c).not.toContain(c);
    // Sanity: the allowed data did come through, so the assertion above is not vacuous.
    expect(parsed.friends.friends.map((f) => f.username)).toEqual(["alice"]);
    expect(parsed.friends.deletedFriends.map((f) => f.username)).toEqual(["carl"]);
    expect(parsed.chats.length).toBe(5);
    expect(parsed.memories).toHaveLength(1);
    expect(parsed.chats.some((c) => c.conversation === `group:${hashString(CANARY.title)}`)).toBe(true);
    expect(parsed.chats.some((c) => c.kind === "UNKNOWN")).toBe(true);
  };

  it("holds for extracted files", () => check(parseExportFiles(files)));
  it("holds for a zip", () => check(parseExportZip(zipOf(files))));

  it("holds for issues produced by malformed input", () => {
    const parsed = parseExportFiles({
      "friends.json": enc(`{"Friends":[{"Username":"${CANARY.extra}`),
      "chat_history.json": enc({ [CANARY.title]: [null, { From: CANARY.display, Created: "bad", IsSender: false, Content: CANARY.text }], [CANARY.sectionKey]: "x" }),
      "memories_history.json": enc({ [CANARY.sectionKey]: 1 }),
    });
    const dump = JSON.stringify(parsed.issues);
    for (const c of ALL) expect(dump, c).not.toContain(c);
    expect(parsed.issues.length).toBeGreaterThan(0);
  });
});
