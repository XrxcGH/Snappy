/**
 * Lock and Delete data say the screen is cleared. The command blocks live outside the dashboard's store, so
 * they must be cleared with it: the transcripts, the files a command saved, the picked export files, and a
 * Run that is still working.
 */
import { describe, expect, it } from "vitest";
import { createActions } from "../src/actions.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import { createTerminalSession } from "../src/terminal/session.ts";
import type { TerminalSession } from "../src/terminal/session.ts";
import type { Channel } from "../src/terminal/run-types.ts";
import type { VaultStore } from "../src/vault.ts";

interface FakeChannel extends Channel {
  sent: { type: string }[];
  emit(message: unknown): void;
}

function fakeChannel(): FakeChannel {
  let onMessage: (m: unknown) => void = () => undefined;
  const channel: FakeChannel = {
    sent: [],
    post: (m) => void channel.sent.push(structuredClone(m)),
    onMessage: (h) => void (onMessage = h),
    onFailure: () => undefined,
    stop: () => undefined,
    emit: (m) => onMessage(structuredClone(m)),
  };
  return channel;
}

const vault: VaultStore & { cleared: number } = {
  cleared: 0,
  supported: () => true,
  read: async () => null,
  write: async () => undefined,
  clear: async () => void vault.cleared++,
};

const RESCUE = "memories-rescue" as const;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const zip = (name: string): File => new File([new Uint8Array([1, 2, 3])], name, { type: "application/zip" });

function page() {
  const channels: FakeChannel[] = [];
  const session: TerminalSession = createTerminalSession({
    spawn: () => {
      const c = fakeChannel();
      channels.push(c);
      return c;
    },
    vault,
    vaultPhase: () => "locked",
    announce: () => undefined,
    coarse: false,
  });
  const store = createStore(initialState());
  const actions = createActions(store, { vault, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {}, onWipe: () => session.reset() });
  return { session, channels, store, actions };
}

/** Press Run on the rescue and approve the write, as a person does. */
function begin(p: ReturnType<typeof page>): void {
  p.session.controller.request(RESCUE);
  p.session.controller.approve(RESCUE);
}

/** One finished Run of "Rescue your Memories", with a transcript that must not outlive Lock. */
async function finishedRun(p: ReturnType<typeof page>): Promise<void> {
  p.session.picked.add([zip("mydata~1.zip")]);
  begin(p);
  await tick();
  const channel = p.channels[0] as FakeChannel;
  channel.emit({ type: "out", text: "oneway_1 is in your cleanup queue\n" });
  channel.emit({ type: "files", files: [{ path: "memories/a.jpg", bytes: new Uint8Array(3), mtimeMs: 1 }] });
  channel.emit({ type: "exit", code: 0 });
  await tick();
  expect(p.session.controller.state(RESCUE).kind).toBe("finished");
  expect(p.session.controller.transcript(RESCUE).plainText()).toContain("oneway_1");
  expect(p.session.controller.files(RESCUE)).toHaveLength(1);
  expect(p.session.picked.count()).toBe(1);
}

describe("Lock", () => {
  it("clears the transcript, the saved files and the picked export files of a finished Run", async () => {
    const p = page();
    await finishedRun(p);
    await p.actions.lock();
    expect(p.session.controller.state(RESCUE)).toEqual({ kind: "idle" });
    expect(p.session.controller.transcript(RESCUE).plainText()).toBe("");
    expect(p.session.controller.files(RESCUE)).toEqual([]);
    expect(p.session.picked.count()).toBe(0);
    expect(p.session.picked.files()).toEqual([]);
  });

  it("tells every open block, so the screen is drawn empty", async () => {
    const p = page();
    await finishedRun(p);
    const seen: string[] = [];
    p.session.controller.subscribe(RESCUE, () => seen.push(p.session.controller.state(RESCUE).kind));
    let pickedChanged = 0;
    p.session.picked.subscribe(() => pickedChanged++);
    await p.actions.lock();
    expect(seen).toEqual(["idle"]);
    expect(pickedChanged).toBe(1);
  });

  it("stops a Run that is still working, and nothing it says afterwards comes back", async () => {
    const p = page();
    p.session.picked.add([zip("mydata~1.zip")]);
    begin(p);
    await tick();
    const channel = p.channels[0] as FakeChannel;
    channel.emit({ type: "out", text: "first line\n" });
    await p.actions.lock();
    expect(channel.sent.some((m) => m.type === "cancel")).toBe(true);
    expect(p.session.controller.transcript(RESCUE).plainText()).toBe("");
    // The helper was still working: its late output and files are dropped, and the block stays at its start.
    channel.emit({ type: "out", text: "late line\n" });
    channel.emit({ type: "files", files: [{ path: "x.txt", bytes: new Uint8Array(1), mtimeMs: 1 }] });
    channel.emit({ type: "exit", code: 130 });
    await tick();
    expect(p.session.controller.state(RESCUE)).toEqual({ kind: "idle" });
    expect(p.session.controller.transcript(RESCUE).plainText()).toBe("");
    expect(p.session.controller.files(RESCUE)).toEqual([]);
    expect(p.session.controller.busy()).toBeNull();
  });

  it("answers a passphrase question that is open with a cancel", async () => {
    const p = page();
    p.session.picked.add([zip("mydata~1.zip")]);
    p.session.controller.request("ledger-status");
    await tick();
    const channel = p.channels[0] as FakeChannel;
    channel.emit({ type: "ask-secret", id: 1, question: "Passphrase for your saved history: " });
    await tick();
    expect(p.session.controller.state("ledger-status").kind).toBe("asking");
    await p.actions.lock();
    expect(p.session.controller.state("ledger-status")).toEqual({ kind: "idle" });
    expect(p.session.controller.transcript("ledger-status").plainText()).toBe("");
  });
});

describe("Delete data", () => {
  it("clears the command output and the picked files too", async () => {
    const p = page();
    await finishedRun(p);
    expect(await p.actions.deleteAll()).toBe(true);
    expect(p.session.controller.state(RESCUE)).toEqual({ kind: "idle" });
    expect(p.session.controller.transcript(RESCUE).plainText()).toBe("");
    expect(p.session.controller.files(RESCUE)).toEqual([]);
    expect(p.session.picked.count()).toBe(0);
  });

  it("keeps them when the delete fails, because nothing was cleared", async () => {
    const p = page();
    await finishedRun(p);
    const failing: VaultStore = { ...vault, clear: async () => Promise.reject(new Error("blocked")) };
    const actions = createActions(p.store, { vault: failing, clock: () => 0, yieldToUi: async () => {}, saveTheme: () => {}, onWipe: () => p.session.reset() });
    expect(await actions.deleteAll()).toBe(false);
    expect(p.session.controller.transcript(RESCUE).plainText()).toContain("oneway_1");
    expect(p.session.picked.count()).toBe(1);
  });
});

describe("a command that saves history", () => {
  it("locks an open history without clearing the Run that is starting", async () => {
    const p = page();
    p.session.picked.add([zip("mydata~1.zip")]);
    begin(p);
    await tick();
    // The dashboard's own history is closed before a saving command starts; that is not Lock.
    await p.actions.beforeStoreRun();
    expect(p.session.picked.count()).toBe(1);
    expect(p.session.controller.state(RESCUE).kind).toBe("running");
  });
});
