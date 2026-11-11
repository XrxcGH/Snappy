/**
 * The findings pages while the saved history is locked: they say so and offer Unlock, not "No export yet" and Add export.
 * The Overview does the same (see overview-ledger.test.ts). Synthetic state only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, common, disappeared, memories, overview, quiet, requests } from "../src/copy.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { all, mount, textOf } from "./lists-harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let views: Record<string, View>;
beforeAll(async () => {
  const f = (await import("../src/views/findings.ts")) as Record<string, View>;
  const c = (await import("../src/views/cleanup.ts")) as Record<string, View>;
  const m = (await import("../src/views/memories.ts")) as Record<string, View>;
  views = { disappeared: f.disappearedView!, requests: f.requestsView!, quiet: f.quietView!, cleanup: c.cleanupView!, memories: m.memoriesView! };
}, 120_000);

const base = initialState();
const locked: State = { ...base, vault: { ...base.vault, hasSaved: true, phase: "locked" } };
const NO_EXPORT: Record<string, string> = {
  disappeared: disappeared.noExportTitle,
  requests: requests.noExportTitle,
  quiet: quiet.noExportTitle,
  cleanup: cleanup.emptyTitle,
  memories: memories.noExportTitle,
};

describe("a findings page while the saved history is locked", () => {
  for (const id of Object.keys(NO_EXPORT)) {
    it(`${id} says the history is locked and offers Unlock`, () => {
      const { root } = mount(views[id]!, locked);
      const text = textOf(root);
      expect(text).toContain(overview.lockedTitle);
      expect(text).toContain(common.lockedBody);
      expect(text).not.toContain("No export yet");
      const link = all(root, "a").find((a) => textOf(a) === overview.lockedAction);
      expect(link?.getAttribute("href")).toBe("#/start");
      expect(all(root, "a").some((a) => textOf(a) === common.addExport)).toBe(false);
    });

    it(`${id} keeps "No export yet" when nothing is saved`, () => {
      const { root } = mount(views[id]!, base);
      expect(textOf(root)).toContain(NO_EXPORT[id]!);
      expect(textOf(root)).not.toContain(overview.lockedTitle);
    });
  }
});
