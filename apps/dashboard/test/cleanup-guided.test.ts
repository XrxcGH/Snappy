/**
 * Guided removal where there is no profile link to open (the desktop app, the sample data): the note says to copy the
 * username, and each row has a visible, labeled Copy button instead of a link. Where links exist, nothing changes.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, common } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { setPlatform } from "../src/platform.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { all, byLabel, mount, realStateOf, sampleStateOf, textOf } from "./lists-harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));
vi.mock("../src/clipboard.ts", () => ({ copyText: async () => true }));

let cleanupView: View;
let sample: State;
let real: State;
const guided = (s: State): State => ({ ...s, cleanup: { ...s.cleanup, guided: true } });

beforeAll(async () => {
  ({ cleanupView } = (await import("../src/views/cleanup.ts")) as { cleanupView: View });
  sample = guided(await sampleStateOf());
  real = guided(await realStateOf());
}, 120_000);
afterEach(() => setPlatform({}));

describe("guided removal without a profile link", () => {
  it("tells people to copy each username, and gives every row a labeled Copy button, for the sample", () => {
    const { root } = mount(cleanupView, sample);
    expect(textOf(root)).toContain(lists.guidedNoteNoLinks);
    expect(textOf(root)).not.toContain("Open each profile");
    const rows = all(root, "li.guided-row");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const copy = byLabel(row, lists.copyUsernameButton);
      expect(copy, "a labeled Copy button in the row").toBeDefined();
      expect(copy?.getAttribute("aria-label")).toMatch(/^Copy username /);
      // One copy control per row: the icon-only chip is replaced, not repeated.
      expect(all(row, "button").filter((b) => /^Copy username/.test(b.getAttribute("aria-label") ?? ""))).toHaveLength(1);
      expect(all(row, "a")).toHaveLength(0);
    }
  });

  it("does the same in the desktop app, where the shell turns profile links off", () => {
    setPlatform({ desktop: "windows", profileLinks: false });
    const { root } = mount(cleanupView, real);
    expect(textOf(root)).toContain(lists.guidedNoteNoLinks);
    for (const row of all(root, "li.guided-row")) expect(byLabel(row, lists.copyUsernameButton)).toBeDefined();
  });

  it("keeps the profile link, the icon chip and the original note where links are shown", () => {
    const { root } = mount(cleanupView, real);
    expect(textOf(root)).toContain(cleanup.guidedNote);
    expect(textOf(root)).not.toContain(lists.guidedNoteNoLinks);
    for (const row of all(root, "li.guided-row")) {
      expect(byLabel(row, lists.copyUsernameButton)).toBeUndefined();
      expect(all(row, "a").length).toBeGreaterThan(0);
      expect(all(row, "button").some((b) => b.getAttribute("aria-label")?.startsWith(common.copyUsername("").trim()))).toBe(true);
    }
  });
});
