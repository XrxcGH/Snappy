/**
 * Saving what a command left in the virtual folder: one file at a time, or all of it as one stored
 * .zip. The download link is the page's own helper, replaced here so the saved file can be looked at.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bytesReader, listZipEntries } from "@snappy-export/core";
import { terminal } from "../src/copy.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { COMMANDS } from "../src/terminal/commands.ts";
import { createTerminalController } from "../src/terminal/controller.ts";
import { createPickedFiles } from "../src/terminal/picked-files.ts";
import { fileNameOf, saveAll, saveFile, summarize } from "../src/terminal/out-folder.ts";
import type { OutFile, RunHandle, RunHooks, RunResult, Runner } from "../src/terminal/run-types.ts";
import type { TerminalSession } from "../src/terminal/session.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

const saved: { name: string; blob: Blob }[] = [];

vi.mock("../src/download.ts", () => ({
  saveBlob: (name: string, blob: Blob) => {
    saved.push({ name, blob });
    return true;
  },
  saveTextFile: () => true,
}));

beforeAll(() => {
  installFakeDom();
});
afterEach(() => saved.splice(0));

const NOW = Date.UTC(2026, 10, 7, 9, 0, 0);
const file = (path: string, n = 4, mtimeMs = NOW): OutFile => ({ path, bytes: Uint8Array.from({ length: n }, (_, i) => i), mtimeMs });

describe("the helpers", () => {
  it("sums files and bytes, and names a saved file by the last part of its path", () => {
    expect(summarize([file("a/b.jpg", 10), file("c.json", 5)])).toEqual({ files: 2, bytes: 15 });
    expect(summarize([])).toEqual({ files: 0, bytes: 0 });
    expect(fileNameOf("memories/2021/2021-03/a.jpg")).toBe("a.jpg");
    expect(fileNameOf("plain.txt")).toBe("plain.txt");
  });

  it("saves one file under its own name, with its own bytes", async () => {
    expect(saveFile(file("memories/2021/a.jpg", 6))).toBe("saved");
    expect(saved[0]?.name).toBe("a.jpg");
    expect([...new Uint8Array(await (saved[0]?.blob as Blob).arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("saves everything as one zip, with the paths and the capture times inside", async () => {
    const when = Date.UTC(2021, 2, 4, 5, 6, 8);
    expect(saveAll([file("memories/a.jpg", 3, when), file("memories/memories-report.json", 2, 0)], "rescued-memories", NOW)).toBe("saved");
    expect(saved[0]?.name).toBe("rescued-memories.zip");
    const data = new Uint8Array(await (saved[0]?.blob as Blob).arrayBuffer());
    const { entries } = await listZipEntries(bytesReader(data));
    expect(entries.map((e) => e.name)).toEqual(["memories/a.jpg", "memories/memories-report.json"]);
    expect(entries.map((e) => e.mtimeUtcMs)).toEqual([when, NOW]);
  });

  it("says when there are too many files for one zip, and saves nothing", () => {
    const many = Array.from({ length: 65_536 }, (_, i) => file(`f${i}`, 0));
    expect(saveAll(many, "x", NOW)).toBe("too-big");
    expect(saved).toEqual([]);
  });
});

describe("the files list in the panel", () => {
  function setup(files: OutFile[], result: RunResult = { end: "done", code: 0, ms: 10 }) {
    const runner: Runner = {
      run(_i, hooks: RunHooks): RunHandle {
        hooks.onFiles(files);
        return { done: Promise.resolve(result), cancel: () => undefined };
      },
    };
    const controller = createTerminalController({
      runner,
      getFiles: () => [{ name: "a.zip", blob: new Blob(["x"]) }],
      announce: () => undefined,
      columns: () => 80,
      beforeStoreRun: async () => undefined,
      afterStoreRun: async () => undefined,
      workerAvailable: () => true,
    });
    const session: TerminalSession = { controller, picked: createPickedFiles(), outCap: 1 << 20, supported: true, columnsFrom: () => undefined };
    return { controller, session };
  }

  async function drawn(files: OutFile[], result?: RunResult) {
    const s = setup(files, result);
    const { terminalPanel } = await import("../src/components/terminalPanel.ts");
    const run = new FakeElement("button");
    const panel = runInScope(new Scope(true), () => terminalPanel(s.session, { id: "memories-rescue", spec: COMMANDS["memories-rescue"], runButton: run as unknown as HTMLElement, key: "m" }));
    s.controller.request("memories-rescue");
    s.controller.approve("memories-rescue");
    await new Promise((r) => setTimeout(r, 90));
    return { ...s, el: panel.element as unknown as FakeElement };
  }

  it("lists the saved files with a Save button each, a count, Save all and Clear", async () => {
    const { el } = await drawn([file("memories/a.jpg", 1500), file("memories/b.mp4", 2_500_000)]);
    const section = el.querySelector(".out-files") as FakeElement;
    expect(section.querySelector("h3")?.textContent).toBe(terminal.outHeading);
    expect(section.querySelector(".caption")?.textContent).toBe("2 files, 2.39 MB");
    expect(section.querySelectorAll(".out-file-name").map((n) => n.textContent)).toEqual(["memories/a.jpg", "memories/b.mp4"]);
    const labels = section.querySelectorAll("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(labels).toEqual(["Save a.jpg", "Save b.mp4", terminal.saveAllButton, terminal.clearOutButton]);
  });

  it("lists the first fifty and counts the rest", async () => {
    const many = Array.from({ length: 60 }, (_, i) => file(`memories/f${i}.jpg`, 1));
    const { el } = await drawn(many);
    expect(el.querySelectorAll(".out-file")).toHaveLength(50);
    expect(el.querySelector(".out-list")?.textContent).toContain("Plus 10 more");
  });

  it("saves a file and saves everything when the buttons are pressed, and says when it cannot", async () => {
    const { el } = await drawn([file("memories/a.jpg", 3, NOW), file("memories/b.jpg", 3, NOW)]);
    const buttons = el.querySelector(".out-files")?.querySelectorAll("button") as FakeElement[];
    buttons[0]?.click();
    expect(saved.map((s) => s.name)).toEqual(["a.jpg"]);
    buttons[2]?.click();
    expect(saved.map((s) => s.name)).toEqual(["a.jpg", "rescued-memories.zip"]);
  });

  it("forgets the files on Clear, and the list goes", async () => {
    const { el, controller } = await drawn([file("memories/a.jpg")]);
    const buttons = el.querySelector(".out-files")?.querySelectorAll("button") as FakeElement[];
    buttons[buttons.length - 1]?.click();
    expect(controller.files("memories-rescue")).toEqual([]);
    expect(el.querySelector(".out-files")).toBeNull();
    expect(controller.state("memories-rescue").kind).toBe("finished");
  });

  it("says what stopping did to the files: kept when it stopped in time, lost when it was cut off", async () => {
    const stopped = await drawn([file("memories/a.jpg")], { end: "canceled", code: 130, ms: 5 });
    expect(stopped.el.querySelector(".out-files")?.textContent).toContain(terminal.outLostNote);
    const cutOff = await drawn([], { end: "terminated", code: 130, ms: 3000 });
    expect(cutOff.el.querySelector(".out-files")).toBeNull();
    expect(cutOff.el.textContent).toContain(terminal.outLostNote);
  });

  it("shows nothing for a Run that saved no files", async () => {
    const { el } = await drawn([]);
    expect(el.querySelector(".out-files")).toBeNull();
    expect(el.textContent).not.toContain(terminal.outHeading);
  });
});
