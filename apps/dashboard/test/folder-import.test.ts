/**
 * An export that a browser unzipped is read from its folder: only the few JSON files are picked, wrapped without copying
 * into one small ZIP file, and read like a downloaded part. No photos, videos or pages are opened. Synthetic data only.
 */
import { unzipSync } from "fflate";
import { listZipEntries, parseExportFromReader, syntheticExportParts } from "@snappy-export/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions, ImportOptions, NamedBlob } from "../src/actions.ts";
import { startFlow } from "../src/copy-start.ts";
import { blobReader } from "../src/blob-reader.ts";
import { folderFilesFromEntries, folderFilesFromInput, hasDataFiles, pickDataFiles, wrapAsZip } from "../src/folder-import.ts";
import type { DirEntry, FolderFile } from "../src/folder-import.ts";
import { createImportFlow } from "../src/import-flow.ts";
import { createStore } from "../src/store.ts";
import { initialState } from "../src/reducer.ts";
import { NOW, partFiles, setup } from "./export-fixtures.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

const SMALL = { friendCount: 40, chatMessageCount: 200, memoryCount: 40 };

/** The JSON files of a synthetic export, as the files of an unzipped folder. */
function unzipped(prefix = "mydata~1700000000000/"): FolderFile[] {
  const files = unzipSync(syntheticExportParts({ now: NOW, phase: 2, ...SMALL })[0]?.bytes as Uint8Array);
  return Object.entries(files)
    .filter(([name]) => name.endsWith(".json"))
    .map(([name, bytes]) => ({ path: prefix + name, blob: new Blob([new Uint8Array(bytes)]), lastModified: NOW - 1000 }));
}

describe("pickDataFiles", () => {
  const file = (path: string): FolderFile => ({ path, blob: new Blob(["{}"]) });

  it("keeps one file for each name Snappy reads, under json/ first, and ignores everything else", () => {
    const picked = pickDataFiles([file("json/friends.json"), file("chat_media/friends.json"), file("friends.json"), file("json/account.json"), file("json/chat_history.json"), file("photo.jpg")]);
    expect(picked.map((f) => f.path)).toEqual(["json/friends.json", "json/chat_history.json"]);
  });

  it("takes the shallowest file when none is under json/, and reads the alias of the chat history", () => {
    expect(pickDataFiles([file("a/b/c/friends.json"), file("a/friends.json")]).map((f) => f.path)).toEqual(["a/friends.json"]);
    expect(pickDataFiles([file("saved_chat_history.json")]).map((f) => f.path)).toEqual(["saved_chat_history.json"]);
  });

  it("finds data files wherever they sit, and none in a folder of photos", () => {
    expect(hasDataFiles([file("x/y/snap_history.json")])).toBe(true);
    expect(hasDataFiles([file("a.jpg"), file("account.json")])).toBe(false);
  });
});

describe("folderFilesFromInput", () => {
  it("names each file by its path inside the chosen folder", () => {
    const a = Object.assign(new File(["x"], "friends.json"), { webkitRelativePath: "mydata~1/json/friends.json" });
    const b = new File(["x"], "loose.json");
    expect(folderFilesFromInput([a, b]).map((f) => f.path)).toEqual(["json/friends.json", "loose.json"]);
  });
});

describe("wrapAsZip", () => {
  it("makes a ZIP file the reader lists and parses, with the export date from the files", async () => {
    const wrapped = await wrapAsZip(pickDataFiles(unzipped()), NOW);
    const listing = await listZipEntries(blobReader(wrapped));
    expect(listing.issues).toEqual([]);
    expect(listing.entries.map((e) => e.name).sort()).toEqual(["json/chat_history.json", "json/friends.json", "json/memories_history.json", "json/snap_history.json"]);
    const parsed = await parseExportFromReader(blobReader(wrapped), { part: 1 });
    expect(parsed.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(parsed.friends.friends).toHaveLength(40);
    expect(parsed.exportedAt).toBe(Math.floor((NOW - 1000) / 1000) * 1000);
  });

  it("does not copy the files: its parts are the headers and the files themselves", async () => {
    const files = pickDataFiles(unzipped());
    const wrapped = await wrapAsZip(files, NOW);
    const bodies = files.reduce((n, f) => n + f.blob.size, 0);
    expect(wrapped.size).toBeGreaterThan(bodies);
    expect(wrapped.size - bodies).toBeLessThan(2000);
  });

  it("refuses a file too large for a plain ZIP file", async () => {
    const huge = { path: "json/friends.json", blob: { size: 0x1_0000_0000, stream: () => new Blob([]).stream() } as unknown as Blob };
    await expect(wrapAsZip([huge], NOW)).rejects.toThrow();
  });
});

describe("importing a folder in the actions", () => {
  it("gives the same friends as the ZIP files, keeps no media, and says so", async () => {
    const fromFolder = setup();
    expect(await fromFolder.actions.importFolder(unzipped())).toBe("done");
    const fromZips = setup();
    await fromZips.actions.importZips(partFiles(2));
    expect(fromFolder.store.get().real.latest?.friends).toEqual(fromZips.store.get().real.latest?.friends);
    expect(fromFolder.store.get().real.latest?.memories.length).toBeGreaterThan(0);
    expect(fromFolder.store.get().real.latest?.memoriesPairing).toBeUndefined();
    const note = fromFolder.store.get().real.issues.find((i) => i.code === "folder-no-media");
    expect(note).toMatchObject({ severity: "info", message: startFlow.folderNoMedia });
    expect(fromFolder.store.get().real.ledger.snapshots).toHaveLength(1);
    expect(fromFolder.store.get().real.parts).toBe(1);
  });

  it("says what it looked for when the folder holds no export files", async () => {
    const { store, actions } = setup();
    expect(await actions.importFolder([{ path: "photos/a.jpg", blob: new Blob(["x"]) }])).toBe("failed");
    expect(store.get().import.message).toBe(startFlow.folderEmpty);
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("is refused while another import runs, like any import", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { actions } = setup({
      runImport: async (blobs, hooks) => {
        await held;
        return (await import("../src/import-pipeline.ts")).runImport(blobs, hooks);
      },
    });
    const first = actions.importFolder(unzipped());
    await new Promise((r) => setTimeout(r, 0));
    expect(await actions.importFolder(unzipped())).toBe("busy");
    release();
    expect(await first).toBe("done");
  });
});

describe("folders dropped on the page", () => {
  beforeAll(() => void 0);

  const fileEntry = (name: string, contents = "{}"): DirEntry => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(new File([contents], name, { lastModified: 5 })) });
  function dirEntry(name: string, children: DirEntry[], seen: string[] = []): DirEntry {
    return {
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => {
        let given = false;
        return {
          readEntries: (ok) => {
            seen.push(name);
            ok(given ? [] : children);
            given = true;
          },
        };
      },
    };
  }

  it("walks a dropped folder for the data files and never into the media folders", async () => {
    const seen: string[] = [];
    const root = dirEntry(
      "mydata~1",
      [
        dirEntry("json", [fileEntry("friends.json"), fileEntry("account.json"), fileEntry("chat_history.json")], seen),
        dirEntry("chat_media", [fileEntry("chat_history.json")], seen),
        dirEntry("memories", [fileEntry("memories_history.json")], seen),
        fileEntry("index.html"),
      ],
      seen,
    );
    const found = await folderFilesFromEntries([root]);
    expect(found.map((f) => f.path).sort()).toEqual(["json/chat_history.json", "json/friends.json"]);
    expect(seen).not.toContain("chat_media");
    expect(seen).not.toContain("memories");
    expect(found[0]?.lastModified).toBe(5);
  });

  it("does not go deeper than the export's own layout", async () => {
    const deep = dirEntry("a", [dirEntry("b", [dirEntry("c", [dirEntry("d", [dirEntry("e", [fileEntry("friends.json")])])])])]);
    expect(await folderFilesFromEntries([deep])).toEqual([]);
  });

  /** A drop event's transfer, with what a browser would give. */
  const transfer = (entries: (DirEntry | null)[], files: File[]): DataTransfer =>
    ({ items: entries.map((e) => ({ kind: "file", webkitGetAsEntry: () => e })), files }) as unknown as DataTransfer;

  function flowWith(): { flow: ReturnType<typeof createImportFlow>; folders: FolderFile[][]; zips: { files: readonly NamedBlob[]; options?: ImportOptions }[] } {
    const folders: FolderFile[][] = [];
    const zips: { files: readonly NamedBlob[]; options?: ImportOptions }[] = [];
    const actions = {
      importFolder: async (f: readonly FolderFile[]) => (folders.push([...f]), "failed" as const),
      importZips: async (files: readonly NamedBlob[], options?: ImportOptions) => (zips.push({ files, options }), "failed" as const),
    } as unknown as Actions;
    return { flow: createImportFlow({ store: createStore(initialState()), actions }), folders, zips };
  }

  it("reads a dropped folder as a folder, even one with nothing of the export in it", async () => {
    const { flow, folders, zips } = flowWith();
    await flow.drop(transfer([dirEntry("mydata~1", [dirEntry("json", [fileEntry("friends.json")])])], [new File([], "mydata~1")]));
    expect(folders).toHaveLength(1);
    expect(folders[0]?.map((f) => f.path)).toEqual(["json/friends.json"]);
    await flow.drop(transfer([dirEntry("empty", [])], [new File([], "empty")]));
    expect(folders).toHaveLength(2);
    expect(folders[1]).toEqual([]);
    expect(zips).toHaveLength(0);
  });

  it("reads dropped JSON files from an unzipped export as the folder they came from, and ZIP files as ZIP files", async () => {
    const { flow, folders, zips } = flowWith();
    await flow.drop(transfer([null, null], [new File(["{}"], "friends.json"), new File(["{}"], "chat_history.json")]));
    expect(folders.map((f) => f.map((x) => x.path))).toEqual([["friends.json", "chat_history.json"]]);
    await flow.drop(transfer([null], [new File(["x"], "mydata~1.zip")]));
    expect(zips).toHaveLength(1);
    // Files that are neither go to the actions, which explain.
    await flow.drop(transfer([null], [new File(["x"], "notes.txt")]));
    expect(zips).toHaveLength(2);
    expect(folders).toHaveLength(1);
  });
});
