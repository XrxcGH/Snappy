import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  MAX_BACKUP_CHARS,
  MAX_BACKUP_ENTRIES,
  backupToJson,
  backupToRows,
  compareFriendsBackup,
  createFriendsBackup,
  parseFriendsBackup,
} from "../../src/insights/friends-backup.ts";
import type { FriendsBackup } from "../../src/insights/friends-backup.ts";
import { parseFriendsJson } from "../../src/export/friends.ts";
import { buildSyntheticExport } from "../../src/testing/synthetic-export.ts";
import { openText, sealText } from "../../src/ledger/seal.ts";
import { MAX_USERNAME_LENGTH } from "../../src/util.ts";

const NOW = Date.UTC(2026, 10, 6);
const T = Date.UTC(2024, 2, 1);
const CANARY = "zz_canary_user_7391";

const names = (n: number, prefix = "u") => Array.from({ length: n }, (_, i) => ({ username: `${prefix}${String(i).padStart(6, "0")}` }));
const make = (friends: unknown[], extra: { blocked?: unknown[]; ignored?: unknown[] } = {}, now = NOW) =>
  createFriendsBackup({ friends, ...extra } as never, now);
const codes = (notes: { code: string }[]) => notes.map((n) => n.code);

describe("createFriendsBackup", () => {
  it("handles empty input", () => {
    const { backup, notes } = make([]);
    expect(backup).toEqual({ format: BACKUP_FORMAT, version: 1, takenAt: NOW, friends: [], blocked: [], ignored: [] });
    expect(notes).toEqual([{ code: "friends-empty", params: {} }]);
  });

  it("handles one friend, with and without a time", () => {
    expect(make([{ username: "Ann", createdAt: T }]).backup.friends).toEqual([{ username: "ann", createdAt: T }]);
    expect(make([{ username: "ann" }]).backup.friends).toEqual([{ username: "ann" }]);
  });

  it("normalizes, merges names that differ only by case and keeps the earliest time", () => {
    const { backup, notes } = make([{ username: "Bob", createdAt: T + 5 }, { username: " bob " }, { username: "BOB", createdAt: T }, { username: "cy" }]);
    expect(backup.friends).toEqual([{ username: "bob", createdAt: T }, { username: "cy" }]);
    expect(notes).toEqual([{ code: "duplicates-merged", params: { count: 2 } }]);
  });

  it("treats missing, invalid and future times as unknown, and counts them", () => {
    const { backup, notes } = make([
      { username: "a" },
      { username: "b", createdAt: undefined },
      { username: "c", createdAt: Number.NaN },
      { username: "d", createdAt: -5 },
      { username: "e", createdAt: 0 },
      { username: "f", createdAt: NOW + 1 },
      { username: "g", createdAt: NOW },
      { username: "h", createdAt: "yesterday" },
    ]);
    expect(backup.friends.filter((e) => e.createdAt !== undefined)).toEqual([{ username: "g", createdAt: NOW }]);
    expect(backup.friends).toHaveLength(8);
    expect(notes).toEqual([
      { code: "timestamps-invalid", params: { count: 4 } },
      { code: "timestamps-in-future", params: { count: 1 } },
    ]);
  });

  it("skips empty, non-text and overlong usernames", () => {
    const { backup, notes } = make([{ username: "" }, { username: "   " }, { username: 7 }, null, { username: "x".repeat(MAX_USERNAME_LENGTH + 1) }, { username: "ok" }]);
    expect(backup.friends).toEqual([{ username: "ok" }]);
    expect(notes).toEqual([{ code: "usernames-skipped", params: { count: 5 } }]);
  });

  it("keeps blocked and ignored lists and notes an overlap with friends", () => {
    const { backup, notes } = make([{ username: "a" }, { username: "b" }], { blocked: [{ username: "B" }, { username: "z" }], ignored: [{ username: "i" }] });
    expect(backup.blocked.map((e) => e.username)).toEqual(["b", "z"]);
    expect(backup.ignored.map((e) => e.username)).toEqual(["i"]);
    expect(notes).toEqual([{ code: "lists-overlap", params: { count: 1 } }]);
  });

  it("records an unusable clock as unknown instead of inventing a time", () => {
    const { backup, notes } = make([{ username: "a", createdAt: T }], {}, Number.NaN);
    expect(backup.takenAt).toBeNull();
    expect(codes(notes)).toEqual(["time-unknown"]);
    expect(backup.friends).toEqual([{ username: "a", createdAt: T }]);
  });

  it("sorts by username with plain code unit order and is independent of input order", () => {
    const input = [{ username: "b" }, { username: "a_" }, { username: "a1" }, { username: "A" }, { username: "_x" }, { username: "ab" }];
    const one = make(input).backup;
    const two = make([...input].reverse()).backup;
    expect(one.friends.map((e) => e.username)).toEqual(["_x", "a", "a1", "a_", "ab", "b"]);
    expect(backupToJson(one)).toBe(backupToJson(two));
  });

  it("caps a list and says how many entries were left out", () => {
    const { backup, notes } = make(names(MAX_BACKUP_ENTRIES + 3));
    expect(backup.friends).toHaveLength(MAX_BACKUP_ENTRIES);
    expect(notes).toEqual([{ code: "entries-over-limit", params: { count: 3 } }]);
  });

  it("does not change its input", () => {
    const input = [{ username: "B" }, { username: "a", createdAt: T }];
    const copy = JSON.parse(JSON.stringify(input));
    make(input);
    expect(input).toEqual(copy);
  });
});

describe("backupToJson and parseFriendsBackup", () => {
  const sample = (): FriendsBackup =>
    make([{ username: "ann", createdAt: T }, { username: "bob" }], { blocked: [{ username: "cy", createdAt: T + 1 }], ignored: [{ username: "di" }] }).backup;

  it("writes exact, key-ordered text that does not depend on extra properties", () => {
    const dirty = { ...sample(), extra: "x", friends: sample().friends.map((e) => ({ ...e, secret: "y" })) } as FriendsBackup;
    expect(backupToJson(dirty)).toBe(
      `{"format":"snappy-friends-backup","version":1,"takenAt":${NOW},"friends":[{"username":"ann","createdAt":${T}},{"username":"bob"}],"blocked":[{"username":"cy","createdAt":${T + 1}}],"ignored":[{"username":"di"}]}`,
    );
  });

  it("round-trips, and the text is stable across a round trip", () => {
    const text = backupToJson(sample());
    const parsed = parseFriendsBackup(text);
    expect(parsed).toEqual({ ok: true, backup: sample(), notes: [] });
    expect(backupToJson((parsed as { backup: FriendsBackup }).backup)).toBe(text);
  });

  it("can be sealed as text and restored unchanged", async () => {
    const text = backupToJson(sample());
    const sealed = await sealText(text, "test passphrase");
    expect(sealed.length).toBeGreaterThan(text.length);
    expect(await openText(sealed, "test passphrase")).toBe(text);
  });

  it("accepts a leading byte order mark, plain-string entries and missing optional lists", () => {
    const r = parseFriendsBackup(`﻿{"format":"${BACKUP_FORMAT}","version":1,"friends":["Ann",{"username":"bob"}]}`);
    expect(r).toMatchObject({ ok: true, backup: { takenAt: null, friends: [{ username: "ann" }, { username: "bob" }], blocked: [], ignored: [] } });
  });

  it("cleans entries the same way as creation, and can drop future times", () => {
    const text = `{"format":"${BACKUP_FORMAT}","version":1,"takenAt":${NOW},"friends":[{"username":"A","createdAt":${NOW + 9}},{"username":"a"},{"username":""},{"createdAt":5}]}`;
    const r = parseFriendsBackup(text, { now: NOW });
    expect(r).toMatchObject({ ok: true, backup: { friends: [{ username: "a" }] } });
    if (r.ok) {
      expect(r.notes).toEqual([
        { code: "usernames-skipped", params: { count: 2 } },
        { code: "duplicates-merged", params: { count: 1 } },
        { code: "timestamps-in-future", params: { count: 1 } },
      ]);
    }
    const keep = parseFriendsBackup(text);
    expect(keep).toMatchObject({ ok: true, backup: { friends: [{ username: "a", createdAt: NOW + 9 }] } });
  });

  it("rejects malformed input with a short code", () => {
    const cases: [unknown, string][] = [
      ["", "not-json"],
      ["{not json", "not-json"],
      ["null", "not-a-backup"],
      ["[]", "not-a-backup"],
      ["42", "not-a-backup"],
      [undefined, "not-a-backup"],
      [{ format: BACKUP_FORMAT }, "not-a-backup"],
      [`{"format":"other","version":1,"friends":[]}`, "not-a-backup"],
      [`{"format":"${BACKUP_FORMAT}","friends":[]}`, "not-a-backup"],
      [`{"format":"${BACKUP_FORMAT}","version":"1","friends":[]}`, "not-a-backup"],
      [`{"format":"${BACKUP_FORMAT}","version":1}`, "not-a-backup"],
      [`{"format":"${BACKUP_FORMAT}","version":1,"friends":{}}`, "not-a-backup"],
      [`{"format":"${BACKUP_FORMAT}","version":1,"friends":[],"blocked":"x"}`, "not-a-backup"],
      [`{"format":"${BACKUP_FORMAT}","version":2,"friends":[]}`, "unsupported-version"],
      [`{"format":"${BACKUP_FORMAT}","version":0,"friends":[]}`, "unsupported-version"],
    ];
    for (const [input, error] of cases) expect(parseFriendsBackup(input)).toEqual({ ok: false, error });
  });

  it("rejects oversized text and oversized lists without parsing them", () => {
    expect(parseFriendsBackup("x".repeat(MAX_BACKUP_CHARS + 1))).toEqual({ ok: false, error: "too-large" });
    const big = JSON.stringify({ format: BACKUP_FORMAT, version: 1, friends: Array.from({ length: MAX_BACKUP_ENTRIES + 1 }, () => 0) });
    expect(parseFriendsBackup(big)).toEqual({ ok: false, error: "too-many-entries" });
  });

  it("survives hostile shapes", () => {
    expect(parseFriendsBackup("[".repeat(200_000))).toEqual({ ok: false, error: "not-json" });
    const proto = `{"format":"${BACKUP_FORMAT}","version":1,"friends":[{"username":"a","__proto__":{"x":1}}],"__proto__":{"blocked":[{"username":"evil"}]}}`;
    const r = parseFriendsBackup(proto);
    expect(r).toMatchObject({ ok: true, backup: { friends: [{ username: "a" }], blocked: [] } });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("time normalization round trip", () => {
  const roundTrip = (b: FriendsBackup) => {
    const r = parseFriendsBackup(backupToJson(b));
    if (!r.ok) throw new Error("parse failed");
    return r.backup;
  };

  it("gives the same takenAt on create and after parse, for fractional, zero and negative now", () => {
    for (const now of [NOW + 0.7, 1.9, 0.5, 0, -5, Number.NaN]) {
      const { backup } = make([{ username: "a" }], {}, now);
      expect(roundTrip(backup).takenAt).toBe(backup.takenAt);
    }
    expect(make([], {}, NOW + 0.7).backup.takenAt).toBe(NOW);
    expect(make([], {}, 0).backup.takenAt).toBeNull();
    expect(make([], {}, 0.5).backup.takenAt).toBeNull();
    expect(codes(make([], {}, 0).notes)).toContain("time-unknown");
  });

  it("truncates a creation time before checking it, so 0.5 is invalid and 1.5 is stored as 1", () => {
    const { backup, notes } = make([{ username: "a", createdAt: 0.5 }, { username: "b", createdAt: 1.5 }, { username: "c", createdAt: T + 0.9 }]);
    expect(backup.friends).toEqual([{ username: "a" }, { username: "b", createdAt: 1 }, { username: "c", createdAt: T }]);
    expect(notes).toEqual([{ code: "timestamps-invalid", params: { count: 1 } }]);
    expect(roundTrip(backup)).toEqual(backup);
  });

  it("round-trips every backup to an equal backup", () => {
    const { backup } = make([{ username: "a", createdAt: 7.9 }, { username: "B", createdAt: T + 0.2 }, { username: "c" }], { blocked: [{ username: "z", createdAt: 0.1 }] }, 99.5);
    expect(roundTrip(backup)).toEqual(backup);
  });
});

describe("compareFriendsBackup", () => {
  const backup = make([{ username: "a" }, { username: "b" }, { username: "c" }], { blocked: [{ username: "x" }], ignored: [{ username: "i" }] }).backup;

  it("reports added, removed and unchanged with counts and sorted lists", () => {
    const r = compareFriendsBackup(backup, { friends: [{ username: "C" }, { username: "d" }, { username: "A" }, { username: " e " }] });
    expect(r.friends).toEqual({
      added: ["d", "e"],
      removed: ["b"],
      unchanged: ["a", "c"],
      counts: { backup: 3, current: 4, added: 2, removed: 1, unchanged: 2 },
    });
    expect(r.blocked).toBeNull();
    expect(r.ignored).toBeNull();
    expect(r.identical).toBe(false);
    expect(r.notes).toEqual([]);
  });

  it("is identical when the lists match, regardless of case, order and duplicates", () => {
    const r = compareFriendsBackup(backup, {
      friends: [{ username: "c" }, { username: "A" }, { username: "a" }, { username: "B" }],
      blocked: [{ username: "X" }],
      ignored: [{ username: "i" }],
    });
    expect(r.identical).toBe(true);
    expect(r.blocked?.counts).toEqual({ backup: 1, current: 1, added: 0, removed: 0, unchanged: 1 });
  });

  it("compares blocked and ignored when supplied", () => {
    const r = compareFriendsBackup(backup, { friends: [{ username: "a" }, { username: "b" }, { username: "c" }], blocked: [], ignored: [{ username: "j" }] });
    expect(r.blocked?.removed).toEqual(["x"]);
    expect(r.ignored).toMatchObject({ added: ["j"], removed: ["i"], unchanged: [] });
    expect(r.identical).toBe(false);
  });

  it("handles an empty backup and an empty current list", () => {
    const empty = make([]).backup;
    expect(compareFriendsBackup(empty, { friends: [] }).identical).toBe(true);
    expect(compareFriendsBackup(empty, { friends: [{ username: "a" }] }).friends.added).toEqual(["a"]);
    const r = compareFriendsBackup(backup, { friends: [] });
    expect(r.friends.removed).toEqual(["a", "b", "c"]);
    expect(r.notes).toEqual([{ code: "current-empty", params: { backup: 3 } }]);
  });

  it("flags a large loss in hedged, coded form", () => {
    const big = make(names(10)).backup;
    expect(compareFriendsBackup(big, { friends: names(6) }).notes).toEqual([]);
    expect(compareFriendsBackup(big, { friends: names(5) }).notes).toEqual([{ code: "many-removed", params: { removed: 5, backup: 10 } }]);
  });

  it("does not call a small loss many-removed below 10 backed-up friends", () => {
    const nine = make(names(9)).backup;
    expect(compareFriendsBackup(nine, { friends: names(4) }).notes).toEqual([]);
    expect(compareFriendsBackup(nine, { friends: [{ username: "other" }] }).notes).toEqual([]);
  });

  it("normalizes a hand-built backup, so case and repeats are not reported as changes", () => {
    const handmade = { format: BACKUP_FORMAT, version: 1, takenAt: null, friends: [{ username: "Ann" }, { username: "ANN" }, { username: " bo " }, { username: "" }], blocked: [], ignored: [] } as unknown as FriendsBackup;
    const r = compareFriendsBackup(handmade, { friends: [{ username: "ann" }, { username: "BO" }] });
    expect(r.friends).toEqual({ added: [], removed: [], unchanged: ["ann", "bo"], counts: { backup: 2, current: 2, added: 0, removed: 0, unchanged: 2 } });
    expect(r.identical).toBe(true);
  });

  it("notes current names that were left out, without echoing them", () => {
    const r = compareFriendsBackup(backup, {
      friends: [{ username: "a" }, { username: "" }, { username: CANARY.repeat(20) }, { username: 3 }, null] as never,
      blocked: [{ username: "   " }],
    });
    expect(r.notes).toEqual([{ code: "usernames-skipped", params: { count: 5 } }]);
    expect(JSON.stringify(r)).not.toContain(CANARY);
    expect(r.friends.counts.current).toBe(1);
  });

  it("does not treat a very long current list as missing friends", () => {
    const r = compareFriendsBackup(make(names(5)).backup, { friends: names(MAX_BACKUP_ENTRIES + 5) });
    expect(r.friends.counts.removed).toBe(0);
    expect(r.friends.counts.added).toBe(MAX_BACKUP_ENTRIES);
  });
});

describe("backupToRows", () => {
  it("gives one flat row per entry in a fixed order", () => {
    const { backup } = make([{ username: "b", createdAt: T }, { username: "a" }], { blocked: [{ username: "z" }], ignored: [{ username: "i" }] });
    expect(backupToRows(backup)).toEqual([
      { list: "friends", username: "a", createdAt: null },
      { list: "friends", username: "b", createdAt: T },
      { list: "blocked", username: "z", createdAt: null },
      { list: "ignored", username: "i", createdAt: null },
    ]);
    expect(backupToRows(make([]).backup)).toEqual([]);
  });
});

describe("scale", () => {
  it("handles 10,000+ items quickly and in a deterministic order", () => {
    const n = 60_000;
    const shuffled = names(n).map((e, i) => ({ ...e, username: i % 2 ? e.username.toUpperCase() : e.username, createdAt: T + i }));
    shuffled.reverse();
    const start = performance.now();
    const { backup } = make(shuffled);
    const text = backupToJson(backup);
    const parsed = parseFriendsBackup(text);
    const cmp = compareFriendsBackup(backup, { friends: shuffled.slice(0, n - 10) });
    expect(performance.now() - start).toBeLessThan(5000);
    expect(backup.friends).toHaveLength(n);
    expect(backup.friends[0]?.username).toBe("u000000");
    expect(parsed.ok && backupToJson(parsed.backup)).toBe(text);
    expect(cmp.friends.counts).toMatchObject({ added: 0, removed: 10, unchanged: n - 10 });
  });
});

describe("privacy", () => {
  it("uses the real friends parser output and synthetic data", () => {
    const files = buildSyntheticExport({ now: NOW, friendCount: 60 });
    const raw = JSON.parse(new TextDecoder().decode(files["json/friends.json"]));
    const { friends } = parseFriendsJson(raw);
    const { backup } = createFriendsBackup(friends, NOW);
    expect(backup.friends.length).toBe(new Set(friends.friends.map((f) => f.username)).size);
    expect(backup.blocked.length).toBeGreaterThan(0);
    // The backup holds only usernames and times: no display names, sources or modified times.
    expect(Object.keys(backup.friends[0] ?? {}).every((k) => k === "username" || k === "createdAt")).toBe(true);
    expect(compareFriendsBackup(backup, friends).identical).toBe(true);
  });

  it("puts a canary username only in the list fields, never in a note, error or code", () => {
    const { backup, notes } = make(
      [{ username: CANARY.toUpperCase(), createdAt: NOW + 1 }, { username: CANARY }, { username: CANARY.repeat(20) }, { username: "ok" }],
      { blocked: [{ username: CANARY }], ignored: [{ username: CANARY, createdAt: -1 }] },
    );
    expect(JSON.stringify(notes)).not.toContain(CANARY);
    expect(backup.friends.map((e) => e.username)).toContain(CANARY);
    expect(backupToJson(backup)).toContain(CANARY);

    const parsed = parseFriendsBackup(backupToJson(backup), { now: NOW });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(JSON.stringify(parsed.notes)).not.toContain(CANARY);

    // Rejections carry one fixed code and never any of the text, whatever it contains.
    const bad = [
      `{"format":"${BACKUP_FORMAT}","version":9,"friends":["${CANARY}"]}`,
      `{"format":"${BACKUP_FORMAT}","version":1,"friends":"${CANARY}"}`,
      `{"nope":"${CANARY}"`,
      `["${CANARY}"]`,
      CANARY.repeat(MAX_BACKUP_CHARS / CANARY.length + 2),
    ];
    for (const text of bad) expect(JSON.stringify(parseFriendsBackup(text))).not.toContain(CANARY);

    const cmp = compareFriendsBackup(backup, { friends: [] });
    expect(JSON.stringify(cmp.notes)).not.toContain(CANARY);
    expect(cmp.friends.removed).toContain(CANARY);
  });
});
