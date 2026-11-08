/**
 * Draws a TerminalBuffer in the page. Every line is a div.t-line holding span.t-run elements, built
 * with h() only: the text goes in as text, the only attribute is class, and the classes come from the
 * closed list in ansi.ts (plus the structural names t-line, t-art, t-run and t-block). No markup string, no style
 * attribute. Drawing is batched on a short timer, not on animation frames (a hidden tab runs none), and
 * only the lines that changed are touched. While a command runs the view follows new output unless the
 * person scrolled up; when it ends the view goes back to the first line, so the reading starts at the top.
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
  /** The buffer was written by someone else: draw what changed, soon. */
  refresh(): void;
  /** Draw what is waiting now. */
  flush(): void;
  /** The command ended: draw the rest and start at the first line, unless the person scrolled away from the end. */
  finish(): void;
  clear(): void;
  /** The output as plain text, for Copy output. */
  plainText(): string;
  dispose(): void;
}

/** The narrowest output area the commands are asked to fit: a phone at 320 px holds about 30 characters. */
export const MIN_COLUMNS = 24;

/** Output is drawn at most this often. */
export const DRAW_MS = 50;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

/** Box-drawing and block characters (U+2500 to U+259F): the logo and any other drawing built from them. */
const ART = /[\u2500-\u259f]/;

/** A run made only of those (and spaces between them): the bars of the logo, never a word. */
const BLOCKS_ONLY = /^ *[─-▟][─-▟ ]*$/;

/**
 * A line holding any box or block character is drawn tight (class t-art) so the pieces touch the lines above and below,
 * and each run of only such characters gets class t-block, which draws it a hair wider so neighbors touch left and right
 * (the system draws every character at a fractional position, and a hairline of the background shows between two blocks).
 */
function lineElement(line: Line): HTMLElement {
  const art = line.runs.some((run) => ART.test(run.text));
  const runClass = (run: Line["runs"][number]): string => [ "t-run", ...(BLOCKS_ONLY.test(run.text) ? ["t-block"] : []), ...(run.cls === "" ? [] : [run.cls])].join(" ");
  return h("div", { class: art ? "t-line t-art" : "t-line" }, ...line.runs.map((run) => h("span", { class: runClass(run) }, run.text)));
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

  const schedulePaint = (): void => {
    if (cancelDraw === undefined) cancelDraw = schedule(flush, DRAW_MS);
  };

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

  // A buffer that already holds output (a block shown again after a visit elsewhere) is drawn at once.
  if (buffer.size > 0 || buffer.lines.length > 1) {
    buffer.takeChanges();
    for (const row of buffer.lines) {
      const fresh = lineElement(row);
      lineEls.push(fresh);
      element.appendChild(fresh);
    }
    if (buffer.trimmed) {
      showingTrimmed = true;
      element.replaceChildren(trimmed, ...lineEls);
    }
  }

  return {
    element,
    buffer,
    write(chunk) {
      buffer.write(chunk);
      schedulePaint();
    },
    refresh: schedulePaint,
    flush,
    finish() {
      flush();
      // Still following the end (or short enough that it does not matter): show the beginning, and stop following.
      if (stick) element.scrollTop = 0;
      stick = false;
    },
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
 * The output font is drawn from the page's own inlined font files, and the browser loads a face the first time something
 * uses it. The output uses the regular weight, which nothing else on the page uses until the first command runs, so a
 * measurement made before then would be taken in the fallback font, a little narrower, and ask commands for too many
 * columns. Asking for the face now, while the person reads the page, has it loaded by the time Run is pressed.
 */
export function warmOutputFont(): void {
  try {
    void document.fonts?.load('400 14px "JetBrains Mono"').catch(() => undefined);
  } catch {
    // No font loading API (a test page): nothing to warm.
  }
}

/** The probe is this many characters long, so the width of one is measured to a fraction of a pixel. */
const PROBE_CHARS = 100;

/**
 * How many characters fit across an output area placed in `host`. The hidden area is the real one in every
 * way that changes its width: the same font and padding, and the same scrollbar gutter (styles.css gives
 * .t-measure no rule that takes either away), so what it holds is what the real area holds, with nothing
 * kept back. The width of one character is measured from a probe of a hundred. The result is clamped to 24
 * to 100. A command that fits its lines to that many columns is not wrapped again by the page; a line it
 * did not fit wraps in the area, so nothing is cut off at the edge.
 */
export function measureColumns(host: HTMLElement, fallback = 80): number {
  warmOutputFont();
  const probe = h("span", { class: "t-probe", "aria-hidden": "true" }, "0".repeat(PROBE_CHARS));
  const area = h("div", { class: "t-log t-measure", "aria-hidden": "true" }, probe);
  host.appendChild(area);
  try {
    const char = probe.getBoundingClientRect().width / PROBE_CHARS;
    const style = getComputedStyle(area);
    const width = area.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    if (!(char > 0) || !(width > 0)) return fallback;
    // clientWidth is a whole number of pixels, so the real width can be half a pixel less: that much is kept back, which is
    // never a whole column, and a line of exactly this many characters never wraps by a rounding error.
    return Math.max(MIN_COLUMNS, Math.min(100, Math.floor((width - 0.5) / char)));
  } catch {
    return fallback;
  } finally {
    area.remove();
  }
}
