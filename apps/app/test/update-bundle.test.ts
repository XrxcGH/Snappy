/**
 * The update interface exists in the desktop build only. The web build must not change at all: it carries none of the
 * update words, none of the command names, no Tauri bridge, and nothing that could reach the network. Both builds keep
 * the page policy that forbids every connection, and the desktop page calls the shell only through its bridge.
 *
 * The strongest check, that the web build's bytes equal the previous main build's, needs two source trees:
 * `node apps/app/tools/check-web-build-unchanged.mjs <git ref>` does that (see docs/UPDATES.md). These tests hold the
 * rest of the line on every run.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { updateCopy } from "../src/update-copy.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const UPDATE_COMMANDS = ["update_status", "update_check", "update_install", "update_set_auto", "update_open_releases"];

function build(script: string[], file = "index.html"): string {
  const out = mkdtempSync(path.join(os.tmpdir(), "snappy-bundle-"));
  try {
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env.CI;
    delete env.SNAPPY_READER;
    execFileSync(process.execPath, [...script, "--out", out], { env: env as NodeJS.ProcessEnv, stdio: "pipe", cwd: root });
    return readFileSync(path.join(out, file), "utf8");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const web = build([path.join(root, "apps", "dashboard", "build.mjs")]);
const desktop = build([path.join(root, "apps", "app", "scripts", "build-frontend.mjs")]);
const csp = (html: string): string => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? "";

/** Every distinctive string of the update interface that is plain text in a bundle. */
const updateStrings = (): string[] => {
  const out: string[] = [];
  for (const value of Object.values(updateCopy)) {
    // The short ones ("Later", "Cancel", "Updates") are ordinary words the dashboard uses too; the full lines are what is distinctive.
    if (typeof value === "string" && value.length >= 20) out.push(value);
  }
  return out;
};

describe("the web build", () => {
  it("has none of the update words, command names or bridge", () => {
    for (const command of UPDATE_COMMANDS) expect(web).not.toContain(command);
    for (const text of updateStrings()) expect(web, text).not.toContain(text.replace(/’/g, "\\u2019"));
    for (const text of updateStrings()) expect(web, text).not.toContain(text);
    expect(web).not.toMatch(/Snappy-Updater|__TAURI|ipc\.localhost|update-banner|update-card|update-slot|update-privacy|\.update-/);
    expect(web).not.toMatch(/Check for updates|Update check|Update now|Download from GitHub|newest version/);
  });

  it("keeps the policy that forbids every connection and has no way to connect", () => {
    expect(csp(web)).toMatch(/(^|; )connect-src 'none'(;|$)/);
    const unquoted = web.replace(/\\?"(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)\\?"/g, '""');
    expect(unquoted).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts\s*\(/);
  });

  it("is built from sources that never import the desktop app's code", () => {
    const main = readFileSync(path.join(root, "apps", "dashboard", "src", "main.ts"), "utf8");
    expect(main).not.toMatch(/apps\/app|update-|@tauri-apps/);
    const build = readFileSync(path.join(root, "apps", "dashboard", "build.mjs"), "utf8");
    expect(build).toMatch(/extraCss \? /); // the extra stylesheet is added only when a shell asks for it
  });

  it("is the same bytes when built twice (the build is deterministic, so a hash comparison means something)", () => {
    const again = build([path.join(root, "apps", "dashboard", "build.mjs")]);
    expect(createHash("sha256").update(again).digest("hex")).toBe(createHash("sha256").update(web).digest("hex"));
  });
});

describe("the desktop build", () => {
  it("has the update interface and calls the shell by the five command names and no other", () => {
    for (const command of UPDATE_COMMANDS) expect(desktop).toContain(command);
    expect(desktop).toContain("Check for updates on launch");
    expect(desktop).toContain("Asks github.com for the newest version. Sends no ID and none of your data.");
    expect(desktop).toContain("Snappy checks GitHub for updates when it opens.");
    expect(desktop).toMatch(/\.update-banner/);
    expect(desktop).not.toMatch(/pick_zips|read_range|close_file|invoke\("plugin:/);
    // the strings are fixed text: there is no template that takes text from the shell besides a version and a percent
    expect(desktop).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function/);
  });

  it("keeps the policy that forbids every connection, equal in both builds", () => {
    expect(csp(desktop)).toMatch(/(^|; )connect-src 'none'(;|$)/);
    const strip = (c: string): string => c.replace(/'sha256-[^']+'/g, "'hash'");
    expect(strip(csp(desktop))).toBe(strip(csp(web)));
  });

  it("does not use the network from the page: no fetch, request object or socket outside the quoted lists", () => {
    const unquoted = desktop.replace(/\\?"(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)\\?"/g, '""');
    expect(unquoted).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts\s*\(/);
  });

  it("stays under the size limit that the shell tests hold", () => {
    expect(Buffer.byteLength(desktop)).toBeLessThan(1_330_000);
  });
});
