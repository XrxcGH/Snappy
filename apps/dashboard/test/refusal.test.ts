/**
 * A refused drop is spoken and written on screen for a few seconds, from one helper that every path uses. The note is
 * built in the small fake DOM, and is not a live region (the polite announcement speaks it).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRefusal, REFUSAL_MS, refuse } from "../src/refusal.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

const spoken: string[] = [];
vi.mock("../src/announce.ts", () => ({ announce: (m: string) => void spoken.push(m) }));

let body: FakeElement;
beforeAll(() => {
  body = installFakeDom().body;
});
beforeEach(() => {
  vi.useFakeTimers();
  spoken.length = 0;
});
afterEach(() => {
  clearRefusal();
  body.replaceChildren();
  vi.useRealTimers();
});

describe("refuse", () => {
  it("speaks the text and shows it on screen, then takes it away", () => {
    refuse("A read is already going.");
    const host = body.querySelector(".drop-refusal") as FakeElement;
    expect(spoken).toEqual(["A read is already going."]);
    expect(host.textContent).toBe("A read is already going.");
    expect(host.querySelectorAll("[role=status]")).toHaveLength(0);
    expect(host.getAttribute("aria-live")).toBeNull();
    vi.advanceTimersByTime(REFUSAL_MS);
    expect(host.textContent).toBe("");
  });

  it("restarts the time when another refusal comes, and keeps one host", () => {
    refuse("First.");
    vi.advanceTimersByTime(REFUSAL_MS - 1000);
    refuse("Second.");
    vi.advanceTimersByTime(REFUSAL_MS - 1000);
    expect(body.querySelectorAll(".drop-refusal")).toHaveLength(1);
    expect((body.querySelector(".drop-refusal") as FakeElement).textContent).toBe("Second.");
    vi.advanceTimersByTime(1000);
    expect((body.querySelector(".drop-refusal") as FakeElement).textContent).toBe("");
  });

  it("is drawn again after the page was cleared", () => {
    refuse("One.");
    clearRefusal();
    expect(body.querySelector(".drop-refusal")).toBeNull();
    refuse("Two.");
    expect((body.querySelector(".drop-refusal") as FakeElement).textContent).toBe("Two.");
  });
});
