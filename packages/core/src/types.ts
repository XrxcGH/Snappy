/**
 * Shared data contract for @snappy-export/core. Every module depends ONLY on this file
 * (plus fflate for zip handling). Do not change shapes here without updating all
 * consumers; add optional fields instead of renaming.
 *
 * ============================== PRIVACY CONTRACT ==============================
 * Snappy is CONTENT-BLIND by construction. Its only purpose is to speed up the
 * user's own in-app chores; it must never view or reveal anything personal.
 *
 *  1. NEVER READ CONTENT. Message text, media pixels, captions, locations/GPS,
 *     display names, bios, emails, phone numbers, purchase/support/AI data are
 *     never read into any Snappy data structure. Parsers use ALLOWLIST projection:
 *     a field that is not explicitly listed below is dropped at the parse boundary.
 *  2. MINIMUM IDENTIFIERS. The only person-identifying value Snappy keeps is a
 *     normalised friend USERNAME, because acting on "who" needs a handle. Group
 *     chat titles are replaced by an opaque hash. Display names are never kept.
 *  3. METADATA ONLY. Chat data is reduced to {who (username/group-hash), direction,
 *     kind, time}. Media is treated as opaque bytes: never decoded, never hashed
 *     for content matching; only file structure (headers/boxes) is touched to set
 *     the capture DATE. Existing EXIF/GPS is never read (the one exception: the
 *     Orientation tag, a rendering flag, may be carried over).
 *  4. NOTHING LEAVES THE DEVICE. No network I/O, no telemetry, no analytics, no
 *     crash reporting in core. No filesystem I/O in core either.
 *  5. NO ECHO. ExportIssue messages, errors and logs must NEVER contain user-data
 *     values (usernames, text, URLs, coordinates). Describe by field name, count
 *     or code only.
 *  6. PROTECTED AT REST. Persisted ledgers contain usernames; they must be
 *     sealable with a passphrase (see ledger/seal.ts).
 *
 * Automated tests enforce these rules with canary strings (see test/privacy/).
 * ==============================================================================
 *
 * Conventions
 *  - All timestamps are epoch MILLISECONDS (number). Unknown => undefined / null as stated.
 *  - Usernames are compared case-insensitively: always run them through `normUser()`
 *    (see util.ts) and store ONLY the normalised form.
 *
 * IMPORTANT: Snapchat does not publish the layout of its "Download My Data" export and may
 * change it. Parsers must be tolerant and must report surprises through `issues` rather
 * than throwing.
 */

// Type-only: the shape of a bundled Memories media file lives with the pairing code that fills it.
import type { MemoryMediaFile } from "./memories/pair.ts";

// ---------------------------------------------------------------- friends ---

export interface FriendRecord {
  /** Normalised username (the ONLY identifier kept). */
  username: string;
  /** When the friendship/request was created, if present in the export. */
  createdAt?: number;
  /** Last modified timestamp, if present. */
  modifiedAt?: number;
}

export interface DeletedFriendRecord extends FriendRecord {
  /** When the user deleted this friend (the export's date-deleted value). */
  deletedAt?: number;
}

export interface ParsedFriends {
  /** Current friends. */
  friends: FriendRecord[];
  /** Outgoing friend requests the user sent (may be empty if the export lacks them). */
  sentRequests: FriendRecord[];
  /** Incoming/pending requests (direction not guaranteed; see issues). */
  pendingRequests: FriendRecord[];
  /** Friends the USER removed. Used to explain disappearances (not "unadded me"). */
  deletedFriends: DeletedFriendRecord[];
  blocked: FriendRecord[];
  ignored: FriendRecord[];
  hiddenSuggestions: FriendRecord[];
}

// ------------------------------------------------------------------ chats ---

/**
 * One chat event reduced to metadata. There is deliberately NO field for message
 * text, captions, media references, sender display names or titles.
 */
export interface ChatEvent {
  /** Normalised username for 1:1 chats; "group:<hash>" for group chats (title is never kept). */
  conversation: string;
  isGroup: boolean;
  /** Whether the account owner sent it or received it; "unknown" when the export has no usable IsSender flag (it still proves activity). */
  direction: "sent" | "received" | "unknown";
  /**
   * e.g. "TEXT", "MEDIA", "NOTE", "STICKER" for a saved chat, "IMAGE" or "VIDEO" for a Snap
   * (upper-cased, as exported) - a category only. A Snap is an event like any other, so it counts
   * as activity with that friend.
   */
  kind: string;
  at: number;
}

// --------------------------------------------------------------- memories ---

export type MemoryMediaType = "image" | "video" | "unknown";

/** Memory metadata. Place/GPS data is intentionally NOT represented. */
export interface MemoryItem {
  /** Stable id, unique within the export (derive from index/URL/path hash). */
  id: string;
  /** Capture date; null if absent or unparseable. */
  date: number | null;
  mediaType: MemoryMediaType;
  /**
   * Snapchat download link from memories_history.json, if any. Treated as an opaque
   * token: used only by the CLI downloader, never logged, printed or serialised
   * into reports.
   */
  downloadUrl?: string;
  /**
   * Path inside the export zip when the media file is bundled, if any. Opaque like downloadUrl:
   * needed to extract the file, never printed or put into an issue or a report.
   */
  zipPath?: string;
  /** 1-based number of the zip part holding zipPath (parts are ordered: base name, then -2, -3). */
  partIndex?: number;
  /** Caption/sticker overlay files of this memory (handled as opaquely as zipPath). */
  overlayPaths?: string[];
  /**
   * The zip part of each overlayPaths entry, only when any of them is not the part of zipPath (a
   * split into parts can fall between a main file and its overlay). Absent means all in zipPath's part.
   */
  overlayParts?: number[];
  /** Known size in bytes, if any. */
  sizeBytes?: number;
}

// ------------------------------------------------------------ export bundle ---

export type ExportIssueSeverity = "info" | "warning" | "error";

export interface ExportIssue {
  severity: ExportIssueSeverity;
  /** Stable machine code, e.g. "friends-empty-but-deleted". */
  code: string;
  /** Human text. MUST NOT contain user-data values (usernames, text, URLs, coordinates). */
  message: string;
  /**
   * An error the person may choose to go on with anyway (the front end then asks validateExport
   * again with the matching option, which turns it into a warning). Absent on every other issue.
   */
  overridable?: boolean;
}

/**
 * How the Memories list was paired with the media files bundled in the export. Counts and the
 * method only: nothing here can identify a file or an entry.
 */
export interface MemoriesPairing {
  items: number;
  mainFiles: number;
  paired: number;
  unmatchedItems: number;
  unmatchedFiles: number;
  overlays: number;
  ambiguous: number;
  method: "utc-time" | "offset-time" | "date-type" | "none";
  /** The zipper's clock offset from UTC that was detected (0 unless method is "offset-time"). */
  offsetHours: number;
  /** Further offsets the clock had (daylight saving time); present only when there were any. */
  extraOffsetHours?: number[];
}

export interface ParsedExport {
  friends: ParsedFriends;
  /**
   * Metadata-only activity events: saved chats AND Snaps (empty when neither file was exported).
   * A Snap's kind is its media type ("IMAGE", "VIDEO"); a chat keeps its own kind ("TEXT", ...).
   */
  chats: ChatEvent[];
  memories: MemoryItem[];
  /**
   * Memories media files seen in the zip directories (names, times and sizes only; never opened).
   * Paths are opaque handles for extraction: never print them or put them in an issue or report.
   * Sorted by part, then path. Absent when the export bundles none.
   */
  bundledMedia?: MemoryMediaFile[];
  /** How memories were paired with bundledMedia; present only when both exist. */
  memoriesPairing?: MemoriesPairing;
  /** Best guess of when the export was generated (zip/file metadata), if known. */
  exportedAt?: number;
  /** File names found in the export (for diagnostics; system file names only). */
  fileList: string[];
  /** Non-fatal parse notes and schema surprises. */
  issues: ExportIssue[];
}

// ----------------------------------------------------------------- ledger ---

export type SnapshotSource = "export" | "ui-scan";

/** Compact, serialisable record of the friend list at a point in time. */
export interface Snapshot {
  id: string;
  /** When the snapshot's data was true (export generation time, or scan time). */
  takenAt: number;
  source: SnapshotSource;
  /** Normalised usernames of current friends. */
  friends: string[];
  /** Normalised usernames of outgoing requests. */
  sentRequests: string[];
  /** Normalised username -> deletedAt ms (or null if unknown): friends the USER removed. */
  deleted: Record<string, number | null>;
  /** Normalised username -> createdAt ms of the friendship, when known. */
  friendSince: Record<string, number | undefined>;
  /** Normalised username -> send time of the outgoing request, when known. */
  sentAt: Record<string, number | undefined>;
  /**
   * Normalised usernames the USER blocked. Optional and omitted when empty (older ledgers lack
   * it): a blocked friend leaves the friends list for a reason that is not "they unadded you".
   */
  blocked?: string[];
}

export interface Ledger {
  version: 1;
  snapshots: Snapshot[];
}

export interface LedgerDiff {
  from: string; // snapshot id
  to: string; // snapshot id
  /** In `from`, absent from `to`, and NOT explained by a user deletion. */
  disappeared: string[];
  /** Absent from `to` and listed as deleted by the user (explained). */
  removedByUser: string[];
  /** New friends in `to`. */
  added: string[];
  /** Sent requests in `from` that became friends in `to`. */
  requestsAccepted: string[];
  /** Sent requests in `from` that vanished without becoming friends and without user action. */
  requestsVanished: string[];
}

// -------------------------------------------------------------- candidates ---

export type CandidateCategory = "ghost" | "one-way" | "dormant";
export type Confidence = "low" | "medium" | "high";

export interface Evidence {
  /** Machine-readable signal id, e.g. "absent-from-latest-export". */
  signal: string;
  /** Human-readable explanation shown in the UI. Must not echo user-data values. */
  detail: string;
  /** Contribution to the score, 0..1. */
  weight: number;
  /** Optional timestamp the evidence refers to. */
  at?: number;
}

export interface Candidate {
  /** Normalised username (key and display value - display names are never kept). */
  key: string;
  category: CandidateCategory;
  confidence: Confidence;
  /** 0..1 */
  score: number;
  evidence: Evidence[];
  /** Reasons this candidate is protected from removal (empty => removable). */
  protectedBy: string[];
}

export interface CleanupQueueOptions {
  /** Epoch ms "now" (injected for determinism). */
  now: number;
  /** Normalised usernames the user wants never removed. */
  allowlist?: string[];
  /** Messaged within this many days => protected. Default 30. */
  recentMessageDays?: number;
  /**
   * When the export was generated. "Recent" is then measured back from the earlier of this and
   * `now`, the same reference the quiet-friends check uses, so an old export keeps protecting the
   * people it shows you chatted with just before it was made. Default: `now`.
   */
  exportedAt?: number;
  /** Candidates below this confidence are dropped from the queue. Default "low". */
  minConfidence?: Confidence;
}

export interface CleanupQueue {
  generatedAt: number;
  /** Removable candidates, highest score first. */
  items: Candidate[];
  /** Candidates excluded by protection rules (kept for transparency). */
  protectedItems: Candidate[];
  summary: {
    total: number;
    byCategory: Record<CandidateCategory, number>;
    byConfidence: Record<Confidence, number>;
    protectedCount: number;
  };
}

// --------------------------------------------------------------- memories ---

export interface MemoriesPlanOptions {
  /** Output folder layout; default "year-month" => "2023/2023-04/". */
  layout?: "flat" | "year" | "year-month";
  /** Cap used for the storage meter, in bytes. Default 5 GiB (unverified policy value). */
  capBytes?: number;
}

export interface PlannedMemory {
  item: MemoryItem;
  /** Relative output path, forward slashes, unique across the plan. */
  relativePath: string;
  /** Set when this item was identified as a duplicate (by metadata only) of `duplicateOf`. */
  duplicateOf?: string;
}

export interface StorageMeter {
  knownBytes: number;
  /** Items whose size is unknown (so the total is a lower bound). */
  unknownSizeCount: number;
  capBytes: number;
  /** 0..1+, based on known bytes only. */
  fractionOfCap: number;
  /** Projected ms when the cap is reached at the recent growth rate; null if not projectable. */
  projectedCapAt: number | null;
  /** Bytes per day over the lookback window, or null if not computable. */
  growthBytesPerDay: number | null;
}

export interface MemoriesPlan {
  entries: PlannedMemory[];
  duplicates: PlannedMemory[];
  meter: StorageMeter;
  counts: { total: number; images: number; videos: number; unknown: number; withDate: number };
}
