import { describe, expect, it } from "vitest";
import { SAFETY_ITEMS, SAFETY_ITEM_IDS, buildSafetyChecklist } from "../../src/insights/safety-checklist.ts";
import type { SafetyChecklist } from "../../src/insights/safety-checklist.ts";
import { parseExportFiles } from "../../src/export/parse.ts";
import { buildSyntheticExport } from "../../src/testing/synthetic-export.ts";
import { DAY_MS } from "../../src/util.ts";
import type { FriendRecord } from "../../src/types.ts";

const NOW = Date.UTC(2026, 10, 7);
const users = (names: string[]): FriendRecord[] => names.map((username) => ({ username }));
const byId = (c: SafetyChecklist, id: string) => c.items.find((i) => i.id === id)!;

describe("buildSafetyChecklist", () => {
  it("lists every item in a fixed order with nothing ticked on empty input", () => {
    const c = buildSafetyChecklist({ now: NOW });
    expect(c.selfReported).toBe(true);
    expect(c.items.map((i) => i.id)).toEqual([...SAFETY_ITEM_IDS]);
    expect(c.items.map((i) => i.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(c.items.every((i) => i.status === "todo" && !i.hint)).toBe(true);
    expect(c.progress).toEqual({ total: 7, done: 0, stale: 0, todo: 7, percent: 0 });
    expect(c.signals).toEqual({ blocked: 0, pending: 0 });
    expect(c.notes).toEqual([]);
  });

  it("has unique kebab-case ids and a definition per id", () => {
    expect(new Set(SAFETY_ITEM_IDS).size).toBe(SAFETY_ITEM_IDS.length);
    expect(SAFETY_ITEM_IDS.every((id) => /^[a-z]+(-[a-z]+)*$/.test(id))).toBe(true);
    expect(SAFETY_ITEMS.map((d) => d.id)).toEqual([...SAFETY_ITEM_IDS]);
  });

  it("counts one ticked item, with and without a time", () => {
    const c = buildSafetyChecklist({ now: NOW, ticks: { "two-step-verification": true } });
    expect(byId(c, "two-step-verification").status).toBe("done");
    expect(byId(c, "two-step-verification").doneAt).toBeUndefined();
    expect(c.progress).toMatchObject({ done: 1, todo: 6, percent: 14 });
    const d = buildSafetyChecklist({ now: NOW, ticks: { "strong-password": { done: true, at: NOW - DAY_MS } } });
    expect(byId(d, "strong-password").doneAt).toBe(NOW - DAY_MS);
  });

  it("treats done: false and undefined ticks as not done", () => {
    const c = buildSafetyChecklist({ now: NOW, ticks: { "connected-apps": { done: false, at: NOW }, "blocked-list": undefined } });
    expect(c.progress.done).toBe(0);
    expect(byId(c, "connected-apps").doneAt).toBeUndefined();
  });

  it("marks old review ticks stale but never old one-time ticks", () => {
    const old = NOW - 400 * DAY_MS;
    const c = buildSafetyChecklist({
      now: NOW,
      ticks: {
        "logged-in-devices": { done: true, at: old },
        "two-step-verification": { done: true, at: old },
        "connected-apps": { done: true, at: NOW - 10 * DAY_MS },
      },
    });
    expect(byId(c, "logged-in-devices")).toMatchObject({ status: "stale", reviewDueAt: old + 90 * DAY_MS });
    expect(byId(c, "two-step-verification").status).toBe("done");
    expect(byId(c, "connected-apps").status).toBe("done");
    expect(c.progress).toMatchObject({ done: 2, stale: 1, todo: 4 });
  });

  it("uses the exact interval and the stale boundary for every review item", () => {
    const reviewItems = SAFETY_ITEMS.filter((d) => d.kind === "review");
    expect(reviewItems.map((d) => [d.id, d.reviewEveryDays])).toEqual([
      ["recovery-contacts", 365],
      ["connected-apps", 180],
      ["who-can-contact-you", 180],
      ["blocked-list", 365],
      ["logged-in-devices", 90],
    ]);
    for (const def of reviewItems) {
      const span = def.reviewEveryDays! * DAY_MS;
      const justInside = buildSafetyChecklist({ now: NOW, ticks: { [def.id]: { done: true, at: NOW - span + 1 } } });
      expect(byId(justInside, def.id)).toMatchObject({ status: "done", reviewDueAt: NOW - span + 1 + span });
      const atDue = buildSafetyChecklist({ now: NOW, ticks: { [def.id]: { done: true, at: NOW - span } } });
      expect(byId(atDue, def.id)).toMatchObject({ status: "stale", reviewDueAt: NOW });
    }
  });

  it("scales review intervals with reviewScale", () => {
    const at = NOW - 100 * DAY_MS;
    const normal = buildSafetyChecklist({ now: NOW, ticks: { "logged-in-devices": { done: true, at } } });
    const doubled = buildSafetyChecklist({ now: NOW, reviewScale: 2, ticks: { "logged-in-devices": { done: true, at } } });
    expect(byId(normal, "logged-in-devices").status).toBe("stale");
    expect(byId(doubled, "logged-in-devices")).toMatchObject({ status: "done", reviewDueAt: at + 180 * DAY_MS });
  });

  it("can turn the stale check off", () => {
    const c = buildSafetyChecklist({ now: NOW, reviewScale: 0, ticks: { "logged-in-devices": { done: true, at: 1000 } } });
    expect(byId(c, "logged-in-devices")).toMatchObject({ status: "done", doneAt: 1000 });
    expect(byId(c, "logged-in-devices").reviewDueAt).toBeUndefined();
  });

  it("ignores missing, invalid and future tick times and reports future ones", () => {
    const c = buildSafetyChecklist({
      now: NOW,
      ticks: {
        "connected-apps": { done: true, at: NOW + DAY_MS },
        "blocked-list": { done: true, at: Number.NaN },
        "logged-in-devices": { done: true },
      },
    });
    expect(c.items.filter((i) => i.status === "done").length).toBe(3);
    expect(c.items.every((i) => i.doneAt === undefined)).toBe(true);
    expect(c.items.every((i) => i.reviewDueAt === undefined)).toBe(true);
    expect(c.notes).toEqual([{ code: "tick-times-future", params: { count: 1 } }]);
  });

  it("merges ids that differ only by case, whatever the key order", () => {
    const at = NOW - 5 * DAY_MS;
    const a = buildSafetyChecklist({ now: NOW, ticks: { "Connected-Apps": { done: true, at }, "connected-apps": { done: false } } });
    const b = buildSafetyChecklist({ now: NOW, ticks: { "connected-apps": { done: false }, "Connected-Apps": { done: true, at } } });
    expect(a).toEqual(b);
    expect(byId(a, "connected-apps")).toMatchObject({ status: "done", doneAt: at });
    expect(a.notes).toEqual([{ code: "tick-ids-duplicate", params: { count: 1 } }]);
    const c = buildSafetyChecklist({
      now: NOW,
      ticks: { "BLOCKED-LIST": { done: true, at: NOW - 9 * DAY_MS }, "blocked-list": { done: true, at: NOW - 2 * DAY_MS } },
    });
    expect(byId(c, "blocked-list").doneAt).toBe(NOW - 2 * DAY_MS);
  });

  it("ignores unknown ids and only counts them", () => {
    const c = buildSafetyChecklist({ now: NOW, ticks: { "not-an-item": true, "also-not": { done: true } } });
    expect(c.progress.done).toBe(0);
    expect(c.notes).toEqual([{ code: "tick-ids-unknown", params: { count: 2 } }]);
    expect(JSON.stringify(c)).not.toContain("not-an-item");
  });

  it("adds count hints from blocked and pending lists, counting people once", () => {
    const c = buildSafetyChecklist({
      now: NOW,
      friends: { blocked: users(["Ann_x", "ann_x", " ", "bo_y"]), pendingRequests: users(["cy_z"]) },
    });
    expect(c.signals).toEqual({ blocked: 2, pending: 1 });
    expect(byId(c, "blocked-list").hint).toEqual({ code: "blocked-entries", params: { count: 2 } });
    expect(byId(c, "who-can-contact-you").hint).toEqual({ code: "pending-entries", params: { count: 1 } });
    expect(c.items.filter((i) => i.hint).length).toBe(2);
  });

  it("keeps hints on ticked items and never puts a username anywhere (canary)", () => {
    const CANARY = "zz_canary_user_7731";
    const c = buildSafetyChecklist({
      now: NOW,
      ticks: { "blocked-list": { done: true, at: NOW - DAY_MS }, "unknown-1": true },
      friends: { blocked: users([CANARY]), pendingRequests: users([CANARY.toUpperCase()]) },
    });
    expect(byId(c, "blocked-list").status).toBe("done");
    expect(byId(c, "blocked-list").hint).toBeDefined();
    expect(JSON.stringify(c).toLowerCase()).not.toContain("canary");
  });

  it("keeps the canary out of notes, hints and codes, even in tick ids", () => {
    const CANARY = "zz_canary_user_7731";
    const c = buildSafetyChecklist({
      now: NOW,
      ticks: { [CANARY]: true, [CANARY.toUpperCase()]: { done: true }, "blocked-list": { done: true, at: NOW + DAY_MS } },
      friends: { blocked: users([CANARY, "bo_y"]), pendingRequests: users([CANARY]) },
    });
    expect(c.notes.map((n) => n.code)).toEqual(["tick-ids-unknown", "tick-times-future"]);
    const notes = [...c.notes, ...c.items.flatMap((i) => (i.hint ? [i.hint] : []))];
    expect(notes.length).toBe(4);
    for (const n of notes) {
      expect(n.code).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(Object.keys(n.params).every((k) => /^[a-z]+$/.test(k))).toBe(true);
      expect(Object.values(n.params).every((v) => typeof v === "number" && Number.isInteger(v))).toBe(true);
    }
    const json = JSON.stringify(c).toLowerCase();
    expect(json).not.toContain("canary");
    expect(json).not.toContain("7731");
    expect(json).not.toContain("bo_y");
  });

  it("works with a parsed synthetic export", () => {
    const parsed = parseExportFiles(buildSyntheticExport({ now: NOW }));
    const c = buildSafetyChecklist({ now: NOW, friends: parsed.friends });
    const expected = new Set(parsed.friends.blocked.map((r) => r.username.toLowerCase())).size;
    expect(c.signals.blocked).toBe(expected);
    expect(c.items).toHaveLength(7);
  });

  it("is deterministic and fast on very large lists", () => {
    const big = Array.from({ length: 20_000 }, (_, i) => ({ username: `person_${i % 15_000}` }));
    const ticks: Record<string, boolean> = {};
    for (let i = 0; i < 10_000; i++) ticks[`junk-${i}`] = true;
    const t0 = performance.now();
    const a = buildSafetyChecklist({ now: NOW, ticks, friends: { blocked: big, pendingRequests: big } });
    const b = buildSafetyChecklist({ now: NOW, ticks, friends: { blocked: big, pendingRequests: big } });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(a).toEqual(b);
    expect(a.signals).toEqual({ blocked: 15_000, pending: 15_000 });
    expect(a.notes).toEqual([{ code: "tick-ids-unknown", params: { count: 10_000 } }]);
  });
});
