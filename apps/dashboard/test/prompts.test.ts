import { beforeAll, describe, expect, it, vi } from "vitest";
import { confirmCard } from "../src/components/confirmCard.ts";
import { secretPrompt } from "../src/components/secretPrompt.ts";
import { terminal } from "../src/copy.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";

beforeAll(() => {
  installFakeDom();
});

const QUESTION = "Passphrase for your saved history: ";

function prompt(over: { onSubmit?: (v: string) => void; onCancel?: () => void } = {}) {
  const submitted: string[] = [];
  let canceled = 0;
  const form = secretPrompt({ question: QUESTION, key: "analyze-save", onSubmit: over.onSubmit ?? ((v) => void submitted.push(v)), onCancel: over.onCancel ?? (() => void canceled++) }) as unknown as FakeElement;
  const input = form.querySelector("input") as FakeElement;
  return { form, input, submitted, canceled: () => canceled };
}

describe("the passphrase prompt", () => {
  it("is a labelled form with a masked field the browser does not fill in, named after the command's question", () => {
    const { form, input } = prompt();
    expect(form.tagName).toBe("form");
    expect(input.getAttribute("type")).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(form.querySelector("label")?.textContent).toBe("Passphrase for your saved history");
    expect(form.querySelector("label")?.getAttribute("for")).toBe(input.getAttribute("id"));
    expect(form.getAttribute("aria-labelledby")).toBe(form.querySelector("h3")?.getAttribute("id"));
    expect(form.textContent).toContain(terminal.secretNote);
    expect(form.querySelectorAll("button").map((b) => b.textContent)).toEqual([terminal.continueButton, terminal.cancelButton]);
  });

  it("passes the answer on once, with the field already cleared", () => {
    const states: string[] = [];
    const { form, input, submitted } = prompt({ onSubmit: (v) => states.push(`${v}|${input.value}`) });
    input.value = "my long passphrase";
    form.fire("submit");
    expect(states).toEqual(["my long passphrase|"]);
    expect(input.value).toBe("");
    void submitted;
  });

  it("does not send an empty answer, and keeps the field open", () => {
    const { form, input, submitted } = prompt();
    input.value = "";
    form.fire("submit");
    expect(submitted).toEqual([]);
    expect(input.focusCount).toBe(1);
  });

  it("cancels with Escape or the Cancel button, and clears the field either way", () => {
    const first = prompt();
    first.input.value = "typed but not sent";
    first.form.fire("keydown", { key: "Escape" });
    expect(first.canceled()).toBe(1);
    expect(first.input.value).toBe("");
    const second = prompt();
    second.input.value = "typed but not sent";
    (second.form.querySelectorAll("button")[1] as FakeElement).click();
    expect(second.canceled()).toBe(1);
    expect(second.input.value).toBe("");
    const other = prompt();
    other.form.fire("keydown", { key: "a" });
    expect(other.canceled()).toBe(0);
  });

  it("never puts the answer in the page: not in text, not in an attribute, not in the console", () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const PASS = "CANARY-pass-phrase-zq81";
    const { form, input } = prompt();
    input.value = PASS;
    form.fire("submit");
    const everything = [form.textContent, ...[form, ...form.descendants()].flatMap((el) => [...el.attrs.values()]), input.value].join("|");
    expect(everything).not.toContain("CANARY");
    for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toContain("CANARY");
    vi.restoreAllMocks();
  });
});

describe("the write confirmation", () => {
  const card = (effect: "store" | "folder", outCap = 256 * 1024 * 1024) => {
    const calls = { approve: 0, cancel: 0 };
    const el = confirmCard({ effect, outCap, key: "x", onApprove: () => void calls.approve++, onCancel: () => void calls.cancel++ }) as unknown as FakeElement;
    return { el, calls };
  };

  it("asks about the virtual folder, with the real size limit of this device", () => {
    const { el } = card("folder");
    expect(el.getAttribute("role")).toBe("group");
    expect(el.querySelector("h3")?.textContent).toBe("Save to a virtual folder?");
    expect(el.textContent).toContain("Files stay in this page until you save them. Up to 256 MB.");
    expect(card("folder", 96 * 1024 * 1024).el.textContent).toContain("Up to 96 MB.");
    expect(el.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Save files", "Cancel"]);
  });

  it("asks about the saved history and says it locks the dashboard", () => {
    const { el } = card("store");
    expect(el.querySelector("h3")?.textContent).toBe("Update saved history?");
    expect(el.textContent).toContain("locks the dashboard until you unlock it again");
    expect(el.querySelectorAll("button").map((b) => b.textContent)).toEqual(["Update history", "Cancel"]);
  });

  it("is labelled and described, approves with the first button, cancels with the second or Escape", () => {
    const { el, calls } = card("folder");
    const title = el.querySelector("h3");
    expect(el.getAttribute("aria-labelledby")).toBe(title?.getAttribute("id"));
    expect(el.getAttribute("aria-describedby")).toBe(el.querySelector("p")?.getAttribute("id"));
    const [approve, cancel] = el.querySelectorAll("button") as FakeElement[];
    approve?.click();
    cancel?.click();
    el.fire("keydown", { key: "Escape" });
    el.fire("keydown", { key: "Enter" });
    expect(calls).toEqual({ approve: 1, cancel: 2 });
  });
});
