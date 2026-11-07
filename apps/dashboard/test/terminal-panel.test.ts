/**
 * The panel under a command, drawn from the controller's state, in the small fake DOM. A fake runner
 * is driven by hand, so every state can be reached.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { terminal } from "../src/copy.ts";
import { COMMANDS } from "../src/terminal/commands.ts";
import type { CommandId } from "../src/terminal/commands.ts";
import { createTerminalController } from "../src/terminal/controller.ts";
import { createPickedFiles } from "../src/terminal/picked-files.ts";
import type { RunHandle, RunHooks, RunResult, Runner } from "../src/terminal/run-types.ts";
import type { TerminalSession } from "../src/terminal/session.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

beforeAll(() => {
  installFakeDom();
});

interface Started {
  hooks: RunHooks;
  finish(result: RunResult): void;
  canceled: number;
}

function setup(files = [{ name: "a.zip", blob: new Blob(["x"]) }], workerAvailable = true) {
  const started: Started[] = [];
  const runner: Runner = {
    run(_input, hooks): RunHandle {
      let finish: (r: RunResult) => void = () => undefined;
      const done = new Promise<RunResult>((r) => (finish = r));
      const run: Started = { hooks, finish: (r) => finish(r), canceled: 0 };
      started.push(run);
      return { done, cancel: () => void run.canceled++ };
    },
  };
  const controller = createTerminalController({
    runner,
    getFiles: () => files,
    announce: () => undefined,
    columns: () => 80,
    beforeStoreRun: async () => undefined,
    afterStoreRun: async () => undefined,
    workerAvailable: () => workerAvailable,
  });
  const session: TerminalSession = { controller, picked: createPickedFiles(), outCap: 256 * 1024 * 1024, supported: true, columnsFrom: () => undefined, reset: () => controller.reset() };
  return { session, controller, started };
}

async function panelFor(id: CommandId, s = setup()) {
  const { terminalPanel } = await import("../src/components/terminalPanel.ts");
  const run = new FakeElement("button");
  const scope = new Scope(true);
  const panel = runInScope(scope, () => terminalPanel(s.session, { id, spec: COMMANDS[id], runButton: run as unknown as HTMLElement, key: id }));
  return { ...s, panel, el: panel.element as unknown as FakeElement, run, scope };
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
const buttons = (el: FakeElement): string[] => el.querySelectorAll("button").map((b) => b.textContent);
const focusReset = (): void => {
  FakeElement.lastFocused = null;
};

describe("an idle block", () => {
  it("is empty until Run is pressed, and stays empty when there is no file to run on", async () => {
    const { el, controller } = await panelFor("analyze-preview", setup([]));
    expect(el.childNodes).toHaveLength(0);
    controller.request("analyze-preview");
    expect(el.childNodes).toHaveLength(0);
    expect(controller.state("analyze-preview").kind).toBe("needs-file");
  });
});

describe("a Run that writes", () => {
  it("asks first, moves focus to the approve button, and backs out to the Run button", async () => {
    focusReset();
    const { el, controller, run, started } = await panelFor("memories-rescue");
    controller.request("memories-rescue");
    const group = el.querySelector("[role=group]") as FakeElement;
    expect(group.querySelector("h3")?.textContent).toBe(terminal.confirmFolderTitle);
    expect(FakeElement.lastFocused).toBe(group.querySelectorAll("button")[0]);
    run.focusCount = 0;
    (group.querySelectorAll("button")[1] as FakeElement).click();
    expect(controller.state("memories-rescue")).toEqual({ kind: "idle" });
    expect(el.childNodes).toHaveLength(0);
    expect(FakeElement.lastFocused).toBe(run);
    expect(started).toHaveLength(0);
  });

  it("starts on approve, and Escape cancels", async () => {
    const { el, controller, started } = await panelFor("analyze-save");
    controller.request("analyze-save");
    (el.querySelector("[role=group]") as FakeElement).fire("keydown", { key: "Escape" });
    expect(controller.state("analyze-save")).toEqual({ kind: "idle" });
    controller.request("analyze-save");
    ((el.querySelector("[role=group]") as FakeElement).querySelectorAll("button")[0] as FakeElement).click();
    await tick();
    expect(started).toHaveLength(1);
    expect(controller.state("analyze-save").kind).toBe("running");
  });
});

describe("a Run in progress", () => {
  it("shows the output and a Stop button, with focus on Stop, and stops on press", async () => {
    focusReset();
    const { el, controller, started } = await panelFor("inspect");
    controller.request("inspect");
    await tick();
    const log = el.querySelector(".t-log") as FakeElement;
    expect(log.getAttribute("role")).toBe("log");
    expect(log.getAttribute("aria-live")).toBe("off");
    expect(buttons(el)).toEqual([terminal.stopButton]);
    const stop = el.querySelector("button") as FakeElement;
    expect(stop.getAttribute("aria-label")).toBe(terminal.stopFor(COMMANDS.inspect.title));
    expect(FakeElement.lastFocused).toBe(stop);
    started[0]?.hooks.onOut("\x1b[32mgood\x1b[0m output\n");
    await tick(80);
    expect(el.querySelector(".t-run.ansi-ok")?.textContent).toBe("good");
    expect(log.textContent).toContain("good output");
    stop.click();
    expect(started[0]?.canceled).toBe(1);
  });

  it("asks the passphrase outside the output, focuses the masked field, and goes back to Stop after the answer", async () => {
    focusReset();
    const { el, controller, started } = await panelFor("ledger-status");
    controller.request("ledger-status");
    await tick();
    const answered = started[0]?.hooks.askSecret("Passphrase for your saved history: ") as Promise<string | null>;
    const form = el.querySelector("form") as FakeElement;
    const input = form.querySelector("input") as FakeElement;
    expect(input.getAttribute("type")).toBe("password");
    expect(form.querySelector("label")?.textContent).toBe("Passphrase for your saved history");
    expect(FakeElement.lastFocused).toBe(input);
    // The prompt is not inside the output area.
    expect((el.querySelector(".t-log") as FakeElement).contains(form)).toBe(false);
    input.value = "my long passphrase";
    form.fire("submit");
    expect(await answered).toBe("my long passphrase");
    expect(el.querySelector("form")).toBeNull();
    expect(buttons(el)).toEqual([terminal.stopButton]);
    expect(el.textContent).not.toContain("my long passphrase");
  });

  it("cancels the question with Escape, which answers null", async () => {
    const { el, controller, started } = await panelFor("ledger-status");
    controller.request("ledger-status");
    await tick();
    const answered = started[0]?.hooks.askSecret("Q: ") as Promise<string | null>;
    (el.querySelector("form") as FakeElement).fire("keydown", { key: "Escape" });
    expect(await answered).toBeNull();
  });
});

describe("a finished Run", () => {
  async function finished(result: RunResult, id: CommandId = "inspect") {
    const s = await panelFor(id);
    s.controller.request(id);
    if (COMMANDS[id].effect !== "none") s.controller.approve(id);
    await tick();
    s.started[0]?.hooks.onOut("line one\nline two\n");
    s.started[0]?.finish(result);
    await tick(80);
    return s;
  }

  it("says how it ended with an icon and words, shows the code and the time, and offers Copy output and Close", async () => {
    focusReset();
    const { el, run } = await finished({ end: "done", code: 0, ms: 1234 });
    const chip = el.querySelector(".command-chip") as FakeElement;
    expect(chip.className).toContain("command-chip-ok");
    expect(chip.querySelector(".command-chip-label")?.textContent).toBe("Done");
    expect(chip.textContent).toContain("Exit code 0");
    expect(chip.textContent).toContain("1.2 s");
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(buttons(el)).toEqual([terminal.copyOutputButton, terminal.closeButton]);
    expect(el.querySelector(".t-log")?.textContent).toContain("line two");
    expect(FakeElement.lastFocused).toBe(run);
  });

  it("uses a different tone and the same icon-and-words rule for each way of ending", async () => {
    const tones: [RunResult, string, string][] = [
      [{ end: "done", code: 2, ms: 1 }, "command-chip-danger", "Export has errors"],
      [{ end: "done", code: 130, ms: 1 }, "command-chip-neutral", "Stopped"],
      [{ end: "terminated", code: 130, ms: 3000 }, "command-chip-neutral", "Stopped"],
      [{ end: "failed", code: null, ms: 1 }, "command-chip-danger", "The helper stopped"],
    ];
    for (const [result, tone, words] of tones) {
      const { el } = await finished(result);
      const chip = el.querySelector(".command-chip") as FakeElement;
      expect(chip.className).toContain(tone);
      expect(chip.querySelector(".command-chip-label")?.textContent).toBe(words);
      expect(chip.querySelector("svg")).not.toBeNull();
    }
    const { el } = await finished({ end: "done", code: 3, ms: 1 }, "memories-rescue");
    expect((el.querySelector(".command-chip") as FakeElement).className).toContain("command-chip-warn");
    // No code is shown when there was none.
    const failed = await finished({ end: "failed", code: null, ms: 1 });
    expect((failed.el.querySelector(".command-chip") as FakeElement).textContent).not.toContain("Exit code");
  });

  it("leaves focus alone when the person has moved on to something else", async () => {
    focusReset();
    const s = await panelFor("inspect");
    s.controller.request("inspect");
    await tick();
    const elsewhere = new FakeElement("a");
    (globalThis as { document: { activeElement: unknown } }).document.activeElement = elsewhere;
    s.started[0]?.finish({ end: "done", code: 0, ms: 5 });
    await tick(80);
    expect(FakeElement.lastFocused).not.toBe(s.run);
    (globalThis as { document: { activeElement: unknown } }).document.activeElement = null;
  });

  it("closes: the output and the buttons go, and focus returns to Run", async () => {
    focusReset();
    const { el, controller, run } = await finished({ end: "done", code: 0, ms: 5 });
    run.focusCount = 0;
    (el.querySelectorAll("button")[1] as FakeElement).click();
    expect(controller.state("inspect")).toEqual({ kind: "idle" });
    expect(el.childNodes).toHaveLength(0);
    expect(run.focusCount).toBe(1);
    expect(controller.transcript("inspect").plainText()).toBe("");
  });

  it("copies the output as plain text, without styling codes", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", { clipboard: { writeText: async (t: string) => void written.push(t) } });
    const s = await panelFor("inspect");
    s.controller.request("inspect");
    await tick();
    s.started[0]?.hooks.onOut("\x1b[1mTitle\x1b[0m\n\x1b[31mred\x1b[0m\n");
    s.started[0]?.finish({ end: "done", code: 0, ms: 5 });
    await tick(80);
    (s.el.querySelectorAll("button")[0] as FakeElement).click();
    await tick();
    expect(written).toEqual(["Title\nred\n"]);
    vi.unstubAllGlobals();
  });
});

describe("other states", () => {
  it("says why a command cannot run here, with a notice", async () => {
    const { el, controller } = await panelFor("help", setup([], false));
    controller.request("help");
    expect(el.querySelector(".notice")?.textContent).toContain(terminal.noWorkerNote);
  });

  it("shows a Run that is still going when the block is built again, without taking focus", async () => {
    const first = await panelFor("inspect");
    first.controller.request("inspect");
    await tick();
    first.started[0]?.hooks.onOut("while away\n");
    first.scope.dispose();
    focusReset();
    const { terminalPanel } = await import("../src/components/terminalPanel.ts");
    const again = terminalPanel(first.session, { id: "inspect", spec: COMMANDS.inspect, runButton: new FakeElement("button") as unknown as HTMLElement, key: "inspect" });
    const el = again.element as unknown as FakeElement;
    expect(el.querySelector(".t-log")?.textContent).toContain("while away");
    expect(buttons(el)).toEqual([terminal.stopButton]);
    expect(FakeElement.lastFocused).toBeNull();
    first.started[0]?.finish({ end: "done", code: 0, ms: 5 });
    await tick(80);
    expect(el.querySelector(".command-chip")).not.toBeNull();
  });

  it("builds only divs, spans and the interface's own controls, with no style attribute and no markup from the output", async () => {
    const s = await panelFor("inspect");
    s.controller.request("inspect");
    await tick();
    s.started[0]?.hooks.onOut("<img src=x onerror=alert(1)> <b>bold</b>\n");
    s.started[0]?.finish({ end: "done", code: 0, ms: 5 });
    await tick(80);
    for (const node of s.el.descendants()) {
      expect(node.attrs.has("style"), node.tagName).toBe(false);
      expect([...node.attrs.keys()].some((k) => k.startsWith("on")), node.tagName).toBe(false);
      expect(["img", "b", "script", "iframe"]).not.toContain(node.tagName);
    }
    expect(s.el.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
