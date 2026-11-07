import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseExportFiles, parseExportZip } from "../../src/export/parse.ts";
import { allMessages, enc, zipOf } from "./helpers.ts";

const FRIENDS = { Friends: [{ Username: "Alice" }, { Username: "bob" }], "Deleted Friends": [{ Username: "carl", Date: "2022-01-01 00:00:00 UTC" }] };
const CHATS = { alice: [{ From: "alice", "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", IsSender: false }] };
const MEMORIES = {
  "Saved Media": [{ Date: "2023-04-01 12:30:00 UTC", "Media Type": "Image", "Media Download Url": "https://example.invalid/x" }],
};

/** Overwrite the declared uncompressed size of one central-directory entry. */
function patchDeclaredSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 < out.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLen = view.getUint16(i + 28, true);
    if (new TextDecoder().decode(out.subarray(i + 46, i + 46 + nameLen)) === name) view.setUint32(i + 24, size, true);
  }
  return out;
}

describe("parseExportFiles", () => {
  it("finds the JSON files at the zip root or under json/ and reads all three", () => {
    for (const prefix of ["", "json/", "mydata_123/json/"]) {
      const p = parseExportFiles({
        [`${prefix}friends.json`]: enc(FRIENDS),
        [`${prefix}chat_history.json`]: enc(CHATS),
        [`${prefix}memories_history.json`]: enc(MEMORIES),
      });
      expect(p.friends.friends.map((f) => f.username)).toEqual(["alice", "bob"]);
      expect(p.friends.deletedFriends[0]?.deletedAt).toBe(Date.UTC(2022, 0, 1));
      expect(p.chats).toHaveLength(1);
      expect(p.memories).toHaveLength(1);
    }
  });

  it("prefers the shallowest copy of a file", () => {
    const p = parseExportFiles({
      "backup/old/friends.json": enc({ Friends: [{ Username: "stale" }] }),
      "friends.json": enc(FRIENDS),
    });
    expect(p.friends.friends.map((f) => f.username)).toEqual(["alice", "bob"]);
  });

  it("strips a UTF-8 BOM, a doubled BOM and handles UTF-16LE", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const withBom = (b: Uint8Array) => Uint8Array.from([...bom, ...b]);
    const utf16 = (s: string) => {
      const out = new Uint8Array(2 + s.length * 2);
      out[0] = 0xff;
      out[1] = 0xfe;
      for (let i = 0; i < s.length; i++) new DataView(out.buffer).setUint16(2 + i * 2, s.charCodeAt(i), true);
      return out;
    };
    for (const bytes of [withBom(enc(FRIENDS)), withBom(withBom(enc(FRIENDS))), utf16(JSON.stringify(FRIENDS))]) {
      const p = parseExportFiles({ "json/friends.json": bytes });
      expect(p.issues).toEqual([]);
      expect(p.friends.friends).toHaveLength(2);
    }
  });

  it("reports invalid JSON without echoing any of it", () => {
    const p = parseExportFiles({ "friends.json": enc('{"Friends":[{"Username":"canary_user_zz"') });
    expect(p.issues.map((i) => i.code)).toEqual(["json-parse-failed"]);
    expect(allMessages(p.issues)).not.toContain("canary_user_zz");
    expect(p.friends.friends).toEqual([]);
  });

  it("never decodes files other than the three known ones", () => {
    const p = parseExportFiles({
      "friends.json": enc(FRIENDS),
      "json/account.json": enc("{ not json but would error if read"),
      "json/user_profile.json": enc("{ also not json"),
    });
    expect(p.issues).toEqual([]);
    expect(p.fileList).toEqual(["friends.json", "json/account.json", "json/user_profile.json"]);
  });

  it("lists media by count only, skips junk entries and links only files under memories/ with sizes", () => {
    const p = parseExportFiles({
      "json/memories_history.json": enc(MEMORIES),
      "memories/2023-04-01_abc-main.jpg": new Uint8Array(1234),
      "chat_media/2023-04-01_zzz.jpg": new Uint8Array(99),
      "__MACOSX/json/._friends.json": new Uint8Array(1),
      "html/": new Uint8Array(0),
    });
    expect(p.memories[0]).toMatchObject({ zipPath: "memories/2023-04-01_abc-main.jpg", sizeBytes: 1234 });
    expect(p.fileList).toEqual(["json/memories_history.json"]);
    expect(p.issues.find((i) => i.code === "media-not-opened")?.message).toContain("2 media files");
  });

  it("normalises Windows-style paths", () => {
    const p = parseExportFiles({ "json\\friends.json": enc(FRIENDS) });
    expect(p.friends.friends).toHaveLength(2);
    expect(p.fileList).toEqual(["json/friends.json"]);
  });

  it("returns an empty export for no files, without throwing", () => {
    const p = parseExportFiles({});
    expect(p.friends.friends).toEqual([]);
    expect(p.fileList).toEqual([]);
  });

  it("parses large inputs (100k chat events, 5k friends) in reasonable time", () => {
    const chat: Record<string, unknown[]> = {};
    for (let c = 0; c < 1000; c++) {
      chat[`f${c}`] = Array.from({ length: 100 }, (_, i) => ({ From: i % 2 ? "me" : `f${c}`, "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", IsSender: i % 2 === 1 }));
    }
    const friends = { Friends: Array.from({ length: 5000 }, (_, i) => ({ Username: `u${i}` })) };
    const t0 = performance.now();
    const p = parseExportFiles({ "friends.json": enc(friends), "chat_history.json": enc(chat) });
    expect(p.chats).toHaveLength(100_000);
    expect(p.friends.friends).toHaveLength(5000);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe("parseExportZip", () => {
  it("reads a zip with files at root or under json/", () => {
    const p = parseExportZip(zipOf({ "json/friends.json": FRIENDS, "chat_history.json": CHATS, "memories_history.json": MEMORIES }));
    expect(p.friends.friends).toHaveLength(2);
    expect(p.chats).toHaveLength(1);
    expect(p.memories).toHaveLength(1);
    expect(p.fileList.sort()).toEqual(["chat_history.json", "json/friends.json", "memories_history.json"]);
  });

  it("never inflates media or unknown files (corrupt compressed data does not matter)", () => {
    const media = new Uint8Array(20_000).fill(7);
    const zip = zipSync({
      "json/friends.json": enc(FRIENDS),
      "json/account.json": enc({ filler: "x".repeat(2000) }),
      "memories/photo.jpg": media,
    });
    // Corrupt the deflate stream of the media entry and of the unrelated JSON.
    const bad = zip.slice();
    for (const name of ["memories/photo.jpg", "json/account.json"]) {
      const at = new TextDecoder("latin1").decode(bad).indexOf(name);
      const extraLen = new DataView(bad.buffer).getUint16(at - 30 + 28, true);
      const dataStart = at + name.length + extraLen;
      for (let i = 0; i < 6; i++) bad[dataStart + i] = 0xff;
    }
    // Control: really inflating the corrupt zip would fail.
    expect(() => unzipSync(bad)).toThrow();

    const p = parseExportZip(bad);
    expect(p.issues.map((i) => i.code)).toEqual(["media-not-opened"]);
    expect(p.friends.friends).toHaveLength(2);
    expect(p.fileList.sort()).toEqual(["json/account.json", "json/friends.json"]);
  });

  it("links bundled memory files with sizes taken from the zip directory", () => {
    const p = parseExportZip(
      zipOf({ "json/memories_history.json": MEMORIES, "memories/2023-04-01_abc-main.jpg": new Uint8Array(500).fill(1) }),
    );
    expect(p.memories[0]).toMatchObject({ zipPath: "memories/2023-04-01_abc-main.jpg", sizeBytes: 500 });
  });

  it("estimates exportedAt from the newest entry mtime (within a day of the stamp)", () => {
    const stamp = Date.UTC(2024, 5, 1, 12, 0, 0);
    const zip = zipSync({
      "json/friends.json": [enc(FRIENDS), { mtime: new Date(stamp - 5 * 86_400_000) }],
      "json/chat_history.json": [enc(CHATS), { mtime: new Date(stamp) }],
    });
    const p = parseExportZip(zip);
    expect(Math.abs((p.exportedAt ?? 0) - stamp)).toBeLessThan(2 * 86_400_000);
  });

  it("refuses to inflate JSON whose declared size busts the zip-bomb cap", () => {
    const zip = patchDeclaredSize(zipOf({ "json/friends.json": FRIENDS, "json/chat_history.json": CHATS }), "json/friends.json", 0x50000000);
    const p = parseExportZip(zip);
    expect(p.issues.map((i) => i.code)).toContain("zip-json-too-large");
    expect(p.friends.friends).toEqual([]);
    expect(p.chats).toHaveLength(1);
  });

  it("is bounded by the declared size even if the data would expand further", () => {
    const zip = patchDeclaredSize(zipOf({ "json/friends.json": { Friends: [{ Username: "a" }], pad: "x".repeat(5000) } }), "json/friends.json", 40);
    const p = parseExportZip(zip);
    // Truncated output is not valid JSON: reported, never expanded past the declared size.
    expect(p.issues.map((i) => i.code)).toContain("json-parse-failed");
  });

  it.each([new Uint8Array(0), new Uint8Array(10), enc("this is not a zip file at all, just text padding.....")])(
    "reports an unreadable archive instead of throwing",
    (bytes) => {
      const p = parseExportZip(bytes);
      expect(p.issues.map((i) => i.code)).toEqual(["zip-unreadable"]);
      expect(p.friends.friends).toEqual([]);
    },
  );

  it("reports a truncated zip without throwing", () => {
    const zip = zipOf({ "json/friends.json": FRIENDS });
    const p = parseExportZip(zip.subarray(0, zip.length - 10));
    expect(p.issues[0]?.severity).toBe("error");
  });

  it("an HTML-only export yields no data and keeps html names for validateExport", () => {
    const p = parseExportZip(zipOf({ "html/friends.html": "<html></html>", "index.html": "<html></html>" }));
    expect(p.friends.friends).toEqual([]);
    expect(p.fileList.sort()).toEqual(["html/friends.html", "index.html"]);
  });
});
