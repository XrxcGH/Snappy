/**
 * The two live regions hold a sentence only while it is being spoken. Each region has its own timer, so a message to one never
 * cancels a message to the other, and spoken text is cleared after a while and when the page changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announce, clearAnnouncements } from "../src/announce.ts";

const regions: Record<string, { textContent: string }> = {};

beforeEach(() => {
  vi.useFakeTimers();
  regions["live-polite"] = { textContent: "" };
  regions["live-assertive"] = { textContent: "" };
  (globalThis as { document?: unknown }).document = { getElementById: (id: string) => regions[id] ?? null };
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { document?: unknown }).document;
});

describe("announce", () => {
  it("speaks a message shortly after clearing the region", () => {
    announce("Hello");
    expect(regions["live-polite"]?.textContent).toBe("");
    vi.advanceTimersByTime(60);
    expect(regions["live-polite"]?.textContent).toBe("Hello");
  });

  it("clears the sentence once it has been spoken", () => {
    announce("Hello");
    vi.advanceTimersByTime(60);
    vi.advanceTimersByTime(10_000);
    expect(regions["live-polite"]?.textContent).toBe("");
  });

  it("does not let an assertive message cancel a polite one made just before it", () => {
    announce("Polite");
    vi.advanceTimersByTime(10);
    announce("Assertive", true);
    vi.advanceTimersByTime(60);
    expect(regions["live-polite"]?.textContent).toBe("Polite");
    expect(regions["live-assertive"]?.textContent).toBe("Assertive");
  });

  it("lets a newer message in a region replace an older one that was not spoken yet", () => {
    announce("First");
    announce("Second");
    vi.advanceTimersByTime(60);
    expect(regions["live-polite"]?.textContent).toBe("Second");
  });

  it("restarts the clearing when the same region speaks again", () => {
    announce("First");
    vi.advanceTimersByTime(4_000);
    announce("Second");
    vi.advanceTimersByTime(4_000);
    expect(regions["live-polite"]?.textContent).toBe("Second");
  });
});

describe("clearAnnouncements", () => {
  it("empties text that was already spoken, in both regions", () => {
    announce("Polite");
    announce("Assertive", true);
    vi.advanceTimersByTime(60);
    clearAnnouncements();
    expect(regions["live-polite"]?.textContent).toBe("");
    expect(regions["live-assertive"]?.textContent).toBe("");
  });

  it("keeps a message that was made just before and has not been spoken yet", () => {
    announce("Export read. Opening your overview.");
    clearAnnouncements();
    vi.advanceTimersByTime(60);
    expect(regions["live-polite"]?.textContent).toBe("Export read. Opening your overview.");
  });

  it("does nothing without a page", () => {
    delete (globalThis as { document?: unknown }).document;
    expect(() => clearAnnouncements()).not.toThrow();
  });
});
