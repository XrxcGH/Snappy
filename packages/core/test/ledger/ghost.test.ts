import { describe, expect, it } from "vitest";
import type { Snapshot } from "../../src/types.ts";
import { findGhosts } from "../../src/ledger/detect-ghost.ts";
import { DAY_MS, combineWeights, confidenceFromScore, seededRandom } from "../../src/util.ts";

const T0 = Date.UTC(2024, 0, 1);
const NOW = Date.UTC(2025, 6, 1);
const YEAR = 365 * DAY_MS;

function snap(id: string, day: number, p: Partial<Snapshot> = {}): Snapshot {
  return { id, takenAt: T0 + day * DAY_MS, source: "export", friends: [], sentRequests: [], deleted: {}, friendSince: {}, sentAt: {}, ...p };
}

/** n filler friends so that single-user changes never look like a mass disappearance. */
const crowd = (n: number, prefix = "u") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

const signals = (c: { evidence: { signal: string }[] }) => c.evidence.map((e) => e.signal);

describe("findGhosts basics", () => {
  it("needs at least two snapshots", () => {
    expect(findGhosts([], { now: NOW })).toEqual([]);
    expect(findGhosts([snap("a", 0, { friends: ["x"] })], { now: NOW })).toEqual([]);
  });

  it("flags a friend who vanished, with honest evidence and bounded score", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [snap("a", 0, { friends: [...friends, "alice"], friendSince: { alice: T0 - 3 * YEAR } }), snap("b", 30, { friends })],
      { now: NOW },
    );
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c).toMatchObject({ key: "alice", category: "ghost", protectedBy: [] });
    expect(signals(c)).toEqual([
      "absent-from-latest-export",
      "was-friend-in-earlier-export",
      "not-deleted-by-you",
      "long-friendship",
      "cannot-rule-out-account-deletion",
      "cannot-rule-out-date-range",
    ]);
    const weights = Object.fromEntries(c.evidence.map((e) => [e.signal, e.weight]));
    expect(weights["absent-from-latest-export"]).toBe(0.45);
    expect(weights["was-friend-in-earlier-export"]).toBe(0.15);
    expect(weights["not-deleted-by-you"]).toBe(0.2);
    expect(weights["long-friendship"]).toBe(0.1);
    expect(weights["cannot-rule-out-account-deletion"]).toBe(0);
    expect(weights["cannot-rule-out-date-range"]).toBe(0);
    expect(c.score).toBeCloseTo(combineWeights(c.evidence.map((e) => e.weight)), 10);
    expect(c.score).toBeLessThan(0.75);
    expect(c.confidence).toBe(confidenceFromScore(c.score));
    expect(c.confidence).toBe("medium");
  });

  it("omits long-friendship for short or unknown friendships", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [
        snap("a", 0, { friends: [...friends, "recent", "unknown"], friendSince: { recent: NOW - 30 * DAY_MS } }),
        snap("b", 30, { friends }),
      ],
      { now: NOW },
    );
    expect(out).toHaveLength(2);
    for (const c of out) expect(signals(c)).not.toContain("long-friendship");
  });

  it("sorts by score then key and carries no personal fields beyond the key", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [snap("a", 0, { friends: [...friends, "zed", "amy", "old"], friendSince: { old: T0 - 2 * YEAR } }), snap("b", 30, { friends })],
      { now: NOW },
    );
    expect(out.map((c) => c.key)).toEqual(["old", "amy", "zed"]);
    expect(Object.keys(out[1]!).sort()).toEqual(["category", "confidence", "evidence", "key", "protectedBy", "score"]);
  });

  it("accepts unsorted input and does not mutate it", () => {
    const friends = crowd(10);
    const a = snap("a", 0, { friends: [...friends, "x"] });
    const b = snap("b", 30, { friends });
    const input = [b, a];
    const out = findGhosts(input, { now: NOW });
    expect(out.map((c) => c.key)).toEqual(["x"]);
    expect(input).toEqual([b, a]);
  });
});

describe("explained and excluded users", () => {
  it("skips friends the user deleted (latest or earlier snapshot, null date too)", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [
        snap("a", 0, { friends: [...friends, "d1", "d2", "d3", "ghost"] }),
        snap("b", 15, { friends: [...friends, "d3"], deleted: { d3: null } }),
        snap("c", 30, { friends, deleted: { d1: T0 + 20 * DAY_MS, d3: null } }),
      ],
      { now: NOW },
    );
    // d1 is explained by the latest list and d3 by an earlier one; d2 and ghost are not explained.
    expect(out.map((c) => c.key).sort()).toEqual(["d2", "ghost"]);
  });

  it("remembers an older deletion even when the latest export no longer lists it", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [
        snap("a", 0, { friends: [...friends, "x"] }),
        snap("b", 10, { friends, deleted: { x: 5 } }),
        snap("c", 20, { friends }),
      ],
      { now: NOW },
    );
    expect(out).toEqual([]);
  });

  it("honours exclude using normalised usernames", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [snap("a", 0, { friends: [...friends, "blocked1", "other"] }), snap("b", 30, { friends })],
      { now: NOW, exclude: ["Blocked1 "] },
    );
    expect(out.map((c) => c.key)).toEqual(["other"]);
  });

  it("does not flag people still present or who came back", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [
        snap("a", 0, { friends: [...friends, "back"] }),
        snap("b", 10, { friends }),
        snap("c", 20, { friends: [...friends, "back"] }),
      ],
      { now: NOW },
    );
    expect(out).toEqual([]);
  });

  it("does not flag users who were never friends in an earlier snapshot", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [snap("a", 0, { friends, sentRequests: ["req"] }), snap("b", 30, { friends, deleted: { other: 1 } })],
      { now: NOW },
    );
    expect(out).toEqual([]);
  });
});

describe("repeated confirmation", () => {
  const friends = crowd(10);

  it("stays below 0.7 with one earlier sighting even with all single-snapshot evidence", () => {
    const out = findGhosts(
      [snap("a", 0, { friends: [...friends, "x"], friendSince: { x: T0 - 5 * YEAR } }), snap("b", 30, { friends })],
      { now: NOW },
    );
    expect(out[0]!.score).toBeLessThan(0.7);
  });

  it("adds weight only for independent later absences", () => {
    const base = snap("a", 0, { friends: [...friends, "x"] });
    const single = findGhosts([base, snap("b", 30, { friends })], { now: NOW })[0]!;
    const sameDay = findGhosts([base, snap("b", 30, { friends }), snap("c", 30.5, { friends })], { now: NOW })[0]!;
    expect(sameDay.score).toBe(single.score);
    expect(signals(sameDay)).not.toContain("absent-in-multiple-later-exports");

    const twice = findGhosts([base, snap("b", 30, { friends }), snap("c", 60, { friends })], { now: NOW })[0]!;
    expect(signals(twice)).toContain("absent-in-multiple-later-exports");
    expect(twice.score).toBeGreaterThan(single.score);
  });

  it("stays below 0.75 with a single earlier sighting, even with every signal and three later absences", () => {
    const out = findGhosts(
      [
        snap("a", 0, { friends: [...friends, "x"], friendSince: { x: T0 - 5 * YEAR } }),
        snap("b", 30, { friends }),
        snap("c", 60, { friends }),
        snap("d", 90, { friends }),
      ],
      { now: NOW },
    );
    expect(out[0]!.score).toBeLessThan(0.75);
    expect(out[0]!.confidence).not.toBe("high");
  });

  it("reaches high confidence only with many sightings and several later confirmations", () => {
    const hist = [
      snap("s1", 0, { friends: [...friends, "x"], friendSince: { x: T0 - 3 * YEAR } }),
      snap("s2", 30, { friends: [...friends, "x"] }),
      snap("s3", 60, { friends: [...friends, "x"] }),
      snap("s4", 90, { friends: [...friends, "x"] }),
    ];
    const gone = [snap("g1", 120, { friends }), snap("g2", 150, { friends }), snap("g3", 180, { friends })];
    const oneAbsent = findGhosts([...hist, gone[0]!], { now: NOW })[0]!;
    const threeAbsent = findGhosts([...hist, ...gone], { now: NOW })[0]!;
    expect(oneAbsent.confidence).not.toBe("high");
    expect(threeAbsent.confidence).toBe("high");
    expect(threeAbsent.evidence.find((e) => e.signal === "was-friend-in-earlier-export")!.weight).toBeGreaterThan(0.15);
    expect(threeAbsent.score).toBeLessThanOrEqual(1);
    expect(signals(threeAbsent)).toContain("cannot-rule-out-account-deletion");
  });
});

describe("mass disappearance guard", () => {
  it("caps everything at low when more than half of the previous friends vanish", () => {
    const prev = crowd(10);
    const out = findGhosts(
      [
        snap("a", 0, { friends: prev, friendSince: Object.fromEntries(prev.map((k) => [k, T0 - 4 * YEAR])) }),
        snap("b", 30, { friends: prev.slice(0, 4) }),
      ],
      { now: NOW },
    );
    expect(out).toHaveLength(6);
    for (const c of out) {
      expect(c.score).toBeLessThanOrEqual(0.3);
      expect(c.confidence).toBe("low");
      const m = c.evidence.find((e) => e.signal === "mass-disappearance");
      expect(m?.weight).toBe(0);
    }
  });

  it("does not trigger at exactly half or when the user removed them", () => {
    const prev = crowd(10);
    const half = findGhosts([snap("a", 0, { friends: prev }), snap("b", 30, { friends: prev.slice(0, 5) })], { now: NOW });
    expect(half).toHaveLength(5);
    expect(half.every((c) => !signals(c).includes("mass-disappearance"))).toBe(true);

    const purged = findGhosts(
      [
        snap("a", 0, { friends: prev }),
        snap("b", 30, { friends: prev.slice(0, 2), deleted: Object.fromEntries(prev.slice(2, 9).map((k) => [k, T0])) }),
      ],
      { now: NOW },
    );
    expect(purged.map((c) => c.key)).toEqual(["u9"]);
    expect(signals(purged[0]!)).not.toContain("mass-disappearance");
  });

  it("treats an empty latest friend list as a suspected bad export", () => {
    const out = findGhosts(
      [snap("a", 0, { friends: crowd(3) }), snap("b", 30, { friends: [], deleted: { elsewhere: 1 } })],
      { now: NOW },
    );
    expect(out).toHaveLength(3);
    for (const c of out) {
      expect(c.confidence).toBe("low");
      expect(c.score).toBeLessThanOrEqual(0.3);
      expect(signals(c)).toContain("mass-disappearance");
    }
  });

  it("does not count a bad export as confirmation", () => {
    const friends = crowd(10);
    const base = snap("a", 0, { friends: [...friends, "x"] });
    const withBad = findGhosts([base, snap("b", 30, { friends: [] }), snap("c", 60, { friends })], { now: NOW });
    expect(withBad.map((c) => c.key)).toEqual(["x"]);
    expect(signals(withBad[0]!)).not.toContain("absent-in-multiple-later-exports");
    expect(signals(withBad[0]!)).not.toContain("mass-disappearance");
  });
});

describe("date-range cutoff guard", () => {
  const friends = crowd(10);
  const since = (keys: string[], at: number) => Object.fromEntries(keys.map((k) => [k, at]));

  it("caps and labels candidates when every missing friend predates every remaining friend", () => {
    const old = ["old1", "old2"];
    const out = findGhosts(
      [
        snap("a", 0, { friends: [...friends, ...old], friendSince: { ...since(friends, T0 - YEAR), ...since(old, T0 - 4 * YEAR) } }),
        snap("b", 30, { friends, friendSince: since(friends, T0 - YEAR) }),
      ],
      { now: NOW },
    );
    expect(out.map((c) => c.key).sort()).toEqual(old);
    for (const c of out) {
      expect(c.score).toBeLessThanOrEqual(0.3);
      expect(c.confidence).toBe("low");
      expect(c.evidence.find((e) => e.signal === "looks-like-date-range-cutoff")?.weight).toBe(0);
      expect(signals(c)).not.toContain("mass-disappearance");
    }
  });

  it("does not trigger when a missing friend is newer than some remaining friend", () => {
    const out = findGhosts(
      [
        snap("a", 0, { friends: [...friends, "old", "mid"], friendSince: { ...since(friends, T0 - YEAR), old: T0 - 4 * YEAR, mid: T0 - YEAR / 2 } }),
        snap("b", 30, { friends, friendSince: since(friends, T0 - YEAR) }),
      ],
      { now: NOW },
    );
    expect(out).toHaveLength(2);
    for (const c of out) expect(signals(c)).not.toContain("looks-like-date-range-cutoff");
  });

  it("does not trigger when start dates are unknown on either side", () => {
    const noRemaining = findGhosts(
      [snap("a", 0, { friends: [...friends, "x"], friendSince: { x: T0 - 4 * YEAR } }), snap("b", 30, { friends })],
      { now: NOW },
    );
    expect(signals(noRemaining[0]!)).not.toContain("looks-like-date-range-cutoff");

    const noGhostDate = findGhosts(
      [
        snap("a", 0, { friends: [...friends, "x"], friendSince: since(friends, T0 - YEAR) }),
        snap("b", 30, { friends, friendSince: since(friends, T0 - YEAR) }),
      ],
      { now: NOW },
    );
    expect(signals(noGhostDate[0]!)).not.toContain("looks-like-date-range-cutoff");
  });
});

describe("unicode and prototype-like usernames", () => {
  it("handles unicode keys and prototype-named users", () => {
    const friends = crowd(10);
    const out = findGhosts(
      [snap("a", 0, { friends: [...friends, "josé", "李雷", "émile", "constructor"] }), snap("b", 30, { friends })],
      { now: NOW, exclude: ["JOSÉ"] },
    );
    expect(out.map((c) => c.key).sort()).toEqual(["constructor", "émile", "李雷"].sort());
  });
});

describe("no echo of user data", () => {
  it("never puts a username in evidence text", () => {
    const friends = crowd(10);
    const names = ["canary_alpha", "canary_beta", "ça-va_李雷", "constructor"];
    const out = [
      ...findGhosts(
        [
          snap("a", 0, { friends: [...friends, ...names], friendSince: { canary_alpha: T0 - 3 * YEAR } }),
          snap("b", 30, { friends }),
          snap("c", 60, { friends }),
        ],
        { now: NOW },
      ),
      // The mass-disappearance variant has its own explanatory text.
      ...findGhosts([snap("a", 0, { friends: names }), snap("b", 30, { friends: [] })], { now: NOW }),
    ];
    expect(out).toHaveLength(8);
    for (const c of out) {
      for (const e of c.evidence) {
        for (const n of names) expect(e.detail.toLowerCase()).not.toContain(n.toLowerCase());
      }
    }
  });
});

describe("performance", () => {
  it("handles 5000 friends over several snapshots in under 500 ms", () => {
    const rnd = seededRandom(42);
    const all = crowd(5000, "friend");
    const keep = (p: number) => all.filter(() => rnd() > p);
    const snaps = [
      snap("a", 0, { friends: all }),
      snap("b", 30, { friends: keep(0.05) }),
      snap("c", 60, { friends: keep(0.1) }),
      snap("d", 90, { friends: keep(0.15) }),
    ];
    const start = performance.now();
    const out = findGhosts(snaps, { now: NOW });
    const elapsed = performance.now() - start;
    expect(out.length).toBeGreaterThan(300);
    expect(elapsed).toBeLessThan(500);
  });
});
