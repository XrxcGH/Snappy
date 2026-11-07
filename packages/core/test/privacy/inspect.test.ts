import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { describeStructure, describeZipStructure, formatStructureReport } from "../../src/export/inspect.ts";

const enc = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));

// Every value below is a canary: none of them may ever show up in a report.
const VALUE_CANARIES = [
  "canary_user_alpha", "Canary Display Name", "canary-value-9137", "canary message text zzq",
  "https://canary.example/download?id=777", "canary@example.com", "48.8566123", "canary_group_title",
];
// Unknown key names: hidden in default mode; dynamic maps hidden in both modes.
const DYNAMIC_KEY_CANARIES = Array.from({ length: 12 }, (_, i) => `canary_dyn_user_${i}`);
const UNKNOWN_FIELD = "CanaryExtraField";

function friendsJson() {
  const entry = (i: number) => ({
    Username: `${VALUE_CANARIES[0]}${i}`,
    "Display Name": VALUE_CANARIES[1],
    "Creation Timestamp": "2023-01-01 10:00:00 UTC",
    Source: VALUE_CANARIES[2],
    [UNKNOWN_FIELD]: VALUE_CANARIES[2],
  });
  return {
    Friends: Array.from({ length: 25 }, (_, i) => entry(i)),
    "Deleted Friends": [entry(1)],
    "Blocked Users": [],
  };
}

function chatJson() {
  const convo: Record<string, unknown[]> = {};
  for (const key of DYNAMIC_KEY_CANARIES) {
    convo[key] = [
      { From: VALUE_CANARIES[0], "Media Type": "TEXT", Created: "2023-01-01 10:00:00 UTC", Content: VALUE_CANARIES[3], IsSender: true },
      { From: VALUE_CANARIES[0], "Media Type": "MEDIA", Created: "2023-01-02 10:00:00 UTC", Content: null, IsSender: false, "Conversation Title": VALUE_CANARIES[7] },
    ];
  }
  convo[VALUE_CANARIES[7] as string] = [];
  return convo;
}

function memoriesJson() {
  return {
    "Saved Media": [
      {
        Date: "2023-02-02 10:00:00 UTC",
        "Media Type": "Image",
        Location: `Latitude, Longitude: ${VALUE_CANARIES[6]}, 2.3`,
        "Download Link": VALUE_CANARIES[4],
        "Media Download Url": VALUE_CANARIES[4],
      },
    ],
  };
}

function sampleFiles(): Record<string, Uint8Array> {
  return {
    "json/friends.json": enc(friendsJson()),
    "json/chat_history.json": enc(chatJson()),
    "json/memories_history.json": enc(memoriesJson()),
    "json/canary@example.com.json": enc({ a: 1 }),
    "json/personal_notes.json": enc({ a: 1 }),
    "html/index.html": enc(
      `<html><body><div>${VALUE_CANARIES[3]}</div><p>${VALUE_CANARIES[0]}</p><canary-tag>x</canary-tag></body></html>`,
    ),
    "memories/2023-04-01_canary_user_alpha-main.jpg": new Uint8Array(20_000),
    "memories/clip.MP4": new Uint8Array(5),
    "extras/canary_user_alpha.txt": enc("canary message text zzq"),
  };
}

function assertClean(text: string, allowUnknownField: boolean) {
  for (const c of [...VALUE_CANARIES, ...DYNAMIC_KEY_CANARIES, "personal_notes", "2023", "example.com"]) {
    expect(text.toLowerCase(), `leaked ${c}`).not.toContain(c.toLowerCase());
  }
  if (!allowUnknownField) {
    expect(text).not.toContain(UNKNOWN_FIELD);
    expect(text.toLowerCase()).not.toContain("canary");
  }
}

describe("describeStructure", () => {
  it("default mode shows vocabulary keys only and leaks no value or dynamic key", () => {
    const text = formatStructureReport(describeStructure(sampleFiles()));
    assertClean(text, false);
    for (const known of [
      "Friends", "Deleted Friends", "Username", "Display Name", "Creation Timestamp",
      "Saved Media", "Download Link", "IsSender", "Media Type",
    ]) {
      expect(text).toContain(known);
    }
    expect(text).toContain("<key>");
    expect(text).toContain("<dynamic keys x 10-99>");
  });

  it("showKeys mode reveals harmless unknown keys but still collapses dynamic maps", () => {
    const text = formatStructureReport(describeStructure(sampleFiles(), { showKeys: true }));
    assertClean(text, true);
    expect(text).toContain(UNKNOWN_FIELD);
    expect(text).toContain("<dynamic keys x 10-99>");
  });

  it("buckets counts instead of reporting them", () => {
    const text = formatStructureReport(describeStructure(sampleFiles()));
    expect(text).toContain("array[10-99]"); // 25 friends
    expect(text).not.toMatch(/array\[25\]/);
  });

  it("masks personal-looking file names and numbers masks deterministically", () => {
    const text = formatStructureReport(describeStructure(sampleFiles()));
    expect(text).toContain("json/friends.json");
    expect(text).toContain("json/chat_history.json");
    // numbered in sorted-path order: extras/*.txt, json/canary@*, json/personal_notes
    expect(text).toContain("<file-1>  [other");
    expect(text).toContain("<file-2>.json");
    expect(text).toContain("<file-3>.json");
    expect(text).toContain("<media-1>.jpg");
    expect(text).toContain("<media-2>.mp4");
    expect(text).toContain("10 KB-1 MB");
    expect(text).toContain("<10 KB");
  });

  it("reports html as a bucketed tag histogram only", () => {
    const report = describeStructure(sampleFiles());
    const html = report.files.find((f) => f.name === "html/index.html");
    expect(html?.tags).toEqual([
      { tag: "<other>", count: "1-9" },
      { tag: "body", count: "1-9" },
      { tag: "div", count: "1-9" },
      { tag: "html", count: "1-9" },
      { tag: "p", count: "1-9" },
    ]);
  });

  it("never reads media bytes (only their length)", () => {
    const poison = new Proxy(new Uint8Array(50_000), {
      get(target, prop) {
        if (prop === "length") return target.length;
        throw new Error("media bytes were read");
      },
    });
    const report = describeStructure({ "memories/a.jpg": poison as Uint8Array });
    expect(report.files[0]).toMatchObject({ name: "<media-1>.jpg", kind: "media", sizeBucket: "10 KB-1 MB" });
  });

  it("reports unparseable json without any snippet and never throws", () => {
    const secret = '{"Username": "canary_user_alpha", broken';
    const report = describeStructure({
      "json/friends.json": enc(secret),
      "json/chat_history.json": new Uint8Array([0xff, 0xfe, 0x00]),
    });
    const text = formatStructureReport(report);
    expect(text).toContain("unparseable json");
    expect(text).not.toContain("canary");
    expect(text).not.toContain("Unexpected");
  });

  it("is deterministic regardless of input order", () => {
    const a = sampleFiles();
    const reversed = Object.fromEntries(Object.entries(a).reverse());
    for (const showKeys of [false, true]) {
      const one = formatStructureReport(describeStructure(a, { showKeys }));
      expect(formatStructureReport(describeStructure(reversed, { showKeys }))).toBe(one);
      expect(formatStructureReport(describeStructure(a, { showKeys }))).toBe(one);
    }
  });

  it("refuses to print key names that could carry identifiers or break the layout", () => {
    const risky = {
      "bob@example.com": 1,
      "15551234567": 1,
      "line\nbreak injected": 1,
      ["x".repeat(41)]: 1,
      "+1 555 0100": 1,
      fine_key: 1,
    };
    const text = formatStructureReport(describeStructure({ "json/friends.json": enc(risky) }, { showKeys: true }));
    expect(text).not.toContain("@");
    expect(text).not.toContain("15551234567");
    expect(text).not.toContain("injected");
    expect(text).not.toContain("xxxx");
    expect(text).not.toContain("555");
    expect(text).toContain("fine_key");
    expect(text).toContain("<key>");
  });

  it("merges element shapes across an array and shows type unions", () => {
    const text = formatStructureReport(
      describeStructure({
        "json/friends.json": enc({ Friends: [{ Username: "a" }, { Username: null, Date: 5 }, { Username: 3 }] }),
      }),
    );
    expect(text).toMatch(/Date: number/);
    expect(text).toMatch(/Username: one of/);
  });

  it("collapses a dynamic map only when its values share a shape", () => {
    const mixed: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) mixed[`k${i}`] = i % 2 === 0 ? "s" : [1];
    const text = formatStructureReport(describeStructure({ "json/friends.json": enc(mixed) }, { showKeys: true }));
    expect(text).not.toContain("<dynamic keys");

    const same: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) same[`k${i}`] = "s";
    const collapsed = formatStructureReport(describeStructure({ "json/friends.json": enc(same) }, { showKeys: true }));
    expect(collapsed).toContain("<dynamic keys x 10-99>");
    expect(collapsed).not.toContain("k3");
  });

  it("handles hostile and large inputs without throwing", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 200; i++) deep = { Friends: [deep] };
    const proto = '{"__proto__": {"Username": "x"}, "constructor": 1}';
    const big = { Friends: Array.from({ length: 20_000 }, (_, i) => ({ Username: `u${i}`, "Creation Timestamp": i })) };
    const report = describeStructure({
      "json/friends.json": enc(deep),
      "json/chat_history.json": enc(proto),
      "json/memories_history.json": enc(big),
      "json/account.json": enc(""),
    });
    const text = formatStructureReport(report);
    expect(text).toContain("array[10000+]");
    expect(text).not.toContain("leaf");
  });
});

describe("describeZipStructure", () => {
  it("inflates only json/html and reports the same safe output", () => {
    const zip = zipSync(sampleFiles());
    const text = formatStructureReport(describeZipStructure(zip));
    assertClean(text, false);
    expect(text).toContain("<media-1>.jpg");
    expect(text).toContain("json/friends.json");
    expect(formatStructureReport(describeZipStructure(zip))).toBe(text);
  });

  it("lists media with a bucketed size without inflating it", () => {
    const zip = zipSync({ "json/friends.json": enc({ Friends: [] }), "memories/a.jpg": new Uint8Array(100_000) });
    const report = describeZipStructure(zip);
    expect(report.files.map((f) => f.name)).toEqual(["json/friends.json", "<media-1>.jpg"]);
    expect(report.files[1]?.sizeBucket).toBe("10 KB-1 MB");
  });

  it("reports an unreadable zip without details", () => {
    const report = describeZipStructure(enc("not a zip at all"));
    expect(report.notes).toEqual(["zip unreadable"]);
    expect(formatStructureReport(report)).toContain("note: zip unreadable");
  });
});
