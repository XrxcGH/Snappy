/**
 * One test for every tool in the registry, so a tool nobody wrote a privacy test for is covered too, and so is
 * the next tool somebody adds. For each registered tool it draws the page and presses the tool's download button
 * (when it has one) on a synthetic export that goes through the real reader and holds:
 *   - the canary categories (message text, display names, group titles, locations, captions, sources, account),
 *     which must never reach a page, a label, an announcement or a file; and
 *   - hostile names (right-to-left override, terminal escapes, spreadsheet formula starters, "__proto__",
 *     markup, zero-width and control characters, one very long name) in the friends list and in the chats.
 * Usernames may appear in a result table and in a file; they never carry a raw hostile byte, never run as a
 * spreadsheet formula, and never appear in an announcement, a live region or the page title.
 * Synthetic data only.
 */
import { CANARIES, addSnapshot, bytesReader, emptyLedger, mergeParsedExports, parseExportFromReader, snapshotFromExport, buildSyntheticExport } from "@snappy-export/core";
import type { Ledger, ParsedExport } from "@snappy-export/core";
import { zipSync } from "fflate";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { SAMPLE_NOW } from "../../src/sample.ts";
import type { State } from "../../src/reducer.ts";
import { TOOLS } from "../../src/tools/registry.ts";
import type { FakeElement } from "../fake-dom.ts";
import { renderSettled, stateWith } from "./harness.ts";

const said: string[] = [];
const saved: { fileName: string; text: string; mime: string }[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));
vi.mock("../../src/download.ts", () => ({
  saveTextFile: (fileName: string, text: string, mime: string) => {
    saved.push({ fileName, text, mime });
    return true;
  },
  saveBlob: () => true,
}));

const ALL_CANARIES = Object.values(CANARIES).flat();

const ch = (code: number): string => String.fromCharCode(code);
/** The byte order mark Excel needs at the start of a CSV file. */
const BOM_AT_START = new RegExp("^" + ch(0xfeff));
const esc = (code: number): string => "\\u" + code.toString(16).padStart(4, "0");

/** What a hostile friend can be called. Each replaces one username of the synthetic export, in the friends list and the chats. */
const HOSTILE: readonly string[] = [
  `${ch(0x202e)}evil_rtl.exe`,
  "ansi_\u001b[31mred\u001b[0m_\u001b]0;title\u0007",
  "=cmd|' /C calc'!A0",
  "+SUM(1+1)",
  "-2+3",
  "@SUM(A1:A9)",
  "\t=HYPERLINK(\"http://x.invalid\")",
  "__proto__",
  "constructor",
  "toString",
  "<img src=x onerror=alert(1)>",
  `zero${ch(0x200b)}width${ch(0x2060)}name`,
  "line\nbreak\rname",
  `long_${"y".repeat(95)}`,
  `long_${"x".repeat(2000)}`,
];

/** Bytes that reorder, hide or run something when text is shown or opened: controls, bidi controls, zero-width characters. */
const HOSTILE_RANGES: readonly (readonly [number, number])[] = [
  [0, 8],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];
const HOSTILE_BYTES = new RegExp("[" + HOSTILE_RANGES.map(([a, b]) => `${esc(a)}-${esc(b)}`).join("") + "]");

/** Controls only (what JSON text must write as escapes). */
const CONTROLS = new RegExp("[" + esc(0) + "-" + esc(8) + esc(0x0b) + "-" + esc(0x1f) + esc(0x7f) + "]");

/** Spreadsheet programs run a cell that starts with one of these. */
const FORMULA_START = /^[=+@\t\r]/;

/** The hostile names that would do harm in a spreadsheet cell if written as they are. */
const RISKY_IN_A_CELL = HOSTILE.filter((n) => HOSTILE_BYTES.test(n) || FORMULA_START.test(n) || n.startsWith("-"));

/** The synthetic export of one phase, with its first usernames replaced by the hostile ones, read by the real reader. */
async function hostileExport(phase: 1 | 2): Promise<{ parsed: ParsedExport; raw: string }> {
  const files = buildSyntheticExport({ now: SAMPLE_NOW, phase, realisticMemories: true });
  const decode = (name: string): string => new TextDecoder().decode(files[name]);
  const friends = (JSON.parse(decode("json/friends.json")) as { Friends: { Username: string }[] }).Friends;
  const names = [...new Set(friends.map((f) => f.Username))].filter((n) => /^[A-Za-z]+_\d+$/.test(n)).slice(0, HOSTILE.length);
  expect(names.length, "enough usernames to replace").toBe(HOSTILE.length);
  let raw = "";
  const zippable: Record<string, [Uint8Array, { mtime: Date; level: 6 }]> = {};
  for (const [path, bytes] of Object.entries(files)) {
    let data = bytes;
    if (path.startsWith("json/") && path.endsWith(".json")) {
      let text = new TextDecoder().decode(bytes);
      if (path !== "json/memories_history.json") names.forEach((name, i) => (text = text.split(JSON.stringify(name)).join(JSON.stringify(HOSTILE[i]))));
      raw += text + " ";
      data = new TextEncoder().encode(text);
    }
    zippable[path] = [data, { mtime: new Date(SAMPLE_NOW), level: 6 }];
  }
  const parsed = mergeParsedExports([await parseExportFromReader(bytesReader(zipSync(zippable)))]);
  return { parsed, raw };
}

let state: State;
let usernames: string[];
let rawExport: string;
beforeAll(async () => {
  const earlier = await hostileExport(1);
  const later = await hostileExport(2);
  rawExport = later.raw;
  let ledger: Ledger = emptyLedger();
  for (const p of [earlier.parsed, later.parsed]) ledger = addSnapshot(ledger, snapshotFromExport(p));
  usernames = [...new Set(later.parsed.friends.friends.map((f) => f.username))];
  const real = stateWith({ latest: later.parsed, ledger, allowlist: [], checkedOff: [], ticks: [], issues: [], now: SAMPLE_NOW, parts: 3 });
  // Saving is on and unlocked, so the tools that compare with saved history have a history to compare with.
  state = { ...real, vault: { ...real.vault, phase: "unlocked" } };
}, 120_000);

beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
  saved.length = 0;
});

/** Every piece of text a screen reader or a person can reach on a page, by kind. */
function surfaces(root: FakeElement): { text: string; labels: string[]; live: string[] } {
  const labels: string[] = [];
  const live: string[] = [];
  for (const el of root.descendants()) {
    for (const attr of ["aria-label", "aria-description", "aria-valuetext", "title", "alt", "placeholder"]) {
      const v = el.getAttribute(attr);
      if (v !== null) labels.push(v);
    }
    const role = el.getAttribute("role");
    if (el.hasAttribute("aria-live") || role === "status" || role === "alert") live.push(el.textContent);
  }
  return { text: root.textContent, labels, live };
}

/** The cells of a CSV file (RFC 4180: quoted or plain fields, doubled quotes, CRLF or LF between rows), whichever way the tool writes it. */
function csvCells(text: string): string[] {
  const cells: string[] = [];
  const t = text.replace(BOM_AT_START, "");
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === "," || c === "\n") {
      cells.push(cell.replace(/\r$/, ""));
      cell = "";
    } else cell += c;
  }
  if (cell !== "") cells.push(cell);
  return cells;
}

describe("the export used here", () => {
  it("really holds the canaries and the hostile names, and the reader keeps the hostile ones", () => {
    for (const [category, list] of Object.entries<string[]>(CANARIES as unknown as Record<string, string[]>)) {
      expect(list.some((c) => rawExport.includes(c)), `no ${category} canary in the export`).toBe(true);
    }
    const lower = new Set(usernames);
    for (const name of ["__proto__", "constructor", "tostring", "=cmd|' /c calc'!a0"]) expect(lower.has(name), name).toBe(true);
    expect(usernames.some((n) => n.includes(ch(0x202e))), "the right-to-left override survived the reader").toBe(true);
    expect(usernames.some((n) => n.length > 90 && n.length <= 100), "a long name the reader keeps").toBe(true);
    expect(usernames.some((n) => n.length > 1500), "the reader drops a name longer than any username can be").toBe(false);
  });

  it("covers every registered tool, including the ones with a download", async () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(22);
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    // The press below finds a download by its button key. If that key ever changed, no tool would be pressed and every
    // file check would pass without looking, so the tools known to offer a file are named here.
    const withDownload: string[] = [];
    for (const tool of TOOLS) {
      const { root } = await renderSettled(tool.view, state);
      if (root.querySelectorAll("button").some((b) => b.getAttribute("data-key") === "tool-download")) withDownload.push(tool.id);
    }
    expect(withDownload.sort()).toEqual(["export-reminder", "friends-backup", "friends-table", "reply-speed", "rescue-manifest", "since-last-export"]);
  });
});

describe.each(TOOLS.map((t) => [t.id, t] as const))("tool %s", (_id, tool) => {
  it("draws without failing and shows no canary or hostile byte, in the text, a label, a live region, an announcement or the title", async () => {
    const { root } = await renderSettled(tool.view, state);
    expect(root.querySelector(".tool-failed"), "the page shows its failure line").toBeNull();
    expect(root.querySelector("[aria-busy]"), "the page is still working").toBeNull();
    const { text, labels, live } = surfaces(root);
    const everything = [text, ...labels, ...live, ...said, tool.title, tool.oneLiner, `${tool.title} ${ch(0xb7)} Snappy`];
    for (const piece of everything) {
      for (const canary of ALL_CANARIES) expect(piece, `canary ${canary}`).not.toContain(canary);
      expect(piece, "a link from the export").not.toMatch(/demo\.snappy\.invalid/);
      expect(HOSTILE_BYTES.test(piece), `a raw hostile byte in ${JSON.stringify(piece.slice(0, 80))}`).toBe(false);
    }
  });

  it("names nobody in an announcement, a live region or the title", async () => {
    const { root } = await renderSettled(tool.view, state);
    const { live } = surfaces(root);
    const quiet = [...said, ...live, tool.title, tool.oneLiner].join("\n").toLowerCase();
    for (const name of usernames.filter((n) => n.length >= 5 && !/\s/.test(n))) expect(quiet, `a username in announcements: ${name.slice(0, 40)}`).not.toContain(name.toLowerCase());
  });

  it("saves a file with no canary, no raw hostile byte and no spreadsheet formula, when it has a download", async () => {
    const { root } = await renderSettled(tool.view, state);
    const button = root.querySelectorAll("button").find((b) => b.getAttribute("data-key") === "tool-download");
    if (button === undefined) {
      expect(saved).toHaveLength(0);
      return;
    }
    button.click();
    expect(saved, "one press saves one file").toHaveLength(1);
    const file = saved[0] as (typeof saved)[number];
    expect(file.fileName, "a file name").toMatch(/^[\w][\w.-]*$/);
    expect(said.at(-1), "the saved line is announced").toBeTruthy();
    for (const canary of ALL_CANARIES) expect(file.text, `canary ${canary}`).not.toContain(canary);
    expect(file.text).not.toMatch(/demo\.snappy\.invalid/);
    const body = file.text.replace(BOM_AT_START, "");
    if (file.mime === "text/csv") {
      expect(HOSTILE_BYTES.test(body.replace(/\r\n/g, "")), "a raw hostile byte in the CSV").toBe(false);
      const cells = csvCells(file.text);
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cell, "a cell a spreadsheet would run").not.toMatch(FORMULA_START);
        expect(RISKY_IN_A_CELL, "a raw hostile name as a cell").not.toContain(cell);
      }
    } else if (file.mime === "application/json") {
      // A backup keeps every name exactly, so it can be compared with a later export: the names stay as they were
      // (JSON writes control characters as escapes, and the file is data, not something a spreadsheet opens).
      expect(CONTROLS.test(body), "a raw control character in the JSON").toBe(false);
      const parsed = JSON.parse(body) as { friends?: { username: string }[] };
      expect(parsed).toBeTypeOf("object");
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
      expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
      for (const entry of parsed.friends ?? []) expect(usernames, "a name that is not in the export").toContain(entry.username);
    } else {
      expect(HOSTILE_BYTES.test(body.replace(/[\r\n]/g, "")), "a raw hostile byte in the file").toBe(false);
    }
  });
});
