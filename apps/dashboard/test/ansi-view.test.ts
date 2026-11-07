import { beforeAll, describe, expect, it } from "vitest";
import { ANSI_CLASSES, TerminalBuffer, isUnprintable } from "../src/terminal/ansi.ts";
import { DRAW_MS, createLogView } from "../src/terminal/ansi-view.ts";
import type { LogView } from "../src/terminal/ansi-view.ts";
import { hideInvisible } from "../src/safe.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

const ESC = "\x1b";

beforeAll(() => {
  installFakeDom();
});

function timers() {
  const tasks: { fn: () => void; ms: number; live: boolean }[] = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      const t = { fn, ms, live: true };
      tasks.push(t);
      return () => void (t.live = false);
    },
    fire: () => {
      for (const t of tasks.splice(0)) if (t.live) t.fn();
    },
    live: () => tasks.filter((t) => t.live).length,
    delays: () => tasks.filter((t) => t.live).map((t) => t.ms),
  };
}

function view(extra: Partial<Parameters<typeof createLogView>[0]> = {}): { log: LogView; el: FakeElement; t: ReturnType<typeof timers> } {
  const t = timers();
  const log = createLogView({ label: "Command output", trimmedText: "Earlier output removed.", schedule: t.schedule, ...extra });
  return { log, el: log.element as unknown as FakeElement, t };
}

const lineTexts = (el: FakeElement): string[] => el.childNodes.filter((c): c is FakeElement => c instanceof FakeElement && c.classList.contains("t-line")).map((l) => l.textContent);

describe("the output area", () => {
  it("is a labelled log that is not announced line by line, and can be focused to scroll", () => {
    const { el } = view();
    expect(el.tagName).toBe("div");
    expect(el.getAttribute("role")).toBe("log");
    expect(el.getAttribute("aria-live")).toBe("off");
    expect(el.getAttribute("aria-label")).toBe("Command output");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.classList.contains("t-log")).toBe(true);
  });

  it("draws output after the short delay, in one batch, not on every write", () => {
    const { log, el, t } = view();
    log.write("one\n");
    log.write("two\n");
    log.write("three");
    expect(lineTexts(el)).toEqual([]);
    expect(t.delays()).toEqual([DRAW_MS]);
    t.fire();
    expect(lineTexts(el)).toEqual(["one", "two", "three"]);
    expect(log.plainText()).toBe("one\ntwo\nthree");
  });

  it("draws a styled run as a span with the class from the closed list", () => {
    const { log, el } = view();
    log.write(`${ESC}[1m${ESC}[32mgood${ESC}[0m plain`);
    log.flush();
    const spans = el.querySelectorAll(".t-run");
    expect(spans.map((s) => s.className)).toEqual(["t-run ansi-ok ansi-bold", "t-run"]);
    expect(spans.map((s) => s.textContent)).toEqual(["good", " plain"]);
  });

  it("updates only the line being written, and redraws a replaced line in place", () => {
    const { log, el } = view();
    log.write("keep\nloading 10%");
    log.flush();
    const [first, second] = el.childNodes as FakeElement[];
    log.write("\rloading 90%");
    log.flush();
    const after = el.childNodes as FakeElement[];
    expect(after[0]).toBe(first); // untouched
    expect(after[1]).toBe(second); // the same element, new content
    expect(lineTexts(el)).toEqual(["keep", "loading 90%"]);
  });

  it("drops the oldest lines past the cap and shows the notice once above the output", () => {
    const small = createLogView({ label: "x", trimmedText: "Earlier output removed.", schedule: () => () => undefined, buffer: new TerminalBuffer({ maxLines: 4 }) });
    const host = small.element as unknown as FakeElement;
    for (let i = 0; i < 12; i++) small.write(`line ${i}\n`);
    small.flush();
    expect((host.childNodes[0] as FakeElement).textContent).toBe("Earlier output removed.");
    expect(lineTexts(host).length).toBeLessThanOrEqual(5);
    expect(lineTexts(host).at(-2)).toBe("line 11");
    expect(host.querySelectorAll(".t-trimmed")).toHaveLength(1);
  });

  it("clears everything, including a pending draw", () => {
    const { log, el, t } = view();
    log.write("text");
    log.clear();
    t.fire();
    expect(el.childNodes).toHaveLength(0);
    expect(log.plainText()).toBe("");
    log.write("again");
    log.flush();
    expect(lineTexts(el)).toEqual(["again"]);
  });

  it("stops drawing after it is disposed", () => {
    const { log, t } = view();
    log.write("x");
    log.dispose();
    expect(t.live()).toBe(0);
  });
});

describe("following the output", () => {
  it("scrolls to the bottom as output arrives, until the person scrolls up, and follows again at the bottom", () => {
    const { log, el } = view();
    el.clientHeight = 100;
    el.scrollHeight = 300;
    log.write("a\n");
    log.flush();
    expect(el.scrollTop).toBe(300);

    // The person scrolls up: a scroll event with the position away from the bottom.
    el.scrollTop = 50;
    (el.listeners.get("scroll") ?? []).forEach((fn) => fn({}));
    el.scrollHeight = 500;
    log.write("b\n");
    log.flush();
    expect(el.scrollTop).toBe(50);

    // Back at the bottom: it follows again.
    el.scrollTop = 400;
    (el.listeners.get("scroll") ?? []).forEach((fn) => fn({}));
    el.scrollHeight = 700;
    log.write("c\n");
    log.flush();
    expect(el.scrollTop).toBe(700);
  });
});

describe("what the view builds", () => {
  const BAD_TAG = /^(?!div$|span$)/;

  it("is only divs and spans inside the log, with one attribute, class, and no style", () => {
    const { log, el } = view();
    log.write(`${ESC}[31mred${ESC}[0m <b>not markup</b> &amp; "quotes" <script>x</script>\n${ESC}]0;title\x07next`);
    log.flush();
    const inside = el.descendants();
    expect(inside.length).toBeGreaterThan(2);
    for (const node of inside) {
      expect(node.tagName).not.toMatch(BAD_TAG);
      expect([...node.attrs.keys()]).toEqual(["class"]);
      expect(node.styleProps.size).toBe(0);
    }
    // Text that looks like markup is text.
    expect(el.textContent).toContain("<b>not markup</b> &amp;");
    expect(inside.some((n) => n.tagName === "script" || n.tagName === "b")).toBe(false);
  });

  it("only ever uses the two structural classes and the closed list", () => {
    const { log, el } = view();
    log.write(`${ESC}[1;2;31;32;33;34;90;38;5;99;38;2;255;154;99mx`);
    log.flush();
    for (const node of el.descendants()) {
      for (const cls of node.className.split(" ").filter(Boolean)) expect(["t-line", "t-run", ...ANSI_CLASSES], cls).toContain(cls);
    }
  });

  it("survives random hostile output with the same guarantees", () => {
    let seed = 99;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pieces = [ESC, `${ESC}[`, `${ESC}[31m`, `${ESC}]0;t\x07`, "\n", "\r", "<", ">", "&", '"', "'", "x", "é", "‮", `${ESC}[2K`, "javascript:alert(1)", "<img src=x onerror=alert(1)>"];
    const { log, el } = view();
    for (let i = 0; i < 300; i++) log.write(pieces[Math.floor(rand() * pieces.length)] as string);
    log.flush();
    for (const node of el.descendants()) {
      expect(node.tagName).toMatch(/^(div|span)$/);
      expect([...node.attrs.keys()]).toEqual(["class"]);
    }
    expect(el.textContent).not.toContain(ESC);
  });
});

describe("what is shown as a question mark", () => {
  it("is the same set the dashboard hides everywhere else", () => {
    for (let code = 0; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const ch = String.fromCharCode(code);
      expect(isUnprintable(ch), `U+${code.toString(16)}`).toBe(hideInvisible(ch) !== ch);
    }
  });
});
