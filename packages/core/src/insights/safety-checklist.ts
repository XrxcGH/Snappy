import type { ParsedFriends } from "../types.ts";
import { DAY_MS, normUser } from "../util.ts";

/**
 * Account safety checklist.
 *
 * Every item is something the user does inside the Snapchat app. Snappy never sees settings and
 * never reads login history, so each tick is SELF-REPORTED: nothing here is verified, and the
 * result says so with `selfReported: true`. The only data-driven hints are two counts taken from
 * the friends file (blocked people and pending requests). The result holds no usernames at all.
 *
 * Output is structured: stable ids, status values and note codes. The CLI and dashboard turn
 * them into wording. Item ids are part of the API because the UI stores ticks under them.
 */

/** Stable ids, in display order. Never rename or reuse one; add new ids at the end. */
export const SAFETY_ITEM_IDS = [
  "two-step-verification",
  "recovery-contacts",
  "strong-password",
  "connected-apps",
  "who-can-contact-you",
  "blocked-list",
  "logged-in-devices",
] as const;

export type SafetyItemId = (typeof SAFETY_ITEM_IDS)[number];

const BLOCKED_BASE = "Check that the people you blocked are the ones you meant to.";
const PENDING_BASE = "Set who can send you Snaps and friend requests.";

/**
 * What each item asks, in a short label and one hint line. This is the one source of the words: the
 * command line and the dashboard's Safety checklist page both read them from here. The two counts the
 * export can add (blocked people, pending requests) are appended to the hints of their own items.
 */
export const SAFETY_ITEM_TEXT: Readonly<Record<SafetyItemId, { label: string; hint: string }>> = {
  "two-step-verification": { label: "Turn on two-step verification", hint: "Asks for a code when you log in, even if someone has your password." },
  "recovery-contacts": { label: "Check recovery email and phone", hint: "Make sure you can still get back in if you lose access." },
  "strong-password": { label: "Use a strong, unique password", hint: "Avoid a password you use on other sites." },
  "connected-apps": { label: "Review connected apps", hint: "Remove apps you no longer use or trust." },
  "who-can-contact-you": { label: "Choose who can contact you", hint: PENDING_BASE },
  "blocked-list": { label: "Review your blocked list", hint: BLOCKED_BASE },
  "logged-in-devices": { label: "Check logged-in devices", hint: "Log out of any device you do not use or recognize." },
};

/**
 * "once" items are done and stay done. "review" items are worth a fresh look now and then, so a
 * tick older than `reviewEveryDays` is reported as "stale" rather than counted as done forever.
 * A "review" tick with no usable time (missing, invalid or in the future) cannot age: it stays "done"
 * with no `doneAt` or `reviewDueAt`, so a UI should treat a done review item without `doneAt` as
 * "age unknown" and hedge its wording.
 */
export interface SafetyItemDef {
  id: SafetyItemId;
  kind: "once" | "review";
  /** Default re-check interval for "review" items. */
  reviewEveryDays?: number;
}

export const SAFETY_ITEMS: readonly SafetyItemDef[] = [
  { id: "two-step-verification", kind: "once" },
  { id: "recovery-contacts", kind: "review", reviewEveryDays: 365 },
  { id: "strong-password", kind: "once" },
  { id: "connected-apps", kind: "review", reviewEveryDays: 180 },
  { id: "who-can-contact-you", kind: "review", reviewEveryDays: 180 },
  { id: "blocked-list", kind: "review", reviewEveryDays: 365 },
  { id: "logged-in-devices", kind: "review", reviewEveryDays: 90 },
];

/** A tick the caller stored. `at` is epoch ms and optional (older ticks may have none). */
export interface SafetyTick {
  done: boolean;
  at?: number;
}

export interface SafetyChecklistInput {
  /** Epoch ms. The only clock this module has. */
  now: number;
  /** Self-reported ticks by item id. A bare boolean is accepted for ticks without a time. */
  ticks?: Readonly<Record<string, SafetyTick | boolean | undefined>>;
  /** Only the two lists used for counts. Usernames are counted, never copied. */
  friends?: Pick<ParsedFriends, "blocked" | "pendingRequests">;
  /** Multiplies every review interval (default 1). Zero or less turns the stale check off. */
  reviewScale?: number;
}

export type SafetyStatus = "todo" | "done" | "stale";

/** Machine note: a stable code plus counts. Never contains user data. */
export interface SafetyNote {
  code: string;
  params: Record<string, number>;
}

export interface SafetyItem {
  id: SafetyItemId;
  /** 1-based position in the checklist. */
  order: number;
  kind: "once" | "review";
  status: SafetyStatus;
  /** When the user ticked it, if known and not in the future. */
  doneAt?: number;
  /** When a "review" item turns stale, if its tick time is known. */
  reviewDueAt?: number;
  /** Count-based hint from the export, if any. */
  hint?: SafetyNote;
}

export interface SafetyProgress {
  total: number;
  /** Ticked and not stale. */
  done: number;
  /** Ticked, but long enough ago that a fresh look is worth it. */
  stale: number;
  todo: number;
  /** Whole percent of items that are done (not stale). */
  percent: number;
}

export interface SafetyChecklist {
  /** Always true: Snappy cannot see the user's settings, so nothing is verified. */
  selfReported: true;
  items: SafetyItem[];
  progress: SafetyProgress;
  /** Counts behind the hints. Zero when no friends data was given. */
  signals: { blocked: number; pending: number };
  /** Codes: tick-ids-unknown, tick-ids-duplicate, tick-times-future (each with a count). */
  notes: SafetyNote[];
}

const KNOWN = new Set<string>(SAFETY_ITEM_IDS);

function distinctUsers(list: readonly { username: string }[] | undefined): number {
  const seen = new Set<string>();
  for (const r of list ?? []) {
    const u = normUser(r?.username);
    if (u) seen.add(u);
  }
  return seen.size;
}

/** A tick time is usable when it is a positive finite number that is not after `now`. */
function timeState(at: unknown, now: number): "ok" | "future" | "none" {
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return "none";
  return at > now ? "future" : "ok";
}

/**
 * Build the checklist. Deterministic and linear in the number of ticks plus friends.
 * Tick ids are trimmed and lower-cased. If the same id appears twice (for example "A" and "a"),
 * it counts as done when any copy is done and keeps the latest usable time, so the result does
 * not depend on key order. Unknown ids are ignored and counted.
 */
export function buildSafetyChecklist(input: SafetyChecklistInput): SafetyChecklist {
  const now = input.now;
  const scale = input.reviewScale ?? 1;

  let unknown = 0;
  let duplicates = 0;
  let future = 0;
  const merged = new Map<string, { done: boolean; at?: number }>();
  for (const [rawId, raw] of Object.entries(input.ticks ?? {})) {
    if (raw === undefined) continue;
    const id = rawId.trim().toLowerCase();
    if (!KNOWN.has(id)) {
      unknown++;
      continue;
    }
    const done = typeof raw === "boolean" ? raw : raw?.done === true;
    let at: number | undefined;
    if (done && typeof raw === "object") {
      const state = timeState(raw.at, now);
      if (state === "future") future++;
      else if (state === "ok") at = raw.at;
    }
    const prev = merged.get(id);
    if (!prev) {
      merged.set(id, { done, at });
      continue;
    }
    duplicates++;
    prev.done = prev.done || done;
    if (at !== undefined && (prev.at === undefined || at > prev.at)) prev.at = at;
  }

  const blocked = distinctUsers(input.friends?.blocked);
  const pending = distinctUsers(input.friends?.pendingRequests);

  const items: SafetyItem[] = SAFETY_ITEMS.map((def, i) => {
    const tick = merged.get(def.id);
    const item: SafetyItem = { id: def.id, order: i + 1, kind: def.kind, status: "todo" };
    if (tick?.done) {
      item.status = "done";
      if (tick.at !== undefined) {
        item.doneAt = tick.at;
        if (def.kind === "review" && def.reviewEveryDays !== undefined && scale > 0) {
          item.reviewDueAt = tick.at + def.reviewEveryDays * scale * DAY_MS;
          if (item.reviewDueAt <= now) item.status = "stale";
        }
      }
    }
    if (def.id === "blocked-list" && blocked > 0) item.hint = { code: "blocked-entries", params: { count: blocked } };
    if (def.id === "who-can-contact-you" && pending > 0) item.hint = { code: "pending-entries", params: { count: pending } };
    return item;
  });

  const done = items.filter((x) => x.status === "done").length;
  const stale = items.filter((x) => x.status === "stale").length;
  const total = items.length;

  const notes: SafetyNote[] = [];
  if (unknown > 0) notes.push({ code: "tick-ids-unknown", params: { count: unknown } });
  if (duplicates > 0) notes.push({ code: "tick-ids-duplicate", params: { count: duplicates } });
  if (future > 0) notes.push({ code: "tick-times-future", params: { count: future } });

  return {
    selfReported: true,
    items,
    progress: { total, done, stale, todo: total - done - stale, percent: Math.round((done / total) * 100) },
    signals: { blocked, pending },
    notes,
  };
}
