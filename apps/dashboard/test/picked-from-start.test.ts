/**
 * The export that was read on Start is handed to the command blocks, so a command does not ask for the same export again:
 * the files are marked "from Start", a newer export replaces them, the person's own picks stay, and Lock and Delete data
 * clear them with everything else. Nothing is stored. Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createActions } from "../src/actions.ts";
import type { NamedBlob } from "../src/actions.ts";
import { terminal } from "../src/copy.ts";
import { startFlow } from "../src/copy-start.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import { createPickedFiles } from "../src/terminal/picked-files.ts";
import { createTerminalSession } from "../src/terminal/session.ts";
import type { TerminalSession } from "../src/terminal/session.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { memoryVault, partFiles, NOW } from "./export-fixtures.ts";
import { zipSync } from "fflate";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

const zip = (name: string, body = "x", lastModified = 1): File => new File([body], name, { lastModified });

describe("picked files from Start", () => {
  it("marks them, counts them, and keeps the person's own picks apart", () => {
    const picked = createPickedFiles();
    picked.add([zip("mine.zip")]);
    picked.add([zip("mydata~1.zip"), zip("mydata~1-2.zip")], { from: "start" });
    expect(picked.count()).toBe(3);
    expect(picked.fromStart()).toBe(2);
  });

  it("replaces the files of an earlier export from Start with the newer ones, and never the person's own picks", () => {
    const picked = createPickedFiles();
    let notified = 0;
    picked.subscribe(() => notified++);
    picked.add([zip("mine.zip")]);
    picked.add([zip("old.zip", "a", 1)], { from: "start" });
    picked.add([zip("new.zip", "b", 2), zip("new-2.zip", "c", 3)], { from: "start" });
    expect(picked.files().map((f) => f.name)).toEqual(["mine.zip", "new.zip", "new-2.zip"]);
    expect(picked.fromStart()).toBe(2);
    expect(notified).toBe(3);
  });

  it("takes the same export again after it was replaced, and leaves .zip-less files out", () => {
    const picked = createPickedFiles();
    picked.add([zip("a.zip")], { from: "start" });
    expect(picked.add([zip("a.zip"), zip("notes.txt")], { from: "start" })).toEqual({ added: 1, skipped: 1 });
    expect(picked.files().map((f) => f.name)).toEqual(["a.zip"]);
  });

  it("forgets what came from Start when cleared", () => {
    const picked = createPickedFiles();
    picked.add([zip("a.zip")], { from: "start" });
    picked.clear();
    expect(picked.fromStart()).toBe(0);
    expect(picked.count()).toBe(0);
  });
});

describe("the chip of a command block", () => {
  beforeAll(() => void installFakeDom());

  const session = (): TerminalSession =>
    createTerminalSession({ spawn: () => null, vault: { supported: () => false, read: async () => null, write: async () => undefined, clear: async () => undefined }, vaultPhase: () => "locked", announce: () => undefined });

  async function chip(s: TerminalSession): Promise<FakeElement> {
    const { fileChip } = await import("../src/components/fileChip.ts");
    return runInScope(new Scope(true), () => fileChip(s, { key: "inspect" })) as unknown as FakeElement;
  }

  it("says how many files came from Start, with Clear", async () => {
    const s = session();
    s.picked.add([zip("mydata~1.zip"), zip("mydata~1-2.zip")], { from: "start" });
    const el = await chip(s);
    const [choose, clear] = el.querySelectorAll("button") as FakeElement[];
    expect(choose?.textContent).toBe("2 files from Start");
    expect(clear?.hidden).toBe(false);
    s.picked.clear();
    expect(choose?.textContent).toBe(terminal.chooseButton);
  });

  it("says one file in the singular, and the plain count once the person chose another file", async () => {
    const s = session();
    s.picked.add([zip("mydata~1.zip")], { from: "start" });
    const el = await chip(s);
    const choose = el.querySelectorAll("button")[0] as FakeElement;
    expect(choose.textContent).toBe("1 file from Start");
    s.picked.add([zip("mine.zip")]);
    expect(choose.textContent).toBe(terminal.filesChosen(2));
    expect(startFlow.filesFromStart(1)).toBe("1 file from Start");
  });
});

describe("what an import hands to the command blocks", () => {
  function page(onImported?: (files: readonly Blob[]) => void) {
    const picks: (readonly Blob[])[] = [];
    const store = createStore(initialState());
    const actions = createActions(store, { vault: memoryVault(), clock: () => NOW + 1000, yieldToUi: async () => {}, saveTheme: () => {}, onImported: onImported ?? ((files) => void picks.push(files)) });
    return { store, actions, picks };
  }

  it("gives the ZIP files of an export that was read and kept, in export order", async () => {
    const { actions, picks } = page();
    const [base, second, third] = partFiles(2) as [File, File, File];
    expect(await actions.importZips([third, base, second])).toBe("done");
    expect(picks).toHaveLength(1);
    expect((picks[0] as NamedBlob[]).map((f) => f.name)).toEqual([base.name, second.name, third.name]);
    expect(picks[0]?.every((f) => f instanceof Blob)).toBe(true);
  });

  it("gives nothing for a refused export, a stopped import, the sample or a folder", async () => {
    const { actions, picks } = page();
    await actions.importZips([new File([new Uint8Array(500)], "mydata~1700000000000.zip")]);
    await actions.loadSample();
    await actions.importFolder([{ path: "photos/a.jpg", blob: new Blob(["x"]) }]);
    expect(picks).toEqual([]);
  });

  it("gives nothing for a file that is not a real Blob, such as a shell's own file handle", async () => {
    const calls: Blob[][] = [];
    const { actions } = page((files) => void calls.push([...files]));
    // A shell's file stand-in has a name, a size and slice(), but is not a Blob: the pipeline can read it, a helper cannot.
    const [base, second, third] = partFiles(2) as [File, File, File];
    const facade = (file: File): NamedBlob => ({ name: file.name, size: file.size, type: file.type, slice: (a?: number, b?: number) => file.slice(a, b) }) as unknown as NamedBlob;
    expect(await actions.importZips([facade(base), facade(second), facade(third)])).toBe("done");
    expect(calls).toEqual([[]]);
  });

  it("gives the files after Use anyway too", async () => {
    const { actions, picks } = page();
    const empty = new File(
      [new Uint8Array(zipSync({ "json/friends.json": [new TextEncoder().encode(JSON.stringify({ Friends: [], "Deleted Friends": Array.from({ length: 20 }, (_, i) => ({ Username: `gone_${i}` })) })), { mtime: new Date(NOW) }] }))],
      "mydata~1700000000000.zip",
    );
    expect(await actions.importZips([empty])).toBe("failed");
    expect(picks).toEqual([]);
    expect(await actions.importAnyway()).toBe("done");
    expect(picks).toHaveLength(1);
  });
});

describe("Lock and Delete data clear what Start handed over", () => {
  function wired() {
    const s: TerminalSession = createTerminalSession({ spawn: () => null, vault: { supported: () => false, read: async () => null, write: async () => undefined, clear: async () => undefined }, vaultPhase: () => "locked", announce: () => undefined });
    const store = createStore(initialState());
    const actions = createActions(store, {
      vault: memoryVault(),
      clock: () => NOW + 1000,
      yieldToUi: async () => {},
      saveTheme: () => {},
      onWipe: () => s.reset(),
      onImported: (files) => void s.picked.add(files, { from: "start" }),
    });
    return { s, actions };
  }

  it("fills the picked list after an import, so a command does not ask for the export again", async () => {
    const { s, actions } = wired();
    await actions.importZips(partFiles(2));
    expect(s.picked.count()).toBe(3);
    expect(s.picked.fromStart()).toBe(3);
    // The blobs are the very files that were read: lazy, nothing copied.
    expect(s.picked.files().every((f) => f.blob instanceof Blob)).toBe(true);
  });

  it("empties it when the history is locked", async () => {
    const { s, actions } = wired();
    await actions.importZips(partFiles(2));
    await actions.lock();
    expect(s.picked.count()).toBe(0);
    expect(s.picked.fromStart()).toBe(0);
  });

  it("empties it when the data is deleted", async () => {
    const { s, actions } = wired();
    await actions.importZips(partFiles(2));
    expect(await actions.deleteAll()).toBe(true);
    expect(s.picked.count()).toBe(0);
  });

  it("replaces it with the newer export when another is read", async () => {
    const { s, actions } = wired();
    await actions.importZips(partFiles(2));
    await actions.importZips(partFiles(1));
    expect(s.picked.count()).toBe(3);
    expect(s.picked.fromStart()).toBe(3);
  });
});
