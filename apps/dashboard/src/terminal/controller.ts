/**
 * The state of every command block on the page, and what happens when a person presses Run. It keeps
 * one small state machine per command, one transcript per command in memory only, and one lock: a single
 * Run at a time for the whole page. A Run continues if the person goes to another page; the block
 * picks it up again when they come back.
 *
 *   idle -> needs-file                    Run without export files: say so, do nothing
 *   idle -> confirming -> running         a command that writes asks first, every time, never remembered
 *   idle -> running -> asking -> running  a passphrase question, answered in a masked field
 *   running -> stopping -> finished       Stop shows at once; the helper may take a moment to end
 *   running -> finished                   with how it ended and how long it took
 *   idle -> unavailable                   this browser has no worker, or the command needs a terminal
 *
 * Nothing here is saved: no storage, no history of commands, no copy of an answer to a question. The
 * transcript is replaced by the next Run of the same command and cleared on Close.
 */
import { bindArgv, COMMANDS } from "./commands.ts";
import type { CommandId, CommandSpec } from "./commands.ts";
import { assignInputNames } from "./input-names.ts";
import { TerminalBuffer } from "./ansi.ts";
import type { OutFile, RunFile, RunHandle, RunResult, Runner } from "./run-types.ts";
import { terminal } from "../copy.ts";
import { terminalTools } from "../copy-tools.ts";

export type PanelState =
  | { kind: "idle" }
  | { kind: "needs-file" }
  | { kind: "confirming"; effect: "store" | "folder" }
  | { kind: "running" }
  /** Stop was pressed: the helper has been asked to end and has not yet. Stop does nothing more here. */
  | { kind: "stopping" }
  | { kind: "asking"; question: string }
  | { kind: "finished"; result: RunResult }
  | { kind: "unavailable"; reason: "no-worker" | "network" };

export interface ControllerDeps {
  runner: Runner;
  /** The export files the person has picked, shared by every block. */
  getFiles(): readonly RunFile[];
  /** Spoken status. Failures are assertive. */
  announce(message: string, assertive?: boolean): void;
  /** How many characters wide the output area is. */
  columns(): number;
  /** Before a command that saves history: lock the dashboard's own copy so nothing writes over it. */
  beforeStoreRun(): Promise<void>;
  /** After it, whatever happened: look at the saved history again. */
  afterStoreRun(): Promise<void>;
  /** False when this browser cannot start a helper at all. */
  workerAvailable(): boolean;
}

export interface TerminalController {
  state(id: CommandId): PanelState;
  /** The transcript of the last Run of this command. */
  transcript(id: CommandId): TerminalBuffer;
  /** Files the last Run saved in the virtual folder. */
  files(id: CommandId): readonly OutFile[];
  /** The command that is running now, or null. */
  busy(): CommandId | null;
  /** Hear about changes to one command's state or output. Returns the unsubscribe function. */
  subscribe(id: CommandId, listener: () => void): () => void;
  /** Hear when the page-wide lock turns on or off. */
  subscribeBusy(listener: () => void): () => void;
  /** How many outputs are open now: blocks whose last Run ended and whose output is still showing. */
  openOutputs(): number;
  /** Hear when the number of open outputs changes. Returns the unsubscribe function. */
  subscribeOpen(listener: () => void): () => void;
  /** Close every open output. A Run that is working is left alone. */
  closeAll(): void;
  /** The person pressed Run. */
  request(id: CommandId): void;
  /** The person approved a write. */
  approve(id: CommandId): void;
  /** The person backed out of the confirmation. */
  decline(id: CommandId): void;
  /** The person pressed Stop. */
  stop(id: CommandId): void;
  /** The person answered a passphrase question (null: canceled). The value is passed on and not kept. */
  answerSecret(id: CommandId, value: string | null): void;
  /** Hide the block's output and clear it, with any files it holds. Not while running. */
  close(id: CommandId): void;
  /** Forget the files the last Run saved, and keep the transcript. */
  clearFiles(id: CommandId): void;
  /**
   * Forget everything on the page: stop a Run that is working, clear every transcript and every saved
   * file, and put every block back to its start. For Lock and Delete data.
   */
  reset(): void;
  /** What the last Run's chip says. */
  exitLabel(id: CommandId): string | null;
}

interface Entry {
  state: PanelState;
  buffer: TerminalBuffer;
  files: OutFile[];
  listeners: Set<() => void>;
  handle: RunHandle | null;
  /** Answers a pending question. Cleared as soon as it is used. */
  answer: ((value: string | null) => void) | null;
  /** The pending question, kept only to write it into the transcript. */
  pendingQuestion: string | null;
  /** Goes up on every reset. A Run that began before a reset is stale: it may no longer show anything. */
  epoch: number;
}

/** The words for how a command ended. Each command's exit codes come from its own usage text. */
export function exitLabel(spec: CommandSpec, result: RunResult): string {
  const words = terminal.exit;
  if (result.end === "blocked") return words.blocked;
  if (result.end === "failed") return words.helperStopped;
  if (result.end === "canceled" || result.end === "terminated" || result.code === 130) return words.stopped;
  const command = spec.argv[0];
  switch (result.code) {
    case 0:
      return words.done;
    case 2:
      return command === "analyze" || command === "inspect" ? words.exportErrors : words.couldNotRun;
    case 3:
      return command === "memories" ? words.someFailed : words.couldNotRun;
    default:
      return words.couldNotRun;
  }
}

export function createTerminalController(deps: ControllerDeps): TerminalController {
  const entries = new Map<CommandId, Entry>();
  const busyListeners = new Set<() => void>();
  let active: CommandId | null = null;

  const entry = (id: CommandId): Entry => {
    let e = entries.get(id);
    if (e === undefined) {
      e = { state: { kind: "idle" }, buffer: new TerminalBuffer(), files: [], listeners: new Set(), handle: null, answer: null, pendingQuestion: null, epoch: 0 };
      entries.set(id, e);
    }
    return e;
  };

  const notify = (id: CommandId): void => {
    for (const listener of [...entry(id).listeners]) listener();
  };
  const finishedIds = (): CommandId[] => [...entries].filter(([, e]) => e.state.kind === "finished").map(([id]) => id);
  const openListeners = new Set<() => void>();
  let openCount = 0;
  const set = (id: CommandId, state: PanelState): void => {
    entry(id).state = state;
    notify(id);
    // Other blocks care only about how many outputs are open, not about what is in them.
    const n = finishedIds().length;
    if (n !== openCount) {
      openCount = n;
      for (const listener of [...openListeners]) listener();
    }
  };
  const setActive = (id: CommandId | null): void => {
    active = id;
    for (const listener of [...busyListeners]) listener();
  };

  async function start(id: CommandId): Promise<void> {
    const spec = COMMANDS[id];
    const e = entry(id);
    const epoch = e.epoch;
    const current = (): boolean => e.epoch === epoch;
    // This Run replaces the last one: new transcript, no old files.
    e.buffer.clear();
    e.files = [];
    e.answer = null;
    e.pendingQuestion = null;
    setActive(id);
    set(id, { kind: "running" });
    // The title goes first, so several blocks on one page can be told apart ("Show the commands: running").
    deps.announce(terminalTools.startedFor(spec.title));

    const files = deps.getFiles();
    const names = assignInputNames(files.map((f) => f.name));
    let result: RunResult;
    try {
      // A command that saves history locks the dashboard's own copy first, so the two cannot write over each other.
      if (spec.effect === "store") await deps.beforeStoreRun();
      // Reset while the history was being locked: this Run never starts.
      if (!current()) throw new Error("reset");
      const handle = deps.runner.run(
        { spec, argv: bindArgv(spec, { export: names }), files, columns: deps.columns() },
        {
          onOut: (text) => {
            if (!current()) return;
            e.buffer.write(text);
            notify(id);
          },
          askSecret: (question) =>
            new Promise<string | null>((resolve) => {
              // A question from a Run that was reset or is being stopped is answered for them: canceled.
              if (!current() || e.state.kind === "stopping") return resolve(null);
              e.pendingQuestion = question;
              e.answer = resolve;
              set(id, { kind: "asking", question });
              deps.announce(terminal.askingAnnounce);
            }),
          onFiles: (saved) => {
            if (!current()) return;
            e.files = saved;
            notify(id);
          },
        },
      );
      e.handle = handle;
      result = await handle.done;
    } catch {
      result = { end: "failed", code: null, ms: 0 };
    }
    e.handle = null;
    e.answer = null;
    e.pendingQuestion = null;
    if (spec.effect === "store") {
      try {
        await deps.afterStoreRun();
      } catch {
        // The page still shows what it had; the next unlock looks again.
      }
    }
    const missing = result.end === "failed" && !deps.workerAvailable();
    setActive(null);
    // The page was reset while this Run was working: nothing it made may come back on screen.
    if (!current()) return;
    if (missing) {
      set(id, { kind: "unavailable", reason: "no-worker" });
      deps.announce(terminal.noWorkerNote, true);
      return;
    }
    set(id, { kind: "finished", result });
    const label = exitLabel(spec, result);
    const failed = result.end === "failed" || result.end === "blocked" || (result.code !== null && result.code !== 0 && result.code !== 130);
    deps.announce(terminal.doneAnnounce(spec.title, label, result.code ?? 1), failed);
  }

  return {
    state: (id) => entry(id).state,
    transcript: (id) => entry(id).buffer,
    files: (id) => entry(id).files,
    busy: () => active,
    subscribe(id, listener) {
      entry(id).listeners.add(listener);
      return () => void entry(id).listeners.delete(listener);
    },
    subscribeBusy(listener) {
      busyListeners.add(listener);
      return () => void busyListeners.delete(listener);
    },
    openOutputs: () => openCount,
    subscribeOpen(listener) {
      openListeners.add(listener);
      return () => void openListeners.delete(listener);
    },
    closeAll() {
      for (const id of finishedIds()) {
        const e = entry(id);
        e.buffer.clear();
        e.files = [];
        set(id, { kind: "idle" });
      }
    },
    request(id) {
      const spec = COMMANDS[id];
      const state = entry(id).state;
      // One Run at a time for the whole page, and no second press on a block that is already working.
      if (active !== null) return;
      if (state.kind === "running" || state.kind === "stopping" || state.kind === "asking" || state.kind === "confirming") return;
      if (spec.network) return set(id, { kind: "unavailable", reason: "network" });
      if (!deps.workerAvailable()) return set(id, { kind: "unavailable", reason: "no-worker" });
      if (spec.needsFile && deps.getFiles().length === 0) {
        set(id, { kind: "needs-file" });
        deps.announce(terminal.needsFileHint);
        return;
      }
      if (spec.effect !== "none") return set(id, { kind: "confirming", effect: spec.effect });
      void start(id);
    },
    approve(id) {
      if (active !== null || entry(id).state.kind !== "confirming") return;
      void start(id);
    },
    decline(id) {
      if (entry(id).state.kind === "confirming") set(id, { kind: "idle" });
    },
    stop(id) {
      const e = entry(id);
      if (e.handle === null || (e.state.kind !== "running" && e.state.kind !== "asking")) return;
      deps.announce(terminal.stoppingAnnounce);
      // A question nobody will answer is answered for them: canceled.
      const answer = e.answer;
      e.answer = null;
      e.pendingQuestion = null;
      // Shown at once, before the helper ends, so a second press is not needed and not possible.
      set(id, { kind: "stopping" });
      answer?.(null);
      e.handle.cancel();
    },
    answerSecret(id, value) {
      const e = entry(id);
      const answer = e.answer;
      const question = e.pendingQuestion;
      if (answer === null) return;
      e.answer = null;
      e.pendingQuestion = null;
      // The transcript gets the question and a line break, never the answer, its length or bullets.
      if (question !== null) e.buffer.write(`${question}\n`);
      set(id, { kind: "running" });
      answer(value);
    },
    close(id) {
      const e = entry(id);
      if (e.state.kind === "running" || e.state.kind === "stopping" || e.state.kind === "asking") return;
      e.buffer.clear();
      e.files = [];
      set(id, { kind: "idle" });
    },
    clearFiles(id) {
      entry(id).files = [];
      notify(id);
    },
    reset() {
      for (const [id, e] of entries) {
        e.epoch++;
        // A Run that is working is stopped, and a question nobody will answer is answered: canceled.
        const answer = e.answer;
        e.answer = null;
        e.pendingQuestion = null;
        answer?.(null);
        e.handle?.cancel();
        e.buffer.clear();
        e.files = [];
        set(id, { kind: "idle" });
      }
    },
    exitLabel(id) {
      const state = entry(id).state;
      return state.kind === "finished" ? exitLabel(COMMANDS[id], state.result) : null;
    },
  };
}
