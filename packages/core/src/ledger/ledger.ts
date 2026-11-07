/**
 * Friend ledger: a time-ordered list of friend-list snapshots plus pure helpers to build,
 * diff and (de)serialise it. No I/O, no clock access.
 *
 * Records keyed by usernames are always built with Object.fromEntries and read with
 * Object.hasOwn: usernames come from user data, and a user may legitimately be called
 * "constructor" or "toString", which a plain `key in obj` lookup would mistake for a hit.
 */
import type { FriendRecord, Ledger, LedgerDiff, ParsedExport, Snapshot } from "../types.ts";
import { hashString, normUser } from "../util.ts";

/** Thrown by deserializeLedger ONLY when the stored ledger has an unsupported version number. */
export class LedgerFormatError extends Error {
  readonly foundVersion: number;

  constructor(foundVersion: number) {
    // No version number in the text: error messages must never echo values read from user data.
    super("Unsupported ledger version; this build reads version 1.");
    this.name = "LedgerFormatError";
    this.foundVersion = foundVersion;
  }
}

export function emptyLedger(): Ledger {
  return { version: 1, snapshots: [] };
}

// --------------------------------------------------------------- snapshots ---

/**
 * Condense a parsed export into a Snapshot. `takenAt` must be known: a snapshot with a
 * guessed timestamp would silently corrupt every diff and "long friendship" calculation.
 */
export function snapshotFromExport(parsed: ParsedExport, opts: { id?: string; takenAt?: number } = {}): Snapshot {
  const takenAt = opts.takenAt ?? parsed.exportedAt;
  if (typeof takenAt !== "number" || !Number.isFinite(takenAt)) {
    throw new Error(
      "snapshotFromExport: the export has no known generation time; pass opts.takenAt (epoch ms).",
    );
  }

  const friendSince = new Map<string, number>();
  const sentAt = new Map<string, number>();
  const deleted = new Map<string, number | null>();

  // Allowlist projection: only the normalised username and the timestamps are read from a
  // record; anything else on it is never touched.
  const keyOf = (rec: FriendRecord): string | undefined => {
    if (typeof rec.username !== "string") return undefined;
    const key = normUser(rec.username);
    return key === "" ? undefined : key;
  };

  const friends = new Set<string>();
  for (const rec of parsed.friends.friends) {
    const key = keyOf(rec);
    if (key === undefined) continue;
    friends.add(key);
    // Duplicate rows: keep the earliest creation time, i.e. when the friendship really began.
    if (rec.createdAt !== undefined) friendSince.set(key, Math.min(friendSince.get(key) ?? Infinity, rec.createdAt));
  }

  const sentRequests = new Set<string>();
  for (const rec of parsed.friends.sentRequests) {
    const key = keyOf(rec);
    if (key === undefined) continue;
    sentRequests.add(key);
    if (rec.createdAt !== undefined) sentAt.set(key, Math.min(sentAt.get(key) ?? Infinity, rec.createdAt));
  }

  for (const rec of parsed.friends.deletedFriends) {
    const key = keyOf(rec);
    if (key === undefined) continue;
    // Duplicate rows: the latest known deletion time wins; an unknown time never erases a known one.
    const prev = deleted.get(key) ?? null;
    const at = rec.deletedAt ?? null;
    deleted.set(key, prev === null ? at : at === null ? prev : Math.max(prev, at));
  }

  const blocked = new Set<string>();
  for (const rec of parsed.friends.blocked) {
    const key = keyOf(rec);
    if (key !== undefined) blocked.add(key);
  }

  const friendList = [...friends];
  return {
    id: opts.id ?? "export-" + hashString(`${takenAt}|${[...friendList].sort().join("\n")}`),
    takenAt,
    source: "export",
    friends: friendList,
    sentRequests: [...sentRequests],
    deleted: Object.fromEntries(deleted),
    friendSince: Object.fromEntries(friendSince),
    sentAt: Object.fromEntries(sentAt),
    ...(blocked.size > 0 ? { blocked: [...blocked] } : {}),
  };
}

/**
 * Return a new ledger containing `snap`. A snapshot with the same id is replaced. Snapshots
 * stay sorted by takenAt (stable: ties keep insertion order). Near-duplicate snapshots are
 * deliberately kept; pruning history is a caller decision.
 */
export function addSnapshot(ledger: Ledger, snap: Snapshot): Ledger {
  const snapshots = ledger.snapshots.filter((s) => s.id !== snap.id);
  snapshots.push(snap);
  snapshots.sort((a, b) => a.takenAt - b.takenAt);
  return { version: 1, snapshots };
}

// -------------------------------------------------------------------- diff ---

/**
 * Compare two snapshots. Output lists are sorted so equal inputs always give equal output.
 *
 * A user deletion is recorded only in the export taken after it, and the export's deleted list
 * ages out old entries. When `prev` and `next` are not adjacent, pass the snapshots taken
 * between them as `between`: their deletions explain disappearances too (findGhosts likewise
 * trusts a deletion recorded in ANY snapshot).
 */
export function diffSnapshots(prev: Snapshot, next: Snapshot, between: Snapshot[] = []): LedgerDiff {
  const prevFriends = new Set(prev.friends);
  const nextFriends = new Set(next.friends);
  const prevSent = new Set(prev.sentRequests);
  const nextSent = new Set(next.sentRequests);
  const userDeleted = (key: string) =>
    Object.hasOwn(next.deleted, key) || between.some((s) => Object.hasOwn(s.deleted, key));

  const disappeared: string[] = [];
  const removedByUser: string[] = [];
  for (const key of prevFriends) {
    if (nextFriends.has(key)) continue;
    (userDeleted(key) ? removedByUser : disappeared).push(key);
  }

  const added = [...nextFriends].filter((key) => !prevFriends.has(key));

  // Sent lists may also echo existing friends; only a transition request -> friend counts.
  const requestsAccepted: string[] = [];
  const requestsVanished: string[] = [];
  for (const key of prevSent) {
    if (prevFriends.has(key)) continue;
    if (nextFriends.has(key)) requestsAccepted.push(key);
    else if (!nextSent.has(key) && !userDeleted(key)) requestsVanished.push(key);
  }

  return {
    from: prev.id,
    to: next.id,
    disappeared: disappeared.sort(),
    removedByUser: removedByUser.sort(),
    added: added.sort(),
    requestsAccepted: requestsAccepted.sort(),
    requestsVanished: requestsVanished.sort(),
  };
}

// ----------------------------------------------------------- serialisation ---

/** Writes only the contract fields, so a caller's extra properties can never reach storage. */
export function serializeLedger(l: Ledger): string {
  const snapshots = l.snapshots.map((s) => ({
    id: s.id,
    takenAt: s.takenAt,
    source: s.source,
    friends: s.friends,
    sentRequests: s.sentRequests,
    deleted: s.deleted,
    friendSince: s.friendSince,
    sentAt: s.sentAt,
    ...(s.blocked !== undefined && s.blocked.length > 0 ? { blocked: s.blocked } : {}),
  }));
  return JSON.stringify({ version: 1, snapshots });
}

/**
 * Parse a stored ledger. Garbage in => empty ledger out, because the caller can always
 * rebuild from a fresh export. The one exception is a numeric version other than 1: that
 * is a real ledger we do not understand, and silently replacing it would destroy history.
 */
export function deserializeLedger(json: string): Ledger {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return emptyLedger();
  }
  if (!isRecord(raw)) return emptyLedger();
  if (typeof raw.version === "number" && raw.version !== 1) throw new LedgerFormatError(raw.version);
  if (raw.version !== 1 || !Array.isArray(raw.snapshots)) return emptyLedger();

  // Keyed by id so a duplicated id behaves like addSnapshot's replacement (last one wins).
  const byId = new Map<string, Snapshot>();
  for (const item of raw.snapshots) {
    const snap = sanitizeSnapshot(item);
    if (snap) byId.set(snap.id, snap);
  }
  const snapshots = [...byId.values()].sort((a, b) => a.takenAt - b.takenAt);
  return { version: 1, snapshots };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function cleanKeyList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") continue;
    const key = normUser(item);
    if (key !== "") out.add(key);
  }
  return [...out];
}

/** Rebuild a record from untrusted JSON, keeping only entries whose value passes `pick`. */
function cleanRecord<T>(v: unknown, pick: (value: unknown) => T | undefined): Record<string, T> {
  if (!isRecord(v)) return {};
  const entries: [string, T][] = [];
  for (const [k, value] of Object.entries(v)) {
    const key = normUser(k);
    const picked = pick(value);
    if (key !== "" && picked !== undefined) entries.push([key, picked]);
  }
  return Object.fromEntries(entries);
}

/**
 * Validate one stored snapshot; undefined means "drop it". `friends`, `sentRequests` and
 * `deleted` are mandatory: losing `deleted` would make user-removed friends look like
 * ghosts, so a snapshot without it is discarded rather than patched up. The timing maps
 * are auxiliary and default to empty. Unknown fields (e.g. names written by an old build) are dropped.
 */
function sanitizeSnapshot(item: unknown): Snapshot | undefined {
  if (!isRecord(item)) return undefined;
  if (typeof item.id !== "string" || item.id === "" || !finiteNumber(item.takenAt)) return undefined;
  if (item.source !== "export" && item.source !== "ui-scan") return undefined;
  const friends = cleanKeyList(item.friends);
  const sentRequests = cleanKeyList(item.sentRequests);
  if (!friends || !sentRequests || !isRecord(item.deleted)) return undefined;

  const blocked = cleanKeyList(item.blocked) ?? [];
  return {
    id: item.id,
    takenAt: item.takenAt,
    source: item.source,
    friends,
    sentRequests,
    // A garbled deletion time still records that the USER removed the friend (the safe reading).
    deleted: cleanRecord<number | null>(item.deleted, (v) => (finiteNumber(v) ? v : null)),
    friendSince: cleanRecord(item.friendSince, (v) => (finiteNumber(v) ? v : undefined)),
    sentAt: cleanRecord(item.sentAt, (v) => (finiteNumber(v) ? v : undefined)),
    ...(blocked.length > 0 ? { blocked } : {}),
  };
}
