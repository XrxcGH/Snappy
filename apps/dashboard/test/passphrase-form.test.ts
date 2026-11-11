/**
 * A form with a password field carries a hidden username field before it, so the browser console stays free of the
 * "Password forms should have (optionally hidden) username fields" warning and password managers do not misfile the entry.
 */
import { describe, expect, it } from "vitest";
import { passphraseForm } from "../src/components/passphraseForm.ts";
import { installFakeDom } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const build = (mode: "unlock" | "set"): FakeElement => {
  installFakeDom();
  return passphraseForm({ mode, submitLabel: "Go", busy: false, key: "t", onSubmit: async () => true }) as unknown as FakeElement;
};

describe("the passphrase form", () => {
  for (const mode of ["unlock", "set"] as const) {
    it(`has one hidden username field before the password fields (${mode})`, () => {
      const form = build(mode);
      const inputs = form.querySelectorAll("input");
      const users = inputs.filter((i) => i.getAttribute("autocomplete") === "username");
      expect(users).toHaveLength(1);
      const user = users[0]!;
      expect(user.hasAttribute("hidden")).toBe(true);
      expect(user.getAttribute("tabindex")).toBe("-1");
      expect(user.getAttribute("aria-hidden")).toBe("true");
      expect(inputs.indexOf(user)).toBeLessThan(inputs.findIndex((i) => i.getAttribute("type") === "password"));
    });
  }
});
