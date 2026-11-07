/**
 * What the desktop app tells the dashboard about itself: which system it is, and that it opens no profile links.
 */
import { afterEach, describe, expect, it } from "vitest";
import { platform, setPlatform } from "../../dashboard/src/platform.ts";
import { readFileSync } from "node:fs";
import { desktopKind, desktopPlatform, releaseOf } from "../src/desktop-platform.ts";
import pkg from "../package.json" with { type: "json" };

afterEach(() => setPlatform(desktopPlatform));

describe("desktop platform", () => {
  it("calls a WebView2 window Windows, and any other engine other", () => {
    const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0";
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    const linux = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)";
    expect(desktopKind(edge)).toBe("windows");
    expect(desktopKind(mac)).toBe("other");
    expect(desktopKind(linux)).toBe("other");
    expect(desktopKind("")).toBe("other");
  });

  it("is set as the page's platform as soon as it is loaded, with the profile links off and no reader of its own", () => {
    expect(platform()).toBe(desktopPlatform);
    expect(["windows", "other"]).toContain(desktopPlatform.desktop);
    expect(desktopPlatform.profileLinks).toBe(false);
    expect(desktopPlatform.pickZips).toBeUndefined();
    expect(desktopPlatform.runImport).toBeUndefined();
  });

  it("calls a pre-release a beta and names its version, so the footer and Settings can show it", () => {
    expect(releaseOf("0.1.0-beta.1")).toEqual({ version: "0.1.0-beta.1", beta: true });
    expect(releaseOf("0.1.0-beta")).toEqual({ version: "0.1.0-beta", beta: true });
    expect(releaseOf("0.1.0")).toEqual({ version: "0.1.0", beta: false });
    expect(releaseOf("0.1.0-rc.1").beta).toBe(false);
    expect(desktopPlatform.release).toEqual(releaseOf(pkg.version));
  });

  it("has the same version in package.json, tauri.conf.json and Cargo.toml (and Cargo.lock)", () => {
    const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as { version: string };
    const cargo = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
    const crate = /^version = "([^"]+)"/m.exec(cargo)?.[1];
    const lock = readFileSync(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
    const locked = /\[\[package\]\]\r?\nname = "snappy"\r?\nversion = "([^"]+)"/.exec(lock)?.[1];
    expect([conf.version, crate, locked]).toEqual([pkg.version, pkg.version, pkg.version]);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(-beta\.\d+)?$/);
  });
});
