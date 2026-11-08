/**
 * The shared time zone helper: where a tool's zone starts (the last choice, else the device, else UTC), what is
 * remembered and how safely, the option list and the caption that says which zone a page used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zone } from "../../src/copy-tools.ts";
import { OFFSETS, deviceOffsetMinutes, forgetPreferredOffset, offsetLabel, readPreferredOffset, rememberOffset, startingOffset, zoneCaption, zoneOptions } from "../../src/tools/timezone.ts";
import type { FakeElement } from "../fake-dom.ts";
import { installFakeDom } from "../fake-dom.ts";

/** A device that is `east` minutes east of UTC (getTimezoneOffset counts the other way). */
const deviceAt = (east: number): void => void vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-east);

let stored: Map<string, string>;
beforeEach(() => {
  installFakeDom();
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  });
  forgetPreferredOffset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the device offset", () => {
  it("is minutes east of UTC, and never negative zero", () => {
    deviceAt(-300);
    expect(deviceOffsetMinutes()).toBe(-300);
    deviceAt(0);
    expect(Object.is(deviceOffsetMinutes(), 0)).toBe(true);
    deviceAt(345);
    expect(deviceOffsetMinutes()).toBe(345);
  });
});

describe("the label", () => {
  it("reads UTC, UTC+2:00 and UTC-5:30", () => {
    expect([0, 120, -330, 345, -720, 840].map(offsetLabel)).toEqual(["UTC", "UTC+2:00", "UTC-5:30", "UTC+5:45", "UTC-12:00", "UTC+14:00"]);
    expect(offsetLabel(Number.NaN)).toBe("");
  });
});

describe("where a tool's zone starts", () => {
  it("is the device's zone when nothing was chosen", () => {
    deviceAt(-480);
    expect(startingOffset()).toBe(-480);
    deviceAt(60);
    expect(startingOffset()).toBe(60);
  });

  it("is UTC when the device is in a zone the list does not offer", () => {
    deviceAt(100);
    expect(OFFSETS.includes(100)).toBe(false);
    expect(startingOffset()).toBe(0);
  });

  it("is the last choice, over the device's zone, and survives a new page load through what the page remembers", () => {
    deviceAt(-480);
    rememberOffset(120);
    expect(startingOffset()).toBe(120);
    expect(stored.get("snappy-zone")).toBe("120");
    // A new page: nothing in memory, only the stored value.
    vi.resetModules();
    return import("../../src/tools/timezone.ts").then((fresh) => {
      expect(fresh.readPreferredOffset()).toBe(120);
      expect(fresh.startingOffset()).toBe(120);
    });
  });

  it("ignores a choice the list does not offer, and a stored value that is not a number", () => {
    rememberOffset(100);
    expect(readPreferredOffset()).toBeNull();
    expect(stored.has("snappy-zone")).toBe(false);
    for (const bad of ["abc", "1e3", "", "100", "--60", "<script>"]) {
      stored.set("snappy-zone", bad);
      expect(readPreferredOffset(), bad).toBeNull();
    }
  });

  it("forgets the choice when asked, in memory and in storage", () => {
    deviceAt(-60);
    rememberOffset(180);
    forgetPreferredOffset();
    expect(readPreferredOffset()).toBeNull();
    expect(stored.has("snappy-zone")).toBe(false);
    expect(startingOffset()).toBe(-60);
  });

  it("works when storage is blocked: the session still remembers, nothing throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    deviceAt(0);
    expect(() => rememberOffset(60)).not.toThrow();
    expect(startingOffset()).toBe(60);
    expect(() => forgetPreferredOffset()).not.toThrow();
    expect(startingOffset()).toBe(0);
  });
});

describe("the select options and the caption", () => {
  it("offers every zone once, in order, with only the chosen one selected", () => {
    const options = zoneOptions(-300) as unknown as FakeElement[];
    expect(options.map((o) => Number(o.getAttribute("value")))).toEqual([...OFFSETS]);
    expect(options.filter((o) => o.hasAttribute("selected")).map((o) => o.textContent)).toEqual(["UTC-5:00"]);
    expect(options.find((o) => o.getAttribute("value") === "0")?.textContent).toBe("UTC");
  });

  it("says which zone the dates are in", () => {
    const caption = zoneCaption(-300) as unknown as FakeElement;
    expect(caption.tagName).toBe("p");
    expect(caption.classList.contains("caption")).toBe(true);
    expect(caption.textContent).toBe("Dates are in UTC-5:00.");
    expect(zoneCaption(0).textContent).toBe(zone.datesIn("UTC"));
  });
});
