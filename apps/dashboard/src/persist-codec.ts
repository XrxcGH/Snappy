/**
 * What goes into the sealed blob. The codec lives in core (packages/core/src/ledger/saved.ts) so the
 * command line reads and writes the same file; this module keeps the dashboard's import path.
 */
export { CHECKED_OFF_ID, KEEP_LIST_ID, mergeSaved, packSaved, sortedUnique, unpackSaved } from "@snappy-export/core";
export type { Saved } from "@snappy-export/core";
