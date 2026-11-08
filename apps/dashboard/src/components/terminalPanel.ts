import { announce } from "../announce.ts";
import { copyText } from "../clipboard.ts";
import { common, terminal } from "../copy.ts";
import { h } from "../dom.ts";
import { onDispose } from "../reactive.ts";
import { createLogView, measureColumns, warmOutputFont } from "../terminal/ansi-view.ts";
import type { LogView } from "../terminal/ansi-view.ts";
import type { CommandId, CommandSpec } from "../terminal/commands.ts";
import type { PanelState } from "../terminal/controller.ts";
import type { RunResult } from "../terminal/run-types.ts";
import type { TerminalSession } from "../terminal/session.ts";
import { button } from "./button.ts";
import { confirmCard } from "./confirmCard.ts";
import { icon } from "./icon.ts";
import type { IconName } from "./icon.ts";
import { notice } from "./notice.ts";
import { outFiles } from "./outFiles.ts";
import { secretPrompt } from "./secretPrompt.ts";

export interface TerminalPanelOptions {
  id: CommandId;
  spec: CommandSpec;
  /** The block's Run button: focus goes back to it when a Run ends. */
  runButton: HTMLElement;
  /** Key for focus restoration. */
  key: string;
}

export interface TerminalPanel {
  element: HTMLElement;
  /** How many characters wide the output area will be here. */
  columns(): number;
}

type Tone = "ok" | "warn" | "danger" | "neutral";

/** How an ended Run looks: the icon, the tone, and always the words next to them. */
function chipFor(spec: CommandSpec, result: RunResult): { tone: Tone; icon: IconName } {
  if (result.end === "canceled" || result.end === "terminated" || result.code === 130) return { tone: "neutral", icon: "info" };
  if (result.end === "failed" || result.end === "blocked") return { tone: "danger", icon: "warning" };
  if (result.code === 0) return { tone: "ok", icon: "check" };
  if (result.code === 3 && spec.argv[0] === "memories") return { tone: "warn", icon: "warning" };
  return { tone: "danger", icon: "warning" };
}

/** A line of output that sends the person to an option Run refuses (it needs the network). */
const NETWORK_HINT = /--download/;

const seconds = (ms: number): string => (Math.max(0, ms) / 1000).toFixed(1);

/**
 * What sits under a command's code: nothing until Run is pressed, then the write confirmation, the
 * passphrase question, the output and its Stop, Copy output and Close buttons, and how it ended. It
 * draws whatever the controller says, so a block built again (the person left the page and came back)
 * shows the same Run. The output area announces nothing line by line; the controller speaks the status.
 */
export function terminalPanel(session: TerminalSession, options: TerminalPanelOptions): TerminalPanel {
  const { controller } = session;
  const { id, spec } = options;
  const root = h("div", { class: "command-panel" });
  warmOutputFont();
  let log: LogView | null = null;
  let shown = "";

  const logView = (): LogView => {
    log ??= createLogView({ label: terminal.panelLabelFor(spec.title), trimmedText: terminal.trimmed, buffer: controller.transcript(id) });
    return log;
  };

  const focusRun = (): void => options.runButton.focus();
  const focusIn = (el: Element | null | undefined): void => (el as HTMLElement | null | undefined)?.focus();
  /** True when focus is inside this panel, or nowhere in particular (it was on a control that is gone). */
  const focusIsHere = (): boolean => {
    const active = document.activeElement;
    return active === null || active === document.body || (active instanceof Node && root.contains(active));
  };

  function chip(result: RunResult): HTMLElement {
    const label = controller.exitLabel(id) ?? "";
    const { tone, icon: name } = chipFor(spec, result);
    return h(
      "p",
      { class: `command-chip command-chip-${tone}` },
      icon(name, 16),
      h("span", { class: "command-chip-label" }, label),
      result.code === null ? null : h("span", { class: "command-chip-detail" }, terminal.codeLabel(result.code)),
      h("span", { class: "command-chip-detail" }, terminal.secondsLabel(seconds(result.ms))),
    );
  }

  function rebuild(state: PanelState, previous: string): void {
    // Focus is managed only for a change the person caused, never when a block is first drawn.
    const moved = previous !== "";
    const fresh = previous === "idle" || previous === "needs-file" || previous === "unavailable" || previous.startsWith("finished");
    switch (state.kind) {
      case "idle":
      case "needs-file":
        log?.dispose();
        log = null;
        root.replaceChildren();
        return;
      case "unavailable":
        log?.dispose();
        log = null;
        root.replaceChildren(notice(state.reason === "network" ? "info" : "warning", state.reason === "network" ? terminal.networkNote : terminal.noWorkerNote));
        return;
      case "confirming": {
        const card = confirmCard({
          effect: state.effect,
          outCap: session.outCap,
          key: options.key,
          onApprove: () => controller.approve(id),
          onCancel: () => {
            controller.decline(id);
            focusRun();
          },
        });
        root.replaceChildren(card);
        if (moved) focusIn(card.querySelector("button"));
        return;
      }
      case "running": {
        const stop = button({ label: terminal.stopButton, icon: "close", variant: "secondary", ariaLabel: terminal.stopFor(spec.title), key: `${options.key}:stop`, onclick: () => controller.stop(id) });
        root.replaceChildren(logView().element, h("div", { class: "command-toolbar" }, h("p", { class: "command-status" }, terminal.startedAnnounce), stop));
        // A Run that has just started: focus stays in the block, on Stop (the Run button is busy now).
        if (moved && (fresh || previous === "confirming" || previous.startsWith("asking"))) focusIn(stop);
        return;
      }
      case "stopping": {
        // Stop was pressed. The button stays, still focusable, but says it is done and does nothing more.
        const hadFocus = focusIsHere();
        const stop = button({ label: terminal.stopButton, icon: "close", variant: "secondary", ariaLabel: terminal.stopFor(spec.title), key: `${options.key}:stop`, onclick: () => controller.stop(id) });
        stop.setAttribute("aria-disabled", "true");
        root.replaceChildren(logView().element, h("div", { class: "command-toolbar" }, h("p", { class: "command-status" }, terminal.stoppingStatus), stop));
        if (moved && hadFocus) focusIn(stop);
        return;
      }
      case "asking": {
        const form = secretPrompt({
          question: state.question,
          key: options.key,
          onSubmit: (value) => controller.answerSecret(id, value),
          onCancel: () => controller.answerSecret(id, null),
        });
        root.replaceChildren(logView().element, form);
        if (moved) focusIn(form.querySelector("input"));
        return;
      }
      case "finished": {
        const view = logView();
        const copy = button({
          label: terminal.copyOutputButton,
          icon: "copy",
          variant: "secondary",
          key: `${options.key}:copy-output`,
          onclick: () => void copyText(view.plainText()).then((ok) => announce(ok ? terminal.copiedOutputAnnounce : common.copyFailed)),
        });
        const close = button({
          label: terminal.closeButton,
          variant: "quiet",
          key: `${options.key}:close`,
          onclick: () => {
            controller.close(id);
            focusRun();
          },
        });
        const hadFocus = focusIsHere();
        const saved = outFiles(session, { id, result: state.result, now: () => Date.now(), key: options.key });
        // The output may tell the person to add --download. Run never downloads, so say where that works.
        const download = NETWORK_HINT.test(view.plainText()) ? h("p", { class: "command-hint" }, terminal.downloadNote) : null;
        // The buttons that act on the whole run come before the files, so a keyboard user reaches Copy output and Close
        // without passing a Save button for every file (a real export saves hundreds).
        root.replaceChildren(...[view.element, chip(state.result), download, h("div", { class: "command-toolbar" }, copy, close), saved].filter((n): n is HTMLElement => n !== null));
        // The reading starts at the top, not at the last line.
        view.finish();
        // Back to the Run button, unless the person has moved on to something else.
        if (moved && hadFocus) focusRun();
        return;
      }
    }
  }

  const draw = (): void => {
    const state = controller.state(id);
    // A finished Run is drawn again when its files change (Clear files), and a question when it changes.
    const key = state.kind === "asking" ? `asking:${state.question}` : state.kind === "finished" ? `finished:${controller.files(id).length}` : state.kind;
    if (key !== shown) {
      const previous = shown;
      shown = key;
      rebuild(state, previous);
    }
    log?.refresh();
    if (state.kind === "finished") log?.flush();
    // An output area with nothing in it yet (a command waiting for a passphrase) is not shown as an empty box.
    if (log) log.element.hidden = controller.transcript(id).size === 0;
  };

  draw();
  onDispose(controller.subscribe(id, draw));
  onDispose(() => log?.dispose());

  return { element: root, columns: () => measureColumns(root) };
}
