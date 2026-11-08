import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { shownFileName } from "../../src/export/parse.ts";
import { failureClass, validateExport } from "../../src/export/parse.ts";
import { bytesReader, listZipEntries, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { emptyFriends } from "../../src/export/friends.ts";
import type { ExportIssue, ParsedExport } from "../../src/types.ts";
import { enc } from "./helpers.ts";

const FRIENDS = { Friends: [{ Username: "amy" }, { Username: "bob" }] };

function goodZip(): Uint8Array {
  return zipSync({ "json/friends.json": enc(FRIENDS), "json/chat_history.json": enc({ amy: [{ From: "amy", "Media Type": "TEXT", Created: "2024-01-01 10:00:00 UTC", IsSender: false }] }) });
}

/** Set flag bits and/or the method in every local and central header of a zip. */
function patch(bytes: Uint8Array, change: { flags?: number; method?: number }): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50) {
      if (change.flags !== undefined) view.setUint16(i + 6, change.flags, true);
      if (change.method !== undefined) view.setUint16(i + 8, change.method, true);
    } else if (sig === 0x02014b50) {
      if (change.flags !== undefined) view.setUint16(i + 8, change.flags, true);
      if (change.method !== undefined) view.setUint16(i + 10, change.method, true);
    }
  }
  return out;
}

const truncated = (bytes: Uint8Array): Uint8Array => bytes.subarray(0, Math.floor(bytes.length / 2));

describe("a ZIP file that cannot be read is named", () => {
  it("keeps the generic text without a name", async () => {
    const parsed = await parseExportFromReader(bytesReader(truncated(goodZip())));
    expect(parsed.issues).toEqual([{ severity: "error", code: "zip-unreadable", message: "Snappy could not read this file as a ZIP file." }]);
  });

  it("names the person's file and says the lists are affected for part 1", async () => {
    const parsed = await parseExportFromReader(bytesReader(truncated(goodZip())), { name: "mydata~1700000000000.zip", part: 1 });
    expect(parsed.issues[0]?.message).toBe("Snappy could not read mydata~1700000000000.zip as a ZIP file. It holds your lists, so download it again.");
  });

  it("names a later part and says that most likely only photos and videos are affected", async () => {
    const parsed = await parseExportFromReader(bytesReader(truncated(goodZip())), { name: "mydata~1700000000000-4.zip", part: 4 });
    const message = parsed.issues[0]?.message ?? "";
    expect(message).toContain("mydata~1700000000000-4.zip");
    expect(message).toContain("most likely holds only photos and videos, so your lists are not affected");
    expect(message).not.toContain("holds your lists");
  });

  it("repeats nothing but a cleaned file name: no path, control, escape or direction characters, bounded length", () => {
    expect(shownFileName("C:\\Users\\someone\\Downloads\\mydata~1.zip")).toBe("mydata~1.zip");
    expect(shownFileName("/home/x/mydata~1.zip")).toBe("mydata~1.zip");
    expect(shownFileName("a\u001b[31mred\u0007.zip")).toBe("a[31mred.zip");
    expect(shownFileName("evil\u202etxt.zip")).toBe("eviltxt.zip");
    expect(shownFileName("\u200f\u202e  ")).toBeUndefined();
    expect(shownFileName("")).toBeUndefined();
    expect(shownFileName(undefined)).toBeUndefined();
    const long = shownFileName(`${"x".repeat(300)}.zip`) ?? "";
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });

  it("a hostile file name never reaches the notice raw", async () => {
    const parsed = await parseExportFromReader(bytesReader(truncated(goodZip())), { name: "x\u001b]0;title\u0007\u202e.zip", part: 1 });
    // eslint-disable-next-line no-control-regex
    expect(parsed.issues[0]?.message).not.toMatch(/[\u0000-\u001f\u202e]/);
  });

  it("names the file in the notice about a data file that cannot be opened", async () => {
    const zip = goodZip();
    const { entries } = await listZipEntries(bytesReader(zip));
    const friends = entries.find((e) => e.name === "json/friends.json");
    const damaged = zip.slice();
    // Damage the compressed bytes of friends.json (after its local header) so inflating fails.
    const at = (friends?.localHeaderOffset ?? 0) + 30 + "json/friends.json".length;
    for (let i = 0; i < 6; i++) damaged[at + i] = 0xff;
    const parsed = await parseExportFromReader(bytesReader(damaged), { name: "mydata~1700000000000.zip", part: 1 });
    const hit = parsed.issues.find((i) => i.code === "zip-entry-unreadable");
    expect(hit?.message).toBe("Snappy could not open friends.json inside mydata~1700000000000.zip.");
  });
});

describe("why an entry cannot be opened is passed through", () => {
  it("a password protected ZIP says so", async () => {
    const parsed = await parseExportFromReader(bytesReader(patch(goodZip(), { flags: 1 })), { name: "mydata~1700000000000.zip" });
    const hit = parsed.issues.find((i) => i.code === "zip-encrypted");
    expect(hit).toMatchObject({ severity: "error", message: "mydata~1700000000000.zip is password protected. Snappy cannot open it." });
    expect(parsed.issues.map((i) => i.code)).not.toContain("zip-entry-unreadable");
  });

  it("says the same without a name", async () => {
    const parsed = await parseExportFromReader(bytesReader(patch(goodZip(), { flags: 1 })));
    expect(parsed.issues.find((i) => i.code === "zip-encrypted")?.message).toBe("This ZIP file is password protected. Snappy cannot open it.");
  });

  it("AES encryption (method 99) is a password too", async () => {
    const parsed = await parseExportFromReader(bytesReader(patch(goodZip(), { method: 99 })));
    expect(parsed.issues.map((i) => i.code)).toContain("zip-encrypted");
  });

  it("another unknown method is reported as unsupported", async () => {
    const parsed = await parseExportFromReader(bytesReader(patch(goodZip(), { method: 14 })));
    const hit = parsed.issues.find((i) => i.code === "zip-unsupported-method");
    expect(hit?.message).toBe("This ZIP file uses a compression method Snappy does not support.");
    expect(parsed.issues.map((i) => i.code)).not.toContain("zip-entry-unreadable");
  });

  it("each one is a root cause that leaves out the follow-on notices", async () => {
    for (const change of [{ flags: 1 }, { method: 14 }]) {
      const parsed = await parseExportFromReader(bytesReader(patch(goodZip(), change)));
      expect(validateExport(parsed).map((i) => i.code)).toEqual([]);
    }
  });

  it("failureClass says a password needs a different remedy than a damaged file", () => {
    const i = (code: string): ExportIssue => ({ severity: "error", code, message: "x" });
    expect(failureClass([i("zip-encrypted")])).toBe("password");
    expect(failureClass([i("zip-encrypted"), i("zip-unreadable")])).toBe("password");
    expect(failureClass([i("zip-unsupported-method")])).toBe("unreadable");
    expect(failureClass([i("zip-entry-too-large")])).toBe("unreadable");
  });
});

describe("friends.json that is there but not understood", () => {
  const parsed = (over: Partial<ParsedExport>): ParsedExport => ({ friends: emptyFriends(), chats: [], memories: [], fileList: ["friends.json"], issues: [], ...over });
  const warn = (code: string): ExportIssue => ({ severity: "warning", code, message: "x" });

  it("is not blamed on the request", () => {
    const out = validateExport(parsed({ issues: [warn("friends-no-sections")] }));
    expect(out.map((i) => i.code)).toContain("friends-layout-unknown");
    expect(out.map((i) => i.code)).not.toContain("no-friends-section");
    const hit = out.find((i) => i.code === "friends-layout-unknown");
    expect(hit).toMatchObject({ severity: "error", message: "friends.json is in your export, but Snappy does not know its layout. Run the inspect command and share the shape." });
  });

  it("covers a friends.json that is not an object or a list too", () => {
    expect(validateExport(parsed({ issues: [warn("friends-unexpected-shape")] })).map((i) => i.code)).toContain("friends-layout-unknown");
  });

  it("a friends.json that is not valid JSON gets only that notice", () => {
    const issue: ExportIssue = { severity: "error", code: "json-parse-failed", message: "friends.json is not valid JSON, so it was not read." };
    const out = validateExport(parsed({ issues: [issue] })).map((i) => i.code);
    expect(out).not.toContain("friends-layout-unknown");
    expect(out).not.toContain("no-friends-section");
  });

  it("a missing friends.json still says to request the export again", () => {
    const out = validateExport(parsed({ fileList: ["chat_history.json"] }));
    expect(out.map((i) => i.code)).toContain("no-friends-section");
    expect(out.map((i) => i.code)).not.toContain("friends-layout-unknown");
  });
});
