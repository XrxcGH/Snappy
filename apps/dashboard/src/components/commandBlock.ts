import { announce } from "../announce.ts";
import { copyText } from "../clipboard.ts";
import { common, terminal } from "../copy.ts";
import { h } from "../dom.ts";
import { onDispose } from "../reactive.ts";
import { COMMANDS, displayText } from "../terminal/commands.ts";
import type { CommandId } from "../terminal/commands.ts";
import type { ViewContext } from "../views/context.ts";
import { button } from "./button.ts";
import { fileChip } from "./fileChip.ts";
import { terminalPanel } from "./terminalPanel.ts";

export interface CommandBlockOptions {
  /** Key for focus restoration. */
  key: string;
}

let counter = 0;

/**
 * A command shown the same way everywhere it appears: a line saying what it does, then Copy and Run on
 * its right, then the command in code. Copy always works and copies exactly the text shown. Run runs the
 * command here, in the page, and shows the output below. A command that reads an export has a chip to
 * choose the files. The code scrolls sideways on a narrow screen.
 *
 * Run stays focusable when it cannot start: it says why in a visible line (no export chosen yet, or
 * another command is running) that it points to, instead of going dead.
 */
export function commandBlock(ctx: ViewContext, id: CommandId, options: CommandBlockOptions): HTMLElement {
  const spec = COMMANDS[id];
  const { controller, picked } = ctx.terminal;
  const text = displayText(spec);
  const hintId = `command-hint-${++counter}`;

  const hint = h("p", { class: "command-hint", id: hintId });
  const run = button({ label: terminal.runButton, variant: "primary", ariaLabel: terminal.runFor(spec.title), key: `${options.key}:run` });
  const panel = terminalPanel(ctx.terminal, { id, spec, runButton: run, key: options.key });

  /** Why Run cannot start right now, in words; or nothing. */
  const reason = (): string => {
    const busy = controller.busy();
    if (busy !== null && busy !== id) return terminal.busyHint;
    if (spec.needsFile && picked.count() === 0) return terminal.needsFileHint;
    return "";
  };
  const update = (): void => {
    const why = reason();
    hint.textContent = why;
    const state = controller.state(id).kind;
    const working = state === "running" || state === "stopping" || state === "asking" || state === "confirming";
    const blocked = why !== "" || working;
    if (blocked) run.setAttribute("aria-disabled", "true");
    else run.removeAttribute("aria-disabled");
    if (why === "") run.removeAttribute("aria-describedby");
    else run.setAttribute("aria-describedby", hintId);
  };

  run.addEventListener("click", () => {
    // The panel's width is measured now, so the command's tables fit the box they will be drawn in.
    ctx.terminal.columnsFrom(panel.columns);
    if (controller.busy() !== null && controller.busy() !== id) {
      announce(terminal.busyHint);
      return;
    }
    controller.request(id);
  });

  const copy = button({
    label: common.copy,
    icon: "copy",
    variant: "secondary",
    ariaLabel: terminal.copyFor(spec.title),
    key: `${options.key}:copy`,
    onclick: () => void copyText(text).then((ok) => announce(ok ? terminal.copiedCommandAnnounce : common.copyFailed)),
  });

  update();
  onDispose(controller.subscribe(id, update));
  onDispose(controller.subscribeBusy(update));
  onDispose(picked.subscribe(update));

  return h(
    "div",
    { class: "command code-block" },
    h("div", { class: "command-head" }, h("p", { class: "command-title" }, spec.title), h("div", { class: "command-actions" }, copy, run)),
    h("pre", { class: "code", tabindex: "0" }, h("code", {}, text)),
    spec.needsFile ? fileChip(ctx.terminal, { key: options.key }) : null,
    hint,
    panel.element,
  );
}
