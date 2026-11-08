/**
 * The update interface's rules without a page: what is accepted from the shell, what banner each state gets, and when the
 * page may claim it is idle. The words are checked against the dashboard's own copy rules (sentence case, American
 * English, curly quotes, short lines) so the update interface reads like the rest of the app.
 */
import { describe, expect, it } from "vitest";
import { RULES, collectCopy, lint } from "../../dashboard/test/copy-rules.ts";
import { updateCopy } from "../src/update-copy.ts";
import { bannerFor, checkResult, freshLocal, pageIsIdle, sanitizeStatus } from "../src/update-model.ts";
import type { Local, UpdateStatus } from "../src/update-model.ts";

const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  state: "idle",
  percent: 0,
  version: null,
  current: "0.1.0-beta.2",
  auto: true,
  last_checked_unix: 0,
  notice_pending: false,
  link_enabled: false,
  supported: true,
  error: null,
  updated_to: null,
  ...over,
});

const status = (over: Record<string, unknown> = {}): UpdateStatus => {
  const s = sanitizeStatus(raw(over));
  if (!s) throw new Error("fixture rejected");
  return s;
};

describe("what the page accepts from the shell", () => {
  it("accepts exactly the shell's fields with plain values", () => {
    const s = sanitizeStatus(raw({ state: "staged", percent: 100, version: "0.2.0", last_checked_unix: 1794000000, link_enabled: true, error: "signature", updated_to: "0.1.9" }));
    expect(s).toEqual({ state: "staged", percent: 100, version: "0.2.0", current: "0.1.0-beta.2", auto: true, lastCheckedUnix: 1794000000, noticePending: false, linkEnabled: true, supported: true, error: "signature", updatedTo: "0.1.9" });
  });

  it("refuses anything else as a whole", () => {
    const bad: Record<string, unknown>[] = [
      { state: "hacked" }, { state: 5 }, { percent: 101 }, { percent: -1 }, { percent: 4.5 }, { percent: "5" }, { version: "0.2" }, { version: "v0.2.0" }, { version: "0.2.0-beta.1" },
      { version: "<b>0.2.0</b>" }, { version: "0.2.0\n" }, { version: 2 }, { current: "" }, { current: "x.y.z" }, { current: "1.0.0-<img>" }, { auto: "yes" }, { notice_pending: 1 },
      { link_enabled: null }, { supported: undefined }, { error: "boom" }, { error: "<script>" }, { updated_to: "1.2.3.4" }, { last_checked_unix: -5 }, { last_checked_unix: 1.5 },
    ];
    for (const over of bad) expect(sanitizeStatus(raw(over)), JSON.stringify(over)).toBeNull();
    for (const value of [null, undefined, "x", 5, [], [raw()]]) expect(sanitizeStatus(value)).toBeNull();
    expect(sanitizeStatus({ ...raw(), extra: "https://evil.test/" })).toBeNull();
    const missing = raw();
    delete missing.error;
    expect(sanitizeStatus(missing)).toBeNull();
  });
});

describe("the banner for each state", () => {
  const local = (over: Partial<Local> = {}): Local => ({ ...freshLocal(), ...over });

  it("shows nothing when nothing is going on", () => {
    expect(bannerFor(status(), local(), true)).toBeNull();
    expect(bannerFor(status({ state: "checking" }), local(), true)).toBeNull();
    expect(bannerFor(status({ error: "offline" }), local(), true)).toBeNull();
  });

  it("shows the first-run notice until it is answered, even after the shell stops reporting it", () => {
    expect(bannerFor(status({ notice_pending: true }), local(), true)).toMatchObject({ kind: "notice", actions: ["ok", "turnOff"] });
    expect(bannerFor(status(), local({ noticeOpen: true }), true)?.kind).toBe("notice");
    expect(bannerFor(status(), local({ noticeOpen: true, noticeDone: true }), true)).toBeNull();
    expect(bannerFor(status({ notice_pending: true, state: "downloading", percent: 5 }), local(), true)?.kind).toBe("notice");
  });

  it("shows download progress, then ready with the caution when work may be open, and a countdown when idle", () => {
    expect(bannerFor(status({ state: "downloading", version: "0.2.0", percent: 42 }), local(), false)).toEqual({ kind: "progress", text: "Downloading… 42%", percent: 42, actions: [] });
    const staged = status({ state: "staged", version: "0.2.0", percent: 100 });
    expect(bannerFor(staged, local(), false)).toEqual({ kind: "ready", text: "Update ready. Restart to finish.", caution: updateCopy.cautionNote, actions: ["restartNow", "later"] });
    expect(bannerFor(staged, local(), true)).toEqual({ kind: "countdown", text: "Updating now.", actions: ["cancel"] });
    expect(bannerFor(staged, local({ cancelled: "0.2.0" }), true)?.kind).toBe("ready");
    expect(bannerFor(staged, local({ dismissed: "0.2.0" }), false)).toBeNull();
    expect(bannerFor(staged, local({ dismissed: "0.1.9" }), false)?.kind, "an old Later does not hide a newer version").toBe("ready");
    expect(bannerFor(status({ state: "installing", version: "0.2.0" }), local(), false)?.kind).toBe("installing");
  });

  it("offers a retry after a failure, and the quiet link only once the shell enables it", () => {
    const failed = status({ state: "failed", version: "0.2.0", error: "install" });
    expect(bannerFor(failed, local(), true)).toEqual({ kind: "failed", text: "Couldn’t update. Try again.", actions: ["updateNow"] });
    expect(bannerFor({ ...failed, linkEnabled: true }, local(), true)?.actions).toEqual(["updateNow", "getFromGitHub"]);
    expect(bannerFor(failed, local({ dismissed: "0.2.0" }), true)).toBeNull();
    expect(bannerFor({ ...failed, linkEnabled: true }, local({ dismissed: "0.2.0" }), true)?.kind, "the link stays reachable").toBe("failed");
  });

  it("says a copy that cannot update itself can only be fetched from GitHub", () => {
    const s = status({ supported: false, version: "0.2.0", error: "unsupported", link_enabled: true });
    expect(bannerFor(s, local(), true)).toEqual({ kind: "unsupported", text: "Snappy 0.2.0 is available. This copy can’t update itself.", actions: ["getFromGitHub"] });
    expect(bannerFor({ ...s, linkEnabled: false }, local(), true)?.actions).toEqual([]);
    expect(bannerFor(status({ supported: false }), local(), true)).toBeNull();
  });

  it("shows the short Updated to message once", () => {
    expect(bannerFor(status(), local({ updatedFor: "0.2.0" }), true)).toEqual({ kind: "updated", text: "Updated to 0.2.0.", actions: [] });
    expect(bannerFor(status(), local({ updatedFor: "0.2.0", updatedShown: true }), true)).toBeNull();
  });

  it("puts only the shell's validated version text in a banner", () => {
    for (const s of [status({ state: "staged", version: "0.2.0" }), status({ state: "failed", version: "0.2.0" })]) {
      const banner = bannerFor(s, local(), false);
      expect(`${banner?.text} ${banner?.caution ?? ""}`).not.toMatch(/[<>&]|https?:/i);
    }
  });
});

describe("what Check now answers", () => {
  it("says up to date, unreachable or could not check, and nothing while the check runs", () => {
    expect(checkResult(status({ state: "checking" }))).toBeNull();
    expect(checkResult(status({ state: "downloading" }))).toBeNull();
    expect(checkResult(status())).toBe("upToDate");
    for (const error of ["offline", "timeout", "status", "policy", "tls", "manifest"]) expect(checkResult(status({ error })), error).toBe("unreachable");
    for (const error of ["busy", "keys", "disk", "signature", "unsupported"]) expect(checkResult(status({ error })), error).toBe("couldNotCheck");
  });

  it("says nothing while a newer version is known, so it never contradicts the banner", () => {
    expect(checkResult(status({ version: "0.2.0" }))).toBeNull();
    expect(checkResult(status({ version: "0.2.0", error: "unsupported" }))).toBeNull();
    expect(checkResult(status({ version: null }))).toBe("upToDate");
  });
});

describe("the page's claim that it is idle", () => {
  it("holds only on the quiet pages, before anything was imported, with no passphrase prompt or busy region", () => {
    for (const hash of ["", "#", "#/", "#/start", "#/privacy", "#/settings"]) expect(pageIsIdle(hash, false, 0), hash).toBe(true);
    for (const hash of ["#/overview", "#/guide", "#/tools", "#/tools/waiting-on-reply", "#/disappeared", "#/memories", "#/start?x=1", "#/settings/x"]) expect(pageIsIdle(hash, false, 0), hash).toBe(false);
    expect(pageIsIdle("#/start", true, 0)).toBe(false);
    expect(pageIsIdle("#/start", false, 1)).toBe(false);
  });
});

describe("the update words", () => {
  const entries = collectCopy({ update: updateCopy });

  it("pass the dashboard's copy rules (whitespace, punctuation, curly quotes, American English, sentence case, lengths)", () => {
    expect(entries.length).toBeGreaterThan(25);
    const problems: string[] = [];
    for (const rule of RULES) {
      // The Privacy paragraph is the owner's own approved wording and longer than a note by design: every rule but its length applies.
      const checked = rule[0] === "maximum lengths" ? entries.filter((e) => !e.id.startsWith("update.privacyBody")) : entries;
      problems.push(...lint(checked, rule));
    }
    expect(problems).toEqual([]);
  });

  it("keep the buttons to one to three words and say what the design says about the privacy facts", () => {
    for (const key of ["updateNowButton", "laterButton", "restartNowButton", "cancelButton", "getFromGitHubButton", "noticeOkButton", "noticeTurnOffButton", "checkNowButton"] as const) {
      expect(updateCopy[key].split(" ").length, key).toBeLessThanOrEqual(3);
    }
    expect(updateCopy.cardNote).toBe("Asks github.com for the newest version. Sends no ID and none of your data.");
    expect(updateCopy.privacyBody).toMatch(/GitHub can see your IP address, the time, and that a Snappy app asked/);
    expect(updateCopy.privacyBody).not.toMatch(/sends nothing about you/i);
    expect(updateCopy.firstRunNotice).toBe("Snappy checks GitHub for updates when it opens. Change this in Settings.");
  });
});
