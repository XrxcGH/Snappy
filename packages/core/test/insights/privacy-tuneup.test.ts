import { describe, expect, it } from "vitest";
import {
  PRIVACY_TUNEUP_ITEMS,
  PRIVACY_TUNEUP_SECTIONS,
  STALE_AFTER_DAYS,
  buildPrivacyTuneup,
  type TuneupEntry,
} from "../../src/insights/privacy-tuneup.ts";
import { DAY_MS } from "../../src/util.ts";

const NOW = Date.UTC(2026, 10, 7);
const codes = (r: ReturnType<typeof buildPrivacyTuneup>) => r.notes.map((n) => n.code);
const allItems = (r: ReturnType<typeof buildPrivacyTuneup>) => r.sections.flatMap((s) => s.items);

describe("catalog", () => {
  it("has unique stable ids and every item belongs to a section", () => {
    const ids = PRIVACY_TUNEUP_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = new Set(PRIVACY_TUNEUP_SECTIONS.map((s) => s.id));
    for (const i of PRIVACY_TUNEUP_ITEMS) expect(sections.has(i.section)).toBe(true);
    expect(ids).toEqual([
      "contact-me", "group-invites", "view-story", "quick-add", "search",
      "map-location", "spotlight-profile", "personalized-ads", "data-sharing",
    ]);
  });

  it("uses short sentence case text without exclamation marks or all caps", () => {
    for (const t of [...PRIVACY_TUNEUP_SECTIONS.map((s) => s.title), ...PRIVACY_TUNEUP_ITEMS.flatMap((i) => [i.title, i.hint])]) {
      expect(t.length).toBeLessThanOrEqual(60);
      expect(t).not.toMatch(/!|verified|\b[A-Z]{3,}\b/);
      expect(t[0]).toBe(t[0]!.toUpperCase());
    }
  });
});

describe("buildPrivacyTuneup", () => {
  it("handles empty input: everything todo, nothing reviewed", () => {
    const r = buildPrivacyTuneup([], NOW);
    expect(r.progress).toMatchObject({ total: 9, todo: 9, done: 0, applicable: 9, percent: 0, complete: false });
    expect(r.nextItemId).toBe("contact-me");
    expect(codes(r)).toEqual(["self_reported", "nothing_reviewed_yet"]);
    expect(r.sections.map((s) => s.id)).toEqual(PRIVACY_TUNEUP_SECTIONS.map((s) => s.id));
  });

  it("handles one item", () => {
    const r = buildPrivacyTuneup([{ id: "map-location", state: "done", reviewedAt: NOW - DAY_MS }], NOW);
    expect(r.progress).toMatchObject({ done: 1, todo: 8, percent: 11 });
    const loc = r.sections.find((s) => s.id === "location")!;
    expect(loc.counts).toMatchObject({ total: 1, done: 1 });
    expect(loc.items[0]).toMatchObject({ state: "done", stale: false, reviewedAt: NOW - DAY_MS });
    expect(r.nextItemId).toBe("contact-me");
  });

  it("counts skipped out of the denominator and reaches 100 only when complete", () => {
    const entries: TuneupEntry[] = PRIVACY_TUNEUP_ITEMS.map((i) => ({ id: i.id, state: "done" as const }));
    entries[0] = { id: entries[0]!.id, state: "skipped" };
    const r = buildPrivacyTuneup(entries, NOW);
    expect(r.progress).toMatchObject({ done: 8, skipped: 1, applicable: 8, percent: 100, complete: true });
    expect(r.nextItemId).toBeUndefined();
    expect(codes(r)).toContain("all_reviewed");

    const almost = buildPrivacyTuneup(PRIVACY_TUNEUP_ITEMS.slice(0, 8).map((i) => ({ id: i.id, state: "done" as const })), NOW);
    expect(almost.progress.percent).toBe(88);
    expect(almost.progress.complete).toBe(false);
  });

  it("does not report complete when everything is skipped", () => {
    const r = buildPrivacyTuneup(PRIVACY_TUNEUP_ITEMS.map((i) => ({ id: i.id, state: "skipped" as const })), NOW);
    expect(r.progress).toMatchObject({ applicable: 0, percent: 0, complete: false });
    expect(codes(r)).not.toContain("all_reviewed");
  });

  it("treats missing timestamps as unknown: never stale", () => {
    const r = buildPrivacyTuneup([{ id: "quick-add", state: "done" }], NOW);
    const item = allItems(r).find((i) => i.id === "quick-add")!;
    expect(item.stale).toBe(false);
    expect(item.reviewedAt).toBeUndefined();
    expect("reviewedAt" in item).toBe(false);
  });

  it("flags old reviews as stale but still counts them done", () => {
    const old = NOW - (STALE_AFTER_DAYS + 1) * DAY_MS;
    const edge = NOW - STALE_AFTER_DAYS * DAY_MS;
    const r = buildPrivacyTuneup(
      [
        { id: "contact-me", state: "done", reviewedAt: old },
        { id: "view-story", state: "done", reviewedAt: edge },
      ],
      NOW,
    );
    expect(r.progress).toMatchObject({ done: 2, stale: 1 });
    expect(r.notes).toContainEqual({ code: "stale_reviews", params: { count: 1 } });
    expect(r.nextItemId).toBe("contact-me");
  });

  it("ignores timestamps in the future and says so", () => {
    const r = buildPrivacyTuneup(
      [
        { id: "contact-me", state: "done", reviewedAt: NOW + DAY_MS },
        { id: "view-story", state: "done", reviewedAt: Number.NaN },
        { id: "search", state: "done", reviewedAt: -5 },
      ],
      NOW,
    );
    const items = allItems(r);
    expect(items.find((i) => i.id === "contact-me")).toMatchObject({ state: "done", stale: false });
    expect(items.find((i) => i.id === "contact-me")!.reviewedAt).toBeUndefined();
    expect(r.notes).toContainEqual({ code: "future_dates_ignored", params: { count: 1 } });
    expect(r.progress.done).toBe(3);
  });

  it("merges duplicates that differ only by case or spaces, whatever the order", () => {
    const a: TuneupEntry = { id: "Contact-Me", state: "later", reviewedAt: NOW - 5 * DAY_MS };
    const b: TuneupEntry = { id: " contact-me ", state: "done", reviewedAt: NOW - 1 * DAY_MS };
    const r1 = buildPrivacyTuneup([a, b], NOW);
    const r2 = buildPrivacyTuneup([b, a], NOW);
    expect(r1).toEqual(r2);
    expect(allItems(r1).find((i) => i.id === "contact-me")!.state).toBe("done");
    expect(r1.progress.total).toBe(9);
    expect(r1.notes).toContainEqual({ code: "duplicate_entries", params: { count: 1 } });
  });

  it("lets a future-dated tick win over an older duplicate, in any order, and counts the future date once", () => {
    const older: TuneupEntry = { id: "search", state: "later", reviewedAt: NOW - 10 * DAY_MS };
    const future: TuneupEntry = { id: "search", state: "done", reviewedAt: NOW + DAY_MS };
    const r1 = buildPrivacyTuneup([older, future], NOW);
    const r2 = buildPrivacyTuneup([future, older], NOW);
    expect(r1).toEqual(r2);
    const item = allItems(r1).find((i) => i.id === "search")!;
    expect(item.state).toBe("done");
    expect(item.reviewedAt).toBeUndefined();
    expect(r1.notes).toContainEqual({ code: "future_dates_ignored", params: { count: 1 } });
  });

  it("does not count a future date on a duplicate that was discarded", () => {
    // A date equal to now ties a future date on merge order, so the higher-ranked state (done) wins and the
    // future-dated "later" is discarded.
    const kept: TuneupEntry = { id: "search", state: "done", reviewedAt: NOW };
    const dropped: TuneupEntry = { id: "search", state: "later", reviewedAt: NOW + DAY_MS };
    const r = buildPrivacyTuneup([dropped, kept], NOW);
    expect(allItems(r).find((i) => i.id === "search")!.state).toBe("done");
    expect(codes(r)).not.toContain("future_dates_ignored");
    expect(r.notes).toContainEqual({ code: "duplicate_entries", params: { count: 1 } });
  });

  it("lets a dated duplicate beat an undated one, whatever the order", () => {
    const dated: TuneupEntry = { id: "quick-add", state: "later", reviewedAt: NOW - 400 * DAY_MS };
    const undated: TuneupEntry = { id: "quick-add", state: "done" };
    const r1 = buildPrivacyTuneup([dated, undated], NOW);
    const r2 = buildPrivacyTuneup([undated, dated], NOW);
    expect(r1).toEqual(r2);
    expect(allItems(r1).find((i) => i.id === "quick-add")).toMatchObject({ state: "later", reviewedAt: NOW - 400 * DAY_MS });
  });

  it("accepts reviewedAt of exactly 0 as a valid date (stale), but rejects negatives", () => {
    const r = buildPrivacyTuneup([{ id: "contact-me", state: "done", reviewedAt: 0 }], NOW);
    const item = allItems(r).find((i) => i.id === "contact-me")!;
    expect(item.reviewedAt).toBe(0);
    expect(item.stale).toBe(true);
    expect(codes(r)).not.toContain("future_dates_ignored");
  });

  it("breaks ties between equal timestamps by state, not by input order", () => {
    const t = NOW - DAY_MS;
    const entries: TuneupEntry[] = [
      { id: "search", state: "later", reviewedAt: t },
      { id: "search", state: "done", reviewedAt: t },
      { id: "search", state: "skipped", reviewedAt: t },
    ];
    const forward = buildPrivacyTuneup(entries, NOW);
    const backward = buildPrivacyTuneup([...entries].reverse(), NOW);
    expect(forward).toEqual(backward);
    expect(allItems(forward).find((i) => i.id === "search")!.state).toBe("done");
  });

  it("ranks skipped above later when timestamps tie, in any order", () => {
    const t = NOW - DAY_MS;
    const entries: TuneupEntry[] = [
      { id: "search", state: "later", reviewedAt: t },
      { id: "search", state: "skipped", reviewedAt: t },
    ];
    expect(allItems(buildPrivacyTuneup(entries, NOW)).find((i) => i.id === "search")!.state).toBe("skipped");
    expect(allItems(buildPrivacyTuneup([...entries].reverse(), NOW)).find((i) => i.id === "search")!.state).toBe("skipped");
  });

  it("ignores unknown ids and bad states without echoing them", () => {
    const bad = [
      { id: "no-such-item", state: "done" },
      { id: "contact-me", state: "verified" },
      { id: 42, state: "done" },
      null,
    ] as unknown as TuneupEntry[];
    const r = buildPrivacyTuneup(bad, NOW);
    expect(r.notes).toContainEqual({ code: "entries_ignored", params: { count: 4 } });
    expect(r.progress.done).toBe(0);
    expect(JSON.stringify(r)).not.toContain("no-such-item");
  });

  it("keeps checklist order and puts later items first in line for review", () => {
    const r = buildPrivacyTuneup(
      [
        { id: "contact-me", state: "done" },
        { id: "group-invites", state: "later" },
      ],
      NOW,
    );
    expect(allItems(r).map((i) => i.id)).toEqual(PRIVACY_TUNEUP_ITEMS.map((i) => i.id));
    expect(r.nextItemId).toBe("group-invites");
  });

  it("is deterministic and does not mutate its input", () => {
    const entries: TuneupEntry[] = [{ id: "search", state: "done", reviewedAt: NOW - DAY_MS }];
    const copy = JSON.parse(JSON.stringify(entries));
    expect(buildPrivacyTuneup(entries, NOW)).toEqual(buildPrivacyTuneup(entries, NOW));
    expect(entries).toEqual(copy);
  });

  it("stays fast with 10,000+ entries", () => {
    const entries: TuneupEntry[] = [];
    for (let i = 0; i < 60_000; i++) {
      const item = PRIVACY_TUNEUP_ITEMS[i % PRIVACY_TUNEUP_ITEMS.length]!;
      entries.push({ id: i % 3 === 0 ? item.id.toUpperCase() : `unknown-${i}`, state: i % 2 ? "done" : "later", reviewedAt: NOW - (i % 400) * DAY_MS });
    }
    const t0 = performance.now();
    const r = buildPrivacyTuneup(entries, NOW);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.progress.total).toBe(9);
    expect(r.notes.find((n) => n.code === "entries_ignored")!.params.count).toBe(40_000);
  });

  it("never claims anything is verified and always marks ticks as self-reported", () => {
    const r = buildPrivacyTuneup(PRIVACY_TUNEUP_ITEMS.map((i) => ({ id: i.id, state: "done" as const })), NOW);
    expect(r.notes[0]).toEqual({ code: "self_reported", params: {} });
    expect(JSON.stringify(r).toLowerCase()).not.toContain("verified");
  });

  it("canary: caller-supplied names never appear in the result", () => {
    const canary = "canary_user_q7x9zk";
    const r = buildPrivacyTuneup(
      [
        { id: canary, state: "done" },
        { id: canary.toUpperCase(), state: "later" },
        { id: "contact-me", state: "done", reviewedAt: NOW + DAY_MS },
      ],
      NOW,
    );
    const json = JSON.stringify(r).toLowerCase();
    expect(json).not.toContain(canary);
    expect(json).not.toContain("q7x9zk");
  });
});
