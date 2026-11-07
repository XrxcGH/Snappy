/**
 * Streaming JSON projection: correctness (escapes, numbers, nesting, wrappers), chunk-boundary
 * independence at every offset, malformed input, privacy canaries, zip-entry sources and a
 * deflate -> inflateSource -> projectConversations pipeline with a constant-memory check.
 * Synthetic data only. The big pipeline test is opt-in at full size: SNAPPY_HEAVY=1 streams
 * ~300 MB; the default is 40 MB.
 */
import { Zip, ZipDeflate, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JsonStreamError,
  ZipEntryError,
  bytesReader,
  inflateSource,
  listZipEntries,
  projectArrayRecords,
  projectConversations,
  projectSections,
} from "../../src/index.ts";
import type { ProjectedRecord, RandomAccessReader, StreamSource, ZipEntryInfo } from "../../src/index.ts";

const te = new TextEncoder();
const enc = (v: unknown): Uint8Array => te.encode(typeof v === "string" ? v : JSON.stringify(v));

// ------------------------------------------------------------------ helpers ---

/** Deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A source that yields `bytes` in the given chunk sizes (the last size repeats). */
function sourceOf(bytes: Uint8Array, sizes: number[] = [bytes.length]): StreamSource {
  let at = 0;
  let k = 0;
  return {
    next() {
      if (at >= bytes.length) return Promise.resolve(null);
      const size = Math.max(1, sizes[Math.min(k++, sizes.length - 1)] as number);
      const chunk = bytes.slice(at, at + size); // a copy: the projector must not rely on the buffer surviving
      at += size;
      return Promise.resolve(chunk);
    },
  };
}

/** A source that yields exactly the listed chunks. */
const chunksSource = (chunks: Uint8Array[]): StreamSource => {
  let k = 0;
  return { next: () => Promise.resolve(k < chunks.length ? (chunks[k++] as Uint8Array) : null) };
};

interface Item {
  conversationKey: string;
  record: ProjectedRecord;
}

async function collectAll<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

const KEEP = ["From", "Created", "Created(microseconds)", "IsSender", "Media Type", "Conversation Title", "IsSaved"];
const project = (bytes: Uint8Array, sizes?: number[], keep: string[] = KEEP): Promise<Item[]> =>
  collectAll(projectConversations(sourceOf(bytes, sizes), { keepFields: keep }));

/** Outcome of a run: the items or the error code, so chunkings can be compared including failures. */
async function outcome(bytes: Uint8Array, sizes?: number[]): Promise<{ items: Item[] } | { error: string }> {
  try {
    return { items: await project(bytes, sizes) };
  } catch (e) {
    if (!(e instanceof JsonStreamError)) throw e; // anything else is a bug (a TypeError would be a crash on input)
    return { error: e.code };
  }
}

const lowerAscii = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const isPrimitive = (v: unknown): v is string | number | boolean | null => v === null || typeof v !== "object";

/** What the projection must equal: JSON.parse, then keep allowlisted primitives (the trusted oracle). */
function reference(text: string, keep: string[]): Item[] {
  const root = JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, unknown>;
  const out: Item[] = [];
  for (const [conversationKey, list] of Object.entries(root)) {
    if (!Array.isArray(list)) continue;
    for (const msg of list) {
      if (typeof msg !== "object" || msg === null || Array.isArray(msg)) continue;
      const record: ProjectedRecord = {};
      for (const [k, v] of Object.entries(msg)) {
        const name = keep.find((f) => lowerAscii(f) === lowerAscii(k));
        if (name !== undefined && isPrimitive(v)) record[name] = v;
      }
      out.push({ conversationKey, record });
    }
  }
  return out;
}

// -------------------------------------------------------------- random docs ---

const PIECES = ["plain", " ", "a\"b", "back\\slash", "line\nbreak", "tab\t", "caf\u00e9", "\u4f60\u597d", "\ud83d\ude00", "\u0001", "/", "\u2028", "x".repeat(40)];

function randomString(rnd: () => number): string {
  let s = "";
  for (let n = Math.floor(rnd() * 6); n > 0; n--) s += PIECES[Math.floor(rnd() * PIECES.length)];
  return s;
}

const NUMBERS = [0, 1, -1, 1.5, -2.5e10, 1e-7, 123456789012345680, 1e21, 42, -0.001];

function randomValue(rnd: () => number, depth = 0): unknown {
  const r = rnd();
  if (r < 0.25) return randomString(rnd);
  if (r < 0.4) return NUMBERS[Math.floor(rnd() * NUMBERS.length)];
  if (r < 0.5) return rnd() < 0.5;
  if (r < 0.6) return null;
  if (depth > 3) return "deep";
  if (r < 0.8) return Array.from({ length: Math.floor(rnd() * 4) }, () => randomValue(rnd, depth + 1));
  const o: Record<string, unknown> = {};
  for (let n = Math.floor(rnd() * 4); n > 0; n--) o[randomString(rnd) || "k"] = randomValue(rnd, depth + 1);
  return o;
}

/** One random document in the real shape, plus the exact text it was serialized to. */
function randomDoc(seed: number): string {
  const rnd = prng(seed);
  const root: Record<string, unknown> = {};
  for (let c = Math.floor(rnd() * 4); c >= 0; c--) {
    const key = `${randomString(rnd)}#${c}`;
    root[key] = Array.from({ length: Math.floor(rnd() * 4) }, () => {
      const m: Record<string, unknown> = {};
      const fields: [string, unknown][] = [
        [pick(rnd, ["From", "from", "FROM"]), randomString(rnd)],
        ["Created", "2024-01-02 03:04:05 UTC"],
        ["Created(microseconds)", NUMBERS[Math.floor(rnd() * NUMBERS.length)]],
        ["IsSender", rnd() < 0.5],
        [pick(rnd, ["Media Type", "media type"]), pick(rnd, ["TEXT", "SNAP", "NOTE"])],
        ["Conversation Title", rnd() < 0.5 ? null : randomString(rnd)],
        ["Content", rnd() < 0.7 ? randomString(rnd) + randomString(rnd) : null],
        ["IsSaved", rnd() < 0.5],
        ["Extra", randomValue(rnd)],
      ];
      for (const [k, v] of fields) if (rnd() < 0.85) m[k] = v;
      return m;
    });
  }
  const indent = pick(rnd, [0, 1, 2, "\t"] as const);
  let text = JSON.stringify(root, null, indent);
  // Half the documents write every non-ASCII character as \uXXXX (astral ones as surrogate pairs).
  if (rnd() < 0.5) text = text.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return rnd() < 0.3 ? `\uFEFF${text}` : text;
}

const pick = <T>(rnd: () => number, from: readonly T[]): T => from[Math.floor(rnd() * from.length)] as T;

// -------------------------------------------------------------- projection ---

describe("projectConversations: what is kept", () => {
  it("keeps only allowlisted primitives, matched ignoring ASCII case, spelled as the caller wrote them", async () => {
    const doc = {
      alice: [
        { FROM: "alice", created: "2023-04-01 12:30:00 UTC", "created(microseconds)": 1680352200000000, issender: false, "MEDIA TYPE": "TEXT", Content: "hello", Other: 1 },
        { From: "me", IsSender: true, "Conversation Title": null, Content: "x", Nested: { From: "inner" } },
      ],
    };
    expect(await project(enc(doc))).toEqual([
      { conversationKey: "alice", record: { From: "alice", Created: "2023-04-01 12:30:00 UTC", "Created(microseconds)": 1680352200000000, IsSender: false, "Media Type": "TEXT" } },
      { conversationKey: "alice", record: { From: "me", IsSender: true, "Conversation Title": null } },
    ]);
  });

  it("never keeps containers: a kept field with an object or array value is dropped, even after a primitive", async () => {
    const items = await project(enc('{"c":[{"From":{"x":1},"Created":[1,2],"IsSender":true,"IsSaved":false,"IsSaved":{"a":1},"Media Type":"A","Media Type":["B"]}]}'));
    expect(items).toEqual([{ conversationKey: "c", record: { IsSender: true } }]);
  });

  it("yields one record per message, empty when no kept field is present; later duplicate keys win", async () => {
    const items = await project(enc('{"a":[{},{"Other":1},{"From":"x","From":"y"}],"b":[]}'));
    expect(items).toEqual([
      { conversationKey: "a", record: {} },
      { conversationKey: "a", record: {} },
      { conversationKey: "a", record: { From: "y" } },
    ]);
  });

  it("ignores non-object elements and scalar conversation values", async () => {
    const items = await project(enc('{"a":[1,"s",null,true,[{"From":"deep"}],{"From":"ok"}],"b":"text","c":5,"d":null,"e":{"f":2}}'));
    expect(items).toEqual([{ conversationKey: "a", record: { From: "ok" } }]);
  });

  it("accepts a wrapper object around the conversations, at any depth", async () => {
    const items = await project(enc({ meta: { v: 1 }, data: { "Saved Chat History": { alice: [{ From: "a" }] }, bob: [{ From: "b" }] }, top: [{ From: "t" }] }));
    expect(items).toEqual([
      { conversationKey: "alice", record: { From: "a" } },
      { conversationKey: "bob", record: { From: "b" } },
      { conversationKey: "top", record: { From: "t" } },
    ]);
  });

  it("accepts an array of arrays (key = position) and an array of records (key empty)", async () => {
    expect(await project(enc([[{ From: "a" }, { From: "b" }], [], [{ From: "c" }]]))).toEqual([
      { conversationKey: "0", record: { From: "a" } },
      { conversationKey: "0", record: { From: "b" } },
      { conversationKey: "2", record: { From: "c" } },
    ]);
    expect(await project(enc([{ From: "a" }, { From: "b" }]))).toEqual([
      { conversationKey: "", record: { From: "a" } },
      { conversationKey: "", record: { From: "b" } },
    ]);
  });

  it("yields nothing for a root that is a bare scalar", async () => {
    for (const text of ["5", "-1.5e3", '"x"', "true", "null", "{}", "[]"]) expect(await project(enc(text)), text).toEqual([]);
  });
});

describe("projectConversations: strings, escapes and numbers", () => {
  it("decodes escapes in kept values and in conversation keys", async () => {
    const text = '{"k\\u00e9y \\"q\\" \\\\ \\/ \\b\\f\\n\\r\\t":[{"From":"A\\"B\\\\C\\u0041\\u00E9\\u0000Z","Created":"\\ud83d\\ude00 \\uD83D\\uDE00 \\u4f60"}]}';
    const [item] = await project(enc(text));
    expect(item?.conversationKey).toBe('k\u00e9y "q" \\ / \b\f\n\r\t');
    expect(item?.record).toEqual({ From: 'A"B\\CA\u00e9\u0000Z', Created: "\u{1f600} \u{1f600} \u4f60" });
  });

  it("combines surrogate pairs and replaces a lone surrogate with U+FFFD", async () => {
    const out = async (value: string) => ((await project(enc(`{"c":[{"From":"${value}"}]}`)))[0]?.record.From);
    expect(await out("\\ud83d\\ude00")).toBe("\u{1f600}");
    expect(await out("\\ud83d")).toBe("\ufffd");
    expect(await out("\\ud83dX")).toBe("\ufffdX");
    expect(await out("\\ude00")).toBe("\ufffd");
    expect(await out("\\ud83d\\ud83d\\ude00")).toBe("\ufffd\u{1f600}");
    expect(await out("\\ud83d\\n")).toBe("\ufffd\n");
    expect(await out("\\ud83d\\u0041")).toBe("\ufffdA");
  });

  it("keeps raw UTF-8 text, including a leading U+FEFF inside a value", async () => {
    const [item] = await project(enc('{"c":[{"From":"\ufeffcaf\u00e9 \u4f60\u597d \u{1f600}"}]}'));
    expect(item?.record.From).toBe("\ufeffcaf\u00e9 \u4f60\u597d \u{1f600}");
  });

  it("skips strings with escaped quotes and trailing backslashes without losing its place", async () => {
    const text = '{"c":[{"Content":"a\\"}],[{\\"From\\":\\"x\\"}]\\\\","From":"real","Other":"\\\\","IsSender":true}]}';
    expect(await project(enc(text))).toEqual([{ conversationKey: "c", record: { From: "real", IsSender: true } }]);
  });

  it("parses numbers: zero, negative, fraction, exponent", async () => {
    const text = '{"c":[{"Created(microseconds)":0},{"Created(microseconds)":-0},{"Created(microseconds)":-12.25e+2},{"Created(microseconds)":1E5},{"Created(microseconds)":2.5e-3},{"Created(microseconds)":1600000000000000},{"Created(microseconds)":10}]}';
    expect((await project(enc(text))).map((i) => i.record["Created(microseconds)"])).toEqual([0, -0, -1225, 100000, 0.0025, 1600000000000000, 10]);
  });

  it("rejects numbers outside the JSON grammar, kept or skipped", async () => {
    for (const bad of ["01", "1.", "-", "1e", "1e+", "+1", ".5", "1.5.2", "--1", "0x10", "1_0", "NaN", "Infinity", "-Infinity"]) {
      for (const field of ["Created(microseconds)", "Other"]) {
        const result = await outcome(enc(`{"c":[{"${field}":${bad}}]}`));
        expect(result, `${field}: ${bad}`).toEqual({ error: "malformed" });
      }
    }
  });

  it("accepts literals true, false and null in every position", async () => {
    const [item] = await project(enc('{"c":[{"IsSender":true,"IsSaved":false,"Conversation Title":null,"Other":true,"More":[true,false,null]}]}'));
    expect(item?.record).toEqual({ IsSender: true, IsSaved: false, "Conversation Title": null });
  });

  it("accepts whitespace between every token and a UTF-8 BOM, and rejects a BOM anywhere else", async () => {
    const spaced = ' \r\n\t{ \n"c" \t: [ \r\n{ "From" : "x" , "IsSender" : true } , { } ] \n} \n';
    expect(await project(enc(`\uFEFF${spaced}`))).toEqual([
      { conversationKey: "c", record: { From: "x", IsSender: true } },
      { conversationKey: "c", record: {} },
    ]);
    expect(await outcome(enc('{"c":[]}\uFEFF'))).toEqual({ error: "malformed" });
    expect(await outcome(new Uint8Array([0xef, 0xbb, 0x20, 0x7b, 0x7d]))).toEqual({ error: "malformed" });
    expect(await outcome(new Uint8Array([0xef, 0xbb]))).toEqual({ error: "malformed" });
  });

  it("tolerates raw control characters inside strings (they are never interpreted)", async () => {
    const [item] = await project(enc('{"c":[{"From":"a\nb\tc","Content":"x\ny"}]}'));
    expect(item?.record.From).toBe("a\nb\tc");
  });

  it("refuses a single kept string or key larger than 1 MiB, but skips an equally large one", async () => {
    const big = "x".repeat(1024 * 1024 + 1);
    expect(await outcome(enc(`{"c":[{"From":"${big}"}]}`))).toEqual({ error: "limit" });
    expect(await outcome(enc(`{"${big}":[]}`))).toEqual({ error: "limit" });
    expect(await project(enc(`{"c":[{"Content":"${big}","From":"ok"}]}`))).toEqual([{ conversationKey: "c", record: { From: "ok" } }]);
  });
});

// ------------------------------------------------------------ chunk splits ---

describe("projectConversations: chunk boundaries", () => {
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

  it("matches the JSON.parse oracle on random documents (whole input)", async () => {
    for (let seed = 1; seed <= 150; seed++) {
      const text = randomDoc(seed);
      expect(await project(enc(text)), `seed ${seed}`).toEqual(reference(text, KEEP));
    }
  });

  it("gives identical output when the document is split at every possible byte offset", async () => {
    for (const seed of SEEDS) {
      const bytes = enc(randomDoc(seed));
      const whole = await project(bytes);
      expect(whole).toEqual(reference(new TextDecoder().decode(bytes, {}), KEEP));
      for (let cut = 1; cut < bytes.length; cut++) {
        const split = await project(bytes, [cut, bytes.length]);
        if (JSON.stringify(split) !== JSON.stringify(whole)) expect(split, `seed ${seed} cut ${cut}`).toEqual(whole);
      }
    }
  });

  it("gives identical output with one byte per chunk and with random chunk sizes", async () => {
    const rnd = prng(99);
    for (const seed of SEEDS) {
      const bytes = enc(randomDoc(seed));
      const whole = await project(bytes);
      expect(await project(bytes, [1]), `seed ${seed} byte-wise`).toEqual(whole);
      for (let trial = 0; trial < 25; trial++) {
        const sizes = Array.from({ length: 40 }, () => 1 + Math.floor(rnd() * 64));
        const got = await project(bytes, sizes);
        if (JSON.stringify(got) !== JSON.stringify(whole)) expect(got, `seed ${seed} sizes ${sizes.join(",")}`).toEqual(whole);
      }
    }
  });

  it("tolerates empty chunks between real ones", async () => {
    const bytes = enc(randomDoc(3));
    const chunks: Uint8Array[] = [];
    for (let at = 0; at < bytes.length; at += 7) chunks.push(new Uint8Array(0), bytes.slice(at, at + 7));
    expect(await collectAll(projectConversations(chunksSource(chunks), { keepFields: KEEP }))).toEqual(await project(bytes));
  });

  it("splits multi-byte characters, escapes and surrogate pairs across chunks without damage", async () => {
    const text = '{"\u4f60\u597d\u{1f600}":[{"From":"\u00e9\u4f60\u{1f600}\\ud83d\\ude00\\u00e9"}]}';
    const bytes = enc(text);
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(await project(bytes, [cut, bytes.length]), `cut ${cut}`).toEqual([{ conversationKey: "\u4f60\u597d\u{1f600}", record: { From: "\u00e9\u4f60\u{1f600}\u{1f600}\u00e9" } }]);
    }
  });
});

// ------------------------------------------------------ malformed and limits ---

describe("projectConversations: malformed input", () => {
  const BAD: Record<string, string> = {
    empty: "",
    whitespace: "  \n ",
    "truncated object": '{"c":[{"From":"x"}',
    "truncated string": '{"c":[{"From":"x',
    "truncated escape": '{"c":[{"From":"x\\',
    "truncated unicode": '{"c":[{"From":"x\\u00',
    "truncated literal": '{"c":[{"IsSender":tru',
    "truncated number": '{"c":[{"Created(microseconds)":1e',
    "trailing comma in array": '{"c":[{"From":"x"},]}',
    "trailing comma in object": '{"c":[{"From":"x",}]}',
    "leading comma": '{"c":[,{"From":"x"}]}',
    "missing colon": '{"c" [{"From":"x"}]}',
    "missing comma": '{"c":[{"From":"x"}{"From":"y"}]}',
    "missing value": '{"c":}',
    "key not a string": "{c:[]}",
    "single quotes": "{'c':[]}",
    "mismatched closer": '{"c":[{"From":"x"}}',
    "closer without opener": "]",
    "bad escape": '{"c":[{"From":"a\\qb"}]}',
    "bad hex digit": '{"c":[{"From":"\\u00zz"}]}',
    "bad escape in skipped string": '{"c":[{"Content":"a\\qb"}]}',
    "bad hex in skipped string": '{"c":[{"Content":"\\u12"}]}',
    "bad literal": '{"c":[{"IsSender":trux}]}',
    "literal prefix": '{"c":[{"IsSender":truefalse}]}',
    "garbage after root": '{"c":[]} x',
    "two roots": '{"c":[]}{"d":[]}',
    "comment": '{"c":[]/* x */}',
    "bare word": "hello",
    "value where key expected": '{"c":[],5}',
    "colon in array": '{"c":[1:2]}',
  };

  it("rejects every malformed document with a fixed-text JsonStreamError, whatever the chunking", async () => {
    const CANARY = "ZQCANARY-malformed-91";
    for (const [name, text] of Object.entries(BAD)) {
      for (const sizes of [undefined, [1], [3, 5, 2]]) {
        const bytes = enc(text.replace("x", CANARY));
        const err = await project(bytes, sizes).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(err, name).toBeInstanceOf(JsonStreamError);
        const e = err as JsonStreamError;
        expect(e.code, name).toBe("malformed");
        expect(e.message, name).not.toContain(CANARY);
        expect(e.message, name).toBe("The JSON data is damaged or not in the expected format.");
        expect(e.stack ?? "", name).not.toContain(CANARY);
      }
    }
  });

  it("accepts nesting of exactly 64 containers and rejects 65 with a depth error, skipped or not", async () => {
    const nest = (n: number, inner: string): string => '{"c":[{"Content":' + "[".repeat(n - 3) + inner + "]".repeat(n - 3) + "}]}";
    // {"c":[{"Content":[[...]]}]} has 3 + (n - 3) = n containers
    expect(await outcome(enc(nest(64, "1")))).toEqual({ items: [{ conversationKey: "c", record: {} }] });
    expect(await outcome(enc(nest(65, "1")))).toEqual({ error: "depth" });
    expect(await outcome(enc(`${"[".repeat(65)}${"]".repeat(65)}`))).toEqual({ error: "depth" });
    expect(await outcome(enc(`${"{\"a\":".repeat(65)}1${"}".repeat(65)}`))).toEqual({ error: "depth" });
    // A hostile 1 MB of openers fails at the cap instead of growing a stack.
    expect(await outcome(enc("[".repeat(1_000_000)))).toEqual({ error: "depth" });
  });

  it("refuses more than maxBytes in total, counting every chunk, and defaults to a large cap", async () => {
    const bytes = enc(randomDoc(5));
    const small = (n: number, sizes?: number[]) => collectAll(projectConversations(sourceOf(bytes, sizes), { keepFields: KEEP, maxBytes: n }));
    await expect(small(bytes.length - 1)).rejects.toMatchObject({ name: "JsonStreamError", code: "limit" });
    await expect(small(bytes.length - 1, [5])).rejects.toMatchObject({ code: "limit" });
    await expect(small(bytes.length)).resolves.toEqual(await project(bytes));
    await expect(projectConversations(sourceOf(bytes), { keepFields: KEEP, maxBytes: 0 }).next()).rejects.toThrow(RangeError);
  });

  it("never loops or crashes with anything but JsonStreamError on mutated documents, and chunking never changes the outcome", async () => {
    const rnd = prng(2024);
    const base = [enc(randomDoc(11)), enc(randomDoc(12)), enc('{"a":[{"From":"x","IsSender":true,"Created(microseconds)":-1.5e3,"Content":"q\\"\\u00e9"}],"b":[[]]}')];
    for (let trial = 0; trial < 1500; trial++) {
      let bytes = (pick(rnd, base) as Uint8Array).slice();
      for (let m = 1 + Math.floor(rnd() * 3); m > 0 && bytes.length > 0; m--) {
        const at = Math.floor(rnd() * bytes.length);
        const kind = Math.floor(rnd() * 4);
        if (kind === 0) bytes[at] = Math.floor(rnd() * 256);
        else if (kind === 1) bytes = bytes.slice(0, at);
        else if (kind === 2) bytes = new Uint8Array([...bytes.slice(0, at), ...bytes.slice(at + 1)]);
        else bytes = new Uint8Array([...bytes.slice(0, at), pick(rnd, [0x22, 0x5c, 0x7b, 0x7d, 0x5b, 0x5d, 0x2c, 0x3a, 0x00, 0xff]), ...bytes.slice(at)]);
      }
      const whole = await outcome(bytes);
      const sizes = Array.from({ length: 30 }, () => 1 + Math.floor(rnd() * 12));
      const split = await outcome(bytes, sizes);
      if (JSON.stringify(whole) !== JSON.stringify(split)) expect(split, `trial ${trial}`).toEqual(whole);
    }
  });

  it("wraps a failing foreign source in a fixed-text error and passes ZipEntryError through", async () => {
    const CANARY = "ZQCANARY-source-3d";
    const failing: StreamSource = { next: () => Promise.reject(new Error(`disk said ${CANARY}`)) };
    const err = await collectAll(projectConversations(failing, { keepFields: KEEP })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonStreamError);
    expect((err as JsonStreamError).code).toBe("source");
    expect((err as Error).message).not.toContain(CANARY);
    const zipErr: StreamSource = { next: () => Promise.reject(new ZipEntryError("corrupt")) };
    await expect(collectAll(projectConversations(zipErr, { keepFields: KEEP }))).rejects.toBeInstanceOf(ZipEntryError);
    const notBytes = { next: () => Promise.resolve("text" as unknown as Uint8Array) };
    await expect(collectAll(projectConversations(notBytes, { keepFields: KEEP }))).rejects.toMatchObject({ code: "source" });
  });
});

// ----------------------------------------------------------------- privacy ---

describe("projectConversations: content is never decoded", () => {
  const CANARY = "ZQCANARY-content-b7f2";
  const SPLIT_CANARY = "ZQCANARY-\\u0063ontent-escaped"; // the same idea, written with an escape inside the JSON

  const doc = (content: string, extra = ""): string =>
    `{"alice":[{"From":"alice","IsSender":false,"Media Type":"TEXT","Content":"${content}","IsSaved":false${extra}}],"${CANARY}-group":[{"From":"bob","Content":"${content}"}]}`;

  it("never puts a canary from Content (raw or escaped, any depth) into a yielded record", async () => {
    const text = doc(`${CANARY} ${SPLIT_CANARY}`, `,"Nested":{"Content":"${CANARY}","list":["${CANARY}"]}`);
    for (const sizes of [undefined, [1], [4]]) {
      const items = await project(enc(text), sizes, [...KEEP, "Nested"]);
      expect(items).toHaveLength(2);
      const dump = JSON.stringify(items.map((i) => i.record));
      expect(dump).not.toContain("ZQCANARY");
      expect(dump).not.toContain("canary");
      expect(items[0]?.record).toEqual({ From: "alice", IsSender: false, "Media Type": "TEXT", IsSaved: false });
    }
  });

  it("never passes a byte of skipped content to the text decoder", async () => {
    const decoded: string[] = [];
    const original = TextDecoder.prototype.decode;
    const spy = vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (this: TextDecoder, input?: AllowSharedBufferSource, options?: TextDecodeOptions) {
      const out = original.call(this, input, options);
      decoded.push(out);
      return out;
    });
    try {
      const text = doc(`${CANARY} \u00e9\u4f60 ${SPLIT_CANARY}`, `,"Nested":["${CANARY}",{"Content":"${CANARY}"}]`);
      const items = await project(enc(text));
      expect(items).toHaveLength(2);
      expect(decoded.length).toBeGreaterThan(0); // the kept values and keys were decoded
      const everything = decoded.join("\u0000");
      expect(everything).not.toContain("ZQCANARY-content-b7f2 ");
      expect(everything).not.toContain("escaped");
      expect(everything).not.toContain("Nested");
      expect(everything).not.toContain("Content");
      // Only the conversation keys (needed) and the kept values were decoded; the group key is the lone place the canary can show up.
      for (const d of decoded) expect(["alice", "bob", `${CANARY}-group`, "TEXT"]).toContain(d);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the canary out of error text when the document breaks inside or after Content", async () => {
    const cases = [
      `{"alice":[{"Content":"${CANARY}\\q"}]}`,
      `{"alice":[{"Content":"${CANARY}"}`,
      `{"alice":[{"Content":"${CANARY}","From":}]}`,
      `{"${CANARY}":[{"Content":"${CANARY}"}]}]`,
    ];
    for (const text of cases) {
      const err = await project(enc(text)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(JsonStreamError);
      expect(JSON.stringify(err)).not.toContain("ZQCANARY");
      expect(String((err as Error).message) + String((err as Error).stack)).not.toContain("ZQCANARY");
    }
  });
});

// ------------------------------------------------------------------ sections ---

describe("projectSections and projectArrayRecords", () => {
  const FRIENDS = {
    Friends: [
      { Username: "alice", "Display Name": "NOT-KEPT", "Creation Timestamp": "2023-01-01 00:00:00 UTC", "Last Modified Timestamp": "2023-02-01 00:00:00 UTC", Source: "x" },
      { Username: "bob", "Creation Timestamp": "2023-01-02 00:00:00 UTC" },
    ],
    "Deleted Friends": [{ Username: "carl", "Last Modified Timestamp": "2024-01-01 00:00:00 UTC" }],
    "Friend Requests Sent": [],
    "Mystery Section": [{ Username: "zed" }],
    "Not An Array": { Username: "nope" },
  };
  const KEEP_FRIEND = ["Username", "Creation Timestamp", "Last Modified Timestamp"];

  it("reads several sections in one pass, tagged with the caller's spelling, skipping the rest", async () => {
    const items = await collectAll(projectSections(sourceOf(enc(FRIENDS), [9]), { sections: ["friends", "Deleted Friends", "Friend Requests Sent"], keepFields: KEEP_FRIEND }));
    expect(items).toEqual([
      { section: "friends", record: { Username: "alice", "Creation Timestamp": "2023-01-01 00:00:00 UTC", "Last Modified Timestamp": "2023-02-01 00:00:00 UTC" } },
      { section: "friends", record: { Username: "bob", "Creation Timestamp": "2023-01-02 00:00:00 UTC" } },
      { section: "Deleted Friends", record: { Username: "carl", "Last Modified Timestamp": "2024-01-01 00:00:00 UTC" } },
    ]);
  });

  it("projectArrayRecords yields the records of one section (memories_history.json shape)", async () => {
    const memories = {
      "Saved Media": [
        { Date: "2023-04-01 12:30:00 UTC", "Media Type": "Image", Location: "CANARY-LOC", "Download Link": "", "Media Download URL": "https://example.invalid/x" },
        { Date: "2023-04-02 12:30:00 UTC", "Media Type": "Video", "Download Link": "not a url" },
      ],
      Other: [{ Date: "no" }],
    };
    const records = await collectAll(projectArrayRecords(sourceOf(enc(memories), [5]), "saved media", ["Date", "Media Type", "Download Link"]));
    expect(records).toEqual([
      { Date: "2023-04-01 12:30:00 UTC", "Media Type": "Image", "Download Link": "" },
      { Date: "2023-04-02 12:30:00 UTC", "Media Type": "Video", "Download Link": "not a url" },
    ]);
    expect(JSON.stringify(records)).not.toContain("CANARY");
  });

  it("finds sections inside a wrapper, ignores a top-level array, and yields nothing when the section is absent", async () => {
    expect(await collectAll(projectArrayRecords(sourceOf(enc({ wrap: { Friends: [{ Username: "a" }] } })), "Friends", ["Username"]))).toEqual([{ Username: "a" }]);
    expect(await collectAll(projectArrayRecords(sourceOf(enc([{ Username: "a" }])), "Friends", ["Username"]))).toEqual([]);
    expect(await collectAll(projectArrayRecords(sourceOf(enc({ Other: [{ Username: "a" }] })), "Friends", ["Username"]))).toEqual([]);
  });

  it("matches the section key even when it is written with escapes, and splits cleanly at every offset", async () => {
    const bytes = enc('{"\\u0046riends":[{"Username":"a\\u00e9","X":{"Username":"no"}}],"Other":[{"Username":"no"}]}');
    for (let cut = 1; cut < bytes.length; cut++) {
      const got = await collectAll(projectArrayRecords(sourceOf(bytes, [cut, bytes.length]), "Friends", ["Username"]));
      expect(got, `cut ${cut}`).toEqual([{ Username: "a\u00e9" }]);
    }
  });

  it("applies the same strictness as projectConversations", async () => {
    await expect(collectAll(projectArrayRecords(sourceOf(enc('{"Friends":[{"Username":"a"},]}')), "Friends", ["Username"]))).rejects.toMatchObject({ code: "malformed" });
    await expect(collectAll(projectArrayRecords(sourceOf(enc('{"Friends":[{"Username":"a"}]}'), [4]), "Friends", ["Username"], { maxBytes: 10 }))).rejects.toMatchObject({ code: "limit" });
  });
});

// ------------------------------------------------------------- zip sources ---

/** Zip with a JSON entry (stored or deflated) and a big "media" entry that must never be read. */
function buildArchive(json: Uint8Array, level: 0 | 6 = 6): { zip: Uint8Array; names: { json: string; media: string } } {
  const media = new Uint8Array(60_000);
  const rnd = prng(5);
  for (let i = 0; i < media.length; i++) media[i] = Math.floor(rnd() * 256);
  const names = { json: "json/chat_history.json", media: "chat_media/photo.jpg" };
  return { zip: zipSync({ [names.media]: [media, { level: 0 }], [names.json]: [json, { level }] }), names };
}

async function entryOf(zip: Uint8Array, name: string): Promise<ZipEntryInfo> {
  const { entries } = await listZipEntries(bytesReader(zip));
  return entries.find((e) => e.name === name) as ZipEntryInfo;
}

describe("inflateSource", () => {
  const text = randomDoc(21) + " ".repeat(2000) + "\n";
  const json = enc(text.startsWith("\uFEFF") ? text.slice(1) : text);

  async function drain(source: StreamSource): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    for (;;) {
      const chunk = await source.next();
      if (chunk === null) break;
      parts.push(chunk.slice());
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  it("streams stored and deflated entries back byte for byte, for any chunk size", async () => {
    for (const level of [0, 6] as const) {
      const { zip, names } = buildArchive(json, level);
      const info = await entryOf(zip, names.json);
      expect(info.method).toBe(level === 0 ? 0 : 8);
      for (const chunkBytes of [1, 7, 100, 4096, undefined]) {
        const got = await drain(inflateSource(bytesReader(zip), info, chunkBytes === undefined ? {} : { chunkBytes }));
        expect(Buffer.from(got).equals(Buffer.from(json)), `level ${level} chunk ${chunkBytes}`).toBe(true);
      }
    }
  });

  it("feeds projectConversations end to end, equal to parsing the same text directly", async () => {
    const { zip, names } = buildArchive(json);
    const info = await entryOf(zip, names.json);
    const viaZip = await collectAll(projectConversations(inflateSource(bytesReader(zip), info, { chunkBytes: 50 }), { keepFields: KEEP }));
    expect(viaZip).toEqual(await project(json));
  });

  it("reads only the entry's own header and compressed range, never the media entry", async () => {
    const { zip, names } = buildArchive(json);
    const media = await entryOf(zip, names.media);
    const info = await entryOf(zip, names.json);
    const reads: [number, number][] = [];
    const inner = bytesReader(zip);
    const reader: RandomAccessReader = {
      size: inner.size,
      read(start, end) {
        reads.push([start, end]);
        return inner.read(start, end);
      },
    };
    await drain(inflateSource(reader, info, { chunkBytes: 64 }));
    const mediaEnd = media.localHeaderOffset + 30 + media.compressedSize;
    expect(reads.length).toBeGreaterThan(2);
    for (const [s, e] of reads) {
      expect(e <= media.localHeaderOffset || s >= mediaEnd, `read ${s}-${e}`).toBe(true);
      expect(e - s).toBeLessThanOrEqual(64 > 30 ? 64 : 30);
    }
  });

  it("verifies the declared size: too small stops the stream, too large is reported at the end", async () => {
    const { zip, names } = buildArchive(json);
    const info = await entryOf(zip, names.json);
    for (const bad of [info.size - 1, info.size + 1, 0]) {
      const source = inflateSource(bytesReader(zip), { ...info, size: bad }, { chunkBytes: 200 });
      await expect(drain(source)).rejects.toMatchObject({ name: "ZipEntryError", code: "corrupt" });
    }
    const stored = buildArchive(json, 0);
    const storedInfo = await entryOf(stored.zip, stored.names.json);
    await expect(drain(inflateSource(bytesReader(stored.zip), { ...storedInfo, size: storedInfo.size + 1 }))).rejects.toMatchObject({ code: "corrupt" });
  });

  it("fails with fixed-text ZipEntryError on damaged, truncated, unsupported, encrypted and unresolved entries", async () => {
    const { zip, names } = buildArchive(json);
    const info = await entryOf(zip, names.json);
    const CANARY = "ZQCANARY-zip-44";

    const damaged = zip.slice();
    const header = new DataView(zip.buffer, zip.byteOffset + info.localHeaderOffset, 30);
    const dataAt = info.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    for (let i = 0; i < 12; i++) damaged[dataAt + i] = (damaged[dataAt + i] as number) ^ 0xff;
    await expect(drain(inflateSource(bytesReader(damaged), info))).rejects.toMatchObject({ code: "corrupt" });

    await expect(drain(inflateSource(bytesReader(zip), { ...info, compressedSize: info.compressedSize - 5 }))).rejects.toMatchObject({ code: "corrupt" });
    await expect(drain(inflateSource(bytesReader(zip), { ...info, compressedSize: info.compressedSize + 1_000_000 }))).rejects.toMatchObject({ code: "corrupt" });
    await expect(drain(inflateSource(bytesReader(zip), { ...info, method: 14 }))).rejects.toMatchObject({ code: "unsupported-method" });
    await expect(drain(inflateSource(bytesReader(zip), { ...info, size: Infinity }))).rejects.toMatchObject({ code: "too-large" });
    await expect(drain(inflateSource(bytesReader(zip), { ...info, localHeaderOffset: NaN }))).rejects.toMatchObject({ code: "corrupt" });
    await expect(drain(inflateSource(bytesReader(zip), { ...info, localHeaderOffset: 3 }))).rejects.toMatchObject({ code: "corrupt" });

    const encrypted = zip.slice();
    encrypted[info.localHeaderOffset + 6] = (encrypted[info.localHeaderOffset + 6] as number) | 1;
    await expect(drain(inflateSource(bytesReader(encrypted), info))).rejects.toMatchObject({ code: "encrypted" });

    const stored = buildArchive(json, 0);
    const storedInfo = await entryOf(stored.zip, stored.names.json);
    await expect(drain(inflateSource(bytesReader(stored.zip), { ...storedInfo, compressedSize: storedInfo.size - 1 }))).rejects.toMatchObject({ code: "corrupt" });

    // A reader that fails with a message of its own: the message is not repeated.
    const failing: RandomAccessReader = { size: zip.length, read: () => Promise.reject(new Error(`read failed ${CANARY}`)) };
    const err = await drain(inflateSource(failing, info)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZipEntryError);
    expect(String((err as Error).message) + String((err as Error).stack)).not.toContain(CANARY);
    const short: RandomAccessReader = { size: zip.length, read: (s, e) => Promise.resolve(new Uint8Array(Math.max(0, e - s - 1))) };
    await expect(drain(inflateSource(short, info))).rejects.toMatchObject({ code: "corrupt" });
  });

  it("keeps failing once it has failed, and rejects a bad chunk size at construction", async () => {
    const { zip, names } = buildArchive(json);
    const info = await entryOf(zip, names.json);
    const source = inflateSource(bytesReader(zip), { ...info, method: 14 });
    await expect(source.next()).rejects.toMatchObject({ code: "unsupported-method" });
    await expect(source.next()).rejects.toMatchObject({ code: "unsupported-method" });
    for (const bad of [0, -1, 1.5, NaN]) expect(() => inflateSource(bytesReader(zip), info, { chunkBytes: bad })).toThrow(RangeError);
  });

  it("handles an empty entry and bounds a decompression bomb to the declared size", async () => {
    const empty = zipSync({ "a.json": [new Uint8Array(0), { level: 0 }] });
    const emptyInfo = await entryOf(empty, "a.json");
    expect(await inflateSource(bytesReader(empty), emptyInfo).next()).toBeNull();
    await expect(collectAll(projectConversations(inflateSource(bytesReader(empty), emptyInfo), { keepFields: KEEP }))).rejects.toMatchObject({ code: "malformed" });

    const bomb = zipSync({ "bomb.json": [new Uint8Array(20_000_000), { level: 9 }] });
    const bombInfo = await entryOf(bomb, "bomb.json");
    expect(bombInfo.compressedSize).toBeLessThan(30_000);
    const source = inflateSource(bytesReader(bomb), { ...bombInfo, size: 1000 });
    await expect(drain(source)).rejects.toMatchObject({ code: "corrupt" });
  });
});

// ---------------------------------------------------------------- pipeline ---

const HEAVY = process.env.SNAPPY_HEAVY === "1";
const TARGET_BYTES = (HEAVY ? 300 : 40) * 1024 * 1024;
const PIPELINE_CANARY = "ZQCANARY-pipeline-5e9a";

interface SyntheticStats {
  messages: number;
  sentByMe: number;
  bytes: number;
  perConversation: Map<string, number>;
}

/**
 * Stream a synthetic chat_history.json of about `targetBytes` through a zip deflater, a chunk at
 * a time: the JSON text itself is never held whole. Returns the zip (compressed, in memory) and
 * the counts the projection must reproduce. Roughly every 50th Content carries a canary.
 */
function buildChatZip(targetBytes: number): { zip: Uint8Array; stats: SyntheticStats } {
  const stats: SyntheticStats = { messages: 0, sentByMe: 0, bytes: 0, perConversation: new Map() };
  const parts: Uint8Array[] = [];
  const archive = new Zip((err, data) => {
    if (err) throw err;
    parts.push(data);
  });
  const file = new ZipDeflate("json/chat_history.json", { level: 1 });
  archive.add(file);

  const rnd = prng(7);
  const words = ["hey", "lol", "ok", "see you", "tomorrow", "snap", "yes", "no", "later", "haha", "caf\u00e9", "\u4f60\u597d", "\\\"quoted\\\"", "\\u00e9"];
  const push = (text: string): void => {
    const bytes = te.encode(text);
    stats.bytes += bytes.length;
    file.push(bytes, false);
  };

  let pending = "{";
  for (let c = 0; stats.bytes + pending.length < targetBytes; c++) {
    const key = c % 7 === 3 ? `Group chat ${c}` : `user_${c}`;
    pending += `${c === 0 ? "" : ","}"${key}":[`;
    const count = 150 + Math.floor(rnd() * 100);
    for (let m = 0; m < count; m++) {
      let content = "";
      for (let w = 1 + Math.floor(rnd() * 12); w > 0; w--) content += `${words[Math.floor(rnd() * words.length)]} `;
      if (stats.messages % 50 === 0) content += PIPELINE_CANARY;
      const mine = rnd() < 0.5;
      pending += `${m === 0 ? "" : ","}{"From":"${mine ? "me" : key}","Created":"2024-01-02 03:04:05 UTC","Created(microseconds)":${1704164645123456 + m},"IsSender":${mine},"Media Type":"${m % 3 === 0 ? "SNAP" : "TEXT"}","Conversation Title":null,"Content":"${content}","IsSaved":false}`;
      stats.messages++;
      if (mine) stats.sentByMe++;
      stats.perConversation.set(key, (stats.perConversation.get(key) ?? 0) + 1);
      if (pending.length > 1 << 20) {
        push(pending);
        pending = "";
      }
    }
    pending += "]";
  }
  push(`${pending}}`);
  file.push(new Uint8Array(0), true);
  archive.end();

  const zip = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    zip.set(p, at);
    at += p.length;
  }
  return { zip, stats };
}

describe(`pipeline: deflate -> inflateSource -> projectConversations (${HEAVY ? "heavy, ~300 MB" : "~40 MB"})`, () => {
  afterEach(() => vi.restoreAllMocks());

  it(
    "streams a large chat_history with constant memory and exact counts",
    async () => {
      const { zip, stats } = buildChatZip(TARGET_BYTES);
      expect(stats.bytes).toBeGreaterThanOrEqual(TARGET_BYTES);
      const { entries } = await listZipEntries(bytesReader(zip));
      const info = entries[0] as ZipEntryInfo;
      expect(info.size).toBe(stats.bytes);

      const gc = (globalThis as { gc?: () => void }).gc;
      gc?.();
      const before = process.memoryUsage();
      let peakHeap = 0;
      let peakBuffers = 0;
      const sample = (): void => {
        const m = process.memoryUsage();
        peakHeap = Math.max(peakHeap, m.heapUsed - before.heapUsed);
        peakBuffers = Math.max(peakBuffers, m.arrayBuffers - before.arrayBuffers);
      };

      const counts = new Map<string, number>();
      let messages = 0;
      let sentByMe = 0;
      let leaked = 0;
      const started = performance.now();
      for await (const { conversationKey, record } of projectConversations(inflateSource(bytesReader(zip), info), { keepFields: KEEP })) {
        messages++;
        if (record.IsSender === true) sentByMe++;
        if (typeof record.From === "string" && record.From.includes("ZQCANARY")) leaked++;
        counts.set(conversationKey, (counts.get(conversationKey) ?? 0) + 1);
        if (messages % 4000 === 0) sample();
      }
      const seconds = (performance.now() - started) / 1000;
      sample();

      expect(messages).toBe(stats.messages);
      expect(sentByMe).toBe(stats.sentByMe);
      expect(leaked).toBe(0);
      expect(counts).toEqual(stats.perConversation);

      const mbPerSecond = stats.bytes / 1e6 / seconds;
      console.info(
        `json-stream pipeline: ${(stats.bytes / 1e6).toFixed(0)} MB of JSON (${(zip.length / 1e6).toFixed(0)} MB compressed), ${messages} messages, ` +
          `${mbPerSecond.toFixed(0)} MB/s inflate+project, peak heap +${(peakHeap / 1e6).toFixed(1)} MB, peak array buffers +${(peakBuffers / 1e6).toFixed(1)} MB`,
      );
      // Constant memory: a generous bound that does not grow with the input (the 300 MB run uses the same one).
      expect(peakHeap).toBeLessThan(128 * 1024 * 1024);
      expect(peakBuffers).toBeLessThan(160 * 1024 * 1024);
      // A loose floor only: the real figure is far higher alone (~50 MB/s) but this runs beside 70 other test files,
      // and it dropped to 6 MB/s under that load. An accidental quadratic would land well below 1 MB/s.
      expect(mbPerSecond).toBeGreaterThan(2);
    },
    HEAVY ? 900_000 : 120_000,
  );
});
