/**
 * The text behind "Copy diagnostics" in Settings: what a person pastes into a bug report. It holds the version, the
 * kind of build, the system family, three words about the saved history, whether sample data is showing, and counts
 * and issue codes. It never holds a username, a file name, a path, a date from an export, the theme or anything the
 * person typed. Every line comes from numbers and fixed words; no string from the export is ever copied in, so there is
 * nothing to clean. Pure: the state, the shell's platform object and the browser's navigator are passed in.
 */
import { analyze } from "./analysis.ts";
import { brand } from "./copy.ts";
import type { Platform } from "./platform.ts";
import type { State } from "./reducer.ts";
import { activeWorkspace } from "./reducer.ts";

/** Where people report problems. Plain text, never a link: the desktop app cannot open addresses. */
export const REPOSITORY_ADDRESS = "github.com/XrxcGH/Snappy";

export interface DiagnosticsNavigator {
  userAgent?: string;
}

const KINDS: Record<NonNullable<Platform["desktop"]>, string> = { windows: "Windows desktop", macos: "macOS desktop", other: "desktop" };

/** The system family and the browser's major version from the user agent: never the whole string. */
export function systemFamily(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const os = /Windows NT/.test(ua) ? "Windows" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "macOS" : /Linux|X11/.test(ua) ? "Linux" : "unknown system";
  const major = (re: RegExp): string | null => re.exec(ua)?.[1] ?? null;
  const edge = major(/\bEdg\/(\d+)/);
  const firefox = major(/\bFirefox\/(\d+)/);
  const chrome = major(/\bChrome\/(\d+)/);
  const safari = /Safari\//.test(ua) ? major(/\bVersion\/(\d+)/) : null;
  const browser = edge ? `Edge ${edge}` : firefox ? `Firefox ${firefox}` : chrome ? `Chrome ${chrome}` : safari ? `Safari ${safari}` : "unknown browser";
  return `${os}, ${browser}`;
}

const savedHistoryWords = (state: State): string => (!state.vault.supported ? "unavailable" : state.vault.phase === "session" ? "off" : state.vault.phase === "locked" ? "sealed, locked" : "sealed, unlocked");

/** Issue codes are fixed words made of letters, digits and hyphens. Anything else is dropped rather than copied. */
const SAFE_CODE = /^[a-z][a-z0-9-]{0,47}$/;

export function buildDiagnostics(state: State, platform: Platform, nav: DiagnosticsNavigator): string {
  const version = platform.release?.version ?? brand.version;
  const kind = platform.desktop === undefined ? "web" : KINDS[platform.desktop];
  const lines = [`Snappy ${version} (${kind})`, `System: ${systemFamily(nav.userAgent)}`, `Saved history: ${savedHistoryWords(state)}`, `Sample data: ${state.sample === null ? "off" : "on"}`];

  // A locked history holds nothing on screen, so there is nothing to count.
  if (state.vault.phase === "locked") {
    lines.push("Counts and findings: not shown while the saved history is locked");
    return lines.join("\n");
  }

  const ws = activeWorkspace(state);
  const a = analyze(state);
  const exports = `Exports read: ${a.snapshotCount}${ws.parts === undefined ? "" : `, latest export parts: ${ws.parts}`}`;
  lines.push(exports);
  lines.push(
    a.parsed === null
      ? "Counts: none loaded"
      : `Counts: friends ${a.parsed.friends.friends.length}, requests sent ${a.parsed.friends.sentRequests.length}, memories ${a.parsed.memories.length}`,
  );
  lines.push(`Findings: disappeared ${a.ghosts.length}, requests ${a.oneWay.length}, quiet ${a.dormant.length}, cleanup ${a.queue.summary.total}, protected ${a.queue.summary.protectedCount}`);
  const codes = [...new Set(ws.issues.map((i) => i.code).filter((c) => SAFE_CODE.test(c)))];
  lines.push(`Issue codes: ${codes.length === 0 ? "none" : codes.join(", ")}`);
  return lines.join("\n");
}
