/**
 * What goes into the sealed blob. Core seals exactly one thing, a Ledger, so the two small
 * lists the dashboard also keeps (the keep list and the guided-removal checkmarks) travel as
 * reserved pseudo-snapshots inside it. They are removed again on the way out, so no detector
 * ever sees them. One blob means one passphrase prompt and one write.
 */
import { addSnapshot, emptyLedger, normUser } from "@snappy-export/core";
import type { Ledger, Snapshot } from "@snappy-export/core";

export interface Saved {
  ledger: Ledger;
  /** Normalised usernames the user wants to keep. */
  allowlist: string[];
  /** Normalised usernames ticked off in guided removal. */
  checkedOff: string[];
}

export const KEEP_LIST_ID = "snappy:keep-list";
export const CHECKED_OFF_ID = "snappy:checked-off";
const RESERVED = new Set([KEEP_LIST_ID, CHECKED_OFF_ID]);

function listSnapshot(id: string, names: readonly string[]): Snapshot {
  return { id, takenAt: 0, source: "export", friends: [...names], sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} };
}

export function packSaved(saved: Saved): Ledger {
  const real = saved.ledger.snapshots.filter((s) => !RESERVED.has(s.id));
  return {
    version: 1,
    snapshots: [listSnapshot(KEEP_LIST_ID, saved.allowlist), listSnapshot(CHECKED_OFF_ID, saved.checkedOff), ...real],
  };
}

export function unpackSaved(packed: Ledger): Saved {
  const listOf = (id: string): string[] => packed.snapshots.find((s) => s.id === id)?.friends ?? [];
  return {
    ledger: { version: 1, snapshots: packed.snapshots.filter((s) => !RESERVED.has(s.id)) },
    allowlist: sortedUnique(listOf(KEEP_LIST_ID)),
    checkedOff: sortedUnique(listOf(CHECKED_OFF_ID)),
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
  };
}
