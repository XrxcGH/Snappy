/**
 * Dropping files anywhere on the page adds them. While files are dragged over the window a full-window note says what a
 * drop will do; on the drop the page goes to Start, where the progress and any problem are in view, and the same import
 * flow as the Start page's own drop zone runs. Only drags that carry files count: dragging text or a link does nothing here
 * (the browser is still kept from opening a dropped file and leaving the page).
 */
import { startFlow } from "./copy-start.ts";
import { h } from "./dom.ts";
import type { ImportFlow } from "./import-flow.ts";
import { clearRefusal, refuse } from "./refusal.ts";

/** The few things of a window the handler uses, so it can be tried without a browser. */
export interface DropTarget {
  addEventListener(type: string, listener: (event: DragEvent) => void): void;
  removeEventListener(type: string, listener: (event: DragEvent) => void): void;
}

export interface DropDeps {
  flow: ImportFlow;
  /** A read or a command is running: a drop is refused and says so. */
  isBusy(): boolean;
  /** Show the Start page, so the progress and any problem are on screen. */
  toStart(): void;
}

/** True when the drag carries files (a text or link drag lists other types). */
export function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Returns a function that removes the handlers and the note. */
export function installDropAnywhere(target: DropTarget, deps: DropDeps): () => void {
  const note = h("div", { class: "drop-overlay", "aria-hidden": "true", hidden: true }, h("p", { class: "drop-overlay-text" }, startFlow.dropOverlayTitle));
  document.body.appendChild(note);
  // Entering and leaving the page's children fire pairs of events; counting them keeps the note from flickering.
  let depth = 0;
  const show = (on: boolean): void => {
    if (on) note.removeAttribute("hidden");
    else note.setAttribute("hidden", "");
  };

  const enter = (e: DragEvent): void => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth++;
    show(true);
  };
  const over = (e: DragEvent): void => {
    // The browser opens a dropped file unless the page says it takes drops, for every kind of drag.
    e.preventDefault();
    if (carriesFiles(e) && e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const leave = (e: DragEvent): void => {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) show(false);
  };
  const drop = (e: DragEvent): void => {
    // Something nearer took the drop (the Start page's own drop zone does, and imports it): nothing more to do here.
    const taken = e.defaultPrevented;
    e.preventDefault();
    depth = 0;
    show(false);
    if (taken || !carriesFiles(e)) return;
    if (deps.isBusy()) {
      refuse(startFlow.busy);
      return;
    }
    deps.toStart();
    void deps.flow.drop(e.dataTransfer);
  };

  const handlers: [string, (e: DragEvent) => void][] = [
    ["dragenter", enter],
    ["dragover", over],
    ["dragleave", leave],
    ["drop", drop],
  ];
  for (const [type, fn] of handlers) target.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of handlers) target.removeEventListener(type, fn);
    note.remove();
    clearRefusal();
  };
}
