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
import { updateA11yCopy as spoken } from "./update-copy-a11y.ts";
import { actionAriaLabel, bannerFor, bannerSignature, checkResult, crossedHalfway, freshLocal, isQuietRoute, pageIsIdle, sanitizeStatus } from "./update-model.ts";
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
/** A request ("Check now", "Update now") is shown as under way until the shell is seen working on it, or this long has passed. */
const PENDING_MS = 5000;
const POLL_PENDING_MS = 400;

/**
 * A request the person made that the shell has not visibly taken up yet. The shell does its work on another thread, so right
 * after the request it can still say "idle". The request stays pending until the shell was seen working and is done, or
 * its "last checked" time moved, or a few seconds passed (a check that is refused or ends at once changes neither).
 */
interface Pending {
  until: number;
  sawBusy: boolean;
  last: number;
}

const startPending = (status: UpdateStatus | null): Pending => ({ until: Date.now() + PENDING_MS, sawBusy: false, last: status?.lastCheckedUnix ?? 0 });

function settle(pending: Pending | null, status: UpdateStatus): Pending | null {
  if (!pending) return null;
  const busy = status.state === "checking" || status.state === "downloading" || status.state === "installing";
  if (busy) pending.sawBusy = true;
  const done = (pending.sawBusy && !busy) || status.lastCheckedUnix !== pending.last || Date.now() >= pending.until;
  return done ? null : pending;
}

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
  let checking: Pending | null = null; // "Check now" was pressed and has not ended yet
  let updating: Pending | null = null; // "Update now" was pressed and the shell has not taken it up yet
  let result: ReturnType<typeof checkResult> = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let countdownTimer: ReturnType<typeof setTimeout> | undefined;
  let countdownFor: string | null = null;
  let shown = "";

  // tabindex -1: a place for focus to go when the button that had it is replaced (see paintBanner).
  const slot = h("div", { class: "update-slot", role: "status", "aria-live": "polite", tabindex: "-1" });
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
        updating = startPending(status);
        paintBanner(); // "Checking…" at once, not after the shell's first answer
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
    return button({ label, variant: primary ? "primary" : "secondary", key: `update:${action}`, className: "update-action", ariaLabel: actionAriaLabel(action), onclick: () => void act(action) });
  };

  /** The parts of the download banner that change while it stays on screen (see paintBanner). */
  interface DownloadParts {
    text: HTMLElement;
    bar: HTMLElement;
    fill: HTMLElement;
  }
  let download: DownloadParts | null = null;
  let lastPercent: number | null = null;

  const showPercent = (parts: DownloadParts, banner: Banner): void => {
    parts.text.textContent = banner.text;
    parts.bar.setAttribute("aria-valuenow", String(banner.percent));
    setVar(parts.fill, "--update-progress", `${banner.percent}%`);
  };

  /**
   * The text that carries the percent is hidden from assistive technology and changed in place; the bar is a progress bar
   * whose value changes in place; the words a screen reader hears when the banner appears never contain the percent.
   */
  const downloadElements = (banner: Banner): { text: HTMLElement; bar: HTMLElement } => {
    const fill = h("div", { class: "update-bar-fill" });
    const shownText = h("span", { class: "update-percent", "aria-hidden": "true" });
    const bar = h("div", { class: "update-bar", role: "progressbar", "aria-label": spoken.downloadingLive, "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
    download = { text: shownText, bar, fill };
    showPercent(download, banner);
    return { text: h("p", { class: "banner-text update-text" }, shownText, h("span", { class: "sr-only" }, spoken.downloadingLive)), bar };
  };

  const bannerElement = (banner: Banner): HTMLElement => {
    download = null;
    const downloading = banner.percent === undefined ? null : downloadElements(banner);
    return h(
      "div",
      { class: `banner update-banner update-${banner.kind}` },
      h(
        "div",
        { class: "update-main" },
        downloading ? downloading.text : h("p", { class: "banner-text update-text" }, banner.text),
        banner.caution ? h("p", { class: "caption update-caution" }, banner.caution) : null,
        downloading ? downloading.bar : null,
        banner.kind === "countdown" ? h("div", { class: "update-wait", role: "presentation" }) : null,
      ),
      banner.actions.length ? h("div", { class: "update-actions" }, ...banner.actions.map(actionButton)) : null,
    );
  };

  const paintBanner = (): void => {
    const base = status ? bannerFor(status, local, idle()) : null;
    // While "Update now" has not been taken up yet, the banner already says so instead of offering the same button again.
    const banner: Banner | null = updating && base && (base.kind === "available" || base.kind === "failed") ? { kind: "progress", text: copy.checkingLabel, actions: [] } : base;
    const signature = bannerSignature(banner);
    // Half way through a download is said once; a banner first seen past half says nothing.
    const percent = banner?.percent;
    if (percent !== undefined && crossedHalfway(lastPercent, percent)) announce(spoken.halfwayAnnounce);
    lastPercent = percent ?? null;
    // A new percent changes the bar and its text in place. The banner is not rebuilt, so the live region does not repeat it.
    if (signature === shown && banner && download) {
      showPercent(download, banner);
      return;
    }
    if (signature === shown) return;
    const active = document.activeElement;
    const hadFocus = active instanceof HTMLElement && slot.contains(active);
    const focused = hadFocus ? active.dataset.key : undefined;
    shown = signature;
    slot.replaceChildren(...(banner ? [bannerElement(banner)] : []));
    // Keep focus where the person had it. If that button is gone, focus moves to the banner's place (or to the page's main
    // area when there is no banner), never back to the top of the document. A banner never takes focus that was elsewhere.
    if (hadFocus) {
      const same = focused ? slot.querySelector<HTMLElement>(`[data-key="${focused}"]`) : null;
      (same ?? (banner ? slot : document.getElementById("main")))?.focus();
    }
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
  // aria-disabled, not disabled, while a check runs: a disabled button loses the keyboard focus it has.
  const cardCheck = button({ label: copy.checkNowButton, key: "update:check-now", onclick: () => {
    if (cardCheck.getAttribute("aria-disabled") !== "true") void checkNow();
  } });
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
    const busy = checking !== null || status.state === "checking" || status.state === "downloading";
    if (busy) cardCheck.setAttribute("aria-disabled", "true");
    else cardCheck.removeAttribute("aria-disabled");
    cardCheck.querySelector("span")?.replaceChildren(busy ? copy.checkingLabel : copy.checkNowButton);
    cardResult.textContent = !busy && result ? { upToDate: copy.upToDateNote, unreachable: copy.unreachableNote, couldNotCheck: copy.couldNotCheckNote }[result] : "";
  };

  const checkNow = async (): Promise<void> => {
    checking = startPending(status);
    result = null;
    paintCard();
    await bridge.check();
    schedule(POLL_PENDING_MS);
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
    if (checking) {
      // The shell may not have started yet ("idle" right after the request): the result is shown only once the shell was
      // seen working and is done, or its "last checked" time moved, or a few seconds passed.
      checking = settle(checking, status);
      if (!checking) result = checkResult(status);
    }
    updating = settle(updating, status);
    // Showing the first-run notice is what tells the shell it was shown: it then allows automatic checks from the next launch.
    if (first && status.noticePending) {
      local = { ...local, noticeOpen: true };
      await bridge.setAuto(status.auto);
    }
    paintBanner();
    paintCard();
    inject();
    if (checking || updating) schedule(POLL_PENDING_MS);
    else if (status.state === "checking" || status.state === "downloading" || status.state === "installing") schedule(POLL_BUSY_MS);
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
