/**
 * A very large chat and Snap history through the dashboard's import path: read from a Blob in
 * slices, streamed (never parsed whole), with the page given a turn between reads and a progress
 * report that reaches 100%. Synthetic data only; message text carries a canary that must never
 * show up. The default size keeps the suite quick; SNAPPY_HEAVY=1 streams about 400 MB of JSON.
 */
import { Zip, ZipDeflate } from "fflate";
import { describe, expect, it } from "vitest";
import { runImport } from "../src/import-pipeline.ts";
import type { ImportProgress } from "../src/import-pipeline.ts";
import { NOW, prng, setup } from "./export-fixtures.ts";

const HEAVY = process.env.SNAPPY_HEAVY === "1";
const CHAT_BYTES = (HEAVY ? 300 : 24) * 1024 * 1024;
const SNAP_BYTES = (HEAVY ? 100 : 8) * 1024 * 1024;
const CANARY = "ZQCANARY-heavy-7c1d";
const te = new TextEncoder();

interface Built {
  zip: Uint8Array<ArrayBuffer>;
  messages: number;
  jsonBytes: number;
}

/**
 * One zip holding friends.json and two big histories, written through a streaming deflater a
 * piece at a time, so the JSON text is never held whole here either.
 */
function buildZip(): Built {
  const parts: Uint8Array[] = [];
  const archive = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  const mtime = new Date(NOW - 24 * 60 * 60 * 1000);
  let jsonBytes = 0;
  let messages = 0;

  const add = (name: string, write: (push: (text: string) => void) => void): void => {
    const file = new ZipDeflate(name, { level: 1 });
    file.mtime = mtime; // a fixed export date, so the import's date checks do not depend on the real clock
    archive.add(file);
    write((text) => {
      const bytes = te.encode(text);
      jsonBytes += bytes.length;
      file.push(bytes, false);
    });
    file.push(new Uint8Array(0), true);
  };

  add("json/friends.json", (push) => {
    push(JSON.stringify({ Friends: Array.from({ length: 50 }, (_, i) => ({ Username: `user_${i}`, "Creation Timestamp": "2020-01-02 03:04:05 UTC" })) }));
  });

  const words = ["hey", "lol", "ok", "see you", "tomorrow", "snap", "yes", "no", "later", "haha", "café", "你好", "\\\"quoted\\\"", "\\u00e9"];
  const history = (target: number, withContent: boolean, seed: number) => (push: (text: string) => void): void => {
    const rnd = prng(seed);
    let written = 0;
    let pending = "{";
    for (let c = 0; written + pending.length < target; c++) {
      const key = c % 7 === 3 ? `Group chat ${c}` : `user_${c % 400}_${c}`;
      pending += `${c === 0 ? "" : ","}"${key}":[`;
      const count = 150 + Math.floor(rnd() * 100);
      for (let m = 0; m < count; m++) {
        const mine = rnd() < 0.5;
        let content = "";
        if (withContent) {
          for (let w = 1 + Math.floor(rnd() * 12); w > 0; w--) content += `${words[Math.floor(rnd() * words.length)]} `;
          content += `${Math.floor(rnd() * 36 ** 6).toString(36)} `; // keeps the text from compressing unrealistically well
          if (messages % 50 === 0) content += CANARY;
        }
        const kind = withContent ? "TEXT" : m % 2 === 0 ? "IMAGE" : "VIDEO";
        pending += `${m === 0 ? "" : ","}{"From":"${mine ? "me" : key}","Created":"2024-01-02 03:04:05 UTC","Created(microseconds)":${1704164645123456 + m * 1000},"IsSender":${mine},"Media Type":"${kind}","Conversation Title":null${withContent ? `,"Content":"${content}","IsSaved":false` : ""}}`;
        messages++;
        if (pending.length > 1 << 20) {
          written += pending.length;
          push(pending);
          pending = "";
        }
      }
      pending += "]";
    }
    push(`${pending}}`);
  };
  add("json/chat_history.json", history(CHAT_BYTES, true, 7));
  add("json/snap_history.json", history(SNAP_BYTES, false, 11));
  archive.end();

  const zip = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    zip.set(p, at);
    at += p.length;
  }
  return { zip, messages, jsonBytes };
}

describe(`a heavy history (${HEAVY ? "heavy, about 400 MB of JSON" : "about 32 MB of JSON"})`, () => {
  it(
    "is read in slices with a growing percentage, turns for the page, exact counts and no message text",
    async () => {
      const built = buildZip();
      expect(built.jsonBytes).toBeGreaterThanOrEqual(CHAT_BYTES + SNAP_BYTES);
      const blob = new File([built.zip], "mydata~1234567890123.zip", { type: "application/zip" });

      let largestRead = 0;
      let reads = 0;
      const sliced = new Proxy(blob, {
        get(target, prop) {
          if (prop === "slice") {
            return (start?: number, end?: number) => {
              reads++;
              largestRead = Math.max(largestRead, (end ?? target.size) - (start ?? 0));
              return target.slice(start, end);
            };
          }
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });

      const progress: ImportProgress[] = [];
      let yields = 0;
      let longestTurn = 0;
      let turnStart = performance.now();
      const started = performance.now();
      const parsed = await runImport([sliced], {
        onProgress: (p) => progress.push(p),
        yieldToUi: async () => {
          longestTurn = Math.max(longestTurn, performance.now() - turnStart);
          yields++;
          await new Promise((resolve) => setTimeout(resolve, 0));
          turnStart = performance.now();
        },
      });
      const seconds = (performance.now() - started) / 1000;

      // Exact counts: every chat and every Snap became one event.
      expect(parsed.chats.length).toBe(built.messages);
      expect(parsed.chats.filter((c) => c.kind === "IMAGE" || c.kind === "VIDEO").length).toBeGreaterThan(1000);
      expect(parsed.friends.friends).toHaveLength(50);
      expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
      // Message text was never kept anywhere.
      expect(JSON.stringify(parsed.issues)).not.toContain(CANARY);
      expect(JSON.stringify(parsed.chats.slice(0, 5000))).not.toContain(CANARY);

      // Only slices of the file were requested, none of them the whole zip.
      expect(reads).toBeGreaterThan(5);
      expect(largestRead).toBeLessThan(built.zip.length);
      expect(largestRead).toBeLessThanOrEqual(4 * 1024 * 1024);

      // A real percentage: grows, never passes 100, and ends there.
      const fractions = progress.map((p) => p.fraction as number);
      for (let i = 1; i < fractions.length; i++) expect(fractions[i] as number).toBeGreaterThanOrEqual(fractions[i - 1] as number);
      expect(fractions[fractions.length - 1]).toBe(1);
      // One report per slice read at least: a few for the small default, many for the heavy run.
      expect(progress.length).toBeGreaterThan(HEAVY ? 10 : 3);

      console.info(
        `heavy import: ${(built.jsonBytes / 1e6).toFixed(0)} MB of JSON (${(built.zip.length / 1e6).toFixed(0)} MB compressed), ${parsed.chats.length} events, ` +
          `${seconds.toFixed(1)} s, ${reads} slices, ${yields} turns for the page, longest stretch between turns ${(longestTurn / 1000).toFixed(2)} s`,
      );
      if (HEAVY) expect(yields).toBeGreaterThan(0);
    },
    HEAVY ? 900_000 : 120_000,
  );

  it("goes through the actions to a finished import, with the progress bar reaching its end", async () => {
    const built = buildZip();
    const { store, actions } = setup();
    const fractions: number[] = [];
    store.subscribe((s) => {
      if (typeof s.import.fraction === "number") fractions.push(s.import.fraction);
    });
    const result = await actions.importZips([new File([built.zip], "mydata~1234567890123.zip", { type: "application/zip" })]);
    expect(result).toBe("done");
    expect(store.get().real.latest?.chats.length).toBe(built.messages);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(store.get().import.phase).toBe("done");
  }, HEAVY ? 900_000 : 120_000);
});
