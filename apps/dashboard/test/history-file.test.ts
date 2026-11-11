/**
 * The history as a file: Save history file seals it with a typed passphrase in the format the page and the command line
 * tool already use, and Open history file adds a chosen file's exports and lists to what is on screen. The format is
 * checked against core's own seal, the Settings controls in the small fake DOM, and the saving of an unlocked history.
 * Synthetic data only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openLedger, sealLedger } from "@snappy-export/core";
import type { Ledger, Snapshot } from "@snappy-export/core";
import { createActions } from "../src/actions.ts";
import { announce } from "../src/announce.ts";
import { shellCopy } from "../src/copy-shell.ts";
import { saveBlob } from "../src/download.ts";
import { HISTORY_FILE_NAME, MAX_HISTORY_FILE_BYTES, buildHistoryFile, hasHistory, readHistoryFile } from "../src/history-file.ts";
import { packSaved, unpackSaved } from "../src/persist-codec.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState, reduce } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";
import { testTerminal } from "./terminal-fixture.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

vi.mock("snappy:licenses", () => ({ licenses: [] }));
vi.mock("../src/announce.ts", () => ({ announce: vi.fn() }));
vi.mock("../src/download.ts", () => ({ saveBlob: vi.fn(() => true), saveTextFile: vi.fn(() => true) }));

const PASS = "maple orbit kettle seven river";
const OTHER = "river seven kettle orbit maple";
const NOW = Date.UTC(2026, 10, 6, 12);
const snap = (id: string, takenAt: number, friends: string[]): Snapshot => ({ id, takenAt, source: "export", friends, sentRequests: [], deleted: {}, friendSince: {}, sentAt: {} });
const NAMES = ["zqcanary_one", "zqcanary_two"];
const ledger = (...snapshots: Snapshot[]): Ledger => ({ version: 1, snapshots });
const FILE_LEDGER = ledger(snap("a", Date.UTC(2025, 0, 5), NAMES.slice(0, 1)), snap("b", Date.UTC(2026, 4, 9), NAMES));
const saved = (l: Ledger, extra: Partial<{ allowlist: string[]; checkedOff: string[]; ticks: string[] }> = {}) => ({ ledger: l, allowlist: [], checkedOff: [], ...extra });
const asFile = (bytes: Uint8Array): File => new File([new Uint8Array(bytes)], "anything.sealed");

describe("the file", () => {
  it("is the sealed format the page and the command line already use, in both directions", async () => {
    const bytes = await buildHistoryFile(saved(FILE_LEDGER, { allowlist: ["keepme"], ticks: ["tool:item"] }), PASS);
    // Core's own open reads it: the same call the saved history and the command line make.
    const direct = unpackSaved(await openLedger(bytes, PASS));
    expect(direct.ledger.snapshots.map((s) => s.id)).toEqual(["a", "b"]);
    expect(direct.allowlist).toEqual(["keepme"]);
    expect(direct.ticks).toEqual(["tool:item"]);
    // And a history sealed the way the saved history is sealed opens as a file.
    const sealedElsewhere = await sealLedger(packSaved(saved(FILE_LEDGER)), PASS);
    const result = await readHistoryFile(asFile(sealedElsewhere), PASS);
    expect(result.ok && result.saved.ledger.snapshots.length).toBe(2);
    expect(HISTORY_FILE_NAME).toBe("snappy-history.sealed");
  });

  it("holds no username or number in the clear", async () => {
    const bytes = await buildHistoryFile(saved(FILE_LEDGER), PASS);
    const text = new TextDecoder("latin1").decode(bytes);
    for (const name of NAMES) expect(text).not.toContain(name);
    expect(text).not.toContain("snapshots");
    expect(text.startsWith("SNPL")).toBe(true);
  });

  it("refuses a short passphrase, as the Settings form does", async () => {
    await expect(buildHistoryFile(saved(FILE_LEDGER), "short")).rejects.toThrow();
  });

  it("tells a wrong passphrase (or a file that is not ours) from a file that cannot be read", async () => {
    const bytes = await buildHistoryFile(saved(FILE_LEDGER), PASS);
    expect(await readHistoryFile(asFile(bytes), OTHER)).toEqual({ ok: false, problem: "passphrase" });
    expect(await readHistoryFile(asFile(new Uint8Array(200).fill(7)), PASS)).toEqual({ ok: false, problem: "passphrase" });
    expect(await readHistoryFile(asFile(new Uint8Array(0)), PASS)).toEqual({ ok: false, problem: "passphrase" });
    const huge = { size: MAX_HISTORY_FILE_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
    expect(await readHistoryFile(huge, PASS)).toEqual({ ok: false, problem: "too-big" });
  });

  it("knows whether there is anything to save", () => {
    expect(hasHistory(saved(ledger()))).toBe(false);
    expect(hasHistory(saved(FILE_LEDGER))).toBe(true);
    expect(hasHistory(saved(ledger(), { allowlist: ["x"] }))).toBe(true);
    expect(hasHistory(saved(ledger(), { checkedOff: ["x"] }))).toBe(true);
    expect(hasHistory(saved(ledger(), { ticks: ["t:i"] }))).toBe(true);
  });
});

describe("the reducer", () => {
  it("adds a file's history to what is on screen, and sets the clock only when nothing did", () => {
    const state: State = { ...initialState(), real: { ...initialState().real, ledger: ledger(snap("c", Date.UTC(2026, 10, 6), ["zqcanary_three"])), allowlist: ["mine"] } };
    const next = reduce(state, { type: "history-merged", saved: saved(FILE_LEDGER, { allowlist: ["theirs"] }), now: NOW });
    expect(next.real.ledger.snapshots.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(next.real.allowlist).toEqual(["mine", "theirs"]);
    expect(next.real.now).toBe(NOW);
    const clocked = reduce({ ...state, real: { ...state.real, now: 5 } }, { type: "history-merged", saved: saved(FILE_LEDGER), now: NOW });
    expect(clocked.real.now).toBe(5);
    expect(next.vault).toBe(state.vault);
  });
});

describe("Settings", () => {
  let dom: ReturnType<typeof installFakeDom>;
  let settingsView: (typeof import("../src/views/settings.ts"))["settingsView"];

  beforeAll(async () => {
    dom = installFakeDom();
    ({ settingsView } = await import("../src/views/settings.ts"));
  });
  beforeEach(() => {
    vi.mocked(announce).mockClear();
    vi.mocked(saveBlob).mockClear();
    FakeElement.lastFocused = null;
    (dom.document as { activeElement: unknown }).activeElement = null;
  });
  afterEach(() => vi.unstubAllGlobals());

  const noVault: VaultStore = { supported: () => false, read: async () => null, write: async () => {}, clear: async () => {} };
  const withHistory = (l: Ledger, patch: Partial<State> = {}): State => ({ ...initialState(), real: { ...initialState().real, ledger: l, now: NOW }, ...patch });

  function open(state: State, vault: VaultStore = noVault, store: Store = createStore(state)) {
    const actions = createActions(store, { vault, clock: () => NOW, yieldToUi: async () => {}, saveTheme: () => {} });
    const root = runInScope(new Scope(true), () => settingsView({ store, actions, terminal: testTerminal() })) as unknown as FakeElement;
    return { root, store, actions };
  }

  /** The passphrase form whose first field has this key prefix. */
  const formOf = (root: FakeElement, key: string): { form: FakeElement; fields: FakeElement[] } => {
    const first = root.querySelectorAll("input").find((i) => i.getAttribute("data-key") === `${key}:a`);
    if (!first) throw new Error(`no form ${key}`);
    let form: FakeElement | null = first.parentNode;
    while (form && form.tagName !== "form") form = form.parentNode;
    if (!form) throw new Error("no form element");
    return { form, fields: form.querySelectorAll("input").filter((i) => i.getAttribute("autocomplete") !== "username" && (i.getAttribute("type") === "password" || i.getAttribute("type") === "text")) };
  };
  /** Type into the form's password fields and press its button. What the form does with it is asynchronous: wait for the effect. */
  const submit = (form: FakeElement, ...values: string[]): void => {
    const fields = form.querySelectorAll("input").filter((i) => i.getAttribute("type") !== "checkbox" && i.getAttribute("autocomplete") !== "username");
    values.forEach((v, i) => void ((fields[i] as FakeElement).value = v));
    form.fire("submit");
  };
  const picker = (root: FakeElement): FakeElement => root.querySelectorAll("input").find((i) => i.getAttribute("type") === "file" && i.getAttribute("accept")?.includes(".sealed")) as FakeElement;
  const choose = (root: FakeElement, file: File): void => {
    const p = picker(root);
    p.files = [file];
    p.fire("change");
  };

  it("saves a file that opens with the passphrase typed, from a history that has something in it", async () => {
    const { root } = open(withHistory(FILE_LEDGER));
    expect(root.textContent).toContain(shellCopy.fileHeading);
    const { form } = formOf(root, "history-file-save");
    expect(form.querySelector("button[type=submit]")?.textContent).toBe(shellCopy.fileSaveButton);
    submit(form, PASS, PASS);
    await vi.waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1), { timeout: 20_000 });
    const [name, blob] = vi.mocked(saveBlob).mock.calls[0] as [string, Blob];
    expect(name).toBe(HISTORY_FILE_NAME);
    const opened = await readHistoryFile(blob, PASS);
    expect(opened.ok && opened.saved.ledger.snapshots.map((s) => s.id)).toEqual(["a", "b"]);
    expect(announce).toHaveBeenCalledWith(shellCopy.fileSavedAnnounce, false);
  }, 30_000);

  it("saves nothing when the passphrase is too short or the two do not match", async () => {
    const { root } = open(withHistory(FILE_LEDGER));
    const { form } = formOf(root, "history-file-save");
    submit(form, "short", "short");
    submit(form, PASS, OTHER);
    // Both are refused by the form itself, before anything is sealed.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("offers nothing to save before there is an export, and nothing at all while locked", () => {
    const empty = open(withHistory(ledger())).root;
    expect(empty.textContent).toContain(shellCopy.fileNothingNote);
    expect(() => formOf(empty, "history-file-save")).toThrow();
    const locked = open(withHistory(FILE_LEDGER, { vault: { supported: true, hasSaved: true, phase: "locked", busy: false } })).root;
    expect(locked.textContent).not.toContain(shellCopy.fileHeading);
  });

  it("opens a file: a wrong passphrase says so and adds nothing, the right one adds its exports and lists", async () => {
    const bytes = await buildHistoryFile(saved(FILE_LEDGER, { allowlist: ["theirs"] }), PASS);
    const state = withHistory(ledger(snap("c", Date.UTC(2026, 10, 6), ["zqcanary_three"])));
    const { root, store } = open(state);
    choose(root, asFile(bytes));
    expect(root.textContent).toContain(shellCopy.fileChosenNote);
    // The file's name is never shown.
    expect(root.textContent).not.toContain("anything.sealed");

    const { form } = formOf(root, "history-file-open");
    submit(form, OTHER);
    await vi.waitFor(() => expect(root.textContent).toContain(shellCopy.fileWrongNote), { timeout: 20_000 });
    expect(store.get().real.ledger.snapshots.map((s) => s.id)).toEqual(["c"]);

    submit(form, PASS);
    await vi.waitFor(() => expect(store.get().real.ledger.snapshots.map((s) => s.id)).toEqual(["a", "b", "c"]), { timeout: 20_000 });
    expect(store.get().real.allowlist).toEqual(["theirs"]);
    expect(announce).toHaveBeenCalledWith(shellCopy.fileOpened(2, true));
    // The form is gone, so a visible note says it worked and how many exports it added.
    expect(root.querySelectorAll(".toast")[0]?.textContent).toBe(shellCopy.fileOpened(2, true));
    // The section is drawn again with its two buttons back, and the Saved history card lists all three.
    expect(root.textContent).toContain(shellCopy.fileChooseButton);
    expect(root.querySelectorAll("li.history-row")).toHaveLength(3);
  }, 30_000);

  it("says what opening did: new exports, only changes to what was saved, or nothing new", async () => {
    const openWith = async (current: Ledger, file: { allowlist?: string[]; ledger: Ledger }): Promise<string> => {
      const bytes = await buildHistoryFile(saved(file.ledger, { allowlist: file.allowlist ?? [] }), PASS);
      const { root } = open(withHistory(current));
      choose(root, asFile(bytes));
      submit(formOf(root, "history-file-open").form, PASS);
      await vi.waitFor(() => expect(root.querySelectorAll(".toast")).toHaveLength(1), { timeout: 20_000 });
      return root.querySelectorAll(".toast")[0]!.textContent;
    };
    // Only the keep list differs: the old wording would have said there was nothing to add.
    expect(await openWith(FILE_LEDGER, { ledger: FILE_LEDGER, allowlist: ["theirs"] })).toBe(shellCopy.fileOpened(0, true));
    // The same exports and nothing else: nothing changed.
    expect(await openWith(FILE_LEDGER, { ledger: FILE_LEDGER })).toBe(shellCopy.fileOpened(0, false));
    // One new export.
    expect(await openWith(ledger(snap("c", Date.UTC(2026, 10, 6), ["zqcanary_three"])), { ledger: FILE_LEDGER })).toBe(shellCopy.fileOpened(2, true));
  }, 60_000);

  it("backs out of the passphrase question with Escape or Cancel and keeps what is on screen", () => {
    const { root, store } = open(withHistory(FILE_LEDGER));
    choose(root, asFile(new Uint8Array(40)));
    const box = root.querySelector(".history-open") as FakeElement;
    box.fire("keydown", { key: "Enter" });
    expect(root.textContent).toContain(shellCopy.fileChosenNote);
    box.fire("keydown", { key: "Escape" });
    expect(root.textContent).not.toContain(shellCopy.fileChosenNote);
    expect((FakeElement.lastFocused as FakeElement).getAttribute("data-key")).toBe("history-file-choose");

    choose(root, asFile(new Uint8Array(40)));
    (root.querySelectorAll("button").find((b) => b.textContent === shellCopy.fileCancelButton && b.getAttribute("data-key") === "history-file-cancel") as FakeElement).click();
    expect(root.textContent).not.toContain(shellCopy.fileChosenNote);
    expect(store.get().real.ledger.snapshots).toHaveLength(2);
  });

  it("an unlocked history saves what a file added: the sealed copy holds all the exports", async () => {
    let blob: Uint8Array | null = null;
    const vault: VaultStore = { supported: () => true, read: async () => blob, write: async (b) => void (blob = new Uint8Array(b)), clear: async () => void (blob = null) };
    const store = createStore(withHistory(ledger(snap("c", Date.UTC(2026, 10, 6), ["zqcanary_three"]))));
    const { root, actions } = open(store.get(), vault, store);
    expect(await actions.sealWith(PASS)).toBe(true);

    const file = await buildHistoryFile(saved(FILE_LEDGER), OTHER);
    choose(root, asFile(file));
    submit(formOf(root, "history-file-open").form, OTHER);
    await vi.waitFor(() => expect(store.get().real.ledger.snapshots).toHaveLength(3), { timeout: 20_000 });
    await actions.settled();
    expect(store.get().vault.phase).toBe("unlocked");
    const onDevice = unpackSaved(await openLedger(blob as unknown as Uint8Array, PASS));
    expect(onDevice.ledger.snapshots.map((s) => s.id)).toEqual(["a", "b", "c"]);
  }, 30_000);
});
