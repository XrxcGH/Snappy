/**
 * The Tools hub: tiles in groups, each with an icon, a name, one line, a status and Open, where the status says
 * what the export on this page lacks. The registry is replaced by fourteen made-up tools in the planned groups,
 * so the layout is checked at the size the hub will have; the real registry is checked in contract.test.ts.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { tools } from "../../src/copy.ts";
import type { State } from "../../src/reducer.ts";
import { toolsView } from "../../src/views/tools.ts";
import type { FakeElement } from "../fake-dom.ts";
import { emptyState, render, sampleState, sampleWorkspace, stateWith } from "./harness.ts";

vi.mock("../../src/tools/registry.ts", () => {
  const stub = (id: string, group: string, category: string, needs: string[]): unknown => ({ id, title: `Tool ${id}`, oneLiner: "Does one thing.", group, category, icon: "check", needs, view: () => null });
  const list = [
    stub("export-check", "your-export", "cleanup", ["export"]),
    stub("export-reminder", "your-export", "cleanup", []),
    stub("friends-backup", "friends", "requests", ["friends"]),
    stub("closest-fading", "friends", "requests", ["chats"]),
    stub("anniversaries", "friends", "requests", ["friends"]),
    stub("blocked-review", "friends", "requests", ["friends"]),
    stub("friend-count-history", "friends", "requests", ["friends"]),
    stub("waiting-on-reply", "chats", "quiet", ["chats"]),
    stub("habits", "chats", "quiet", ["chats"]),
    stub("storage-planner", "memories", "memories", ["memories"]),
    stub("memories-on-this-day", "memories", "memories", ["memories"]),
    stub("rescue-manifest", "memories", "memories", ["memories"]),
    stub("safety-checklist", "checklists", "neutral", []),
    stub("privacy-tuneup", "checklists", "neutral", []),
  ] as { group: string }[];
  const order = ["your-export", "friends", "chats", "memories", "checklists"];
  return {
    TOOLS: list,
    GROUPS: [],
    toolById: () => undefined,
    groupedTools: () => order.map((id) => ({ group: { id }, tools: list.filter((t) => t.group === id) })),
  };
});

let sample: State;
beforeAll(async () => {
  sample = await sampleState();
}, 120_000);

const groups = (root: FakeElement): { name: string; grid: FakeElement; tiles: FakeElement[] }[] =>
  root.querySelectorAll("section.section").map((s) => ({ name: s.querySelector("h2")?.textContent ?? "", grid: s.querySelector(".tiles") as FakeElement, tiles: s.querySelectorAll("a.tile") }));

describe("the hub", () => {
  it("has one h1 and a short lead, then the five groups in order, each with its tiles", () => {
    const { root } = render(toolsView, sample);
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelector("h1")?.textContent).toBe("Tools");
    expect(root.querySelector(".lead")?.textContent).toBe(tools.lead);
    expect(groups(root).map((g) => [g.name, g.tiles.length])).toEqual([["Your export", 2], ["Friends", 5], ["Chats", 2], ["Memories", 3], ["Checklists", 2]]);
    expect(root.querySelectorAll("a.tile")).toHaveLength(14);
  });

  it("builds each tile in the same five rows: icon tile, name, one line, status, Open; the whole tile is the link", () => {
    const { root } = render(toolsView, sample);
    for (const tile of root.querySelectorAll("a.tile")) {
      expect(tile.getAttribute("href")).toMatch(/^#\/tools\/[a-z][a-z-]+$/);
      expect(tile.childNodes.filter((n) => "tagName" in n).map((n) => `${(n as FakeElement).tagName}.${(n as FakeElement).className.split(" ")[0]}`)).toEqual(["span.chip-icon", "h3.card-title", "p.tool-line", "p.tool-status", "span.tile-action"]);
      expect(tile.querySelector(".tile-action")?.textContent).toBe(tools.open);
      expect(tile.querySelector(".tool-status svg")).not.toBeNull();
      expect(tile.querySelectorAll("button")).toHaveLength(0);
    }
  });

  it("sets the grid class from the count, so a group of two, three or five has no hole in its last row", () => {
    const { root } = render(toolsView, sample);
    expect(groups(root).map((g) => g.grid.className)).toEqual(["tiles tiles-tools tiles-n-2", "tiles tiles-tools tiles-n-5", "tiles tiles-tools tiles-n-2", "tiles tiles-tools tiles-n-3", "tiles tiles-tools tiles-n-2"]);
  });

  it("uses a category color only through the scope class, and orange only for the Memories group", () => {
    const { root } = render(toolsView, sample);
    for (const g of groups(root)) {
      for (const tile of g.tiles) {
        const scopes = tile.classList.contains("cat-memories");
        expect(scopes, `${g.name}: ${tile.getAttribute("href")}`).toBe(g.name === "Memories");
      }
    }
    expect(root.querySelectorAll(".cat-memories")).toHaveLength(3);
  });

  it("shows no username and no inline style", () => {
    const { root } = render(toolsView, sample);
    for (const el of root.descendants()) expect(el.hasAttribute("style")).toBe(false);
    expect(root.querySelectorAll("code")).toHaveLength(0);
  });
});

describe("the statuses", () => {
  const statuses = (root: FakeElement): string[] => root.querySelectorAll(".tool-status").map((s) => s.textContent);

  it("say Ready for every tool when the sample is showing", () => {
    expect(new Set(statuses(render(toolsView, sample).root))).toEqual(new Set([tools.statusReady]));
  });

  it("say what is missing when nothing is loaded, and a tool that needs nothing stays ready", () => {
    const { root } = render(toolsView, emptyState());
    const byHref = Object.fromEntries(root.querySelectorAll("a.tile").map((a) => [a.getAttribute("href"), a.querySelector(".tool-status")?.textContent]));
    expect(byHref["#/tools/export-check"]).toBe(tools.statusNeeds.export);
    expect(byHref["#/tools/waiting-on-reply"]).toBe(tools.statusNeeds.export);
    expect(byHref["#/tools/safety-checklist"]).toBe(tools.statusReady);
    expect(byHref["#/tools/export-reminder"]).toBe(tools.statusReady);
  });

  it("add one note with a way to add an export when nothing is loaded, and none otherwise", () => {
    const empty = render(toolsView, emptyState()).root;
    expect(empty.querySelectorAll(".notice")).toHaveLength(1);
    expect(empty.querySelector(".notice")?.textContent).toContain(tools.noExportNote);
    expect(empty.querySelector(".notice a")?.getAttribute("href")).toBe("#/start");
    expect(render(toolsView, sample).root.querySelectorAll(".notice")).toHaveLength(0);
  });

  it("tell saved history apart from an export: friends tools are ready from it, chat tools are not", async () => {
    const { root } = render(toolsView, stateWith({ ledger: (await sampleWorkspace()).ledger }));
    const byHref = Object.fromEntries(root.querySelectorAll("a.tile").map((a) => [a.getAttribute("href"), a.querySelector(".tool-status")?.textContent]));
    expect(byHref["#/tools/friends-backup"]).toBe(tools.statusReady);
    expect(byHref["#/tools/export-check"]).toBe(tools.statusNeeds.export);
    expect(byHref["#/tools/habits"]).toBe(tools.statusNeeds.chats);
    expect(byHref["#/tools/storage-planner"]).toBe(tools.statusNeeds.memories);
  });

  it("repaint when an export arrives", async () => {
    const r = render(toolsView, emptyState());
    expect(r.root.querySelectorAll(".notice")).toHaveLength(1);
    r.store.dispatch({ type: "sample-loaded", workspace: await sampleWorkspace() });
    expect(r.root.querySelectorAll(".notice")).toHaveLength(0);
    expect(new Set(r.root.querySelectorAll(".tool-status").map((s) => s.textContent))).toEqual(new Set([tools.statusReady]));
  });
});
