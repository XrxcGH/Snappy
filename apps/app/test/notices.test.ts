/**
 * The third-party notices that ship with the desktop app (src-tauri/notices/THIRD-PARTY-DESKTOP.txt, made by
 * tools/make-notices.mjs). MIT, BSD and Apache licenses need their notice to travel with the program, and MPL-2.0 needs
 * the source of its files pointed to, so the installer must carry the file and it must match the lock files.
 *
 * Regenerating the file needs cargo and its registry cache, so it is checked here only when SNAPPY_RUN_CARGO_TESTS=1:
 *   SNAPPY_RUN_CARGO_TESTS=1 npx vitest run apps/app/test/notices.test.ts
 * Every other test reads the committed file and the lock files, so a changed lock without a regenerated file fails.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module without types
import { TARGETS, lockHash } from "../tools/make-notices.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "..");
const repo = path.join(app, "..", "..");
const read = (...p: string[]): string => readFileSync(path.join(...p), "utf8").replace(/\r\n?/g, "\n");
const notices = read(app, "src-tauri", "notices", "THIRD-PARTY-DESKTOP.txt");
const lock = read(app, "src-tauri", "Cargo.lock");
const conf = JSON.parse(read(app, "src-tauri", "tauri.conf.json")) as { bundle: { resources?: Record<string, string> } };

/** name -> versions, from Cargo.lock. */
const locked = new Map<string, string[]>();
for (const block of lock.split("\n[[package]]\n").slice(1)) {
  const name = /^name = "([^"]+)"/m.exec(block)?.[1];
  const version = /^version = "([^"]+)"/m.exec(block)?.[1];
  if (name && version) locked.set(name, [...(locked.get(name) ?? []), version]);
}
/** The text from one heading to the next one. */
const section = (title: string, next: string): string => {
  const start = notices.indexOf(`
${title}
`);
  const end = notices.indexOf(`
${next}
`, start);
  return start < 0 || end < 0 ? "" : notices.slice(start, end);
};
const componentLines = (): string[] => {
  const start = notices.indexOf("\nComponents\n----------\n") + "\nComponents\n----------\n".length;
  const end = notices.indexOf("\n\n", start);
  return notices.slice(start, end).split("\n");
};

describe("the desktop notices file", () => {
  it("was made from the Cargo.lock in the repository (regenerate it when the lock changes)", () => {
    const recorded = /from Cargo\.lock \(sha256 ([0-9a-f]{64})\)/.exec(notices)?.[1];
    expect(recorded).toBe(lockHash(lock));
  });

  it("lists only crates that are in Cargo.lock, at the locked version, and says how many", () => {
    const lines = componentLines();
    const crates = lines.filter((l) => !l.includes("(npm)"));
    expect(crates.length).toBeGreaterThan(200);
    for (const line of crates) {
      const m = /^- (\S+) (\S+): /.exec(line);
      expect(m, line).not.toBeNull();
      expect(locked.get(m![1]!) ?? [], line).toContain(m![2]);
    }
    expect(notices).toContain(`Rust crates: ${crates.length}.`);
  });

  it("covers what the program is made of: the framework, the zip-free shell's own libraries and the web view bindings", () => {
    const names = new Set(componentLines().map((l) => /^- (\S+) /.exec(l)?.[1]));
    for (const name of ["tauri", "tauri-runtime-wry", "wry", "tao", "serde", "serde_json", "sha2", "minisign-verify", "windows-sys", "webview2-com", "tauri-plugin-dialog"]) expect(names.has(name), name).toBe(true);
  });

  it("lists the npm library the desktop page bundles on top of the web build, at the locked version", () => {
    const lockfile = JSON.parse(read(repo, "package-lock.json")) as { packages: Record<string, { version: string }> };
    const version = lockfile.packages["node_modules/@tauri-apps/api"]!.version;
    expect(componentLines().some((l) => l.startsWith(`- @tauri-apps/api ${version} (npm): `))).toBe(true);
  });

  it("names every MPL-2.0 crate with the address of its source at the locked version", () => {
    const mpl = section("Files covered by MPL-2.0", "Components");
    expect(mpl).toMatch(/with no change to their files/);
    const listed = componentLines().filter((l) => /\bMPL-2\.0\b/.test(l));
    expect(listed.length).toBeGreaterThanOrEqual(5);
    for (const line of listed) {
      const [, name, version] = /^- (\S+) (\S+): /.exec(line)!;
      expect(locked.get(name!) ?? [], name).toContain(version);
      expect(mpl, name).toContain(`https://crates.io/crates/${name}/${version}`);
      expect(mpl, name).toContain(`https://static.crates.io/crates/${name}/${name}-${version}.crate`);
    }
    for (const name of ["cssparser", "cssparser-macros", "dtoa-short", "option-ext", "selectors"]) expect(mpl, name).toContain(`- ${name} `);
  });

  it("carries the license texts: Apache-2.0, MIT, BSD-3-Clause, MPL-2.0 and the Unicode license", () => {
    expect(notices).toMatch(/Apache License\s+Version 2\.0, January 2004/);
    expect(notices).toMatch(/Permission is hereby granted, free of charge/);
    expect(notices).toMatch(/Redistribution and use in source and binary forms/);
    expect(notices).toMatch(/Mozilla Public License Version 2\.0/);
    expect(notices).toMatch(/UNICODE LICENSE V3/);
    expect(notices).toMatch(/Copyright \(c\) .*Arjun Barrett|Copyright .*Tauri Programme/);
  });

  it("says no machine, user or path", () => {
    expect(notices).not.toMatch(/[A-Za-z]:\\|\\Users\\|\/Users\/|\/home\/|\.cargo|registry\/src/);
    expect(notices).not.toMatch(/\b(ericj|localhost)\b/i);
  });

  it("uses the same desktop targets as the supply-chain rules in deny.toml", () => {
    const deny = read(repo, "deny.toml");
    const block = /targets = \[([^\]]*)\]/.exec(deny)?.[1] ?? "";
    const targets = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect([...TARGETS].sort()).toEqual(targets.sort());
  });
});

describe("what the installer ships", () => {
  it("puts NOTICE, the web notices and the desktop notices beside the program, under licenses/", () => {
    const resources = conf.bundle.resources ?? {};
    expect(resources["../../../NOTICE"]).toBe("licenses/NOTICE.txt");
    expect(resources["../../../THIRD-PARTY-NOTICES.md"]).toBe("licenses/THIRD-PARTY-NOTICES.md");
    expect(resources["notices/THIRD-PARTY-DESKTOP.txt"]).toBe("licenses/THIRD-PARTY-DESKTOP.txt");
  });

  it("names files that exist (paths are relative to src-tauri, like licenseFile)", () => {
    for (const source of Object.keys(conf.bundle.resources ?? {})) expect(existsSync(path.join(app, "src-tauri", source)), source).toBe(true);
  });

  it("ships nothing else: no resource outside licenses/", () => {
    for (const target of Object.values(conf.bundle.resources ?? {})) expect(target).toMatch(/^licenses\//);
  });
});

describe.skipIf(!process.env.SNAPPY_RUN_CARGO_TESTS)("regenerating the file", () => {
  it("gives exactly the committed file (node apps/app/tools/make-notices.mjs --check)", { timeout: 180_000 }, () => {
    execFileSync(process.execPath, [path.join(app, "tools", "make-notices.mjs"), "--check"], { stdio: "pipe" });
  });
});
