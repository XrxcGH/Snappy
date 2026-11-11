/**
 * The Memories page in the desktop app says that Run holds only a small test and that a full rescue needs the command
 * line tool, with the size limit as a number and a link to the guide. The web page does not carry that note.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { common } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { setPlatform } from "../src/platform.ts";
import type { State } from "../src/reducer.ts";
import { OUT_CAP_DESKTOP } from "../src/terminal/session.ts";
import type { View } from "../src/views/context.ts";
import type { FakeElement } from "./fake-dom.ts";
import { all, byKey, byLabel, mount, sampleStateOf, textOf } from "./lists-harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let memoriesView: View;
let sample: State;

beforeAll(async () => {
  ({ memoriesView } = (await import("../src/views/memories.ts")) as { memoriesView: View });
  sample = await sampleStateOf();
}, 120_000);
afterEach(() => setPlatform({}));

describe("Memories rescue in the desktop app", () => {
  it("names the limit as a number, says a full rescue needs the command line tool, and links to the guide", () => {
    setPlatform({ desktop: "windows", profileLinks: false });
    const { root } = mount(memoriesView, sample);
    const mb = OUT_CAP_DESKTOP / 1_000_000;
    expect(textOf(root)).toContain(lists.rescueLimitNote(mb));
    expect(textOf(root)).toContain("up to 250 MB");
    expect(textOf(root)).toContain("A full rescue needs the command line tool.");
    const link = byLabel(root, common.openGuide);
    expect(link?.getAttribute("href")).toBe("#/guide");
  });

  it("puts the note after the command blocks, inside the rescue section", () => {
    setPlatform({ desktop: "other" });
    const { root } = mount(memoriesView, sample);
    const section = all(root, "section").find((s) => textOf(s).includes(lists.rescueGuideLine));
    expect(section).toBeDefined();
    const blocks = all(section!, ".command");
    expect(blocks.length).toBeGreaterThan(0);
    const order = section!.descendants();
    const lastBlock = Math.max(...blocks.map((b) => order.indexOf(b)));
    const note = order.findIndex((e) => e.tagName === "p" && textOf(e).startsWith("Run copies a small test here"));
    expect(note).toBeGreaterThan(lastBlock);
  });

  it("leaves the web page without the note", () => {
    const { root } = mount(memoriesView, sample);
    expect(textOf(root)).not.toContain("A full rescue needs the command line tool.");
    expect(byLabel(root, common.openGuide)).toBeUndefined();
  });
});

describe("The size cap field on the Memories page", () => {
  it("hides the meter and notes for the old cap while the cap is refused", () => {
    const { root } = mount(memoriesView, sample);
    const input = byKey(root, "cap-input")!;
    const blocks = all(root, ".meter-block");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.hidden).toBe(false);
    input.value = "abc";
    (root.querySelector("form.cap-form") as FakeElement).fire("submit");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(textOf(root.querySelector("#cap-error") as FakeElement)).not.toBe("");
    expect(blocks[0]!.hidden).toBe(true);
    input.value = "5";
    (root.querySelector("form.cap-form") as FakeElement).fire("submit");
    expect(blocks[0]!.hidden).toBe(false);
  });
});
