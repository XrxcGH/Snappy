/**
 * The words of the evidence the detectors write, which the Cleanup queue shows under each person. One sentence per
 * fact, no repeated first words, hedged, and none of the developer words (screen scan, candidates, snapshot,
 * banned, re-export) that reached people before.
 */
import { describe, expect, it } from "vitest";
import { daysText } from "../../src/ledger/day-text.ts";
import { findDormant } from "../../src/ledger/detect-dormant.ts";
import { findGhosts } from "../../src/ledger/detect-ghost.ts";
import { findOneWay } from "../../src/ledger/detect-oneway.ts";
import type { Candidate, ChatEvent, FriendRecord, ParsedExport, Snapshot } from "../../src/types.ts";
import { DAY_MS } from "../../src/util.ts";

const NOW = Date.UTC(2026, 10, 6);
const T0 = Date.UTC(2025, 0, 1);

const details = (c: Candidate): string[] => c.evidence.map((e) => e.detail);
const detailOf = (c: Candidate, signal: string): string => c.evidence.find((e) => e.signal === signal)?.detail ?? "";
const DEVELOPER_WORDS = /screen scan|candidates|snapshot|banned|re-export|ui-scan/i;

function parsedExport(friends: FriendRecord[], chats: ChatEvent[], sentRequests: FriendRecord[] = []): ParsedExport {
  return {
    friends: { friends, sentRequests, pendingRequests: [], deletedFriends: [], blocked: [], ignored: [], hiddenSuggestions: [] },
    chats,
    memories: [],
    fileList: [],
    issues: [],
    exportedAt: NOW,
  };
}
const chat = (conversation: string, daysAgo: number): ChatEvent => ({ conversation, isGroup: false, direction: "received", kind: "TEXT", at: NOW - daysAgo * DAY_MS });
const snap = (id: string, day: number, p: Partial<Snapshot> = {}): Snapshot => ({ id, takenAt: T0 + day * DAY_MS, source: "export", friends: [], sentRequests: [], deleted: {}, friendSince: {}, sentAt: {}, ...p });
const crowd = (n: number): string[] => Array.from({ length: n }, (_, i) => `u${i}`);

describe("daysText", () => {
  it("groups thousands and says 1 day in the singular", () => {
    expect(daysText(1520.4)).toBe("1,520 days");
    expect(daysText(1.9)).toBe("1 day");
    expect(daysText(489)).toBe("489 days");
  });
});

describe("quiet friends evidence", () => {
  const lastChat = Date.UTC(2022, 8, 7);
  const run = (chats: ChatEvent[]): Candidate => findDormant(parsedExport([{ username: "quiet_pal", createdAt: NOW - 2500 * DAY_MS }], chats), { now: NOW })[0]!;

  it("says the last chat or Snap once, with the date and the days before the export", () => {
    const days = Math.floor((NOW - lastChat) / DAY_MS);
    const c = run([chat("anchor", 3000), { ...chat("quiet_pal", 0), at: lastChat }]);
    expect(detailOf(c, "last-saved-chat-old")).toBe(`Last chat or Snap: Sep 7, 2022, ${daysText(days)} before the export.`);
    expect(detailOf(c, "last-saved-chat-old")).toMatch(/^Last chat or Snap: Sep 7, 2022, 1,5\d\d days before the export\.$/);
  });

  it("says there is no saved chat or Snap, without repeating the category lead", () => {
    const c = run([chat("anchor", 3000)]);
    expect(detailOf(c, "no-saved-chats")).toBe("No saved chat or Snap with this friend in the export.");
    expect(details(c).join(" ")).not.toMatch(/No recent chats or Snaps/);
  });

  it("keeps the caveat that group chats and unsaved chats are not seen, and says one-to-one", () => {
    const c = run([chat("anchor", 3000)]);
    expect(detailOf(c, "chat-history-only-covers-saved-chats")).toBe(
      "Only saved one-to-one chat or Snap activity counts here, so you may have talked in ways the export cannot show (group chats, unsaved chats, calls).",
    );
  });
});

describe("unaccepted requests evidence", () => {
  it("says when the request was sent and that it is not accepted yet, in two short sentences", () => {
    const sent = Date.UTC(2025, 6, 5);
    const c = findOneWay(parsedExport([{ username: "base" }], [], [{ username: "slow_pal", createdAt: sent }]), { now: NOW })[0]!;
    expect(detailOf(c, "request-age")).toBe(`Request sent Jul 5, 2025, ${daysText((NOW - sent) / DAY_MS)} ago. Not accepted yet.`);
    expect(detailOf(c, "request-age")).toMatch(/^Request sent Jul 5, 2025, 4\d\d days ago\. Not accepted yet\.$/);
  });
});

describe("disappeared friends evidence", () => {
  const friends = crowd(12);
  const two = (): Candidate => findGhosts([snap("a", 0, { friends: [...friends, "alice"] }), snap("b", 40, { friends })], { now: NOW })[0]!;

  it("says neither export shows the removal for two exports, and None of the n for more", () => {
    expect(detailOf(two(), "not-deleted-by-you")).toBe("Neither export shows you removing this friend, so the reason is unknown.");
    const three = findGhosts([snap("a", 0, { friends: [...friends, "alice"] }), snap("b", 20, { friends: [...friends, "alice"] }), snap("c", 40, { friends })], { now: NOW })[0]!;
    expect(detailOf(three, "not-deleted-by-you")).toBe("None of the 3 exports shows you removing this friend, so the reason is unknown.");
  });

  it("hedges the cause the same way everywhere: removed you or closed their account, and a renamed account looks the same", () => {
    expect(detailOf(two(), "cannot-rule-out-account-deletion")).toBe(
      "Snapchat gives no signal when someone removes you. They may have removed you or closed their account, and a renamed account looks the same in an export.",
    );
  });

  it("asks for a new export with “All Time” in quotes, not a re-export", () => {
    expect(detailOf(two(), "cannot-rule-out-date-range")).toBe(
      "The latest export may have used a narrower date range than the earlier ones, which would hide older friends. Request a new export with “All Time” to be sure.",
    );
  });

  it("describes a screen-capture-only history without the screen scan, snapshot or candidates words", () => {
    const c = findGhosts([snap("a", 0, { friends: [...friends, "alice"] }), snap("b", 40, { friends, source: "ui-scan" })], { now: NOW })[0]!;
    expect(detailOf(c, "deletions-not-observable")).toBe(
      "The saved lists since this person was last seen cannot show friends you removed yourself, so you may have removed them. Confidence is capped at low.",
    );
  });

  it("says confidence is capped at low, not that candidates are, for a broken export and for a date-range cut-off", () => {
    const empty = findGhosts([snap("a", 0, { friends: [...friends, "alice"] }), snap("b", 40, { friends: [] })], { now: NOW })[0]!;
    expect(detailOf(empty, "mass-disappearance")).toMatch(/Confidence is capped at low\.$/);
    const mass = findGhosts([snap("a", 0, { friends: crowd(10) }), snap("b", 40, { friends: crowd(3) })], { now: NOW })[0]!;
    expect(detailOf(mass, "mass-disappearance")).toMatch(/Confidence is capped at low\.$/);
    const old = T0 - 4 * 365 * DAY_MS;
    const cut = findGhosts(
      [snap("a", 0, { friends: [...friends, "alice"], friendSince: { alice: old - 1000 * DAY_MS, ...Object.fromEntries(friends.map((f) => [f, old + 500 * DAY_MS])) } }), snap("b", 40, { friends, friendSince: Object.fromEntries(friends.map((f) => [f, old + 500 * DAY_MS])) })],
      { now: NOW },
    )[0]!;
    expect(detailOf(cut, "looks-like-date-range-cutoff")).toMatch(/Confidence is capped at low\.$/);
  });

  it("uses no developer word in any sentence of any detector", () => {
    const all = [
      ...two().evidence,
      ...findGhosts([snap("a", 0, { friends: [...friends, "alice"] }), snap("b", 40, { friends, source: "ui-scan" })], { now: NOW })[0]!.evidence,
      ...findGhosts([snap("a", 0, { friends: [...friends, "alice"] }), snap("b", 40, { friends: [] })], { now: NOW })[0]!.evidence,
    ].map((e) => e.detail);
    expect(all.filter((d) => DEVELOPER_WORDS.test(d))).toEqual([]);
  });
});
