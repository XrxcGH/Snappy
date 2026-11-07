/**
 * The fallback reader against an in-memory stand-in for the shell's read-only commands
 * (`read_range`, `close_file`), including the awkward behaviors a real call has: the answer
 * arrives as a plain number array over the postMessage IPC, and a file can shrink under us.
 * Everything here is synthetic.
 */
import { parseExportFromReader, syntheticExportZip } from "@snappy-export/core";
import { beforeEach, describe, expect, it } from "vitest";
import { CHUNK_BYTES, ipcReader } from "../src/ipc-reader.ts";
import type { Invoke, PickedFile } from "../src/ipc-reader.ts";
import { nativeZip } from "../src/native-zip.ts";

const MAX_READ = 16 * 1024 * 1024;

const state = {
  bytes: new Uint8Array(0) as Uint8Array, // widened: under TS 5.9 the inferred ArrayBuffer-only type rejects the generated patterns
  asNumberArray: false,
  calls: [] as { command: string; args: Record<string, unknown> }[],
  closed: [] as string[],
};

/** Behaves like src-tauri/src/readonly.rs: exact ranges only, a bounded size, unknown ids refused. */
const invoke: Invoke = async (command, args = {}) => {
  state.calls.push({ command, args });
  if (command === "close_file") {
    state.closed.push(String(args.id));
    return null;
  }
  if (command !== "read_range") throw new Error(`unknown command ${command}`);
  if (args.id !== "f1") throw new Error("unknown or closed file id");
  const offset = Number(args.offset);
  const length = Number(args.length);
  if (length > MAX_READ) throw new Error("that read is larger than the limit");
  if (offset + length > state.bytes.length) throw new Error("the range is outside the file");
  const part = state.bytes.slice(offset, offset + length);
  return state.asNumberArray ? Array.from(part) : part.buffer;
};

const file = (size = state.bytes.length): PickedFile => ({ id: "f1", name: "mydata~1234567890123.zip", size });
const pattern = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

beforeEach(() => {
  state.bytes = pattern(10_000);
  state.asNumberArray = false;
  state.calls = [];
  state.closed = [];
});

describe("ipcReader", () => {
  it("reports the size and returns exactly the requested range", async () => {
    const r = ipcReader(file(), invoke, 1024);
    expect(r.size).toBe(10_000);
    expect(Array.from(await r.read(5, 15))).toEqual(Array.from(state.bytes.subarray(5, 15)));
    expect((await r.read(9_990, 10_000)).length).toBe(10);
    expect((await r.read(100, 100)).length).toBe(0);
  });

  it("asks for at most one chunk at a time, however large the range, and never above the shell's limit", async () => {
    expect(CHUNK_BYTES).toBeLessThanOrEqual(MAX_READ);
    const r = ipcReader(file(), invoke, 1000);
    const got = await r.read(0, 5_500);
    expect(Array.from(got)).toEqual(Array.from(state.bytes.subarray(0, 5_500)));
    const lengths = state.calls.filter((c) => c.command === "read_range").map((c) => Number(c.args.length));
    expect(Math.max(...lengths)).toBeLessThanOrEqual(1000);
    expect(r.stats.calls).toBe(6);
  });

  it("accepts the number-array answer of the postMessage IPC as well as an ArrayBuffer", async () => {
    state.asNumberArray = true;
    const r = ipcReader(file(), invoke, 512);
    expect(Array.from(await r.read(10, 3_000))).toEqual(Array.from(state.bytes.subarray(10, 3_000)));
  });

  it("only ever sends the id, an offset and a length: no path, no write flag", async () => {
    const r = ipcReader(file(), invoke, 1000);
    await r.read(0, 2_500);
    await r.close();
    for (const c of state.calls) {
      expect(["read_range", "close_file"]).toContain(c.command);
      expect(Object.keys(c.args).sort()).toEqual(c.command === "close_file" ? ["id"] : ["id", "length", "offset"]);
    }
  });

  it("rejects ranges outside the file before asking the shell", async () => {
    const r = ipcReader(file(), invoke, 1000);
    await expect(r.read(-1, 5)).rejects.toThrow(RangeError);
    await expect(r.read(5, 4)).rejects.toThrow(RangeError);
    await expect(r.read(0, 10_001)).rejects.toThrow(RangeError);
    await expect(r.read(1.5, 4)).rejects.toThrow(RangeError);
    expect(state.calls).toHaveLength(0);
  });

  it("fails loudly when the shell returns fewer bytes than asked, and a failed read does not poison the next", async () => {
    const r = ipcReader(file(), async (c, a) => {
      const out = await invoke(c, a);
      return a?.offset === 4_000 ? (out as ArrayBuffer).slice(0, 5) : out;
    }, 1000);
    await expect(r.read(4_000, 4_500)).rejects.toThrow(RangeError);
    await expect(r.read(0, 50)).resolves.toHaveLength(50);
  });

  it("closes once, tells the shell once, and refuses reads afterwards", async () => {
    const r = ipcReader(file(), invoke, 1000);
    await r.read(0, 10);
    await r.close();
    await r.close();
    expect(state.closed).toEqual(["f1"]);
    await expect(r.read(0, 10)).rejects.toThrow(/closed/);
  });

  it("feeds core's zip reader: a synthetic export parses the same through the shell reader as from memory", async () => {
    const zip = syntheticExportZip({ now: Date.UTC(2026, 10, 6, 12), friendCount: 40, chatMessageCount: 300, memoryCount: 20 });
    state.bytes = zip;
    state.asNumberArray = true;
    const viaShell = await parseExportFromReader(ipcReader(file(zip.length), invoke, 8192), { part: 1 });
    const viaMemory = await parseExportFromReader({ size: zip.length, read: async (a, b) => zip.subarray(a, b) }, { part: 1 });
    expect(viaShell.friends.friends.length).toBe(40);
    expect(viaShell.chats.length).toBe(viaMemory.chats.length);
    expect(viaShell.friends).toEqual(viaMemory.friends);
    expect(viaShell.issues).toEqual(viaMemory.issues);
  });
});

describe("nativeZip", () => {
  it("looks like the Blob the import pipeline takes: name, size and slice().arrayBuffer()", async () => {
    const z = nativeZip(file(), invoke);
    expect(z.name).toBe("mydata~1234567890123.zip");
    expect(z.size).toBe(10_000);
    expect(Array.from(new Uint8Array(await z.slice(20, 40).arrayBuffer()))).toEqual(Array.from(state.bytes.subarray(20, 40)));
  });
});
