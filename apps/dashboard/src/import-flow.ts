/**
 * What happens around an import, whatever started it: the Start page's chooser and drop zone, a folder chooser, or a
 * drop anywhere on the page. It asks the actions to read, says what happened (spoken, once), and goes to the Overview
 * when the export was kept. The page and the global drop handler share this one flow, so they cannot disagree.
 */
import type { Actions, ImportOptions, ImportResult, NamedBlob } from "./actions.ts";
import { announce } from "./announce.ts";
import { start } from "./copy.ts";
import { startFlow } from "./copy-start.ts";
import { folderFilesFromEntries, hasDataFiles } from "./folder-import.ts";
import type { DirEntry, FolderFile } from "./folder-import.ts";
import type { Store } from "./store.ts";
import { navigate } from "./views/context.ts";

export interface ImportFlow {
  /** ZIP files (or files that are not, which the actions explain). */
  files(files: NamedBlob[], options?: ImportOptions): Promise<void>;
  /** The files of a folder chosen with the folder chooser. */
  folder(files: FolderFile[]): Promise<void>;
  /**
   * Whatever was dropped: ZIP files, JSON files, or folders. Reads the drop event's items before it waits for anything,
   * because a browser empties them once the event is over.
   */
  drop(transfer: DataTransfer | null): Promise<void>;
}

/** What a browser's folder entry offers that matters here. */
type EntryItem = DataTransferItem & { webkitGetAsEntry?: () => (DirEntry & { isDirectory: boolean }) | null };

export function createImportFlow(ctx: { store: Store; actions: Actions }): ImportFlow {
  const { store, actions } = ctx;

  const settle = async (begin: () => Promise<ImportResult>): Promise<void> => {
    // A read is already going: say so, and leave it alone.
    if (store.get().import.phase === "reading") {
      announce(startFlow.busy);
      return;
    }
    // Nothing is said here as the read starts: the progress block says it, once, as it changes.
    const result = await begin();
    const s = store.get();
    if (result === "done") {
      announce(s.import.addedToHistory === false ? start.notAdded : start.readDone);
      navigate("overview");
    } else if (result === "canceled") {
      announce(startFlow.stopped);
    } else if (result === "busy") {
      announce(startFlow.busy);
    } else {
      announce(s.import.message ?? start.readFailed, true);
    }
  };

  const flow: ImportFlow = {
    files: async (files, options = {}) => {
      if (files.length === 0) return;
      // JSON files taken from an unzipped export are read as the folder they came from (and nothing else is).
      if (!files.some((f) => /\.zip$/i.test(f.name ?? ""))) {
        const loose = files.map((f) => ({ path: f.name ?? "", blob: f as Blob, lastModified: (f as { lastModified?: number }).lastModified }));
        if (hasDataFiles(loose)) return flow.folder(loose);
      }
      return settle(() => actions.importZips(files, options));
    },
    folder: async (files) => {
      if (files.length === 0) return;
      return settle(() => actions.importFolder(files));
    },
    drop: async (transfer) => {
      // Everything the event holds is taken out now, before the first wait.
      const entries = [...(transfer?.items ?? [])].flatMap((item) => (item.kind === "file" ? [(item as EntryItem).webkitGetAsEntry?.() ?? null] : [])).filter((e) => e !== null);
      const files = [...(transfer?.files ?? [])] as NamedBlob[];
      if (entries.some((e) => e.isDirectory)) {
        // Even a folder with nothing of the export in it is answered: the actions say what they looked for.
        const found = await folderFilesFromEntries(entries);
        return settle(() => actions.importFolder(found));
      }
      return flow.files(files);
    },
  };
  return flow;
}
