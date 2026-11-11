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

  it("also come at three times the size, which the installer shrinks to the wizard's own size on a scaled display", () => {
    for (const [name, w, h] of [["header-3x.bmp", 450, 171], ["sidebar-3x.bmp", 492, 942]] as const) {
      const d = dims(path.join(tauri, "installer", name));
      expect(d, name).toMatchObject({ magic: "BM", w, h, bits: 24 });
      expect(d.size, name).toBe(d.bytes);
      expect(readFileSync(path.join(tauri, "installer", name)).readUInt32LE(30), `${name} is not compressed`).toBe(0);
    }
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
      for (const name of ["header.bmp", "sidebar.bmp", "header-3x.bmp", "sidebar-3x.bmp"]) {
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

  it("leave the desktop shortcut tick box unticked, and add only the picture fitting file", () => {
    expect(codeOf(hooks)).toEqual(["!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED", '!include "${__FILEDIR__}\\pictures.nsh"']);
  });

  it("fit the wizard's pictures to their controls with smoothing on a scaled display, and keep the 1x pictures otherwise", () => {
    const pictures = readFileSync(path.join(tauri, "installer", "pictures.nsh"), "utf8");
    const code = codeOf(pictures).join("\n");
    // It runs when the wizard opens, only above 96 dpi, from the two 3x files that are committed.
    expect(code).toContain("!define MUI_CUSTOMFUNCTION_GUIINIT SnappyPictures");
    expect(code).toContain("${If} $0 > 96");
    for (const name of ["header-3x.bmp", "sidebar-3x.bmp"]) {
      expect(code).toContain(`\${SNAPPY_PICTURES_DIR}\\${name}`);
      expect(readFileSync(path.join(tauri, "installer", name)).length).toBeGreaterThan(1000);
    }
    // The shrink is a StretchBlt in HALFTONE mode (4) with the brush origin reset, not NSIS's pixel copy (COLORONCOLOR, 3).
    expect(code).toContain("gdi32::SetStretchBltMode(p $snDstDc, i 4)");
    expect(code).toContain("gdi32::SetBrushOrgEx(");
    expect(code).toContain("gdi32::StretchBlt(");
    // The header is handed over as a branding image; the side picture replaces the file the Welcome and Finish pages load.
    expect(code).toContain('SetBrandingImage /IMGID=1046 /RESIZETOFIT "$PLUGINSDIR\\snappy-header.bmp"');
    expect(code).toContain('"$PLUGINSDIR\\modern-wizard.bmp"');
    // The control sizes come from the wizard itself, not from a table of display scales.
    expect(code).toContain("user32::GetClientRect(p r1, @ r2)");
    expect(code).toContain("user32::MapDialogRect(p $HWNDPARENT, p r2)");
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
