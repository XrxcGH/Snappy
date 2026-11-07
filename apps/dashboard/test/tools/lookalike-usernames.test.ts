/**
 * Lookalike usernames: what it computes from the lists the page holds, and what its page shows.
 * Synthetic data only. The usernames below carry a canary that must reach a pair list and nowhere else.
 */
import type { FriendRecord, ParsedExport, ParsedFriends } from "@snappy-export/core";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalysisCache } from "../../src/analysis.ts";
import { tools } from "../../src/copy.ts";
import { initialState } from "../../src/reducer.ts";
import type { State, Workspace } from "../../src/reducer.ts";
import { COMMANDS, displayText } from "../../src/terminal/commands.ts";
import { copy } from "../../src/tools/lookalike-usernames/copy.ts";
import { descriptor } from "../../src/tools/lookalike-usernames/index.ts";
import { computeLookalikes } from "../../src/tools/lookalike-usernames/model.ts";
import { view } from "../../src/tools/lookalike-usernames/view.ts";
import { toolData } from "../../src/tools/data.ts";
import { RULES, ancestors, collectCopy, lint, textOf } from "../copy-rules.ts";
import type { FakeElement } from "../fake-dom.ts";
import { render, renderSettled, sampleState, sampleWorkspace, stateWith } from "./harness.ts";

const said: string[] = [];
vi.mock("../../src/announce.ts", () => ({ announce: (text: string) => void said.push(text) }));

let base: Workspace;
let sample: State;
beforeAll(async () => {
  base = await sampleWorkspace();
  sample = await sampleState();
}, 120_000);
beforeEach(() => {
  resetAnalysisCache();
  said.length = 0;
});

const rec = (username: string): FriendRecord => ({ username });

/** A real (not sample) export made from the sample's, with its lists replaced. */
function real(friends: Partial<ParsedFriends>): State {
  const latest = base.latest as ParsedExport;
  return stateWith({ latest: { ...latest, friends: { ...latest.friends, ...friends } }, now: base.now, issues: [], parts: 1 });
}
const dataOf = (state: State) => toolData(state);
const text = (el: FakeElement, selector: string): string[] => el.querySelectorAll(selector).map((e) => e.textContent);
const names = (el: FakeElement): string[] => text(el, "code.username");

/** Four pairs of invented names: one very close, three close, each with a canary. */
const CRAFTED: Partial<ParsedFriends> = {
  friends: [rec("zqmike_t"), rec("zqsam_k"), rec("zqjordan_p"), rec("zqtom_lee"), rec("zqplain_one")],
  pendingRequests: [rec("zqmike.t"), rec("zqjordann_p")],
  sentRequests: [],
  blocked: [rec("zqsam_k0"), rec("zqt0m_lee")],
  ignored: [],
  hiddenSuggestions: [],
};
const CANARIES = ["zqmike_t", "zqsam_k", "zqjordan_p", "zqtom_lee", "zqplain_one", "zqmike.t", "zqjordann_p", "zqsam_k0", "zqt0m_lee"];
/** Lists with nothing alike in them. */
const PLAIN: Partial<ParsedFriends> = { friends: [rec("zqada_one"), rec("zqbob_two"), rec("zqcy_three")], pendingRequests: [], sentRequests: [], blocked: [], ignored: [], hiddenSuggestions: [] };

describe("the tool", () => {
  it("is a Friends tool in the requests color that needs an export and friends, and shows the lookalikes command", () => {
    expect(descriptor).toMatchObject({ id: "lookalike-usernames", title: "Lookalike usernames", group: "friends", category: "requests", icon: "search", needs: ["export", "friends"] });
    expect(descriptor.oneLiner).toBe("Spot names that look alike.");
    expect(COMMANDS.lookalikes.argv[0]).toBe("lookalikes");
  });
});

describe("computeLookalikes", () => {
  it("compares the friends, requests and blocked lists as core does, with the page's own date as now", () => {
    const result = computeLookalikes(dataOf(sample));
    expect(result.generatedAt).toBe(base.now);
    expect(result.totals.pairs).toBe(result.totals.byLevel.high + result.totals.byLevel.medium + result.totals.byLevel.low);
    expect(result.pairs.length).toBeLessThanOrEqual(200);
  });

  it("finds a swap, a dot or underscore, repeated letters and added digits, with where each person is listed", () => {
    const result = computeLookalikes(dataOf(real(CRAFTED)));
    expect(result.pairs.map((p) => [p.a, p.b, p.level])).toEqual([
      ["zqt0m_lee", "zqtom_lee", "high"],
      ["zqjordan_p", "zqjordann_p", "medium"],
      ["zqmike.t", "zqmike_t", "medium"],
      ["zqsam_k", "zqsam_k0", "medium"],
    ]);
    expect(result.pairs[0]).toMatchObject({ aLists: ["blocked"], bLists: ["friends"], reasons: ["lookalike-swap"], contexts: ["resembles-blocked"] });
    expect(result.pairs[2]?.contexts).toEqual(["pending-resembles-friend"]);
    expect(result.totals).toEqual({ people: 9, pairs: 4, byLevel: { low: 0, medium: 3, high: 1 } });
    expect(result.notes).toEqual([{ code: "lookalikes-found", params: { count: 4 } }]);
  });

  it("finds nothing in names that differ, and compares a person in two lists as one person", () => {
    const none = computeLookalikes(dataOf(real(PLAIN)));
    expect(none.totals.pairs).toBe(0);
    expect(none.notes.map((n) => n.code)).toEqual(["no-lookalikes"]);
    const same = computeLookalikes(dataOf(real({ ...PLAIN, blocked: [rec("ZQADA_ONE")] })));
    expect(same.totals).toMatchObject({ people: 3, pairs: 0 });
  });

  it("refuses to run without an export (the page never calls it that way)", () => {
    expect(() => computeLookalikes(dataOf(initialState()))).toThrow();
  });

  it("puts no username in a note or a total: only counts and codes", () => {
    const result = computeLookalikes(dataOf(real(CRAFTED)));
    const json = JSON.stringify({ notes: result.notes, totals: result.totals });
    for (const name of CANARIES) expect(json, name).not.toContain(name);
  });

  it("handles a long list: 10 000 names with a few lookalikes, in one pass", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => rec(`zq${i.toString(36)}person${(i * 7919).toString(36)}`));
    const started = Date.now();
    const result = computeLookalikes(dataOf(real({ ...PLAIN, friends: [...many, rec("zqmike_t")], pendingRequests: [rec("zqmike.t")] })));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.pairs.some((p) => p.a === "zqmike.t" && p.b === "zqmike_t")).toBe(true);
  });
});

describe("the page", () => {
  it("shows the counts, the pairs and the lookalikes command", async () => {
    const { root } = await renderSettled(view, real(CRAFTED));
    expect(text(root, ".section-title")).toEqual([copy.countsHeading, copy.pairsHeading, tools.notesHeading, tools.commandHeading]);
    expect(text(root, ".fact dt")).toEqual([copy.facts.names, copy.facts.high, copy.facts.medium, copy.facts.low]);
    expect(text(root, ".fact dd")).toEqual(["9", "1", "3", "0"]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.lookalikes));
    expect(root.querySelectorAll(".command-head button").map((b) => b.textContent)).toEqual(["Copy", "Run"]);
  });

  it("lists each pair with both names, the lists they are in, how alike and why, closest first", async () => {
    const { root } = await renderSettled(view, real(CRAFTED));
    const list = root.querySelector(".pair-list") as FakeElement;
    expect(names(list)).toEqual(["zqt0m_lee", "zqtom_lee", "zqjordan_p", "zqjordann_p", "zqmike.t", "zqmike_t", "zqsam_k", "zqsam_k0"]);
    const rows = list.querySelectorAll(".pair-row");
    expect(rows).toHaveLength(4);
    expect(text(rows[0] as FakeElement, ".pair-lists")).toEqual(["Blocked", "Friend"]);
    expect(text(rows[0] as FakeElement, ".pair-level")).toEqual([copy.levels.high]);
    expect(text(rows[0] as FakeElement, ".pair-reasons li")).toEqual([copy.reasons["lookalike-swap"], copy.contexts["resembles-blocked"]]);
    expect(text(rows[1] as FakeElement, ".pair-lists")).toEqual(["Friend", "Request received"]);
    expect(text(rows[1] as FakeElement, ".pair-reasons li")).toEqual([copy.reasons["repeated-characters"], copy.contexts["pending-resembles-friend"]]);
    expect(text(rows[2] as FakeElement, ".pair-reasons li")).toEqual([copy.reasons["separator-differs"], copy.contexts["pending-resembles-friend"]]);
    expect(text(rows[3] as FakeElement, ".pair-reasons li")).toEqual([copy.reasons["appended-digits"], copy.contexts["resembles-blocked"]]);
    expect(text(rows[3] as FakeElement, ".pair-level")).toEqual([copy.levels.medium]);
  });

  it("shows no way to change anything and no download: Snappy only compares", async () => {
    const { root } = await renderSettled(view, real(CRAFTED));
    expect(root.querySelector("[data-key=tool-download]")).toBeNull();
    expect(text(root, ".section-title")).not.toContain(tools.downloadHeading);
    expect(root.querySelector(".pair-list")?.querySelectorAll("button")).toHaveLength(0);
    expect(root.querySelectorAll("a").filter((a) => (a.getAttribute("href") ?? "").startsWith("http"))).toHaveLength(0);
    expect(text(root, ".tool-notes li")[0]).toBe(copy.readOnlyNote);
  });

  it("shows a short first page of a long list, with Show more, and says when the list was cut", async () => {
    // Many names that are one separator or one character apart: more pairs than the page keeps.
    const alike = Array.from({ length: 120 }, (_, i) => [rec(`zqpair${i.toString(36)}_x`), rec(`zqpair${i.toString(36)}x`)]).flat();
    const state = real({ ...PLAIN, friends: alike });
    const result = computeLookalikes(dataOf(state));
    expect(result.pairs.length).toBeGreaterThan(100);
    const { root } = await renderSettled(view, state);
    expect(root.querySelectorAll(".pair-row")).toHaveLength(50);
    expect(root.querySelector(".more")?.textContent).toContain(`Show ${Math.min(50, result.pairs.length - 50)} more`);
    expect(text(root, ".fact dd")[0]).toBe("240");
    expect(text(root, ".tool-notes li")).toContain(copy.truncatedNote(result.pairs.length, result.totals.pairs));
  });

  it("announces the result politely once, and without a name", async () => {
    await renderSettled(view, real(CRAFTED));
    expect(said).toEqual([copy.doneAnnounce(4)]);
    expect(said[0]).toBe("Check finished. 4 pairs may be worth a second look.");
    for (const name of CANARIES) expect(said[0], name).not.toContain(name);
    expect(said[0]?.length).toBeLessThanOrEqual(140);
    expect(copy.doneAnnounce(1)).toBe("Check finished. 1 pair may be worth a second look.");
  });
});

describe("the notes", () => {
  it("say how many pairs may be worth a second look, hedged and short", async () => {
    const { root } = await renderSettled(view, real(CRAFTED));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual([copy.readOnlyNote, copy.foundNote(4)]);
    expect(notes.join(" ")).toMatch(/may/);
    for (const n of notes) {
      expect(n).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
      for (const name of CANARIES) expect(n, name).not.toContain(name);
    }
  });

  it("say what was left out: repeated rows, and names in a long numbered family", async () => {
    const family = Array.from({ length: 30 }, (_, i) => rec(`zqfan_${i + 1}`));
    const { root } = await renderSettled(view, real({ ...CRAFTED, friends: [...(CRAFTED.friends ?? []), ...family, rec("ZQMIKE_T")] }));
    const notes = text(root, ".tool-notes li");
    expect(notes).toEqual(expect.arrayContaining([copy.duplicatesNote(1), copy.crowdedNote(30)]));
  });

  it("use the singular for one, and agree the verbs", () => {
    expect(copy.duplicatesNote(1)).toBe("1 extra row repeats a person already listed. Snappy counts each person once.");
    expect(copy.duplicatesNote(3)).toBe("3 extra rows repeat a person already listed. Snappy counts each person once.");
    expect(copy.blankNote(1)).toBe("1 row has no username. Snappy leaves it out.");
    expect(copy.blankNote(2)).toBe("2 rows have no username. Snappy leaves them out.");
    expect(copy.overlongNote(1)).toBe("1 username is too long to compare. Snappy leaves it out.");
    expect(copy.overlongNote(2)).toBe("2 usernames are too long to compare. Snappy leaves them out.");
    expect(copy.crowdedNote(1)).toBe("1 person has a name in a long numbered family. Snappy does not compare it.");
    expect(copy.crowdedNote(30)).toBe("30 people have names in a long numbered family. Snappy does not compare them.");
    expect(copy.truncatedNote(200, 350)).toBe("Snappy lists the closest 200 pairs of 350.");
    expect(copy.foundNote(1)).toBe("1 pair may be worth a second look.");
  });
});

describe("when nothing is found", () => {
  it("says so honestly instead of showing an empty result, keeps the notes, and still offers the command", async () => {
    const { root } = await renderSettled(view, real(PLAIN));
    expect(text(root, ".empty-title")).toEqual([copy.empty.title]);
    expect(text(root, ".empty-body")).toEqual([copy.empty.body]);
    expect(root.querySelectorAll(".pair-list")).toHaveLength(0);
    expect(text(root, ".fact dd")).toEqual([]);
    expect(text(root, ".tool-notes li")).toEqual([copy.readOnlyNote]);
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.lookalikes));
    expect(said).toEqual([copy.doneAnnounce(0)]);
    expect(said[0]).toBe("Check finished. No lookalike pairs found.");
  });
});

describe("without an export", () => {
  it("says so plainly, offers Add export and still offers the command", () => {
    const { root } = render(view, initialState());
    expect(text(root, ".empty-title")).toEqual([tools.needs.exportTitle]);
    expect(root.querySelector(".empty a")?.getAttribute("href")).toBe("#/start");
    expect(root.querySelector(".command code")?.textContent).toBe(displayText(COMMANDS.lookalikes));
    expect(root.querySelector(".tool-result")).toBeNull();
  });

  it("says saved history is not an export", () => {
    expect(text(render(view, stateWith({ ledger: base.ledger })).root, ".empty-body")).toEqual([tools.needs.exportLedgerBody]);
  });

  it("says the friends list is missing when the export has none", () => {
    const { root } = render(view, real({ friends: [] }));
    expect(text(root, ".empty-title")).toEqual([tools.needs.friendsTitle]);
  });
});

describe("privacy", () => {
  it("shows a username only in a pair list, never in a note, an announcement, a label or a title", async () => {
    const { root } = await renderSettled(view, real(CRAFTED));
    const inLists = root.querySelectorAll(".pair-list").flatMap((l) => names(l));
    for (const name of CANARIES.filter((n) => n !== "zqplain_one")) expect(inLists, name).toContain(name);
    expect(inLists).not.toContain("zqplain_one");
    const outside = root.descendants().filter((el) => {
      const own = el.childNodes.filter((c) => "data" in c).map((c) => (c as unknown as { data: string }).data).join(" ");
      const labels = ["aria-label", "title", "alt"].map((a) => el.getAttribute(a) ?? "").join(" ");
      const inList = ancestors(el).some((a) => a.classList.contains("pair-list")) || el.classList.contains("pair-list");
      return !inList && CANARIES.some((n) => own.includes(n) || labels.includes(n));
    });
    expect(outside.map((el) => `${el.tagName}.${el.className}`)).toEqual([]);
    for (const note of root.querySelectorAll(".tool-note, .notice, .empty, .lead, .caption, .fact")) {
      for (const name of CANARIES) expect(textOf(note), name).not.toContain(name);
    }
    for (const line of said) for (const name of CANARIES) expect(line, name).not.toContain(name);
    expect(root.querySelector(".tool-failed")).toBeNull();
  });

  it("names nobody on the empty page", async () => {
    const { root } = await renderSettled(view, real(PLAIN));
    expect(root.textContent).not.toContain("zq");
  });

  it("holds a name that tries to be markup as text, and has no copy button that would name it in a label", async () => {
    const { root } = await renderSettled(view, real({ ...PLAIN, friends: [rec("<b>zqmike</b>_t"), rec("<b>zqmike</b>.t")] }));
    expect(names(root)).toEqual(["<b>zqmike</b>.t", "<b>zqmike</b>_t"]);
    expect(root.querySelectorAll(".pair-list b")).toHaveLength(0);
    expect(root.querySelectorAll("[aria-label]").filter((e) => (e.getAttribute("aria-label") ?? "").includes("zqmike"))).toHaveLength(0);
  });
});

describe("its words", () => {
  it("pass the copy lint: sentence case, US English, quotes, punctuation and lengths", () => {
    const entries = collectCopy({ tool_lookalike_usernames: copy });
    expect(entries.length).toBeGreaterThan(20);
    expect(RULES.flatMap((rule) => lint(entries, rule))).toEqual([]);
  });

  it("pass the copy lint as drawn, on the pairs, the notes and the empty page", async () => {
    const { renderedEntries } = await import("../copy-rules.ts");
    const all = new Map<string, ReturnType<typeof renderedEntries>[number]>();
    for (const state of [real(CRAFTED), real(PLAIN)]) {
      const { root } = await renderSettled(view, state);
      for (const e of renderedEntries(root, "lookalike-usernames")) all.set(`${e.kind}|${e.text}`, e);
    }
    expect([...all.values()].length).toBeGreaterThan(10);
    expect(RULES.flatMap((rule) => lint([...all.values()], rule))).toEqual([]);
  });

  it("fit the hub: a short title, a one-sentence tile line and a short description", () => {
    expect(copy.title.length).toBeLessThanOrEqual(28);
    expect(copy.oneLiner.length).toBeLessThanOrEqual(56);
    expect(copy.description.split(/\s+/).length).toBeLessThanOrEqual(25);
    expect(copy.reads.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it("never accuse: no verdict about a person, only that a pair may be worth a second look", () => {
    const all = collectCopy({ tool_lookalike_usernames: copy }).map((e) => e.text).join(" ");
    expect(all).not.toMatch(/\b(fake|impostor|imposter|scam\w*|fraud\w*|spam\w*|catfish\w*|suspicious|dangerous|unsafe)\b/i);
    expect(all).toMatch(/\bmay be worth a second look\b/);
  });
});
