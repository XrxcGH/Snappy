/**
 * The decisions of the words pass, one assertion each, so a later edit cannot quietly bring an old wording back.
 * The general voice rules are in copy.test.ts, copy-quality.test.ts and copy-lint.test.ts; this file pins the
 * specific choices: what the Start page says, which name a thing has, and which words are gone.
 */
import { describe, expect, it } from "vitest";
import * as copy from "../src/copy.ts";
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
