import { describe, expect, it } from "vitest";
import {
  FRIENDS_CSV_HEADER,
  FRIENDS_TABLE_DEFAULTS,
  buildFriendsTable,
  csvCell,
  filterRows,
  sortRows,
  toCsv,
} from "../../src/insights/friends-table.ts";
import type { FriendRow, FriendsTableInput } from "../../src/insights/friends-table.ts";
import { parseExportZip } from "../../src/export/parse.ts";
import { syntheticExportZip } from "../../src/testing/synthetic-export.ts";
import { DAY_MS } from "../../src/util.ts";
import type { ChatEvent } from "../../src/types.ts";

const NOW = Date.UTC(2025, 5, 1, 12, 0, 0);

const ev = (who: string, direction: ChatEvent["direction"], daysAgo: number, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  conversation: who,
  isGroup: false,
  direction,
  kind: "TEXT",
  at: NOW - daysAgo * DAY_MS,
  ...extra,
});

const friend = (username: string, addedDaysAgo?: number) => ({
  username,
  ...(addedDaysAgo === undefined ? {} : { createdAt: NOW - addedDaysAgo * DAY_MS }),
});

const input = (friends: ReturnType<typeof friend>[], chats: ChatEvent[], exportedAt?: number): FriendsTableInput => ({
  friends: { friends },
  chats,
  ...(exportedAt === undefined ? {} : { exportedAt }),
});

const build = (i: FriendsTableInput, extra: { utcOffsetMinutes?: number } = {}) => buildFriendsTable(i, { now: NOW, ...extra });
const rowOf = (i: FriendsTableInput, name: string): FriendRow => {
  const r = build(i).rows.find((x) => x.username === name);
  if (!r) throw new Error("row missing");
  return r;
};
const codes = (i: FriendsTableInput) => build(i).notes.map((n) => n.code);

describe("buildFriendsTable: rows", () => {
  it("handles empty input", () => {
    const t = build(input([], []));
    expect(t.rows).toEqual([]);
    expect(t.notes).toEqual([{ code: "no-friends", params: {} }]);
    expect(t.summary).toEqual({ friends: 0, withEvents: 0, quiet: 0, oneSided: 0, waiting: 0 });
  });

  it("rejects an unusable now without throwing", () => {
    const t = buildFriendsTable(input([friend("amy")], []), { now: Number.NaN });
    expect(t.asOf).toBeNull();
    expect(t.notes).toEqual([{ code: "invalid-now", params: {} }]);
  });

  it("builds one friend with no events", () => {
    const t = build(input([friend("amy", 400)], []));
    expect(t.rows).toEqual([
      {
        id: "u:amy",
        username: "amy",
        addedAt: NOW - 400 * DAY_MS,
        firstAt: null,
        lastAt: null,
        addedDay: "2024-04-27",
        firstDay: null,
        lastDay: null,
        recent: 0,
        total: 0,
        sent: 0,
        received: 0,
        unknown: 0,
        quiet: false,
        oneSided: false,
        waiting: false,
        waitingOn: null,
      },
    ]);
    expect(t.notes).toEqual([{ code: "no-events", params: {} }]);
  });

  it("counts dates, totals, the 90 day window and the direction split", () => {
    const r = rowOf(
      input(
        [friend("amy", 500)],
        [ev("amy", "sent", 200), ev("amy", "received", 100), ev("amy", "sent", 89), ev("amy", "unknown", 91), ev("amy", "received", 1)],
      ),
      "amy",
    );
    expect(r.total).toBe(5);
    expect(r.recent).toBe(2);
    expect([r.sent, r.received, r.unknown]).toEqual([2, 2, 1]);
    expect(r.firstAt).toBe(NOW - 200 * DAY_MS);
    expect(r.lastAt).toBe(NOW - 1 * DAY_MS);
  });

  it("includes an event exactly at now and leaves out the boundary one 90 days back", () => {
    const r = rowOf(input([friend("amy", 500)], [ev("amy", "sent", 0), ev("amy", "sent", 90)]), "amy");
    expect(r.recent).toBe(1);
    expect(r.total).toBe(2);
  });

  it("merges case-different friends and conversations into one row", () => {
    const i = input([friend("Amy", 100), friend("AMY", 300), friend("amy")], [ev("AMY", "sent", 5), ev("amy", "received", 4), ev(" Amy ", "sent", 3)]);
    const t = build(i);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]?.addedAt).toBe(NOW - 300 * DAY_MS);
    expect(t.rows[0]?.total).toBe(3);
    expect(t.notes.find((n) => n.code === "friends-duplicates-merged")?.params).toEqual({ count: 2 });
  });

  it("keeps an added date when the first duplicate had none", () => {
    expect(rowOf(input([friend("amy"), friend("amy", 50)], []), "amy").addedAt).toBe(NOW - 50 * DAY_MS);
  });

  it("skips blank usernames and counts them", () => {
    const t = build(input([friend("  "), friend("")], []));
    expect(t.rows).toEqual([]);
    expect(t.notes.map((n) => n.code)).toEqual(["no-friends", "friends-invalid-username"]);
  });

  it("leaves out events without a time, in the future, in groups or with non-friends, and counts them", () => {
    const i = input(
      [friend("amy", 300)],
      [
        ev("amy", "sent", 5),
        ev("amy", "sent", 5, { at: Number.NaN }),
        ev("amy", "sent", 5, { at: undefined as unknown as number }),
        ev("amy", "sent", -3),
        ev("group:abc", "sent", 5, { isGroup: true }),
        ev("bo", "sent", 5),
      ],
    );
    const t = build(i);
    expect(t.rows[0]?.total).toBe(1);
    const by = Object.fromEntries(t.notes.map((n) => [n.code, n.params.count]));
    expect(by).toMatchObject({
      "events-without-time": 2,
      "events-in-future": 1,
      "group-events-skipped": 1,
      "events-not-with-friends": 1,
    });
  });

  it("measures from the export time when it is earlier than now", () => {
    const exportedAt = NOW - 100 * DAY_MS;
    const i = input([friend("amy", 500)], [ev("amy", "received", 102), ev("amy", "sent", 50)], exportedAt);
    const t = build(i);
    expect(t.asOf).toBe(exportedAt);
    expect(t.rows[0]?.total).toBe(1);
    expect(t.rows[0]?.waitingOn).toBeNull();
    expect(t.notes.map((n) => n.code)).toContain("events-in-future");
  });

  it("shows day text at the given offset, across a leap day", () => {
    const at = Date.UTC(2024, 1, 29, 23, 30);
    const base = input([{ username: "amy", createdAt: Date.UTC(2024, 1, 28, 12) }], [{ ...ev("amy", "sent", 0), at }]);
    expect(build(base).rows[0]?.firstDay).toBe("2024-02-29");
    expect(build(base, { utcOffsetMinutes: 60 }).rows[0]?.firstDay).toBe("2024-03-01");
    expect(build(base, { utcOffsetMinutes: -300 }).rows[0]?.firstDay).toBe("2024-02-29");
    expect(build(base, { utcOffsetMinutes: 60 }).rows[0]?.addedDay).toBe("2024-02-28");
    expect(build(base, { utcOffsetMinutes: 99999 }).rows[0]?.firstDay).toBe("2024-03-01");
    expect(build(base, { utcOffsetMinutes: Number.NaN }).rows[0]?.firstDay).toBe("2024-02-29");
  });

  it("gives the same rows whatever the order of the events", () => {
    const events = [ev("amy", "sent", 5), ev("bo", "received", 9), ev("amy", "received", 4), ev("bo", "sent", 30), ev("cy", "unknown", 2)];
    const friends = [friend("cy", 100), friend("amy", 100), friend("bo", 100)];
    expect(build(input(friends, events))).toEqual(build(input([...friends].reverse(), [...events].reverse())));
  });

  it("does not change its input", () => {
    const i = input([friend("amy", 300)], [ev("amy", "sent", 5), ev("amy", "received", 9)]);
    const copy = JSON.stringify(i);
    expect(build(i)).toEqual(build(i));
    expect(JSON.stringify(i)).toBe(copy);
  });
});

describe("buildFriendsTable: flags", () => {
  const D = FRIENDS_TABLE_DEFAULTS;

  it("flags a quiet friend and keeps recent ones unflagged", () => {
    const i = input(
      [friend("amy", 900), friend("bo", 900), friend("cy", 900)],
      [ev("amy", "sent", D.quietDays + 1), ev("bo", "sent", D.quietDays - 1), ev("cy", "sent", 400)],
    );
    expect(rowOf(i, "amy").quiet).toBe(true);
    expect(rowOf(i, "bo").quiet).toBe(false);
    expect(rowOf(i, "cy").quiet).toBe(true);
    expect(build(i).summary.quiet).toBe(2);
  });

  it("flags exactly at the quiet threshold, like the quiet-friends check", () => {
    const i = input([friend("amy", 900), friend("bo", 900)], [ev("amy", "sent", D.quietDays), ev("bo", "sent", D.quietDays - 0.5), ev("zed", "sent", 400)]);
    expect(rowOf(i, "amy").quiet).toBe(true);
    expect(rowOf(i, "bo").quiet).toBe(false);
  });

  it("does not call a friend quiet when the friendship is newer than the window or the date is unknown", () => {
    const i = input([friend("amy", 100), friend("bo"), friend("cy", 400)], [ev("amy", "sent", 5), ev("zed", "sent", 400)]);
    expect(rowOf(i, "amy").quiet).toBe(false);
    expect(rowOf(i, "bo").quiet).toBe(false);
    expect(rowOf(i, "cy").quiet).toBe(true);
    expect(codes(i)).toContain("friends-without-added-date");
  });

  it("flags a friend with no events as quiet only when the data reaches back across the window", () => {
    const covered = input([friend("amy", 900), friend("bo", 900)], [ev("bo", "sent", 5), ev("zed", "sent", 300)]);
    expect(rowOf(covered, "amy").quiet).toBe(true);
    const short = input([friend("amy", 900), friend("bo", 900)], [ev("bo", "sent", 5), ev("zed", "sent", 30)]);
    expect(rowOf(short, "amy").quiet).toBe(false);
    expect(build(short).notes.find((n) => n.code === "quiet-not-judged-short-history")?.params).toEqual({ count: 1 });
  });

  it("makes nobody quiet without any one-to-one events", () => {
    expect(rowOf(input([friend("amy", 900)], []), "amy").quiet).toBe(false);
    const groupsOnly = input([friend("amy", 900)], [ev("group:x", "sent", 300, { isGroup: true })]);
    expect(rowOf(groupsOnly, "amy").quiet).toBe(false);
    expect(codes(groupsOnly)).toContain("quiet-not-judged-no-activity");
  });

  it("flags waiting on you and on them with the waiting thresholds", () => {
    const i = input(
      [friend("amy", 300), friend("bo", 300), friend("cy", 300), friend("di", 300), friend("ed", 300)],
      [ev("amy", "received", 3), ev("bo", "received", 2), ev("cy", "sent", 7), ev("di", "sent", 6), ev("ed", "received", 91)],
    );
    expect(rowOf(i, "amy")).toMatchObject({ waiting: true, waitingOn: "you" });
    expect(rowOf(i, "bo")).toMatchObject({ waiting: false, waitingOn: null });
    expect(rowOf(i, "cy")).toMatchObject({ waiting: true, waitingOn: "them" });
    expect(rowOf(i, "di").waiting).toBe(false);
    expect(rowOf(i, "ed").waiting).toBe(false);
    expect(build(i).summary.waiting).toBe(2);
  });

  it("does not flag waiting when the newest event has an unknown direction or the directions tie", () => {
    const at = NOW - 10 * DAY_MS;
    const i = input(
      [friend("amy", 300), friend("bo", 300), friend("cy", 300)],
      [ev("amy", "received", 10), ev("amy", "unknown", 5), ev("bo", "sent", 10, { at }), ev("bo", "received", 10, { at }), ev("cy", "received", 10), ev("cy", "unknown", 20)],
    );
    expect(rowOf(i, "amy").waiting).toBe(false);
    expect(rowOf(i, "bo").waiting).toBe(false);
    expect(rowOf(i, "cy")).toMatchObject({ waiting: true, waitingOn: "you" });
  });

  it("flags one-sided chats with the one-sided thresholds", () => {
    const many = (who: string, dir: ChatEvent["direction"], n: number, daysAgo = 5) => Array.from({ length: n }, () => ev(who, dir, daysAgo));
    const i = input(
      [friend("amy", 300), friend("bo", 300), friend("cy", 300), friend("di", 300), friend("ed", 300)],
      [
        ...many("amy", "sent", 9),
        ...many("amy", "received", 1),
        ...many("bo", "received", 8),
        ...many("bo", "sent", 1),
        ...many("cy", "sent", 6),
        ...many("cy", "received", 4),
        ...many("di", "sent", 12, 120),
        ...many("ed", "sent", 5),
        ...many("ed", "unknown", 30),
      ],
    );
    expect(rowOf(i, "amy").oneSided).toBe(true);
    expect(rowOf(i, "bo").oneSided).toBe(false);
    expect(rowOf(i, "cy").oneSided).toBe(false);
    expect(rowOf(i, "di").oneSided).toBe(false);
    expect(rowOf(i, "ed").oneSided).toBe(false);
    expect(build(i).summary.oneSided).toBe(1);
  });

  it("does not flag a friend with equal sent and received", () => {
    const events = [...Array.from({ length: 10 }, () => ev("amy", "sent", 5)), ...Array.from({ length: 10 }, () => ev("amy", "received", 5))];
    expect(rowOf(input([friend("amy", 300)], events), "amy").oneSided).toBe(false);
  });
});

describe("sortRows", () => {
  const rows = build(
    input(
      [friend("cy", 100), friend("amy", 300), friend("bo"), friend("di", 300)],
      [ev("cy", "sent", 5), ev("cy", "received", 3), ev("amy", "sent", 20), ev("bo", "received", 3), ev("bo", "received", 2), ev("bo", "sent", 1)],
    ),
  ).rows;
  const names = (r: FriendRow[]) => r.map((x) => x.username);

  it("sorts by username in both directions", () => {
    expect(names(sortRows(rows, "username"))).toEqual(["amy", "bo", "cy", "di"]);
    expect(names(sortRows(rows, "username", "desc"))).toEqual(["di", "cy", "bo", "amy"]);
  });

  it("sorts by number with a username tiebreak that does not flip with the direction", () => {
    expect(names(sortRows(rows, "total", "desc"))).toEqual(["bo", "cy", "amy", "di"]);
    expect(names(sortRows(rows, "total", "asc"))).toEqual(["di", "amy", "cy", "bo"]);
    expect(names(sortRows(rows, "recent", "desc"))).toEqual(["bo", "cy", "amy", "di"]);
    expect(names(sortRows(rows, "sent", "desc"))).toEqual(["amy", "bo", "cy", "di"]);
    expect(names(sortRows(rows, "received", "desc"))).toEqual(["bo", "cy", "amy", "di"]);
  });

  it("puts rows without a date last in both directions", () => {
    expect(names(sortRows(rows, "added", "asc"))).toEqual(["amy", "di", "cy", "bo"]);
    expect(names(sortRows(rows, "added", "desc"))).toEqual(["cy", "amy", "di", "bo"]);
    expect(names(sortRows(rows, "last", "desc"))).toEqual(["bo", "cy", "amy", "di"]);
    expect(names(sortRows(rows, "last", "asc"))).toEqual(["amy", "cy", "bo", "di"]);
    expect(names(sortRows(rows, "first", "asc"))).toEqual(["amy", "cy", "bo", "di"]);
  });

  it("is deterministic for any input order and does not change its input", () => {
    const copy = JSON.stringify(rows);
    for (const key of ["username", "added", "first", "last", "recent", "total", "sent", "received"] as const) {
      expect(names(sortRows([...rows].reverse(), key, "desc"))).toEqual(names(sortRows(rows, key, "desc")));
    }
    expect(JSON.stringify(rows)).toBe(copy);
  });

  it("falls back to username for an unknown key", () => {
    expect(names(sortRows(rows, "nope" as never))).toEqual(["amy", "bo", "cy", "di"]);
  });

  it("handles no rows and one row", () => {
    expect(sortRows([], "total")).toEqual([]);
    expect(sortRows(rows.slice(0, 1), "total")).toHaveLength(1);
  });
});

describe("filterRows", () => {
  const events = [
    ev("amy", "received", 5),
    ev("amy", "sent", 700),
    ...Array.from({ length: 12 }, () => ev("amanda", "sent", 3)),
    ev("bo", "sent", 400),
    ev("al_b", "sent", 10),
  ];
  const rows = build(input([friend("amy", 800), friend("amanda", 300), friend("bo", 900), friend("al_b", 50), friend("zed")], events)).rows;
  const names = (r: FriendRow[]) => r.map((x) => x.username);

  it("returns everything for an empty filter", () => {
    expect(filterRows(rows, {})).toEqual(rows);
    expect(filterRows(rows, { prefix: "  " })).toEqual(rows);
  });

  it("matches a case-insensitive username prefix, not a substring", () => {
    expect(names(filterRows(rows, { prefix: "AM" }))).toEqual(["amanda", "amy"]);
    expect(names(filterRows(rows, { prefix: "b" }))).toEqual(["bo"]);
    expect(filterRows(rows, { prefix: "my" })).toEqual([]);
    expect(names(filterRows(rows, { prefix: "al_" }))).toEqual(["al_b"]);
  });

  it("filters on each flag, true and false", () => {
    expect(names(filterRows(rows, { oneSided: true }))).toEqual(["amanda"]);
    expect(names(filterRows(rows, { quiet: true }))).toEqual(["bo"]);
    expect(names(filterRows(rows, { waiting: true, waitingOn: "you" }))).toEqual(["amy"]);
    expect(names(filterRows(rows, { waitingOn: "them" }))).toEqual(["al_b"]);
    expect(names(filterRows(rows, { quiet: false, oneSided: false, waiting: false }))).toEqual(["zed"]);
  });

  it("filters on date ranges with inclusive bounds and leaves out rows without the date", () => {
    expect(names(filterRows(rows, { added: { from: NOW - 300 * DAY_MS } }))).toEqual(["al_b", "amanda"]);
    expect(names(filterRows(rows, { added: { to: NOW - 800 * DAY_MS } }))).toEqual(["amy", "bo"]);
    expect(names(filterRows(rows, { added: { from: NOW - 800 * DAY_MS, to: NOW - 800 * DAY_MS } }))).toEqual(["amy"]);
    expect(names(filterRows(rows, { lastEvent: { from: NOW - 11 * DAY_MS } }))).toEqual(["al_b", "amanda", "amy"]);
    expect(names(filterRows(rows, { firstEvent: { to: NOW - 600 * DAY_MS } }))).toEqual(["amy"]);
    expect(filterRows(rows, { added: { from: 0 } }).map((r) => r.username)).not.toContain("zed");
    expect(names(filterRows(rows, { added: {} }))).toContain("zed");
    expect(names(filterRows(rows, { added: { from: Number.NaN } }))).toContain("zed");
  });

  it("combines conditions, keeps the order and does not change its input", () => {
    const copy = JSON.stringify(rows);
    expect(names(filterRows(rows, { prefix: "a", quiet: false, lastEvent: { from: NOW - 30 * DAY_MS } }))).toEqual(["al_b", "amanda", "amy"]);
    expect(names(filterRows(sortRows(rows, "total", "desc"), { prefix: "a" }))).toEqual(["amanda", "amy", "al_b"]);
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

describe("toCsv", () => {
  const rowFor = (username: string): FriendRow => ({ ...rowOf(input([friend("amy", 300)], [ev("amy", "sent", 5)]), "amy"), username, id: `u:${username}` });

  it("writes a header and one CRLF-ended line per row", () => {
    const csv = toCsv(build(input([friend("amy", 300), friend("bo")], [ev("amy", "sent", 5), ev("amy", "received", 4)])).rows);
    expect(csv).toBe(
      `${FRIENDS_CSV_HEADER.join(",")}\r\n` +
        "amy,2024-08-05,2025-05-27,2025-05-28,2,2,1,1,0,no,no,you\r\n" +
        "bo,,,,0,0,0,0,0,no,no,\r\n",
    );
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes just the header for no rows", () => {
    expect(toCsv([])).toBe(`${FRIENDS_CSV_HEADER.join(",")}\r\n`);
  });

  it("writes the waiting side as text", () => {
    const rows = build(input([friend("amy", 300)], [ev("amy", "received", 10)])).rows;
    expect(toCsv(rows).split("\r\n")[1]).toMatch(/,you$/);
  });

  it("quotes commas, quotes and line breaks, and doubles quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe("a b");
    expect(csvCell("a\r\nb")).toBe("a  b");
    expect(csvCell("plain_name.1")).toBe("plain_name.1");
    expect(csvCell(null)).toBe("");
    expect(csvCell(7)).toBe("7");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(true)).toBe("yes");
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "=HYPERLINK(\"http://x\",\"y\")", "-2+3", "@a"])(
    "neutralizes a formula-like cell %j",
    (cell) => {
      const out = csvCell(cell);
      const inner = out.startsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
      expect(inner).toBe(`'${cell}`);
      expect(inner.startsWith("'")).toBe(true);
    },
  );

  it.each(["\t=1", "\r=1", "\n=1", "\u0085=1", "\u0000=1", "\u009f+1", " \u001b-1", "\u00a0@a", "\u2003=1"])(
    "sees past leading control and blank characters when it looks for a formula: %j",
    (cell) => {
      const out = csvCell(cell);
      expect(out.startsWith("'")).toBe(true);
      expect(out).toMatch(/^'[=+\-@]/);
    },
  );

  it("replaces control characters with spaces, and direction or zero-width characters with ?", () => {
    expect(csvCell("\u001b]0;pwned\u0007x")).toBe("]0;pwned x");
    expect(csvCell("\u202eevil")).toBe("?evil");
    expect(csvCell("a\u200bb\u200ec\u2066d\u2069e\ufeff")).toBe("a?b?c?d?e?");
    expect(csvCell("soft\u00adhyphen")).toBe("soft?hyphen");
    // A leading bidi override is not blank, so it stays visible as "?" and does not hide a formula.
    expect(csvCell("\u202e=1")).toBe("?=1");
  });

  it("writes no control, C1 or bidi character anywhere in a file made from hostile usernames", () => {
    const names = ["\u001b]0;pwned\u0007x", "\u0085=1", "\u202e=cmd", "a\u200bb", "=1+1", "ok_name", "line\nbreak", "tab\tname", "\u007fdel", "\u009bcsi"];
    const csv = toCsv(names.map(rowFor));
    // The only control characters left are the CRLF line ends.
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(names.length + 2);
    for (const line of lines.slice(1, -1)) expect(line).not.toMatch(/^[=+\-@]/);
    expect(lines[2]?.startsWith("'=1,")).toBe(true);
  });

  it("neutralizes a username that starts with a formula character, in the whole file", () => {
    const csv = toCsv([rowFor("=cmd|' /C calc'!A0"), rowFor("+x"), rowFor("-x"), rowFor("@x"), rowFor("fine")]);
    const lines = csv.split("\r\n");
    expect(lines[1]?.startsWith("'=cmd")).toBe(true);
    expect(lines[2]?.startsWith("'+x,")).toBe(true);
    expect(lines[3]?.startsWith("'-x,")).toBe(true);
    expect(lines[4]?.startsWith("'@x,")).toBe(true);
    expect(lines[5]?.startsWith("fine,")).toBe(true);
    for (const l of lines.slice(1, 5)) expect(l).not.toMatch(/^[=+\-@]/);
  });

  it("does not neutralize a formula character that is not first", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("a-b")).toBe("a-b");
  });
});

describe("friends table: privacy and scale", () => {
  it("puts a canary username only in rows, never in notes or the summary", () => {
    const canary = "zqcanary_table_user";
    const i = input(
      [friend(canary, 300), friend(`${canary}_b`), friend("  ")],
      [
        ev(canary, "received", 20),
        ev(canary, "sent", 1, { at: Number.NaN }),
        ev(canary, "sent", -5),
        ev(`${canary}_other`, "sent", 5),
        ev(`group:${canary}`, "sent", 5, { isGroup: true }),
      ],
    );
    const t = build(i);
    expect(t.notes.length).toBeGreaterThan(3);
    expect(JSON.stringify(t.notes)).not.toContain(canary);
    expect(JSON.stringify(t.summary)).not.toContain(canary);
    for (const n of t.notes) {
      expect(Object.keys(n).sort()).toEqual(["code", "params"]);
      for (const v of Object.values(n.params)) expect(typeof v).toBe("number");
      expect(n.code).toMatch(/^[a-z-]+$/);
    }
    expect(JSON.stringify(t.rows)).toContain(canary);
    expect(JSON.stringify({ ...t, rows: [] })).not.toContain(canary);
    expect(t.rows.map((r) => r.id)).toEqual([`u:${canary}`, `u:${canary}_b`]);
  });

  it("builds, sorts, filters and exports 5000 friends and 300000 events in under a second", () => {
    const friends = Array.from({ length: 5000 }, (_, i) => friend(`user_${String(i).padStart(4, "0")}`, 200 + (i % 700)));
    const chats: ChatEvent[] = Array.from({ length: 300_000 }, (_, i) => ({
      conversation: `User_${String((i * 7) % 5200).padStart(4, "0")}`,
      isGroup: i % 50 === 0,
      direction: (["sent", "received", "unknown"] as const)[i % 3] ?? "unknown",
      kind: "TEXT",
      at: NOW - ((i * 37) % (400 * 24 * 60)) * 60_000,
    }));
    const started = performance.now();
    const t = build(input(friends, chats));
    const sorted = sortRows(t.rows, "total", "desc");
    const filtered = filterRows(sorted, { prefix: "user_1", quiet: false });
    const csv = toCsv(filtered);
    const ms = performance.now() - started;
    expect(t.rows).toHaveLength(5000);
    expect(filtered.length).toBeGreaterThan(0);
    expect(csv.split("\r\n")).toHaveLength(filtered.length + 2);
    expect(ms).toBeLessThan(1000);
  });

  it("works on a built-in synthetic export", () => {
    const parsed = parseExportZip(syntheticExportZip({ now: NOW, seed: 7, friendCount: 40 }));
    const t = buildFriendsTable(parsed, { now: NOW, utcOffsetMinutes: -240 });
    expect(t.rows).toHaveLength(parsed.friends.friends.length);
    expect(t.summary.withEvents).toBeGreaterThan(0);
    expect(buildFriendsTable(parsed, { now: NOW, utcOffsetMinutes: -240 })).toEqual(t);
    const csv = toCsv(t.rows);
    expect(csv.split("\r\n")).toHaveLength(t.rows.length + 2);
    for (const r of t.rows) {
      expect(r.sent + r.received + r.unknown).toBe(r.total);
      expect(r.recent).toBeLessThanOrEqual(r.total);
      expect(r.waiting).toBe(r.waitingOn !== null);
    }
  });
});
