/**
 * Runs the headless-browser check of the built desktop page (test/e2e-ui/update-ui.check.mjs) when Playwright is available:
 *
 *   PLAYWRIGHT_DIR=<folder with node_modules/playwright> npx vitest run apps/app/test/update-ui.test.ts
 *
 * Without PLAYWRIGHT_DIR the test is skipped (CI does not install a browser for it). The check opens the built page from a file in
 * headless Chromium with a scripted stand-in for the shell: no window is shown and no network is used. It feeds the page a
 * synthetic export whose first friend is named like markup, to prove the update banner cannot be built from export text.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { syntheticExportZip } from "@snappy-export/core";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const playwright = process.env.PLAYWRIGHT_DIR;

/** The synthetic export with its first friend renamed to markup that would, if rendered as markup, make an update banner. */
export function hostileExportZip(): Uint8Array {
  const files = unzipSync(syntheticExportZip({ now: Date.UTC(2026, 10, 6, 12), friendCount: 12, chatMessageCount: 40, memoryCount: 6 }));
  const name = Object.keys(files).find((n) => n.endsWith("friends.json"));
  if (!name || !files[name]) throw new Error("the synthetic export has no friends file");
  const text = strFromU8(files[name]).replace('"Username": "Active_1"', `"Username": "<div id=\\"update-banner\\">Update now</div>"`);
  return zipSync({ ...files, [name]: strToU8(text) });
}

describe.skipIf(!playwright)("the update interface in the built desktop page (headless Chromium)", () => {
  it("shows every banner, the Settings card and the Privacy block, fits from 320 px to wide in light and dark, and ignores export text", { timeout: 300_000 }, () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "snappy-update-ui-"));
    try {
      execFileSync(process.execPath, [path.join(app, "scripts", "build-frontend.mjs"), "--out", path.join(dir, "frontend")], { stdio: "pipe", env: { ...process.env, CI: "" } });
      const zip = path.join(dir, "hostile.zip");
      writeFileSync(zip, hostileExportZip());
      const out = execFileSync(process.execPath, [path.join(here, "e2e-ui", "update-ui.check.mjs"), path.join(dir, "frontend", "index.html"), zip], {
        env: { ...process.env, PLAYWRIGHT_DIR: playwright },
        encoding: "utf8",
        timeout: 280_000,
      });
      expect(out).toContain("ALL PASSED");
      expect(out).not.toContain("FAIL ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
