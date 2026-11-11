/**
 * What the page knows about updates and what it shows for it, as plain functions with no DOM.
 *
 * The status comes from the shell (`update_status`). It is checked here again: only the known fields, only the known
 * words, version text only in the plain `x.y.z` shape, a percent only as a whole number. Anything else is refused as a
 * whole. Nothing from the network can reach this code (the shell never passes any), and nothing in the export can
 * reach it either.
 */
import { updateCopy as copy } from "./update-copy.ts";
import { updateA11yCopy as spoken } from "./update-copy-a11y.ts";

export type UpdateState = "idle" | "checking" | "downloading" | "staged" | "installing" | "failed";
export type UpdateError = "offline" | "timeout" | "status" | "policy" | "tls" | "manifest" | "size" | "signature" | "disk" | "install" | "busy" | "unsupported" | "keys";

const STATES: readonly string[] = ["idle", "checking", "downloading", "staged", "installing", "failed"];
const ERRORS: readonly string[] = ["offline", "timeout", "status", "policy", "tls", "manifest", "size", "signature", "disk", "install", "busy", "unsupported", "keys"];
/**
 * Errors that mean "could not talk to GitHub", as opposed to something this copy did itself. A reply that is not the file
 * ("status", such as the 404 before the first release exists) is not in the list: GitHub was reached, so "Can’t reach GitHub."
 * would be wrong, and the calm "Couldn’t check. Try again." is true.
 */
const UNREACHABLE: readonly string[] = ["offline", "timeout", "policy", "tls", "manifest"];
const PLAIN_VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const CURRENT_VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}(-[0-9A-Za-z.-]{1,32})?$/;

export interface UpdateStatus {
  state: UpdateState;
  percent: number;
  version: string | null;
  current: string;
  auto: boolean;
  lastCheckedUnix: number;
  noticePending: boolean;
  linkEnabled: boolean;
  supported: boolean;
  error: UpdateError | null;
  updatedTo: string | null;
}

const KEYS = ["state", "percent", "version", "current", "auto", "last_checked_unix", "notice_pending", "link_enabled", "supported", "error", "updated_to"];

/** The shell's answer, or null when it is not exactly what the shell sends. */
export function sanitizeStatus(raw: unknown): UpdateStatus | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).length !== KEYS.length || !KEYS.every((k) => Object.hasOwn(o, k))) return null;
  const text = (v: unknown, shape: RegExp): string | null | undefined => (v === null ? null : typeof v === "string" && shape.test(v) ? v : undefined);
  const version = text(o.version, PLAIN_VERSION);
  const updatedTo = text(o.updated_to, PLAIN_VERSION);
  const current = text(o.current, CURRENT_VERSION);
  const state = typeof o.state === "string" && STATES.includes(o.state) ? (o.state as UpdateState) : null;
  const error = o.error === null ? null : typeof o.error === "string" && ERRORS.includes(o.error) ? (o.error as UpdateError) : undefined;
  const whole = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);
  const percent = whole(o.percent, 100);
  const last = whole(o.last_checked_unix, 4_102_444_800);
  const flags = ["auto", "notice_pending", "link_enabled", "supported"].map((k) => o[k]);
  if (version === undefined || updatedTo === undefined || typeof current !== "string" || state === null || error === undefined || percent === null || last === null || !flags.every((f) => typeof f === "boolean")) return null;
  return {
    state,
    percent,
    version,
    current,
    auto: o.auto as boolean,
    lastCheckedUnix: last,
    noticePending: o.notice_pending as boolean,
    linkEnabled: o.link_enabled as boolean,
    supported: o.supported as boolean,
    error,
    updatedTo,
  };
}

export type BannerAction = "updateNow" | "later" | "restartNow" | "cancel" | "getFromGitHub" | "ok" | "turnOff";
export type BannerKind = "notice" | "updated" | "progress" | "ready" | "countdown" | "installing" | "failed" | "unsupported" | "available";

export interface Banner {
  kind: BannerKind;
  text: string;
  /** The second line shown when a restart could lose work. */
  caution?: string;
  /** A percent for the progress bar. */
  percent?: number;
  actions: readonly BannerAction[];
}

/** What the person has already answered on this screen, kept by the page and never sent anywhere. */
export interface Local {
  /** The first-run notice is on screen: it stays until it is answered, although the shell stops reporting it as pending. */
  noticeOpen: boolean;
  /** The first-run notice was answered. */
  noticeDone: boolean;
  /** The version of the short "Updated to" message, kept here because the shell reports it only once. */
  updatedFor: string | null;
  /** "Later" was chosen for this version. */
  dismissed: string | null;
  /** "Cancel" was chosen on the countdown for this version. */
  cancelled: string | null;
  /** The short "Updated to" message was shown. */
  updatedShown: boolean;
}

export const freshLocal = (): Local => ({ noticeOpen: false, noticeDone: false, updatedFor: null, dismissed: null, cancelled: null, updatedShown: false });

/**
 * The one banner to show, or null. `idle` is the page's own claim that nothing is in progress (see `pageIsIdle`).
 * The order matters: the first-run notice comes first, then what is happening now, then what is waiting.
 */
export function bannerFor(status: UpdateStatus, local: Local, idle: boolean): Banner | null {
  const v = status.version;
  if ((status.noticePending || local.noticeOpen) && !local.noticeDone) return { kind: "notice", text: copy.firstRunNotice, actions: ["ok", "turnOff"] };
  if (local.updatedFor && !local.updatedShown) return { kind: "updated", text: copy.updatedToBanner(local.updatedFor), actions: [] };
  switch (status.state) {
    case "downloading":
      return { kind: "progress", text: copy.downloadingBanner(status.percent), percent: status.percent, actions: [] };
    case "installing":
      return { kind: "installing", text: copy.installingBanner, actions: [] };
    case "staged":
      if (local.dismissed === v) return null;
      if (idle && local.cancelled !== v) return { kind: "countdown", text: copy.countdownBanner, actions: ["cancel"] };
      return { kind: "ready", text: copy.readyBanner, caution: copy.cautionNote, actions: ["restartNow", "later"] };
    case "failed":
      if (local.dismissed === v && !status.linkEnabled) return null;
      return { kind: "failed", text: copy.failedBanner, actions: status.linkEnabled ? ["updateNow", "getFromGitHub"] : ["updateNow"] };
    default:
      break;
  }
  if (!status.supported && v) return { kind: "unsupported", text: `${copy.availableBanner(v)} ${copy.unsupportedNote}`, actions: status.linkEnabled ? ["getFromGitHub"] : [] };
  if (v && local.dismissed !== v) return { kind: "available", text: copy.availableBanner(v), actions: ["updateNow", "later"] };
  return null;
}

/**
 * The accessible name of a banner button whose visible label needs context, or undefined when the label is enough
 * ("Update now", "Restart now", "Check now" say what they do). A name always contains the visible label.
 */
export function actionAriaLabel(action: BannerAction): string | undefined {
  return action === "turnOff" ? spoken.turnOffName : undefined;
}

/**
 * What identifies a banner for repainting. A percent is not part of it, and neither is the text that carries the percent:
 * a download that moves from 42 to 43 percent is the same banner, changed in place, so a screen reader is not told again
 * at every step. The banner is rebuilt (and read out) only when its kind, its words or its buttons change.
 */
export function bannerSignature(banner: Banner | null): string {
  if (!banner) return "";
  const words = banner.percent === undefined ? banner.text : "";
  return `${banner.kind}|${words}|${banner.actions.join(",")}`;
}

/** True once, when a download that was seen below half has reached half or more. A banner first seen past half says nothing. */
export const crossedHalfway = (previous: number | null, next: number): boolean => previous !== null && previous < 50 && next >= 50;

/** What "Check now" answers once the check has ended. */
export function checkResult(status: UpdateStatus): "upToDate" | "unreachable" | "couldNotCheck" | null {
  if (status.state === "checking" || status.state === "downloading") return null;
  // A newer version is known (the banner says so): "You’re up to date." would contradict it.
  if (status.version !== null) return null;
  if (status.error === null) return "upToDate";
  return UNREACHABLE.includes(status.error) ? "unreachable" : "couldNotCheck";
}

/** A request ("Check now", "Update now") is shown as under way until the shell is seen working on it, or this long has passed. */
export const PENDING_MS = 5000;
/** The shortest time a request is shown as under way. After it, a shell that is idle again has already finished. */
export const PENDING_MIN_MS = 600;

/**
 * A request the person made that the shell has not visibly taken up yet. The shell does its work on another thread, so right
 * after the request it can still say "idle". The request stays pending until the shell was seen working and is done, or its
 * "last checked" time moved, or the shell is idle after a short minimum (a check that fails at once is never seen working and
 * moves nothing), or a few seconds passed as the last resort (a refused check).
 */
export interface Pending {
  until: number;
  minUntil: number;
  sawBusy: boolean;
  last: number;
}

export const startPending = (status: UpdateStatus | null, now: number = Date.now()): Pending => ({ until: now + PENDING_MS, minUntil: now + PENDING_MIN_MS, sawBusy: false, last: status?.lastCheckedUnix ?? 0 });

export function settle(pending: Pending | null, status: UpdateStatus, now: number = Date.now()): Pending | null {
  if (!pending) return null;
  const busy = status.state === "checking" || status.state === "downloading" || status.state === "installing";
  if (busy) pending.sawBusy = true;
  const done = (pending.sawBusy && !busy) || status.lastCheckedUnix !== pending.last || (!busy && now >= pending.minUntil) || now >= pending.until;
  return done ? null : pending;
}

/** Pages where nothing of the person's is in progress. Any other page may hold results, a running command or a passphrase prompt. */
const QUIET_ROUTES = new Set(["", "#", "#/", "#/start", "#/privacy", "#/settings"]);

/**
 * The page's claim that nothing is in progress: the person has not started an import, has not left the quiet pages,
 * and no passphrase prompt or busy region is on screen. The shell adds the checks it can make itself (a picked file in
 * use, a recent read, another copy running). This is deliberately cautious: once a session has been used, the
 * update waits for the next launch or for "Restart now".
 */
export function pageIsIdle(hash: string, touched: boolean, busyMarkers: number): boolean {
  return !touched && QUIET_ROUTES.has(hash) && busyMarkers === 0;
}

export const isQuietRoute = (hash: string): boolean => QUIET_ROUTES.has(hash);
