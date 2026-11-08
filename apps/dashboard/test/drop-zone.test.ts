/**
 * The Start page's drop zone and its folder chooser hand what was dropped or chosen to the import flow: ZIP files to the
 * ZIP import, a folder (or JSON files from one) to the folder import. Rendered in the small fake DOM.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions, NamedBlob } from "../src/actions.ts";
import { startFlow } from "../src/copy-start.ts";
import type { DirEntry, FolderFile } from "../src/folder-import.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import { startView } from "../src/views/start.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

beforeAll(() => void installFakeDom());

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function page(): { view: FakeElement; zips: readonly NamedBlob[][]; folders: readonly FolderFile[][] } {
  const zips: NamedBlob[][] = [];
  const folders: FolderFile[][] = [];
  const actions = {
    importZips: async (files: readonly NamedBlob[]) => (zips.push([...files]), "failed" as const),
    importFolder: async (files: readonly FolderFile[]) => (folders.push([...files]), "failed" as const),
  } as unknown as Actions;
  const view = runInScope(new Scope(true), () => startView({ store: createStore(initialState()), actions, terminal: testTerminal() })) as unknown as FakeElement;
  return { view, zips, folders };
}

const dir = (name: string, children: DirEntry[]): DirEntry => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let given = false;
    return { readEntries: (ok) => (ok(given ? [] : children), void (given = true)) };
  },
});
const fileEntry = (name: string): DirEntry => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(new File(["{}"], name)) });

describe("the drop zone", () => {
  it("sends ZIP files to the ZIP import", async () => {
    const { view, zips, folders } = page();
    const zip = new File(["x"], "mydata~1.zip");
    (view.querySelector(".dropzone") as FakeElement).fire("drop", { dataTransfer: { files: [zip], items: [{ kind: "file", webkitGetAsEntry: () => ({ isFile: true, isDirectory: false, name: "mydata~1.zip" }) }] } });
    await tick();
    expect(zips).toEqual([[zip]]);
    expect(folders).toEqual([]);
  });

  it("sends a dropped folder to the folder import, with the data files found inside it", async () => {
    const { view, zips, folders } = page();
    const root = dir("mydata~1", [dir("json", [fileEntry("friends.json")]), dir("chat_media", [fileEntry("chat_history.json")])]);
    (view.querySelector(".dropzone") as FakeElement).fire("drop", { dataTransfer: { files: [new File([], "mydata~1")], items: [{ kind: "file", webkitGetAsEntry: () => root }] } });
    await tick();
    expect(folders.map((f) => f.map((x) => x.path))).toEqual([["json/friends.json"]]);
    expect(zips).toEqual([]);
  });
});

describe("the folder chooser", () => {
  it("is offered under the drop zone, as a folder chooser that is out of sight", () => {
    const { view } = page();
    const choose = view.querySelector("[data-key=choose-folder]") as FakeElement;
    expect(choose.textContent).toBe(startFlow.chooseFolder);
    const input = view.querySelector("input[webkitdirectory]") as FakeElement;
    expect(input.getAttribute("type")).toBe("file");
    expect(input.hasAttribute("hidden")).toBe(true);
  });

  it("sends the chosen folder's files, named by their path inside it, to the folder import", async () => {
    const { view, folders } = page();
    const input = view.querySelector("input[webkitdirectory]") as FakeElement;
    input.files = [Object.assign(new File(["{}"], "friends.json"), { webkitRelativePath: "mydata~1/json/friends.json" }), Object.assign(new File(["x"], "a.jpg"), { webkitRelativePath: "mydata~1/chat_media/a.jpg" })];
    input.fire("change");
    await tick();
    expect(folders.map((f) => f.map((x) => x.path))).toEqual([["json/friends.json", "chat_media/a.jpg"]]);
  });

  it("does nothing when the chooser is closed without a choice", async () => {
    const { view, folders } = page();
    const input = view.querySelector("input[webkitdirectory]") as FakeElement;
    input.files = [];
    input.fire("change");
    await tick();
    expect(folders).toEqual([]);
  });
});
