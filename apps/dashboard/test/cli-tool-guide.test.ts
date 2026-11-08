/**
 * The "Command line tool" section of the Export guide and the link to it under a tool page's command block: a person
 * who installed the app is told what the tool is, what it needs and where to get it, before the first command.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cliTool } from "../src/copy-tools.ts";
import { setPlatform } from "../src/platform.ts";
import type { State } from "../src/reducer.ts";
import { TOOLS } from "../src/tools/registry.ts";
import { guideView } from "../src/views/guide.ts";
import type { FakeElement } from "./fake-dom.ts";
import { emptyState, render, renderSettled, sampleState } from "./tools/harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let sample: State;
beforeAll(async () => {
  sample = await sampleState();
}, 120_000);
afterEach(() => setPlatform({}));

const sections = (root: FakeElement): FakeElement[] => root.querySelectorAll("section.section");
const titleOf = (s: FakeElement): string => s.querySelector("h2")?.textContent ?? "";

describe("the Export guide section on the command line tool", () => {
  it("names the tool, what it needs and where to get it, and comes before the first command block", () => {
    const { root } = render(guideView, emptyState());
    const section = sections(root).find((s) => titleOf(s) === cliTool.heading) as FakeElement;
    expect(section).toBeDefined();
    expect(section.textContent).toContain("Node 22.18 or later must be installed");
    expect(section.textContent).toContain("separate program");
    expect(section.textContent).toContain("Snappy repository on GitHub");
    const all = root.descendants();
    expect(all.indexOf(section)).toBeLessThan(all.indexOf(root.querySelector(".command") as FakeElement));
    // The command is text here: a command shown outside a command block would break the one-way-to-show-a-command rule.
    expect(section.querySelectorAll("pre")).toHaveLength(0);
    expect(section.querySelectorAll("code")).toHaveLength(0);
  });

  it("says the commands start with npm run on the web page and with the plain name in the desktop app", () => {
    const web = render(guideView, emptyState()).root.textContent;
    expect(web).toContain("Commands on this page start with npm run snappy-export --.");
    expect(web).toContain("in this page");
    setPlatform({ desktop: "windows" });
    const desktop = render(guideView, emptyState()).root.textContent;
    expect(desktop).toContain("Commands on this page start with snappy-export.");
    expect(desktop).toContain("in this window");
    expect(desktop).not.toMatch(/npm|browser|\btab\b/i);
  });

  it("links to the section from the one command block of every tool page that has one, and from no block on the guide itself", async () => {
    let withBlocks = 0;
    for (const tool of TOOLS) {
      const { root } = await renderSettled(tool.view, sample);
      const blocks = root.querySelectorAll(".command");
      if (blocks.length === 0) continue;
      withBlocks++;
      expect(blocks, tool.id).toHaveLength(1);
      const links = (blocks[0] as FakeElement).querySelectorAll(".command-cli-link a");
      expect(links.map((a) => [a.getAttribute("href"), a.textContent]), tool.id).toEqual([["#/guide", cliTool.linkLabel]]);
    }
    expect(withBlocks).toBeGreaterThanOrEqual(20);
    expect(render(guideView, sample).root.querySelectorAll(".command-cli-link")).toHaveLength(0);
  });
});
