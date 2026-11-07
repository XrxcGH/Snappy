/**
 * The shared data table: a cell may mark its value so a wide page shows the value alone (the column header says the rest),
 * and a table that scrolls sideways becomes a named, focusable region while it scrolls and a plain block when it fits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cellAround, cellText, dataTable } from "../../src/components/dataTable.ts";
import { common } from "../../src/copy.ts";
import { installFakeDom } from "../fake-dom.ts";
import type { FakeElement } from "../fake-dom.ts";

describe("cellAround", () => {
  it("splits a full text around its value and keeps the words", () => {
    expect(cellAround("Added Nov 25, 2024", "Nov 25, 2024")).toEqual({ value: "Nov 25, 2024", before: "Added " });
    expect(cellAround("46 total", "46")).toEqual({ value: "46", after: " total" });
    expect(cellAround("2,151 counted in 2026", "2,151")).toEqual({ value: "2,151", after: " counted in 2026" });
    expect(cellAround("12", "12")).toEqual({ value: "12" });
  });

  it("leaves a text that does not hold the value, and an empty value, as plain text", () => {
    expect(cellAround("No chats or Snaps", "46")).toBe("No chats or Snaps");
    expect(cellAround("None found", "")).toBe("None found");
  });

  it("gives back the full text a phone shows", () => {
    expect(cellText(cellAround("From Jun 19, 2026", "Jun 19, 2026"))).toBe("From Jun 19, 2026");
    expect(cellText("plain")).toBe("plain");
  });
});

describe("a table cell with a value", () => {
  it("writes the words in spans a stylesheet can hide, and the text stays whole", () => {
    installFakeDom();
    const table = dataTable("Runs", ["Run", "From", "Length"], [["Longest", cellAround("From Jun 19, 2026", "Jun 19, 2026"), cellAround("6 days", "6")]]) as unknown as FakeElement;
    const [from, length] = table.querySelectorAll("td");
    expect(from?.textContent).toBe("From Jun 19, 2026");
    expect(from?.querySelector(".cell-extra")?.textContent).toBe("From ");
    expect(length?.querySelector(".cell-extra")?.textContent).toBe(" days");
  });
});

describe("a table that scrolls sideways", () => {
  let callbacks: (() => void)[];
  beforeEach(() => {
    callbacks = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callbacks.push(cb);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is a named, focusable region while it is wider than its frame, and a plain block when it fits", () => {
    installFakeDom();
    const wrap = dataTable("Friends with dates", ["A"], [["x"]]) as unknown as FakeElement;
    const size = (scroll: number, client: number): void => {
      Object.defineProperty(wrap, "scrollWidth", { value: scroll, configurable: true });
      Object.defineProperty(wrap, "clientWidth", { value: client, configurable: true });
      for (const cb of callbacks) cb();
    };
    size(800, 574);
    expect(wrap.getAttribute("tabindex")).toBe("0");
    expect(wrap.getAttribute("role")).toBe("region");
    expect(wrap.getAttribute("aria-label")).toBe(common.scrollTableFor("Friends with dates"));
    size(574, 574);
    expect(wrap.hasAttribute("tabindex")).toBe(false);
    expect(wrap.hasAttribute("role")).toBe(false);
    expect(wrap.hasAttribute("aria-label")).toBe(false);
    // A sub-pixel difference is not a scroll.
    size(575, 574);
    expect(wrap.hasAttribute("tabindex")).toBe(false);
  });

  it("is left alone where there is no ResizeObserver", () => {
    vi.unstubAllGlobals();
    installFakeDom();
    const wrap = dataTable("Friends", ["A"], [["x"]]) as unknown as FakeElement;
    expect(wrap.hasAttribute("tabindex")).toBe(false);
  });
});
