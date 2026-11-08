import type { DeletedFriendRecord, ExportIssue, FriendRecord, ParsedFriends } from "../types.ts";
import { MAX_USERNAME_LENGTH, normUser, toMsCounting } from "../util.ts";
import { asText, compileAllow, entries, isRecord, issue, looseDatesIssue, normKey, readAllowed } from "./json-util.ts";

type SectionName = keyof ParsedFriends;

/** Normalised section-key aliases -> where the entries go. Exact match only: "friends" must never absorb "deletedfriends". */
const SECTION_ALIASES: Record<SectionName, string[]> = {
  friends: ["friends", "friendslist"],
  sentRequests: ["friendrequestssent", "sentfriendrequests", "sentrequests", "outgoingrequests"],
  pendingRequests: ["pendingrequests", "friendrequestsreceived", "receivedfriendrequests", "incomingrequests"],
  deletedFriends: ["deletedfriends", "removedfriends"],
  blocked: ["blockedusers", "blockedsnapchatters", "blockedfriends", "blocked"],
  ignored: ["ignoredsnapchatters", "ignoredusers", "ignored"],
  hiddenSuggestions: ["hiddenfriendsuggestions", "hiddensuggestions"],
};

const SECTION_BY_ALIAS = new Map<string, SectionName>();
for (const [section, aliases] of Object.entries(SECTION_ALIASES) as [SectionName, string[]][]) {
  for (const a of aliases) SECTION_BY_ALIAS.set(a, section);
}

/**
 * ALLOWLIST of entry fields. "Display Name", "Source" and every other key are
 * absent on purpose: they are never read, so they cannot be copied.
 */
const ENTRY_ALLOW = compileAllow({
  username: ["username", "user", "snapchatusername"],
  createdAt: ["creationtimestamp", "creationtime", "creationdate", "createdat", "created"],
  modifiedAt: ["lastmodifiedtimestamp", "lastmodifiedtime", "lastmodified", "modifiedat", "modified"],
  // "date" is a last-resort alias: some exports label the deletion time only that way.
  deletedAt: ["datedeleted", "deleteddate", "deletedat", "deletiontimestamp", "deletedtimestamp", "deleted", "date"],
});

export function emptyFriends(): ParsedFriends {
  return {
    friends: [],
    sentRequests: [],
    pendingRequests: [],
    deletedFriends: [],
    blocked: [],
    ignored: [],
    hiddenSuggestions: [],
  };
}

interface ParsedEntry {
  record: DeletedFriendRecord;
  /** deletedAt was inferred from a created/modified timestamp rather than an explicit deletion field. */
  deletedAtGuessed: boolean;
}

function parseEntry(raw: unknown, isDeleted: boolean, loose: { count: number }): ParsedEntry | undefined {
  // A bare string/number is ambiguous (it could be a display name), so it is not trusted as a username.
  if (!isRecord(raw)) return undefined;

  const f = readAllowed(raw, ENTRY_ALLOW);
  const name = asText(f.username);
  if (name === undefined) return undefined;
  const username = normUser(name);
  if (username === "" || username.length > MAX_USERNAME_LENGTH) return undefined;

  const record: DeletedFriendRecord = { username };
  const onLoose = (): void => void loose.count++;
  const createdAt = toMsCounting(f.createdAt, onLoose);
  if (createdAt !== undefined) record.createdAt = createdAt;
  const modifiedAt = toMsCounting(f.modifiedAt, onLoose);
  if (modifiedAt !== undefined) record.modifiedAt = modifiedAt;

  let deletedAtGuessed = false;
  if (isDeleted) {
    const explicit = toMsCounting(f.deletedAt, onLoose);
    // Best-effort fallback: the export may stash the deletion time in the generic timestamps.
    const deletedAt = explicit ?? modifiedAt ?? createdAt;
    if (deletedAt !== undefined) {
      record.deletedAt = deletedAt;
      deletedAtGuessed = explicit === undefined;
    }
  }
  return { record, deletedAtGuessed };
}

/** An empty list, an empty object or null: nothing in it could be lost by skipping it. */
const isEmptyValue = (v: unknown): boolean => v === null || (Array.isArray(v) ? v.length === 0 : isRecord(v) && Object.keys(v).length === 0);

/** Parse json/friends.json. Never throws; surprises come back as issues (counts only, never values). */
export function parseFriendsJson(obj: unknown): { friends: ParsedFriends; issues: ExportIssue[] } {
  const friends = emptyFriends();
  const issues: ExportIssue[] = [];

  let sections: [string, unknown][];
  if (Array.isArray(obj)) {
    issues.push(issue("warning", "friends-top-level-array", "friends.json looks different from what Snappy expects. Snappy read it as your current friends list."));
    sections = [["Friends", obj]];
  } else if (isRecord(obj)) {
    sections = Object.entries(obj);
  } else {
    issues.push(issue("warning", "friends-unexpected-shape", "friends.json looks different from what Snappy expects, so no friends were read."));
    return { friends, issues };
  }

  let unknownKeys = 0;
  let recognised = 0;
  let guessedDeletedDates = 0;
  let badSections = 0;
  let dropped = 0;
  const loose = { count: 0 };

  for (const [key, value] of sections) {
    const section = SECTION_BY_ALIAS.get(normKey(key));
    if (!section) {
      // Real exports carry one section of unknown name that is always empty; mentioning it would only worry people.
      if (!isEmptyValue(value)) unknownKeys++;
      continue;
    }
    if (!Array.isArray(value)) {
      badSections++;
      continue;
    }
    recognised++;
    const out = friends[section] as FriendRecord[];
    for (const raw of value) {
      const parsed = parseEntry(raw, section === "deletedFriends", loose);
      if (!parsed) {
        dropped++;
        continue;
      }
      if (parsed.deletedAtGuessed) guessedDeletedDates++;
      out.push(parsed.record);
    }
  }

  if (badSections > 0) {
    issues.push(issue("warning", "friends-section-not-list", `${badSections} friends.json section${badSections === 1 ? " is" : "s are"} not a list and ${badSections === 1 ? "was" : "were"} skipped.`));
  }
  if (dropped > 0) {
    issues.push(issue("warning", "friends-invalid-entries", `${entries(dropped)} in friends.json had no usable username and ${dropped === 1 ? "was" : "were"} skipped.`));
  }
  if (recognised === 0) {
    issues.push(issue("warning", "friends-no-sections", `Snappy found no friend lists in friends.json. The file may use a layout it does not know.`));
  } else if (unknownKeys > 0) {
    issues.push(issue("info", "friends-unknown-sections", `Snappy skipped ${unknownKeys} ${unknownKeys === 1 ? "section" : "sections"} in friends.json that it does not recognize.`));
  }
  if (guessedDeletedDates > 0) {
    issues.push(issue("info", "deleted-date-guessed", `${guessedDeletedDates} ${guessedDeletedDates === 1 ? "friend you removed has" : "friends you removed have"} no removal date. Snappy used another date from the file.`));
  }
  const looseNote = looseDatesIssue("friends.json", loose.count);
  if (looseNote !== undefined) issues.push(looseNote);
  if (friends.pendingRequests.length > 0) {
    issues.push(issue("info", "pending-direction-unknown", "The export does not say if pending requests were sent or received, so Snappy treats them as unknown."));
  }
  return { friends, issues };
}
