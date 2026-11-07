/**
 * Turns a command's output into lines of styled text, safely. The output is a stream of text with the
 * styling codes a terminal understands. This reads it with a small state machine that survives any
 * split between chunks, keeps the few codes the commands use, and drops everything else whole, so no
 * escape character, title, clipboard request or screen-clearing code can ever reach the page.
 *
 *  - Honored colors and styles (SGR): reset 0, bold 1, dim 2, normal intensity 22, the four status
 *    colors 31 to 34, default color 39, slate 90, and the 256-color and true-color forms 38;5;n and
 *    38;2;r;g;b. Any color is mapped to the nearest of Snappy's own: violet, orange, ok, warn, danger,
 *    info and slate. Every other styling code is read and ignored.
 *  - Honored movement: a line feed, a carriage return, and the erase-line codes (ESC [ K, 0K, 1K, 2K).
 *    A carriage return followed by text replaces the current line: there is no grid of cells, which is
 *    all the commands' progress bar needs. A carriage return and line feed together are one new line.
 *  - Dropped whole: every other sequence (cursor moves, screen clears, titles, clipboard, device
 *    commands) and any stray escape.
 *  - Characters that could hide or reorder text (control characters, DEL, the C1 range, the soft hyphen,
 *    zero-width and bidirectional marks) show as "?", the same as the command line and the dashboard do.
 *
 * Pure: no DOM. ansi-view.ts draws the lines.
 */

export type AnsiClass = "ansi-violet" | "ansi-orange" | "ansi-ok" | "ansi-warn" | "ansi-danger" | "ansi-info" | "ansi-slate" | "ansi-bold" | "ansi-dim";

/** The closed list of classes a run may carry. Nothing else ever becomes a class name. */
export const ANSI_CLASSES: readonly AnsiClass[] = ["ansi-violet", "ansi-orange", "ansi-ok", "ansi-warn", "ansi-danger", "ansi-info", "ansi-slate", "ansi-bold", "ansi-dim"];

type ColorClass = Exclude<AnsiClass, "ansi-bold" | "ansi-dim">;

/** Snappy's own colors as the dark theme draws them, for mapping any color to the nearest. */
const PALETTE: readonly (readonly [ColorClass, readonly [number, number, number]])[] = [
  ["ansi-violet", [155, 134, 255]],
  ["ansi-orange", [255, 154, 99]],
  ["ansi-ok", [111, 217, 163]],
  ["ansi-warn", [230, 210, 74]],
  ["ansi-danger", [255, 143, 160]],
  ["ansi-info", [141, 184, 255]],
  ["ansi-slate", [168, 161, 154]],
];

/** The nearest of Snappy's colors to an RGB value, by distance in RGB. */
export function quantize(r: number, g: number, b: number): ColorClass {
  let best: ColorClass = "ansi-slate";
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestOther: ColorClass = "ansi-slate";
  let bestOtherDistance = Number.POSITIVE_INFINITY;
  let orangeDistance = Number.POSITIVE_INFINITY;
  for (const [cls, [pr, pg, pb]] of PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = cls;
    }
    if (cls === "ansi-orange") orangeDistance = d;
    else if (d < bestOtherDistance) {
      bestOtherDistance = d;
      bestOther = cls;
    }
  }
  // Orange belongs to the Memories rescue alone. A color that is only roughly near it, a plain red
  // for one, is not taken for it.
  return best === "ansi-orange" && orangeDistance > ORANGE_REACH ** 2 ? bestOther : best;
}

/** How near (in RGB distance) a color must be to Snappy's orange to be drawn as orange. */
const ORANGE_REACH = 110;

const CUBE = [0, 95, 135, 175, 215, 255] as const;
/** The 16 standard colors, as a typical terminal draws them. */
const BASIC: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16], [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
  [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67], [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
];

/** A 256-color index as RGB. */
export function indexToRgb(index: number): [number, number, number] {
  const n = Math.max(0, Math.min(255, Math.trunc(index)));
  if (n < 16) return [...(BASIC[n] as readonly [number, number, number])];
  if (n < 232) {
    const c = n - 16;
    return [CUBE[Math.floor(c / 36)] as number, CUBE[Math.floor((c % 36) / 6)] as number, CUBE[c % 6] as number];
  }
  const v = 8 + (n - 232) * 10;
  return [v, v, v];
}

/** Control characters, DEL, the C1 range, the soft hyphen, zero-width and bidirectional marks. Same set as the command line's printable(). */
/** Code point ranges that are shown as "?": see the note above. */
const UNPRINTABLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];

/** True for a control character, DEL, a C1 code, the soft hyphen, a zero-width or a bidirectional mark. */
export function isUnprintable(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return UNPRINTABLE_RANGES.some(([from, to]) => code >= from && code <= to);
}

export interface Run {
  text: string;
  /** Space-separated names from ANSI_CLASSES, or "" for plain text. */
  cls: string;
}

export interface Line {
  runs: Run[];
}

export interface BufferOptions {
  maxLines?: number;
  /** Most characters kept. */
  maxChars?: number;
}

export const MAX_LINES = 20_000;
export const MAX_CHARS = 5 * 1024 * 1024;
/** A line longer than this is broken, as a terminal would wrap it. */
export const MAX_LINE = 10_000;
/** A title or other string sequence longer than this is not waited for. */
const MAX_STRING = 4096;
const MAX_CSI = 64;
const MAX_SGR_PARAMS = 16;

export interface Change {
  /** How many lines were dropped from the front since the last call. */
  removed: number;
  /** The first line (counted after the drop) that was added or changed. */
  from: number;
}

type State = "ground" | "esc" | "escIntermediate" | "csi" | "string";

export class TerminalBuffer {
  private readonly maxLines: number;
  private readonly maxChars: number;
  private readonly rows: Line[] = [{ runs: [] }];
  private chars = 0;
  /** Characters in the line being written. */
  private lastLen = 0;
  private state: State = "ground";
  private csi = "";
  private stringLength = 0;
  private stringEsc = false;
  private cr = false;
  private fg: ColorClass | null = null;
  private bold = false;
  private dim = false;
  private removed = 0;
  private from = 0;
  private trimmedFlag = false;

  constructor(options: BufferOptions = {}) {
    this.maxLines = options.maxLines ?? MAX_LINES;
    this.maxChars = options.maxChars ?? MAX_CHARS;
  }

  /** The lines so far. The last one is the line being written. Do not change them. */
  get lines(): readonly Line[] {
    return this.rows;
  }

  /** True once old lines were dropped to stay under the caps. */
  get trimmed(): boolean {
    return this.trimmedFlag;
  }

  get size(): number {
    return this.chars;
  }

  /** What changed since the last call, so a view can update only that. */
  takeChanges(): Change {
    const change = { removed: this.removed, from: Math.min(this.from, this.rows.length - 1) };
    this.removed = 0;
    this.from = this.rows.length - 1;
    return change;
  }

  clear(): void {
    this.rows.length = 0;
    this.rows.push({ runs: [] });
    this.chars = 0;
    this.lastLen = 0;
    this.state = "ground";
    this.csi = "";
    this.cr = false;
    this.fg = null;
    this.bold = false;
    this.dim = false;
    this.removed = 0;
    this.from = 0;
    this.trimmedFlag = false;
  }

  /** The text, without any styling, one line per row. */
  plainText(): string {
    return this.rows.map((line) => line.runs.map((r) => r.text).join("")).join("\n");
  }

  write(chunk: string): void {
    for (const ch of chunk) this.step(ch);
    this.enforceCaps();
  }

  // ------------------------------------------------------------------ the machine ---

  private step(ch: string): void {
    switch (this.state) {
      case "ground":
        return this.ground(ch);
      case "esc":
        return this.afterEscape(ch);
      case "escIntermediate": {
        const code = ch.charCodeAt(0);
        if (code >= 0x20 && code <= 0x2f) return; // more intermediates
        this.state = "ground";
        if (code >= 0x30 && code <= 0x7e) return; // the final byte: the whole sequence is dropped
        return this.ground(ch);
      }
      case "csi":
        return this.inCsi(ch);
      case "string":
        return this.inString(ch);
    }
  }

  private ground(ch: string): void {
    if (ch === "\x1b") {
      this.state = "esc";
      return;
    }
    if (ch === "\n") {
      this.cr = false;
      this.newLine();
      return;
    }
    if (ch === "\r") {
      this.cr = true;
      return;
    }
    if (ch === "\t") {
      this.text("    ");
      return;
    }
    this.text(isUnprintable(ch) ? "?" : ch);
  }

  private afterEscape(ch: string): void {
    const code = ch.charCodeAt(0);
    if (ch === "[") {
      this.state = "csi";
      this.csi = "";
      return;
    }
    if (ch === "]" || ch === "P" || ch === "_" || ch === "^" || ch === "X") {
      this.state = "string";
      this.stringLength = 0;
      this.stringEsc = false;
      return;
    }
    if (ch === "\x1b") return; // a second escape: still waiting
    if (code >= 0x20 && code <= 0x2f) {
      this.state = "escIntermediate";
      return;
    }
    this.state = "ground";
    // A lone escape code (ESC c, ESC 7, ESC =, ...) is dropped. Anything else was not part of it.
    if (code >= 0x30 && code <= 0x7e) return;
    this.ground(ch);
  }

  private inCsi(ch: string): void {
    const code = ch.charCodeAt(0);
    if (code >= 0x40 && code <= 0x7e) {
      this.state = "ground";
      this.dispatchCsi(this.csi, ch);
      this.csi = "";
      return;
    }
    if (code >= 0x20 && code <= 0x3f && this.csi.length < MAX_CSI) {
      this.csi += ch;
      return;
    }
    // Too long, or not a sequence character: give it up and read this character as text.
    this.state = "ground";
    this.csi = "";
    if (ch === "\x1b") this.state = "esc";
    else if (code !== 0x18 && code !== 0x1a) this.ground(ch);
  }

  private inString(ch: string): void {
    if (this.stringEsc) {
      this.stringEsc = false;
      if (ch === "\\") {
        this.state = "ground"; // ST: the string ends
        return;
      }
      this.state = "esc"; // a new escape began inside the string
      this.afterEscape(ch);
      return;
    }
    if (ch === "\x07") {
      this.state = "ground";
      return;
    }
    if (ch === "\x1b") {
      this.stringEsc = true;
      return;
    }
    if (++this.stringLength > MAX_STRING) this.state = "ground"; // not waiting any longer
  }

  private dispatchCsi(params: string, final: string): void {
    // A private marker or an intermediate byte means a code the commands never use.
    if (/^[<=>?]/.test(params) || /[\x20-\x2f]/.test(params)) return;
    if (final === "m") return this.sgr(params);
    if (final === "K") {
      const mode = params === "" ? 0 : Number(params);
      if (mode === 0) {
        if (this.cr) this.eraseLine();
      } else if (mode === 1 || mode === 2) {
        this.eraseLine();
      }
    }
  }

  private sgr(params: string): void {
    const values = (params === "" ? "0" : params).split(/[;:]/, MAX_SGR_PARAMS).map((p) => (/^\d{1,5}$/.test(p) ? Number(p) : p === "" ? 0 : -1));
    for (let i = 0; i < values.length; i++) {
      const v = values[i] as number;
      switch (v) {
        case 0:
          this.fg = null;
          this.bold = false;
          this.dim = false;
          break;
        case 1:
          this.bold = true;
          break;
        case 2:
          this.dim = true;
          break;
        case 22:
          this.bold = false;
          this.dim = false;
          break;
        case 31:
          this.fg = "ansi-danger";
          break;
        case 32:
          this.fg = "ansi-ok";
          break;
        case 33:
          this.fg = "ansi-warn";
          break;
        case 34:
          this.fg = "ansi-info";
          break;
        case 39:
          this.fg = null;
          break;
        case 90:
          this.fg = "ansi-slate";
          break;
        case 38: {
          const mode = values[i + 1];
          if (mode === 5) {
            const index = values[i + 2];
            if (index !== undefined && index >= 0) {
              const [r, g, b] = indexToRgb(index);
              this.fg = quantize(r, g, b);
            }
            i += 2;
          } else if (mode === 2) {
            const [r, g, b] = [values[i + 2], values[i + 3], values[i + 4]];
            if (r !== undefined && g !== undefined && b !== undefined && r >= 0 && g >= 0 && b >= 0) this.fg = quantize(Math.min(255, r), Math.min(255, g), Math.min(255, b));
            i += 4;
          } else {
            i += 1;
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------------ the lines ---

  private currentClass(): string {
    return [this.fg, this.bold ? "ansi-bold" : null, this.dim ? "ansi-dim" : null].filter((c): c is string => c !== null).join(" ");
  }

  private get last(): Line {
    return this.rows[this.rows.length - 1] as Line;
  }

  private lineLength(line: Line): number {
    let n = 0;
    for (const r of line.runs) n += r.text.length;
    return n;
  }

  private touch(): void {
    this.from = Math.min(this.from, this.rows.length - 1);
  }

  private newLine(): void {
    this.rows.push({ runs: [] });
    this.chars += 1;
    this.lastLen = 0;
    this.touch();
  }

  private eraseLine(): void {
    this.chars -= this.lastLen;
    this.lastLen = 0;
    this.last.runs = [];
    this.cr = false;
    this.touch();
  }

  private text(text: string): void {
    if (this.cr) {
      // A carriage return and then text: the new text replaces the line.
      this.eraseLine();
    }
    if (this.lastLen + text.length > MAX_LINE) this.newLine();
    const cls = this.currentClass();
    const runs = this.last.runs;
    const tail = runs[runs.length - 1];
    if (tail !== undefined && tail.cls === cls) tail.text += text;
    else runs.push({ text, cls });
    this.chars += text.length;
    this.lastLen += text.length;
    this.touch();
  }

  private enforceCaps(): void {
    if (this.rows.length <= this.maxLines && this.chars <= this.maxChars) return;
    let drop = 0;
    let chars = this.chars;
    // Always keep the line being written.
    while ((this.rows.length - drop > this.maxLines || chars > this.maxChars) && drop < this.rows.length - 1) {
      chars -= this.lineLength(this.rows[drop] as Line) + 1;
      drop++;
    }
    if (drop === 0) return;
    this.rows.splice(0, drop);
    this.chars = chars;
    this.removed += drop;
    this.from = Math.max(0, this.from - drop);
    this.trimmedFlag = true;
  }
}
