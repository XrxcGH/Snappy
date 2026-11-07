/**
 * Rescue manifest: what it computes from the Memories the page holds, and what its page shows and downloads.
 * Synthetic data only. Export links, zip paths and usernames carry canaries that must never reach a result, the page or the file.
 */
import { insights, planMemories } from "@snappy-export/core";
import type { MemoryItem, ParsedExport } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { initialState } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { toolData } from "../../src/tools/data.ts";
import { copy } from "../../src/tools/rescue-manifest/copy.ts";
import { descriptor } from "../../src/tools/rescue-manifest/index.ts";
import { computeRescueManifest } from "../../src/tools/rescue-manifest/model.ts";
import { view } from "../../src/tools/rescue-manifest/view.ts";
import { collectCopy, RULES, lint } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { render, renderSettled, sampleState, sampleWorkspace, stateWith } from "./harness.ts";

const said: string[] = [];
const saved: { fileName: string; text: string; mime: string }[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));
vi.mock("../../src/download.ts", () => ({
  saveTextFile: (fileName: string, text: string, mime: string) => {
    saved.push({ fileName, text, mime });
    return true;
  },
  saveBlob: () => true,
}));

const DAY = 24 * 60 * 60 * 1000;
let base: Workspace;
let sample: State;
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});

const memory = (i: number, change: Partial<MemoryItem> = {}): MemoryItem => ({
  id: `m${i}`,
  date: base.now - (i + 1) * DAY,
  mediaType: "image",
  downloadUrl: `https://example.test/ZQCANARY-link-${i}`,
  zipPath: `memories/ZQCANARY-file-${i}.jpg`,
  ...change,
});

/** A real (not sample) export made from the sample's, holding exactly these Memories. */
function real(memories: MemoryItem[], change: Partial<ParsedExport> = {}): State {
  const latest = { ...(base.latest as ParsedExport), memories, bundledMedia: undefined, memoriesPairing: undefined, ...change };
  return stateWith({ latest, now: base.now, issues: [], parts: 1 });
}
const dataOf = (state: State) => toolData(state);
const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const press = (root: FakeElement): void => (root.querySelectorAll("button").find((b) => b.textContent === copy.downloadButton) as FakeElement).click();

const mixed = (): MemoryItem[] => [
  memory(1),
  memory(2, { mediaType: "video", overlayPaths: ["memories/ZQCANARY-overlay-2.png"] }),
  memory(3, { mediaType: "unknown", date: null }),
  memory(4, { date: base.now + 30 * DAY }),
  memory(5, { downloadUrl: "https://example.test/ZQCANARY-link-1", zipPath: undefined }),
];

describe("the tool", () => {
  it("is a Memories tool in orange that needs a Memories list and shows the rescue command", () => {
    expect(descriptor).toMatchObject({ id: "rescue-manifest", title: "Rescue manifest", group: "memories", category: "memories", needs: ["memories"] });
    expect(descriptor.oneLiner.length).toBeLessThanOrEqual(56);
    expect(COMMANDS["rescue-manifest"].argv[0]).toBe("rescue");
  });

  it("passes the copy lint on its own words", () => {
    const entries = collectCopy({ tool_rescue_manifest: copy });
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });
});

describe("computeRescueManifest", () => {
  it("lists the sample's Memories as the command does: the plan's entries, in order, with no sizes", () => {
    const parsed = base.latest as ParsedExport;
    const result = computeRescueManifest(dataOf(sample));
    const plan = planMemories(parsed.memories, { layout: "year-month" });
    expect(result.planned).toBe(plan.entries.length);
    expect(result.repeats).toBe(plan.duplicates.length);
    expect(result.manifest.counts.items).toBe(plan.entries.length);
    expect(result.manifest.version).toBe(1);
    expect(result.manifest.createdAt).toBe(base.now);
    expect(result.manifest.counts.withSize).toBe(0);
    expect(result.manifest.items.map((i) => i.path).sort()).toEqual(plan.entries.map((e) => e.relativePath).sort());
    expect(result.notes.map((n) => n.code)).toContain("size-missing");
  });

  it("counts photos, videos, other types, overlay files and Memories without a date", () => {
    const { manifest } = computeRescueManifest(dataOf(real(mixed())));
    // Memory 5 shares memory 1's link, so the plan treats it as a repeat.
    expect(manifest.counts).toMatchObject({ items: 4, images: 2, videos: 1, unknown: 1, overlayFiles: 1, undated: 2, withSize: 0 });
  });

  it("reports repeats, and clears a date in the future with a note", () => {
    const result = computeRescueManifest(dataOf(real(mixed())));
    expect(result.repeats).toBe(1);
    expect(result.planned).toBe(4);
    const future = result.notes.find((n) => n.code === "time-in-future");
    expect(future?.params.count).toBe(1);
    expect(result.manifest.items.find((i) => i.capturedAt === null && i.mediaType === "image")).toBeDefined();
  });

  it("finds nothing to list when the Memories list is empty, and refuses to run without an export", () => {
    const empty = computeRescueManifest(dataOf(real([])));
    expect(empty.manifest.counts.items).toBe(0);
    expect(empty.planned).toBe(0);
    expect(empty.notes).toEqual([]);
    expect(() => computeRescueManifest(dataOf(initialState()))).toThrow();
  });

  it("holds no export link, zip path or username", () => {
    const parsed = base.latest as ParsedExport;
    const names = [...new Set(parsed.friends.friends.map((f) => f.username))].filter((n) => n.length >= 5);
    const json = JSON.stringify(computeRescueManifest(dataOf(real(mixed()))));
    expect(json).not.toContain("ZQCANARY");
    expect(json).not.toMatch(/https?:|\.zip|memories\//i);
    const sampleJson = JSON.stringify(computeRescueManifest(dataOf(sample)));
    for (const name of names) expect(sampleJson, name).not.toContain(name);
  });
});

describe("the page", () => {
  it("shows what the manifest lists as six counts, how to check it later, the notes and the command", async () => {
    const { root } = await renderSettled(view, real(mixed()));
    expect(root.querySelectorAll(".section-title").map((t) => t.textContent)).toEqual([copy.holdsHeading, copy.checkHeading, tools.notesHeading, tools.downloadHeading, tools.commandHeading]);
    const counts = Object.fromEntries(root.querySelectorAll(".stat").map((s) => [s.querySelector(".stat-label")?.textContent, s.querySelector(".stat-value")?.textContent]));
    expect(counts).toEqual({ [copy.memoriesHeader]: "4", [copy.photosHeader]: "2", [copy.videosHeader]: "1", [copy.otherHeader]: "1", [copy.overlaysHeader]: "1", [copy.undatedHeader]: "2" });
    expect(text(root, ".step-list li").map((s) => s.replace(/^\d/, ""))).toEqual([copy.saveStep, copy.rescueStep, copy.verifyStep]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["rescue-manifest"]));
    expect(root.querySelectorAll("table")).toHaveLength(0);
  });

  it("writes short hedged notes: repeats, a date in the future, sizes and where to check", async () => {
    const { root } = await renderSettled(view, real(mixed()));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual([copy.repeatsNote(1), copy.futureNote(1), copy.sizesNote, copy.checkNote]);
    expect(notes[0]).toContain("may repeat");
    for (const n of notes) expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
  });

  it("shows the sample with a count that matches the plan and says sizes are not recorded", async () => {
    const parsed = base.latest as ParsedExport;
    const expected = planMemories(parsed.memories, { layout: "year-month" }).entries.length;
    const { root } = await renderSettled(view, sample);
    const memories = root.querySelectorAll(".stat").find((s) => s.querySelector(".stat-label")?.textContent === copy.memoriesHeader);
    expect((memories?.querySelector(".stat-value")?.textContent ?? "").replace(/,/g, "")).toBe(String(expected));
    expect(text(root, ".tool-notes li")).toContain(copy.sizesNote);
  });

  it("announces the count politely once, and without a name", async () => {
    await renderSettled(view, real(mixed()));
    expect(said).toEqual(["Rescue manifest ready. 4 Memories listed."]);
    said.length = 0;
    await renderSettled(view, real([memory(1)]));
    expect(said).toEqual(["Rescue manifest ready. 1 Memory listed."]);
  });

  it("has an empty state written for a manifest with nothing in it", () => {
    expect(copy.empty.title).toBe("Nothing to list");
    expect(copy.empty.body).toMatch(/Memories list/);
  });
});

describe("the download", () => {
  it("is built only when the button is pressed, and is the exact core text", async () => {
    const memories = mixed();
    const { root } = await renderSettled(view, real(memories));
    expect(saved).toEqual([]);
    expect(root.textContent).toContain(copy.downloadNote);
    said.length = 0;
    press(root);
    expect(saved).toHaveLength(1);

    const plan = planMemories(memories, { layout: "year-month" });
    const core = insights.rescueManifest.serializeRescueManifest(insights.rescueManifest.buildRescueManifest(insights.rescueManifest.recordsFromPlan(plan.entries), { now: base.now }).manifest);
    expect(saved[0]).toEqual({ fileName: copy.unitFileName, text: core, mime: "application/json" });
    expect(said).toEqual([tools.downloadSaved]);
  });

  it("reads back as a manifest and holds no link, zip path or username", async () => {
    const { root } = await renderSettled(view, sample);
    press(root);
    const file = saved[0]?.text ?? "";
    const parsed = insights.rescueManifest.parseRescueManifest(file);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.manifest.counts.items).toBe(computeRescueManifest(dataOf(sample)).manifest.counts.items);
    expect(file).not.toMatch(/https?:|\.zip|memories\//i);
    const names = [...new Set(((base.latest as ParsedExport).friends.friends).map((f) => f.username))].filter((n) => n.length >= 5);
    for (const name of names) expect(file, name).not.toContain(name);

    const withCanary = await renderSettled(view, real(mixed()));
    press(withCanary.root);
    expect(saved[1]?.text).not.toContain("ZQCANARY");
  });
});

describe("what is missing", () => {
  it("says there is no export, offers Add export and still offers the command", () => {
    const { root } = render(view, initialState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS["rescue-manifest"]));
    expect(root.querySelector(".tool-result")).toBeNull();
  });

  it("says the export has no Memories list, and that saved history alone holds none", () => {
    expect(text(render(view, real([])).root, ".empty-title")).toEqual([tools.needs.memoriesTitle]);
    expect(text(render(view, stateWith({ ledger: base.ledger })).root, ".empty-body")).toEqual([tools.needs.memoriesBody]);
  });
});

describe("privacy", () => {
  it("shows no username, link, zip path or file name anywhere on the page, and none in the announcement", async () => {
    const names = [...new Set(((base.latest as ParsedExport).friends.friends).map((f) => f.username))].filter((n) => n.length >= 5);
    for (const state of [sample, real(mixed())]) {
      said.length = 0;
      const { root } = await renderSettled(view, state);
      const page = root.textContent;
      expect(page).not.toContain("ZQCANARY");
      expect(page).not.toMatch(/https?:|\.zip|\.jpg|\.mp4|memories\//i);
      for (const name of names) {
        expect(page, name).not.toContain(name);
        expect(said.join(" "), name).not.toContain(name);
      }
      expect(root.querySelectorAll("code.username")).toHaveLength(0);
      expect(root.querySelectorAll("a").filter((a) => (a.getAttribute("href") ?? "").startsWith("http"))).toHaveLength(0);
    }
  });
});
