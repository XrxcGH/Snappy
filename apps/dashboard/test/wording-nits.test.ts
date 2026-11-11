/**
 * Small wording and number rules on the lists and the shell: counts carry thousands separators wherever they appear,
 * the "g" announcement and the keep toast read as plain sentences, a too-long keep name is told apart from a name with
 * spaces, the Disappeared count line says what it counts, and the Unaccepted requests empty state only points at
 * "User information" when an export was read. Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { disappeared, requests } from "../src/copy.ts";
import { lists } from "../src/copy-lists.ts";
import { shellCopy } from "../src/copy-shell.ts";
import { GO_KEYS } from "../src/keys.ts";
import { keepErrorFor } from "../src/components/keepListSection.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import type { View } from "../src/views/context.ts";
import { mount, textOf } from "./lists-harness.ts";
import { sampleWorkspace } from "./tools/harness.ts";

vi.mock("../src/announce.ts", () => ({ announce: () => undefined }));

describe("counts", () => {
  it("formats the match count and the kept count with thousands separators", () => {
    expect(lists.matchCount(1200, 12000)).toBe("1,200 of 12,000 match");
    expect(lists.keptCount(1200)).toContain("1,200");
  });

  it("says what the kept toast counts, as a sentence", () => {
    expect(lists.keptCount(2)).toBe("2 people added to your keep list.");
  });

  it("counts the Disappeared list and keeps the order, like the other two lists", () => {
    expect(disappeared.listCount(1)).toBe("1 friend, most likely first");
    expect(disappeared.listCount(1200)).toBe("1,200 friends, most likely first");
  });
});

describe("the go announcement", () => {
  it("is one plain sentence that names every key", () => {
    const letters = Object.keys(GO_KEYS);
    expect(shellCopy.goPendingAnnounce).not.toMatch(/^Go to\./);
    expect(shellCopy.goPendingAnnounce).toBe("Press o, c, t, m, s or h to choose where to go.");
    expect(letters).toEqual(["o", "c", "t", "m", "s", "h"]);
  });
});

describe("keepErrorFor", () => {
  it("tells a too-long name from a name with spaces", () => {
    expect(keepErrorFor("a".repeat(65))).toBe(lists.keepAddTooLong);
    expect(keepErrorFor("two names")).toBe(lists.keepAddError);
    expect(keepErrorFor("")).toBe(lists.keepAddError);
    expect(keepErrorFor("amy")).toBeNull();
    // The length is measured after lower-casing, like the key itself ("İ" lower-cases to two characters).
    expect(keepErrorFor("İ".repeat(33))).toBe(lists.keepAddTooLong);
    expect(lists.keepAddTooLong).not.toBe(lists.keepAddError);
  });
});

describe("the Unaccepted requests empty state", () => {
  let requestsView: View;
  let fromExport: State;
  let fromLedger: State;

  beforeAll(async () => {
    ({ requestsView } = (await import("../src/views/findings.ts")) as { requestsView: View });
    const ws = await sampleWorkspace();
    const none = { ...ws.latest!, friends: { ...ws.latest!.friends, sentRequests: [], pendingRequests: [] } };
    fromExport = { ...initialState(), real: { ...ws, latest: none } };
    fromLedger = { ...initialState(), real: { ...ws, latest: null, ledger: { ...ws.ledger, snapshots: ws.ledger.snapshots.map((s) => ({ ...s, sentRequests: [] })) } } };
  }, 120_000);

  it("suggests re-checking User information when an export was read", () => {
    const text = textOf(mount(requestsView, fromExport).root);
    expect(text).toContain(requests.emptyTitle);
    expect(text).toContain(requests.emptyBody);
  });

  it("does not, when the results come from the saved history", () => {
    const text = textOf(mount(requestsView, fromLedger).root);
    expect(text).toContain(requests.emptyTitle);
    expect(text).toContain(requests.emptyLedger);
    expect(text).not.toContain("User information");
  });
});
