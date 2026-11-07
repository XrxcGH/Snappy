import { describe, expect, it } from "vitest";
import { REPLY_SPEED_DEFAULTS, findReplySpeed } from "../../src/insights/reply-speed.ts";
import type { ReplySpeedNote, ReplySpeedReport } from "../../src/insights/reply-speed.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { syntheticExportZip } from "../../src/testing/synthetic-export.ts";
import { DAY_MS } from "../../src/util.ts";
import type { ChatEvent } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 1, 12, 0, 0);
const START = Date.UTC(2025, 3, 1, 0, 0, 0); // Apr 1, midnight UTC (7+ weeks before NOW)
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const ev = (who: string, direction: ChatEvent["direction"], at: number, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  conversation: who,
  isGroup: false,
  direction,
  kind: "TEXT",
  at,
  ...extra,
});

/** `n` exchanges 3 days apart (beyond the window, so they never link): one side writes, the other answers `gap` ms later. */
const exchanges = (who: string, n: number, gap: number, first: "received" | "sent", startAt = START): ChatEvent[] => {
  const second = first === "received" ? "sent" : "received";
  return Array.from({ length: n }, (_, i) => [
    ev(who, first, startAt + i * 3 * DAY_MS),
    ev(who, second, startAt + i * 3 * DAY_MS + gap),
  ]).flat();
};

const run = (events: ChatEvent[], extra: Record<string, unknown> = {}) => findReplySpeed(events, { now: NOW, ...extra });
const note = (notes: ReplySpeedNote[], c: string) => notes.find((n) => n.code === c);

describe("findReplySpeed: reply counting", () => {
  it("handles empty input", () => {
    const r = run([]);
    expect(r.notes).toEqual([{ code: "no-events", params: {} }]);
    expect(r.overall).toEqual({ you: null, them: null });
    expect(r.friends).toEqual([]);
    expect(r.byHour).toHaveLength(24);
    expect(r.summary).toEqual({ people: 0, peopleWithReplies: 0, peopleListed: 0, youReplies: 0, themReplies: 0 });
  });

  it("rejects an unusable now without throwing", () => {
    const r = findReplySpeed([ev("amy", "sent", START)], { now: Number.NaN });
    expect(r.asOf).toBeNull();
    expect(r.notes).toEqual([{ code: "invalid-now", params: {} }]);
  });

  it("counts one reply in each direction and measures the gap", () => {
    const r = run([
      ev("amy", "received", START),
      ev("amy", "sent", START + 10 * MIN), // you answered in 10 min
      ev("amy", "received", START + 70 * MIN), // they answered in 60 min
    ]);
    expect(r.summary.youReplies).toBe(1);
    expect(r.summary.themReplies).toBe(1);
    expect(r.overall.you).toEqual({ replies: 1, medianMs: 10 * MIN, p90Ms: 10 * MIN });
    expect(r.overall.them).toEqual({ replies: 1, medianMs: 60 * MIN, p90Ms: 60 * MIN });
    // Under the default minimum of 5 the person gets no times, and is counted in a note.
    expect(r.friends).toEqual([]);
    expect(note(r.notes, "people-below-minimum")?.params).toEqual({ count: 1 });
  });

  it("has no replies from a single event or from one direction only", () => {
    const one = run([ev("amy", "sent", START)]);
    expect(one.overall).toEqual({ you: null, them: null });
    expect(note(one.notes, "no-replies-found")).toBeDefined();
    const same = run([ev("amy", "sent", START), ev("amy", "sent", START + MIN), ev("amy", "sent", START + 2 * MIN)]);
    expect(same.summary.youReplies + same.summary.themReplies).toBe(0);
  });

  it("treats a burst as one turn and measures from the last message before the flip", () => {
    const r = run([
      ev("bo", "received", START),
      ev("bo", "received", START + 30 * MIN),
      ev("bo", "received", START + 50 * MIN),
      ev("bo", "sent", START + 55 * MIN), // 5 min after the LAST received
      ev("bo", "sent", START + 56 * MIN),
    ]);
    expect(r.summary).toMatchObject({ youReplies: 1, themReplies: 0 });
    expect(r.overall.you?.medianMs).toBe(5 * MIN);
  });

  it("does not count a flip slower than the window, and counts it", () => {
    const r = run([ev("cy", "received", START), ev("cy", "sent", START + 24 * HOUR), ev("cy", "received", START + 49 * HOUR)]);
    // Exactly 24 hours counts; 25 hours does not.
    expect(r.summary).toMatchObject({ youReplies: 1, themReplies: 0 });
    expect(note(r.notes, "turns-after-window")?.params).toEqual({ count: 1 });
    const wide = run([ev("cy", "received", START), ev("cy", "sent", START + 30 * HOUR)], { maxReplyHours: 48 });
    expect(wide.summary.youReplies).toBe(1);
    expect(run([ev("cy", "received", START), ev("cy", "sent", START + 30 * HOUR)]).summary.youReplies).toBe(0);
  });

  it("never counts unknown direction, and does not let it split or bridge a turn", () => {
    const r = run([
      ev("di", "received", START),
      ev("di", "unknown", START + 5 * MIN),
      ev("di", "sent", START + 20 * MIN),
      ev("di", "unknown", START + 30 * MIN),
      ev("di", "weird" as ChatEvent["direction"], START + 31 * MIN),
    ]);
    expect(r.summary).toMatchObject({ youReplies: 1, themReplies: 0 });
    expect(r.overall.you?.medianMs).toBe(20 * MIN);
    expect(note(r.notes, "events-direction-unknown")?.params).toEqual({ count: 3 });
    const onlyUnknown = run([ev("ed", "unknown", START), ev("ed", "unknown", START + MIN)]);
    expect(onlyUnknown.summary.people).toBe(0);
    expect(onlyUnknown.overall).toEqual({ you: null, them: null });
  });

  it("does not count a flip at the very same millisecond", () => {
    const r = run([ev("fay", "received", START), ev("fay", "sent", START), ev("fay", "received", START + 2 * MIN)]);
    expect(note(r.notes, "turns-at-same-time")?.params).toEqual({ count: 1 });
    // received (tie) -> sent is skipped; sent -> received 2 min later is a reply by them.
    expect(r.summary).toMatchObject({ youReplies: 0, themReplies: 1 });
  });

  it("merges names that differ only by case and ignores input order", () => {
    const events = [
      ev("Gus", "received", START),
      ev("gus", "sent", START + 5 * MIN),
      ev("GUS", "received", START + 3 * DAY_MS),
      ev("gUs", "sent", START + 3 * DAY_MS + 7 * MIN),
    ];
    const a = run(events, { minReplies: 1 });
    const b = run([...events].reverse(), { minReplies: 1 });
    expect(a).toEqual(b);
    expect(a.friends.map((f) => f.username)).toEqual(["gus"]);
    expect(a.friends[0]).toMatchObject({ youReplies: 2, themReplies: 0 });
    expect(a.friends[0]?.you).toEqual({ medianMs: 6 * MIN, p90Ms: 7 * MIN });
  });

  it("leaves out group chats and counts them", () => {
    const g = [
      ...exchanges("group:abc123", 6, MIN, "received").map((e) => ({ ...e, isGroup: true })),
      ...exchanges("group:def456", 6, MIN, "received"), // flag missing, key still marks it
    ];
    const r = run([...g, ...exchanges("hal", 6, 5 * MIN, "received")]);
    expect(r.friends.map((f) => f.username)).toEqual(["hal"]);
    expect(note(r.notes, "group-events-skipped")?.params).toEqual({ count: 24 });
    expect(note(run(g).notes, "no-one-to-one-events")).toBeDefined();
  });

  it("ignores missing, non-finite, zero and future times, and counts them", () => {
    const bad = [
      ev("ivy", "received", undefined as unknown as number),
      ev("ivy", "received", Number.NaN),
      ev("ivy", "received", Infinity),
      ev("ivy", "received", 0),
      ev("ivy", "received", -5),
    ];
    const r = run([...bad, ev("ivy", "sent", START), ev("ivy", "received", NOW + HOUR), ev("ivy", "received", START + MIN)]);
    expect(note(r.notes, "events-without-time")?.params).toEqual({ count: 5 });
    expect(note(r.notes, "events-in-future")?.params).toEqual({ count: 1 });
    expect(r.summary).toMatchObject({ youReplies: 0, themReplies: 1 });
    expect(run(bad).summary.people).toBe(0);
  });

  it("ignores events with no person", () => {
    const r = run([ev("  ", "sent", START), ev("", "received", START + MIN)]);
    expect(note(r.notes, "events-without-person")?.params).toEqual({ count: 2 });
  });

  it("limits the result to current friends when given", () => {
    const events = [...exchanges("ned", 6, MIN, "received"), ...exchanges("oli", 6, MIN, "received")];
    const r = run(events, { friends: ["NED"] });
    expect(r.friends.map((f) => f.username)).toEqual(["ned"]);
    expect(r.summary.people).toBe(1);
    expect(note(r.notes, "people-not-in-friends")?.params).toEqual({ count: 1 });
  });
});

describe("findReplySpeed: statistics", () => {
  const gapsFor = (gaps: number[], first: "received" | "sent" = "received") =>
    gaps.flatMap((g, i) => {
      const t = START + i * 2 * DAY_MS;
      return [ev("pat", first, t), ev("pat", first === "received" ? "sent" : "received", t + g)];
    });

  it("takes the true median (mean of the middle two, rounded) and nearest-rank 90th percentile", () => {
    const odd = run(gapsFor([1, 2, 3, 4, 5].map((m) => m * MIN)), { minReplies: 1 });
    expect(odd.overall.you).toEqual({ replies: 5, medianMs: 3 * MIN, p90Ms: 5 * MIN });
    const even = run(gapsFor([1000, 2001, 5000, 9000]), { minReplies: 1 });
    expect(even.overall.you).toMatchObject({ medianMs: 3501, p90Ms: 9000 }); // (2001+5000)/2 = 3500.5 -> 3501
    // Ten values: the 90th percentile is the 9th, not the 10th.
    const ten = run(gapsFor(Array.from({ length: 10 }, (_, i) => (i + 1) * MIN)), { minReplies: 1 });
    expect(ten.overall.you).toMatchObject({ medianMs: 5.5 * MIN, p90Ms: 9 * MIN });
    // Eleven values: the 10th (ceil(9.9)).
    const eleven = run(gapsFor(Array.from({ length: 11 }, (_, i) => (i + 1) * MIN)), { minReplies: 1 });
    expect(eleven.overall.you).toMatchObject({ medianMs: 6 * MIN, p90Ms: 10 * MIN });
  });

  it("does not depend on input order for the statistics", () => {
    const events = gapsFor([9, 1, 7, 3, 5, 2, 8].map((m) => m * MIN));
    expect(run(events)).toEqual(run([...events].reverse()));
  });

  it("keeps you and them apart", () => {
    const r = run([...exchanges("quin", 6, 2 * MIN, "received"), ...exchanges("quin", 6, 30 * MIN, "sent", START + 20 * DAY_MS)]);
    // received then sent = you replied in 2 min; sent then received = they replied in 30 min.
    expect(r.overall.you?.medianMs).toBe(2 * MIN);
    expect(r.overall.them?.medianMs).toBe(30 * MIN);
  });

  it("reports few replies overall in a note", () => {
    const r = run(exchanges("rex", 2, MIN, "received"));
    expect(note(r.notes, "few-replies-overall")?.params).toEqual({ count: 0, minimum: 5 });
    const enough = run(exchanges("rex", 6, MIN, "received"));
    expect(note(enough.notes, "few-replies-overall")?.params).toEqual({ count: 0, minimum: 5 }); // them has none
    const both = run([...exchanges("rex", 6, MIN, "received"), ...exchanges("rex", 6, MIN, "sent", START + 20 * DAY_MS)]);
    expect(note(both.notes, "few-replies-overall")).toBeUndefined();
  });
});

describe("findReplySpeed: per friend", () => {
  it("gives times only to a side with enough replies, and lists the person when one side qualifies", () => {
    const r = run([...exchanges("sue", 5, 3 * MIN, "received"), ...exchanges("sue", 2, 9 * MIN, "sent", START + 20 * DAY_MS)]);
    expect(r.friends).toEqual([
      {
        username: "sue",
        youReplies: 5,
        themReplies: 2,
        you: { medianMs: 3 * MIN, p90Ms: 3 * MIN },
        them: null,
      },
    ]);
    expect(r.summary).toMatchObject({ peopleWithReplies: 1, peopleListed: 1 });
  });

  it("honors the minimum replies setting", () => {
    const events = exchanges("tia", 4, MIN, "received");
    expect(run(events).friends).toEqual([]);
    expect(run(events, { minReplies: 4 }).friends).toHaveLength(1);
    expect(run(events, { minReplies: 0 }).minReplies).toBe(1); // clamped
    expect(run(events, { minReplies: Number.NaN }).minReplies).toBe(REPLY_SPEED_DEFAULTS.minReplies);
  });

  it("orders the table by replies, then username", () => {
    const r = run([
      ...exchanges("zed", 6, MIN, "received"),
      ...exchanges("abe", 6, MIN, "received"),
      ...exchanges("mo", 9, MIN, "received"),
    ]);
    expect(r.friends.map((f) => f.username)).toEqual(["mo", "abe", "zed"]);
  });

  it("ranks the fastest and slowest friends in each direction by median", () => {
    const people = [
      ["f1", 1],
      ["f2", 2],
      ["f3", 3],
      ["f4", 4],
      ["f5", 5],
      ["f6", 6],
      ["f7", 7],
    ] as const;
    const events = people.flatMap(([who, m]) => exchanges(who, 5, m * MIN, "received"));
    // They also answer you, at the reverse speed (f1 slowest).
    const theirs = people.flatMap(([who, m]) => exchanges(who, 5, (8 - m) * MIN, "sent", START + 30 * DAY_MS));
    const r = run([...events, ...theirs]);
    expect(r.fastest.you.map((x) => x.username)).toEqual(["f1", "f2", "f3"]);
    expect(r.slowest.you.map((x) => x.username)).toEqual(["f7", "f6", "f5"]);
    expect(r.fastest.them.map((x) => x.username)).toEqual(["f7", "f6", "f5"]);
    expect(r.slowest.them.map((x) => x.username)).toEqual(["f1", "f2", "f3"]);
    expect(r.fastest.you[0]).toEqual({ username: "f1", replies: 5, medianMs: MIN, p90Ms: MIN });
  });

  it("never shows the same person as both fastest and slowest, and breaks ties by username", () => {
    const one = run(exchanges("solo", 6, MIN, "received"));
    expect(one.fastest.you).toEqual([]);
    expect(one.slowest.you).toEqual([]);
    const three = run([...exchanges("c", 6, MIN, "received"), ...exchanges("b", 6, MIN, "received"), ...exchanges("a", 6, 9 * MIN, "received")]);
    // Three people, one place each; the tie on median goes to the lower username.
    expect(three.fastest.you.map((x) => x.username)).toEqual(["b"]);
    expect(three.slowest.you.map((x) => x.username)).toEqual(["a"]);
    const four = run(
      ["a", "b", "c", "d"].flatMap((w, i) => exchanges(w, 6, (i + 1) * MIN, "received")),
      { topN: 10 },
    );
    expect(four.fastest.you.map((x) => x.username)).toEqual(["a", "b"]);
    expect(four.slowest.you.map((x) => x.username)).toEqual(["d", "c"]);
  });
});

describe("findReplySpeed: hour of day", () => {
  // Replies are sent at 09:xx UTC on each of 6 days.
  const nine = (offsetStart: number): ChatEvent[] =>
    Array.from({ length: 6 }, (_, i) => {
      const t = START + i * 3 * DAY_MS + 9 * HOUR + offsetStart;
      return [ev("uma", "received", t), ev("uma", "sent", t + 4 * MIN)];
    }).flat();

  it("buckets by the hour the reply was sent", () => {
    const r = run(nine(0));
    expect(r.byHour.filter((h) => h.youReplies > 0).map((h) => h.hour)).toEqual([9]);
    expect(r.byHour[9]).toEqual({ hour: 9, youReplies: 6, themReplies: 0, youMedianMs: 4 * MIN, themMedianMs: null });
    expect(r.byHour.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it("holds back the hourly median below the minimum replies", () => {
    const r = run(nine(0).slice(0, 8)); // 4 replies
    expect(r.byHour[9]).toMatchObject({ youReplies: 4, youMedianMs: null });
    expect(run(nine(0).slice(0, 8), { minReplies: 4 }).byHour[9]?.youMedianMs).toBe(4 * MIN);
  });

  it("shifts hours by the UTC offset, across midnight and for half hours", () => {
    expect(run(nine(0), { utcOffsetMinutes: -300 }).byHour[4]?.youReplies).toBe(6); // 09:04 UTC = 04:04 at UTC-5
    expect(run(nine(0), { utcOffsetMinutes: 330 }).byHour[14]?.youReplies).toBe(6); // 14:34 at UTC+5:30
    const late = run(nine(14 * HOUR), { utcOffsetMinutes: 120 }); // 23:04 UTC = 01:04 at UTC+2, next day
    expect(late.byHour[1]?.youReplies).toBe(6);
    expect(late.utcOffsetMinutes).toBe(120);
  });

  it("clamps and notes an unusable offset", () => {
    const r = run(nine(0), { utcOffsetMinutes: 5000 });
    expect(r.utcOffsetMinutes).toBe(840);
    expect(note(r.notes, "offset-adjusted")?.params).toEqual({ minutes: 840 });
    const nan = run(nine(0), { utcOffsetMinutes: Number.NaN });
    expect(nan.utcOffsetMinutes).toBe(0);
    expect(note(nan.notes, "offset-adjusted")?.params).toEqual({ minutes: 0 });
    expect(note(run(nine(0), { utcOffsetMinutes: 60 }).notes, "offset-adjusted")).toBeUndefined();
    expect(note(run(nine(0)).notes, "offset-adjusted")).toBeUndefined();
  });

  it("handles a leap day and the end of a day in the offset", () => {
    const leap = Date.UTC(2024, 1, 29, 23, 58, 0);
    const events = Array.from({ length: 5 }, (_, i) => {
      const t = leap - i * 7 * DAY_MS - 4 * MIN; // Feb 29 and earlier weeks, all at 23:5x
      return [ev("val", "received", t), ev("val", "sent", t + 3 * MIN)];
    }).flat();
    const utc = run(events);
    expect(utc.byHour[23]?.youReplies).toBe(5);
    const east = run(events, { utcOffsetMinutes: 60 }); // 00:5x the next day
    expect(east.byHour[0]?.youReplies).toBe(5);
  });
});

describe("findReplySpeed: scale, determinism and privacy", () => {
  it("handles 12,000 people and 100,000+ events fast, deterministically", () => {
    const events: ChatEvent[] = [];
    for (let i = 0; i < 12_000; i++) {
      const who = `person_${String(i).padStart(5, "0")}`;
      for (let k = 0; k < 4; k++) {
        const t = START + (i % 20) * HOUR + k * 3 * DAY_MS;
        events.push(ev(who, "received", t), ev(who, "sent", t + ((i % 9) + 1) * MIN));
        events.push(ev(who, "sent", t + 5 * HOUR), ev(who, "received", t + 5 * HOUR + ((i % 5) + 1) * MIN));
      }
      events.push(ev(who, "unknown", START + 40 * DAY_MS));
    }
    expect(events.length).toBeGreaterThan(100_000);
    const t0 = performance.now();
    const a = run(events, { minReplies: 4 });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(3000);
    expect(a.summary.people).toBe(12_000);
    expect(a.summary.peopleListed).toBe(12_000);
    expect(a.summary.youReplies).toBe(12_000 * 4);
    expect(run([...events].reverse(), { minReplies: 4 })).toEqual(a);
  });

  it("is a pure function of its inputs", () => {
    const events = exchanges("sam", 6, MIN, "received");
    const copy = JSON.stringify(events);
    expect(run(events)).toEqual(run(events));
    expect(JSON.stringify(events)).toBe(copy);
  });

  it("puts a canary username only in the rows that list people, never in notes", () => {
    const canary = "zqcanary_reply_user";
    const events: ChatEvent[] = [
      ...exchanges(canary, 6, MIN, "received"),
      ...exchanges(`${canary}_b`, 6, 4 * MIN, "received"),
      ...exchanges(`${canary}_c`, 6, 9 * MIN, "received"),
      ev(`${canary}_d`, "received", START),
      ev(`${canary}_d`, "sent", START + 2 * MIN),
      ev(`${canary}_e`, "unknown", START),
      ev(`${canary}_f`, "sent", Number.NaN),
      ev(`${canary}_g`, "sent", NOW + DAY_MS),
      ev(`${canary}_h`, "received", START),
      ev(`${canary}_h`, "sent", START + 3 * DAY_MS),
      ev(`${canary}_i`, "received", START),
      ev(`${canary}_i`, "sent", START),
      ev("group:" + canary, "sent", START, { isGroup: true }),
      ev(`${canary}_j`, "sent", START),
    ];
    const r = run(events, { friends: [canary, `${canary}_b`, `${canary}_c`, `${canary}_d`, `${canary}_h`, `${canary}_i`, `${canary}_e`], utcOffsetMinutes: 99999 });
    expect(r.notes.length).toBeGreaterThan(6);
    for (const n of r.notes) {
      expect(Object.keys(n).sort()).toEqual(["code", "params"]);
      for (const v of Object.values(n.params)) expect(typeof v).toBe("number");
      expect(n.code).toMatch(/^[a-z-]+$/);
    }
    expect(JSON.stringify(r.notes)).not.toContain(canary);
    expect(JSON.stringify(r.summary)).not.toContain(canary);
    expect(JSON.stringify(r.overall)).not.toContain(canary);
    expect(JSON.stringify(r.byHour)).not.toContain(canary);
    // People appear only in the table and the ranked lists.
    expect(JSON.stringify(r.friends)).toContain(canary);
    const rowless: ReplySpeedReport = {
      ...r,
      friends: [],
      fastest: { you: [], them: [] },
      slowest: { you: [], them: [] },
    };
    expect(JSON.stringify(rowless)).not.toContain(canary);
  });

  it("reads only conversation, group flag, direction and time (extra fields are never copied)", () => {
    const sneaky = exchanges("wes", 6, MIN, "received").map((e) => ({ ...e, kind: "TEXT", text: "zqcanary_body", title: "zqcanary_title" }));
    expect(JSON.stringify(run(sneaky as ChatEvent[]))).not.toContain("zqcanary");
  });

  it("works on a built-in synthetic export", () => {
    const parsed = parseExportZip(syntheticExportZip({ now: NOW, seed: 7, friendCount: 40 }));
    const friends = parsed.friends.friends.map((f) => f.username);
    const a = findReplySpeed(parsed.chats, { now: NOW, friends, minReplies: 2 });
    expect(a.summary.people).toBeGreaterThan(0);
    expect(findReplySpeed(parsed.chats, { now: NOW, friends, minReplies: 2 })).toEqual(a);
    for (const row of a.friends) {
      for (const side of [row.you, row.them]) if (side) expect(side.p90Ms).toBeGreaterThanOrEqual(side.medianMs);
    }
    const total = a.byHour.reduce((s, h) => s + h.youReplies + h.themReplies, 0);
    expect(total).toBe(a.summary.youReplies + a.summary.themReplies);
  });
});
