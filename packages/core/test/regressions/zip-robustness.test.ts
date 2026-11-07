/**
 * Regression tests for zip handling: duplicate entry names, corrupt entries, size caps and the
 * truncated file list that validateExport reads. Declared sizes are patched on STORED entries,
 * which fflate never allocates by declared size, so no test here allocates hundreds of MB.
 */
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseExportFiles, parseExportZip } from "../../src/export/parse.ts";
import { describeZipStructure, formatStructureReport } from "../../src/export/inspect.ts";
import { parseJsonBytes } from "../../src/export/json-util.ts";
import { validateExport } from "../../src/export/validate.ts";
import { enc } from "../export/helpers.ts";

const FRIENDS = { Friends: [{ Username: "alice" }, { Username: "bob" }] };
const CHATS = { alice: [{ From: "alice", "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", IsSender: false }] };
const MEMORIES = { "Saved Media": [{ Date: "2023-04-01 12:30:00 UTC", "Media Type": "Image", "Media Download Url": "https://example.invalid/x" }] };

const copy = (b: Uint8Array): Uint8Array => new Uint8Array(b);

/** Visit every central-directory entry: (offset of the entry, its name). */
function eachEntry(zip: Uint8Array, visit: (at: number, name: string, view: DataView) => void): void {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 46 < zip.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLen = view.getUint16(i + 28, true);
    visit(i, new TextDecoder().decode(zip.subarray(i + 46, i + 46 + nameLen)), view);
  }
}

/** Overwrite the declared uncompressed size in the central directory entry called `name`. */
function patchDeclaredSize(zip: Uint8Array, name: string, size: number): Uint8Array {
  const out = copy(zip);
  eachEntry(out, (at, n, view) => {
    if (n === name) view.setUint32(at + 24, size, true);
  });
  return out;
}

/** Same-length rename of an entry in both its local and central headers. */
function renameEntry(zip: Uint8Array, from: string, to: string): Uint8Array {
  expect(to.length).toBe(from.length);
  const out = copy(zip);
  const a = enc(from);
  const b = enc(to);
  for (let i = 0; i + a.length <= out.length; i++) {
    if (a.every((byte, k) => out[i + k] === byte)) out.set(b, i);
  }
  return out;
}

/** Break the DEFLATE stream of one entry (an invalid block type) while leaving the headers intact. */
function corruptEntryData(zip: Uint8Array, name: string): Uint8Array {
  const out = copy(zip);
  eachEntry(out, (at, n, view) => {
    if (n !== name) return;
    const local = view.getUint32(at + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out.fill(0xff, start, start + 8);
  });
  return out;
}

/** JSON padded with spaces so that zipSync really deflates it. */
const compressible = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj) + " ".repeat(2000));

describe("duplicate entry names in a zip", () => {
  it("only the entry that was size-checked is inflated and parsed", () => {
    const zip = zipSync({
      "json/friends.json": enc({ Friends: [{ Username: "alice" }] }),
      "json/friends.jsoX": enc({ Friends: [{ Username: "mallory" }, { Username: "eve" }] }),
    });
    const p = parseExportZip(renameEntry(zip, "json/friends.jsoX", "json/friends.json"));
    expect(p.friends.friends.map((f) => f.username)).toEqual(["alice"]);
  });
});

describe("one corrupt entry", () => {
  const goodZip = () =>
    zipSync({
      "json/friends.json": enc(FRIENDS),
      "json/chat_history.json": enc(CHATS),
      "json/memories_history.json": compressible(MEMORIES),
    });

  it("parseExportZip keeps the other data files", () => {
    const p = parseExportZip(corruptEntryData(goodZip(), "json/memories_history.json"));
    expect(p.friends.friends.map((f) => f.username)).toEqual(["alice", "bob"]);
    expect(p.chats).toHaveLength(1);
    expect(p.memories).toEqual([]);
    const unreadable = p.issues.filter((i) => i.code === "zip-entry-unreadable");
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.message).toContain("memories_history.json");
  });

  it("parseExportZip survives an unsupported compression method on one entry", () => {
    const zip = copy(goodZip());
    eachEntry(zip, (at, n, view) => {
      if (n === "json/memories_history.json") view.setUint16(at + 10, 12, true); // bzip2
    });
    const p = parseExportZip(zip);
    expect(p.friends.friends).toHaveLength(2);
    expect(p.chats).toHaveLength(1);
    expect(p.issues.map((i) => i.code)).toContain("zip-entry-unreadable");
  });

  it("describeZipStructure still reports the readable files", () => {
    const zip = corruptEntryData(
      zipSync({ "json/friends.json": compressible(FRIENDS), "json/chat_history.json": compressible(CHATS) }),
      "json/chat_history.json",
    );
    const report = describeZipStructure(zip);
    expect(report.notes).toEqual([]);
    expect(report.files).toHaveLength(2);
    expect(report.files.filter((f) => f.structure !== undefined)).toHaveLength(1);
    expect(report.files.filter((f) => f.note === "could not be decompressed")).toHaveLength(1);
  });
});

describe("size caps", () => {
  it("parseExportZip refuses one JSON file above the per-file cap, well below the old 1 GB budget", () => {
    const stored = zipSync({ "json/friends.json": enc(FRIENDS), "json/chat_history.json": enc(CHATS) }, { level: 0 });
    const p = parseExportZip(patchDeclaredSize(stored, "json/friends.json", 0x20000000));
    expect(p.issues.map((i) => i.code)).toContain("zip-json-too-large");
    expect(p.friends.friends).toEqual([]);
    expect(p.chats).toHaveLength(1);
  });

  it("parseExportZip enforces the total budget across the three files", () => {
    let zip: Uint8Array = zipSync(
      { "json/friends.json": enc(FRIENDS), "json/chat_history.json": enc(CHATS), "json/memories_history.json": enc(MEMORIES) },
      { level: 0 },
    );
    for (const name of ["json/friends.json", "json/chat_history.json", "json/memories_history.json"]) {
      zip = patchDeclaredSize(zip, name, 200 * 1024 * 1024);
    }
    const p = parseExportZip(zip);
    expect(p.issues.filter((i) => i.code === "zip-json-too-large")).toHaveLength(1);
  });

  it("describeZipStructure stops inflating once the total budget is spent", () => {
    let zip: Uint8Array = zipSync({ "json/a.json": enc({ a: 1 }), "json/b.json": enc({ b: 1 }), "json/c.json": enc({ c: 1 }) }, { level: 0 });
    for (const name of ["json/a.json", "json/b.json", "json/c.json"]) zip = patchDeclaredSize(zip, name, 200 * 1024 * 1024);
    const report = describeZipStructure(zip);
    expect(report.files.filter((f) => f.structure !== undefined)).toHaveLength(2);
    expect(report.files.filter((f) => f.note === "not read (size budget reached)")).toHaveLength(1);
    expect(formatStructureReport(report)).toContain("not read (size budget reached)");
  });

  it("describeZipStructure inflates only the first of two entries with the same name", () => {
    const zip = zipSync({ "json/x.json": enc({ Friends: [] }), "json/x.jsoX": enc({ Snap: [] }) });
    const report = describeZipStructure(renameEntry(zip, "json/x.jsoX", "json/x.json"));
    const text = formatStructureReport(report);
    expect(text).toContain("Friends");
    expect(text).not.toContain("Snap:");
  });
});

describe("oversize text", () => {
  it("is reported as too large, not as invalid JSON, when the engine cannot build the string", () => {
    const tooBig = new Proxy(new Uint8Array(8), {
      get(target, prop) {
        if (prop === "length") throw new RangeError("Invalid string length");
        const v = Reflect.get(target, prop, target) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const r = parseJsonBytes("friends.json", tooBig);
    expect(r.issues.map((i) => i.code)).toEqual(["json-too-large"]);
    expect(r.issues[0]!.message).not.toContain("not valid JSON");
  });
});

describe("file list truncation versus validateExport", () => {
  it("does not report an HTML-only export when the JSON files sort after 600 html pages", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 600; i++) files[`html/chat_history/c${i}.html`] = enc("<p></p>");
    files["json/friends.json"] = enc(FRIENDS);
    files["json/chat_history.json"] = enc({});
    const parsed = parseExportFiles(files);
    expect(parsed.fileList).toHaveLength(500);
    expect(parsed.issues.map((i) => i.code)).toContain("file-list-truncated");
    const codes = validateExport(parsed).map((i) => i.code);
    expect(codes).not.toContain("html-only-export");
    expect(codes).not.toContain("chat-history-missing");
  });

  it("still reports a genuinely HTML-only export", () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 600; i++) files[`html/page${i}.html`] = enc("<p></p>");
    const parsed = parseExportFiles(files);
    expect(parsed.fileList).toHaveLength(500);
    expect(validateExport(parsed).map((i) => i.code)).toContain("html-only-export");
  });
});
