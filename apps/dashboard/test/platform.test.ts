/**
 * The platform seam (src/platform.ts): what a native shell may change, and proof that with nothing set the
 * page behaves exactly as the plain web build always did. Every test puts the platform back to empty.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions, NamedBlob } from "../src/actions.ts";
import { privacy, start } from "../src/copy.ts";
import type { ImportRunner } from "../src/import-pipeline.ts";
import { importRunner, platform, setPlatform } from "../src/platform.ts";
import { initialState } from "../src/reducer.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { createStore } from "../src/store.ts";
import type { View } from "../src/views/context.ts";
import { FakeElement, installFakeDom } from "./fake-dom.ts";
import { testTerminal } from "./terminal-fixture.ts";

vi.mock("snappy:licenses", () => ({ licenses: [] }));
vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

let startView: View;
let privacyView: View;
let profileLink: (username: string) => FakeElement | null;

beforeAll(async () => {
  installFakeDom();
  startView = ((await import("../src/views/start.ts")) as { startView: View }).startView;
  privacyView = ((await import("../src/views/privacy.ts")) as { privacyView: View }).privacyView;
  profileLink = ((await import("../src/components/button.ts")) as unknown as { profileLink: (u: string) => FakeElement | null }).profileLink;
});

afterEach(() => setPlatform({}));

const file = (name: string): NamedBlob => ({ name, size: 3, type: "application/zip" }) as unknown as NamedBlob;

function renderStart(importZips: Actions["importZips"]): { root: FakeElement; chooser: FakeElement; picker: FakeElement } {
  const store = createStore(initialState());
  const actions = { importZips } as unknown as Actions;
  const root = runInScope(new Scope(true), () => startView({ store, actions, terminal: testTerminal() })) as unknown as FakeElement;
  const chooser = root.querySelector("button[data-key=choose-files]");
  const picker = root.querySelector("input[type=file]");
  if (!chooser || !picker) throw new Error("the Start page has no chooser or no file input");
  return { root, chooser, picker };
}

const renderPrivacy = (): FakeElement => runInScope(new Scope(true), () => privacyView({ store: createStore(initialState()), actions: {} as Actions, terminal: testTerminal() })) as unknown as FakeElement;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("with no platform set (the web build)", () => {
  it("starts empty", () => {
    expect(platform()).toEqual({});
  });

  it("opens the browser's own file input at once when Choose is pressed, inside the click", () => {
    const importZips = vi.fn(async () => "failed" as const);
    const { chooser, picker } = renderStart(importZips);
    const click = vi.fn();
    picker.click = click;
    chooser.click();
    // Synchronous: a browser only opens a file dialog from inside the person's own click.
    expect(click).toHaveBeenCalledTimes(1);
    expect(importZips).not.toHaveBeenCalled();
  });

  it("shows no desktop note on the Privacy page and keeps the developer tools hint", () => {
    const text = renderPrivacy().textContent;
    expect(text).not.toContain(privacy.desktopHeading);
    expect(text).not.toContain(privacy.desktopOwnPage);
    expect(text).toContain(privacy.networkDetail);
  });

  it("links a username to its Snapchat profile in a new tab", () => {
    const link = profileLink("alice");
    expect(link?.getAttribute("href")).toBe("https://www.snapchat.com/add/alice");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("hands the import to the page's own runner", async () => {
    const own = vi.fn(async () => ({ marker: "own" }) as never) as unknown as ImportRunner;
    await expect(importRunner(own)([], {} as never)).resolves.toEqual({ marker: "own" });
  });
});

describe("with a shell that picks and reads the files", () => {
  it("imports what the shell's dialog returned, and never opens the file input", async () => {
    const importZips = vi.fn(async () => "failed" as const);
    const picked = [file("mydata~1.zip"), file("mydata~1-2.zip")];
    setPlatform({ pickZips: async () => picked });
    const { chooser, picker } = renderStart(importZips);
    const click = vi.fn();
    picker.click = click;
    chooser.click();
    await settle();
    expect(importZips).toHaveBeenCalledWith(picked);
    expect(click).not.toHaveBeenCalled();
  });

  it("does nothing when the person cancels the shell's dialog", async () => {
    const importZips = vi.fn(async () => "failed" as const);
    setPlatform({ pickZips: async () => [] });
    const { chooser, picker } = renderStart(importZips);
    const click = vi.fn();
    picker.click = click;
    chooser.click();
    await settle();
    expect(importZips).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("falls back to the file input when the shell declines (null) or fails", async () => {
    for (const pickZips of [async () => null, async () => Promise.reject(new Error("no dialog"))]) {
      const importZips = vi.fn(async () => "failed" as const);
      setPlatform({ pickZips });
      const { chooser, picker } = renderStart(importZips);
      const click = vi.fn();
      picker.click = click;
      chooser.click();
      await settle();
      expect(click).toHaveBeenCalledTimes(1);
      expect(importZips).not.toHaveBeenCalled();
    }
  });

  it("uses the shell's reader, chosen on each call, and not the page's", async () => {
    const own = vi.fn() as unknown as ImportRunner;
    const runner = importRunner(own);
    const shell = vi.fn(async () => ({ marker: "shell" }) as never) as unknown as ImportRunner;
    setPlatform({ runImport: shell });
    await expect(runner([], {} as never)).resolves.toEqual({ marker: "shell" });
    expect(own).not.toHaveBeenCalled();
    setPlatform({});
    const back = vi.fn(async () => ({ marker: "own" }) as never) as unknown as ImportRunner;
    await expect(importRunner(back)([], {} as never)).resolves.toEqual({ marker: "own" });
  });
});

describe("with the desktop app", () => {
  it("adds its note to the Privacy page on Windows: its own page, and what was and was not checked", () => {
    setPlatform({ desktop: "windows" });
    const el = renderPrivacy();
    const text = el.textContent;
    expect(el.querySelectorAll("h3.subheading").map((h) => h.textContent)).toContain(privacy.desktopHeading);
    for (const line of [privacy.desktopOwnPage, privacy.desktopWindows, privacy.desktopWindowsTest, privacy.desktopWindowsOff]) expect(text).toContain(line);
    expect(text).not.toContain(privacy.desktopOther);
    // The browser's developer tools do not exist in the app, so that line goes.
    expect(text).not.toContain(privacy.networkDetail);
    // The wording is hedged: one test, one computer, and a promise of nothing after an update.
    expect(privacy.desktopWindowsTest).toMatch(/one test on one computer/);
    expect(privacy.desktopWindowsOff).toMatch(/could change/);
  });

  it("adds the macOS note: the system WebKit view, one automated test, and its limits, with no WebView2 words", () => {
    setPlatform({ desktop: "macos" });
    const text = renderPrivacy().textContent;
    for (const line of [privacy.desktopOwnPage, privacy.desktopMac, privacy.desktopMacTest, privacy.desktopMacLimit]) expect(text).toContain(line);
    expect(text).not.toContain(privacy.desktopWindows);
    expect(text).not.toContain(privacy.desktopOther);
    expect(text).not.toContain(privacy.networkDetail);
    expect(text).not.toMatch(/WebView2|Microsoft/);
    // Hedged: one automated test on a build computer, a separate component Snappy does not control, and a system update can change it.
    expect(privacy.desktopMacTest).toMatch(/one automated test on a build computer/);
    expect(privacy.desktopMac).toMatch(/Snappy does not control/);
    expect(privacy.desktopMacLimit).toMatch(/cannot see everything/);
    expect(privacy.desktopMacLimit).toMatch(/can change/);
  });

  it("says only that the engine was not checked on other systems", () => {
    setPlatform({ desktop: "other" });
    const text = renderPrivacy().textContent;
    expect(text).toContain(privacy.desktopOwnPage);
    expect(text).toContain(privacy.desktopOther);
    expect(text).not.toContain(privacy.desktopWindows);
    expect(text).not.toContain("WebView2");
  });

  it("takes the Snapchat profile buttons away when the shell says so", () => {
    setPlatform({ desktop: "windows", profileLinks: false });
    expect(profileLink("alice")).toBeNull();
    setPlatform({ profileLinks: true });
    expect(profileLink("alice")).not.toBeNull();
  });

  it("keeps the Start page's own words", () => {
    setPlatform({ desktop: "windows", profileLinks: false });
    expect(renderStart(vi.fn()).root.textContent).toContain(start.choose);
  });
});
