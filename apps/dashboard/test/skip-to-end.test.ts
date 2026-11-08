/**
 * "Skip to end of list": a long list that asks for it starts with a link that jumps past the rows (focus goes to a mark
 * after them, so the next Tab reaches "Show more" or what follows). Short lists and lists that did not ask have none.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { lists } from "../src/copy-lists.ts";
import { h } from "../src/dom.ts";
import { SKIP_FROM, pagedList } from "../src/components/pagedList.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { all, mount, sampleStateOf, textOf } from "./lists-harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let views: Record<string, View>;
let sample: State;

beforeAll(async () => {
  const f = (await import("../src/views/findings.ts")) as Record<string, View>;
  views = { disappeared: f.disappearedView!, quiet: f.quietView!, cleanup: ((await import("../src/views/cleanup.ts")) as Record<string, View>).cleanupView! };
  sample = await sampleStateOf();
}, 120_000);

const rows = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const draw = (n: number, skipLink: boolean | undefined, key: string): FakeElement => {
  installFakeDom();
  return pagedList(rows(n), (i) => h("li", {}, String(i)), { key, ...(skipLink === undefined ? {} : { skipLink }) }) as unknown as FakeElement;
};

describe("the skip link on a paged list", () => {
  it("comes first, and jumps to a mark after the rows and before Show more", () => {
    const list = draw(SKIP_FROM + 20, true, "skip-a");
    const kids = list.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
    const skip = kids[0]!;
    expect(skip.tagName).toBe("a");
    expect(textOf(skip)).toBe(lists.skipToEnd);
    const end = kids.find((k) => k.classList.contains("list-end"))!;
    expect(end.getAttribute("tabindex")).toBe("-1");
    expect(textOf(end)).toBe(lists.endOfList);
    const names = kids.map((k) => k.className.split(" ")[0] || k.tagName);
    expect(names.indexOf("list-end")).toBeGreaterThan(names.indexOf("list-skip"));
    expect(kids.indexOf(end)).toBe(kids.findIndex((k) => k.tagName === "ul") + 1);
    expect(kids[kids.length - 1]!.classList.contains("more")).toBe(true);
    let prevented = false;
    skip.fire("click", { preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
    expect(FakeElement.lastFocused).toBe(end);
  });

  it("is left out of a short list, and of a list that did not ask", () => {
    expect(all(draw(SKIP_FROM - 1, true, "skip-b"), ".list-skip")).toHaveLength(0);
    expect(all(draw(SKIP_FROM + 5, undefined, "skip-c"), ".list-skip")).toHaveLength(0);
    expect(all(draw(SKIP_FROM + 5, false, "skip-d"), ".list-end")).toHaveLength(0);
  });
});

describe("the lists of people", () => {
  it.each(["disappeared", "quiet", "cleanup"])("%s has the link above its rows", (name) => {
    const { root } = mount(views[name]!, sample);
    const skips = all(root, "a.list-skip");
    expect(skips.length).toBeGreaterThan(0);
    const first = skips[0]!;
    const order = root.descendants();
    expect(order.indexOf(first)).toBeLessThan(order.indexOf(all(root, "li.candidate")[0]!));
    expect(textOf(first)).toBe(lists.skipToEnd);
  });
});
