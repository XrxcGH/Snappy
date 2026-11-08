/**
 * Synthetic "Download My Data" export generator (demo mode, CLI --demo, dashboard
 * "try with sample data", integration tests). Pure and deterministic: the same options
 * always yield byte-identical output. Nothing here reads the clock, the network or disk.
 *
 * The JSON layouts follow the real export
 * shapes: json/account.json, json/friends.json, json/chat_history.json and
 * json/memories_history.json, plus optional tiny media files under memories/.
 *
 * ---------------------------------------------------------------- time model ---
 *  - `now` is the generation time of the produced export, interpreted as the time of the
 *    LATER export (phase 2). The EARLIER export (phase 1) was generated 120 days before:
 *    phase 1 exportedAt = now - 120 days, phase 2 exportedAt = now.
 *    So `buildSyntheticExport({ now, phase: 1 })` and `({ now, phase: 2 })` form a pair
 *    for ledger diffs, and everything in them is in the past relative to `now`.
 *    Use `syntheticExportedAt(opts)` to get the export time of a given phase.
 *  - Phase 1 is exactly "phase 2 as it was 120 days earlier": chats and memories are
 *    prefixes of the phase 2 history (nothing dated after the phase 1 export time).
 *
 * ---------------------------------------------------------- scenario conventions ---
 * Usernames are `<kind>_<N>` (N counts from 1 within each kind). Compare them through
 * normUser(): roughly a fifth of them are emitted capitalised or upper-case ("Active_7",
 * "GHOST_3") to exercise case-insensitivity.
 *
 *  active_N     Friends in BOTH phases. Chatted within the last 10 days of each export.
 *  dormant_N    Old friends (2+ years) in BOTH phases. No chat within the last 12 months
 *               of either export (about 30% never chatted at all).
 *  ghost_N      Friends in phase 1, ABSENT from phase 2 and NOT in phase 2's
 *               "Deleted Friends" (the "might have unadded me" scenario). Last chat was
 *               45+ days before the phase 1 export; never anything after it.
 *  removed_N    Friends in phase 1; in phase 2 they are absent from "Friends" and listed
 *               in "Deleted Friends" with a deletion time between the two exports.
 *               The deletion time sits in "Creation Timestamp", "Last Modified Timestamp"
 *               or "Date" depending on N % 3 (best-effort parsing is part of the test).
 *  oneway_N     In "Friend Requests Sent" in BOTH phases (old request), never a friend.
 *  newfriend_N  Appear ONLY in phase 2 (friends, created between the exports, chatting).
 *  exfriend_N   In "Deleted Friends" in BOTH phases (deleted long before phase 1); never
 *               friends. Keeps "deleted" from being synonymous with `removed_N`.
 *  snapper_N    Realistic exports only: friends in BOTH phases who only exchange Snaps (see below).
 *  blocked_N / ignored_N / pending_N / suggest_N
 *               Static entries of "Blocked Users" / "Ignored Snapchatters" /
 *               "Pending Requests" (incoming) / "Hidden Friend Suggestions", identical
 *               in both phases. Never friends, never chat.
 *
 * `friendCount` is the number of entries in phase 2's "Friends" (active + dormant +
 * newfriend); the other kinds are extras scaled from it (ghost ~8%, removed ~5%,
 * oneway ~8%, exfriend ~5%; newfriend ~6% and dormant ~20% are part of the count).
 * Phase 1 therefore has friendCount - newfriend + ghost + removed friends.
 *
 * The account owner is "demo_user". Chats are 1:1 (conversation key = the friend's
 * username, "Conversation Title" null) plus a few group chats (key = group title,
 * "Conversation Title" set, members are active_N). `chatMessageCount` is the target
 * size of the phase 2 history; it can be exceeded when needed to honour the "chatted
 * recently" guarantees for small values. Memories: `memoryCount` entries in phase 2
 * (about 4% exact duplicates by URL, 25% videos, ~15% with no Location, ~15% at 0,0,
 * ~4% with an unparseable date, ~2% with an unknown media type); phase 1 holds the
 * subset captured before its export time. Memory URLs use the reserved ".invalid" TLD
 * so a demo can never reach a real server.
 *
 * ------------------------------------------------------------ privacy canaries ---
 * The real export is full of personal content that Snappy must never surface. This
 * generator therefore fills EVERY such field with a distinctive CANARY string (see
 * CANARIES): message 'Content', 'Display Name', group titles/keys, memory 'Location'
 * and 'Caption', 'Source', and the account's name/email/phone. Privacy tests run the
 * whole pipeline on this export and assert no canary ever reaches any output, which is
 * only meaningful because the canaries are provably present in the raw JSON. Usernames
 * never contain a canary (they are the one identifier Snappy is allowed to keep).
 * Canaries are cycled by index, so every one is present with the default options (and
 * with friendCount >= ~40, memoryCount >= ~40 and the default message count); tiny
 * demos may omit some.
 *
 * ------------------------------------------------------------ realistic exports ---
 * `realisticMemories: true` builds the export the way the real 2026 one looks instead of the
 * older recalled shape (the default, which many tests rely on):
 *  - memories_history.json has EVERY link empty, exact UTC Dates (no two in the same second), only
 *    Image and Video entries and no duplicates. About 70% of the entries have a file under
 *    memories/ named YYYY-MM-DD_<UUID>-main.<jpg|mp4> whose zip entry carries the extended UTC
 *    timestamp (0x5455) of the entry's Date; about 3% of those have a ...-overlay.png sharing the
 *    UUID; each memories/ folder has one small html file.
 *  - json/snap_history.json holds Snaps (same layout as the chat history, no message text) for
 *    friends, groups and a few hundred contacts. It has the group-title canaries.
 *  - snapper_N: friends in BOTH phases who only exchange Snaps (no chat at all), with Snaps in the
 *    last 10 days of each export. They are carved out of active_N, so friendCount is unchanged.
 *    contact_N: people who appear only in snap_history.json (never in friends.json).
 *  - syntheticExportParts gives the three-zip layout (mydata~<digits>.zip with json/, html/ and a few
 *    chat_media/ files; -2 and -3 with memories/; -2 also chat_media/ and shared_story/).
 *    syntheticExportZip and buildSyntheticExport give the same export as one archive/record.
 *  - every zip entry carries an extended UTC timestamp (0x5455), so exportedAt is exact.
 *
 * `storageShowcase: true` (with the realistic shape) makes the storage views worth looking at, for the
 * built-in sample: every Memories file declares a plausible size (images 0.2 to 4 MB, videos 3 to 40 MB) in
 * its zip directory entries, so the storage meter, the cap projection and the storage planner have real-looking
 * numbers. The files hold only a few bytes: the declared size is written over the size fields of the local
 * header and the directory entry, so such an archive lists and pairs like a big one but a file in it cannot be
 * extracted. Archives only (syntheticExportZip and syntheticExportParts). Off by default: the plain realistic
 * export keeps tiny files. No duplicates are added: with every link empty, as in the real list, two entries of
 * the same second cannot be paired with files, so the planner has nothing to tell them apart by.
 */
import { zipSync } from "fflate";
import type { Zippable } from "fflate";
import { DAY_MS, hashString, seededRandom } from "../util.ts";

export interface SyntheticExportOptions {
  /** PRNG seed. Default 1. */
  seed?: number;
  /** REQUIRED epoch ms: generation time of the later (phase 2) export. Never read from the clock. */
  now: number;
  /** 1 = earlier export (now - 120 days), 2 = later export (default). */
  phase?: 1 | 2;
  /** Entries in phase 2's "Friends". Default 120. */
  friendCount?: number;
  /** Target number of chat messages in the phase 2 history. Default friendCount * 25. */
  chatMessageCount?: number;
  /** Entries in phase 2's "Saved Media". Default 400. */
  memoryCount?: number;
  /** Also emit a few tiny valid JPEG/MP4 files under memories/. Default false. Ignored when realisticMemories is set. */
  bundleMedia?: boolean;
  /**
   * Build the export in the real 2026 shape: empty Memories links, bundled files paired by exact
   * UTC time, snap_history.json and Snap-only friends (see "realistic exports" above). Default false.
   */
  realisticMemories?: boolean;
  /**
   * With realisticMemories (or in the archives of syntheticExportParts): declared Memories file sizes of
   * a few hundred KB to tens of MB, so the storage meter, the cap projection and the storage planner have
   * something to show. Files cannot be extracted (see "realistic exports"). Default false.
   */
  storageShowcase?: boolean;
}

export interface SyntheticCanaries {
  /** Injected into message 'Content'. */
  messageText: string[];
  /** Injected into 'Display Name' fields. */
  displayNames: string[];
  /** Injected into group 'Conversation Title' values (which are also the group keys). */
  groupTitles: string[];
  /** Injected into memories 'Location' strings (coordinate-like). */
  locations: string[];
  /** Injected into memories 'Caption' fields. */
  captions: string[];
  /** Injected into friends 'Source' fields. */
  sources: string[];
  /** Injected into account.json name/email/phone. */
  account: string[];
}

/**
 * Distinctive strings that exist ONLY so privacy tests can prove no module surfaces
 * them. Unlikely to occur by accident, safe inside JSON (no escaping), some with
 * non-ASCII text so Unicode handling cannot hide a leak.
 */
export const CANARIES: SyntheticCanaries = {
  messageText: ["ZQCANARY-MSG-1", "ZQCANARY-MSG-2", "ZQCANARY-MSG-3", "ZQCANARY-MSG-4 señal 🔐"],
  displayNames: ["ZQCANARY-DN-1", "ZQCANARY-DN-2 Ünal", "ZQCANARY-DN-3", "ZQCANARY-DN-4 李", "ZQCANARY-DN-5"],
  groupTitles: ["ZQCANARY-GRP-1", "ZQCANARY-GRP-2", "ZQCANARY-GRP-3", "ZQCANARY-GRP-4"],
  locations: ["13.371337, 73.37", "-42.424242, 117.171717", "66.606660, -16.16", "ZQCANARY-LOC-4"],
  captions: ["ZQCANARY-CAP-1", "ZQCANARY-CAP-2"],
  sources: ["ZQCANARY-SRC-1", "ZQCANARY-SRC-2"],
  account: ["ZQCANARY-ACCT-NAME", "zqcanary-acct@demo.invalid", "ZQCANARY-ACCT-PHONE"],
};

/** Canary `i` of a list, wrapping around. */
function canary(list: readonly string[], i: number): string {
  return list[i % list.length] as string;
}

/** Days between the phase 1 and phase 2 exports. */
export const SYNTHETIC_PHASE_GAP_DAYS = 120;

/** Reserved-TLD origin for fake download links. Joined from parts so bundles that embed this generator hold no URL literal. */
const DEMO_ORIGIN = ["https:", "", "demo.snappy.invalid"].join("/");
const OWNER = "demo_user";
const BUNDLED_MEDIA_MAX = 6;

/** Export generation time of the given options' phase (see "time model" above). */
export function syntheticExportedAt(opts: SyntheticExportOptions): number {
  return resolve(opts).exportedAt;
}

export function buildSyntheticExport(opts?: SyntheticExportOptions): Record<string, Uint8Array> {
  const cfg = resolve(opts);
  if (cfg.realistic) return flatten(buildParts(cfg));
  const roster = buildRoster(cfg);
  const memories = buildMemories(cfg);

  const files: Record<string, Uint8Array> = {
    "json/account.json": jsonBytes(buildAccount(cfg), 2),
    "json/friends.json": jsonBytes(buildFriends(cfg, roster), 2),
    // Compact: chat history is by far the largest file and 100k+ messages are expected.
    "json/chat_history.json": jsonBytes(buildChats(cfg, roster), 0),
    "json/memories_history.json": jsonBytes({ "Saved Media": memories.map((m) => m.json) }, 2),
  };
  if (cfg.bundleMedia) Object.assign(files, buildMediaFiles(memories));
  return files;
}

export function syntheticExportZip(opts?: SyntheticExportOptions): Uint8Array {
  const cfg = resolve(opts);
  if (cfg.realistic) return zipOf(cfg, buildParts(cfg).flatMap((p) => Object.entries(p.files)));
  const files = buildSyntheticExport(opts);
  const mtime = dosMtime(cfg);
  const zippable: Zippable = {};
  for (const [name, data] of Object.entries(files)) zippable[name] = [data, { mtime, level: 6 }];
  return zipSync(zippable);
}

/**
 * The realistic export as the three zips Snapchat hands out: `mydata~<13 digits>.zip` (json/,
 * html/, index.html, a few chat_media/ files), then `-2.zip` (memories/, chat_media/,
 * shared_story/) and `-3.zip` (memories/ only), in that order. Always the realistic shape,
 * whatever `realisticMemories` says. Deterministic like everything here.
 */
export function syntheticExportParts(opts?: SyntheticExportOptions): { name: string; bytes: Uint8Array }[] {
  const cfg = { ...resolve(opts), realistic: true };
  return buildParts(cfg).map((p) => ({ name: p.name, bytes: zipOf(cfg, Object.entries(p.files)) }));
}

/** The DOS timestamp is written from LOCAL date fields; a local noon built from the UTC calendar day makes the bytes independent of the machine's timezone (noon also dodges DST gaps). */
function dosMtime(cfg: Config): Date {
  const d = new Date(cfg.exportedAt);
  const year = Math.min(2099, Math.max(1980, d.getUTCFullYear()));
  return new Date(year, d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
}

/** 0x5455 extra field body: flags (mtime present) and the UTC mtime in seconds. */
function extendedTimestamp(ms: number): Uint8Array {
  const out = new Uint8Array(5);
  out[0] = 1;
  new DataView(out.buffer).setUint32(1, Math.floor(ms / 1000), true);
  return out;
}

const EXTENDED_TIMESTAMP_ID = 0x5455;

function zipOf(cfg: Config, files: [string, SynthFile][]): Uint8Array {
  const mtime = dosMtime(cfg);
  const zippable: Zippable = {};
  const declared = new Map<string, number>();
  for (const [name, file] of files) {
    zippable[name] = [file.data, { mtime, level: 6, extra: { [EXTENDED_TIMESTAMP_ID]: extendedTimestamp(file.utc) } }];
    if (file.declaredSize !== undefined) declared.set(name, file.declaredSize);
  }
  const zip = zipSync(zippable);
  if (declared.size > 0) declareSizes(zip, declared);
  return zip;
}

/**
 * Overwrite the uncompressed size of the named entries, in the directory entry and in the local header, in place.
 * Nothing else changes, so the archive lists, pairs and sizes the files as if they were that big. A size is never
 * checked against the bytes until a file is extracted, which is why such a file cannot be.
 */
function declareSizes(zip: Uint8Array, sizes: ReadonlyMap<string, number>): void {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const names = new TextDecoder();
  // fflate writes no archive comment, so the end record is the last 22 bytes.
  const end = zip.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error("synthetic export: unexpected zip end record");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("synthetic export: unexpected zip directory entry");
    const nameLength = view.getUint16(at + 28, true);
    const name = names.decode(zip.subarray(at + 46, at + 46 + nameLength));
    const size = sizes.get(name);
    if (size !== undefined) {
      view.setUint32(at + 24, size, true);
      view.setUint32(view.getUint32(at + 42, true) + 22, size, true);
    }
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
}

/** The whole realistic export as one record (the parts' files side by side). */
function flatten(parts: SynthPart[]): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const p of parts) for (const [name, file] of Object.entries(p.files)) out[name] = file.data;
  return out;
}

// ------------------------------------------------------------------ config ---

interface Config {
  seed: number;
  phase: 1 | 2;
  friendCount: number;
  chatMessageCount: number;
  memoryCount: number;
  bundleMedia: boolean;
  /** The real 2026 export shape (see "realistic exports"). */
  realistic: boolean;
  /** Declared file sizes (see "realistic exports"). */
  storageShowcase: boolean;
  /** Phase 1 / phase 2 export times. All content is generated against these, never against the phase. */
  t1: number;
  t2: number;
  exportedAt: number;
}

function resolve(opts: SyntheticExportOptions | undefined): Config {
  if (!opts || typeof opts.now !== "number" || !Number.isFinite(opts.now)) {
    // Programmer error, not user data: core never reads the clock, so `now` cannot default.
    throw new TypeError("synthetic export requires an explicit finite `now` (epoch ms)");
  }
  const count = (v: number | undefined, fallback: number) =>
    v === undefined || !Number.isFinite(v) ? fallback : Math.max(0, Math.floor(v));
  const friendCount = count(opts.friendCount, 120);
  const phase = opts.phase === 1 ? 1 : 2;
  const t2 = sec(opts.now);
  const t1 = t2 - SYNTHETIC_PHASE_GAP_DAYS * DAY_MS;
  return {
    seed: (opts.seed ?? 1) >>> 0,
    phase,
    friendCount,
    chatMessageCount: count(opts.chatMessageCount, friendCount * 25),
    memoryCount: count(opts.memoryCount, 400),
    bundleMedia: opts.bundleMedia === true,
    realistic: opts.realisticMemories === true,
    storageShowcase: opts.storageShowcase === true,
    t1,
    t2,
    exportedAt: phase === 1 ? t1 : t2,
  };
}

// ----------------------------------------------------------------- helpers ---

/** Floor to whole seconds: the export's string timestamps have no sub-second part. */
function sec(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

/** "2023-04-01 12:30:00 UTC", the format recalled for export timestamps. */
function fmt(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function jsonBytes(value: unknown, indent: number): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, indent));
}

/**
 * Independent PRNG stream per purpose/entity. Phase-independent streams are what keep the
 * two phases consistent (same roster, same per-conversation timelines) without sharing
 * mutable generator state.
 */
function stream(seed: number, label: string): () => number {
  return seededRandom((Math.imul(seed, 0x9e3779b1) ^ parseInt(hashString(label), 16)) >>> 0);
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

// ------------------------------------------------------------------ roster ---

type Kind =
  | "active"
  | "dormant"
  | "ghost"
  | "removed"
  | "oneway"
  | "newfriend"
  | "exfriend"
  | "blocked"
  | "ignored"
  | "pending"
  | "suggest"
  | "snapper";

interface Person {
  kind: Kind;
  n: number;
  username: string;
  /** Canary-bearing, or the username itself. undefined => key omitted; "" => present but empty (both occur in real exports). */
  display?: string;
  /** Friendship / request / block time. */
  createdAt: number;
  modifiedAt: number;
  /** removed_N and exfriend_N only. */
  deletedAt?: number;
  source: string;
  /** Stable shuffle key so list order is arbitrary but identical in both phases. */
  order: number;
  /** Relative share of 1:1 chat volume. */
  weight: number;
  /** End of this person's chat history (null => never chatted). */
  chatEnd: number | null;
  /** End of this person's Snap history (null => no Snaps). Used by realistic exports only. */
  snapEnd: number | null;
}

const FIRST_NAMES = [
  "José", "Zoë", "李雷", "Müller", "Aiko", "Søren", "Åsa", "Дмитрий", "Renée", "Chloé", "Nguyễn",
  "Priya", "Omar", "Łukasz", "Siobhán", "Mateo", "Yuki", "Fatima", "Björn", "Emma", "Liam", "Noa",
  "Ana", "Kofi",
];
const EMOJI = ["✨", "🌸", "😎", "🎸", "🐶", "🔥", "🍕", "🌈", "👩‍💻"];
const SOURCES = ["Added by Username", "Added by Quick Add", "Added by Mention", "Added by Phone Number", "Added by Group Chat"];

function scenarioCounts(fc: number, realistic: boolean) {
  // Tiny rosters still get at least one of each scenario so demos are never empty.
  const share = (f: number) => {
    const v = Math.round(fc * f);
    return fc >= 10 ? Math.max(1, v) : v;
  };
  const dormant = Math.min(fc, share(0.2));
  const newfriend = Math.min(fc - dormant, share(0.06));
  // Snap-only friends come out of the active ones, so the number of friends stays fc.
  const snapper = realistic ? Math.min(fc - dormant - newfriend, share(0.06)) : 0;
  return {
    active: fc - dormant - newfriend - snapper,
    dormant,
    newfriend,
    ghost: share(0.08),
    removed: share(0.05),
    oneway: share(0.08),
    exfriend: share(0.05),
    blocked: Math.ceil(fc / 30),
    ignored: Math.ceil(fc / 40),
    pending: Math.ceil(fc / 25),
    suggest: Math.ceil(fc / 20),
    snapper,
  };
}

function buildRoster(cfg: Config): Person[] {
  const rng = stream(cfg.seed, "roster");
  const { t1, t2 } = cfg;
  const out: Person[] = [];
  // A counter (not the rng) picks canaries so each is guaranteed to appear in a big enough roster.
  let seq = 0;

  const make = (kind: Kind, n: number): Person => {
    // Fixed number of draws per person keeps the stream layout simple and stable.
    const c = rng(), f = rng(), e = rng(), ds = rng(), order = rng();
    const src = rng(), w = rng(), u = rng(), u2 = rng(), u3 = rng(), m = rng();
    const base = `${kind}_${n}`;
    const username =
      c < 0.15 ? base.charAt(0).toUpperCase() + base.slice(1) : c < 0.22 ? base.toUpperCase() : base;

    let display: string | undefined;
    if (ds < 0.08) display = undefined;
    else if (ds < 0.13) display = "";
    else if (ds < 0.2) display = username;
    else {
      const first = FIRST_NAMES[Math.floor(f * FIRST_NAMES.length)] ?? "Sam";
      const emoji = EMOJI[Math.floor(e * EMOJI.length)] ?? "";
      const tag = canary(CANARIES.displayNames, seq);
      display = ds < 0.55 ? tag : ds < 0.85 ? `${first} ${tag}` : `${tag} ${emoji}`;
    }

    const days = (lo: number, span: number, r: number) => sec((lo + r * span) * DAY_MS);
    let createdAt: number;
    let deletedAt: number | undefined;
    let chatEnd: number | null = null;
    let snapEnd: number | null = null;
    let weight = 0;
    switch (kind) {
      case "active":
        createdAt = t1 - days(60, 1766, u);
        chatEnd = t2;
        snapEnd = t2;
        weight = 0.2 + w ** 3 * 4; // heavy tail: a few very chatty friends
        break;
      case "dormant":
        createdAt = t1 - days(730, 1460, u);
        // 30% never chatted; the rest stopped well over 12 months before the phase 1 export.
        if (u2 < 0.7) chatEnd = Math.max(createdAt, Math.min(createdAt + days(60, 640, u3), t1 - 380 * DAY_MS));
        weight = 0.05 + w * 0.15;
        break;
      case "ghost":
        createdAt = t1 - days(400, 1000, u);
        chatEnd = t1 - days(45, 255, u2);
        snapEnd = chatEnd;
        weight = 0.2 + w * 0.6;
        break;
      case "removed":
        createdAt = t1 - days(400, 1000, u);
        deletedAt = t1 + days(5, 110, u2); // strictly between the two exports
        chatEnd = deletedAt - days(20, 230, u3);
        snapEnd = chatEnd;
        weight = 0.2 + w * 0.6;
        break;
      case "newfriend":
        createdAt = t1 + days(5, 100, u); // at least 15 days before phase 2
        chatEnd = t2;
        snapEnd = t2;
        weight = 0.3 + w * 0.9;
        break;
      case "snapper":
        // Old friendship, no saved chat ever, Snaps up to each export: not quiet, only invisible to a chat-only reader.
        createdAt = t1 - days(300, 1200, u);
        snapEnd = t2;
        weight = 0.3 + w * 1.2;
        break;
      case "oneway":
        createdAt = t1 - days(200, 900, u);
        break;
      case "exfriend":
        createdAt = t1 - days(40, 1000, u);
        deletedAt = createdAt;
        break;
      default:
        createdAt = t1 - days(30, 1000, u);
    }
    const horizon = kind === "newfriend" ? t2 : t1;
    const modifiedAt = createdAt + sec(Math.max(0, horizon - createdAt) * m);
    const p: Person = {
      kind,
      n,
      username,
      createdAt,
      modifiedAt: sec(modifiedAt),
      source: `${SOURCES[Math.floor(src * SOURCES.length)] ?? SOURCES[0]!} ${canary(CANARIES.sources, seq)}`,
      order,
      weight,
      chatEnd,
      snapEnd,
    };
    if (display !== undefined) p.display = display;
    if (deletedAt !== undefined) p.deletedAt = deletedAt;
    seq++;
    return p;
  };

  const counts = scenarioCounts(cfg.friendCount, cfg.realistic);
  for (const kind of Object.keys(counts) as Kind[]) {
    for (let n = 1; n <= counts[kind]; n++) out.push(make(kind, n));
  }
  return out;
}

// ----------------------------------------------------------------- account ---

function buildAccount(cfg: Config): unknown {
  return {
    "Basic Information": {
      Username: OWNER,
      Name: canary(CANARIES.account, 0),
      Email: canary(CANARIES.account, 1),
      "Mobile Number": canary(CANARIES.account, 2),
      "Creation Date": fmt(cfg.t1 - 2373 * DAY_MS), // ~6.5 years before phase 1, older than every friendship
    },
  };
}

// ----------------------------------------------------------------- friends ---

function buildFriends(cfg: Config, roster: Person[]): unknown {
  const phase1 = cfg.phase === 1;
  const inList = (p: Person, kinds: Kind[]) => kinds.includes(p.kind);
  const section = (kinds: Kind[], entry: (p: Person) => unknown) =>
    roster
      .filter((p) => inList(p, kinds))
      .sort((a, b) => a.order - b.order)
      .map(entry);

  const named = (p: Person): Record<string, unknown> => {
    const e: Record<string, unknown> = { Username: p.username };
    if (p.display !== undefined) e["Display Name"] = p.display;
    return e;
  };
  const full = (p: Person) => ({
    ...named(p),
    "Creation Timestamp": fmt(p.createdAt),
    "Last Modified Timestamp": fmt(p.modifiedAt),
    Source: p.source,
  });
  // Deleted entries carry ONLY the deletion time, under a key that varies with N.
  const deleted = (p: Person) => {
    const key = ["Creation Timestamp", "Last Modified Timestamp", "Date"][p.n % 3] as string;
    return { ...named(p), [key]: fmt(p.deletedAt ?? p.createdAt) };
  };
  const bare = (p: Person) => ({ ...named(p), "Creation Timestamp": fmt(p.createdAt) });

  return {
    Friends: section(phase1 ? ["active", "dormant", "snapper", "ghost", "removed"] : ["active", "dormant", "snapper", "newfriend"], full),
    "Friend Requests Sent": section(["oneway"], full),
    "Blocked Users": section(["blocked"], bare),
    "Deleted Friends": section(phase1 ? ["exfriend"] : ["exfriend", "removed"], deleted),
    "Ignored Snapchatters": section(["ignored"], bare),
    "Pending Requests": section(["pending"], bare),
    "Hidden Friend Suggestions": section(["suggest"], named),
  };
}

// ------------------------------------------------------------------- chats ---

interface Forced {
  lo: number;
  hi: number;
  count: number;
}

interface ChatPlan {
  /** Conversation key. */
  conv: string;
  /** Non-null for group chats. */
  title: string | null;
  /** Group members (usernames); empty for 1:1. */
  members: string[];
  start: number;
  end: number;
  n: number;
  forced: Forced[];
}

// Each is prefixed with a group-title canary when used, so a title is never innocuous.
const GROUP_TITLES = [
  "Weekend Crew 🏕️",
  "Fam Group 👨‍👩‍👧",
  "Study Squad 📚",
  "Game Night 🎮",
  "Roomies",
  "Trip to Lisboa ✈️",
];

const PHRASES = [
  "hey!", "lol 😂", "see you at 7", "pizza on friday?", "movie night?", "happy birthday!! 🎉",
  "omg no way", "on my way", "Müssen wir reden?", "ありがとう！", "gracias 🙏", "call me later",
  "did you see the concert tickets?", "haha yes", "can't tonight, sorry", "good morning ☀️",
  "send me the photo", "that was so funny", "where are you?", "ok sounds good", "bring snacks 🍿",
  "what time is the game", "miss you!", "😭😭😭", "lunch tomorrow?", "я скоро буду", "see you soon",
];

const BURST_MS = 2 * 60 * 60 * 1000;

/** Sorted timestamps: `forced` windows get guaranteed messages, the rest arrive in bursts. */
function genTimes(rng: () => number, start: number, end: number, n: number, forced: Forced[]): number[] {
  const out: number[] = [];
  let free = n;
  for (const f of forced) {
    const lo = Math.max(f.lo, start);
    const hi = Math.min(f.hi, end);
    for (let i = 0; i < f.count && free > 0; i++, free--) out.push(sec(lo + rng() * Math.max(0, hi - lo)));
  }
  while (free > 0) {
    const len = Math.min(free, 1 + Math.floor(rng() * 8));
    // ^0.6 skews bursts toward the recent end: real histories are denser lately.
    let t = start + rng() ** 0.6 * Math.max(0, end - start - BURST_MS);
    for (let i = 0; i < len; i++) {
      out.push(sec(Math.min(t, end)));
      t += (20 + rng() * 880) * 1000;
    }
    free -= len;
  }
  return out.sort((a, b) => a - b);
}

/**
 * Group chats of `total` messages (members are always active_N so group traffic never masks a
 * scenario). `label` names the PRNG stream, so chats and Snaps get different groups.
 */
function planGroups(cfg: Config, actives: Person[], total: number, label: string): ChatPlan[] {
  const { t1, t2 } = cfg;
  const plans: ChatPlan[] = [];
  const groupN = actives.length >= 4 ? Math.round(total * 0.15) : 0;
  const groupCount = Math.min(GROUP_TITLES.length, Math.floor(actives.length / 4), Math.floor(groupN / 8));
  const grng = stream(cfg.seed, label);
  for (let g = 0; g < groupCount; g++) {
    const size = Math.min(actives.length, 3 + Math.floor(grng() * 3));
    const chosen = new Set<Person>();
    while (chosen.size < size) chosen.add(pick(grng, actives));
    const members = [...chosen];
    const earliest = Math.max(...members.map((m) => m.createdAt));
    // Keep the group alive at both export times (phase 1 needs start <= t1 - 10 days).
    const start = Math.min(Math.max(earliest, t2 - sec((365 + grng() * 730) * DAY_MS)), t1 - 20 * DAY_MS);
    const title = `${canary(CANARIES.groupTitles, g)} ${GROUP_TITLES[g] as string}`;
    plans.push({
      conv: title,
      title,
      members: members.map((m) => m.username),
      start,
      end: t2,
      n: Math.floor(groupN / groupCount) + (g < groupN % groupCount ? 1 : 0),
      forced: [
        { lo: t1 - 10 * DAY_MS, hi: t1, count: 1 },
        { lo: t2 - 10 * DAY_MS, hi: t2, count: 1 },
      ],
    });
  }
  return plans;
}

/** Hand `extra` more messages to the plans in proportion to their weights; the rounding remainder goes one each, in order. */
function spreadMessages(plans: ChatPlan[], weights: number[], extra: number): void {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  let given = 0;
  plans.forEach((p, i) => {
    const share = Math.floor((extra * (weights[i] as number)) / weightSum);
    p.n += share;
    given += share;
  });
  for (let i = 0; given < extra && plans.length > 0; i = (i + 1) % plans.length, given++) {
    (plans[i] as ChatPlan).n++;
  }
}

function planChats(cfg: Config, roster: Person[]): ChatPlan[] {
  const { t1, t2, chatMessageCount } = cfg;
  const byOrder = [...roster].sort((a, b) => a.order - b.order);
  const plans = planGroups(cfg, byOrder.filter((p) => p.kind === "active"), chatMessageCount, "groups");

  // ---- 1:1 chats. Minimums guarantee "chatted recently" for active_N / newfriend_N.
  const oneToOne: ChatPlan[] = [];
  const weights: number[] = [];
  for (const p of byOrder) {
    if (p.chatEnd === null) continue;
    const forced: Forced[] = [];
    if (p.kind === "active") forced.push({ lo: t1 - 10 * DAY_MS, hi: t1, count: 3 });
    if (p.kind === "active" || p.kind === "newfriend") {
      forced.push({ lo: t2 - 10 * DAY_MS, hi: t2, count: p.kind === "active" ? 3 : 2 });
    }
    oneToOne.push({
      conv: p.username,
      title: null,
      members: [],
      start: p.createdAt,
      end: p.chatEnd,
      n: forced.reduce((s, f) => s + f.count, 0),
      forced,
    });
    weights.push(p.weight);
  }
  const groupTotal = plans.reduce((s, p) => s + p.n, 0);
  const minimum = oneToOne.reduce((s, p) => s + p.n, 0);
  spreadMessages(oneToOne, weights, Math.max(0, chatMessageCount - groupTotal - minimum));
  return [...oneToOne, ...plans];
}

function buildChats(cfg: Config, roster: Person[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const plan of planChats(cfg, roster)) {
    const rng = stream(cfg.seed, `conv:${plan.conv}`);
    const times = genTimes(rng, plan.start, plan.end, plan.n, plan.forced);
    const messages: unknown[] = [];
    let mine = rng() < 0.5;
    for (const ts of times) {
      // Phase 1 is a prefix of the same timeline: draw everything BEFORE the phase filter
      // so both phases consume the generator identically.
      const r = rng();
      const text = `${pick(rng, CANARIES.messageText)} ${pick(rng, PHRASES)}`;
      const speaker = plan.title === null ? plan.conv : pick(rng, plan.members);
      const ownerInGroup = rng() < 0.3;
      mine = rng() < 0.35 ? mine : !mine; // conversations alternate more often than not
      if (ts > cfg.exportedAt) continue;
      const mediaType = r < 0.72 ? "TEXT" : r < 0.88 ? "MEDIA" : r < 0.94 ? "NOTE" : "STICKER";
      const isSender = plan.title === null ? mine : ownerInGroup;
      messages.push({
        From: isSender ? OWNER : speaker,
        "Media Type": mediaType,
        Created: fmt(ts),
        Content: mediaType === "TEXT" ? text : mediaType === "STICKER" ? "" : null,
        "Conversation Title": plan.title,
        IsSender: isSender,
        "Created(microseconds)": ts * 1000,
      });
    }
    if (messages.length > 0) out[plan.conv] = messages;
  }
  return out;
}

// ------------------------------------------------------------------- snaps ---

/** Snaps per saved chat message: Snaps are most of what people do. */
const SNAPS_PER_CHAT = 3;

function planSnaps(cfg: Config, roster: Person[]): ChatPlan[] {
  const { t1, t2 } = cfg;
  const total = cfg.chatMessageCount * SNAPS_PER_CHAT;
  const byOrder = [...roster].sort((a, b) => a.order - b.order);
  const groups = planGroups(cfg, byOrder.filter((p) => p.kind === "active"), total, "snap-groups");

  const people: ChatPlan[] = [];
  const weights: number[] = [];
  for (const p of byOrder) {
    if (p.snapEnd === null) continue;
    const forced: Forced[] = [];
    // Minimums guarantee "Snapped recently" at both export times, which is what protects a Snap-only friend.
    if (p.kind === "active") forced.push({ lo: t1 - 10 * DAY_MS, hi: t1, count: 2 });
    if (p.kind === "snapper") forced.push({ lo: t1 - 10 * DAY_MS, hi: t1, count: 3 });
    if (p.kind === "active" || p.kind === "newfriend" || p.kind === "snapper") {
      forced.push({ lo: t2 - 10 * DAY_MS, hi: t2, count: p.kind === "snapper" ? 4 : 2 });
    }
    people.push({ conv: p.username, title: null, members: [], start: p.createdAt, end: p.snapEnd, n: forced.reduce((s, x) => s + x.count, 0), forced });
    weights.push(p.weight);
  }
  const groupTotal = groups.reduce((s, p) => s + p.n, 0);
  const minimum = people.reduce((s, p) => s + p.n, 0);
  spreadMessages(people, weights, Math.max(0, total - groupTotal - minimum));

  // People who only ever appear in the Snap history: they are not (or no longer) on the friends list.
  const rng = stream(cfg.seed, "contacts");
  const contacts: ChatPlan[] = [];
  for (let n = 1; n <= Math.round(cfg.friendCount * 1.2); n++) {
    const start = t1 - sec((200 + rng() * 1300) * DAY_MS);
    const end = Math.min(t1 - 20 * DAY_MS, start + sec((30 + rng() * 370) * DAY_MS));
    contacts.push({ conv: `contact_${n}`, title: null, members: [], start, end, n: 2 + Math.floor(rng() * 10), forced: [] });
  }
  return [...people, ...groups, ...contacts];
}

/** json/snap_history.json: the same layout as the chat history, without any message text. */
function buildSnaps(cfg: Config, roster: Person[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const plan of planSnaps(cfg, roster)) {
    const rng = stream(cfg.seed, `snap:${plan.conv}`);
    const times = genTimes(rng, plan.start, plan.end, plan.n, plan.forced);
    const snaps: unknown[] = [];
    let mine = rng() < 0.5;
    for (const ts of times) {
      // Everything is drawn before the phase filter, so phase 1 is a prefix of the same timeline.
      const r = rng();
      const speaker = plan.title === null ? plan.conv : pick(rng, plan.members);
      const ownerInGroup = rng() < 0.3;
      mine = rng() < 0.45 ? mine : !mine;
      if (ts > cfg.exportedAt) continue;
      const isSender = plan.title === null ? mine : ownerInGroup;
      snaps.push({
        From: isSender ? OWNER : speaker,
        "Media Type": r < 0.78 ? "IMAGE" : "VIDEO",
        Created: fmt(ts),
        "Conversation Title": plan.title,
        IsSender: isSender,
        "Created(microseconds)": ts * 1000,
      });
    }
    if (snaps.length > 0) out[plan.conv] = snaps;
  }
  return out;
}

// ---------------------------------------------------------------- memories ---

interface MemoryEntry {
  json: Record<string, unknown>;
  capture: number;
  mid: string;
  /** "Image" | "Video" | other (unknown). */
  type: string;
  dateValid: boolean;
}

const BAD_DATES = ["", "unknown", "2023-13-45 99:99:99 UTC", "0000-00-00 00:00:00 UTC", "1970-01-01 00:00:00 UTC"];

function buildMemories(cfg: Config): MemoryEntry[] {
  const rng = stream(cfg.seed, "memories");
  const dupCount = Math.floor(cfg.memoryCount * 0.04);
  const unique = cfg.memoryCount - dupCount;
  const FOUR_YEARS = 4 * 365 * DAY_MS;

  const items: MemoryEntry[] = [];
  let located = 0;
  let captioned = 0;
  for (let i = 0; i < unique; i++) {
    const t = rng(), ty = rng(), g = rng(), d = rng(), cap = rng(), links = rng();
    // ^1.3 skews captures toward the recent end.
    const capture = sec(cfg.t2 - FOUR_YEARS * t ** 1.3);
    const type = ty < 0.02 ? "Other" : ty < 0.27 ? "Video" : "Image";
    const mid = hashString(`${cfg.seed}:mem:${i}:a`) + hashString(`${cfg.seed}:mem:${i}:b`);
    const dateValid = d >= 0.04;
    const json: Record<string, unknown> = {
      Date: dateValid ? fmt(capture) : (BAD_DATES[Math.floor(d * 125)] ?? ""),
      "Media Type": type,
    };
    if (g < 0.7) {
      json.Location = `Latitude, Longitude: ${canary(CANARIES.locations, located++)}`;
    } else if (g < 0.85) {
      json.Location = "Latitude, Longitude: 0.0, 0.0";
    } // else: no Location key at all
    if (cap < 0.2) json.Caption = canary(CANARIES.captions, captioned++);
    json["Download Link"] = `${DEMO_ORIGIN}/dmd/memories?uid=demo&mid=${mid}&ts=${capture}`;
    if (links >= 0.1) json["Media Download Url"] = `${DEMO_ORIGIN}/media/${mid}`;
    items.push({ json, capture, mid, type, dateValid });
  }
  // Snapchat lists newest first.
  items.sort((a, b) => b.capture - a.capture);

  // Exact duplicates (same URL) sit right after their original.
  const dupsAfter = new Map<number, number>();
  for (let k = 0; k < dupCount && unique > 0; k++) {
    const idx = Math.floor(rng() * unique);
    dupsAfter.set(idx, (dupsAfter.get(idx) ?? 0) + 1);
  }
  const all: MemoryEntry[] = [];
  items.forEach((m, i) => {
    all.push(m);
    for (let k = dupsAfter.get(i) ?? 0; k > 0; k--) all.push({ ...m, json: { ...m.json } });
  });
  return all.filter((m) => m.capture <= cfg.exportedAt);
}

// ------------------------------------------------------------- media files ---

const ascii = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/**
 * 8x8 mid-grey baseline JPEG (about 250 bytes): JFIF header, a COM segment carrying
 * `tag` (makes every file distinct), all-ones quant table and 1-code Huffman tables so the
 * entropy-coded scan is a single byte. No EXIF, like Snapchat's stripped exports.
 */
function minimalJpeg(tag: string): Uint8Array {
  const com = ascii(tag);
  const comLen = com.length + 2;
  const zeros15 = new Array<number>(15).fill(0);
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, ...ascii("JFIF"), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xfe, comLen >> 8, comLen & 255, ...com,
    0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array<number>(64).fill(1),
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xc4, 0x00, 0x14, 0x00, 1, ...zeros15, 0x00, // DC table: category 0 -> code "0"
    0xff, 0xc4, 0x00, 0x14, 0x10, 1, ...zeros15, 0x00, // AC table: EOB -> code "0"
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x3f, // bits "00" (DC diff 0, AC EOB) padded with ones
    0xff, 0xd9,
  ]);
}

function mp4Box(type: string, ...payload: number[][]): number[] {
  const body = payload.flat();
  return [...u32(8 + body.length), ...ascii(type), ...body];
}

/**
 * Structurally valid, non-playable MP4 skeleton (ftyp, moov/mvhd/trak/tkhd/mdia/mdhd/hdlr,
 * mdat). All creation/modification times are 0, mimicking stripped media so a date
 * patcher has something to fill in.
 */
function minimalMp4(tag: string): Uint8Array {
  const matrix = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
  const mvhd = mp4Box("mvhd", [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(1000), u32(0x10000), [1, 0], [0, 0], new Array<number>(8).fill(0), matrix, new Array<number>(24).fill(0), u32(2));
  const tkhd = mp4Box("tkhd", [0, 0, 0, 3], u32(0), u32(0), u32(1), u32(0), u32(1000), new Array<number>(8).fill(0), [0, 0], [0, 0], [0, 0], [0, 0], matrix, u32(0x20000), u32(0x20000));
  const mdhd = mp4Box("mdhd", [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(1000), [0x55, 0xc4], [0, 0]);
  const hdlr = mp4Box("hdlr", [0, 0, 0, 0], u32(0), ascii("vide"), new Array<number>(12).fill(0), [0]);
  const moov = mp4Box("moov", mvhd, mp4Box("trak", tkhd, mp4Box("mdia", mdhd, hdlr)));
  const ftyp = mp4Box("ftyp", ascii("isom"), u32(512), ascii("isom"), ascii("mp42"));
  return Uint8Array.from([...ftyp, ...moov, ...mp4Box("mdat", ascii(tag))]);
}

function buildMediaFiles(memories: MemoryEntry[]): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const seen = new Set<string>();
  // Per-type quota: the list is newest-first and mostly images, so a plain cap would starve videos.
  const room = { Image: BUNDLED_MEDIA_MAX / 2, Video: BUNDLED_MEDIA_MAX / 2 };
  for (const m of memories) {
    if (room.Image + room.Video === 0) break;
    // Only identifiable media with a real date get a file; duplicates share one file.
    if (!m.dateValid || (m.type !== "Image" && m.type !== "Video") || seen.has(m.mid)) continue;
    if (room[m.type] === 0) continue;
    room[m.type]--;
    seen.add(m.mid);
    const day = fmt(m.capture).slice(0, 10);
    // The mid is in the file name and in the download URL so a matcher can link them.
    if (m.type === "Image") files[`memories/${day}_${m.mid}-main.jpg`] = minimalJpeg(m.mid);
    else files[`memories/${day}_${m.mid}-main.mp4`] = minimalMp4(m.mid);
  }
  return files;
}

// ------------------------------------------------------ realistic memories & parts ---

interface SynthFile {
  data: Uint8Array;
  /** UTC instant (epoch ms) written as the entry's extended timestamp. */
  utc: number;
  /** Size written into the zip directory instead of the real one (see `storageShowcase`). */
  declaredSize?: number;
}

interface SynthPart {
  /** File name of the zip, e.g. "mydata~1783000000000-2.zip". */
  name: string;
  files: Record<string, SynthFile>;
}

interface RealMemory {
  json: Record<string, unknown>;
  capture: number;
  uuid: string;
  type: "Image" | "Video";
  hasFile: boolean;
  hasOverlay: boolean;
  /** Which memories zip holds the file: part 2 or 3. */
  part: 2 | 3;
  /** Size the file declares in the zip directory; set only with `storageShowcase`. */
  declaredSize?: number;
}

/** Declared size ranges in bytes (log-uniform), `storageShowcase` only. */
const SHOWCASE_SIZE: Record<"Image" | "Video", [number, number]> = { Image: [200_000, 4_000_000], Video: [3_000_000, 40_000_000] };

/** 1x1 transparent PNG: a stand-in for a caption overlay. */
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (ch) => ch.charCodeAt(0),
);

const HTML_STUB = new TextEncoder().encode("<html><body><p>Memories</p></body></html>");

/** A UUID (8-4-4-4-12, upper-case hex) derived from the seed and the entry number. */
function uuidFor(seed: number, i: number): string {
  const hex = [1, 2, 3, 4].map((k) => hashString(`${seed}:uuid:${i}:${k}`)).join("").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Memories as the 2026 export has them: every link empty, exact UTC Dates that are all different,
 * Image or Video only. About 70% have a file, about 3% of those an overlay. Newest first.
 */
function buildRealisticMemories(cfg: Config): RealMemory[] {
  const rng = stream(cfg.seed, "memories-real");
  const sizeRng = stream(cfg.seed, "memories-real-size");
  const FOUR_YEARS = 4 * 365 * DAY_MS;
  const used = new Set<number>();
  const items: RealMemory[] = [];
  let located = 0;
  let captioned = 0;
  for (let i = 0; i < cfg.memoryCount; i++) {
    const t = rng(), ty = rng(), g = rng(), cap = rng(), file = rng(), over = rng(), where = rng();
    // ^1.3 skews captures toward the recent end. No two entries share a second, as in the real list.
    let capture = sec(cfg.t2 - FOUR_YEARS * t ** 1.3);
    while (used.has(capture)) capture -= 1000;
    used.add(capture);
    const type = ty < 0.27 ? "Video" : "Image";
    const json: Record<string, unknown> = { Date: fmt(capture), "Media Type": type };
    if (g < 0.7) json.Location = `Latitude, Longitude: ${canary(CANARIES.locations, located++)}`;
    else if (g < 0.85) json.Location = "Latitude, Longitude: 0.0, 0.0";
    if (cap < 0.08) json.Caption = canary(CANARIES.captions, captioned++);
    json["Download Link"] = "";
    json["Media Download URL"] = "";
    const hasFile = file < 0.7;
    const memory: RealMemory = { json, capture, uuid: uuidFor(cfg.seed, i), type, hasFile, hasOverlay: hasFile && over < 0.03, part: where < 0.85 ? 2 : 3 };
    if (cfg.storageShowcase) {
      const [low, high] = SHOWCASE_SIZE[type];
      const u = sizeRng();
      if (hasFile) memory.declaredSize = Math.round(low * (high / low) ** u);
    }
    items.push(memory);
  }
  items.sort((a, b) => b.capture - a.capture);
  return items.filter((m) => m.capture <= cfg.exportedAt);
}

/** The three zips of a realistic export, in order. See "realistic exports" at the top of this file. */
function buildParts(cfg: Config): SynthPart[] {
  const roster = buildRoster(cfg);
  const memories = buildRealisticMemories(cfg);
  const at = cfg.exportedAt;
  const base = `mydata~${at}`;
  const file = (data: Uint8Array, utc = at): SynthFile => ({ data, utc });

  // A few chat and story media files, so the layout has the folders the real parts have.
  const media = (folder: string, part: number, count: number, ext: "jpg" | "mp4"): Record<string, SynthFile> => {
    const out: Record<string, SynthFile> = {};
    for (let i = 0; i < count; i++) {
      const utc = at - (i + 1) * DAY_MS;
      const tag = hashString(`${cfg.seed}:${folder}:${part}:${i}`);
      out[`${folder}/${fmt(utc).slice(0, 10)}_media~${tag}.${ext}`] = file(ext === "jpg" ? minimalJpeg(tag) : minimalMp4(tag), utc);
    }
    return out;
  };

  // Conversation pages are named after the person or the group: they must never be echoed.
  const pages: Record<string, SynthFile> = {};
  const named = roster.filter((p) => p.kind === "active" || p.kind === "snapper").sort((a, b) => a.order - b.order).slice(0, 8);
  for (const p of named) pages[`html/chat_history/subpage_${p.username}.html`] = file(HTML_STUB);
  CANARIES.groupTitles.forEach((title) => (pages[`html/chat_history/subpage_${title}.html`] = file(HTML_STUB)));

  const part1: Record<string, SynthFile> = {
    "index.html": file(HTML_STUB),
    "html/index.html": file(HTML_STUB),
    ...pages,
    "json/account.json": file(jsonBytes(buildAccount(cfg), 2)),
    "json/friends.json": file(jsonBytes(buildFriends(cfg, roster), 2)),
    // Compact: the histories are by far the biggest files and 100k+ entries are expected.
    "json/chat_history.json": file(jsonBytes(buildChats(cfg, roster), 0)),
    "json/snap_history.json": file(jsonBytes(buildSnaps(cfg, roster), 0)),
    "json/memories_history.json": file(jsonBytes({ "Saved Media": memories.map((m) => m.json) }, 2)),
    // Present in real exports and never opened: personal content that must stay out of every output.
    "json/location_history.json": file(
      jsonBytes({ "Location History": CANARIES.locations.map((place, i) => ({ Time: fmt(at - (i + 1) * DAY_MS), "Latitude, Longitude": place })) }, 2),
    ),
    "json/search_history.json": file(jsonBytes({ "Search History": CANARIES.messageText.map((term) => ({ "Search Term": term })) }, 2)),
    ...media("chat_media", 1, 6, "jpg"),
  };

  const memoryPart = (part: 2 | 3): Record<string, SynthFile> => {
    const files: Record<string, SynthFile> = { [`memories/memories_${part}.html`]: file(HTML_STUB) };
    for (const m of memories) {
      if (!m.hasFile || m.part !== part) continue;
      const stem = `memories/${fmt(m.capture).slice(0, 10)}_${m.uuid}`;
      const entry = file(m.type === "Video" ? minimalMp4(m.uuid) : minimalJpeg(m.uuid), m.capture);
      if (m.declaredSize !== undefined) entry.declaredSize = m.declaredSize;
      files[`${stem}-main.${m.type === "Video" ? "mp4" : "jpg"}`] = entry;
      if (m.hasOverlay) files[`${stem}-overlay.png`] = file(PNG_1X1, m.capture);
    }
    return files;
  };

  return [
    { name: `${base}.zip`, files: part1 },
    { name: `${base}-2.zip`, files: { ...memoryPart(2), ...media("chat_media", 2, 4, "jpg"), ...media("shared_story", 2, 3, "mp4") } },
    { name: `${base}-3.zip`, files: memoryPart(3) },
  ];
}
