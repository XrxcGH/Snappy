/**
 * Synthetic export variants for the import checks. Everything is generated here, at run time,
 * from made-up names and dates: nothing is committed as data and no real export is involved.
 * Each variant is a list of ZIP parts plus the issue codes the import is expected to report
 * (after the parts are merged and validated), so a change in how a layout is read shows up as a
 * changed row, not as a silent difference.
 *
 * Used by packages/core/test/export/variants.test.ts and by tools/import-check/run.ts.
 */
import { zipSync } from "fflate";
import { bytesReader, mergeParsedExports, parseExportFromReader, validateExport } from "../../packages/core/src/index.ts";
import type { ParsedExport } from "../../packages/core/src/index.ts";

export interface VariantPart {
  name: string;
  bytes: Uint8Array;
}

export interface Variant {
  id: string;
  title: string;
  parts: VariantPart[];
  /** Sorted, de-duplicated issue codes of the merged import plus whole-export checks. */
  expect: string[];
  /** Friends found in the merged import (omit when the row is about the notices only). */
  friends?: number;
}

const OWNER = "me_user";
const enc = (v: unknown): Uint8Array => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const stamp = (i: number, year = 2023): string => `${year}-0${1 + (i % 9)}-1${i % 9} 10:00:00 UTC`;

// ----------------------------------------------------------------- base files ---

const friendEntry = (name: string, i: number): Record<string, unknown> => ({
  Username: name,
  "Display Name": `Person ${i}`,
  "Creation Timestamp": stamp(i),
  "Last Modified Timestamp": stamp(i),
  Source: "Added by Username",
});

function friendsJson(count = 30): Record<string, unknown> {
  return {
    Friends: range(count).map((i) => friendEntry(`friend_${i}`, i)),
    "Friend Requests Sent": range(2).map((i) => friendEntry(`sent_${i}`, i)),
    "Deleted Friends": range(2).map((i) => ({ Username: `gone_${i}`, "Display Name": `Gone ${i}`, Date: stamp(i) })),
    "Blocked Users": [],
  };
}

/** Chat history as one list of messages per conversation, the layout the parsers know best. */
function chatJson(conversations = 30, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const i of range(conversations)) {
    out[`friend_${i}`] = [
      { From: `friend_${i}`, "Media Type": "TEXT", Created: "2024-02-01 10:00:00 UTC", Content: "synthetic text", "Conversation Title": null, IsSender: false },
      { From: OWNER, "Media Type": "TEXT", Created: "2024-02-01 10:05:00 UTC", Content: "synthetic reply", "Conversation Title": null, IsSender: true },
    ];
  }
  return { ...out, ...extra };
}

function snapJson(conversations = 30): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const i of range(conversations)) {
    out[`friend_${i}`] = [
      { From: `friend_${i}`, "Media Type": "IMAGE", Created: "2024-03-01 10:00:00 UTC", IsSender: false },
      { From: OWNER, "Media Type": "VIDEO", Created: "2024-03-01 10:05:00 UTC", IsSender: true },
    ];
  }
  return out;
}

const memoriesJson = (): Record<string, unknown> => ({
  "Saved Media": range(3).map((i) => ({
    Date: `2023-06-0${1 + i} 10:00:00 UTC`,
    "Media Type": i === 1 ? "Video" : "Image",
    Location: "Latitude, Longitude: 1.5, 2.5",
    "Download Link": `https://example.invalid/download?id=${i}`,
    "Media Download Url": `https://example.invalid/download?id=${i}`,
  })),
});

type Files = Record<string, unknown>;

function baseFiles(): Files {
  return {
    "json/friends.json": friendsJson(),
    "json/chat_history.json": chatJson(),
    "json/snap_history.json": snapJson(),
    "json/memories_history.json": memoriesJson(),
  };
}

function zipOf(files: Files): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(files)) entries[path] = value instanceof Uint8Array ? value : enc(value);
  return zipSync(entries);
}

const part = (files: Files, name = "mydata~1700000000000.zip"): VariantPart => ({ name, bytes: zipOf(files) });

/** Set bits or values in the headers of every entry of a zip (flags at local +6 / central +8, method at local +8 / central +10). */
function patchHeaders(bytes: Uint8Array, patch: { flagsOr?: number; method?: number }): Uint8Array {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++) {
    const sig = view.getUint32(i, true);
    if (sig === 0x04034b50) {
      if (patch.flagsOr !== undefined) view.setUint16(i + 6, view.getUint16(i + 6, true) | patch.flagsOr, true);
      if (patch.method !== undefined) view.setUint16(i + 8, patch.method, true);
    } else if (sig === 0x02014b50) {
      if (patch.flagsOr !== undefined) view.setUint16(i + 8, view.getUint16(i + 8, true) | patch.flagsOr, true);
      if (patch.method !== undefined) view.setUint16(i + 10, patch.method, true);
    }
  }
  return out;
}

const utf16le = (v: unknown): Uint8Array => {
  const text = JSON.stringify(v);
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[2 + i * 2] = c & 0xff;
    out[3 + i * 2] = c >> 8;
  }
  return out;
};

// ------------------------------------------------------------------- variants ---

/** Every variant. The expected codes are what the import reports today; a fix changes its row. */
export function buildVariants(): Variant[] {
  const out: Variant[] = [];
  const add = (id: string, title: string, parts: VariantPart[], expectCodes: string[], friends?: number): void => {
    out.push({ id, title, parts, expect: expectCodes, ...(friends !== undefined && { friends }) });
  };
  const withFriends = (friends: unknown, rest: Files = {}): Files => ({ ...baseFiles(), "json/friends.json": friends, ...rest });

  add("v00", "baseline: per-conversation chat and Snaps, Saved Media", [part(baseFiles())], [], 30);
  add("v03", "UTF-8 byte order mark", [part({ ...baseFiles(), "json/friends.json": new Uint8Array([0xef, 0xbb, 0xbf, ...enc(friendsJson())]) })], [], 30);
  add("v04", "friends.json in UTF-16", [part({ ...baseFiles(), "json/friends.json": utf16le(friendsJson()) })], ["json-parse-failed","no-friends-section"], 0);
  add("v05", "everything under a mydata_ folder", [part(Object.fromEntries(Object.entries(baseFiles()).map(([k, v]) => [`mydata_1700000000000/${k}`, v])))], [], 30);
  add("v06", "HTML only (the default Snapchat format)", [part({ "html/index.html": "<html></html>", "html/friends.html": "<html></html>", "html/chat_history.html": "<html></html>" })], ["html-only-export"], 0);
  const upper = baseFiles();
  delete upper["json/friends.json"];
  add("v07", "upper-case folder and file name", [part({ ...upper, "JSON/Friends.JSON": friendsJson() })], [], 30);
  add("v08", "localized section names", [part(withFriends({ Freunde: range(5).map((i) => friendEntry(`friend_${i}`, i)), "Gelöschte Freunde": [{ Username: "gone_0", Date: stamp(0) }] }))], ["friends-no-sections","no-friends-section"], 0);
  add("v09", "snake_case keys", [part(withFriends({ friends: range(5).map((i) => ({ username: `friend_${i}`, creation_timestamp: stamp(i) })) }))], [], 5);
  add("v10", "friends nested one level", [part(withFriends({ "User Data": friendsJson() }))], ["friends-no-sections","no-friends-section"], 0);
  add("v15", "empty Friends with deleted friends listed", [part(withFriends({ Friends: [], "Deleted Friends": range(5).map((i) => ({ Username: `gone_${i}`, Date: stamp(i) })) }))], ["friends-empty-but-deleted"], 0);
  add("v20", "a ZIP inside a ZIP", [{ name: "mydata~1700000000000.zip", bytes: zipSync({ "mydata~1700000000000.zip": [zipOf(baseFiles()), { level: 0 }] }) }], ["chat-history-missing","memories-missing","no-friends-section","snap-history-missing"], 0);
  add("v21a", "empty file", [{ name: "mydata~1700000000000.zip", bytes: new Uint8Array(0) }], ["zip-unreadable"], 0);
  add("v21b", "ZIP with no entries", [{ name: "mydata~1700000000000.zip", bytes: zipSync({}) }], ["chat-history-missing","memories-missing","no-friends-section","snap-history-missing"], 0);
  const whole = zipOf(baseFiles());
  add("v21c", "truncated part", [{ name: "mydata~1700000000000.zip", bytes: whole.subarray(0, Math.floor(whole.length * 0.6)) }], ["zip-unreadable"], 0);
  add("v21d", "password protected part", [{ name: "mydata~1700000000000.zip", bytes: patchHeaders(whole, { flagsOr: 1 }) }], ["zip-entry-unreadable"], 0);
  add("v21e", "AES encrypted part (method 99)", [{ name: "mydata~1700000000000.zip", bytes: patchHeaders(whole, { method: 99 }) }], ["zip-entry-unreadable"], 0);
  add("v22", "unknown friends sections next to known ones", [part(withFriends({ ...friendsJson(), "Mystery List": [{ Username: "x" }], Notes: "text" }))], ["friends-unknown-sections"], 30);
  add("v23", "friends only", [part({ "json/friends.json": friendsJson() })], ["chat-history-missing","memories-missing","snap-history-missing"], 30);
  add("v24", "chat only", [part({ "json/chat_history.json": chatJson() })], ["memories-missing","no-friends-section","snap-history-missing"], 0);
  add("v28", "saved_chat_history.json", [part({ "json/friends.json": friendsJson(), "json/saved_chat_history.json": chatJson() })], ["chat-history-missing","memories-missing","snap-history-missing"], 30);
  add("v29", "a stray chat_history.json in chat_media", [part({ ...baseFiles(), "chat_media/chat_history.json": { stray: [{ From: "x", "Media Type": "TEXT", Created: "2024-01-01 10:00:00 UTC", Content: "x", IsSender: true }] } })], [], 30);
  add("v30", "unicode, short and spaced usernames", [part(withFriends({ Friends: ["zoë", "я_друг", "a", "two words", "名前"].map((n, i) => friendEntry(n, i)) }))], [], 5);
  add("v31", "chat keyed by display name", [part({ ...baseFiles(), "json/chat_history.json": Object.fromEntries(range(30).map((i) => [`Person ${i}`, [{ From: `friend_${i}`, "Media Type": "TEXT", Created: "2024-02-01 10:00:00 UTC", Content: "x", "Conversation Title": `Person ${i}`, IsSender: false }]])) })], ["chat-all-groups"], 30);
  return out;
}

// --------------------------------------------------------------------- running ---

export interface VariantResult {
  codes: string[];
  friends: number;
  merged: ParsedExport;
}

/** Read the parts the way the importers do (each part, then the merge) and list the issue codes the person would see. */
export async function runVariant(variant: Variant, now = Date.UTC(2025, 0, 1)): Promise<VariantResult> {
  const parsed: ParsedExport[] = [];
  for (const [index, p] of variant.parts.entries()) parsed.push(await parseExportFromReader(bytesReader(p.bytes), { part: index + 1 }));
  const merged = parsed.length === 1 ? (parsed[0] as ParsedExport) : mergeParsedExports(parsed);
  const codes = [...new Set([...merged.issues, ...validateExport(merged, { now })].map((i) => i.code))].sort();
  return { codes, friends: merged.friends.friends.length, merged };
}
