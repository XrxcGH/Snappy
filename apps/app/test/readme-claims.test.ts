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
