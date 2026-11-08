/**
 * .gitignore keeps out the files Snappy itself writes for a person (they hold usernames or capture dates). This test
 * asks Git, so it checks the real rules: every file name the tools write is ignored, and no tracked file is one of
 * them. A new tool that writes a new kind of file name fails here until the pattern is added.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const hasGit = spawnSync("git", ["-C", repo, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).stdout.trim() === "true";

/** The subset of `files` that .gitignore ignores, asked of Git in one call. */
function ignoredAmong(files: string[]): string[] {
  const run = spawnSync("git", ["-C", repo, "check-ignore", "--no-index", "-z", "--stdin"], { input: files.join("\0") + "\0", encoding: "utf8" });
  return run.stdout.split("\0").filter((f) => f !== "");
}
const ignored = (file: string): boolean => ignoredAmong([file]).length === 1;

/** Every source file under apps/<app>/src and packages/<package>/src. */
function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ts$/.test(entry.name)) out.push(full);
    }
  };
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(path.join(repo, group), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        try {
          walk(path.join(repo, group, entry.name, "src"));
        } catch {
          // a package without a src folder
        }
      }
    }
  }
  return out;
}

/** The literal file names the tools propose, such as "snappy-cleanup-list.csv". */
function writtenNames(): string[] {
  const names = new Set<string>();
  for (const file of sources()) {
    for (const m of readFileSync(file, "utf8").matchAll(/["'`](snappy-[a-z0-9-]+\.(?:csv|ics|json|sealed))["'`]/g)) names.add(m[1] as string);
  }
  return [...names].sort();
}

describe.skipIf(!hasGit)(".gitignore and the files Snappy writes", () => {
  it("finds the file names the tools write (so the check below is not empty)", () => {
    const names = writtenNames();
    expect(names).toEqual(expect.arrayContaining(["snappy-cleanup-list.csv", "snappy-export-reminder.ics", "snappy-rescue-manifest.json", "snappy-friends-backup.json"]));
  });

  it("ignores every file name a tool writes", () => {
    const names = writtenNames();
    expect(ignoredAmong(names)).toEqual(names);
  });

  it("ignores a sealed history, spreadsheets, calendar files, manifests and friends backups, wherever they are saved", () => {
    const samples = [
      "ledger.sealed",
      "ledger.allowlist.sealed",
      "out/x.sealed",
      "report.csv",
      "my-friends.csv",
      "reminder.ics",
      "snappy-rescue-manifest.json",
      "snappy-memories-manifest-2026-01-01.json",
      "snappy-friends-backup.json",
      "snappy-friends-backup-2026-01-01.json",
      "friends.json",
      "friends-2026.json",
      "some/folder/friends.json",
    ];
    expect(ignoredAmong(samples)).toEqual(samples);
  });

  it("does not ignore ordinary project files", () => {
    for (const file of ["package.json", "tsconfig.json", "apps/cli/src/main.ts", "docs/BRAND.md", "deny.toml", "apps/app/src-tauri/Cargo.lock"]) expect(ignored(file), file).toBe(false);
  });

  it("has no tracked file that matches the patterns", () => {
    // Tracked files (--cached) that the ignore rules also match (--ignored): there must be none.
    const listed = execFileSync("git", ["-C", repo, "ls-files", "-z", "--cached", "--ignored", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    expect(listed.split("\0").filter((f) => f !== "")).toEqual([]);
    const all = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    expect(all.split("\0").length).toBeGreaterThan(100);
  });
});
