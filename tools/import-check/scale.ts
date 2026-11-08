/**
 * Large synthetic exports for the import checks, built at run time from made-up names. The big
 * ones are sparse (see sparse-zip.ts): the JSON is real, the photos and videos are never stored.
 *
 * "real6" has the shape of a real export of a heavy user: six ZIP parts, the lists and histories in
 * part 1, and 40,000 Memories files spread over parts 2 to 6.
 */
import { mergeParsedExports, parseExportFromReader, validateExport } from "../../packages/core/src/index.ts";
import type { LocalTimeProgress, ParsedExport, RandomAccessReader } from "../../packages/core/src/index.ts";
import { sparseZip } from "./sparse-zip.ts";
import type { SparseEntry } from "./sparse-zip.ts";

export interface ScaleOptions {
  parts: number;
  friends: number;
  conversations: number;
  messagesPerConversation: number;
  snapsPerConversation: number;
  memories: number;
  /** Where the Memories files keep their UTC time: with the directory entry (the usual) or only in the local header. */
  localOnlyTimes: boolean;
}

export const REAL6: ScaleOptions = {
  parts: 6,
  friends: 3000,
  conversations: 2500,
  messagesPerConversation: 60,
  snapsPerConversation: 40,
  memories: 40_000,
  localOnlyTimes: false,
};

export interface ScaleExpect {
  friends: number;
  chatEvents: number;
  memories: number;
  paired: number;
}

export interface ScalePart {
  name: string;
  reader: RandomAccessReader;
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const BASE = Date.UTC(2021, 0, 1, 0, 0, 0);
const utcText = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC";
const memoryTime = (i: number): number => BASE + i * 37_000;

function friendsJson(n: number): Uint8Array {
  const entry = (name: string, i: number): string => `{"Username":"${name}","Display Name":"Person ${i}","Creation Timestamp":"${utcText(BASE + i * 60_000)}","Source":"Added by Username"}`;
  const list = (prefix: string, count: number): string => Array.from({ length: count }, (_, i) => entry(`${prefix}${i}`, i)).join(",");
  return enc(`{"Friends":[${list("friend_", n)}],"Friend Requests Sent":[${list("sent_", Math.floor(n / 20))}],"Deleted Friends":[${list("gone_", Math.floor(n / 10))}],"Blocked Users":[]}`);
}

function historyJson(conversations: number, perConversation: number, kind: "chat" | "snap"): Uint8Array {
  const parts: string[] = [];
  for (let c = 0; c < conversations; c++) {
    const friend = `friend_${c}`;
    const rows: string[] = [];
    for (let m = 0; m < perConversation; m++) {
      const mine = m % 2 === 1;
      const when = utcText(BASE + (c * perConversation + m) * 90_000);
      rows.push(
        kind === "chat"
          ? `{"From":"${mine ? "me_user" : friend}","Media Type":"TEXT","Created":"${when}","Content":"synthetic text ${m}","Conversation Title":null,"IsSender":${mine}}`
          : `{"From":"${mine ? "me_user" : friend}","Media Type":"${m % 3 === 0 ? "VIDEO" : "IMAGE"}","Created":"${when}","Conversation Title":null,"IsSender":${mine}}`,
      );
    }
    parts.push(`"${friend}":[${rows.join(",")}]`);
  }
  return enc(`{${parts.join(",")}}`);
}

function memoriesJson(n: number): Uint8Array {
  const rows = Array.from({ length: n }, (_, i) => `{"Date":"${utcText(memoryTime(i))}","Media Type":"${i % 4 === 3 ? "Video" : "Image"}","Location":"Latitude, Longitude: 0.0, 0.0","Download Link":"","Media Download Url":""}`);
  return enc(`{"Saved Media":[${rows.join(",")}]}`);
}

const uuid = (i: number): string => `${i.toString(16).padStart(8, "0")}-aaaa-bbbb-cccc-${i.toString(16).padStart(12, "0")}`.toUpperCase();

/** The parts of an export of the given shape, and what importing it must find. */
export function buildScale(opts: ScaleOptions): { parts: ScalePart[]; expect: ScaleExpect } {
  const stamp = "1700000000000";
  const names = Array.from({ length: opts.parts }, (_, i) => (i === 0 ? `mydata~${stamp}.zip` : `mydata~${stamp}-${i + 1}.zip`));
  const first: SparseEntry[] = [
    { name: "json/friends.json", bytes: friendsJson(opts.friends) },
    { name: "json/chat_history.json", bytes: historyJson(opts.conversations, opts.messagesPerConversation, "chat") },
    { name: "json/snap_history.json", bytes: historyJson(opts.conversations, opts.snapsPerConversation, "snap") },
    { name: "json/memories_history.json", bytes: memoriesJson(opts.memories) },
    { name: "html/index.html", bytes: enc("<html></html>") },
  ];
  const parts: ScalePart[] = [{ name: names[0] as string, reader: sparseZip(first) }];
  const mediaParts = Math.max(1, opts.parts - 1);
  for (let p = 0; p < mediaParts && opts.parts > 1; p++) {
    const entries: SparseEntry[] = [];
    for (let i = p; i < opts.memories; i += mediaParts) {
      entries.push({
        name: `memories/${new Date(memoryTime(i)).toISOString().slice(0, 10)}_${uuid(i)}-main.${i % 4 === 3 ? "mp4" : "jpg"}`,
        size: 200_000,
        utcMs: memoryTime(i),
        utcIn: opts.localOnlyTimes ? "local" : "both",
      });
    }
    parts.push({ name: names[p + 1] as string, reader: sparseZip(entries) });
  }
  const chatEvents = opts.conversations * (opts.messagesPerConversation + opts.snapsPerConversation);
  return { parts, expect: { friends: opts.friends, chatEvents, memories: opts.memories, paired: opts.parts > 1 ? opts.memories : 0 } };
}

export interface ScaleResult {
  seconds: number;
  merged: ParsedExport;
  errors: string[];
  phases: LocalTimeProgress[];
  reads: number;
}

/** Import the parts the way the importers do (each part, then the merge), counting what was read. */
export async function runScale(parts: ScalePart[]): Promise<ScaleResult> {
  const start = performance.now();
  const parsed: ParsedExport[] = [];
  const phases: LocalTimeProgress[] = [];
  let reads = 0;
  for (const [index, p] of parts.entries()) {
    const counted: RandomAccessReader = {
      size: p.reader.size,
      read: (a, b) => {
        reads += 1;
        return p.reader.read(a, b);
      },
    };
    const onProgress = (progress: LocalTimeProgress): void => {
      if (progress.done === progress.total) phases.push({ ...progress });
    };
    parsed.push(await parseExportFromReader(counted, { part: index + 1, name: p.name, onProgress }));
  }
  const merged = parsed.length === 1 ? (parsed[0] as ParsedExport) : mergeParsedExports(parsed);
  const issues = [...merged.issues, ...validateExport(merged, { now: Date.UTC(2026, 0, 1) })];
  return {
    seconds: (performance.now() - start) / 1000,
    merged,
    errors: issues.filter((i) => i.severity === "error").map((i) => i.code),
    phases,
    reads,
  };
}


