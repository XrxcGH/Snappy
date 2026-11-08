/**
 * The keep list as a list on the Cleanup page: a count, adding a username before it shows up in the queue, and Remove
 * for each name, including a kept friend who is not in the queue (which could not be found or undone before).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { common } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { keepKeyFrom } from "../src/components/keepListSection.ts";
import { displayUsername } from "../src/safe.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import type { FakeElement } from "./fake-dom.ts";
import { all, byKey, mount, sampleStateOf, textOf } from "./lists-harness.ts";

const spoken: string[] = [];
vi.mock("../src/announce.ts", () => ({ announce: (m: string) => void spoken.push(m) }));

let cleanupView: View;
let sample: State;

beforeAll(async () => {
  ({ cleanupView } = (await import("../src/views/cleanup.ts")) as { cleanupView: View });
  sample = await sampleStateOf();
}, 120_000);
beforeEach(() => {
  spoken.length = 0;
});

const section = (root: FakeElement): FakeElement => all(root, "details.keep-list")[0]!;
const heading = (root: FakeElement): string => textOf(all(section(root), "summary")[0]!);
const add = (root: FakeElement, typed: string): void => {
  const input = all(section(root), "input")[0]!;
  input.value = typed;
  all(section(root), "form")[0]!.fire("submit");
};
const names = (root: FakeElement): string[] => all(section(root), "li.keep-row").map((r) => textOf(all(r, ".username")[0]!));

describe("keepKeyFrom", () => {
  it("trims, lower-cases and drops one leading @", () => {
    expect(keepKeyFrom("  Friend_Zed ")).toBe("friend_zed");
    expect(keepKeyFrom("@zed")).toBe("zed");
  });

  it("refuses an empty name, spaces inside, hidden characters and a pasted paragraph", () => {
    expect(keepKeyFrom("")).toBeNull();
    expect(keepKeyFrom("   ")).toBeNull();
    expect(keepKeyFrom("two names")).toBeNull();
    expect(keepKeyFrom("bad‮name")).toBeNull();
    expect(keepKeyFrom("a".repeat(65))).toBeNull();
  });
});

describe("the keep list section on Cleanup", () => {
  it("shows the count and says when it is empty", () => {
    const { root } = mount(cleanupView, sample);
    expect(heading(root)).toBe(lists.keepHeading(0));
    expect(textOf(section(root))).toContain(lists.keepEmpty);
    expect(names(root)).toEqual([]);
  });

  it("adds a username that is not in the queue, shows it, and counts it", () => {
    const { root, store } = mount(cleanupView, sample);
    add(root, "  Not_In_Queue_7 ");
    expect(store.get().sample?.allowlist).toEqual(["not_in_queue_7"]);
    expect(names(root)).toEqual(["not_in_queue_7"]);
    expect(heading(root)).toBe(lists.keepHeading(1));
    expect(spoken).toContain(common.kept("not_in_queue_7"));
  });

  it("removes a kept friend who is not in the queue", () => {
    const { root, store } = mount(cleanupView, sample);
    add(root, "left_long_ago");
    const remove = byKey(section(root), "keep-remove:left_long_ago")!;
    expect(remove.getAttribute("aria-label")).toBe(lists.keepRemoveFor("left_long_ago"));
    remove.click();
    expect(store.get().sample?.allowlist).toEqual([]);
    expect(names(root)).toEqual([]);
    expect(heading(root)).toBe(lists.keepHeading(0));
    expect(spoken).toContain(lists.keepRemoved("left_long_ago"));
  });

  it("lists every kept friend, sorted, each with its own Remove button", () => {
    const { root } = mount(cleanupView, sample);
    add(root, "zed");
    add(root, "amy");
    expect(names(root)).toEqual(["amy", "zed"]);
    expect(all(section(root), "li.keep-row").every((r) => all(r, "button").length === 1)).toBe(true);
  });

  it("says so when the name is already on the list, and adds nothing twice", () => {
    const { root, store } = mount(cleanupView, sample);
    add(root, "amy");
    spoken.length = 0;
    add(root, "AMY");
    expect(store.get().sample?.allowlist).toEqual(["amy"]);
    expect(spoken).toEqual([lists.keepAlready("amy")]);
  });

  it("explains a name it will not take, and marks the box invalid", () => {
    const { root, store } = mount(cleanupView, sample);
    add(root, "two names");
    expect(textOf(all(section(root), ".field-error")[0]!)).toBe(lists.keepAddError);
    expect(all(section(root), "input")[0]!.getAttribute("aria-invalid")).toBe("true");
    expect(store.get().sample?.allowlist).toEqual([]);
  });

  it("writes names as text only, through displayUsername", () => {
    const { root } = mount(cleanupView, { ...sample, sample: { ...sample.sample!, allowlist: ["bad‮name"] } });
    expect(names(root)).toEqual([displayUsername("bad‮name")]);
    expect(section(root).textContent).not.toMatch(/‮/);
  });
});
