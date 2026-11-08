import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { JsonStreamError, projectConversations } from "../../src/export/json-stream.ts";
import type { StreamSource } from "../../src/export/json-stream.ts";
import { parseExportFiles } from "../../src/export/parse.ts";
import { bytesReader, parseExportFromReader } from "../../src/export/zip-reader.ts";
import { enc } from "./helpers.ts";

const issuesOf = (parsed: { issues: { code: string; message: string }[] }, codes: string[]) =>
  parsed.issues.filter((i) => codes.includes(i.code)).map((i) => [i.code, i.message]);

async function both(files: Record<string, unknown>) {
  const bytes: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(files)) bytes[path] = enc(value);
  return { inMemory: parseExportFiles(bytes), streamed: await parseExportFromReader(bytesReader(zipSync(bytes))) };
}

describe("entries that are not records are counted when the file is streamed", () => {
  it("friends.json: strings, numbers, null and nested lists in a section", async () => {
    const { inMemory, streamed } = await both({
      "json/friends.json": {
        Friends: [{ Username: "amy" }, "bob", null, 3, ["x"], { Username: "cy" }, true],
        "Deleted Friends": ["dee"],
        "Mystery List": ["q", "r"],
      },
    });
    const expected = issuesOf(inMemory, ["friends-invalid-entries"]);
    expect(expected).toEqual([["friends-invalid-entries", "6 entries in friends.json had no usable username and were skipped."]]);
    expect(issuesOf(streamed, ["friends-invalid-entries"])).toEqual(expected);
    expect(streamed.friends).toEqual(inMemory.friends);
  });

  it("friends.json: a bare list holds them too", async () => {
    const { inMemory, streamed } = await both({ "json/friends.json": ["amy", { Username: "bob" }, null] });
    expect(issuesOf(inMemory, ["friends-invalid-entries"])).toHaveLength(1);
    expect(issuesOf(streamed, ["friends-invalid-entries"])).toEqual(issuesOf(inMemory, ["friends-invalid-entries"]));
    expect(streamed.friends).toEqual(inMemory.friends);
  });

  it("memories_history.json gets the same count as the in-memory parse", async () => {
    const { inMemory, streamed } = await both({
      "json/friends.json": { Friends: [{ Username: "amy" }] },
      "json/memories_history.json": { "Saved Media": [{ Date: "2023-06-01 10:00:00 UTC", "Media Type": "Image" }, "x", null, 7] },
    });
    const codes = ["memories-invalid-entries", "memories-unexpected-shape"];
    expect(issuesOf(streamed, codes)).toEqual(issuesOf(inMemory, codes));
    expect(issuesOf(inMemory, ["memories-invalid-entries"])).toHaveLength(1);
    expect(streamed.memories).toEqual(inMemory.memories);
  });

  it("a clean file adds no notice and no fake entries", async () => {
    const { streamed } = await both({ "json/friends.json": { Friends: [{ Username: "amy" }, { Username: "bob" }], "Blocked Users": [] } });
    expect(issuesOf(streamed, ["friends-invalid-entries"])).toEqual([]);
    expect(streamed.friends.friends.map((f) => f.username)).toEqual(["amy", "bob"]);
  });
});

describe("the projector reports them without reading them", () => {
  const sourceOf = (bytes: Uint8Array): StreamSource => {
    let done = false;
    return { next: () => Promise.resolve(done ? null : ((done = true), bytes)) };
  };

  it("names the list of each one, and nothing else", async () => {
    const seen: string[] = [];
    const doc = enc({ a: [{ x: 1 }, "secret-text", null, 5, [1], { x: 2 }], b: ["more-secret"] });
    const records: unknown[] = [];
    for await (const r of projectConversations(sourceOf(doc), { keepFields: ["x"], onNonRecord: (key) => seen.push(key) })) records.push(r.record);
    expect(seen).toEqual(["a", "a", "a", "a", "b"]);
    expect(records).toEqual([{ x: 1 }, { x: 2 }]);
    expect(JSON.stringify(seen)).not.toContain("secret");
  });

  it("is not told about records, or about the lists of a list of lists", async () => {
    const seen: string[] = [];
    for await (const _ of projectConversations(sourceOf(enc([[{ x: 1 }], [{ x: 2 }]])), { keepFields: ["x"], onNonRecord: (k) => seen.push(k) })) void _;
    expect(seen).toEqual([]);
  });

  it("a callback that throws ends the read with its error", async () => {
    const run = async () => {
      for await (const _ of projectConversations(sourceOf(enc({ a: ["x"] })), {
        keepFields: [],
        onNonRecord: () => {
          throw new JsonStreamError("limit");
        },
      })) void _;
    };
    await expect(run()).rejects.toMatchObject({ code: "limit" });
  });
});
