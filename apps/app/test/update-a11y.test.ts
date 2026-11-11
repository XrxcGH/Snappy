/**
 * What a screen reader hears from the update interface, and what the page does with Windows high contrast, as far as
 * they can be shown without a window: the rules for repainting the download banner, the words only assistive technology
 * hears, and the forced-colors rules in update.css. The built page itself is driven by test/e2e-ui/update-ui.check.mjs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULES, collectCopy, lint } from "../../dashboard/test/copy-rules.ts";
import { updateA11yCopy } from "../src/update-copy-a11y.ts";
import { actionAriaLabel, bannerFor, bannerSignature, crossedHalfway, freshLocal, sanitizeStatus } from "../src/update-model.ts";
import type { UpdateStatus } from "../src/update-model.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (name: string): string => readFileSync(path.join(here, "..", "src", name), "utf8");

const downloading = (percent: number): UpdateStatus => {
  const s = sanitizeStatus({ state: "downloading", percent, version: "0.2.0", current: "0.1.0-beta.3", auto: true, last_checked_unix: 0, notice_pending: false, link_enabled: false, supported: true, error: null, updated_to: null });
  if (!s) throw new Error("fixture rejected");
  return s;
};
const banner = (percent: number) => bannerFor(downloading(percent), freshLocal(), false);

describe("the download banner is repainted only when something other than the percent changes", () => {
  it("has the same signature at every percent, so the live region is not rebuilt and read again", () => {
    const signatures = new Set([0, 1, 42, 43, 50, 99, 100].map((p) => bannerSignature(banner(p))));
    expect(signatures.size).toBe(1);
  });

  it("changes when the kind, the words or the buttons change", () => {
    const base = bannerSignature(banner(10));
    const ready = bannerFor({ ...downloading(100), state: "staged" }, freshLocal(), false);
    expect(bannerSignature(ready)).not.toBe(base);
    expect(bannerSignature({ kind: "progress", text: "Checking…", actions: [] })).not.toBe(base);
    expect(bannerSignature({ kind: "progress", text: "Checking…", actions: [] })).not.toBe(bannerSignature({ kind: "progress", text: "Other", actions: [] }));
    expect(bannerSignature({ kind: "failed", text: "x", actions: ["updateNow"] })).not.toBe(bannerSignature({ kind: "failed", text: "x", actions: ["updateNow", "getFromGitHub"] }));
    expect(bannerSignature(null)).toBe("");
  });
});

describe("half way is said once", () => {
  it("fires when a download seen below half reaches half, and not before, after or on a first sight", () => {
    expect(crossedHalfway(49, 50)).toBe(true);
    expect(crossedHalfway(10, 90)).toBe(true);
    expect(crossedHalfway(49, 49)).toBe(false);
    expect(crossedHalfway(50, 51)).toBe(false);
    expect(crossedHalfway(null, 80)).toBe(false);
    expect(crossedHalfway(null, 0)).toBe(false);
  });
});

describe("the words only assistive technology hears", () => {
  it("follow the dashboard's copy rules", () => {
    const entries = collectCopy({ updateA11y: updateA11yCopy });
    expect(entries.length).toBe(Object.keys(updateA11yCopy).length);
    const problems: string[] = [];
    for (const rule of RULES) problems.push(...lint(entries, rule));
    expect(problems).toEqual([]);
  });

  it("never carry a percent, so the live text is the same for the whole download", () => {
    for (const text of [updateA11yCopy.downloadingLive, updateA11yCopy.turnOffName]) expect(text).not.toMatch(/\d|%/);
    expect(updateA11yCopy.downloadingLive).toBe("Downloading update");
  });

  it("keep the visible label inside the accessible name of the button they name", () => {
    expect(updateA11yCopy.turnOffName).toContain("Turn off");
  });
});

describe("Windows high contrast (forced colors) in update.css", () => {
  const css = source("update.css");
  const block = (): string => {
    const start = css.indexOf("@media (forced-colors: active)");
    if (start < 0) return "";
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
    }
    return css.slice(start);
  };

  it("gives the download bar a border track and draws the filled parts in the system highlight color", () => {
    const rules = block();
    expect(rules).not.toBe("");
    expect(rules).toMatch(/\.update-bar\s*\{[^}]*border:\s*1px solid CanvasText/);
    expect(rules).toMatch(/\.update-bar\s*\{[^}]*box-shadow:\s*none/);
    for (const selector of [".update-bar-fill", ".update-wait"]) expect(rules, selector).toContain(selector);
    expect(rules).toMatch(/background:\s*Highlight/);
    expect(rules).toMatch(/forced-color-adjust:\s*none/);
  });

  it("uses system colors only inside the forced-colors block, and tokens everywhere else", () => {
    const outside = css.replace(block(), "");
    expect(outside).not.toMatch(/\b(CanvasText|Highlight|HighlightText|ButtonText)\b/);
    expect(outside).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

describe("the names of the banner buttons", () => {
  it("say what the first-run notice's Turn off button turns off, and leave the self-explaining buttons alone", () => {
    expect(actionAriaLabel("turnOff")).toBe("Turn off update checks");
    for (const action of ["updateNow", "restartNow", "getFromGitHub", "cancel", "later", "ok"] as const) expect(actionAriaLabel(action), action).toBeUndefined();
  });

  it("are given to the buttons by update-ui.ts", () => {
    expect(source("update-ui.ts")).toMatch(/ariaLabel: actionAriaLabel\(action\)/);
  });
});

describe("the download banner in update-ui.ts", () => {
  const ui = source("update-ui.ts");

  it("exposes the bar as a progress bar and hides the changing percent text from assistive technology", () => {
    expect(ui).toMatch(/role: "progressbar"/);
    expect(ui).toMatch(/"aria-valuenow"/);
    expect(ui).toMatch(/"aria-valuemin": "0", "aria-valuemax": "100"/);
    expect(ui).toMatch(/"aria-hidden": "true"/);
    expect(ui).not.toMatch(/role: "presentation" \}, \(\(\) =>/); // the old bar that assistive technology could not see
  });
});
