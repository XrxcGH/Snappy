import { beforeAll, describe, expect, it } from "vitest";
import { settings, terminal } from "../src/copy.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { createTerminalSession } from "../src/terminal/session.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

const zip = (name: string): File => new File(["x"], name, { lastModified: 1 });

describe("messages that go away once the cause is fixed", () => {
  beforeAll(() => {
    installFakeDom();
  });

  it("the passphrase form clears its message when either field changes", async () => {
    const { passphraseForm } = await import("../src/components/passphraseForm.ts");
    const form = runInScope(new Scope(true), () => passphraseForm({ mode: "set", submitLabel: "Save", busy: false, key: "t", onSubmit: async () => true })) as unknown as FakeElement;
    const [a, b] = (form.querySelectorAll("input") as FakeElement[]).filter((i) => i.getAttribute("name") !== "username");
    const error = form.querySelector(".field-error") as FakeElement;
    const submit = (): void => form.fire("submit", { preventDefault: () => undefined });
    (a as FakeElement).value = "short";
    (b as FakeElement).value = "short";
    submit();
    expect(error.textContent).toBe(settings.tooShort);
    (a as FakeElement).value = "a much longer passphrase here";
    (a as FakeElement).fire("input");
    expect(error.textContent).toBe("");
    (b as FakeElement).value = "different";
    submit();
    expect(error.textContent).toBe(settings.mismatch);
    (b as FakeElement).value = "a much longer passphrase here";
    (b as FakeElement).fire("input");
    expect(error.textContent).toBe("");
  });

  it("the file chip clears its message when files are added or cleared", async () => {
    const { fileChip } = await import("../src/components/fileChip.ts");
    const session = createTerminalSession({ spawn: () => null, vault: { supported: () => false, read: async () => null, write: async () => undefined, clear: async () => undefined }, vaultPhase: () => "locked", announce: () => undefined });
    const el = runInScope(new Scope(true), () => fileChip(session, { key: "inspect" })) as unknown as FakeElement;
    const input = el.querySelector("input") as FakeElement;
    const problem = el.querySelector("p") as FakeElement;
    input.files = [zip("notes.txt")];
    input.fire("change");
    expect(problem.textContent).toBe(terminal.notZipNote);
    // Another command block adds an export: the message no longer fits.
    session.picked.add([zip("a.zip")]);
    expect(problem.textContent).toBe("");
    // A .txt next to a chosen export still gets its message; Clear takes it away with the files.
    input.files = [zip("notes.txt")];
    input.fire("change");
    expect(problem.textContent).toBe(terminal.notZipNote);
    (el.querySelectorAll("button")[1] as FakeElement).click();
    expect(problem.textContent).toBe("");
  });
});
