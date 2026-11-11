import { announce } from "../announce.ts";
import { copyText } from "../clipboard.ts";
import { common, terminal } from "../copy.ts";
import { cliTool, commandNotes, terminalTools } from "../copy-tools.ts";
import { h } from "../dom.ts";
import { onDispose } from "../reactive.ts";
import { COMMANDS, displayText, displayTextWith } from "../terminal/commands.ts";
import type { CommandId } from "../terminal/commands.ts";
import type { ViewContext } from "../views/context.ts";
import { button } from "./button.ts";
import { scrollRegion } from "./dataTable.ts";
import { fileChip } from "./fileChip.ts";
import { terminalPanel } from "./terminalPanel.ts";

export interface CommandBlockOptions {
  /** Key for focus restoration. */
  key: string;
  /** Add the link to the Export guide's "Command line tool" section. A page does this on its first block only. */
  cliLink?: boolean;
  /** One short line under the code, such as "The command shows the default view." */
  note?: string;
  /** Replaces the catalog's title on a copy-only block, such as "Check later against a saved backup". */
  title?: string;
  /**
   * Words added after the catalog command (flags and their placeholders, such as `--compare` and `<backup file>`), copied and shown
   * as part of the command. Only a copy-only block takes them, because Run would run the plain command and not this one.
   */
  append?: readonly string[];
  /**
   * The block can only be copied: it names a file or folder that this page cannot open, so a terminal has to run it. It has no Run,
   * no file chip and no output, and says "This needs a terminal." in a line of its own.
   */
  copyOnly?: boolean;
  /** On a copy-only block: leave the catalog command's export files out, for a command that reads none (such as a check of a folder). */
  withoutExport?: boolean;
}

/** The line that leads to the Export guide section on getting the command line tool. A page that explains commands outside a block can use it too. */
export function cliToolLink(): HTMLElement {
  return h("p", { class: "command-cli-link" }, h("a", { href: "#/guide" }, cliTool.linkLabel));
}

let counter = 0;

/**
 * The command in code. It is a tab stop, with a name, only while it is wider than its frame and has to be scrolled with the arrow
 * keys; a command that fits is plain text and costs a keyboard user no stop (there is one block per tool page and five on the guide).
 */
function codeLine(text: string): HTMLElement {
  return scrollRegion(h("pre", { class: "code" }, h("code", {}, text)), commandNotes.textLabel, (label) => label);
}

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
  if (options.copyOnly === true) return copyOnlyBlock(id, options);
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
    if (spec.needsFile && picked.count() === 0 && !ctx.terminal.usesSample(spec)) return terminal.needsFileHint;
    return "";
  };
  const update = (): void => {
    // The session runs a command that only reads on the sample while it is showing and nothing was picked.
    ctx.terminal.sampleMode(ctx.store.get().sample !== null);
    const why = reason();
    hint.textContent = why !== "" ? why : ctx.terminal.usesSample(spec) ? terminalTools.usingSample : "";
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
  onDispose(
    ctx.store.subscribe((s, previous) => {
      if (s.sample !== previous.sample) update();
    }),
  );

  return h(
    "div",
    { class: "command code-block" },
    h("div", { class: "command-head" }, h("p", { class: "command-title" }, spec.title), h("div", { class: "command-actions" }, copy, run)),
    codeLine(text),
    options.note === undefined ? null : h("p", { class: "command-note" }, options.note),
    spec.needsFile ? fileChip(ctx.terminal, { key: options.key }) : null,
    hint,
    options.cliLink === true ? cliToolLink() : null,
    panel.element,
  );
}

/**
 * A command that only Copy can serve: the catalog command plus words naming a file or folder, with the title the page gives it. It
 * is the same frame (title, Copy, code), with no Run, chip or output, and a line that says why.
 */
function copyOnlyBlock(id: CommandId, options: CommandBlockOptions): HTMLElement {
  const spec = COMMANDS[id];
  const title = options.title ?? spec.title;
  const shown = options.withoutExport === true ? { ...spec, argv: spec.argv.filter((a) => typeof a === "string") } : spec;
  const text = displayTextWith(shown, options.append ?? []);
  const copy = button({
    label: common.copy,
    icon: "copy",
    variant: "secondary",
    ariaLabel: terminal.copyFor(title),
    key: `${options.key}:copy`,
    onclick: () => void copyText(text).then((ok) => announce(ok ? terminal.copiedCommandAnnounce : common.copyFailed)),
  });
  return h(
    "div",
    { class: "command code-block command-copy-only" },
    h("div", { class: "command-head" }, h("p", { class: "command-title" }, title), h("div", { class: "command-actions" }, copy)),
    codeLine(text),
    h("p", { class: "command-note" }, commandNotes.needsTerminal),
    options.note === undefined ? null : h("p", { class: "command-note" }, options.note),
    options.cliLink === true ? cliToolLink() : null,
  );
}
