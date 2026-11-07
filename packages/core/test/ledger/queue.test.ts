import { describe, expect, it } from "vitest";
import { buildCleanupQueue } from "../../src/ledger/queue.ts";
import { DAY_MS, combineWeights, confidenceFromScore, seededRandom } from "../../src/util.ts";
import type { Candidate, CandidateCategory, ChatEvent, Evidence } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 1);

function cand(
  key: string,
  category: CandidateCategory,
  evidence: Evidence[],
  extra: Partial<Candidate> = {},
): Candidate {
  const score = combineWeights(evidence.map((e) => e.weight));
  return {
    key: key.trim().toLowerCase(),
    category,
    confidence: confidenceFromScore(score),
    score,
    evidence,
    protectedBy: [],
    ...extra,
  };
}

const ev = (signal: string, weight: number, detail = signal): Evidence => ({ signal, weight, detail });

const chat = (conversation: string, daysAgo: number, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  conversation,
  isGroup: false,
  direction: "received",
  kind: "TEXT",
  at: NOW - daysAgo * DAY_MS,
  ...extra,
});

describe("buildCleanupQueue", () => {
  it("handles empty inputs", () => {
    const q = buildCleanupQueue([], [], { now: NOW });
    expect(q).toEqual({
      generatedAt: NOW,
      items: [],
      protectedItems: [],
      summary: {
        total: 0,
        byCategory: { ghost: 0, "one-way": 0, dormant: 0 },
        byConfidence: { low: 0, medium: 0, high: 0 },
        protectedCount: 0,
      },
    });
  });

  it("handles candidates with empty chats and chats with no candidates", () => {
    expect(buildCleanupQueue([cand("a", "ghost", [ev("g", 0.8)])], [], { now: NOW }).items).toHaveLength(1);
    expect(buildCleanupQueue([], [chat("a", 1)], { now: NOW }).summary.total).toBe(0);
  });

  it("merges candidates by key with category priority ghost > one-way > dormant", () => {
    const q = buildCleanupQueue(
      [
        cand("Sam", "dormant", [ev("silent", 0.3)]),
        cand("sam", "ghost", [ev("absent", 0.5)]),
        cand("SAM", "one-way", [ev("never-accepted", 0.2)]),
      ],
      [],
      { now: NOW },
    );
    expect(q.items).toHaveLength(1);
    const sam = q.items[0]!;
    expect(sam.category).toBe("ghost");
    expect(sam.key).toBe("sam");
    expect(sam.evidence.map((e) => e.signal).sort()).toEqual(["absent", "never-accepted", "silent"]);
    expect(sam.score).toBeCloseTo(combineWeights([0.5, 0.2, 0.3]), 10);
    expect(sam.confidence).toBe(confidenceFromScore(sam.score));
    expect(q.summary.total).toBe(1);
    expect(q.summary.byCategory).toEqual({ ghost: 1, "one-way": 0, dormant: 0 });
  });

  it("picks one-way over dormant when ghost is absent", () => {
    const q = buildCleanupQueue(
      [cand("p", "dormant", [ev("d", 0.2)]), cand("p", "one-way", [ev("o", 0.2)])],
      [],
      { now: NOW },
    );
    expect(q.items[0]!.category).toBe("one-way");
  });

  it("de-duplicates evidence by signal+detail and ignores zero-weight evidence in the score", () => {
    const shared = ev("saved-only", 0, "same");
    const q = buildCleanupQueue(
      [
        cand("a", "dormant", [ev("silent", 0.2, "x"), shared]),
        cand("a", "dormant", [ev("silent", 0.2, "x"), shared, ev("silent", 0.2, "different detail")]),
      ],
      [],
      { now: NOW },
    );
    const item = q.items[0]!;
    expect(item.evidence).toHaveLength(3);
    // Two distinct 0.2 evidences both count; the exact duplicate does not.
    expect(item.score).toBeCloseTo(combineWeights([0.2, 0.2]), 10);
  });

  it("protects allowlisted users (normalised compare) with a stable id", () => {
    const q = buildCleanupQueue([cand("Pal", "ghost", [ev("g", 0.8)])], [], { now: NOW, allowlist: ["  PAL "] });
    expect(q.items).toEqual([]);
    expect(q.protectedItems).toHaveLength(1);
    expect(q.protectedItems[0]!.protectedBy).toEqual(["allowlist"]);
    expect(q.summary.protectedCount).toBe(1);
    expect(q.summary.total).toBe(1);
  });

  it("protects recently messaged users in 1:1 chats, either direction, default 30 days", () => {
    const q = buildCleanupQueue(
      [
        cand("recent", "ghost", [ev("g", 0.8)]),
        cand("sentby", "ghost", [ev("g", 0.8)]),
        cand("old", "ghost", [ev("g", 0.8)]),
        cand("grouponly", "ghost", [ev("g", 0.8)]),
      ],
      [
        chat("Recent", 29),
        chat("sentby", 5, { direction: "sent" }),
        chat("old", 31),
        chat("grouponly", 1, { isGroup: true }),
      ],
      { now: NOW },
    );
    expect(q.protectedItems.map((c) => c.key).sort()).toEqual(["recent", "sentby"]);
    expect(q.items.map((c) => c.key).sort()).toEqual(["grouponly", "old"]);
    for (const c of q.protectedItems) expect(c.protectedBy).toEqual(["recent-message"]);
  });

  it("treats a chat event dated after now as recent", () => {
    const q = buildCleanupQueue([cand("early", "ghost", [ev("g", 0.8)])], [chat("early", -3)], { now: NOW });
    expect(q.protectedItems.map((c) => c.key)).toEqual(["early"]);
  });

  it("honours recentMessageDays and can stack both protections", () => {
    const c = cand("both", "ghost", [ev("g", 0.8)]);
    const chats = [chat("both", 100)];
    expect(buildCleanupQueue([c], chats, { now: NOW }).items).toHaveLength(1);
    const q = buildCleanupQueue([c], chats, { now: NOW, recentMessageDays: 120, allowlist: ["both"] });
    expect(q.protectedItems[0]!.protectedBy).toEqual(["allowlist", "recent-message"]);
  });

  it("keeps protections already present on input candidates", () => {
    const q = buildCleanupQueue([cand("x", "ghost", [ev("g", 0.8)], { protectedBy: ["streak"] })], [], {
      now: NOW,
    });
    expect(q.protectedItems[0]!.protectedBy).toEqual(["streak"]);
  });

  it("sorts by score desc then key, stably across input order", () => {
    const a = cand("b", "ghost", [ev("g", 0.5)]);
    const b = cand("a", "ghost", [ev("g", 0.5)]);
    const c = cand("c", "ghost", [ev("g", 0.9)]);
    const d = cand("d", "ghost", [ev("g", 0.1)]);
    const forward = buildCleanupQueue([a, b, c, d], [], { now: NOW }).items.map((x) => x.key);
    const reversed = buildCleanupQueue([d, c, b, a], [], { now: NOW }).items.map((x) => x.key);
    expect(forward).toEqual(["c", "a", "b", "d"]);
    expect(reversed).toEqual(forward);
  });

  it("sorts protected items the same way", () => {
    const q = buildCleanupQueue(
      [cand("b", "ghost", [ev("g", 0.5)]), cand("a", "ghost", [ev("g", 0.5)]), cand("c", "ghost", [ev("g", 0.9)])],
      [],
      { now: NOW, allowlist: ["a", "b", "c"] },
    );
    expect(q.protectedItems.map((x) => x.key)).toEqual(["c", "a", "b"]);
  });

  it("drops candidates below minConfidence and counts the rest", () => {
    const low = cand("low", "dormant", [ev("d", 0.3)]);
    const med = cand("med", "one-way", [ev("o", 0.5)]);
    const high = cand("high", "ghost", [ev("g", 0.9)]);
    const all = [low, med, high];

    expect(buildCleanupQueue(all, [], { now: NOW }).summary.total).toBe(3);
    const m = buildCleanupQueue(all, [], { now: NOW, minConfidence: "medium" });
    expect(m.items.map((c) => c.key)).toEqual(["high", "med"]);
    expect(m.summary.byConfidence).toEqual({ low: 0, medium: 1, high: 1 });
    const h = buildCleanupQueue(all, [], { now: NOW, minConfidence: "high", allowlist: ["high"] });
    expect(h.items).toEqual([]);
    expect(h.protectedItems.map((c) => c.key)).toEqual(["high"]);
    expect(h.summary.total).toBe(1);
  });

  it("uses the merged confidence (not the inputs') for minConfidence", () => {
    // Each alone is low; together they reach medium.
    const parts = [cand("z", "ghost", [ev("g", 0.3)]), cand("z", "dormant", [ev("d", 0.3)])];
    expect(parts.every((p) => p.confidence === "low")).toBe(true);
    const q = buildCleanupQueue(parts, [], { now: NOW, minConfidence: "medium" });
    expect(q.items).toHaveLength(1);
    expect(q.items[0]!.confidence).toBe("medium");
  });

  it("summarises categories and confidences across items and protected items", () => {
    const q = buildCleanupQueue(
      [
        cand("a", "ghost", [ev("g", 0.9)]),
        cand("b", "one-way", [ev("o", 0.5)]),
        cand("c", "dormant", [ev("d", 0.2)]),
      ],
      [],
      { now: NOW, allowlist: ["b"] },
    );
    expect(q.summary).toEqual({
      total: 3,
      byCategory: { ghost: 1, "one-way": 1, dormant: 1 },
      byConfidence: { low: 1, medium: 1, high: 1 },
      protectedCount: 1,
    });
  });

  it("adds no text of its own: protections are ids and evidence is passed through verbatim", () => {
    const q = buildCleanupQueue([cand("canary_k7", "ghost", [ev("g", 0.8, "plain detail")])], [chat("canary_k7", 1)], {
      now: NOW,
      allowlist: ["canary_k7"],
    });
    const item = q.protectedItems[0]!;
    expect(item.evidence.map((e) => e.detail)).toEqual(["plain detail"]);
    expect(item.protectedBy.every((p) => /^[a-z-]+$/.test(p))).toBe(true);
  });

  it("never mutates inputs", () => {
    const candidates = [
      cand("a", "dormant", [ev("d", 0.2)]),
      cand("A", "ghost", [ev("g", 0.8)]),
      cand("b", "ghost", [ev("g", 0.8)]),
    ];
    const chats = [chat("b", 1)];
    const opts = { now: NOW, allowlist: ["a"] };
    const before = JSON.stringify([candidates, chats, opts]);
    const q = buildCleanupQueue(candidates, chats, opts);
    expect(JSON.stringify([candidates, chats, opts])).toBe(before);
    // Output objects are fresh copies.
    q.protectedItems[0]!.evidence.push(ev("tamper", 1));
    q.protectedItems[0]!.protectedBy.push("tamper");
    expect(JSON.stringify([candidates, chats, opts])).toBe(before);
  });

  it("handles unicode usernames", () => {
    const q = buildCleanupQueue([cand("Ünï", "ghost", [ev("g", 0.8)])], [chat("ÜNÏ", 3)], { now: NOW });
    expect(q.protectedItems.map((c) => c.key)).toEqual(["ünï"]);
  });

  it("handles 5k candidates and 100k chats quickly", () => {
    const rnd = seededRandom(42);
    const cats: CandidateCategory[] = ["ghost", "one-way", "dormant"];
    const candidates: Candidate[] = [];
    for (let i = 0; i < 5000; i++) {
      // 2500 distinct people, each reported by up to two detectors.
      candidates.push(cand(`user${i % 2500}`, cats[Math.floor(rnd() * 3)]!, [ev(`s${i % 7}`, 0.1 + rnd() * 0.5, `d${i}`)]));
    }
    const chats: ChatEvent[] = [];
    for (let i = 0; i < 100_000; i++) chats.push(chat(`user${Math.floor(rnd() * 5000)}`, rnd() * 200));
    const t0 = Date.now();
    const q = buildCleanupQueue(candidates, chats, { now: NOW });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(q.summary.total).toBe(2500);
    expect(q.items.length + q.protectedItems.length).toBe(2500);
    for (let i = 1; i < q.items.length; i++) expect(q.items[i - 1]!.score).toBeGreaterThanOrEqual(q.items[i]!.score);
  });
});

describe("buildCleanupQueue recent-message window of an old export", () => {
  const candidates = [cand("alice", "ghost", [ev("gone", 0.6)])];

  it("measures 'recent' back from the export date, as the quiet-friends check does", () => {
    // Exported 90 days ago; the chat was the day before the export, so 91 days before now.
    const exportedAt = NOW - 90 * DAY_MS;
    const chats = [chat("alice", 91)];
    const wallClock = buildCleanupQueue(candidates, chats, { now: NOW });
    expect(wallClock.items.map((c) => c.key)).toEqual(["alice"]); // the old behavior: no protection

    const anchored = buildCleanupQueue(candidates, chats, { now: NOW, exportedAt });
    expect(anchored.items).toEqual([]);
    expect(anchored.protectedItems[0]?.protectedBy).toEqual(["recent-message"]);
  });

  it("does not protect a chat that was already old when the export was made", () => {
    const q = buildCleanupQueue(candidates, [chat("alice", 90 + 31)], { now: NOW, exportedAt: NOW - 90 * DAY_MS });
    expect(q.items.map((c) => c.key)).toEqual(["alice"]);
  });

  it("ignores an export date later than now", () => {
    const q = buildCleanupQueue(candidates, [chat("alice", 40)], { now: NOW, exportedAt: NOW + 10 * DAY_MS });
    expect(q.items.map((c) => c.key)).toEqual(["alice"]);
  });
});
