export * from "./types.ts";
export * from "./util.ts";

// export parsing (allowlist projection; content-blind)
export {
  parseExportZip,
  parseExportFiles,
  parseFriendsJson,
  parseChatHistoryJson,
  parseSnapHistoryJson,
  parseMemoriesJson,
  validateExport,
  normPath,
} from "./export/parse.ts";

// what a counting front end no longer needs once pairing is done
export { forgetMediaHandles } from "./export/handles.ts";

// random-access zip reading (multi-GB, multi-part exports; media bytes are never requested)
export {
  bytesReader,
  listZipEntries,
  readZipEntry,
  addLocalHeaderTimes,
  parseExportFromReader,
  mergeParsedExports,
  ZipEntryError,
} from "./export/zip-reader.ts";
export type { RandomAccessReader, ZipEntryInfo, ZipListing, ZipEntryErrorCode } from "./export/zip-reader.ts";
export { crc32 } from "./export/crc32.ts";

// streaming, content-blind JSON projection (bounded memory; message text is never decoded)
export { inflateSource, projectConversations, projectShapes, projectSections, projectArrayRecords, JsonStreamError } from "./export/json-stream.ts";
export type { StreamSource, ProjectedRecord, ProjectedValue, ProjectOptions, SectionOptions, JsonStreamErrorCode } from "./export/json-stream.ts";

// structure-only description of an export (field names, never values)
export { describeStructure, describeStructureFromReader, formatStructureReport } from "./export/inspect.ts";
export type { StructureNode, StructureFile, StructureReport, LeftOutCounts } from "./export/inspect.ts";

// aggregate-only layout and Memories checks, and the combined inspect report
export {
  inspectExport,
  listParts,
  layoutSummary,
  formatLayoutSummary,
  memoryLinkCheck,
  formatMemoryLinkCheck,
  memoryTimeCheck,
  formatMemoryTimeCheck,
  memoriesListOf,
  nameShape,
} from "./export/layout-report.ts";
export type { InspectOptions, InspectOutput, LayoutSummary, LayoutFolder, MemoryLinkCheck, MemoryTimeCheck, TimeVerdict } from "./export/layout-report.ts";

// ledger + detection + cleanup queue
export {
  emptyLedger,
  snapshotFromExport,
  addSnapshot,
  diffSnapshots,
  serializeLedger,
  deserializeLedger,
  LedgerFormatError,
} from "./ledger/ledger.ts";
export { sealLedger, openLedger, sealText, openText, SealError } from "./ledger/seal.ts";
export { CHECKED_OFF_ID, KEEP_LIST_ID, hasSavedLists, mergeSaved, packSaved, sortedUnique, unpackSaved } from "./ledger/saved.ts";
export type { Saved } from "./ledger/saved.ts";
export { findGhosts } from "./ledger/detect-ghost.ts";
export { findOneWay } from "./ledger/detect-oneway.ts";
export { findDormant } from "./ledger/detect-dormant.ts";
export { buildCleanupQueue } from "./ledger/queue.ts";

// memories (metadata + opaque-byte structure only)
export { planMemories, storageMeter, memoryFileName } from "./memories/plan.ts";
export { embedJpegDate, patchMp4Dates, sniffMediaType } from "./memories/metadata.ts";
export { classifyMemoryMedia, pairMemories } from "./memories/pair.ts";
export type { MemoryMediaFile, PairingResult } from "./memories/pair.ts";

// synthetic fixtures (demo mode + tests)
export { buildSyntheticExport, syntheticExportZip, syntheticExportParts, CANARIES } from "./testing/synthetic-export.ts";
export type { SyntheticExportOptions } from "./testing/synthetic-export.ts";

export * as insights from "./insights/index.ts";
