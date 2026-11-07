/**
 * Draws a TerminalBuffer in the page. Every line is a div.t-line holding span.t-run elements, built
 * with h() only: the text goes in as text, the only attribute is class, and the classes come from the
 * closed list in ansi.ts (plus the two structural names t-line and t-run). No markup string, no style
 * attribute. Drawing is batched on a short timer, not on animation frames (a hidden tab runs none), and
 * only the lines that changed are touched. The view follows new output unless the person scrolled up.
 */
import { h } from "../dom.ts";
import { TerminalBuffer } from "./ansi.ts";
import type { Line } from "./ansi.ts";

export interface LogViewOptions {
  /** The accessible name of the output area. */
  label: string;
  /** The line shown above the output once old lines were dropped. */
  trimmedText: string;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule?: (fn: () => void, ms: number) => () => void;
  buffer?: TerminalBuffer;
}

export interface LogView {
  readonly element: HTMLElement;
  readonly buffer: TerminalBuffer;
  write(chunk: string): void;
  /** Draw what is waiting now. */
  flush(): void;
  clear(): void;
  /** The output as plain text, for Copy output. */
  plainText(): string;
  dispose(): void;
}

/** Output is drawn at most this often. */
export const DRAW_MS = 50;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

function lineElement(line: Line): HTMLElement {
  return h("div", { class: "t-line" }, ...line.runs.map((run) => h("span", { class: run.cls === "" ? "t-run" : `t-run ${run.cls}` }, run.text)));
}

export function createLogView(options: LogViewOptions): LogView {
  const buffer = options.buffer ?? new TerminalBuffer();
  const schedule = options.schedule ?? defaultSchedule;
  const lineEls: HTMLElement[] = [];
  let cancelDraw: (() => void) | undefined;
  let stick = true;
  let showingTrimmed = false;
  const trimmed = h("div", { class: "t-trimmed" }, options.trimmedText);

  const element = h("div", { class: "t-log", role: "log", "aria-live": "off", "aria-label": options.label, tabindex: "0" });

  const atBottom = (): boolean => element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
  element.addEventListener("scroll", () => {
    stick = atBottom();
  });

  const flush = (): void => {
    cancelDraw?.();
    cancelDraw = undefined;
    const { removed, from } = buffer.takeChanges();
    for (let i = 0; i < removed; i++) lineEls.shift()?.remove();
    const rows = buffer.lines;
    for (let i = Math.min(from, lineEls.length); i < rows.length; i++) {
      const fresh = lineElement(rows[i] as Line);
      const old = lineEls[i];
      if (old === undefined) {
        lineEls.push(fresh);
        element.appendChild(fresh);
      } else {
        old.replaceChildren(...fresh.childNodes);
      }
    }
    // Lines beyond the buffer (it was cleared) are removed.
    while (lineEls.length > rows.length) lineEls.pop()?.remove();
    if (buffer.trimmed && !showingTrimmed) {
      showingTrimmed = true;
      element.replaceChildren(trimmed, ...lineEls);
    }
    if (stick) element.scrollTop = element.scrollHeight;
  };

  return {
    element,
    buffer,
    write(chunk) {
      buffer.write(chunk);
      if (cancelDraw === undefined) cancelDraw = schedule(flush, DRAW_MS);
    },
    flush,
    clear() {
      cancelDraw?.();
      cancelDraw = undefined;
      buffer.clear();
      lineEls.length = 0;
      showingTrimmed = false;
      element.replaceChildren();
      stick = true;
    },
    plainText: () => buffer.plainText(),
    dispose() {
      cancelDraw?.();
      cancelDraw = undefined;
    },
  };
}

/**
 * How many characters fit across the output area, measured with a hidden ten-character probe in
 * the area's own font. Clamped to 40 to 100: a narrow screen scrolls sideways instead of wrapping.
 */
export function measureColumns(host: HTMLElement, fallback = 80): number {
  const probe = h("span", { class: "t-probe", "aria-hidden": "true" }, "0000000000");
  host.appendChild(probe);
  try {
    const char = probe.getBoundingClientRect().width / 10;
    const width = host.clientWidth;
    if (!(char > 0) || !(width > 0)) return fallback;
    return Math.max(40, Math.min(100, Math.floor(width / char)));
  } catch {
    return fallback;
  } finally {
    probe.remove();
  }
}
