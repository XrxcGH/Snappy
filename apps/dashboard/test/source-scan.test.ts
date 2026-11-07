/**
 * Source scans: the rules that keep the dashboard content-blind and CSP-safe are checked on the
 * code itself, so a later edit cannot quietly break them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(srcDir).filter((f) => /\.(ts|css|html)$/.test(f));
const tsFiles = files.filter((f) => f.endsWith(".ts"));
const rel = (f: string): string => path.relative(root, f).split(path.sep).join("/");
const read = (f: string): string => readFileSync(f, "utf8");

/** Remove comments so rules about code do not trip over prose that explains them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

function offenders(pattern: RegExp, among = tsFiles, allowed: string[] = []): string[] {
  return among
    .filter((f) => !allowed.includes(rel(f)))
    .filter((f) => pattern.test(stripComments(read(f))))
    .map(rel);
}

describe("no markup strings", () => {
  it("never uses innerHTML, outerHTML, insertAdjacentHTML, document.write, eval or new Function", () => {
    expect(offenders(/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\b|DOMParser|createContextualFragment/)).toEqual([]);
  });

  it("never writes inline styles or event-handler attributes", () => {
    expect(offenders(/setAttribute\(\s*["'`]style["'`]/i)).toEqual([]);
    expect(offenders(/\.cssText\b/)).toEqual([]);
    expect(offenders(/setAttribute\(\s*["'`]on/i)).toEqual([]);
    expect(offenders(/\bstyle\s*=\s*["'`]/)).toEqual([]);
    expect(offenders(/["'`]style["'`]\s*:/)).toEqual([]);
  });

  it("only the DOM helper creates elements from data (views and components use h())", () => {
    const viewFiles = tsFiles.filter((f) => /[\\/](views|components)[\\/]/.test(f));
    expect(offenders(/document\.createElement\(/, viewFiles)).toEqual([]);
    expect(offenders(/\.setAttribute\(\s*["'`]href["'`]/, tsFiles, ["src/dom.ts", "src/download.ts", "src/clipboard.ts"])).toEqual([]);
  });
});

describe("content-blind and offline", () => {
  it("has no network APIs, shared or service workers, window.open or importScripts", () => {
    // The one file that names them is the command helper's scrubber, which removes them (see below).
    expect(offenders(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|SharedWorker|window\.open|serviceWorker|RTCPeerConnection/, tsFiles, ["src/terminal/scrub.ts"])).toEqual([]);
  });

  it("names those APIs in the scrubber only inside its two string lists, never as a call or an access", () => {
    const scrub = stripComments(read(path.join(srcDir, "terminal", "scrub.ts")));
    const outsideLists = scrub.replace(/export const SCRUBBED_(GLOBALS|NAVIGATOR): readonly string\[\] = \[[\s\S]*?\];/g, "");
    expect(outsideLists).not.toMatch(/fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts|SharedWorker|indexedDB|caches/);
    const listed = [...scrub.matchAll(/^\s*"([A-Za-z]+)",$/gm)].map((m) => m[1]);
    expect(listed).toEqual(expect.arrayContaining(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "SharedWorker", "indexedDB", "caches"]));
    expect(scrub).toContain("\"sendBeacon\"");
  });

  it("starts a worker in one place only, and only from a blob: URL made from the page's own code", () => {
    expect(offenders(/new\s+Worker\b/, tsFiles, ["src/worker-runner.ts"])).toEqual([]);
    const runner = stripComments(read(path.join(srcDir, "worker-runner.ts")));
    expect((runner.match(/new\s+Worker\(/g) ?? []).length).toBe(1);
    expect(runner).toMatch(/URL\.createObjectURL\(new Blob\(\[source\]/);
    expect(runner).toMatch(/new Worker\(url\)/);
    // The reader's own code never reaches for a window, storage or the network.
    for (const name of ["import-worker.ts", "worker-task.ts", "import-pipeline.ts", "import-transfer.ts"]) {
      expect(stripComments(read(path.join(srcDir, name))), name).not.toMatch(/\bdocument\b|\bwindow\b|\blocalStorage\b|\bindexedDB\b|\bfetch\b/);
    }
  });

  it("touches browser storage only in vault.ts", () => {
    // The command helper's scrubber lists indexedDB and caches as names to remove; it never uses them.
    expect(offenders(/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie|\bcaches\b/, tsFiles, ["src/vault.ts", "src/terminal/scrub.ts"])).toEqual([]);
  });

  it("keeps the in-app terminal's code where it belongs", () => {
    const terminal = tsFiles.filter((f) => rel(f).startsWith("src/terminal/"));
    expect(terminal.length).toBeGreaterThan(8);
    // Only one door into the command line's code, and the stubs that replace its downloader.
    expect(offenders(/from\s+"(?:\.\.\/)+cli\/|apps\/cli/, tsFiles, ["src/terminal/cli-api.ts", "src/terminal/stubs/memories-download.stub.ts"])).toEqual([]);
    expect(offenders(/import\(\s*"(?:\.\.\/)+cli\//, tsFiles, ["src/terminal/stubs/memories-download.stub.ts"])).toEqual([]);
    // The page never carries the commands: nothing that runs on the page imports the door.
    const helperSide = ["cli-api.ts", "worker.ts", "worker-io.ts", "vfs.ts", "web-lock.ts"].map((n) => `src/terminal/${n}`);
    const pageSide = tsFiles.filter((f) => !helperSide.includes(rel(f)) && !rel(f).startsWith("src/terminal/stubs/"));
    expect(offenders(/from\s+"\.\/cli-api\.ts"|from\s+"\.\.\/terminal\/cli-api\.ts"|from\s+"\.\/terminal\/cli-api\.ts"/, pageSide)).toEqual([]);
    // The helper's own code never reaches for a window, storage or the network.
    for (const name of ["worker.ts", "worker-io.ts", "vfs.ts", "web-lock.ts", "policy.ts", "protocol.ts", "input-names.ts", "cli-api.ts"]) {
      expect(stripComments(read(path.join(srcDir, "terminal", name))), name).not.toMatch(/\bdocument\b|\bwindow\b|\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bfetch\b|\bXMLHttpRequest\b/);
    }
    // Nothing under terminal/ keeps anything: no storage of any kind, so no history of commands.
    expect(offenders(/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie|\bcaches\b|\bbrowserVault\b/, terminal, ["src/terminal/scrub.ts"])).toEqual([]);
  });

  it("wraps every storage access in try/catch", () => {
    const vault = stripComments(read(path.join(srcDir, "vault.ts")));
    expect(vault).toMatch(/try\s*\{\s*return localStorage\.getItem/);
    expect(vault).toMatch(/try\s*\{\s*localStorage\.setItem/);
    expect(vault).toMatch(/try\s*\{\s*return typeof indexedDB/);
    expect(vault).not.toMatch(/window\.confirm|\bconfirm\(|\balert\(|\bprompt\(/);
  });

  it("never touches memory download links or archive paths, so none can be shown", () => {
    expect(offenders(/downloadUrl|zipPath|\.fileList|displayName|Display Name/)).toEqual([]);
  });

  it("uses no confirm, alert or prompt dialogs", () => {
    expect(offenders(/\bwindow\.(confirm|alert|prompt)\b|(^|[^.\w])(confirm|alert|prompt)\s*\(/)).toEqual([]);
  });

  it("links to nothing outside the page except Snapchat profile pages", () => {
    const urls = tsFiles.flatMap((f) => [...stripComments(read(f)).matchAll(/https?:\/\/[^\s"'`)]*/g)].map((m) => m[0]));
    for (const url of urls) expect(url).toMatch(/^https:\/\/www\.snapchat\.com\/add\/$|^http:\/\/www\.w3\.org\/2000\/svg$/);
  });
});

describe("brand", () => {
  it("has no hard-coded color anywhere, orange included: colors come from tokens", () => {
    // Named orange colors and the old off-brand vermilion values are out; orange exists only as the --orange-* tokens.
    expect(offenders(/:\s*(orange|darkorange|orangered|coral|tomato|vermilion)\b|#ff[0-9a-f]{4}\b/i, files)).toEqual([]);
    const css = stripComments(read(path.join(srcDir, "styles.css")));
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    for (const f of tsFiles) expect(stripComments(read(f)), rel(f)).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it("uses no raw pixel sizes for type", () => {
    const css = stripComments(read(path.join(srcDir, "styles.css")));
    expect(css).not.toMatch(/font-size:\s*\d+px/);
  });
});
