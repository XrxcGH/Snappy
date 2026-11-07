import { beforeAll, describe, expect, it } from "vitest";
import { createPickedFiles } from "../src/terminal/picked-files.ts";
import { createTerminalSession } from "../src/terminal/session.ts";
import { terminal } from "../src/copy.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

const zip = (name: string, body = "x", lastModified = 1): File => new File([body], name, { lastModified });

describe("picked files", () => {
  it("keeps the .zip files in the order chosen, as lazy blobs, and leaves everything else out", () => {
    const picked = createPickedFiles();
    expect(picked.add([zip("mydata~1.zip"), zip("notes.txt"), zip("MYDATA~1-2.ZIP"), zip("photo.jpg")])).toEqual({ added: 2, skipped: 2 });
    expect(picked.files().map((f) => f.name)).toEqual(["mydata~1.zip", "MYDATA~1-2.ZIP"]);
    expect(picked.count()).toBe(2);
    expect(picked.files()[0]?.blob).toBeInstanceOf(Blob);
  });

  it("treats the same file chosen twice as one file, but not two different files with one name", () => {
    const picked = createPickedFiles();
    picked.add([zip("a.zip", "x", 1)]);
    expect(picked.add([zip("a.zip", "x", 1)])).toEqual({ added: 0, skipped: 1 });
    expect(picked.add([zip("a.zip", "different", 2)])).toEqual({ added: 1, skipped: 0 });
    expect(picked.count()).toBe(2);
  });

  it("clears, and tells subscribers about each real change only", () => {
    const picked = createPickedFiles();
    let calls = 0;
    const off = picked.subscribe(() => calls++);
    picked.add([zip("a.zip")]);
    picked.add([zip("b.txt")]);
    picked.clear();
    picked.clear();
    expect(calls).toBe(2);
    off();
    picked.add([zip("c.zip")]);
    expect(calls).toBe(2);
    expect(picked.files().map((f) => f.name)).toEqual(["c.zip"]);
  });

  it("stores nothing: the list is gone with the object", () => {
    const first = createPickedFiles();
    first.add([zip("a.zip")]);
    expect(createPickedFiles().count()).toBe(0);
  });
});

describe("the file chip", () => {
  beforeAll(() => {
    installFakeDom();
  });

  const makeSession = () => createTerminalSession({ spawn: () => null, vault: { supported: () => false, read: async () => null, write: async () => undefined, clear: async () => undefined }, vaultPhase: () => "locked", announce: () => undefined });

  async function chip(session = makeSession()) {
    const { fileChip } = await import("../src/components/fileChip.ts");
    const scope = new Scope(true);
    const el = runInScope(scope, () => fileChip(session, { key: "inspect" })) as unknown as FakeElement;
    return { el, session, scope };
  }

  it("starts as a Choose export chip, with no Clear and no problem", async () => {
    const { el } = await chip();
    const buttons = el.querySelectorAll("button");
    expect(buttons.map((b) => b.textContent)).toEqual([terminal.chooseButton, terminal.clearFilesButton]);
    expect(buttons[1]?.hidden).toBe(true);
    expect(el.querySelector("p")?.textContent).toBe("");
  });

  it("opens the file picker only when the chip is pressed", async () => {
    const { el } = await chip();
    const input = el.querySelector("input") as FakeElement;
    let opened = 0;
    input.addEventListener("click", () => opened++);
    expect(opened).toBe(0);
    (el.querySelectorAll("button")[0] as FakeElement).click();
    expect(opened).toBe(1);
    expect(input.getAttribute("type")).toBe("file");
    expect(input.getAttribute("accept")).toContain(".zip");
    expect(input.getAttribute("multiple")).toBe("");
  });

  it("says how many files are chosen, shows Clear, and clears", async () => {
    const { el, session } = await chip();
    const input = el.querySelector("input") as FakeElement;
    input.files = [zip("mydata~1.zip"), zip("mydata~1-2.zip")];
    input.fire("change");
    const [choose, clear] = el.querySelectorAll("button") as FakeElement[];
    expect(choose?.textContent).toBe("2 files chosen");
    expect(clear?.hidden).toBe(false);
    expect(session.picked.count()).toBe(2);
    expect(input.value).toBe("");
    clear?.click();
    expect(choose?.textContent).toBe(terminal.chooseButton);
    expect(clear?.hidden).toBe(true);
    expect(FakeElement.lastFocused).toBe(choose);
  });

  it("tells the person when nothing they chose was a .zip, and stops telling them once something was", async () => {
    const { el } = await chip();
    const input = el.querySelector("input") as FakeElement;
    input.files = [zip("notes.txt")];
    input.fire("change");
    expect(el.querySelector("p")?.textContent).toBe(terminal.notZipNote);
    input.files = [zip("a.zip")];
    input.fire("change");
    expect(el.querySelector("p")?.textContent).toBe("");
  });

  it("follows the shared list when another block changes it, and lets go when the view goes", async () => {
    const { el, session, scope } = await chip();
    session.picked.add([zip("a.zip")]);
    expect((el.querySelectorAll("button")[0] as FakeElement).textContent).toBe("1 file chosen");
    scope.dispose();
    session.picked.add([zip("b.zip")]);
    expect((el.querySelectorAll("button")[0] as FakeElement).textContent).toBe("1 file chosen");
  });
});
