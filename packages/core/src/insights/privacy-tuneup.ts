/**
 * Privacy settings tune-up: a checklist of Snapchat privacy settings the user reviews in the
 * Snapchat app themselves.
 *
 * Snappy never reads, changes or verifies any setting (and never reads location). The only input is
 * what the user ticked, so nothing here is evidence about the account. The module touches no export
 * data at all: no usernames, no content. Pure and deterministic; time comes in as `now` (epoch ms).
 */
import { DAY_MS } from "../util.ts";

/** What the user says about one item. An item with no entry is "todo". */
export type TuneupState = "done" | "skipped" | "later";
export type TuneupItemState = TuneupState | "todo";

/** One self-reported tick supplied by the caller. */
export interface TuneupEntry {
  /** A checklist item id (see PRIVACY_TUNEUP_ITEMS). Matched ignoring case and outer spaces. */
  id: string;
  state: TuneupState;
  /** When the user last reviewed it (epoch ms). Optional; used only to flag old reviews. */
  reviewedAt?: number;
}

export type TuneupSectionId = "contact" | "visibility" | "location" | "public" | "data";

export interface TuneupItemDef {
  id: string;
  section: TuneupSectionId;
  /** Short, sentence case. */
  title: string;
  /** One short line on what to look at in the app. */
  hint: string;
}

/** Sections in display order. Titles are fixed text and never contain user data. */
export const PRIVACY_TUNEUP_SECTIONS: readonly { id: TuneupSectionId; title: string }[] = [
  { id: "contact", title: "Who can reach you" },
  { id: "visibility", title: "Who can see you" },
  { id: "location", title: "Your location" },
  { id: "public", title: "Public" },
  { id: "data", title: "Ads and data" },
];

/**
 * The checklist, in display order. Ids are part of the API: never rename one. Titles and hints describe each
 * setting in general terms; the app's own labels and menus may differ and change over time.
 */
export const PRIVACY_TUNEUP_ITEMS: readonly TuneupItemDef[] = [
  { id: "contact-me", section: "contact", title: "Who can contact you", hint: "Check who can send you snaps and chats." },
  { id: "group-invites", section: "contact", title: "Group chat invites", hint: "Check who can add you to group chats." },
  { id: "view-story", section: "visibility", title: "Who can see your story", hint: "Pick friends only, custom or public." },
  { id: "quick-add", section: "visibility", title: "Quick add visibility", hint: "Decide if you show up in suggestions." },
  { id: "search", section: "visibility", title: "Who can find you in search", hint: "Check if people can look you up." },
  { id: "map-location", section: "location", title: "Map and ghost mode", hint: "Check who can see you on the map." },
  { id: "spotlight-profile", section: "public", title: "Spotlight and public profile", hint: "Check what is public." },
  { id: "personalized-ads", section: "data", title: "Personalized ads", hint: "Check which ad settings are on." },
  { id: "data-sharing", section: "data", title: "Data sharing", hint: "Check what you share with apps and partners." },
];

/** A review older than this is flagged as stale (still counted as done). Default: 180 days. */
export const STALE_AFTER_DAYS = 180;

export interface TuneupItem extends TuneupItemDef {
  state: TuneupItemState;
  /** Last reviewed time, only when it was valid and not in the future. */
  reviewedAt?: number;
  /** Done, but reviewed long enough ago that a re-check makes sense. */
  stale: boolean;
}

export interface TuneupCounts {
  total: number;
  done: number;
  skipped: number;
  later: number;
  todo: number;
  stale: number;
}

export interface TuneupSection {
  id: TuneupSectionId;
  title: string;
  items: TuneupItem[];
  counts: TuneupCounts;
}

/** Machine-readable note: the caller turns `code` into wording. Params are counts only. */
export interface TuneupNote {
  code:
    | "self_reported" // always present: ticks are the user's own word, nothing is checked
    | "nothing_reviewed_yet"
    | "all_reviewed"
    | "stale_reviews" // params: { count }
    | "future_dates_ignored" // params: { count }
    | "entries_ignored" // params: { count } unknown id or bad state; never echoed
    | "duplicate_entries"; // params: { count }
  params: Record<string, number>;
}

export interface TuneupProgress extends TuneupCounts {
  /** Items that count toward progress: everything except "skipped". */
  applicable: number;
  /** Whole percent of applicable items done, rounded down so 100 means truly complete. */
  percent: number;
  complete: boolean;
}

export interface TuneupResult {
  sections: TuneupSection[];
  progress: TuneupProgress;
  /** First item still worth a look (todo, later or stale) in checklist order, if any. */
  nextItemId?: string;
  notes: TuneupNote[];
}

const STATE_RANK: Record<TuneupState, number> = { done: 2, skipped: 1, later: 0 };

const isState = (v: unknown): v is TuneupState => v === "done" || v === "skipped" || v === "later";

/** An entry after cleanup. `at` is shown to the caller; `order` only decides duplicate merges. */
interface Picked {
  state: TuneupState;
  /** Valid, not-future review time. */
  at?: number;
  /** Merge order: `at`, or `now` for a future date (it is the latest tick as far as we can tell). Missing or bad dates have none and lose to any dated duplicate. */
  order?: number;
  /** The date was in the future (it is dropped from `at`). */
  future: boolean;
}

/** Entry `a` beats `b` when it is newer; ties go to the higher-ranked state, so order never matters. */
function beats(a: Picked, b: Picked): boolean {
  const ta = a.order ?? -Infinity;
  const tb = b.order ?? -Infinity;
  if (ta !== tb) return ta > tb;
  return STATE_RANK[a.state] > STATE_RANK[b.state];
}

const emptyCounts = (): TuneupCounts => ({ total: 0, done: 0, skipped: 0, later: 0, todo: 0, stale: 0 });

function tally(c: TuneupCounts, item: TuneupItem): void {
  c.total++;
  c[item.state]++;
  if (item.stale) c.stale++;
}

/** Build the checklist with the caller's ticks applied. Linear in the number of entries. */
export function buildPrivacyTuneup(entries: readonly TuneupEntry[], now: number): TuneupResult {
  const known = new Set(PRIVACY_TUNEUP_ITEMS.map((i) => i.id));
  const picked = new Map<string, Picked>();
  let ignored = 0;
  let duplicates = 0;

  for (const raw of entries ?? []) {
    const id = typeof raw?.id === "string" ? raw.id.trim().toLowerCase() : "";
    if (!known.has(id) || !isState(raw.state)) {
      ignored++;
      continue;
    }
    let at: number | undefined;
    let order: number | undefined;
    let isFuture = false;
    if (typeof raw.reviewedAt === "number" && Number.isFinite(raw.reviewedAt) && raw.reviewedAt >= 0) {
      if (raw.reviewedAt > now) {
        isFuture = true;
        order = now;
      } else {
        at = raw.reviewedAt;
        order = at;
      }
    }
    const entry: Picked = { state: raw.state, at, order, future: isFuture };
    const prev = picked.get(id);
    if (prev) {
      duplicates++;
      if (!beats(entry, prev)) continue;
    }
    picked.set(id, entry);
  }

  // Count only future dates on entries that were kept, so a discarded duplicate does not add noise.
  let future = 0;
  for (const e of picked.values()) if (e.future) future++;

  const staleBefore = now - STALE_AFTER_DAYS * DAY_MS;
  const progress: TuneupProgress = { ...emptyCounts(), applicable: 0, percent: 0, complete: false };
  const sections: TuneupSection[] = PRIVACY_TUNEUP_SECTIONS.map((s) => ({ ...s, items: [], counts: emptyCounts() }));
  const bySection = new Map(sections.map((s) => [s.id, s]));
  let nextItemId: string | undefined;

  for (const def of PRIVACY_TUNEUP_ITEMS) {
    const e = picked.get(def.id);
    const state: TuneupItemState = e?.state ?? "todo";
    const item: TuneupItem = {
      ...def,
      state,
      ...(e?.at !== undefined ? { reviewedAt: e.at } : {}),
      stale: state === "done" && e?.at !== undefined && e.at < staleBefore,
    };
    const section = bySection.get(def.section)!;
    section.items.push(item);
    tally(section.counts, item);
    tally(progress, item);
    if (nextItemId === undefined && (state === "todo" || state === "later" || item.stale)) nextItemId = item.id;
  }

  progress.applicable = progress.total - progress.skipped;
  progress.percent = progress.applicable > 0 ? Math.floor((progress.done * 100) / progress.applicable) : 0;
  progress.complete = progress.applicable > 0 && progress.done === progress.applicable;

  const notes: TuneupNote[] = [{ code: "self_reported", params: {} }];
  if (progress.done === 0 && progress.later === 0 && progress.skipped === 0) notes.push({ code: "nothing_reviewed_yet", params: {} });
  if (progress.complete && progress.stale === 0) notes.push({ code: "all_reviewed", params: {} });
  if (progress.stale > 0) notes.push({ code: "stale_reviews", params: { count: progress.stale } });
  if (future > 0) notes.push({ code: "future_dates_ignored", params: { count: future } });
  if (ignored > 0) notes.push({ code: "entries_ignored", params: { count: ignored } });
  if (duplicates > 0) notes.push({ code: "duplicate_entries", params: { count: duplicates } });

  return { sections, progress, ...(nextItemId !== undefined ? { nextItemId } : {}), notes };
}
