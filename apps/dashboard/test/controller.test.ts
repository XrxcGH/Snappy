/**
 * The controller's state machine, against a fake runner that the test drives by hand.
 */
import { describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../src/terminal/commands.ts";
import type { CommandId } from "../src/terminal/commands.ts";
import { createTerminalController, exitLabel } from "../src/terminal/controller.ts";
import type { ControllerDeps } from "../src/terminal/controller.ts";
import type { OutFile, RunHandle, RunHooks, RunInput, RunResult, Runner } from "../src/terminal/run-types.ts";
import { createTerminalSession } from "../src/terminal/session.ts";
import { terminal } from "../src/copy.ts";
import { terminalTools } from "../src/copy-tools.ts";

interface Started {
  input: RunInput;
  hooks: RunHooks;
  finish(result: RunResult): void;
  canceled: number;
}

function setup(over: Partial<ControllerDeps> = {}) {
  const started: Started[] = [];
  const announced: [string, boolean][] = [];
  const log = { before: 0, after: 0, order: [] as string[] };
  const runner: Runner = {
    run(input, hooks): RunHandle {
      let finish: (r: RunResult) => void = () => undefined;
      const done = new Promise<RunResult>((r) => (finish = r));
      const run: Started = { input, hooks, finish: (r) => finish(r), canceled: 0 };
      started.push(run);
      log.order.push("run");
      return { done, cancel: () => void run.canceled++ };
    },
  };
  const files = [{ name: "mydata~1.zip", blob: new Blob(["x"]) }];
  const deps: ControllerDeps = {
    runner,
    getFiles: () => files,
    announce: (m, assertive) => void announced.push([m, assertive === true]),
    columns: () => 72,
    beforeStoreRun: async () => void (log.before++, log.order.push("before")),
    afterStoreRun: async () => void (log.after++, log.order.push("after")),
    workerAvailable: () => true,
    ...over,
  };
  const controller = createTerminalController(deps);
  return { controller, started, announced, log, files };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const ok = (code = 0): RunResult => ({ end: "done", code, ms: 1200 });

describe("a read-only command", () => {
  it("goes idle, running, finished, and runs with the picked files and the panel width", async () => {
    const { controller, started, announced } = setup();
    const seen: string[] = [];
    controller.subscribe("inspect", () => seen.push(controller.state("inspect").kind));
    expect(controller.state("inspect")).toEqual({ kind: "idle" });
    controller.request("inspect");
    expect(controller.state("inspect")).toEqual({ kind: "running" });
    expect(controller.busy()).toBe("inspect");
    await tick();
    const run = started[0] as Started;
    expect(run.input.argv).toEqual(["inspect", "/in/mydata~1.zip"]);
    expect(run.input.columns).toBe(72);
    expect(run.input.spec).toBe(COMMANDS.inspect);
    run.hooks.onOut("hello\n");
    run.finish(ok());
    await tick();
    expect(controller.state("inspect")).toMatchObject({ kind: "finished", result: { end: "done", code: 0 } });
    expect(controller.busy()).toBeNull();
    expect(controller.transcript("inspect").plainText()).toBe("hello\n");
    expect(controller.exitLabel("inspect")).toBe("Done");
    expect(seen).toContain("running");
    // The title leads, so several blocks on one page can be told apart.
    expect(announced[0]).toEqual([`${COMMANDS.inspect.title}: running`, false]);
    expect(announced[0]?.[0]).toBe(terminalTools.startedFor(COMMANDS.inspect.title));
    expect(announced.at(-1)).toEqual([terminal.doneAnnounce(COMMANDS.inspect.title, "Done", 0), false]);
  });

  it("says which block started: the start announcement of two commands differs by their titles", async () => {
    for (const id of ["help", "demo-run"] as const) {
      const { controller, announced } = setup({ getFiles: () => [] });
      controller.request(id);
      await tick();
      expect(announced[0]?.[0]).toBe(`${COMMANDS[id].title}: running`);
    }
    expect(terminalTools.startedFor("Show the commands")).toBe("Show the commands: running");
  });

  it("starts at once for a command that needs no file", async () => {
    const { controller, started } = setup({ getFiles: () => [] });
    controller.request("help");
    await tick();
    expect(started[0]?.input.argv).toEqual(["help"]);
  });

  it("replaces the last transcript with the next Run, and clears it on Close", async () => {
    const { controller, started } = setup();
    controller.request("help");
    await tick();
    started[0]?.hooks.onOut("first run\n");
    started[0]?.finish(ok());
    await tick();
    controller.request("help");
    await tick();
    expect(controller.transcript("help").plainText()).toBe("");
    started[1]?.hooks.onOut("second run\n");
    started[1]?.finish(ok());
    await tick();
    expect(controller.transcript("help").plainText()).toBe("second run\n");
    controller.close("help");
    expect(controller.transcript("help").plainText()).toBe("");
    expect(controller.state("help")).toEqual({ kind: "idle" });
  });
});

describe("Run without a file", () => {
  it("says to choose the export first, starts nothing, and says it again on the next press", async () => {
    const { controller, started, announced } = setup({ getFiles: () => [] });
    controller.request("analyze-preview");
    expect(controller.state("analyze-preview")).toEqual({ kind: "needs-file" });
    controller.request("analyze-preview");
    await tick();
    expect(started).toHaveLength(0);
    expect(announced.filter(([m]) => m === terminal.needsFileHint)).toHaveLength(2);
    expect(controller.busy()).toBeNull();
  });
});

describe("one Run at a time", () => {
  it("turns away every other block while one runs, and lets them go once it ends", async () => {
    const { controller, started } = setup();
    const seen: number[] = [];
    controller.subscribeBusy(() => seen.push(1));
    controller.request("inspect");
    controller.request("analyze-preview");
    controller.request("help");
    controller.request("inspect"); // a second press on the same block
    await tick();
    expect(started).toHaveLength(1);
    expect(controller.state("analyze-preview")).toEqual({ kind: "idle" });
    expect(controller.state("help")).toEqual({ kind: "idle" });
    started[0]?.finish(ok());
    await tick();
    controller.request("help");
    await tick();
    expect(started).toHaveLength(2);
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps running, and reattaches, when the page shows something else", async () => {
    const { controller, started } = setup();
    let heard = 0;
    const off = controller.subscribe("inspect", () => heard++);
    controller.request("inspect");
    await tick();
    off(); // the block left the page
    started[0]?.hooks.onOut("while away\n");
    expect(heard).toBeGreaterThan(0);
    const before = heard;
    started[0]?.hooks.onOut("more\n");
    expect(heard).toBe(before);
    // Back on the page: the new block reads the transcript and the state from the controller.
    expect(controller.state("inspect")).toEqual({ kind: "running" });
    expect(controller.transcript("inspect").plainText()).toBe("while away\nmore\n");
    started[0]?.finish(ok());
    await tick();
    expect(controller.state("inspect").kind).toBe("finished");
  });
});

describe("a command that writes", () => {
  it("asks first, every time, and does nothing until the person confirms", async () => {
    const { controller, started } = setup();
    controller.request("memories-rescue");
    expect(controller.state("memories-rescue")).toEqual({ kind: "confirming", effect: "folder" });
    expect(controller.busy()).toBeNull();
    controller.decline("memories-rescue");
    expect(controller.state("memories-rescue")).toEqual({ kind: "idle" });
    controller.request("memories-rescue");
    controller.approve("memories-rescue");
    await tick();
    expect(started).toHaveLength(1);
    started[0]?.finish(ok());
    await tick();
    // Confirmation is never remembered.
    controller.request("memories-rescue");
    expect(controller.state("memories-rescue")).toEqual({ kind: "confirming", effect: "folder" });
    expect(started).toHaveLength(1);
  });

  it("does not run when approve is called without a question, or while another Run is going", async () => {
    const { controller, started } = setup();
    controller.approve("memories-rescue");
    controller.request("inspect");
    controller.approve("analyze-save");
    await tick();
    expect(started).toHaveLength(1);
  });

  it("locks the dashboard's history before a command saves it, and looks again afterwards", async () => {
    const { controller, started, log } = setup();
    controller.request("analyze-save");
    expect(controller.state("analyze-save")).toEqual({ kind: "confirming", effect: "store" });
    controller.approve("analyze-save");
    await tick();
    expect(log.order).toEqual(["before", "run"]);
    started[0]?.finish(ok());
    await tick();
    expect(log.order).toEqual(["before", "run", "after"]);
    // Even a failed or stopped command is followed by a look.
    controller.request("analyze-save");
    controller.approve("analyze-save");
    await tick();
    started[1]?.finish({ end: "canceled", code: 130, ms: 5 });
    await tick();
    expect(log.after).toBe(2);
  });

  it("leaves the history alone for commands that do not save it", async () => {
    const { controller, started, log } = setup();
    controller.request("ledger-status");
    await tick();
    started[0]?.finish(ok());
    await tick();
    expect(log).toMatchObject({ before: 0, after: 0 });
  });

  it("holds the files a command saved, replaces them on the next Run, and forgets them on request or Close", async () => {
    const { controller, started } = setup();
    const file: OutFile = { path: "memories/a.jpg", bytes: new Uint8Array(3), mtimeMs: 1 };
    controller.request("memories-rescue");
    controller.approve("memories-rescue");
    await tick();
    started[0]?.hooks.onFiles([file]);
    started[0]?.finish(ok());
    await tick();
    expect(controller.files("memories-rescue")).toEqual([file]);
    controller.clearFiles("memories-rescue");
    expect(controller.files("memories-rescue")).toEqual([]);
    expect(controller.state("memories-rescue").kind).toBe("finished");
    controller.request("memories-rescue");
    controller.approve("memories-rescue");
    await tick();
    started[1]?.hooks.onFiles([file]);
    started[1]?.finish(ok());
    await tick();
    controller.close("memories-rescue");
    expect(controller.files("memories-rescue")).toEqual([]);
  });
});

describe("passphrase questions", () => {
  it("shows the question, takes the answer, and writes only the question and a line break in the transcript", async () => {
    const { controller, started, announced } = setup();
    controller.request("ledger-status");
    await tick();
    const run = started[0] as Started;
    const answered = run.hooks.askSecret("Passphrase for your saved history: ");
    expect(controller.state("ledger-status")).toEqual({ kind: "asking", question: "Passphrase for your saved history: " });
    expect(announced.some(([m]) => m === terminal.askingAnnounce)).toBe(true);
    controller.answerSecret("ledger-status", "CANARY-secret-value");
    expect(await answered).toBe("CANARY-secret-value");
    expect(controller.state("ledger-status")).toEqual({ kind: "running" });
    expect(controller.transcript("ledger-status").plainText()).toBe("Passphrase for your saved history: \n");
    run.finish(ok());
    await tick();
  });

  it("answers null when the person cancels, and ignores an answer when nothing was asked", async () => {
    const { controller, started } = setup();
    controller.request("ledger-status");
    await tick();
    const run = started[0] as Started;
    controller.answerSecret("ledger-status", "nobody asked");
    const answered = run.hooks.askSecret("Q: ");
    controller.answerSecret("ledger-status", null);
    expect(await answered).toBeNull();
    run.finish({ end: "done", code: 130, ms: 3 });
    await tick();
  });

  it("answers a pending question with null when Stop is pressed, and asks the runner to stop", async () => {
    const { controller, started, announced } = setup();
    controller.request("ledger-status");
    await tick();
    const run = started[0] as Started;
    const answered = run.hooks.askSecret("Q: ");
    controller.stop("ledger-status");
    expect(await answered).toBeNull();
    expect(run.canceled).toBe(1);
    expect(announced.some(([m]) => m === terminal.stoppingAnnounce)).toBe(true);
    run.finish({ end: "canceled", code: 130, ms: 3 });
    await tick();
    expect(controller.exitLabel("ledger-status")).toBe("Stopped");
  });

  it("keeps a distinctive answer out of the state, the transcript, the announcements and the console", async () => {
    const PASS = "CANARY-pass-phrase-zq81";
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    const { controller, started, announced } = setup();
    controller.request("analyze-save");
    controller.approve("analyze-save");
    await tick();
    const run = started[0] as Started;
    const answered = run.hooks.askSecret("Passphrase for your saved history: ");
    controller.answerSecret("analyze-save", PASS);
    await answered;
    run.hooks.onOut("Done.\n");
    run.finish(ok());
    await tick();
    const everything = JSON.stringify([controller.state("analyze-save"), controller.transcript("analyze-save").plainText(), controller.transcript("analyze-save").lines, controller.files("analyze-save"), announced, controller.exitLabel("analyze-save")]);
    expect(everything).not.toContain(PASS);
    expect(everything).not.toContain("CANARY");
    for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toContain("CANARY");
    vi.restoreAllMocks();
  });
});

describe("stopping", () => {
  it("asks the runner to stop and ends when it reports", async () => {
    const { controller, started } = setup();
    controller.request("inspect");
    await tick();
    controller.stop("inspect");
    expect(started[0]?.canceled).toBe(1);
    // Shown at once, before the runner reports.
    expect(controller.state("inspect")).toEqual({ kind: "stopping" });
    started[0]?.finish({ end: "terminated", code: 130, ms: 3000 });
    await tick();
    expect(controller.state("inspect")).toMatchObject({ kind: "finished", result: { end: "terminated" } });
    expect(controller.exitLabel("inspect")).toBe("Stopped");
  });

  it("shows Stopping until the runner reports, and Close, Run and a second Stop do nothing meanwhile", async () => {
    const { controller, started, announced } = setup();
    controller.request("inspect");
    await tick();
    controller.stop("inspect");
    expect(controller.state("inspect")).toEqual({ kind: "stopping" });
    expect(controller.busy()).toBe("inspect");
    expect(announced.filter(([m]) => m === terminal.stoppingAnnounce)).toHaveLength(1);
    controller.stop("inspect");
    controller.close("inspect");
    controller.request("inspect");
    expect(started).toHaveLength(1);
    expect(started[0]?.canceled).toBe(1);
    expect(controller.state("inspect")).toEqual({ kind: "stopping" });
    started[0]?.finish({ end: "canceled", code: 130, ms: 5 });
    await tick();
    expect(controller.state("inspect")).toMatchObject({ kind: "finished", result: { end: "canceled" } });
    expect(controller.busy()).toBeNull();
  });

  it("answers a passphrase question that is open when Stop is pressed, and a late question after it", async () => {
    const { controller, started } = setup();
    controller.request("ledger-status");
    await tick();
    const run = started[0] as Started;
    const first = run.hooks.askSecret("Passphrase for your saved history: ");
    controller.stop("ledger-status");
    expect(await first).toBeNull();
    expect(controller.state("ledger-status")).toEqual({ kind: "stopping" });
    expect(await run.hooks.askSecret("Again: ")).toBeNull();
    expect(controller.state("ledger-status")).toEqual({ kind: "stopping" });
    run.finish({ end: "canceled", code: 130, ms: 5 });
    await tick();
  });

  it("does nothing for a block that is not running, and Close does not interrupt a Run", async () => {
    const { controller, started } = setup();
    controller.stop("inspect");
    controller.request("inspect");
    await tick();
    controller.close("inspect");
    expect(controller.state("inspect")).toEqual({ kind: "running" });
    controller.stop("help");
    expect(started[0]?.canceled).toBe(0);
  });
});

describe("when a command cannot run here", () => {
  it("says so for a command that needs a terminal, without starting anything", () => {
    const { controller, started } = setup();
    const spec = COMMANDS.help as { network: boolean };
    const saved = spec.network;
    try {
      (COMMANDS.help as { network: boolean }).network = true;
      controller.request("help");
      expect(controller.state("help")).toEqual({ kind: "unavailable", reason: "network" });
      expect(started).toHaveLength(0);
    } finally {
      (COMMANDS.help as { network: boolean }).network = saved;
    }
  });

  it("says so when this browser has no worker, in a session whose runner cannot start one", async () => {
    const session = createTerminalSession({ spawn: () => null, vault: { supported: () => false, read: async () => null, write: async () => undefined, clear: async () => undefined }, vaultPhase: () => "locked", announce: () => undefined, getFiles: () => [{ name: "a.zip", blob: new Blob(["x"]) }] });
    session.controller.request("inspect");
    await tick();
    await tick();
    expect(session.controller.state("inspect")).toEqual({ kind: "unavailable", reason: "no-worker" });
    expect(session.supported).toBe(false);
    expect(session.controller.busy()).toBeNull();
    // A second press answers at once, without trying again.
    session.controller.request("help");
    expect(session.controller.state("help")).toEqual({ kind: "unavailable", reason: "no-worker" });
  });

  it("shows a helper that stops unexpectedly as a failed Run, announced as a problem", async () => {
    const { controller, started, announced } = setup();
    controller.request("inspect");
    await tick();
    started[0]?.finish({ end: "failed", code: null, ms: 40 });
    await tick();
    expect(controller.exitLabel("inspect")).toBe("The command stopped");
    expect(announced.at(-1)?.[1]).toBe(true);
  });

  it("turns a runner that throws into a failed Run instead of crashing", async () => {
    const { controller } = setup({
      runner: {
        run: () => {
          throw new Error("boom");
        },
      },
    });
    controller.request("inspect");
    await tick();
    expect(controller.state("inspect")).toMatchObject({ kind: "finished", result: { end: "failed" } });
    expect(controller.busy()).toBeNull();
  });
});

describe("exitLabel", () => {
  const label = (id: CommandId, result: RunResult): string => exitLabel(COMMANDS[id], result);
  it("says what each exit code means for each command, from the commands' own usage text", () => {
    expect(label("inspect", ok(0))).toBe("Done");
    expect(label("inspect", ok(1))).toBe("Could not run");
    expect(label("inspect", ok(2))).toBe("Export has errors");
    expect(label("analyze-preview", ok(2))).toBe("Export has errors");
    expect(label("memories-rescue", ok(3))).toBe("Finished, some items failed");
    expect(label("memories-rescue", ok(2))).toBe("Could not run");
    expect(label("ledger-status", ok(3))).toBe("Could not run");
    expect(label("help", ok(7))).toBe("Could not run");
    expect(label("inspect", ok(130))).toBe("Stopped");
    expect(label("inspect", { end: "canceled", code: 130, ms: 1 })).toBe("Stopped");
    expect(label("inspect", { end: "terminated", code: 130, ms: 1 })).toBe("Stopped");
    expect(label("inspect", { end: "blocked", code: null, ms: 0 })).toBe("Needs a terminal on your computer");
    expect(label("inspect", { end: "failed", code: null, ms: 0 })).toBe("The command stopped");
  });
});
