/**
 * The look of the Windows installer: the two wizard pictures are the ones the script in tools/ draws from the
 * brand files, the config points at them, and the small hook and language files change only what they say.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauri = path.join(root, "src-tauri");
const script = path.join(root, "tools", "make-installer-images.mjs");
const conf = JSON.parse(readFileSync(path.join(tauri, "tauri.conf.json"), "utf8")) as {
  bundle: { windows: { nsis: { headerImage?: string; sidebarImage?: string; installerHooks?: string; customLanguageFiles?: Record<string, string>; languages?: string[] } } };
};
const nsis = conf.bundle.windows.nsis;

const dims = (file: string): { w: number; h: number; bits: number; magic: string; size: number; bytes: number } => {
  const b = readFileSync(file);
  return { magic: b.toString("latin1", 0, 2), size: b.readUInt32LE(2), w: b.readInt32LE(18), h: b.readInt32LE(22), bits: b.readUInt16LE(28), bytes: b.length };
};

describe("the wizard pictures", () => {
  it("are the sizes the wizard expects, as plain 24-bit bitmaps", () => {
    const header = dims(path.join(tauri, nsis.headerImage ?? "missing"));
    expect(header).toMatchObject({ magic: "BM", w: 150, h: 57, bits: 24 });
    expect(header.size).toBe(header.bytes);
    const side = dims(path.join(tauri, nsis.sidebarImage ?? "missing"));
    expect(side).toMatchObject({ magic: "BM", w: 164, h: 314, bits: 24 });
    expect(side.size).toBe(side.bytes);
  });

  it("are what the script draws now, so a logo or token change cannot leave them behind", () => {
    expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("are the same bytes every time the script runs", () => {
    const a = mkdtempSync(path.join(os.tmpdir(), "snappy-bmp-a-"));
    const b = mkdtempSync(path.join(os.tmpdir(), "snappy-bmp-b-"));
    try {
      execFileSync(process.execPath, [script, "--out", a], { stdio: "pipe" });
      execFileSync(process.execPath, [script, "--out", b], { stdio: "pipe" });
      for (const name of ["header.bmp", "sidebar.bmp"]) {
        expect(readFileSync(path.join(a, name)).equals(readFileSync(path.join(b, name))), name).toBe(true);
        expect(readFileSync(path.join(a, name)).equals(readFileSync(path.join(tauri, "installer", name))), name).toBe(true);
      }
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe("the installer hook and language files", () => {
  const hooks = readFileSync(path.join(tauri, nsis.installerHooks ?? "missing"), "utf8");
  const codeOf = (text: string): string[] =>
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith(";"));

  it("leave the desktop shortcut tick box unticked, and do nothing else", () => {
    expect(codeOf(hooks)).toEqual(["!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED"]);
  });

  it("change one line of the uninstaller's wording, the tick box that deletes the saved data", () => {
    const text = readFileSync(path.join(tauri, nsis.customLanguageFiles?.English ?? "missing"), "utf8");
    expect(nsis.languages).toEqual(["English"]);
    // The bundler writes its own byte order mark in front of this file, so a second one in the file stops makensis.
    expect(readFileSync(path.join(tauri, nsis.customLanguageFiles?.English ?? "missing")).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    const line = text.split(/\r?\n/).find((l) => l.startsWith("LangString deleteAppData "));
    expect(line).toBe('LangString deleteAppData ${LANG_ENGLISH} "Also delete Snappy\'s saved data (history and settings)"');
    // Every other string of the template is there, so none is left empty.
    for (const name of ["addOrReinstall", "createDesktop", "uninstallApp", "webview2Downloading", "unableToUninstall"]) expect(text).toContain(`LangString ${name} `);
    expect(text).not.toContain("{{");
  });
});
