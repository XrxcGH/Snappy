/**
 * An export that a browser unzipped (Safari does, after a download) is a folder or JSON files. Saying "Snappy can only
 * read ZIP files" gives no way forward, so the page says what it looks like and what to do. Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions, ImportOptions, NamedBlob } from "../src/actions.ts";
import { start } from "../src/copy.ts";
import { startFlow } from "../src/copy-start.ts";
import { looksUnzipped } from "../src/export-parts.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import { startView } from "../src/views/start.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { partFiles, setup } from "./export-fixtures.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

const file = (name: string, extra: object = {}): File => Object.assign(new File(["x"], name), extra);

describe("looksUnzipped", () => {
  it("is true for a folder drop, files from inside a folder, JSON files and a folder named like an export", () => {
    expect(looksUnzipped([], { folder: true })).toBe(true);
    expect(looksUnzipped([{ name: "friends.json" }])).toBe(true);
    expect(looksUnzipped([{ name: "Friends.JSON" }, { name: "chat_history.json" }])).toBe(true);
    expect(looksUnzipped([{ name: "friends.html", webkitRelativePath: "mydata/html/friends.html" }])).toBe(true);
    expect(looksUnzipped([{ name: "mydata~1700000000000" }])).toBe(true);
  });

  it("is false for everything else, which keeps the plain not-a-ZIP message", () => {
    expect(looksUnzipped([{ name: "notes.txt" }])).toBe(false);
    expect(looksUnzipped([{ name: "photo.jpg" }, { name: "export" }])).toBe(false);
    expect(looksUnzipped([{}])).toBe(false);
    expect(looksUnzipped([])).toBe(false);
  });
});

describe("importing what looks unzipped", () => {
  it("says it looks unzipped and what to do, for JSON files and for a folder", async () => {
    const { store, actions } = setup();
    expect(await actions.importZips([file("friends.json"), file("chat_history.json")])).toBe("failed");
    expect(store.get().import.message).toBe(startFlow.unzipped);
    expect(await actions.importZips([file("mydata~1700000000000")], { folder: true })).toBe("failed");
    expect(store.get().import.message).toBe(startFlow.unzipped);
    expect(startFlow.unzipped).toMatch(/Open safe files after downloading/);
    expect(startFlow.unzipped).toMatch(/choose the ZIP files/);
  });

  it("keeps the plain message for a file that is simply not a ZIP, and reads on when a ZIP is among the files", async () => {
    const { store, actions } = setup();
    expect(await actions.importZips([file("notes.txt")])).toBe("failed");
    expect(store.get().import.message).toBe(start.notZip);
    expect(await actions.importZips([...partFiles(2), file("friends.json")])).toBe("done");
  });
});

describe("dropping a folder on the drop zone", () => {
  beforeAll(() => void installFakeDom());

  function drop(items: unknown[], files: NamedBlob[]): { files: readonly NamedBlob[]; options: ImportOptions | undefined }[] {
    const calls: { files: readonly NamedBlob[]; options: ImportOptions | undefined }[] = [];
    const actions: Partial<Actions> = { importZips: async (f, options) => (calls.push({ files: f, options }), "failed") };
    const store = createStore(initialState());
    const view = runInScope(new Scope(true), () => startView({ store, actions: actions as Actions, terminal: testTerminal() })) as unknown as FakeElement;
    (view.querySelector(".dropzone") as FakeElement).fire("drop", { dataTransfer: { files, items } });
    return calls;
  }

  it("tells the import that a folder was dropped", () => {
    const calls = drop([{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) }], [file("mydata~1700000000000")]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options).toEqual({ folder: true });
  });

  it("does not, for ordinary files", () => {
    const calls = drop([{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }) }, { kind: "file" }], [file("a.zip")]);
    expect(calls[0]?.options).toEqual({ folder: false });
  });
});
