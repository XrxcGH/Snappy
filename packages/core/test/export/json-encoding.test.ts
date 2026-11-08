import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { describeStructureFromReader, formatStructureReport } from "../../src/export/inspect.ts";
import { JsonStreamError, projectConversations } from "../../src/export/json-stream.ts";
import type { StreamSource } from "../../src/export/json-stream.ts";
import { parseExportFiles, validateExport } from "../../src/export/parse.ts";
import { bytesReader, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { enc } from "./helpers.ts";

const FRIENDS = { Friends: [{ Username: "amy_1" }] };

function utf16(text: string, order: "le" | "be", bom: boolean): Uint8Array {
  const out: number[] = bom ? (order === "le" ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out.push(...(order === "le" ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]));
  }
  return Uint8Array.from(out);
}

const sourceOf = (...chunks: Uint8Array[]): StreamSource => {
  const queue = [...chunks];
  return { next: () => Promise.resolve(queue.shift() ?? null) };
};

async function drain(bytes: Uint8Array): Promise<unknown> {
  try {
    for await (const _ of projectConversations(sourceOf(bytes), { keepFields: ["Username"] })) void _;
    return "ok";
  } catch (e) {
    return e instanceof JsonStreamError ? e.code : e;
  }
}

describe("a JSON file in UTF-16 is not called invalid", () => {
  it.each([
    ["UTF-16LE with a byte order mark", utf16(JSON.stringify(FRIENDS), "le", true)],
    ["UTF-16BE with a byte order mark", utf16(JSON.stringify(FRIENDS), "be", true)],
    ["UTF-16LE without one", utf16(JSON.stringify(FRIENDS), "le", false)],
    ["UTF-16BE without one", utf16(JSON.stringify(FRIENDS), "be", false)],
  ])("the stream says the encoding is unsupported: %s", async (_name, bytes) => {
    expect(await drain(bytes)).toBe("encoding");
  });

  it("while UTF-8, with or without its byte order mark, is read", async () => {
    expect(await drain(enc(FRIENDS))).toBe("ok");
    expect(await drain(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc(FRIENDS)]))).toBe("ok");
    expect(await drain(enc("  \n" + JSON.stringify(FRIENDS)))).toBe("ok");
  });

  it("the notice names the cause and the file, not a JSON problem", async () => {
    const zip = zipSync({ "json/friends.json": utf16(JSON.stringify(FRIENDS), "le", true) });
    const parsed = await parseExportFromReader(bytesReader(zip));
    expect(parsed.issues.map((i) => [i.severity, i.code, i.message])).toEqual([
      ["error", "json-unsupported-encoding", "friends.json uses a text encoding Snappy does not support, so it was not read."],
    ]);
    const codes = validateExport(parsed).map((i) => i.code);
    expect(codes).not.toContain("no-friends-section"); // asking for the export again would not help
    expect(codes).not.toContain("friends-layout-unknown");
  });

  it("is the same for the chat history", async () => {
    const zip = zipSync({ "json/friends.json": enc(FRIENDS), "json/chat_history.json": utf16("{}", "le", true) });
    const parsed = await parseExportFromReader(bytesReader(zip));
    expect(parsed.issues.map((i) => i.code)).toEqual(["json-unsupported-encoding"]);
    expect(parsed.issues[0]?.message).toContain("chat_history.json");
  });

  it("inspect says so too", async () => {
    const zip = zipSync({ "json/friends.json": utf16(JSON.stringify(FRIENDS), "le", true) });
    const text = formatStructureReport(await describeStructureFromReader([bytesReader(zip)]));
    expect(text).toContain("unsupported text encoding");
    expect(text).not.toContain("unparseable json");
  });

  it("the in-memory parse still reads a UTF-16 file it can decode", () => {
    const parsed = parseExportFiles({ "json/friends.json": utf16(JSON.stringify(FRIENDS), "le", true) });
    expect(parsed.friends.friends.map((f) => f.username)).toEqual(["amy_1"]);
  });
});
