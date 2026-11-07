import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import {
  CANARIES,
  SYNTHETIC_PHASE_GAP_DAYS,
  buildSyntheticExport,
  syntheticExportZip,
  syntheticExportedAt,
} from "../../src/testing/synthetic-export.ts";
import type { SyntheticExportOptions } from "../../src/testing/synthetic-export.ts";
import { DAY_MS, normUser, toMs } from "../../src/util.ts";

const NOW = Date.UTC(2025, 5, 15, 12, 0, 0);
const T2 = NOW;
const T1 = NOW - SYNTHETIC_PHASE_GAP_DAYS * DAY_MS;

type Json = Record<string, any>;
type Files = Record<string, Uint8Array>;

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);
const json = (files: Files, name: string): Json => JSON.parse(text(files[name])) as Json;
const allCanaries = () => Object.values(CANARIES).flat();

function exportOf(phase: 1 | 2, extra: Partial<SyntheticExportOptions> = {}): Files {
  return buildSyntheticExport({ now: NOW, phase, ...extra });
}

/** Normalised usernames of one friends.json section. */
function section(files: Files, name: string): string[] {
  const entries = (json(files, "json/friends.json")[name] ?? []) as Json[];
  return entries.map((e) => normUser(e.Username));
}
const ofKind = (names: string[], kind: string) => names.filter((n) => n.startsWith(`${kind}_`));
const sorted = (xs: Iterable<string>) => [...xs].sort();

/** Per-conversation message timestamps (ms) from chat_history.json. */
function chatTimes(files: Files): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [conv, msgs] of Object.entries(json(files, "json/chat_history.json"))) {
    out.set(normUser(conv), (msgs as Json[]).map((m) => toMs(m.Created) as number));
  }
  return out;
}

describe("options", () => {
  it("requires an explicit finite now (core never reads the clock)", () => {
    expect(() => buildSyntheticExport()).toThrow(TypeError);
    expect(() => buildSyntheticExport({ now: Number.NaN })).toThrow(TypeError);
    expect(() => syntheticExportZip({} as SyntheticExportOptions)).toThrow(TypeError);
  });

  it("reports the export time of each phase", () => {
    expect(syntheticExportedAt({ now: NOW, phase: 2 })).toBe(T2);
    expect(syntheticExportedAt({ now: NOW, phase: 1 })).toBe(T1);
    expect(syntheticExportedAt({ now: NOW })).toBe(T2);
  });

  it("emits the recalled file layout", () => {
    expect(Object.keys(exportOf(2)).sort()).toEqual([
      "json/account.json",
      "json/chat_history.json",
      "json/friends.json",
      "json/memories_history.json",
    ]);
  });

  it("honours friendCount, memoryCount and defaults", () => {
    const small = exportOf(2, { friendCount: 30, memoryCount: 50 });
    expect(json(small, "json/friends.json").Friends).toHaveLength(30);
    expect(json(small, "json/memories_history.json")["Saved Media"]).toHaveLength(50);
    const def = exportOf(2);
    expect(json(def, "json/friends.json").Friends).toHaveLength(120);
    expect(json(def, "json/memories_history.json")["Saved Media"]).toHaveLength(400);
  });
});

describe("determinism", () => {
  it("same options give byte-identical files and zip", () => {
    const a = exportOf(2, { seed: 7 });
    const b = exportOf(2, { seed: 7 });
    expect(Object.keys(a)).toEqual(Object.keys(b));
    for (const name of Object.keys(a)) expect(Buffer.compare(a[name]!, b[name]!)).toBe(0);
    const za = syntheticExportZip({ now: NOW, seed: 7, bundleMedia: true });
    const zb = syntheticExportZip({ now: NOW, seed: 7, bundleMedia: true });
    expect(Buffer.compare(za, zb)).toBe(0);
  });

  it("a different seed gives a different export", () => {
    const a = exportOf(2, { seed: 1 });
    const b = exportOf(2, { seed: 2 });
    expect(Buffer.compare(a["json/chat_history.json"]!, b["json/chat_history.json"]!)).not.toBe(0);
    expect(Buffer.compare(a["json/friends.json"]!, b["json/friends.json"]!)).not.toBe(0);
  });
});

describe("JSON validity and zip round-trip", () => {
  it("every file parses as JSON", () => {
    for (const phase of [1, 2] as const) {
      const files = exportOf(phase);
      for (const [name, bytes] of Object.entries(files)) {
        expect(() => JSON.parse(text(bytes)), name).not.toThrow();
      }
    }
  });

  it("round-trips through fflate unchanged", () => {
    const files = exportOf(2, { bundleMedia: true });
    const back = unzipSync(syntheticExportZip({ now: NOW, bundleMedia: true }));
    expect(Object.keys(back).sort()).toEqual(Object.keys(files).sort());
    for (const name of Object.keys(files)) expect(Buffer.compare(back[name]!, files[name]!)).toBe(0);
  });

  it("zip entries carry the export date (not the wall clock)", () => {
    const bytes = syntheticExportZip({ now: NOW, friendCount: 10, memoryCount: 5 });
    // First local file header: DOS time at offset 10, DOS date at offset 12 (little-endian).
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const date = view.getUint16(12, true);
    expect([1980 + (date >> 9), (date >> 5) & 15, date & 31]).toEqual([2025, 6, 15]);
  });
});

describe("phase set algebra", () => {
  const p1 = exportOf(1);
  const p2 = exportOf(2);
  const f1 = section(p1, "Friends");
  const f2 = section(p2, "Friends");

  it("friend sets follow the scenario conventions", () => {
    const kinds = (xs: string[]) => new Set(xs.map((n) => n.split("_")[0]));
    expect(kinds(f1)).toEqual(new Set(["active", "dormant", "ghost", "removed"]));
    expect(kinds(f2)).toEqual(new Set(["active", "dormant", "newfriend"]));
    expect(sorted(ofKind(f1, "active"))).toEqual(sorted(ofKind(f2, "active")));
    expect(sorted(ofKind(f1, "dormant"))).toEqual(sorted(ofKind(f2, "dormant")));
  });

  it("friend lists contain no duplicates", () => {
    expect(new Set(f1).size).toBe(f1.length);
    expect(new Set(f2).size).toBe(f2.length);
  });

  it("ghosts vanish from phase 2 WITHOUT being deleted by the user", () => {
    const ghosts = ofKind(f1, "ghost");
    expect(ghosts.length).toBeGreaterThan(0);
    const deleted2 = new Set(section(p2, "Deleted Friends"));
    const sent2 = new Set(section(p2, "Friend Requests Sent"));
    for (const g of ghosts) {
      expect(f2).not.toContain(g);
      expect(deleted2.has(g)).toBe(false);
      expect(sent2.has(g)).toBe(false);
    }
    expect(new Set(section(p1, "Deleted Friends")).has(ghosts[0]!)).toBe(false);
  });

  it("removed friends reappear in phase 2 Deleted Friends with a deletion time between the exports", () => {
    const removed = ofKind(f1, "removed");
    expect(removed.length).toBeGreaterThan(0);
    const deleted1 = new Set(section(p1, "Deleted Friends"));
    const entries2 = json(p2, "json/friends.json")["Deleted Friends"] as Json[];
    for (const name of removed) {
      expect(f2).not.toContain(name);
      expect(deleted1.has(name)).toBe(false);
      const entry = entries2.find((e) => normUser(e.Username) === name)!;
      expect(entry).toBeDefined();
      const when = [entry["Creation Timestamp"], entry["Last Modified Timestamp"], entry.Date]
        .map(toMs)
        .find((v) => v !== undefined)!;
      expect(when).toBeGreaterThan(T1);
      expect(when).toBeLessThan(T2);
    }
  });

  it("deletion time lives under all three recalled keys across removed friends", () => {
    const entries2 = json(p2, "json/friends.json")["Deleted Friends"] as Json[];
    const keys = new Set<string>();
    for (const e of entries2) {
      for (const k of ["Creation Timestamp", "Last Modified Timestamp", "Date"]) if (k in e) keys.add(k);
    }
    expect(keys).toEqual(new Set(["Creation Timestamp", "Last Modified Timestamp", "Date"]));
  });

  it("one-way requests persist in both phases and never become friends", () => {
    const o1 = section(p1, "Friend Requests Sent");
    const o2 = section(p2, "Friend Requests Sent");
    expect(o1.length).toBeGreaterThan(0);
    expect(sorted(o1)).toEqual(sorted(o2));
    for (const n of o1) {
      expect(n.startsWith("oneway_")).toBe(true);
      expect([...f1, ...f2]).not.toContain(n);
    }
    const entry = (json(p1, "json/friends.json")["Friend Requests Sent"] as Json[])[0]!;
    expect(toMs(entry["Creation Timestamp"])).toBeLessThan(T1 - 100 * DAY_MS);
  });

  it("new friends exist only in phase 2", () => {
    const fresh = ofKind(f2, "newfriend");
    expect(fresh.length).toBeGreaterThan(0);
    for (const n of fresh) expect(f1).not.toContain(n);
    for (const n of fresh) expect(new Set(section(p1, "Deleted Friends")).has(n)).toBe(false);
  });

  it("ex-friends are deleted in both phases and never friends", () => {
    const e1 = ofKind(section(p1, "Deleted Friends"), "exfriend");
    const e2 = ofKind(section(p2, "Deleted Friends"), "exfriend");
    expect(e1.length).toBeGreaterThan(0);
    expect(sorted(e1)).toEqual(sorted(e2));
    for (const n of e1) expect([...f1, ...f2]).not.toContain(n);
  });

  it("static sections are identical in both phases and disjoint from friends", () => {
    for (const name of ["Blocked Users", "Ignored Snapchatters", "Pending Requests", "Hidden Friend Suggestions"]) {
      const a = section(p1, name);
      expect(a.length, name).toBeGreaterThan(0);
      expect(sorted(a), name).toEqual(sorted(section(p2, name)));
      for (const n of a) expect([...f1, ...f2]).not.toContain(n);
    }
  });

  it("mixes usernames across case and every name normalises to a unique key", () => {
    const raw = (json(p2, "json/friends.json").Friends as Json[]).map((e) => e.Username as string);
    expect(raw.some((n) => n !== n.toLowerCase())).toBe(true);
    expect(raw.some((n) => n === n.toLowerCase())).toBe(true);
    expect(new Set(raw.map(normUser)).size).toBe(raw.length);
  });

  it("scenario guarantees hold for friendCount in a small demo", () => {
    const tiny = exportOf(2, { friendCount: 12 });
    expect(json(tiny, "json/friends.json").Friends).toHaveLength(12);
    const names = section(tiny, "Friends");
    expect(ofKind(names, "active").length).toBeGreaterThan(0);
    expect(ofKind(section(exportOf(1, { friendCount: 12 }), "Friends"), "ghost").length).toBeGreaterThan(0);
  });
});

describe("chat history scenarios", () => {
  const p1 = exportOf(1);
  const p2 = exportOf(2);
  const c1 = chatTimes(p1);
  const c2 = chatTimes(p2);
  const last = (times: number[] | undefined) => (times && times.length ? Math.max(...times) : -Infinity);

  it("nothing in phase 1 is dated after the phase 1 export, and it is a prefix of phase 2", () => {
    for (const [conv, times] of c1) {
      expect(Math.max(...times), conv).toBeLessThanOrEqual(T1);
      const later = c2.get(conv)!;
      expect(later, conv).toBeDefined();
      expect(later.filter((t) => t <= T1).length, conv).toBe(times.length);
    }
    for (const times of c2.values()) expect(Math.max(...times)).toBeLessThanOrEqual(T2);
  });

  it("active friends chatted within 10 days of each export", () => {
    const f2 = ofKind(section(p2, "Friends"), "active");
    expect(f2.length).toBeGreaterThan(0);
    for (const n of f2) {
      expect(T1 - last(c1.get(n)), n).toBeLessThanOrEqual(10 * DAY_MS);
      expect(T2 - last(c2.get(n)), n).toBeLessThanOrEqual(10 * DAY_MS);
    }
  });

  it("dormant friends have no chat in the 12 months before either export", () => {
    for (const n of ofKind(section(p2, "Friends"), "dormant")) {
      expect(T1 - last(c1.get(n)), n).toBeGreaterThan(365 * DAY_MS);
      expect(T2 - last(c2.get(n)), n).toBeGreaterThan(365 * DAY_MS);
    }
  });

  it("ghosts last chatted 45+ days before the phase 1 export, and never after it", () => {
    for (const n of ofKind(section(p1, "Friends"), "ghost")) {
      expect(T1 - last(c1.get(n)), n).toBeGreaterThanOrEqual(45 * DAY_MS);
      expect(last(c2.get(n)), n).toBeLessThanOrEqual(T1);
    }
  });

  it("non-friend scenarios (one-way, blocked, ...) never chat", () => {
    for (const kind of ["oneway", "blocked", "ignored", "pending", "suggest", "exfriend"]) {
      for (const conv of c2.keys()) expect(conv.startsWith(`${kind}_`), conv).toBe(false);
    }
  });

  it("new friends chat in the last 10 days of phase 2", () => {
    for (const n of ofKind(section(p2, "Friends"), "newfriend")) {
      expect(T2 - last(c2.get(n)), n).toBeLessThanOrEqual(10 * DAY_MS);
    }
  });

  it("chat entries follow the recalled shape, with micros matching Created", () => {
    const chats = json(p2, "json/chat_history.json");
    let seen = 0;
    for (const msgs of Object.values(chats)) {
      for (const m of msgs as Json[]) {
        seen++;
        expect(["TEXT", "MEDIA", "NOTE", "STICKER"]).toContain(m["Media Type"]);
        expect(typeof m.IsSender).toBe("boolean");
        expect(toMs(m.Created)).toBe((m["Created(microseconds)"] as number) / 1000);
        expect(m.From).toBeTypeOf("string");
      }
    }
    expect(seen).toBeGreaterThan(1000);
  });

  it("includes group chats keyed by title, with Conversation Title set, and 1:1 chats with it null", () => {
    const chats = json(p2, "json/chat_history.json");
    const groups = Object.entries(chats).filter(([, msgs]) => (msgs as Json[])[0]!["Conversation Title"] !== null);
    expect(groups.length).toBeGreaterThanOrEqual(CANARIES.groupTitles.length);
    for (const [key, msgs] of groups) {
      for (const m of msgs as Json[]) expect(m["Conversation Title"]).toBe(key);
    }
    expect(groups.some(([k]) => /[^\x00-\x7f]/.test(k))).toBe(true); // emoji/unicode titles
    const oneToOne = Object.entries(chats).filter(([k]) => !groups.some(([g]) => g === k));
    expect(oneToOne.length).toBeGreaterThan(50);
    for (const [, msgs] of oneToOne) expect((msgs as Json[])[0]!["Conversation Title"]).toBeNull();
  });

  it("chatMessageCount scales the phase 2 history", () => {
    const total = (f: Files) => [...chatTimes(f).values()].reduce((s, t) => s + t.length, 0);
    expect(total(exportOf(2, { chatMessageCount: 2000 }))).toBe(2000);
    expect(total(exportOf(2, { chatMessageCount: 6000 }))).toBe(6000);
  });
});

describe("memories", () => {
  const p1 = exportOf(1);
  const p2 = exportOf(2);
  const items = (f: Files) => json(f, "json/memories_history.json")["Saved Media"] as Json[];

  it("has duplicates by URL, undated entries, images, videos and unknown types", () => {
    const list = items(p2);
    const links = list.map((m) => m["Download Link"] as string);
    expect(new Set(links).size).toBeLessThan(links.length);
    expect(list.some((m) => toMs(m.Date) === undefined)).toBe(true);
    expect(list.some((m) => m["Media Type"] === "Video")).toBe(true);
    expect(list.some((m) => m["Media Type"] === "Image")).toBe(true);
    expect(list.some((m) => m["Media Type"] !== "Video" && m["Media Type"] !== "Image")).toBe(true);
    expect(list.some((m) => !("Media Download Url" in m))).toBe(true);
  });

  it("lists newest first and never post-dates its export; phase 1 is a subset of phase 2", () => {
    const dated = (f: Files) => items(f).map((m) => toMs(m.Date)).filter((t): t is number => t !== undefined);
    const d2 = dated(p2);
    expect(d2).toEqual([...d2].sort((a, b) => b - a));
    expect(Math.max(...d2)).toBeLessThanOrEqual(T2);
    expect(Math.max(...dated(p1))).toBeLessThanOrEqual(T1);
    const links2 = new Set(items(p2).map((m) => m["Download Link"]));
    for (const m of items(p1)) expect(links2.has(m["Download Link"])).toBe(true);
    expect(items(p1).length).toBeLessThan(items(p2).length);
  });

  it("only points at the reserved .invalid TLD so a demo can never reach a real server", () => {
    for (const m of items(p2)) {
      for (const key of ["Download Link", "Media Download Url"]) {
        if (key in m) expect(new URL(m[key] as string).hostname.endsWith(".invalid")).toBe(true);
      }
    }
  });
});

describe("bundled media", () => {
  it("is absent by default and tiny but structurally valid when requested", () => {
    expect(Object.keys(exportOf(2)).some((n) => n.startsWith("memories/"))).toBe(false);
    const files = exportOf(2, { bundleMedia: true });
    const media = Object.entries(files).filter(([n]) => n.startsWith("memories/"));
    expect(media.length).toBeGreaterThan(0);
    for (const [name, bytes] of media) {
      expect(bytes.length, name).toBeLessThan(2000);
      if (name.endsWith(".jpg")) {
        expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
        expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd9]);
      } else {
        expect(name.endsWith(".mp4")).toBe(true);
        expect(text(bytes.subarray(4, 8))).toBe("ftyp");
      }
    }
    expect(media.some(([n]) => n.endsWith(".jpg"))).toBe(true);
    expect(media.some(([n]) => n.endsWith(".mp4"))).toBe(true);
  });

  it("file names and bytes carry no canary", () => {
    const files = exportOf(2, { bundleMedia: true });
    for (const [name, bytes] of Object.entries(files)) {
      if (!name.startsWith("memories/")) continue;
      const hay = `${name}\n${Buffer.from(bytes).toString("latin1")}`;
      for (const c of allCanaries()) expect(hay.includes(c), `${name} / ${c}`).toBe(false);
    }
  });
});

describe("privacy canaries", () => {
  const raw = (f: Files, name: string) => text(f[name]);
  const cases: Array<[string, string[], string]> = [
    ["messageText", CANARIES.messageText, "json/chat_history.json"],
    ["displayNames", CANARIES.displayNames, "json/friends.json"],
    ["groupTitles", CANARIES.groupTitles, "json/chat_history.json"],
    ["locations", CANARIES.locations, "json/memories_history.json"],
    ["captions", CANARIES.captions, "json/memories_history.json"],
    ["sources", CANARIES.sources, "json/friends.json"],
    ["account", CANARIES.account, "json/account.json"],
  ];

  for (const phase of [1, 2] as const) {
    it(`every canary is present in the raw phase ${phase} JSON, so privacy tests are meaningful`, () => {
      const files = exportOf(phase);
      for (const [label, list, file] of cases) {
        expect(list.length, label).toBeGreaterThan(0);
        for (const c of list) expect(raw(files, file).includes(c), `${label}: ${c}`).toBe(true);
      }
    });
  }

  it("canaries sit in the personal fields they are meant to guard", () => {
    const p2 = exportOf(2);
    const friends = json(p2, "json/friends.json");
    const entries = Object.values(friends).flat() as Json[];
    expect(entries.some((e) => CANARIES.displayNames.some((c) => String(e["Display Name"]).includes(c)))).toBe(true);
    expect(entries.some((e) => CANARIES.sources.some((c) => String(e.Source).includes(c)))).toBe(true);
    const chats = json(p2, "json/chat_history.json");
    const msgs = Object.values(chats).flat() as Json[];
    expect(msgs.some((m) => CANARIES.messageText.some((c) => String(m.Content).includes(c)))).toBe(true);
    const mem = json(p2, "json/memories_history.json")["Saved Media"] as Json[];
    expect(mem.some((m) => CANARIES.locations.some((c) => String(m.Location).includes(c)))).toBe(true);
    expect(mem.some((m) => CANARIES.captions.some((c) => String(m.Caption).includes(c)))).toBe(true);
  });

  it("no canary is a substring of another, so a hit identifies exactly one source field", () => {
    const list = allCanaries();
    for (const a of list) for (const b of list) if (a !== b) expect(b.includes(a), `${a} in ${b}`).toBe(false);
  });

  it("usernames, conversation keys of 1:1 chats and file names never contain a canary", () => {
    for (const phase of [1, 2] as const) {
      const files = exportOf(phase);
      const friends = json(files, "json/friends.json");
      const usernames = (Object.values(friends).flat() as Json[]).map((e) => String(e.Username));
      const oneToOneKeys = Object.entries(json(files, "json/chat_history.json"))
        .filter(([, msgs]) => (msgs as Json[])[0]!["Conversation Title"] === null)
        .map(([k]) => k);
      const senders = (Object.values(json(files, "json/chat_history.json")).flat() as Json[]).map((m) => String(m.From));
      for (const value of [...usernames, ...oneToOneKeys, ...senders, ...Object.keys(files)]) {
        for (const c of allCanaries()) expect(value.includes(c), `${value} / ${c}`).toBe(false);
      }
    }
  });
});

describe("scale", () => {
  it("handles 5k friends and 100k chat events without blowing up", () => {
    const started = Date.now();
    const files = exportOf(2, { friendCount: 5000, chatMessageCount: 100_000, memoryCount: 3000 });
    expect(json(files, "json/friends.json").Friends).toHaveLength(5000);
    const total = [...chatTimes(files).values()].reduce((s, t) => s + t.length, 0);
    expect(total).toBeGreaterThanOrEqual(100_000);
    expect(total).toBeLessThan(110_000);
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);
});
