import type { ChatEvent, ExportIssue } from "../types.ts";
import { hashString, normUser, toMs } from "../util.ts";
import { asBool, asText, compileAllow, entries, isRecord, issue, normKey, readAllowed } from "./json-util.ts";

/**
 * The two per-conversation history files. chat_history.json holds saved chats; snap_history.json
 * holds Snaps (photos and videos) and has the same layout without any message text. Both become
 * the same metadata-only ChatEvent, so everything that counts activity sees Snaps too.
 */
export type HistoryFile = "chat" | "snap";

const FILE_NAME: Record<HistoryFile, string> = { chat: "chat_history.json", snap: "snap_history.json" };
const NOUN: Record<HistoryFile, string> = { chat: "message", snap: "Snap" };

/**
 * ALLOWLIST of entry fields. Message text and every other key are absent on purpose: they are
 * never read. "title" is read ONLY as a group signal (and hashed when there is no conversation
 * key); its value is never stored.
 */
const ENTRY_ALLOW = compileAllow({
  isSender: ["issender"],
  from: ["from", "sender", "username"],
  // Who a sent entry went to: read only in a flat list (a bare list or a "Sent ..." section), where it names the conversation.
  to: ["to"],
  mediaType: ["mediatype", "type"],
  // Microseconds is the most precise and avoids timezone-less strings, so it gets its own field and wins.
  createdUs: ["createdmicroseconds"],
  created: ["created", "createdat", "timestamp", "date"],
  title: ["conversationtitle", "title", "groupname"],
});

/** Spellings of one field name: words joined by space, underscore, dash or nothing (any case). */
export function spellings(words: string[][], literal: string[] = []): string[] {
  const out = new Set<string>(literal.map((s) => s.toLowerCase()));
  for (const w of words) for (const sep of [" ", "_", "-", ""]) out.add(w.join(sep));
  return [...out];
}

/**
 * The field names the streaming reader keeps (it matches them ignoring ASCII case only, while the
 * allowlist above also ignores punctuation). They are the same fields as ENTRY_ALLOW, and message
 * text is not among them, so it is skipped without being decoded.
 */
export const HISTORY_KEEP_FIELDS: readonly string[] = [
  ...spellings([["is", "sender"]]),
  ...spellings([["from"], ["sender"], ["username"]]),
  ...spellings([["to"]]),
  ...spellings([["media", "type"], ["type"]]),
  ...spellings([["created", "microseconds"]], ["Created(microseconds)", "Created (microseconds)"]),
  ...spellings([["created"], ["created", "at"], ["timestamp"], ["date"]]),
  ...spellings([["conversation", "title"], ["title"], ["group", "name"]]),
];

/**
 * Top-level sections that are flat message lists rather than per-conversation containers, matched
 * on the normalised key and anchored: a friend called "savedchat_fan" is a username, not a section.
 */
const FLAT_SECTION = /^(?:(?:received|sent)?savedchat(?:history)?|(?:received|sent)?snaphistory|chathistory(?:all)?)\d*$/;

/** "Received ..." and "Sent ..." sections say the direction of every entry in them. */
function sectionDirection(normalisedKey: string): "sent" | "received" | undefined {
  return normalisedKey.startsWith("sent") ? "sent" : normalisedKey.startsWith("received") ? "received" : undefined;
}

/**
 * Could this container key be a Snapchat username (letters, digits, "_", "-", "."; 3 to 15
 * characters)? Group titles usually contain spaces or are longer, and a key that cannot be a
 * username must never be filed as one: it would put the raw title into ChatEvent.conversation.
 */
const looksLikeUsername = (key: string): boolean => /^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,14}$/u.test(key);

/** "Media Type" is a category label; anything that does not look like one is not trusted (it might be content). */
function kindOf(v: unknown): string {
  const t = asText(v);
  if (t === undefined || !/^[A-Za-z][A-Za-z0-9_ ]{0,23}$/.test(t)) return "UNKNOWN";
  return t.toUpperCase().replace(/ /g, "_");
}

interface Row {
  at: number;
  kind: string;
  /** undefined when the entry has no usable IsSender flag. */
  sent: boolean | undefined;
}

const directionOf = (sent: boolean | undefined): ChatEvent["direction"] => (sent === undefined ? "unknown" : sent ? "sent" : "received");

const groupId = (rawKey: string): string => `group:${hashString(rawKey)}`;

/** More than this share of the conversations filed as groups is not what a real export looks like. */
const GROUPS_WARN_SHARE = 0.5;
/** More than this share of the messages that could not be matched to a conversation is too many to ignore. */
const UNMATCHED_WARN_SHARE = 0.2;
/** Below this many conversations or messages a share means little, so the quieter note stays. */
const WARN_MIN_COUNT = 10;

/**
 * Turns the entries of one history file into metadata-only events, one entry at a time, so the
 * same logic serves a parsed JSON value and the streaming reader (which never holds the whole file).
 * Entries of one conversation must arrive together. Never throws.
 *
 * Direction comes from IsSender only. Guessing it from sender names would be
 * unreliable, and a wrong guess could make a friend look one-way, so an entry without the flag
 * keeps the direction "unknown" instead. It is still proof of activity with that conversation
 * (the quiet-friends check and the recent-message protection only need who and when), so it must
 * not be dropped: a Snap-only friend would otherwise look silent. Group detection is per conversation: a distinguishing
 * Conversation Title, 2+ distinct non-owner senders, or a single non-owner sender
 * who is not the conversation key, or (when no received sender is known) a key that cannot be a
 * username. A group is filed under a hash, never its title.
 * Output keeps the file's message order.
 */
export class HistoryReader {
  private readonly file: string;
  private readonly noun: string;
  private readonly code: string;
  private readonly events: ChatEvent[] = [];
  private readonly issues: ExportIssue[] = [];

  // The conversation being read. `key` is undefined for a flat list (no conversation key).
  private entered = false;
  private rawKey = "";
  private key: string | undefined = undefined;
  /** Direction named by a flat section ("Sent Snap History"), when it names one. */
  private sectionDir: "sent" | "received" | undefined = undefined;
  private rows: Row[] = [];
  private others = new Set<string>();
  private titleSignal = false;

  private skippedContainers = 0;
  private badEntries = 0;
  private badTimestamps = 0;
  private directionUnknown = 0;
  private noConversation = 0;
  private conversations = 0;
  private groups = 0;

  // Plain field, not a parameter property: Node's type stripping (used by tools/) rejects those.
  private readonly known: ReadonlySet<string> | undefined;
  /** Events of groups that may be one-to-one chats with a friend (see reconcile): where they are, and with whom. */
  private lone: { start: number; count: number; partner: string }[] = [];

  /**
   * `known` is the set of usernames from the friends file (friends, removed friends, requests,
   * blocked): a conversation whose partner is one of them is one-to-one whatever its title says.
   */
  constructor(history: HistoryFile, known?: ReadonlySet<string>) {
    this.file = FILE_NAME[history];
    this.noun = NOUN[history];
    this.code = history;
    this.known = known;
  }

  /** Start the conversation `rawKey` (also registers one that turns out to be empty). "" means a bare list. */
  begin(rawKey: string): void {
    if (this.entered && rawKey === this.rawKey) return;
    this.flush();
    this.entered = true;
    this.rawKey = rawKey;
    const trimmed = rawKey.trim();
    const flat = trimmed === "" || FLAT_SECTION.test(normKey(trimmed));
    this.key = flat ? undefined : trimmed;
    this.sectionDir = flat && trimmed !== "" ? sectionDirection(normKey(trimmed)) : undefined;
    if (rawKey === "") {
      this.issues.push(issue("warning", `${this.code}-top-level-array`, `${this.file} looks different from what Snappy expects. Conversations may be grouped wrongly.`));
    }
  }

  /** A top-level value that is not a list of entries. */
  skipContainer(): void {
    this.skippedContainers++;
  }

  /** An entry that is not an object. */
  skipEntry(): void {
    this.badEntries++;
  }

  /** One entry of the conversation `rawKey`. Only allowlisted fields are read. */
  add(rawKey: string, raw: Record<string, unknown>): void {
    this.begin(rawKey);
    const f = readAllowed(raw, ENTRY_ALLOW);
    const at = toMs(f.createdUs) ?? toMs(f.created);
    if (at === undefined) {
      this.badTimestamps++;
      return;
    }
    const key = this.key;
    // In a flat list the section name ("Sent ...", "Received ...") is the direction when the entry does not say.
    const sent = asBool(f.isSender) ?? (key === undefined && this.sectionDir !== undefined ? this.sectionDir === "sent" : undefined);
    const from = asText(f.from);
    const title = asText(f.title);
    const row: Row = { at, kind: kindOf(f.mediaType), sent };

    if (key === undefined) {
      // A flat list has no conversation key: the title (group), the sender of a received entry or the
      // recipient of a sent one (1:1) must name the chat.
      const to = sent === true ? asText(f.to) : undefined;
      if (title !== undefined) {
        if (sent === undefined) this.directionUnknown++;
        this.events.push({ conversation: groupId(title), isGroup: true, direction: directionOf(sent), kind: row.kind, at });
      } else if (sent === false && from !== undefined && normUser(from) !== "") {
        this.events.push({ conversation: normUser(from), isGroup: false, direction: "received", kind: row.kind, at });
      } else if (to !== undefined && normUser(to) !== "") {
        this.events.push({ conversation: normUser(to), isGroup: false, direction: "sent", kind: row.kind, at });
      } else {
        this.noConversation++;
      }
      return;
    }

    if (title !== undefined && normUser(title) !== normUser(key) && (from === undefined || normUser(title) !== normUser(from))) {
      this.titleSignal = true;
    }
    // Unknown ownership must not feed group detection, or every chat would look like a group.
    if (sent === false && from !== undefined && this.others.size < 2) this.others.add(normUser(from));
    this.rows.push(row);
  }

  /** Close the last conversation and return the events and the notes about the file. */
  finish(): { chats: ChatEvent[]; issues: ExportIssue[] } {
    this.flush();
    this.reconcile();
    const { file, noun, code, issues } = this;
    const verb = (n: number): string => (n === 1 ? "was" : "were");
    if (this.badEntries > 0) issues.push(issue("warning", `${code}-invalid-entries`, `${entries(this.badEntries)} in ${file} could not be read and ${this.badEntries === 1 ? "was" : "were"} skipped.`));
    if (this.badTimestamps > 0) issues.push(issue("warning", `${code}-bad-timestamp`, `${this.badTimestamps} ${noun}${this.badTimestamps === 1 ? " has" : "s have"} no readable date and ${verb(this.badTimestamps)} skipped.`));
    if (this.skippedContainers > 0) issues.push(issue("info", `${code}-non-list-values`, `${this.skippedContainers} ${this.skippedContainers === 1 ? "item" : "items"} in ${file} ${this.skippedContainers === 1 ? `is not a ${noun} list` : `are not ${noun} lists`} and ${verb(this.skippedContainers)} skipped.`));
    if (this.directionUnknown > 0) {
      issues.push(issue("info", `${code}-direction-unknown`, `${this.directionUnknown} ${noun}${this.directionUnknown === 1 ? " does" : "s do"} not say if you sent or received ${this.directionUnknown === 1 ? "it" : "them"}. ${this.directionUnknown === 1 ? "It still counts" : "They still count"} as activity.`));
    }
    // A small share is a note. When a large share fell out, the layout is probably not the one Snappy
    // expects and the results may be wrong: that is a warning, so the person notices it.
    const unmatchedShare = this.noConversation / Math.max(1, this.noConversation + this.events.length);
    if (this.noConversation >= WARN_MIN_COUNT && unmatchedShare > UNMATCHED_WARN_SHARE) {
      issues.push(issue("warning", "chats-unmatched-many", `${this.noConversation} of ${this.noConversation + this.events.length} ${noun}s in ${file} were skipped because no conversation matched them. Some results may be wrong.`));
    } else if (this.noConversation > 0) {
      issues.push(issue("info", `${code}-conversation-unknown`, `${this.noConversation} ${noun}${this.noConversation === 1 ? "" : "s"} could not be matched to a conversation and ${verb(this.noConversation)} skipped.`));
    }
    if (this.conversations >= WARN_MIN_COUNT && this.groups / this.conversations > GROUPS_WARN_SHARE) {
      issues.push(issue("warning", "chats-mostly-groups", `Snappy treated ${this.groups} of ${this.conversations} conversations in ${file} as group chats. The layout may differ, so results may be wrong.`));
    } else if (this.conversations > 0 && this.groups === this.conversations) {
      issues.push(issue("info", `${code}-all-groups`, this.conversations === 1
        ? "Snappy treated the only conversation as a group chat. The export layout may differ from what it expects."
        : `Snappy treated all ${this.conversations} conversations as group chats. The export layout may differ from what it expects.`));
    }
    return { chats: this.events, issues };
  }

  /**
   * Groups with one saved sender who is a friend: when most conversations of the file look like
   * groups, the layout (display names as keys or titles) is the reason and not the chats, so these are
   * one-to-one chats with that friend. In a file where groups are the exception they stay groups.
   */
  private reconcile(): void {
    if (this.lone.length === 0 || this.conversations === 0 || this.groups / this.conversations <= GROUPS_WARN_SHARE) return;
    for (const { start, count, partner } of this.lone) {
      for (let i = start; i < start + count; i++) {
        const e = this.events[i] as ChatEvent;
        this.events[i] = { ...e, conversation: partner, isGroup: false };
      }
      this.groups--;
    }
    this.lone = [];
  }

  private flush(): void {
    if (this.entered && this.key !== undefined) {
      const key = this.key;
      // With no received sender and no title signal (the owner is the only saved sender) the chat
      // cannot be proven 1:1: a key that is not username-shaped is treated as a group title and hashed.
      let isGroup =
        this.titleSignal ||
        this.others.size >= 2 ||
        (this.others.size === 1 && !this.others.has(normUser(key))) ||
        (this.others.size === 0 && !looksLikeUsername(key));
      const partner = normUser(key);
      // The friends list settles what the layout cannot. A key that is itself a friend's username is a
      // one-to-one chat, whatever title the entries carry. A key that is not (a display name) with a
      // single other sender who is a friend is decided at the end, once it is clear whether the
      // whole file is keyed that way (see reconcile): a real group with one saved sender looks the same.
      let lone: string | undefined;
      if (isGroup && this.known !== undefined && this.others.size <= 1) {
        const sole = this.others.size === 1 ? ([...this.others][0] as string) : undefined;
        if (this.known.has(partner) && (sole === undefined || sole === partner)) isGroup = false;
        else if (sole !== undefined && this.known.has(sole)) lone = sole;
      }
      const conversation = isGroup ? groupId(key) : partner;
      this.conversations++;
      if (isGroup) this.groups++;
      if (lone !== undefined) this.lone.push({ start: this.events.length, count: this.rows.length, partner: lone });
      for (const r of this.rows) {
        if (r.sent === undefined) this.directionUnknown++;
        this.events.push({ conversation, isGroup, direction: directionOf(r.sent), kind: r.kind, at: r.at });
      }
    }
    this.entered = false;
    this.rows = [];
    this.others = new Set();
    this.titleSignal = false;
  }
}

/** Parse an already-decoded history file. Never throws. */
function parseHistory(obj: unknown, history: HistoryFile, known?: ReadonlySet<string>): { chats: ChatEvent[]; issues: ExportIssue[] } {
  const reader = new HistoryReader(history, known);
  if (Array.isArray(obj)) {
    reader.begin("");
    for (const raw of obj) {
      if (isRecord(raw)) reader.add("", raw);
      else reader.skipEntry();
    }
  } else if (isRecord(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      if (!Array.isArray(value)) {
        reader.skipContainer();
        continue;
      }
      reader.begin(key);
      for (const raw of value) {
        if (isRecord(raw)) reader.add(key, raw);
        else reader.skipEntry();
      }
    }
  } else {
    return {
      chats: [],
      issues: [issue("warning", `${history}-unexpected-shape`, `${FILE_NAME[history]} looks different from what Snappy expects, so no ${NOUN[history]}s were read.`)],
    };
  }
  return reader.finish();
}

/** Parse json/chat_history.json into metadata-only events. Never throws. */
export function parseChatHistoryJson(obj: unknown, known?: ReadonlySet<string>): { chats: ChatEvent[]; issues: ExportIssue[] } {
  return parseHistory(obj, "chat", known);
}

/**
 * Parse json/snap_history.json (the same layout as the chat history, without message text) into
 * metadata-only events whose kind is the Snap's media type. Never throws.
 */
export function parseSnapHistoryJson(obj: unknown, known?: ReadonlySet<string>): { chats: ChatEvent[]; issues: ExportIssue[] } {
  return parseHistory(obj, "snap", known);
}
