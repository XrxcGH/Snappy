/**
 * The realistic synthetic export: the real 2026 shape (empty Memories links, bundled files with exact
 * UTC times, a Snap history, Snap-only friends, three zips). Synthetic data only.
 */
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CANARIES, DAY_MS, bytesReader, buildSyntheticExport, listZipEntries, normUser, syntheticExportParts, syntheticExportZip } from "../../src/index.ts";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const OPTS = { now: NOW, memoryCount: 300 } as const;

function listNames(zip: Uint8Array): string[] {
  const out: string[] = [];
  unzipSync(zip, { filter: (f) => (out.push(f.name), false) });
  return out;
}
const jsonOf = (zip: Uint8Array, name: string): any => {
  const files = unzipSync(zip, { filter: (f) => f.name === name });
  return JSON.parse(strFromU8(files[name] as Uint8Array));
};
const parts = syntheticExportParts(OPTS);
const part = (n: 1 | 2 | 3): Uint8Array => (parts[n - 1] as { bytes: Uint8Array }).bytes;
const MAIN = /^memories\/(\d{4}-\d{2}-\d{2})_([0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12})-main\.(jpg|mp4)$/;
const OVERLAY = /^memories\/(\d{4}-\d{2}-\d{2})_([0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12})-overlay\.png$/;

describe("the default export is left as it was", () => {
  it("has the four files, no Snap history and no Snap-only friends", () => {
    expect(Object.keys(buildSyntheticExport({ now: NOW })).sort()).toEqual(["json/account.json", "json/chat_history.json", "json/friends.json", "json/memories_history.json"]);
    const friends = JSON.parse(strFromU8(buildSyntheticExport({ now: NOW })["json/friends.json"] as Uint8Array));
    expect(JSON.stringify(friends)).not.toMatch(/snapper_/i);
  });

  it("still links Memories by download URL", () => {
    const media = JSON.parse(strFromU8(buildSyntheticExport({ now: NOW })["json/memories_history.json"] as Uint8Array))["Saved Media"];
    expect(media.some((m: Record<string, string>) => /^https:\/\/demo\.snappy\.invalid\//.test(m["Download Link"] ?? ""))).toBe(true);
  });
});

describe("syntheticExportParts", () => {
  it("makes three zips with the real names, in order", () => {
    expect(parts).toHaveLength(3);
    const [a, b, c] = parts.map((p) => p.name) as [string, string, string];
    expect(a).toMatch(/^mydata~\d{13}\.zip$/);
    expect(b).toBe(a.replace(/\.zip$/, "-2.zip"));
    expect(c).toBe(a.replace(/\.zip$/, "-3.zip"));
  });

  it("has the real folder layout: only part 1 has json/, memories/ is in parts 2 and 3", () => {
    const top = (zip: Uint8Array): string[] => [...new Set(listNames(zip).map((n) => n.split("/")[0] as string))].sort();
    expect(top(part(1))).toEqual(["chat_media", "html", "index.html", "json"]);
    expect(top(part(2))).toEqual(["chat_media", "memories", "shared_story"]);
    expect(top(part(3))).toEqual(["memories"]);
    expect(listNames(part(1)).filter((n) => n.startsWith("json/")).map((n) => n.slice(5)).sort()).toEqual([
      "account.json", "chat_history.json", "friends.json", "location_history.json", "memories_history.json", "search_history.json", "snap_history.json",
    ]);
  });

  it("is deterministic", () => {
    const again = syntheticExportParts(OPTS);
    again.forEach((p, i) => expect(p.bytes).toEqual((parts[i] as { bytes: Uint8Array }).bytes));
    expect(syntheticExportZip({ ...OPTS, realisticMemories: true })).toEqual(syntheticExportZip({ ...OPTS, realisticMemories: true }));
  });

  it("ignores the flag: it always builds the realistic shape", () => {
    expect(syntheticExportParts({ ...OPTS, realisticMemories: false }).map((p) => p.bytes)).toEqual(parts.map((p) => p.bytes));
  });

  it("gives the same export as one archive or one record when asked for it that way", () => {
    const one = unzipSync(syntheticExportZip({ ...OPTS, realisticMemories: true }));
    const record = buildSyntheticExport({ ...OPTS, realisticMemories: true });
    expect(Object.keys(one).sort()).toEqual(Object.keys(record).sort());
    expect(Object.keys(one).sort()).toEqual(parts.flatMap((p) => listNames(p.bytes)).sort());
    expect(one["json/snap_history.json"]).toEqual(record["json/snap_history.json"]);
  });
});

describe("realistic Memories", () => {
  const list = jsonOf(part(1), "json/memories_history.json")["Saved Media"] as Record<string, string>[];
  const mains = [...listNames(part(2)), ...listNames(part(3))].filter((n) => MAIN.test(n));
  const overlays = [...listNames(part(2)), ...listNames(part(3))].filter((n) => OVERLAY.test(n));

  it("has the requested number of entries, every link empty, exact dates that are all different", () => {
    expect(list).toHaveLength(OPTS.memoryCount);
    for (const m of list) {
      expect(m["Download Link"]).toBe("");
      expect(m["Media Download URL"]).toBe("");
      expect(m.Date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
      expect(["Image", "Video"]).toContain(m["Media Type"]);
    }
    expect(new Set(list.map((m) => m.Date)).size).toBe(list.length);
    const videos = list.filter((m) => m["Media Type"] === "Video").length / list.length;
    expect(videos).toBeGreaterThan(0.15);
    expect(videos).toBeLessThan(0.4);
  });

  it("gives about 70% of them a main file and about 3% of those an overlay with the same UUID", () => {
    expect(mains.length / list.length).toBeGreaterThan(0.6);
    expect(mains.length / list.length).toBeLessThan(0.8);
    expect(overlays.length).toBeGreaterThan(0);
    expect(overlays.length / mains.length).toBeLessThan(0.08);
    const mainIds = new Set(mains.map((n) => MAIN.exec(n)?.[2]));
    for (const o of overlays) expect(mainIds.has(OVERLAY.exec(o)?.[2])).toBe(true);
    expect(new Set(mains.map((n) => MAIN.exec(n)?.[2])).size).toBe(mains.length);
  });

  it("spreads the files over parts 2 and 3, each memories folder with one small html file", () => {
    for (const n of [2, 3] as const) {
      const files = listNames(part(n)).filter((f) => f.startsWith("memories/"));
      expect(files.filter((f) => f.endsWith(".html"))).toHaveLength(1);
      expect(files.filter((f) => MAIN.test(f)).length).toBeGreaterThan(5);
    }
    expect(listNames(part(2)).filter((n) => MAIN.test(n)).length).toBeGreaterThan(listNames(part(3)).filter((n) => MAIN.test(n)).length);
  });

  it("stores each main file with the extended UTC time of exactly one entry, and the name date is that UTC day", async () => {
    const byDate = new Map(list.map((m) => [m.Date, m] as const));
    let checked = 0;
    for (const n of [2, 3] as const) {
      const { entries } = await listZipEntries(bytesReader(part(n)));
      for (const e of entries) {
        const m = MAIN.exec(e.name);
        if (m === null) continue;
        const stamp = new Date(e.mtimeUtcMs as number).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
        expect(byDate.get(stamp), "no entry has this file's stored time").toBeDefined();
        expect(stamp.slice(0, 10)).toBe(m[1]);
        expect(["Image", "Video"][m[3] === "mp4" ? 1 : 0]).toBe(byDate.get(stamp)?.["Media Type"]);
        checked++;
      }
    }
    expect(checked).toBe(mains.length);
  });

  it("puts an extended UTC timestamp on every entry of every part", async () => {
    for (const p of parts) {
      const { entries } = await listZipEntries(bytesReader(p.bytes));
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.filter((e) => e.mtimeUtcMs === undefined)).toEqual([]);
    }
  });

  it("fills memories files and chat media with small, distinct files", () => {
    const files = unzipSync(part(2), { filter: (f) => /^(memories|chat_media|shared_story)\//.test(f.name) && !f.name.endsWith(".html") });
    expect(Object.keys(files).some((n) => n.startsWith("chat_media/"))).toBe(true);
    expect(Object.keys(files).some((n) => n.startsWith("shared_story/"))).toBe(true);
    expect(Math.max(...Object.values(files).map((b) => b.length))).toBeLessThan(2000);
  });
});

describe("realistic Snap history", () => {
  const snaps = jsonOf(part(1), "json/snap_history.json") as Record<string, Record<string, unknown>[]>;
  const chats = jsonOf(part(1), "json/chat_history.json") as Record<string, unknown[]>;
  const friends = jsonOf(part(1), "json/friends.json") as Record<string, Record<string, string>[]>;

  it("has the chat layout without message text, and a few hundred conversations", () => {
    expect(Object.keys(snaps).length).toBeGreaterThan(200);
    for (const list of Object.values(snaps)) {
      for (const s of list) {
        expect(Object.keys(s).sort()).toEqual(["Conversation Title", "Created", "Created(microseconds)", "From", "IsSender", "Media Type"]);
        expect(["IMAGE", "VIDEO"]).toContain(s["Media Type"]);
        expect(typeof s["Created(microseconds)"]).toBe("number");
      }
    }
    expect(strFromU8(unzipSync(part(1), { filter: (f) => f.name === "json/snap_history.json" })["json/snap_history.json"] as Uint8Array)).not.toContain('"Content"');
    const total = (o: Record<string, unknown[]>): number => Object.values(o).reduce((n, l) => n + l.length, 0);
    expect(total(snaps)).toBeGreaterThan(total(chats) * 2);
  });

  it("carries the group-title canaries, as keys and as conversation titles", () => {
    const raw = strFromU8(unzipSync(part(1), { filter: (f) => f.name === "json/snap_history.json" })["json/snap_history.json"] as Uint8Array);
    for (const title of CANARIES.groupTitles.slice(0, 3)) expect(raw).toContain(title);
    expect(Object.values(snaps).some((l) => l.some((s) => typeof s["Conversation Title"] === "string"))).toBe(true);
  });

  it("has friends who only exchange Snaps: friends in both phases, in no chat, Snapping within 10 days of each export", () => {
    const snappers = (friends.Friends ?? []).map((f) => f.Username as string).filter((u) => /^snapper_/i.test(u));
    expect(snappers.length).toBeGreaterThanOrEqual(1);
    const chatKeys = new Set(Object.keys(chats).map(normUser));
    const phase1 = syntheticExportParts({ ...OPTS, phase: 1 });
    const snaps1 = jsonOf((phase1[0] as { bytes: Uint8Array }).bytes, "json/snap_history.json") as Record<string, Record<string, number>[]>;
    const friends1 = jsonOf((phase1[0] as { bytes: Uint8Array }).bytes, "json/friends.json") as Record<string, Record<string, string>[]>;
    for (const name of snappers) {
      expect(chatKeys.has(normUser(name)), "a Snap-only friend appears in the chat history").toBe(false);
      expect((friends1.Friends ?? []).some((f) => normUser(f.Username as string) === normUser(name))).toBe(true);
      for (const [file, exportedAt] of [[snaps as Record<string, Record<string, number>[]>, NOW], [snaps1, NOW - 120 * DAY_MS]] as const) {
        const own = (file[name] ?? []).map((s) => (s["Created(microseconds)"] as number) / 1000);
        expect(own.length).toBeGreaterThan(5);
        expect(own.filter((t) => t > exportedAt - 10 * DAY_MS && t <= exportedAt).length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the quiet friends quiet: no Snaps from dormant_N", () => {
    const dormant = (friends.Friends ?? []).map((f) => f.Username as string).filter((u) => /^dormant_/i.test(u));
    expect(dormant.length).toBeGreaterThan(5);
    const snapKeys = new Set(Object.keys(snaps).map(normUser));
    expect(dormant.filter((u) => snapKeys.has(normUser(u)))).toEqual([]);
  });

  it("keeps the number of friends at friendCount, Snap-only friends included", () => {
    expect(friends.Friends).toHaveLength(120);
    expect(jsonOf(syntheticExportParts({ ...OPTS, friendCount: 40 })[0]!.bytes, "json/friends.json").Friends).toHaveLength(40);
  });

  it("is a prefix in time: phase 1 holds only what happened before the earlier export", () => {
    const phase1 = syntheticExportParts({ ...OPTS, phase: 1 });
    const snaps1 = jsonOf((phase1[0] as { bytes: Uint8Array }).bytes, "json/snap_history.json") as Record<string, Record<string, number>[]>;
    const t1 = NOW - 120 * DAY_MS;
    for (const list of Object.values(snaps1)) for (const s of list) expect((s["Created(microseconds)"] as number) / 1000).toBeLessThanOrEqual(t1);
    const count = (o: Record<string, unknown[]>): number => Object.values(o).reduce((n, l) => n + l.length, 0);
    expect(count(snaps1)).toBeGreaterThan(0);
    expect(count(snaps1)).toBeLessThan(count(snaps));
    // Memories of phase 1 are a subset of phase 2's.
    const dates2 = new Set((jsonOf(part(1), "json/memories_history.json")["Saved Media"] as Record<string, string>[]).map((m) => m.Date));
    const dates1 = (jsonOf((phase1[0] as { bytes: Uint8Array }).bytes, "json/memories_history.json")["Saved Media"] as Record<string, string>[]).map((m) => m.Date);
    expect(dates1.length).toBeLessThan(dates2.size);
    expect(dates1.every((d) => dates2.has(d))).toBe(true);
  });
});

describe("the canaries are still there to be kept out", () => {
  it("every canary of every list is present in the raw realistic export", () => {
    const raw = parts
      .flatMap((p) => Object.entries(unzipSync(p.bytes, { filter: (f) => f.name.endsWith(".json") })))
      .map(([name, bytes]) => `${name}\n${strFromU8(bytes)}`)
      .join("\n");
    for (const [group, list] of Object.entries(CANARIES)) {
      for (const c of list) expect(raw, `${group} canary missing: ${c}`).toContain(c);
    }
  });

  it("names the conversation pages after a person and a group, so a leaked name would be a canary", () => {
    const pages = listNames(part(1)).filter((n) => n.startsWith("html/chat_history/"));
    expect(pages.length).toBeGreaterThan(CANARIES.groupTitles.length);
    for (const title of CANARIES.groupTitles) expect(pages.some((p) => p.includes(title))).toBe(true);
  });
});
