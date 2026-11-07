import { describe, expect, it } from "vitest";
import { findLookalikeUsernames } from "../../src/insights/lookalike-usernames.ts";
import type { LookalikeUsernamesInput } from "../../src/insights/lookalike-usernames.ts";
import { parseExportFiles } from "../../src/export/parse.ts";
import { buildSyntheticExport } from "../../src/testing/synthetic-export.ts";
import type { FriendRecord } from "../../src/types.ts";

const NOW = Date.UTC(2026, 5, 1);
const rec = (username: string): FriendRecord => ({ username });
const recs = (...names: string[]) => names.map(rec);
const run = (input: LookalikeUsernamesInput, extra: { minScore?: number; maxPairs?: number } = {}) =>
  findLookalikeUsernames(input, { now: NOW, ...extra });
const pairOf = (r: ReturnType<typeof run>, x: string, y: string) =>
  r.pairs.find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
const friends = (...names: string[]): LookalikeUsernamesInput => ({ friends: recs(...names) });

describe("findLookalikeUsernames", () => {
  it("handles empty input", () => {
    const r = run({});
    expect(r.pairs).toEqual([]);
    expect(r.totals).toEqual({ people: 0, pairs: 0, byLevel: { low: 0, medium: 0, high: 0 } });
    expect(r.notes).toEqual([{ code: "no-people", params: {} }]);
    expect(r.generatedAt).toBe(NOW);
  });

  it("handles one person and people who look nothing alike", () => {
    expect(run(friends("amy_lake")).notes).toEqual([{ code: "no-lookalikes", params: {} }]);
    const r = run(friends("amy_lake", "bob_stone", "cat_river"));
    expect(r.pairs).toEqual([]);
    expect(r.totals.people).toBe(3);
  });

  it("finds look-alike swaps and ranks them high", () => {
    const r = run(friends("mike_stone", "m1ke_st0ne", "tim_ber", "tirn_ber"));
    const p = pairOf(r, "mike_stone", "m1ke_st0ne")!;
    expect(p.reasons).toEqual(["lookalike-swap"]);
    expect(p.level).toBe("high");
    expect(pairOf(r, "tim_ber", "tirn_ber")!.reasons).toEqual(["lookalike-swap"]);
    expect(pairOf(r, "tim_ber", "tirn_ber")!.score).toBe(0.9);
  });

  it("treats 1, l and i as the same look", () => {
    const r = run(friends("pauline", "pau1ine", "paui1ne"));
    expect(pairOf(r, "pauline", "pau1ine")!.reasons).toEqual(["lookalike-swap"]);
    expect(pairOf(r, "pauline", "paulline")).toBeUndefined();
    expect(r.pairs.length).toBe(3);
  });

  it("finds names that differ only by separators", () => {
    const r = run(friends("jo.smith", "jo_smith", "josmith", "jo-smith"));
    expect(pairOf(r, "jo.smith", "jo_smith")!.reasons).toEqual(["separator-differs"]);
    expect(pairOf(r, "josmith", "jo_smith")!.reasons).toEqual(["separator-differs"]);
    expect(r.pairs).toHaveLength(6);
  });

  it("finds appended digits and different trailing digits", () => {
    const r = run(friends("sarah", "sarah22", "dana_k5", "dana_k7"));
    expect(pairOf(r, "sarah", "sarah22")!.reasons).toEqual(["appended-digits"]);
    expect(pairOf(r, "sarah", "sarah22")!.level).toBe("medium");
    const d = pairOf(r, "dana_k5", "dana_k7")!;
    expect(d.reasons).toEqual(["digits-differ"]);
    expect(d.level).toBe("low");
  });

  it("does not strip digits down to a tiny name", () => {
    const r = run(friends("a1", "a2", "bo12", "bo13"));
    expect(r.pairs).toEqual([]);
  });

  it("finds repeated characters", () => {
    const r = run(friends("aaron", "aron", "jessicaa", "jessica"));
    expect(pairOf(r, "aaron", "aron")!.reasons).toEqual(["repeated-characters"]);
    expect(pairOf(r, "jessica", "jessicaa")!.reasons).toEqual(["repeated-characters"]);
  });

  it("combines reasons when several transforms are needed", () => {
    const r = run(friends("mike_t", "m1kee.t", "m1ke.t"));
    const p = pairOf(r, "mike_t", "m1ke.t")!;
    expect(p.reasons).toEqual(["lookalike-swap", "separator-differs"]);
    expect(p.score).toBe(0.96);
    expect(pairOf(r, "mike_t", "m1kee.t")!.reasons).toEqual(["lookalike-swap", "separator-differs", "repeated-characters"]);
  });

  it("finds one-edit pairs only when both names have 6 or more characters", () => {
    const r = run(friends("kaylee", "kaylea", "marcus_p", "marcus_pp", "marcos_p", "peterk", "peterj", "petrek", "ab", "ac", "carol", "carlo", "bobby", "bobbi"));
    expect(pairOf(r, "kaylee", "kaylea")!.reasons).toEqual(["one-edit"]); // changed character
    expect(pairOf(r, "marcus_p", "marcos_p")!.reasons).toEqual(["one-edit"]);
    expect(pairOf(r, "peterk", "petrek")!.reasons).toEqual(["one-edit"]); // swapped neighbours
    expect(pairOf(r, "peterk", "peterj")!.reasons).toEqual(["one-edit"]);
    expect(pairOf(r, "marcus_p", "marcus_pp")!.reasons).toContain("repeated-characters");
    // Too short: five characters or fewer.
    expect(pairOf(r, "carol", "carlo")).toBeUndefined();
    expect(pairOf(r, "bobby", "bobbi")).toBeUndefined();
    expect(pairOf(r, "ab", "ac")).toBeUndefined();
  });

  it("does not pair names two edits apart", () => {
    const r = run(friends("kaylee", "kayloo", "kaleea", "maxwell_", "maxwelxy"));
    expect(pairOf(r, "kaylee", "kaleea")).toBeUndefined();
    expect(pairOf(r, "maxwell_", "maxwelxy")).toBeUndefined();
  });

  it("uses letter case only to merge duplicates", () => {
    const r = run(friends("Kaylee", "KAYLEE", " kaylee ", "kaylea"));
    expect(r.totals.people).toBe(2);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ a: "kaylea", b: "kaylee" });
    expect(r.notes).toContainEqual({ code: "case-duplicates", params: { count: 2 } });
  });

  it("never pairs a person with themselves across lists", () => {
    const r = run({ friends: recs("amy_lake"), blocked: recs("AMY_LAKE"), sentRequests: recs("amy_lake") });
    expect(r.totals.people).toBe(1);
    expect(r.pairs).toEqual([]);
    expect(r.notes).toEqual([{ code: "no-lookalikes", params: {} }]);
  });

  it("skips blank and overlong usernames and says how many", () => {
    const r = run({ friends: recs("  ", "", "amy_lake", "x".repeat(101), "amy.lake") });
    expect(r.totals.people).toBe(2);
    expect(r.notes).toContainEqual({ code: "blank-entries", params: { count: 2 } });
    expect(r.notes).toContainEqual({ code: "overlong-entries", params: { count: 1 } });
    expect(r.pairs).toHaveLength(1);
  });

  it("adds context for a request that resembles a friend or a blocked person", () => {
    const r = run({
      friends: recs("emma_jones", "liam_ross"),
      pendingRequests: recs("emma.jones"),
      blocked: recs("liam_r0ss", "noah_blake"),
      sentRequests: recs("noah_blaake"),
    });
    const emma = pairOf(r, "emma_jones", "emma.jones")!;
    expect(emma.contexts).toEqual(["pending-resembles-friend"]);
    expect(emma.score).toBe(0.7);
    expect(emma.a).toBe("emma.jones");
    expect(emma.aLists).toEqual(["pendingRequests"]);
    expect(emma.bLists).toEqual(["friends"]);
    const liam = pairOf(r, "liam_ross", "liam_r0ss")!;
    expect(liam.contexts).toEqual(["resembles-blocked"]);
    expect(liam.score).toBe(1);
    expect(pairOf(r, "noah_blake", "noah_blaake")!.contexts).toEqual(["resembles-blocked"]);
  });

  it("gives no context when two blocked people look alike or a sent request resembles a friend", () => {
    const r = run({ blocked: recs("troll_one", "troll.one"), friends: recs("zoe_hart"), sentRequests: recs("zoe.hart") });
    expect(pairOf(r, "troll_one", "troll.one")!.contexts).toEqual([]);
    expect(pairOf(r, "zoe_hart", "zoe.hart")!.contexts).toEqual([]);
  });

  it("orders by score then username, and honours minScore and maxPairs", () => {
    const input = friends("sarah", "sarah22", "mike_stone", "m1ke_stone", "dana_k5", "dana_k7");
    const all = run(input);
    expect(all.pairs.map((p) => p.level)).toEqual(["high", "medium", "low"]);
    expect(all.totals.byLevel).toEqual({ low: 1, medium: 1, high: 1 });
    const some = run(input, { minScore: 0.5 });
    expect(some.pairs).toHaveLength(2);
    expect(some.totals.pairs).toBe(2);
    const cut = run(input, { maxPairs: 1 });
    expect(cut.pairs).toHaveLength(1);
    expect(cut.totals.pairs).toBe(3);
    expect(cut.notes).toContainEqual({ code: "list-truncated", params: { shown: 1, total: 3 } });
    expect(run(input, { maxPairs: 0 }).pairs).toEqual([]);
  });

  it("skips numbered families instead of listing hundreds of pairs", () => {
    const names = Array.from({ length: 60 }, (_, i) => `fan_club${i + 10}`);
    const r = run(friends(...names, "amy.lake", "amy_lake"));
    expect(r.pairs).toHaveLength(1);
    expect(r.notes.some((n) => n.code === "crowded-groups" && n.params.people! >= 60)).toBe(true);
  });

  it("does not mutate its input and is deterministic", () => {
    const input: LookalikeUsernamesInput = { friends: recs("b_name", "b.name", "bname"), blocked: recs("b_n4me") };
    const copy = JSON.stringify(input);
    const one = run(input);
    expect(JSON.stringify(input)).toBe(copy);
    expect(run(input)).toEqual(one);
    expect(JSON.stringify(run({ friends: recs("bname", "b.name", "b_name"), blocked: recs("b_n4me") }))).toBe(JSON.stringify(one));
  });

  it("is fast on 5000 friends and 10 000+ names in all", () => {
    const syll = ["ka", "to", "mi", "ra", "lu", "ve", "no", "sa", "di", "ze", "po", "ha"];
    const name = (i: number) => {
      let s = "";
      let k = i;
      for (let p = 0; p < 4; p++) {
        s += syll[k % 12];
        k = Math.floor(k / 12);
      }
      return s + (i % 3 === 0 ? `_${i % 97}` : "");
    };
    const mk = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => rec(name(from + i)));
    const input: LookalikeUsernamesInput = {
      friends: [...mk(0, 5000), rec("kakaka_77"), rec("kakaka-77")],
      pendingRequests: mk(5000, 8000),
      sentRequests: mk(8000, 10_000),
      blocked: mk(10_000, 12_000),
    };
    const started = performance.now();
    const r = run(input);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(r.totals.people).toBeGreaterThan(5000);
    expect(r.pairs.length).toBeLessThanOrEqual(200);
  });

  it("works on the parsed synthetic export", () => {
    const parsed = parseExportFiles(buildSyntheticExport({ now: NOW }));
    const r = findLookalikeUsernames(parsed.friends, { now: NOW });
    expect(r.totals.people).toBeGreaterThan(0);
    expect(r.generatedAt).toBe(NOW);
    for (const p of r.pairs) {
      expect(p.a).not.toBe(p.b);
      expect(p.reasons.length).toBeGreaterThan(0);
    }
  });

  it("keeps a canary username only in the pair rows", () => {
    const canary = "zzcanary_lookalike_7f3a";
    const r = run({
      friends: recs(canary),
      pendingRequests: recs(canary.replace(/_/g, ".")),
      blocked: recs(canary.toUpperCase().replace("0", "o") + "9"),
      sentRequests: recs("  " + canary + " "),
    });
    expect(r.pairs.length).toBeGreaterThan(0);
    const rest = JSON.stringify({
      generatedAt: r.generatedAt,
      totals: r.totals,
      notes: r.notes,
      reasons: r.pairs.map((p) => ({ r: p.reasons, c: p.contexts, s: p.score, l: p.level })),
    });
    expect(rest).not.toContain("canary");
    expect(JSON.stringify(r.pairs)).toContain(canary);
  });
});
