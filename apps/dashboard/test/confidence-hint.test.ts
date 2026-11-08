/**
 * The confidence explanation is not a tooltip: the badge has no title, each list page says what confidence means in one
 * visible line, and every row's "Why this appears" holds the hint for its own level, so it can be read with a keyboard,
 * on a touch screen and in the desktop app.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { common } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { confidenceBadge } from "../src/components/confidenceBadge.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { installFakeDom } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";
import { all, mount, sampleStateOf, textOf } from "./lists-harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

const views: Record<string, View> = {};
let sample: State;

beforeAll(async () => {
  const f = (await import("../src/views/findings.ts")) as Record<string, View>;
  views.disappeared = f.disappearedView!;
  views.requests = f.requestsView!;
  views.quiet = f.quietView!;
  views.cleanup = ((await import("../src/views/cleanup.ts")) as Record<string, View>).cleanupView!;
  sample = await sampleStateOf();
}, 120_000);

const LEVELS = ["high", "medium", "low"] as const;

describe("the confidence badge", () => {
  it.each(LEVELS)("has no title tooltip for %s", (level) => {
    installFakeDom();
    const badge = confidenceBadge(level) as unknown as FakeElement;
    for (const el of [badge, ...badge.descendants()]) expect(el.hasAttribute("title")).toBe(false);
    expect(textOf(badge)).toContain(common.confidenceWord[level]);
  });
});

describe.each(["disappeared", "requests", "quiet", "cleanup"])("the %s page", (name) => {
  it("says what confidence means in one visible line", () => {
    const { root } = mount(views[name]!, sample);
    const lines = all(root, "p.caption").filter((p) => textOf(p) === lists.confidenceKey);
    expect(lines).toHaveLength(1);
  });

  it("gives every row the hint for its level inside Why this appears", () => {
    const { root } = mount(views[name]!, sample);
    const rows = all(root, "li.candidate");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const level = LEVELS.find((l) => all(row, `.conf-${l}`).length > 0)!;
      const why = all(row, "details.why")[0];
      expect(why, "a Why this appears disclosure on every row").toBeDefined();
      expect(textOf(all(why!, "summary")[0]!)).toBe(common.why);
      expect(textOf(why!)).toContain(common.confidenceHint[level]);
    }
  });

  it("has no title attribute anywhere on the list", () => {
    const { root } = mount(views[name]!, sample);
    expect(root.descendants().filter((el) => el.hasAttribute("title"))).toHaveLength(0);
  });
});
