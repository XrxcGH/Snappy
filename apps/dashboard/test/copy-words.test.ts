/**
 * The decisions of the words pass, one assertion each, so a later edit cannot quietly bring an old wording back.
 * The general voice rules are in copy.test.ts, copy-quality.test.ts and copy-lint.test.ts; this file pins the
 * specific choices: what the Start page says, which name a thing has, and which words are gone.
 */
import { describe, expect, it } from "vitest";
import * as copy from "../src/copy.ts";
import { setPlatform } from "../src/platform.ts";
import { SAMPLE_ARGS } from "./copy-rules.ts";

/** Every string reachable from copy.ts with the path it came from; functions are called with sample values. */
function strings(value: unknown, at = "", out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([at, value]);
  else if (typeof value === "function") {
    for (const args of SAMPLE_ARGS) {
      try {
        strings((value as (...a: unknown[]) => unknown)(...args), `${at}()`, out);
      } catch {
        // A function that rejects these sample arguments contributes nothing for them.
      }
    }
  } else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${at}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) strings(v, at === "" ? k : `${at}.${k}`, out);
  return out;
}
const all = strings(copy);
const hits = (re: RegExp, except: RegExp = /^$/): string[] => all.filter(([p, t]) => re.test(t) && !except.test(p)).map(([p, t]) => `${p}: ${t}`);

describe("Start page words", () => {
  it("says that Snapchat takes a while to prepare an export, in step 1", () => {
    expect(copy.start.exportBody).toMatch(/prepares it, which can take a while/);
    expect(copy.start.exportBody).toMatch(/emails you a link/);
  });

  it("names the file with no number by its name, not as part 1", () => {
    expect(copy.start.laterPartsOnly).toBe("These are the numbered parts, which hold photos and videos. Add the file that has no number at the end of its name.");
  });

  it("has a message for an unzipped export and a separate Mac tip about Safari", () => {
    expect(copy.start.unzipped).toBe("This looks like an unzipped export. Choose the ZIP files instead.");
    expect(copy.start.unzippedMacTip).toMatch(/^On a Mac, turn off “Open safe files after downloading” in Safari’s settings/);
  });
});

describe("what the Privacy page says about group titles and the profile link", () => {
  it("does not say group chat titles are skipped: it says they become a short code", () => {
    expect(copy.privacy.neverBody).toBe("Snappy never keeps these. It skips them while it reads, except group chat titles, which it turns into a short code.");
  });

  it("says on the web, once, that Open profile opens snapchat.com with the username in the address", () => {
    expect(copy.privacy.networkOk).toBe("Snappy’s page cannot connect to the internet. Open profile opens snapchat.com, with that friend’s username in the address.");
  });

  it("says nothing about a profile link in the desktop app, which draws none", () => {
    setPlatform({ desktop: "windows", profileLinks: false });
    try {
      expect(copy.privacy.networkOk).not.toMatch(/Open profile|snapchat\.com/);
    } finally {
      setPlatform({});
    }
  });
});

describe("the Privacy page's line about each system's web view", () => {
  it("names the system, says the web view is a separate program Snappy does not control, and claims no test it has not had", () => {
    expect(copy.privacy.desktopOther).toBe("On Linux, the app uses WebKitGTK, a separate program that Snappy does not control. Its network behavior has not been checked.");
    expect(copy.privacy.desktopMac).toMatch(/^On macOS, the app uses the system’s own web view, a separate component that Snappy does not control\.$/);
    expect(copy.privacy.desktopWindows).toMatch(/^On Windows, the app uses Microsoft WebView2, a separate program that Snappy does not control\.$/);
  });

  it("does not say we, and does not call the web view an engine, in any of the three", () => {
    for (const line of [copy.privacy.desktopWindows, copy.privacy.desktopMac, copy.privacy.desktopOther]) {
      expect(line).not.toMatch(/\bwe\b|web engine/i);
    }
  });

  it("says nothing was tested on Linux, where the Windows and macOS lines say what was", () => {
    expect(copy.privacy.desktopOther).not.toMatch(/test/i);
    expect(copy.privacy.desktopMacTest).toMatch(/automated test/);
  });
});

describe("the never-reads lists", () => {
  it("names login history on the Privacy page, the list people read for the promise, as it does on every tool page", () => {
    expect(copy.privacy.neverRows.map(([what]) => what)).toContain("Login history");
    expect(copy.tools.readsNever).toMatch(/login history/);
  });

  it("writes the Tools frame's list with the Oxford comma the brand guide asks for", () => {
    expect(copy.tools.readsNever).toBe("It never reads message text, media, locations, display names, or login history.");
  });
});

describe("numbers", () => {
  /** Functions whose number is a label, not a count of things: a step, an exit code, a size limit in megabytes. */
  const LABELS = new Set(["common.stepPrefix", "terminal.codeLabel", "terminal.doneAnnounce", "terminal.confirmFolderBody"]);
  /** A function that writes back a name it was given (a username, a version) is not counting anything. */
  const echoesNames = (fn: (...a: unknown[]) => unknown): boolean => {
    try {
      return String(fn("ZQXJ", "ZQXJ", "ZQXJ")).includes("ZQXJ");
    } catch {
      return false;
    }
  };

  it("writes every count a copy function receives with thousands separators: 1,234, never 1234", () => {
    const bad: string[] = [];
    for (const [group, value] of Object.entries(copy)) {
      if (!value || typeof value !== "object") continue;
      for (const [key, fn] of Object.entries(value)) {
        if (typeof fn !== "function" || LABELS.has(`${group}.${key}`) || echoesNames(fn as (...a: unknown[]) => unknown)) continue;
        for (const args of [[1234], [1234, 5678], [1234, 5678, 4321]]) {
          let out: unknown;
          try {
            out = (fn as (...a: unknown[]) => unknown)(...args);
          } catch {
            continue;
          }
          if (typeof out === "string" && /(?<![\d,.])\d{4,}(?!\d)/.test(out)) bad.push(`${group}.${key}(${args.join(", ")}): ${out}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("groups the counts that were written raw", () => {
    expect(copy.common.showMore(1234)).toBe("Show 1,234 more");
    expect(copy.cleanup.summary(1234, 5678)).toBe("1,234 of 5,678 people match");
    expect(copy.cleanup.protectedHeading(1234)).toBe("Protected (1,234)");
    expect(copy.cleanup.progressText(1234, 5678)).toBe("1,234 of 5,678 done");
    expect(copy.terminal.filesChosen(1234)).toBe("1,234 files chosen");
    expect(copy.terminal.outMore(1234)).toBe("Plus 1,234 more");
    expect(copy.terminal.outCount(1234, "2 MB")).toBe("1,234 files, 2 MB");
    expect(copy.start.skippedFiles(1234)).toMatch(/^1,234 files were skipped/);
  });

  it("keeps plain zeros and the singular", () => {
    expect(copy.cleanup.progressText(0, 0)).toBe("0 of 0 done");
    expect(copy.terminal.filesChosen(1)).toBe("1 file chosen");
    expect(copy.terminal.outCount(1, "1 KB")).toBe("1 file, 1 KB");
  });
});

describe("Save, not download", () => {
  it("names the tool frame's file section and its confirmation with the same verb", () => {
    expect(copy.tools.downloadHeading).toBe("Save a file");
    expect(copy.tools.downloadSaved).toBe("File saved.");
    expect(copy.terminal.saveFileButton).toBe("Save");
    expect(copy.terminal.saveAllButton).toBe("Save all");
    expect(copy.cleanup.saveList).toBe("Save list");
  });

  it("has no button or heading that says Download", () => {
    const labels = all.filter(([p]) => /(Button|Heading|\.saveList|\.copyList)$/.test(p));
    expect(labels.filter(([, t]) => /^Download\b/.test(t)).map(([p, t]) => `${p}: ${t}`)).toEqual([]);
  });
});

describe("Settings licenses note", () => {
  it("counts the font families and the digits-only font, and points to the texts below, not to a folder", () => {
    expect(copy.settings.licensesBody).toBe("Three open font families, a digits-only font made from one of them, and one MIT library. Their license texts are below.");
    expect(copy.settings.licensesBody).not.toMatch(/folder|comes with/);
  });
});

describe("which app a sentence means", () => {
  it("never says in the app: inside Snappy that means Snappy, and the person is being sent to Snapchat", () => {
    expect(hits(/\b(in|from) the app\b/i)).toEqual([]);
    expect(copy.memories.pairingWhy[1]).toBe("Snapchat may leave out Memories it keeps only in its own app, or saved after your export.");
  });

  it("sends the person to Snapchat, by name, wherever a count or a check is meant to happen there", () => {
    expect(copy.cleanup.noChatProtection(false)).toMatch(/Check Snapchat before you remove anyone/);
    expect(copy.memories.pairingTodo).toMatch(/from the Snapchat app/);
  });
});

describe("one name for what a passphrase protects: the saved history", () => {
  it("saves a history, and never seals one", () => {
    expect(copy.settings.setButton).toBe("Save history");
    expect(copy.shell.sealedOn).toBe("History saved");
    expect(copy.settings.sealed).toBe("History saved with your passphrase.");
    expect(copy.settings.storageLocked).toBe("Your saved history is locked. Unlock it on the Start page.");
    expect(copy.settings.lockBody).toBe("Clears your results from the screen and keeps your saved history. You need your passphrase to open it again.");
    expect(copy.start.sessionOnlyBody).toMatch(/save it with a passphrase in Settings/);
  });

  it("keeps the word seal only inside the technical details", () => {
    expect(hits(/\bseal(s|ed|ing)?\b/i, /^privacy\.sealTech$/)).toEqual([]);
  });

  it("has no saved data, snapshot or turned saving on, and no bare your history after a preposition", () => {
    expect(hits(/saved data/i)).toEqual([]);
    expect(hits(/snapshot/i)).toEqual([]);
    expect(hits(/turned saving on|saving turned on|turn saving on/i)).toEqual([]);
    expect(hits(/\b(to|in|with|from|of) your history\b/i)).toEqual([]);
  });

  it("names the settings section, the delete heading and the vault messages the same way", () => {
    expect(copy.settings.storageHeading).toBe("Saved history");
    expect(copy.settings.deleteHeading).toBe("Delete saved history");
    expect(copy.settings.deleteConfirmTitle).toBe("Delete saved history?");
    expect(copy.settings.deleted).toBe("Saved history deleted.");
    expect(copy.vaultMessages.nothingSaved).toBe("No saved history was found on this device.");
    expect(copy.start.unlockedAnnounce).toBe("Saved history unlocked.");
  });

  it("says in two short sentences that Snappy cannot check marks and when they are kept", () => {
    expect(copy.tools.markNote).toBe("Snappy cannot check your marks. They are kept only if you save your history with a passphrase.");
  });
});
