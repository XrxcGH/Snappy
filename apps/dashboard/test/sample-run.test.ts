/**
 * Run on the sample data: while the sample is showing and no export was picked, a command that only reads an export runs on the
 * made-up sample export. A command that saves the history or asks for a passphrase never does, the files a person picked always
 * win, and Lock or Delete data forgets the generated sample.
 */
import { bytesReader, parseExportFromReader } from "@snappy-export/core";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actions } from "../src/actions.ts";
import { commandBlock } from "../src/components/commandBlock.ts";
import { terminal } from "../src/copy.ts";
import { terminalTools } from "../src/copy-tools.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { SAMPLE_NOW, buildSampleWorkspace } from "../src/sample.ts";
import { createStore } from "../src/store.ts";
import { COMMANDS, COMMAND_IDS, bindArgv } from "../src/terminal/commands.ts";
import type { CommandId } from "../src/terminal/commands.ts";
import type { ToWorker } from "../src/terminal/protocol.ts";
import type { Channel, RunFile } from "../src/terminal/run-types.ts";
import { SAMPLE_ZIP_NAME, canUseSample, sampleRunFiles } from "../src/terminal/sample-files.ts";
import { createTerminalSession } from "../src/terminal/session.ts";
import type { FakeElement } from "./fake-dom.ts";
import { installFakeDom } from "./fake-dom.ts";
import { runInHelper } from "./helper-harness.ts";

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A session whose helper is a recording channel: what the page posts to it is what a Run would have read. */
function recordingSession(sampleFiles?: () => RunFile[]) {
  const sent: ToWorker[] = [];
  let hear: (message: unknown) => void = () => undefined;
  // The helper reads nothing and exits at once, so one Run ends before the next begins.
  const channel: Channel = {
    post: (m) => {
      sent.push(m);
      if (m.type === "run") queueMicrotask(() => hear({ type: "exit", code: 0 }));
    },
    onMessage: (handler) => void (hear = handler),
    onFailure: () => undefined,
    stop: () => undefined,
  };
  const session = createTerminalSession({
    spawn: () => channel,
    vault: { supported: () => false, read: async () => null, write: async () => undefined, clear: async () => undefined },
    vaultPhase: () => "locked",
    announce: () => undefined,
    coarse: false,
    ...(sampleFiles ? { sampleFiles } : {}),
  });
  return { session, sent };
}

const filesOf = (message: ToWorker | undefined): string[] => (message?.type === "run" ? message.files.map((f) => f.name) : []);

describe("the sample export as files", () => {
  it("is one ZIP named like the first part Snapchat hands out, and reads as the same export the dashboard's sample shows", async () => {
    installFakeDom();
    const files = sampleRunFiles();
    expect(files.map((f) => f.name)).toEqual([SAMPLE_ZIP_NAME]);
    expect(SAMPLE_ZIP_NAME).toBe(`mydata~${SAMPLE_NOW}.zip`);
    expect(SAMPLE_ZIP_NAME).toMatch(/^mydata~\d{13}\.zip$/);
    const bytes = new Uint8Array(await (files[0] as RunFile).blob.arrayBuffer());
    const parsed = await parseExportFromReader(bytesReader(bytes));
    const workspace = await buildSampleWorkspace();
    expect(parsed.friends.friends.length).toBe(workspace.latest?.friends.friends.length);
    expect(parsed.friends.friends.length).toBeGreaterThan(50);
  });

  it("may feed a command that only reads, and never one that saves the history or asks for a passphrase", () => {
    const allowed = COMMAND_IDS.filter((id) => canUseSample(COMMANDS[id]));
    expect(allowed).toEqual(expect.arrayContaining(["inspect", "check", "storage", "memories-preview", "memories-rescue", "friend-count", "habits"] satisfies CommandId[]));
    for (const id of ["analyze-save", "since", "ledger-status", "help", "demo-run", "safety", "privacy", "remind"] satisfies CommandId[]) expect(allowed, id).not.toContain(id);
    for (const id of allowed) {
      expect(COMMANDS[id].needsFile, id).toBe(true);
      expect(COMMANDS[id].effect, id).not.toBe("store");
      expect(COMMANDS[id].needsPassphrase, id).toBe(false);
    }
  });
});

describe("the real commands on the sample files", () => {
  it("every command the sample may feed reads it and exits cleanly", async () => {
    const files = sampleRunFiles();
    const ids = COMMAND_IDS.filter((id) => canUseSample(COMMANDS[id]));
    expect(ids.length).toBeGreaterThan(15);
    const failures: string[] = [];
    for (const id of ids) {
      const spec = COMMANDS[id];
      const r = await runInHelper(bindArgv(spec, { export: [SAMPLE_ZIP_NAME] }), { files });
      // The rescue exits 3 ("some items failed") when a Memory has no file in the ZIP, as a few of the sample's do on purpose.
      const clean = id === "memories-rescue" ? [0, 3] : [0];
      if (!clean.includes(r.code)) failures.push(`${id}: exit ${r.code}: ${r.out.slice(0, 120)}`);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});

describe("a Run while the sample data is showing", () => {
  it("reads the sample export when nothing was picked", async () => {
    const { session, sent } = recordingSession();
    session.sampleMode(true);
    expect(session.usesSample(COMMANDS.check)).toBe(true);
    session.controller.request("check");
    await tick(20);
    expect(filesOf(sent[0])).toEqual([SAMPLE_ZIP_NAME]);
    expect(sent[0]?.type === "run" ? sent[0].argv : []).toEqual(["check", `/in/${SAMPLE_ZIP_NAME}`]);
    session.reset();
  });

  it("does not read it for a command that saves the history or needs a passphrase: those still ask for a real export", async () => {
    const { session, sent } = recordingSession();
    session.sampleMode(true);
    for (const id of ["analyze-save", "since"] as const) {
      expect(session.usesSample(COMMANDS[id]), id).toBe(false);
      session.controller.request(id);
      expect(session.controller.state(id), id).toEqual({ kind: "needs-file" });
    }
    await tick(20);
    expect(sent).toEqual([]);
  });

  it("needs a real export when the sample is not showing", async () => {
    const { session, sent } = recordingSession();
    expect(session.usesSample(COMMANDS.check)).toBe(false);
    session.controller.request("check");
    expect(session.controller.state("check")).toEqual({ kind: "needs-file" });
    session.sampleMode(true);
    session.sampleMode(false);
    session.controller.request("check");
    expect(session.controller.state("check")).toEqual({ kind: "needs-file" });
    await tick(20);
    expect(sent).toEqual([]);
  });

  it("prefers the files the person picked over the sample", async () => {
    const { session, sent } = recordingSession();
    session.sampleMode(true);
    session.picked.add([Object.assign(new Blob(["x"]), { name: "mine.zip" })]);
    expect(session.usesSample(COMMANDS.check)).toBe(false);
    session.controller.request("check");
    await tick(20);
    expect(filesOf(sent[0])).toEqual(["mine.zip"]);
    session.reset();
  });

  it("builds the sample once, and forgets it on Lock or Delete data", async () => {
    let built = 0;
    const { session } = recordingSession(() => {
      built++;
      return [{ name: SAMPLE_ZIP_NAME, blob: new Blob(["z"]) }];
    });
    session.sampleMode(true);
    session.controller.request("check");
    await tick(20);
    session.controller.close("check");
    session.controller.request("check");
    await tick(20);
    expect(built).toBe(1);
    session.reset();
    await tick(20);
    session.sampleMode(true);
    session.controller.request("check");
    await tick(20);
    expect(built).toBe(2);
    session.reset();
  });
});

describe("the command block while the sample data is showing", () => {
  let sample: State;
  beforeAll(async () => {
    installFakeDom();
    sample = { ...initialState(), sample: await buildSampleWorkspace() };
  }, 120_000);

  function block(id: CommandId, state: State) {
    const store = createStore(state);
    const session = recordingSession().session;
    const ctx = { store, actions: {} as Actions, terminal: session };
    const el = runInScope(new Scope(true), () => commandBlock(ctx, id, { key: id })) as unknown as FakeElement;
    const run = el.querySelector(".command-head")?.querySelectorAll("button")[1] as FakeElement;
    const hint = el.querySelector(".command-hint") as FakeElement;
    return { el, run, hint, store, session };
  }

  it("lets Run start on the sample for a command that only reads, and says that it uses the sample", () => {
    const { run, hint } = block("check", sample);
    expect(run.getAttribute("aria-disabled")).toBeNull();
    expect(run.getAttribute("aria-describedby")).toBeNull();
    expect(hint.textContent).toBe(terminalTools.usingSample);
  });

  it("still asks for a real export for a command that saves the history, and with no sample showing", () => {
    for (const [id, state] of [["analyze-save", sample], ["since", sample], ["check", initialState()]] as const) {
      const { run, hint } = block(id, state);
      expect(run.getAttribute("aria-disabled"), id).toBe("true");
      expect(hint.textContent, id).toBe(terminal.needsFileHint);
      expect(run.getAttribute("aria-describedby"), id).toBe(hint.getAttribute("id"));
    }
  });

  it("follows the sample being turned on and off, and a picked export", () => {
    const { run, hint, store, session } = block("check", initialState());
    expect(run.getAttribute("aria-disabled")).toBe("true");
    store.dispatch({ type: "sample-loaded", workspace: sample.sample as NonNullable<State["sample"]> });
    expect(run.getAttribute("aria-disabled")).toBeNull();
    expect(hint.textContent).toBe(terminalTools.usingSample);
    session.picked.add([Object.assign(new Blob(["x"]), { name: "mine.zip" })]);
    expect(hint.textContent).toBe("");
    session.picked.clear();
    expect(hint.textContent).toBe(terminalTools.usingSample);
    store.dispatch({ type: "sample-cleared" });
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(hint.textContent).toBe(terminal.needsFileHint);
  });

  it("starts the Run on the sample when Run is pressed", async () => {
    const sent: ToWorker[] = [];
    const channel: Channel = { post: (m) => void sent.push(m), onMessage: () => undefined, onFailure: () => undefined, stop: () => undefined };
    const session = createTerminalSession({ spawn: () => channel, vault: { supported: () => false, read: async () => null, write: async () => undefined, clear: async () => undefined }, vaultPhase: () => "locked", announce: () => undefined, coarse: false });
    const ctx = { store: createStore(sample), actions: {} as Actions, terminal: session };
    const el = runInScope(new Scope(true), () => commandBlock(ctx, "storage", { key: "storage" })) as unknown as FakeElement;
    (el.querySelector(".command-head")?.querySelectorAll("button")[1] as FakeElement).click();
    await tick(20);
    expect(filesOf(sent[0])).toEqual([SAMPLE_ZIP_NAME]);
    session.reset();
  });
});
