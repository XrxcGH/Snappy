/**
 * Output must be readable where it lands: it starts at the top when a command ends, it wraps inside the
 * box instead of running off the edge, and the commands are asked to fit a phone-width box.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { MIN_COLUMNS, createLogView, measureColumns, warmOutputFont } from "../src/terminal/ansi-view.ts";
import type { LogView } from "../src/terminal/ansi-view.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

beforeAll(() => {
  installFakeDom();
});

function view(): { log: LogView; el: FakeElement } {
  const log = createLogView({ label: "Command output", trimmedText: "Earlier output removed.", schedule: () => () => undefined });
  return { log, el: log.element as unknown as FakeElement };
}

const scrolled = (el: FakeElement): void => (el.listeners.get("scroll") ?? []).forEach((fn) => fn({}));

describe("when the command ends", () => {
  it("goes back to the first line when the person was following the end, so the reading starts at the top", () => {
    const { log, el } = view();
    el.clientHeight = 100;
    el.scrollHeight = 300;
    log.write("first\nsecond\n");
    log.flush();
    expect(el.scrollTop).toBe(300); // still following the end while it runs
    log.write("third\n");
    log.finish();
    expect(el.scrollTop).toBe(0);
    expect(log.plainText()).toBe("first\nsecond\nthird\n");
    // It does not follow the end any more, even when more is drawn.
    el.scrollTop = 40;
    el.scrollHeight = 600;
    log.refresh();
    log.flush();
    expect(el.scrollTop).toBe(40);
  });

  it("leaves the position alone when the person had scrolled up while it ran", () => {
    const { log, el } = view();
    el.clientHeight = 100;
    el.scrollHeight = 500;
    log.write("a\n");
    log.flush();
    el.scrollTop = 120;
    scrolled(el);
    log.write("b\n");
    log.finish();
    expect(el.scrollTop).toBe(120);
  });

  it("can be called again without moving what the person has scrolled to since", () => {
    const { log, el } = view();
    el.clientHeight = 100;
    el.scrollHeight = 500;
    log.write("a\n");
    log.finish();
    el.scrollTop = 200;
    scrolled(el);
    log.finish();
    expect(el.scrollTop).toBe(200);
  });
});

describe("the width the commands are asked to fit", () => {
  /** A host that gives the measuring area a width and the probe a character width, as a layout would. */
  function hostOf(width: number, char = 8): HTMLElement {
    const host = new FakeElement("div");
    const add = host.appendChild.bind(host);
    host.appendChild = ((child: FakeElement) => {
      child.clientWidth = width;
      for (const el of child.descendants()) {
        if (el.classList.contains("t-probe")) (el as unknown as { getBoundingClientRect: () => { width: number } }).getBoundingClientRect = () => ({ width: char * 100 });
      }
      return add(child);
    }) as typeof host.appendChild;
    return host as unknown as HTMLElement;
  }

  beforeAll(() => {
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({ paddingLeft: "16px", paddingRight: "16px" });
  });

  it("is the number of characters that really fit, with no column held back", () => {
    // (386 - 32) / 8 = 44.25 characters across: 44 columns, and a line of 44 fits.
    expect(measureColumns(hostOf(386))).toBe(44);
    // Exactly 44 characters wide, less the half pixel clientWidth may have rounded up: one fewer, never one more.
    expect(measureColumns(hostOf(384))).toBe(43);
  });

  it("measures a probe of a hundred characters, so one character is known to a fraction of a pixel", () => {
    // 8.4 px a character: (500 - 32) / 8.4 = 55.7 columns.
    expect(measureColumns(hostOf(500, 8.4))).toBe(55);
  });

  it("goes below the old floor of 40 on a phone, down to a narrow minimum", () => {
    // A 320 px phone gives the box about 262 px of text, so a few more than 30 characters are asked for.
    expect(measureColumns(hostOf(294))).toBe(32);
    expect(measureColumns(hostOf(200))).toBe(MIN_COLUMNS);
    expect(MIN_COLUMNS).toBeLessThan(40);
    expect(MIN_COLUMNS).toBeGreaterThanOrEqual(20); // the helper refuses fewer
  });

  it("asks the browser for the output font first, so a measurement is never taken in the fallback font", () => {
    const doc = document as unknown as { fonts?: { load: (spec: string) => Promise<unknown[]> } };
    const asked: string[] = [];
    doc.fonts = { load: (spec) => (asked.push(spec), Promise.resolve([])) };
    try {
      measureColumns(hostOf(384));
      warmOutputFont();
      expect(asked).toEqual(['400 14px "JetBrains Mono"', '400 14px "JetBrains Mono"']);
      // A page without the font API, or one that refuses, is not an error.
      doc.fonts = { load: () => Promise.reject(new Error("no")) };
      expect(() => warmOutputFont()).not.toThrow();
      delete doc.fonts;
      expect(() => warmOutputFont()).not.toThrow();
    } finally {
      delete doc.fonts;
    }
  });

  it("stops at 100 on a wide screen", () => {
    expect(measureColumns(hostOf(4000))).toBe(100);
  });
});

describe("the output box styles", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const rule = (selector: string): string => {
    const start = css.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  it("wraps long lines inside the box instead of cutting them off at the edge", () => {
    const log = rule(".t-log");
    expect(log).toMatch(/white-space:\s*pre-wrap/);
    expect(log).toMatch(/overflow-wrap:\s*anywhere/);
    expect(log).not.toMatch(/white-space:\s*pre;/);
  });

  it("measures in an area that has the real area's overflow and scrollbar gutter, so the width is the real one", () => {
    // The measuring area is a .t-log too; its own rule may hide it and take it out of the flow, but must not change its overflow.
    expect(rule(".t-measure")).not.toMatch(/overflow/);
    expect(rule(".t-measure")).not.toMatch(/scrollbar-gutter/);
    expect(rule(".t-log")).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("draws the digits plain, like the rest of the page, and keeps them one monospace cell wide", () => {
    // JetBrains Mono slashes its zero. "Snappy Digits" goes first so only 0 to 9 switch; tabular-nums gives them the mono advance.
    const log = rule(".t-log");
    expect(log).toMatch(/font-family:\s*"Snappy Digits",\s*var\(--font-mono\)/);
    expect(log).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("draws a line of box and block characters tight, so the logo's pieces touch", () => {
    const art = rule(".t-art");
    expect(art).toMatch(/line-height:\s*1;/);
    expect(art).toMatch(/letter-spacing:\s*0;/);
    expect(art).toMatch(/font-variant-ligatures:\s*none/);
  });

  it("closes the hairline between touching blocks with a stroke in the text's own color", () => {
    expect(rule(".t-block")).toMatch(/-webkit-text-stroke:\s*[\d.]+em currentColor/);
  });

  it("does not trap scrolling on a touch screen, and does not outgrow a short screen", () => {
    const log = rule(".t-log");
    expect(log).not.toMatch(/overscroll-behavior:\s*contain/);
    expect(log).toMatch(/max-height:\s*min\(24rem,\s*70vh\)/);
  });
});
