/**
 * The update interface of the desktop app: a banner at the top of the page, an "Updates" card in Settings, a block on the
 * Privacy page and a one-time notice. It exists only in the desktop entry (update-entry.ts); the web build never imports
 * this file, so the web page is unchanged by it.
 *
 * It is added to the dashboard's pages from the outside, so the dashboard's own code does not change: the banner has a
 * place of its own at the top of the main area, and the card and the block are inserted into the Settings and Privacy
 * pages when those are on screen (found by their headings).
 *
 * Safety: every piece of text is a fixed string from update-copy.ts, set with textContent through the dashboard's `h`
 * helper. The only changing values are the shell's checked version text and a whole-number percent. The page asks the
 * shell five fixed questions and passes nothing but two booleans. It never builds an address and never reads one.
 */
import { button } from "../../dashboard/src/components/button.ts";
import { section, subsection } from "../../dashboard/src/components/layout.ts";
import { privacy, settings } from "../../dashboard/src/copy.ts";
import { h, setVar } from "../../dashboard/src/dom.ts";
import { announce } from "../../dashboard/src/announce.ts";
import { updateCopy as copy } from "./update-copy.ts";
import { bannerFor, checkResult, freshLocal, isQuietRoute, pageIsIdle, sanitizeStatus } from "./update-model.ts";
import type { Banner, BannerAction, UpdateStatus } from "./update-model.ts";

/** The shell's `invoke`, narrowed to what is used here (and replaceable in tests). */
export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The five questions the page may ask. Nothing else is ever sent. */
export interface Bridge {
  status(): Promise<UpdateStatus | null>;
  check(): Promise<void>;
  /** True when the shell accepted. False for "finish first" or any refusal. */
  install(idle: boolean): Promise<boolean>;
  setAuto(auto: boolean): Promise<void>;
  openReleases(): Promise<void>;
}

export function createBridge(invoke: Invoke): Bridge {
  const quiet = async (command: string, args?: Record<string, unknown>): Promise<boolean> => {
    try {
      await invoke(command, args);
      return true;
    } catch {
      return false;
    }
  };
  return {
    async status() {
      try {
        return sanitizeStatus(await invoke("update_status"));
      } catch {
        return null; // not running inside the desktop app: there is nothing to show
      }
    },
    check: async () => void (await quiet("update_check")),
    install: (idle) => quiet("update_install", { idle }),
    setAuto: async (auto) => void (await quiet("update_set_auto", { auto })),
    openReleases: async () => void (await quiet("update_open_releases")),
  };
}

/** Seconds the "Updating now" banner waits, so the person can cancel. */
export const COUNTDOWN_MS = 5000;
const POLL_BUSY_MS = 1000;
const POLL_LAUNCH_MS = 5000;
const POLL_LAUNCH_WINDOW_MS = 60_000;
const UPDATED_TOAST_MS = 6000;

export interface Mounted {
  /** Asks the shell for its status and repaints. */
  refresh(): Promise<void>;
}

const sectionWithHeading = (root: ParentNode, heading: string): HTMLElement | null => {
  for (const title of root.querySelectorAll("section.section > h2.section-title")) {
    if (title.textContent === heading) return title.parentElement;
  }
  return null;
};

export function mountUpdates(bridge: Bridge): Mounted {
  const startedAt = Date.now();
  let status: UpdateStatus | null = null;
  let local = freshLocal();
  let touched = false;
  let checking = false; // "Check now" was pressed and has not ended yet
  let result: ReturnType<typeof checkResult> = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let countdownTimer: ReturnType<typeof setTimeout> | undefined;
  let countdownFor: string | null = null;
  let shown = "";

  const slot = h("div", { class: "update-slot", role: "status", "aria-live": "polite" });
  document.getElementById("main")?.prepend(slot);

  // ---- the idle claim -------------------------------------------------------------------------------------------
  const idle = (): boolean => pageIsIdle(location.hash, touched, document.querySelectorAll('input[type="password"], [aria-busy="true"]').length);
  // An import started from a file input or a drop means results will be on the page.
  document.addEventListener("change", (e) => (touched ||= e.target instanceof HTMLInputElement && e.target.type === "file"), true);
  document.addEventListener("drop", () => (touched = true), true);

  // ---- banner ----------------------------------------------------------------------------------------------------
  const act = async (action: BannerAction): Promise<void> => {
    const version = status?.version ?? null;
    switch (action) {
      case "ok":
        local = { ...local, noticeDone: true };
        break;
      case "turnOff":
        local = { ...local, noticeDone: true };
        await bridge.setAuto(false);
        break;
      case "later":
        local = { ...local, dismissed: version };
        break;
      case "cancel":
        local = { ...local, cancelled: version };
        break;
      case "updateNow":
        await bridge.check();
        break;
      case "restartNow":
        if (!(await bridge.install(idle()))) announce(copy.busyNote);
        break;
      case "getFromGitHub":
        await bridge.openReleases();
        break;
    }
    await refresh();
  };

  const actionButton = (action: BannerAction): HTMLElement => {
    const label = { ok: copy.noticeOkButton, turnOff: copy.noticeTurnOffButton, later: copy.laterButton, cancel: copy.cancelButton, updateNow: copy.updateNowButton, restartNow: copy.restartNowButton, getFromGitHub: copy.getFromGitHubButton }[action];
    const primary = action === "updateNow" || action === "restartNow" || action === "ok";
    return button({ label, variant: primary ? "primary" : "secondary", key: `update:${action}`, className: "update-action", onclick: () => void act(action) });
  };

  const bannerElement = (banner: Banner): HTMLElement => {
    const bar = banner.percent === undefined ? null : h("div", { class: "update-bar", role: "presentation" }, (() => {
      const fill = h("div", { class: "update-bar-fill" });
      setVar(fill, "--update-progress", `${banner.percent}%`);
      return fill;
    })());
    return h(
      "div",
      { class: `banner update-banner update-${banner.kind}` },
      h(
        "div",
        { class: "update-main" },
        h("p", { class: "banner-text update-text" }, banner.text),
        banner.caution ? h("p", { class: "caption update-caution" }, banner.caution) : null,
        bar,
        banner.kind === "countdown" ? h("div", { class: "update-wait", role: "presentation" }) : null,
      ),
      banner.actions.length ? h("div", { class: "update-actions" }, ...banner.actions.map(actionButton)) : null,
    );
  };

  const paintBanner = (): void => {
    const banner = status ? bannerFor(status, local, idle()) : null;
    const signature = banner ? `${banner.kind}|${banner.text}|${banner.percent ?? ""}|${banner.actions.join(",")}` : "";
    if (signature === shown) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
    shown = signature;
    slot.replaceChildren(...(banner ? [bannerElement(banner)] : []));
    // Keep focus where the person had it if the same button exists again; never move focus to the banner.
    if (focused?.startsWith("update:")) slot.querySelector<HTMLElement>(`[data-key="${focused}"]`)?.focus();
    // The countdown applies the update itself unless it is cancelled, left, or no longer idle.
    clearTimeout(countdownTimer);
    countdownFor = null;
    if (banner?.kind === "countdown" && status?.version) {
      countdownFor = status.version;
      countdownTimer = setTimeout(() => {
        if (countdownFor && idle()) void bridge.install(true).then(() => refresh());
        else void refresh();
      }, COUNTDOWN_MS);
    }
    if (banner?.kind === "updated") {
      setTimeout(() => {
        local = { ...local, updatedShown: true };
        paintBanner();
      }, UPDATED_TOAST_MS);
    }
  };

  // ---- Settings card -----------------------------------------------------------------------------------------------
  const cardVersion = h("p", { class: "caption" });
  const cardLast = h("p", { class: "caption" });
  const cardResult = h("p", { class: "update-result", role: "status", "aria-live": "polite" });
  const cardCheck = button({ label: copy.checkNowButton, key: "update:check-now", onclick: () => void checkNow() });
  const cardToggle = h("input", { type: "checkbox", class: "check-input", role: "switch", id: "update-auto", "data-key": "update:auto" });
  cardToggle.addEventListener("change", () => void bridge.setAuto(cardToggle.checked).then(() => refresh()));
  const card = section(
    copy.cardHeading,
    cardVersion,
    h("div", { class: "actions" }, cardCheck),
    h("label", { class: "check", for: "update-auto" }, cardToggle, h("span", {}, copy.toggleLabel)),
    cardLast,
    cardResult,
    h("p", {}, copy.cardNote),
  );
  card.classList.add("update-card");

  const whenText = (unix: number): string => {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(unix * 1000));
    } catch {
      return new Date(unix * 1000).toISOString();
    }
  };

  const paintCard = (): void => {
    if (!status) return;
    cardVersion.textContent = copy.versionLabel(status.current);
    cardLast.textContent = status.lastCheckedUnix > 0 ? copy.lastChecked(whenText(status.lastCheckedUnix)) : copy.neverChecked;
    cardToggle.checked = status.auto;
    const busy = checking || status.state === "checking" || status.state === "downloading";
    cardCheck.disabled = busy;
    cardCheck.querySelector("span")?.replaceChildren(busy ? copy.checkingLabel : copy.checkNowButton);
    cardResult.textContent = !busy && result ? { upToDate: copy.upToDateNote, unreachable: copy.unreachableNote, couldNotCheck: copy.couldNotCheckNote }[result] : "";
  };

  const checkNow = async (): Promise<void> => {
    checking = true;
    result = null;
    paintCard();
    await bridge.check();
    schedule(300);
  };

  // ---- Privacy block -----------------------------------------------------------------------------------------------
  const privacyBlock = subsection(copy.privacyHeading, h("p", {}, copy.privacyBody));
  privacyBlock.classList.add("update-privacy");

  /** Puts the card and the block into the Settings and Privacy pages when they are on screen. Safe to call often. */
  const inject = (): void => {
    const view = document.querySelector("#main .outlet .view");
    if (!view) return;
    if (location.hash === "#/settings" && !view.contains(card)) {
      const cols = view.querySelector(".cols");
      cols?.insertBefore(card, sectionWithHeading(cols, settings.aboutHeading));
      paintCard();
    }
    if (location.hash === "#/privacy" && !view.contains(privacyBlock)) sectionWithHeading(view, privacy.networkHeading)?.appendChild(privacyBlock);
  };
  new MutationObserver(inject).observe(document.getElementById("main") ?? document.body, { childList: true, subtree: true });

  // ---- status ------------------------------------------------------------------------------------------------------
  async function refresh(): Promise<void> {
    clearTimeout(pollTimer);
    const next = await bridge.status();
    if (next === null) return; // not inside the desktop app, or the shell answered something unexpected: show nothing
    const first = status === null;
    status = next;
    if (next.updatedTo && !local.updatedFor) local = { ...local, updatedFor: next.updatedTo };
    if (checking && status.state !== "checking") {
      // The shell may not have started yet: wait for a result only once it has a "last checked" or an error to show.
      checking = false;
      result = checkResult(status);
    }
    // Showing the first-run notice is what tells the shell it was shown: it then allows automatic checks from the next launch.
    if (first && status.noticePending) {
      local = { ...local, noticeOpen: true };
      await bridge.setAuto(status.auto);
    }
    paintBanner();
    paintCard();
    inject();
    if (status.state === "checking" || status.state === "downloading" || status.state === "installing" || checking) schedule(POLL_BUSY_MS);
    else if (Date.now() - startedAt < POLL_LAUNCH_WINDOW_MS) schedule(POLL_LAUNCH_MS);
  }

  function schedule(ms: number): void {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void refresh(), ms);
  }

  window.addEventListener("hashchange", () => {
    if (!isQuietRoute(location.hash)) touched = true;
    inject();
    paintBanner();
    void refresh();
  });
  window.addEventListener("focus", () => void refresh());
  void refresh();
  return { refresh };
}
