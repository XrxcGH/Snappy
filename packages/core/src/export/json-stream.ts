/**
 * Streaming, content-blind JSON projection for very large export files.
 *
 * chat_history.json and snap_history.json can be hundreds of MB (and a heavy user's may be many
 * times that). Parsing them with JSON.parse needs the whole text, and every message's text, in
 * memory. This module instead reads a byte stream through an incremental JSON tokenizer and
 * applies an ALLOWLIST projection while it goes:
 *   - a field whose name is not in `keepFields` has its value skipped at the byte level: string
 *     bytes are scanned for the closing quote and never decoded, copied or turned into a JS string;
 *   - kept fields are decoded only when their value is a primitive (string, number, boolean, null);
 *   - memory is bounded by one chunk and a few small buffers: records are handed on every
 *     MAX_BATCH records, never held for a whole chunk (a chunk can inflate to tens of MB, and
 *     tiny records amplify about 45x into objects), so there is no practical limit on the number
 *     of conversations, messages or friends.
 *
 * Privacy (contract rules 1 and 5): message text is skipped, never decoded. Errors carry fixed
 * text and a code only: no snippet, no offset, no key, no value. Conversation keys (usernames or
 * group titles) ARE decoded because callers need them to attribute events; callers apply the
 * same masking they apply elsewhere (group titles -> opaque hash).
 *
 * Accepted input
 *   - strict JSON structure (no trailing commas, no comments), an optional UTF-8 BOM;
 *   - raw control characters inside strings are tolerated (they are never interpreted);
 *   - \uXXXX escapes, with surrogate pairs combined; a lone surrogate becomes U+FFFD (a decoded
 *     value is built from UTF-8 bytes, which cannot hold one);
 *   - field names match `keepFields` ignoring ASCII case; the output uses the caller's spelling;
 *   - nesting deeper than 64 containers, a kept key or value longer than 1 MiB, or more than
 *     `maxBytes` of JSON (default 16 GiB) is refused. The name of a field inside a record that is
 *     longer than any kept name cannot match, so it is skipped unbuffered and never fails the parse.
 */
import { Inflate } from "fflate";
import { Crc32 } from "./crc32.ts";
import { ZipEntryError } from "./zip-reader.ts";
import type { RandomAccessReader, ZipEntryInfo } from "./zip-reader.ts";

// ------------------------------------------------------------------- public ---

/** A pull-based byte stream. `next()` yields chunks and then null at the end; chunks are never kept. */
export interface StreamSource {
  next(): Promise<Uint8Array | null>;
}

/** A projected value: only primitives are ever kept. */
export type ProjectedValue = string | number | boolean | null;
export type ProjectedRecord = Record<string, ProjectedValue>;

export type JsonStreamErrorCode = "malformed" | "depth" | "limit" | "source" | "encoding";

const ERROR_TEXT: Record<JsonStreamErrorCode, string> = {
  malformed: "The JSON data is damaged or not in the expected format.",
  depth: "The JSON data is nested deeper than the allowed limit.",
  limit: "The JSON data is larger than the allowed limit.",
  source: "The JSON data could not be read.",
  encoding: "The JSON data uses a text encoding that is not supported.",
};

/** Thrown by the projectors. The message is fixed text: no snippet, offset, key or value. */
export class JsonStreamError extends Error {
  readonly code: JsonStreamErrorCode;
  constructor(code: JsonStreamErrorCode) {
    super(ERROR_TEXT[code]);
    this.name = "JsonStreamError";
    this.code = code;
  }
}

export interface ProjectOptions {
  /** Field names to keep (ASCII case-insensitive); every other field is skipped undecoded. */
  keepFields: string[];
  /**
   * Told the kind ("string", "number", "boolean", "null", "object" or "array") of the top-level
   * value (key null) and of each value of the top-level object (key = its name), without reading
   * the value. It lets a caller see sections that hold no records, which the records alone cannot show.
   */
  onKind?: (key: string | null, kind: string) => void;
  /** Refuse more than this many bytes of JSON in total. Default 16 GiB. */
  maxBytes?: number;
}

export interface SectionOptions extends ProjectOptions {
  /** Section names (ASCII case-insensitive) whose arrays of objects are projected; others are skipped. */
  sections: string[];
}

/** Default total-bytes cap: far beyond any real export, still a bound on a hostile stream. */
const DEFAULT_MAX_BYTES = 16 * 1024 ** 3;
const MAX_DEPTH = 64;
/** A kept key or value (and so any one decoded string) may not exceed this. */
const MAX_TOKEN_BYTES = 1024 * 1024;
const MAX_NUMBER_CHARS = 512;
/** The longest field name the shape reader keeps; longer ones are reported as "". */
const MAX_SHAPE_KEY_BYTES = 64;
/** Records handed on at a time: bounds the objects alive however much one inflated chunk holds. */
const MAX_BATCH = 4096;

/** Default size of one read from the archive. */
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
/**
 * Compressed bytes are handed to the inflater this many at a time. The inflater expands a whole
 * push at once, so this bounds what one decompression bomb can allocate (about 1000x this).
 */
const INFLATE_PUSH_BYTES = 32 * 1024;

/**
 * Walk a JSON document shaped { "<conversation key>": [ { ...fields }, ... ], ... } and yield one
 * record per message, holding only `keepFields` with primitive values. Also accepted: a wrapper
 * object around that shape, and an array of arrays (the conversation key is then the position of
 * the inner array, as text) or an array of records (key ""). Anything else is skipped undecoded.
 */
export async function* projectConversations(
  source: StreamSource,
  opts: ProjectOptions,
): AsyncGenerator<{ conversationKey: string; record: ProjectedRecord }> {
  const projector = new Projector(opts, undefined, (key: string, record: ProjectedRecord) => ({ conversationKey: key, record }));
  yield* drive(source, projector);
}

/**
 * Describe the SHAPE of a conversation file without reading any value: one entry per record with
 * the name of each of its fields and the kind of its value ("string", "number", "boolean",
 * "null", "object" or "array"). Values are never decoded (a string is scanned for its closing
 * quote and dropped), so message text cannot reach memory; field names are, and a name longer
 * than 64 bytes is reported as "". `conversation` numbers the conversations in file order and
 * `conversationKey` is the key they are filed under (decoded like projectConversations does).
 * Used by the structure report (`snappy-export inspect`), which prints neither. `onKind` is told
 * the kind of each top-level value without reading it (see ProjectOptions).
 */
export async function* projectShapes(
  source: StreamSource,
  opts: { maxBytes?: number; onKind?: ProjectOptions["onKind"] } = {},
): AsyncGenerator<{ conversation: number; conversationKey: string; kinds: Record<string, string> }> {
  const projector = new Projector(
    { keepFields: [], ...opts },
    undefined,
    (key, record, seq) => ({ conversation: seq, conversationKey: key, kinds: record as Record<string, string> }),
    true,
  );
  yield* drive(source, projector);
}

/**
 * Yield the records of named sections: arrays of objects stored under those keys of the top-level
 * object (or of a wrapper object). Use it for friends.json (one pass over all sections) and for
 * memories_history.json ("Saved Media"). `section` is the spelling the caller asked for.
 */
export async function* projectSections(
  source: StreamSource,
  opts: SectionOptions,
): AsyncGenerator<{ section: string; record: ProjectedRecord }> {
  const sections = new Map<string, string>();
  for (const name of opts.sections) sections.set(lowerAscii(name), name);
  const projector = new Projector(opts, sections, (key: string, record: ProjectedRecord) => ({ section: key, record }));
  yield* drive(source, projector);
}

/** Records of one named section; see projectSections. */
export async function* projectArrayRecords(
  source: StreamSource,
  sectionName: string,
  keepFields: string[],
  opts: { maxBytes?: number } = {},
): AsyncGenerator<ProjectedRecord> {
  for await (const { record } of projectSections(source, { sections: [sectionName], keepFields, ...opts })) yield record;
}

async function* drive<T>(source: StreamSource, projector: Projector<T>): AsyncGenerator<T> {
  for (;;) {
    let chunk: Uint8Array | null;
    try {
      chunk = await source.next();
    } catch (e) {
      // A foreign source's own message is not ours to repeat.
      throw e instanceof ZipEntryError || e instanceof JsonStreamError ? e : new JsonStreamError("source");
    }
    if (chunk === null) break;
    if (!(chunk instanceof Uint8Array)) throw new JsonStreamError("source");
    projector.begin(chunk);
    // feed stops at MAX_BATCH records, so the objects of a big chunk are handed on as they appear.
    for (let at = 0; at < chunk.length; ) {
      at = projector.feed(chunk, at);
      if (projector.out.length > 0) {
        const items = projector.out;
        projector.out = [];
        for (const item of items) yield item;
      }
    }
  }
  projector.finish();
}

// -------------------------------------------------------------- tokenizer ---

// Syntax states.
const S_START = 0; // before the first byte (a BOM may come)
const S_BOM1 = 1;
const S_BOM2 = 2;
const S_VALUE = 3; // expecting a value
const S_ARR_FIRST = 4; // after "[": a value or "]"
const S_OBJ_FIRST = 5; // after "{": a key or "}"
const S_KEY = 6; // after "," in an object: a key
const S_COLON = 7;
const S_AFTER = 8; // after a value: "," or a closer
const S_STR = 9; // inside a string (key or value)
const S_ESC = 10; // after a backslash
const S_UNI = 11; // reading the hex digits of \uXXXX
const S_NUM = 12;
const S_LIT = 13; // inside true / false / null
const S_DONE = 14; // the root value is complete: only whitespace may follow

// Number sub-states (the JSON number grammar).
const N_MINUS = 0;
const N_ZERO = 1;
const N_INT = 2;
const N_DOT = 3;
const N_FRAC = 4;
const N_E = 5;
const N_ESIGN = 6;
const N_EXP = 7;

// What a container is for. Only the role decides what is decoded.
const R_TOP = 0; // not a container: the position of the root value
const R_WRAP = 1; // object whose values are searched for arrays of records
const R_GROUP = 2; // array of arrays (conversations) or of records
const R_ROWS = 3; // array whose object elements are records
const R_REC = 4; // one record: its kept fields are decoded
const R_SKIP = 5; // everything inside is skipped undecoded

const T_OBJECT = 1;
const T_ARRAY = 2;

/** Value of the JSON escape letter after a backslash; 0 = not a simple escape. */
const ESCAPES = new Uint8Array(256);
for (const [letter, value] of [['"', 0x22], ["\\", 0x5c], ["/", 0x2f], ["b", 8], ["f", 12], ["n", 10], ["r", 13], ["t", 9]] as const) {
  ESCAPES[letter.charCodeAt(0)] = value;
}

const LIT_TRUE = new Uint8Array([0x74, 0x72, 0x75, 0x65]);
const LIT_FALSE = new Uint8Array([0x66, 0x61, 0x6c, 0x73, 0x65]);
const LIT_NULL = new Uint8Array([0x6e, 0x75, 0x6c, 0x6c]);

// ignoreBOM: a decoded value that starts with U+FEFF keeps it.
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });
const utf8Encoder = new TextEncoder();

const malformed = (): never => {
  throw new JsonStreamError("malformed");
};

function lowerAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) | 0x20));
}

/** The kind of the JSON value that starts with byte `c` (its first character decides it). */
function kindOfStart(c: number): string {
  if (c === 0x22) return "string";
  if (c === 0x7b) return "object";
  if (c === 0x5b) return "array";
  if (c === 0x74 || c === 0x66) return "boolean";
  return c === 0x6e ? "null" : "number";
}

interface FieldPattern {
  name: string;
  /** UTF-8 bytes of the name with ASCII letters lowered. */
  bytes: Uint8Array;
}

/**
 * The incremental parser. `feed` consumes one chunk and may stop anywhere inside a token; the
 * state lives in fields, so the next chunk resumes exactly there. Every loop advances `i` or
 * changes state toward a terminal one, so no input can make it spin.
 */
class Projector<T> {
  out: T[] = [];

  private st = S_START;
  private depth = 0;
  private readonly types = new Uint8Array(MAX_DEPTH + 1);
  private readonly roles = new Uint8Array(MAX_DEPTH + 1);

  // Current string. `collect` says whether its bytes are kept; skipped strings are only scanned.
  private collect = false;
  private isKey = false;
  private buf = new Uint8Array(256);
  private bufLen = 0;
  private high = 0; // pending high surrogate from a \uD8xx escape, 0 if none
  private uniLeft = 0;
  private uniVal = 0;

  private numState = N_MINUS;
  private numStr = "";
  private lit: Uint8Array = LIT_NULL;
  private litPos = 0;
  private litValue: boolean | null = null;

  private rec: ProjectedRecord | null = null;
  private curName: string | null = null; // kept field the pending value belongs to
  private curKey = ""; // last decoded key of a wrapper object
  private rowsKey = ""; // conversation key or section name of the records being read
  private rowsSeq = -1; // number of the list of records being read (counts every list)
  private groupIdx = 0;

  private total = 0;
  private readonly fields: FieldPattern[];
  private readonly maxBytes: number;
  /** Shape mode: report every field's value kind instead of reading the kept fields. */
  private readonly shapes: boolean;
  /** Bytes a string may hold: past it a kept token is refused, a field name is skipped (capped). */
  private limit = MAX_TOKEN_BYTES;
  private readonly recordKeyLimit: number;
  private capped = false;

  // Plain fields, not parameter properties: Node's type stripping (used by tools/) rejects those.
  private readonly sections: Map<string, string> | undefined;
  private readonly emit: (key: string, record: ProjectedRecord, seq: number) => T;
  private readonly onKind: ProjectOptions["onKind"];

  constructor(
    opts: ProjectOptions,
    sections: Map<string, string> | undefined,
    emit: (key: string, record: ProjectedRecord, seq: number) => T,
    shapes = false,
  ) {
    this.sections = sections;
    this.emit = emit;
    this.shapes = shapes;
    this.onKind = opts.onKind;
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!(maxBytes > 0)) throw new RangeError("maxBytes must be positive");
    this.maxBytes = maxBytes;
    this.fields = opts.keepFields.map((name) => {
      const bytes = utf8Encoder.encode(name);
      for (let k = 0; k < bytes.length; k++) {
        const b = bytes[k] as number;
        if (b >= 0x41 && b <= 0x5a) bytes[k] = b | 0x20;
      }
      return { name, bytes };
    });
    // A field name longer than every kept name cannot match, so buffering stops there.
    this.recordKeyLimit = shapes ? MAX_SHAPE_KEY_BYTES : this.fields.reduce((m, f) => Math.max(m, f.bytes.length), 0);
  }

  /** Count a chunk against the byte limit; call once per chunk, before feeding it. */
  begin(chunk: Uint8Array): void {
    this.total += chunk.length;
    if (this.total > this.maxBytes) throw new JsonStreamError("limit");
  }

  /**
   * Consume `chunk` from byte `from` and return where it stopped: the end of the chunk, or just
   * after the record that filled a batch (the caller drains `out` and feeds on from there).
   */
  feed(chunk: Uint8Array, from: number): number {
    const n = chunk.length;
    let st = this.st;
    let i = from;
    while (i < n && this.out.length < MAX_BATCH) {
      switch (st) {
        case S_STR: {
          // Hot path: a long skipped string is one tight scan for the closing quote or a backslash.
          let j = i;
          while (j < n) {
            const c = chunk[j] as number;
            if (c === 0x22 || c === 0x5c) break;
            j++;
          }
          if (this.collect && j > i) {
            if (this.high !== 0) this.flushHigh();
            this.append(chunk, i, j);
          }
          if (j >= n) {
            i = n;
            break;
          }
          i = j + 1;
          st = (chunk[j] as number) === 0x22 ? this.endString() : S_ESC;
          break;
        }
        case S_ESC: {
          const c = chunk[i++] as number;
          if (c === 0x75) {
            this.uniLeft = 4;
            this.uniVal = 0;
            st = S_UNI;
            break;
          }
          const m = ESCAPES[c] as number;
          if (m === 0) malformed();
          if (this.collect) {
            if (this.high !== 0) this.flushHigh();
            this.appendByte(m);
          }
          st = S_STR;
          break;
        }
        case S_UNI: {
          const c = chunk[i++] as number;
          let h: number;
          if (c >= 0x30 && c <= 0x39) h = c - 0x30;
          else if (c >= 0x61 && c <= 0x66) h = c - 0x57;
          else if (c >= 0x41 && c <= 0x46) h = c - 0x37;
          else return malformed();
          this.uniVal = (this.uniVal << 4) | h;
          if (--this.uniLeft === 0) {
            if (this.collect) this.unicodeEscape(this.uniVal);
            st = S_STR;
          }
          break;
        }
        case S_AFTER: {
          const c = chunk[i++] as number;
          if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) break;
          if (c === 0x2c) st = this.types[this.depth] === T_OBJECT ? S_KEY : S_VALUE;
          else if (c === 0x7d) st = this.close(T_OBJECT);
          else if (c === 0x5d) st = this.close(T_ARRAY);
          else malformed();
          break;
        }
        case S_KEY:
        case S_OBJ_FIRST: {
          const c = chunk[i++] as number;
          if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) break;
          if (c === 0x22) {
            const role = this.roles[this.depth] as number;
            this.collect = role === R_REC || role === R_WRAP;
            this.isKey = true;
            this.bufLen = 0;
            this.high = 0;
            this.capped = false;
            this.limit = role === R_REC ? this.recordKeyLimit : MAX_TOKEN_BYTES;
            st = S_STR;
          } else if (c === 0x7d && st === S_OBJ_FIRST) st = this.close(T_OBJECT);
          else malformed();
          break;
        }
        case S_COLON: {
          const c = chunk[i++] as number;
          if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) break;
          if (c !== 0x3a) malformed();
          st = S_VALUE;
          break;
        }
        case S_VALUE:
        case S_ARR_FIRST: {
          const c = chunk[i++] as number;
          if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) break;
          if (c === 0x5d && st === S_ARR_FIRST) st = this.close(T_ARRAY);
          else st = this.startValue(c);
          break;
        }
        case S_NUM: {
          let ns = this.numState;
          const keep = this.collect;
          while (i < n) {
            const c = chunk[i] as number;
            const digit = c >= 0x30 && c <= 0x39;
            let next = -1;
            switch (ns) {
              case N_MINUS:
                if (c === 0x30) next = N_ZERO;
                else if (digit) next = N_INT;
                else malformed();
                break;
              case N_ZERO:
                if (c === 0x2e) next = N_DOT;
                else if (c === 0x65 || c === 0x45) next = N_E;
                break;
              case N_INT:
                if (digit) next = N_INT;
                else if (c === 0x2e) next = N_DOT;
                else if (c === 0x65 || c === 0x45) next = N_E;
                break;
              case N_DOT:
                if (digit) next = N_FRAC;
                else malformed();
                break;
              case N_FRAC:
                if (digit) next = N_FRAC;
                else if (c === 0x65 || c === 0x45) next = N_E;
                break;
              case N_E:
                if (c === 0x2b || c === 0x2d) next = N_ESIGN;
                else if (digit) next = N_EXP;
                else malformed();
                break;
              case N_ESIGN:
                if (digit) next = N_EXP;
                else malformed();
                break;
              default: // N_EXP
                if (digit) next = N_EXP;
            }
            if (next < 0) break; // the number is over; this byte belongs to what follows
            ns = next;
            i++;
            if (keep) {
              this.numStr += String.fromCharCode(c);
              if (this.numStr.length > MAX_NUMBER_CHARS) throw new JsonStreamError("limit");
            }
          }
          this.numState = ns;
          if (i < n) st = this.endNumber();
          break;
        }
        case S_LIT: {
          if ((chunk[i++] as number) !== this.lit[this.litPos]) malformed();
          if (++this.litPos === this.lit.length) {
            this.valueDone(this.litValue);
            st = this.afterValue();
          }
          break;
        }
        case S_DONE: {
          const c = chunk[i++] as number;
          if (c !== 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09) malformed();
          break;
        }
        case S_START: {
          const b0 = chunk[i] as number;
          // UTF-16 (a byte order mark, or the NUL byte that follows the first ASCII character) is not
          // decoded: that would turn every value, message text included, into a string. Said plainly.
          if (b0 === 0xff || b0 === 0xfe || b0 === 0x00 || (i + 1 < n && chunk[i + 1] === 0x00)) throw new JsonStreamError("encoding");
          if (b0 === 0xef) {
            i++;
            st = S_BOM1;
          } else st = S_VALUE;
          break;
        }
        case S_BOM1:
          if (chunk[i++] !== 0xbb) malformed();
          st = S_BOM2;
          break;
        default: // S_BOM2
          if (chunk[i++] !== 0xbf) malformed();
          st = S_VALUE;
      }
    }
    this.st = st;
    return i;
  }

  /** The stream ended: the root value must be complete (a bare top-level number ends at EOF). */
  finish(): void {
    if (this.st === S_DONE) return;
    if (this.st === S_NUM && this.depth === 0 && (this.numState === N_ZERO || this.numState === N_INT || this.numState === N_FRAC || this.numState === N_EXP)) return;
    malformed();
  }

  // ---- structure ----

  private startValue(c: number): number {
    const parent = this.depth === 0 ? R_TOP : (this.roles[this.depth] as number);
    if (parent === R_GROUP) this.groupIdx++;
    if (this.onKind !== undefined) {
      if (this.depth === 0) this.onKind(null, kindOfStart(c));
      else if (this.depth === 1 && parent === R_WRAP) this.onKind(this.curKey, kindOfStart(c));
    }
    if (this.shapes && parent === R_REC && this.curName !== null) (this.rec as ProjectedRecord)[this.curName] = kindOfStart(c);
    this.limit = MAX_TOKEN_BYTES;
    this.capped = false;
    if (c === 0x7b) return this.open(T_OBJECT, parent, S_OBJ_FIRST);
    if (c === 0x5b) return this.open(T_ARRAY, parent, S_ARR_FIRST);
    // Primitive: kept only as the value of a kept field of a record (never in shape mode).
    this.collect = !this.shapes && parent === R_REC && this.curName !== null;
    if (c === 0x22) {
      this.isKey = false;
      this.bufLen = 0;
      this.high = 0;
      return S_STR;
    }
    if (c === 0x2d || (c >= 0x30 && c <= 0x39)) {
      this.numState = c === 0x2d ? N_MINUS : c === 0x30 ? N_ZERO : N_INT;
      this.numStr = this.collect ? String.fromCharCode(c) : "";
      return S_NUM;
    }
    if (c === 0x74) return this.startLiteral(LIT_TRUE, true);
    if (c === 0x66) return this.startLiteral(LIT_FALSE, false);
    if (c === 0x6e) return this.startLiteral(LIT_NULL, null);
    return malformed();
  }

  private startLiteral(lit: Uint8Array, value: boolean | null): number {
    this.lit = lit;
    this.litPos = 1;
    this.litValue = value;
    return S_LIT;
  }

  private open(type: number, parent: number, first: number): number {
    if (this.depth >= MAX_DEPTH) throw new JsonStreamError("depth");
    const role = this.childRole(parent, type === T_ARRAY);
    if (!this.shapes && parent === R_REC && this.curName !== null && this.rec !== null) delete this.rec[this.curName]; // a non-primitive value replaces any earlier one
    const d = ++this.depth;
    this.types[d] = type;
    this.roles[d] = role;
    if (role === R_REC) this.rec = {};
    return first;
  }

  private childRole(parent: number, isArray: boolean): number {
    switch (parent) {
      case R_TOP:
        return isArray ? (this.sections === undefined ? R_GROUP : R_SKIP) : R_WRAP;
      case R_WRAP: {
        if (!isArray) return R_WRAP;
        if (this.sections === undefined) {
          this.rowsKey = this.curKey;
          this.rowsSeq++;
          return R_ROWS;
        }
        const name = this.sections.get(lowerAscii(this.curKey));
        if (name === undefined) return R_SKIP;
        this.rowsKey = name;
        this.rowsSeq++;
        return R_ROWS;
      }
      case R_GROUP:
        this.rowsKey = isArray ? String(this.groupIdx - 1) : "";
        if (isArray) this.rowsSeq++;
        return isArray ? R_ROWS : R_REC;
      case R_ROWS:
        return isArray ? R_SKIP : R_REC;
      default:
        return R_SKIP;
    }
  }

  private close(type: number): number {
    const d = this.depth;
    if (d === 0 || this.types[d] !== type) return malformed();
    if (this.roles[d] === R_REC) {
      this.out.push(this.emit(this.rowsKey, this.rec as ProjectedRecord, this.rowsSeq));
      this.rec = null;
    }
    this.depth = d - 1;
    return d === 1 ? S_DONE : S_AFTER;
  }

  private afterValue(): number {
    return this.depth === 0 ? S_DONE : S_AFTER;
  }

  private valueDone(v: ProjectedValue): void {
    if (this.collect) (this.rec as ProjectedRecord)[this.curName as string] = v;
  }

  private endNumber(): number {
    const ns = this.numState;
    if (ns !== N_ZERO && ns !== N_INT && ns !== N_FRAC && ns !== N_EXP) return malformed();
    this.valueDone(this.collect ? Number(this.numStr) : null);
    return this.afterValue();
  }

  // ---- strings ----

  private endString(): number {
    if (this.high !== 0) this.flushHigh();
    if (this.isKey) {
      if (this.collect) {
        if (this.roles[this.depth] !== R_REC) this.curKey = this.decode();
        else if (this.shapes) this.curName = this.capped ? "" : this.decode();
        else this.curName = this.capped ? null : this.matchField();
      }
      return S_COLON;
    }
    if (this.collect) this.valueDone(this.decode());
    return this.afterValue();
  }

  private decode(): string {
    return this.bufLen === 0 ? "" : utf8.decode(this.buf.subarray(0, this.bufLen));
  }

  /** The kept field whose name equals the collected key (ASCII case-insensitive), or null. */
  private matchField(): string | null {
    const { buf, bufLen, fields } = this;
    for (let f = 0; f < fields.length; f++) {
      const pattern = (fields[f] as FieldPattern).bytes;
      if (pattern.length !== bufLen) continue;
      let k = 0;
      for (; k < bufLen; k++) {
        let b = buf[k] as number;
        if (b >= 0x41 && b <= 0x5a) b |= 0x20;
        if (b !== pattern[k]) break;
      }
      if (k === bufLen) return (fields[f] as FieldPattern).name;
    }
    return null;
  }

  /** A completed \uXXXX escape: surrogate pairs are combined, a lone surrogate becomes U+FFFD. */
  private unicodeEscape(v: number): void {
    if (this.high !== 0) {
      const hi = this.high;
      this.high = 0;
      if (v >= 0xdc00 && v <= 0xdfff) {
        this.appendCodePoint(0x10000 + ((hi - 0xd800) << 10) + (v - 0xdc00));
        return;
      }
      this.appendCodePoint(0xfffd);
    }
    if (v >= 0xd800 && v <= 0xdbff) this.high = v;
    else if (v >= 0xdc00 && v <= 0xdfff) this.appendCodePoint(0xfffd);
    else this.appendCodePoint(v);
  }

  private flushHigh(): void {
    this.high = 0;
    this.appendCodePoint(0xfffd);
  }

  /** Room for `extra` more bytes. False once a field name has outgrown every name that could match: it is then skipped. */
  private ensure(extra: number): boolean {
    const need = this.bufLen + extra;
    if (need > this.limit) {
      if (this.limit >= MAX_TOKEN_BYTES) throw new JsonStreamError("limit");
      this.capped = true;
      return false;
    }
    if (need <= this.buf.length) return true;
    const grown = new Uint8Array(Math.min(MAX_TOKEN_BYTES, Math.max(need, this.buf.length * 2)));
    grown.set(this.buf.subarray(0, this.bufLen));
    this.buf = grown;
    return true;
  }

  private append(chunk: Uint8Array, from: number, to: number): void {
    const len = to - from;
    if (this.capped || !this.ensure(len)) return;
    if (len < 16) for (let k = 0; k < len; k++) this.buf[this.bufLen + k] = chunk[from + k] as number;
    else this.buf.set(chunk.subarray(from, to), this.bufLen);
    this.bufLen += len;
  }

  private appendByte(b: number): void {
    if (this.capped || !this.ensure(1)) return;
    this.buf[this.bufLen++] = b;
  }

  private appendCodePoint(cp: number): void {
    if (this.capped || !this.ensure(4)) return;
    const b = this.buf;
    let at = this.bufLen;
    if (cp < 0x80) b[at++] = cp;
    else if (cp < 0x800) {
      b[at++] = 0xc0 | (cp >> 6);
      b[at++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      b[at++] = 0xe0 | (cp >> 12);
      b[at++] = 0x80 | ((cp >> 6) & 0x3f);
      b[at++] = 0x80 | (cp & 0x3f);
    } else {
      b[at++] = 0xf0 | (cp >> 18);
      b[at++] = 0x80 | ((cp >> 12) & 0x3f);
      b[at++] = 0x80 | ((cp >> 6) & 0x3f);
      b[at++] = 0x80 | (cp & 0x3f);
    }
    this.bufLen = at;
  }
}

// ------------------------------------------------------------ zip entries ---

/**
 * A StreamSource over one zip entry: its compressed bytes are read from `reader` in chunks
 * (default 4 MiB) and inflated incrementally (stored entries pass through), so neither the
 * compressed nor the inflated entry is ever held whole. The local header is checked like
 * readZipEntry does; no other part of the archive is requested.
 *
 * The declared size is verified: more output than declared stops at once, less at the end is an
 * error. The declared CRC-32 is checked incrementally and verified when the data ends, so damage
 * that keeps the length (a flipped digit) fails loudly too; a consumer must treat what it has
 * seen as void when `next()` throws. Failures are ZipEntryError with fixed text:
 * no entry name, no data, no reader or inflater message. After a failure `next()` keeps failing.
 */
export function inflateSource(reader: RandomAccessReader, info: ZipEntryInfo, opts: { chunkBytes?: number } = {}): StreamSource {
  const chunkBytes = opts.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new RangeError("chunkBytes must be a positive integer");

  const queue: Uint8Array[] = [];
  let produced = 0;
  let began = false;
  let at = 0; // next compressed byte to read
  let end = 0;
  let pending: Uint8Array = new Uint8Array(0); // read from the archive, not yet fed to the inflater
  let pendingAt = 0;
  let inputDone = false;
  let finished = false;
  let failure: ZipEntryError | undefined;
  let inflater: Inflate | undefined;
  const crc = new Crc32();

  const checked = async (start: number, stop: number): Promise<Uint8Array> => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(stop) || start < 0 || stop < start || stop > reader.size) throw new ZipEntryError("corrupt");
    if (stop === start) return new Uint8Array(0);
    const bytes = await reader.read(start, stop);
    if (bytes.byteLength !== stop - start) throw new ZipEntryError("corrupt");
    return bytes;
  };

  const begin = async (): Promise<void> => {
    if (info.method !== 0 && info.method !== 8) throw new ZipEntryError("unsupported-method");
    // Order matters: an Infinity (unresolvable zip64) size is "too large", NaN or negative is "corrupt".
    if (info.size === Infinity || info.compressedSize === Infinity) throw new ZipEntryError("too-large");
    for (const v of [info.size, info.compressedSize, info.localHeaderOffset]) {
      if (!Number.isSafeInteger(v) || v < 0) throw new ZipEntryError("corrupt");
    }
    if (info.method === 0 && info.compressedSize !== info.size) throw new ZipEntryError("corrupt");
    const header = await checked(info.localHeaderOffset, info.localHeaderOffset + 30);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint32(0, true) !== 0x04034b50) throw new ZipEntryError("corrupt");
    if ((view.getUint16(6, true) & 0x41) !== 0) throw new ZipEntryError("encrypted"); // bit 0 password, bit 6 strong
    at = info.localHeaderOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
    end = at + info.compressedSize;
    if (end > reader.size) throw new ZipEntryError("corrupt");
    if (info.method === 8) {
      inflater = new Inflate((chunk) => {
        produced += chunk.length;
        // More output than declared: stop at once instead of expanding a bomb to the end.
        if (produced > info.size) throw new ZipEntryError("corrupt");
        if (chunk.length > 0) {
          crc.update(chunk);
          queue.push(chunk);
        }
      });
    }
    if (info.size === 0 && info.compressedSize === 0) inputDone = true; // an empty entry has nothing to read
  };

  const step = async (): Promise<Uint8Array | null> => {
    if (!began) {
      began = true;
      await begin();
    }
    for (;;) {
      const ready = queue.shift();
      if (ready !== undefined) return ready;
      if (finished) return null;
      if (inputDone) {
        if (produced !== info.size) throw new ZipEntryError("corrupt");
        if (info.crc32 !== undefined && crc.digest() !== info.crc32) throw new ZipEntryError("corrupt");
        finished = true;
        return null;
      }
      if (info.method === 0) {
        const to = Math.min(end, at + chunkBytes);
        const bytes = await checked(at, to);
        at = to;
        produced += bytes.length;
        crc.update(bytes);
        if (at >= end) inputDone = true;
        return bytes;
      }
      if (pendingAt >= pending.length) {
        const to = Math.min(end, at + chunkBytes);
        pending = await checked(at, to);
        at = to;
        pendingAt = 0;
      }
      const to = Math.min(pending.length, pendingAt + INFLATE_PUSH_BYTES);
      const last = at >= end && to === pending.length;
      (inflater as Inflate).push(pending.subarray(pendingAt, to), last);
      pendingAt = to;
      if (last) inputDone = true;
    }
  };

  return {
    async next() {
      if (failure !== undefined) throw failure;
      try {
        return await step();
      } catch (e) {
        // Inflater errors and reader failures: neither message is repeated.
        failure = e instanceof ZipEntryError ? e : new ZipEntryError("corrupt");
        throw failure;
      }
    },
  };
}
