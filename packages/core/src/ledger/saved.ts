/**
 * What goes into one sealed saved-history file. Core seals exactly one thing, a Ledger, so the two
 * small lists a front end also keeps (the keep list and the guided-removal checkmarks) travel as
 * reserved pseudo-snapshots inside it. They are removed again on the way out, so no detector ever
 * sees them. One file means one passphrase prompt and one write, and the dashboard and the command
 * line read and write the very same bytes.
 */
import { normUser } from "../util.ts";
import type { Ledger, Snapshot } from "../types.ts";
import { addSnapshot, emptyLedger } from "./ledger.ts";

export interface Saved {
  ledger: Ledger;
  /** Normalised usernames the user wants to keep. */
  allowlist: string[];
  /** Normalised usernames ticked off in guided removal. */
  checkedOff: string[];
  /**
   * Self-reported checklist ticks, as "tool:item" ids in lowercase. Absent when there are none, so a file with no
   * ticks is byte for byte what it was before they existed.
   */
  ticks?: string[];
}

export const KEEP_LIST_ID = "snappy:keep-list";
export const CHECKED_OFF_ID = "snappy:checked-off";
export const TICKS_ID = "snappy:ticks";
const RESERVED = new Set([KEEP_LIST_ID, CHECKED_OFF_ID, TICKS_ID]);

function listSnapshot(id: string, names: readonly string[]): Snapshot {
  return { id, takenAt: 0, source: "export", friends: [...names], sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} };
}

/** True when the ledger carries the keep-list marker, i.e. it was written in this shared format. */
export function hasSavedLists(packed: Ledger): boolean {
  return packed.snapshots.some((s) => s.id === KEEP_LIST_ID);
}

export function packSaved(saved: Saved): Ledger {
  const real = saved.ledger.snapshots.filter((s) => !RESERVED.has(s.id));
  return {
    version: 1,
    snapshots: [
      listSnapshot(KEEP_LIST_ID, saved.allowlist),
      listSnapshot(CHECKED_OFF_ID, saved.checkedOff),
      ...(saved.ticks !== undefined && saved.ticks.length > 0 ? [listSnapshot(TICKS_ID, saved.ticks)] : []),
      ...real,
    ],
  };
}

export function unpackSaved(packed: Ledger): Saved {
  const listOf = (id: string): string[] => packed.snapshots.find((s) => s.id === id)?.friends ?? [];
  const ticks = sortedUnique(listOf(TICKS_ID));
  return {
    ledger: { version: 1, snapshots: packed.snapshots.filter((s) => !RESERVED.has(s.id)) },
    allowlist: sortedUnique(listOf(KEEP_LIST_ID)),
    checkedOff: sortedUnique(listOf(CHECKED_OFF_ID)),
    ...(ticks.length > 0 && { ticks }),
  };
}

export function sortedUnique(names: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const name of names) {
    const key = normUser(name);
    if (key !== "") set.add(key);
  }
  return [...set].sort();
}

/** Combine what is saved with what was added this session before unlocking. Neither input changes. */
export function mergeSaved(saved: Saved, session: Saved): Saved {
  let ledger = saved.ledger.snapshots.length > 0 ? saved.ledger : emptyLedger();
  for (const snap of session.ledger.snapshots) ledger = addSnapshot(ledger, snap);
  return {
    ledger,
    allowlist: sortedUnique([...saved.allowlist, ...session.allowlist]),
    checkedOff: sortedUnique([...saved.checkedOff, ...session.checkedOff]),
    ...mergedTicks(saved, session),
  };
}

function mergedTicks(a: Saved, b: Saved): { ticks?: string[] } {
  const ticks = sortedUnique([...(a.ticks ?? []), ...(b.ticks ?? [])]);
  return ticks.length > 0 ? { ticks } : {};
}
