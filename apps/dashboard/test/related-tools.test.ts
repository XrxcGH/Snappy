/**
 * Related tools: a row of links at the end of each finding page, the Overview's export health, and the Memories page;
 * a Tools card on the Overview; and the "find friends without saving" command block on the Cleanup page.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { lists } from "../src/copy-lists.ts";
import { relatedTools } from "../src/components/relatedTools.ts";
import type { State } from "../src/reducer.ts";
import { COMMANDS, displayText } from "../src/terminal/commands.ts";
import { TOOLS, toolById } from "../src/tools/registry.ts";
import type { View } from "../src/views/context.ts";
import { initialState } from "../src/reducer.ts";
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
  views.memories = ((await import("../src/views/memories.ts")) as Record<string, View>).memoriesView!;
  views.overview = ((await import("../src/views/overview.ts")) as { overviewView: View }).overviewView;
  sample = await sampleStateOf();
}, 120_000);

const toolLinks = (root: FakeElement): string[] => all(root, ".related a").map((a) => a.getAttribute("href") ?? "");

describe("the related tools row", () => {
  it.each([
    ["disappeared", ["since-last-export"]],
    ["requests", ["lookalike-usernames"]],
    ["quiet", ["closest-fading"]],
    ["cleanup", ["friends-backup"]],
    ["memories", ["storage-planner", "memories-gaps", "memories-on-this-day", "rescue-manifest"]],
    ["overview", ["export-check"]],
  ])("%s leads to its tools, named as the registry names them", (name, ids) => {
    const { root } = mount(views[name]!, sample);
    expect(toolLinks(root)).toEqual(ids.map((id) => `#/tools/${id}`));
    for (const id of ids) {
      const link = all(root, ".related a").find((a) => a.getAttribute("href") === `#/tools/${id}`)!;
      expect(textOf(link)).toBe(toolById(id)?.title);
    }
  });

  it("names the row for screen readers and keeps the links in a list", () => {
    const { root } = mount(views.memories!, sample);
    const list = all(root, "ul.related-list")[0]!;
    expect(list.getAttribute("role")).toBe("list");
    const label = all(root, ".related .label")[0]!;
    expect(list.getAttribute("aria-labelledby")).toBe(label.getAttribute("id"));
    expect(textOf(label)).toBe(lists.relatedLabel);
  });

  it("says why Friends backup is next to the queue", () => {
    const { root } = mount(views.cleanup!, sample);
    expect(textOf(all(root, ".related")[0]!)).toContain(lists.relatedBackupNote);
  });

  it("shows nothing for an id that is not a tool, and skips it among tools", () => {
    installFakeDom();
    expect(relatedTools(["not-a-tool"])).toBeNull();
    expect(relatedTools([])).toBeNull();
    const row = relatedTools(["not-a-tool", "export-check"]) as unknown as FakeElement;
    expect(all(row, "a").map((a) => a.getAttribute("href"))).toEqual(["#/tools/export-check"]);
  });

  it("is not drawn before there is an export", () => {
    for (const name of ["disappeared", "requests", "quiet", "cleanup", "memories", "overview"]) {
      const { root } = mount(views[name]!, initialState());
      expect(all(root, ".related"), name).toHaveLength(0);
    }
  });
});

describe("the Overview's Tools card", () => {
  it("links to the hub and says how many helpers there are", () => {
    const { root } = mount(views.overview!, sample);
    const card = all(root, "a.tools-card")[0]!;
    expect(card.getAttribute("href")).toBe("#/tools");
    expect(textOf(card)).toContain(lists.toolsCardText(TOOLS.length));
  });

  it("is not drawn before there is an export", () => {
    const { root } = mount(views.overview!, initialState());
    expect(all(root, "a.tools-card")).toHaveLength(0);
  });
});

describe("the Cleanup page's command", () => {
  it("shows the search that saves nothing, as a command block", () => {
    const { root } = mount(views.cleanup!, sample);
    const codes = all(root, ".command").map((b) => b.querySelector("code")?.textContent);
    expect(codes).toEqual([displayText(COMMANDS["analyze-preview"])]);
    expect(textOf(root)).toContain(lists.previewNote);
  });

  it("has no command block before there is an export", () => {
    const { root } = mount(views.cleanup!, initialState());
    expect(all(root, ".command")).toHaveLength(0);
  });
});
