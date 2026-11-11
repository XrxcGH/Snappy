/**
 * The desktop README states facts that the files beside it decide. These tests keep the two from drifting apart:
 * what the README says about the update keys must match the key file, and the list of checks that need the built
 * program must name the things only a built program can show.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]): string => readFileSync(path.join(root, ...p), "utf8");
const readme = read("README.md");

describe("what the README says about the update keys", () => {
  const keyLines = read("src-tauri", "update-public-keys.txt")
    .split(/\r?\n/)
    .filter((line) => /^(signing|recovery)\s*=/.test(line));

  it("matches the key file: two real keys, not placeholders", () => {
    expect(keyLines).toHaveLength(2);
    for (const line of keyLines) expect(line.split("=")[1]?.trim()).not.toMatch(/^PLACEHOLDER/);
    // The line that describes the key file in the README table.
    const row = readme.split("\n").find((line) => line.includes("`update-public-keys.txt`")) ?? "";
    expect(row).toMatch(/real ones/);
    expect(row).toMatch(/refuses placeholders and test keys/);
    expect(row).not.toMatch(/placeholders until/);
  });
});

/** The numbered steps of "Checks that need the built program", as one text per step. */
function handChecks(): string[] {
  const start = readme.indexOf("## Checks that need the built program");
  const end = readme.indexOf("\n## ", start + 1);
  const body = readme.slice(start, end);
  return body.split(/\n(?=\d+\. )/).filter((step) => /^\d+\. /.test(step));
}

describe("the checks that need the built program", () => {
  const checks = handChecks();
  const find = (word: RegExp): string => checks.find((step) => word.test(step)) ?? "";

  it("lists every Save and Download button that only a built program can prove, for both systems", () => {
    const downloads = find(/Downloads, on Windows and on macOS/);
    expect(downloads).not.toBe("");
    for (const label of ["Save list", "Save JSON", "Save calendar", "Save CSV", "Save all"]) expect(downloads).toContain(label);
  });

  it("gets the Save all files from the Memories page rescue Run, which demo --run does not produce", () => {
    const downloads = find(/Downloads, on Windows and on macOS/).replace(/\s+/g, " ");
    expect(downloads).toMatch(/on the Memories page, Run on the rescue command \(`memories` with `--out`\), then "Save files" on the confirm card/);
    expect(downloads).toMatch(/When Run ends, press one output file's "Save" and then "Save all"/);
    expect(downloads).toMatch(/`demo --run` on the Guide page makes no files/);
    expect(downloads).not.toMatch(/Guide page, after/);
    expect(downloads).not.toMatch(/after `demo --run`/);
  });

  it("names Save and Download labels that exist in the dashboard", () => {
    const sources = [
      ["..", "dashboard", "src", "copy.ts"],
      ["..", "dashboard", "src", "tools", "friends-backup", "copy.ts"],
      ["..", "dashboard", "src", "tools", "export-reminder", "copy.ts"],
      ["..", "dashboard", "src", "tools", "friends-table", "copy.ts"],
    ];
    const all = sources.map((p) => read(...p)).join("\n");
    for (const label of ["Save list", "Save JSON", "Save calendar file", "Save CSV", "Save all"]) expect(all).toContain(`"${label}"`);
  });

  it("lists the macOS Tab check (Full Keyboard Access) and says it was not run", () => {
    const tab = find(/Full Keyboard Access/);
    expect(tab).toMatch(/Tab/);
    expect(tab).toMatch(/macOS/);
    expect(tab).toMatch(/Nobody has run this yet/);
  });

  it("lists the web engine's Crashpad folder in the sockets and files check", () => {
    const sockets = find(/list the sockets of its process tree/);
    expect(sockets).toMatch(/Crashpad/);
    expect(sockets).toMatch(/watson_metadata/);
    expect(sockets).toMatch(/no `\.dmp` file/);
  });

  it("lists the zoom check at 200 and 300 percent with Ctrl and plus", () => {
    const zoom = find(/Page zoom/);
    expect(zoom).toMatch(/Ctrl and plus/);
    expect(zoom).toMatch(/200 percent/);
    expect(zoom).toMatch(/300 percent/);
  });
});

describe("the crash dump finding", () => {
  const conf = JSON.parse(read("src-tauri", "tauri.conf.json")) as { app: { windows: { additionalBrowserArgs?: string }[] } };
  const args = conf.app.windows[0]?.additionalBrowserArgs ?? "";

  it("is recorded with the switches that were tried and what each one did", () => {
    const start = readme.indexOf("### Record of the crash dump finding");
    expect(start).toBeGreaterThan(0);
    const record = readme.slice(start, readme.indexOf("\n## ", start));
    expect(record).toMatch(/--disable-breakpad/);
    expect(record).toMatch(/--disable-crash-reporter/);
    expect(record).toMatch(/neither switch stops the dump/i);
    expect(record).toMatch(/Not measured/);
  });

  it("keeps the switches that did not work out of the window's browser arguments (they would only suggest a protection that is not there)", () => {
    expect(args).not.toMatch(/--disable-breakpad|--disable-crash-reporter/);
  });
});
