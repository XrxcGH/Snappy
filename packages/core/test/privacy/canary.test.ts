/**
 * THE PRIVACY GATE.
 *
 * Runs the whole pipeline on a synthetic export whose personal fields (message text,
 * display names, group titles, locations, captions, sources, account details) are filled
 * with distinctive canary strings, proves the canaries are really present in the raw export
 * bytes, and then asserts none of them is reachable from ANY output of @snappy-export/core:
 * parsed export, snapshots, ledger serialisation, sealed-ledger plaintext, candidates and
 * evidence, cleanup queue, memories plan, issue messages, structure reports and the text of
 * every error thrown by core when fed garbage. Synthetic data only.
 */
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  CANARIES,
  addSnapshot,
  buildSyntheticExport,
  buildCleanupQueue,
  deserializeLedger,
  describeStructure,
  embedJpegDate,
  emptyLedger,
  findDormant,
  findGhosts,
  findOneWay,
  formatStructureReport,
  openLedger,
  parseChatHistoryJson,
  parseExportFiles,
  parseExportZip,
  parseFriendsJson,
  parseMemoriesJson,
  patchMp4Dates,
  planMemories,
  serializeLedger,
  sealLedger,
  sniffMediaType,
  snapshotFromExport,
  storageMeter,
  syntheticExportZip,
  validateExport,
} from "../../src/index.ts";
import type { ExportIssue, ParsedExport } from "../../src/index.ts";
import { FIXED_NOW, runPipeline } from "../integration/pipeline-helpers.ts";

// ---------------------------------------------------------------- canaries ---

/**
 * Every canary string, plus the distinctive numeric parts of the coordinate-like ones
 * (JSON.stringify would render 66.606660 as 66.60666, so the raw string alone could miss).
 * The generic fragments "73.37" and "16.16" are omitted on purpose: they collide with
 * ordinary numbers such as timestamps.
 */
const ALL_CANARIES: string[] = [
  ...Object.values(CANARIES).flat(),
  "13.371337",
  "42.424242",
  "117.171717",
  "66.60666",
  "ZQCANARY",
];

/** Return every canary found in `text` (case-insensitive, because usernames etc. are lower-cased). */
function leaks(text: string): string[] {
  const hay = text.toLowerCase();
  return ALL_CANARIES.filter((c) => hay.includes(c.toLowerCase()));
}

function expectClean(label: string, value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(text, `${label} must be serialisable`).toBeTypeOf("string");
  expect(leaks(text), `canary leaked into ${label}`).toEqual([]);
}

const r = runPipeline();

// ------------------------------------------------------------ preconditions ---

describe("privacy gate: the canaries are real", () => {
  const rawText = (phase: 1 | 2): string => {
    const files = buildSyntheticExport({ now: FIXED_NOW, phase, bundleMedia: true });
    return Object.entries(files)
      .map(([name, bytes]) => `${name}\n${strFromU8(bytes)}`)
      .join("\n");
  };
  const raw = `${rawText(1)}\n${rawText(2)}`;

  it("every canary of every list is present in the raw export JSON", () => {
    for (const [group, list] of Object.entries(CANARIES)) {
      for (const c of list) expect(raw, `${group} canary missing from raw export: ${c}`).toContain(c);
    }
  });

  it("the canaries survive zipping (they are inside the compressed archive)", () => {
    const zip = syntheticExportZip({ now: FIXED_NOW, phase: 2 });
    const inflated = Object.values(unzipSync(zip)).map((b) => strFromU8(b)).join("\n");
    for (const list of Object.values(CANARIES)) {
      for (const c of list) expect(inflated).toContain(c);
    }
  });

  it("the parser really did read the file that holds them (non-vacuous run)", () => {
    expect(r.parsed2.friends.friends.length).toBeGreaterThan(50);
    expect(r.parsed2.chats.length).toBeGreaterThan(500);
    expect(r.parsed2.memories.length).toBeGreaterThan(100);
    expect(r.ghosts.length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------ pipeline output ---

describe("privacy gate: pipeline outputs contain no canary", () => {
  it("ParsedExport (entire, both phases)", () => {
    expectClean("parsed1", r.parsed1);
    expectClean("parsed2", r.parsed2);
  });

  it("ParsedExport from a zip that also bundles media", () => {
    for (const phase of [1, 2] as const) {
      const parsed = parseExportZip(syntheticExportZip({ now: FIXED_NOW, phase, bundleMedia: true }));
      expect(parsed.memories.some((m) => m.zipPath !== undefined)).toBe(true);
      expectClean(`bundled parsed${phase}`, parsed);
    }
  });

  it("ParsedExport from already-unzipped files", () => {
    for (const phase of [1, 2] as const) {
      expectClean(
        `parseExportFiles phase ${phase}`,
        parseExportFiles(buildSyntheticExport({ now: FIXED_NOW, phase, bundleMedia: true })),
      );
    }
  });

  it("every Snapshot", () => {
    for (const s of [r.snap1, r.snap2, ...r.ledger.snapshots]) expectClean(`snapshot ${s.id}`, s);
  });

  it("snapshots carry exactly the contract fields", () => {
    const fields = ["friendSince", "friends", "id", "sentAt", "sentRequests", "deleted", "source", "takenAt"].sort();
    for (const s of r.ledger.snapshots) {
      // `blocked` is the one optional contract field: normalised usernames only, omitted when empty.
      expect(Object.keys(s).filter((k) => k !== "blocked").sort()).toEqual(fields);
      if (s.blocked !== undefined) {
        expect(s.blocked.length).toBeGreaterThan(0);
        for (const b of s.blocked) expect(b).toBe(b.trim().toLowerCase());
      }
    }
  });

  it("the ledger serialisation", () => {
    expectClean("serializeLedger", r.serialized);
    expectClean("ledger object", r.ledger);
  });

  it("the sealed ledger: ciphertext, and the decrypted plaintext", async () => {
    const sealed = await sealLedger(r.ledger, "canary-test passphrase");
    expectClean("sealed bytes (latin-1 view)", Array.from(sealed, (b) => String.fromCharCode(b)).join(""));
    const opened = await openLedger(sealed, "canary-test passphrase");
    expectClean("decrypted ledger", opened);
    expectClean("decrypted ledger serialisation", serializeLedger(opened));
    expect(opened).toEqual(r.ledger);
  });

  it("the sealed ledger does not even contain plaintext usernames", async () => {
    const sealed = await sealLedger(r.ledger, "another passphrase");
    const view = Array.from(sealed, (b) => String.fromCharCode(b)).join("");
    for (const name of r.snap2.friends.slice(0, 20)) expect(view).not.toContain(name);
  });

  it("every Candidate and Evidence", () => {
    expect(r.ghosts.length + r.oneWay.length + r.dormant.length).toBeGreaterThan(0);
    for (const c of [...r.ghosts, ...r.oneWay, ...r.dormant]) {
      expectClean(`candidate ${c.category}`, c);
      for (const e of c.evidence) {
        expectClean(`evidence ${e.signal}`, e);
        expect(leaks(e.detail)).toEqual([]);
      }
    }
  });

  it("candidates have exactly the contract fields (no extras that could carry content)", () => {
    for (const c of [...r.ghosts, ...r.oneWay, ...r.dormant]) {
      expect(Object.keys(c).sort()).toEqual(["category", "confidence", "evidence", "key", "protectedBy", "score"]);
      for (const e of c.evidence) expect(Object.keys(e).every((k) => ["signal", "detail", "weight", "at"].includes(k))).toBe(true);
    }
  });

  it("evidence text never echoes a username", () => {
    const names = new Set([...r.snap1.friends, ...r.snap2.friends, ...r.snap1.sentRequests]);
    for (const c of [...r.ghosts, ...r.oneWay, ...r.dormant]) {
      for (const e of c.evidence) {
        const text = `${e.signal} ${e.detail}`.toLowerCase();
        for (const n of names) expect(text.includes(n), `evidence for a ${c.category} echoes a username`).toBe(false);
      }
    }
  });

  it("the CleanupQueue (items, protected items, summary)", () => {
    expect(r.queue.items.length).toBeGreaterThan(0);
    expectClean("cleanup queue", r.queue);
  });

  it("a CleanupQueue built with an allowlist", () => {
    const q = runPipeline({ allowlist: r.queue.items.slice(0, 3).map((c) => c.key) }).queue;
    expect(q.protectedItems.length).toBeGreaterThan(0);
    expectClean("allowlisted queue", q);
  });

  it("the MemoriesPlan, including a flat and a year layout and the storage meter", () => {
    expectClean("plan year-month", r.plan);
    for (const layout of ["flat", "year", "year-month"] as const) {
      const plan = planMemories(r.parsed2.memories, { layout });
      expectClean(`plan ${layout}`, plan);
      for (const e of plan.entries) expect(e.relativePath).toMatch(/^[\w./ -]+$/);
    }
    expectClean("storage meter", storageMeter(r.parsed2.memories, { now: FIXED_NOW }));
  });

  it("every ExportIssue message (parse and validate)", () => {
    const issues: ExportIssue[] = [
      ...r.parsed1.issues,
      ...r.parsed2.issues,
      ...r.validateIssues,
      ...validateExport(r.parsed2, { now: FIXED_NOW, expectedFriendCount: 3 }),
    ];
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) {
      expectClean(`issue ${i.code}`, i);
      expect(["info", "warning", "error"]).toContain(i.severity);
    }
  });

  it("issue messages never echo a username or a download URL", () => {
    const names = [...r.snap1.friends, ...r.snap2.friends, ...r.snap1.sentRequests].filter((n) => n.length > 3);
    for (const i of [...r.parsed1.issues, ...r.parsed2.issues, ...r.validateIssues]) {
      const m = i.message.toLowerCase();
      for (const n of names) expect(m.includes(n), `issue ${i.code} echoes a username`).toBe(false);
      expect(m).not.toContain("snappy.invalid");
      expect(m).not.toContain("http");
    }
  });

  it("the structure report (default mode) of the whole export, zipped and unzipped", () => {
    for (const phase of [1, 2] as const) {
      const files = buildSyntheticExport({ now: FIXED_NOW, phase, bundleMedia: true });
      const report = describeStructure(files);
      expectClean("structure report", report);
      expectClean("formatted structure report", formatStructureReport(report));
    }
  });
});

// ------------------------------------------------------------------- errors ---

/** Everything an Error could show a user: name, message, own props, cause and stack. */
function describeThrown(e: unknown): string {
  if (e instanceof Error) {
    return [e.name, e.message, e.stack ?? "", JSON.stringify(Object.getOwnPropertyNames(e).map((k) => [k, String((e as never)[k])])), e.cause ? describeThrown(e.cause) : ""].join("\n");
  }
  return String(e);
}

/** Run `fn`; return thrown-error text (or "" if it did not throw) and any ExportIssues in its result. */
async function probe(fn: () => unknown): Promise<{ thrown: string; value: unknown }> {
  try {
    const value = await fn();
    return { thrown: "", value };
  } catch (e) {
    return { thrown: describeThrown(e), value: undefined };
  }
}

const enc = (s: string) => new TextEncoder().encode(s);
const C_MSG = CANARIES.messageText[0] as string;
const C_DN = CANARIES.displayNames[0] as string;
const C_GRP = CANARIES.groupTitles[0] as string;
const C_LOC = CANARIES.locations[0] as string;

function canaryJson(): string {
  return JSON.stringify({
    Friends: [{ Username: "ok_user", "Display Name": C_DN, Source: C_MSG }],
    [C_GRP]: [{ Content: C_MSG, Location: C_LOC, "Display Name": C_DN }],
    "Saved Media": [{ Date: C_MSG, "Media Type": C_DN, Location: C_LOC, "Download Link": C_GRP }],
  });
}

describe("privacy gate: errors and issues from malformed input never echo data", () => {
  const goodZip = syntheticExportZip({ now: FIXED_NOW, phase: 2, friendCount: 40 });
  const goodFiles = buildSyntheticExport({ now: FIXED_NOW, phase: 2, friendCount: 40 });

  // Malformed zips: truncations at many points, corrupted bytes, canary garbage.
  const zipCases: [string, Uint8Array][] = [
    ["empty", new Uint8Array(0)],
    ["canary text", enc(`${C_MSG} ${C_DN} ${C_GRP}`)],
    ["canary json", enc(canaryJson())],
    ["PK header + canary", Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...enc(C_MSG)])],
    ["EOCD only", Uint8Array.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])],
    ...[0.1, 0.3, 0.5, 0.8, 0.99].map((f): [string, Uint8Array] => [`truncated ${f}`, goodZip.slice(0, Math.floor(goodZip.length * f))]),
    ["tail cut", goodZip.slice(0, goodZip.length - 7)],
    ["head cut", goodZip.slice(30)],
    [
      "corrupted middle",
      (() => {
        const z = goodZip.slice();
        for (let i = 40; i < z.length - 200; i += 37) z[i] = (z[i]! ^ 0xa5) & 0xff;
        return z;
      })(),
    ],
  ];

  it("parseExportZip never throws on bad zips and its issues stay clean", async () => {
    for (const [label, bytes] of zipCases) {
      const { thrown, value } = await probe(() => parseExportZip(bytes));
      expect(thrown, `parseExportZip threw on ${label}`).toBe("");
      const parsed = value as ParsedExport;
      expectClean(`parseExportZip(${label})`, parsed);
      // parse issues + validation: a zip that yields nothing must never pass silently.
      expect(parsed.issues.length + validateExport(parsed).length, `${label} should report something`).toBeGreaterThan(0);
      expectClean(`validateExport(${label})`, validateExport(parsed));
    }
  });

  // Malformed JSON file contents handed to parseExportFiles.
  const brokenJsons: [string, Uint8Array][] = [
    ["truncated json", enc(`{"Friends":[{"Username":"x","Display Name":"${C_DN}`)],
    ["canary not json", enc(`${C_MSG} not json at all ${C_LOC}`)],
    ["bom + canary", Uint8Array.from([0xef, 0xbb, 0xbf, ...enc(`{"${C_GRP}": ${C_MSG}`)])],
    ["invalid utf-8", Uint8Array.from([0xff, 0xfe, 0xfd, ...enc(C_MSG), 0xc3, 0x28])],
    ["wrong shapes", enc(JSON.stringify({ Friends: C_MSG, "Deleted Friends": { a: C_DN }, "Friend Requests Sent": [C_MSG, 42, null, [C_DN]] }))],
    ["canary-laden valid", enc(canaryJson())],
    ["scalar", enc(JSON.stringify(C_MSG))],
    ["null", enc("null")],
    ["deeply nested", enc(`${"[".repeat(5000)}"${C_MSG}"${"]".repeat(5000)}`)],
  ];

  it("parseExportFiles never throws on malformed json files and its issues stay clean", async () => {
    for (const [label, bytes] of brokenJsons) {
      const { thrown, value } = await probe(() =>
        parseExportFiles({
          "json/friends.json": bytes,
          "json/chat_history.json": bytes,
          "json/memories_history.json": bytes,
          "json/account.json": bytes,
          [`html/${C_GRP}.html`]: bytes,
        }),
      );
      expect(thrown, `parseExportFiles threw on ${label}`).toBe("");
      expectClean(`parseExportFiles(${label})`, value);
    }
  });

  it("file names that carry personal text are masked in fileList", () => {
    const parsed = parseExportFiles({
      "json/friends.json": enc("{}"),
      [`html/chat_history/subpage_${C_DN}.html`]: enc("<p></p>"),
      [`mydata~${C_GRP}/json/chat_history.json`]: enc("{}"),
      [`notes/${C_MSG}.txt`]: enc("x"),
    });
    expectClean("fileList", parsed.fileList);
    expect(parsed.fileList).toContain("json/friends.json");
    expect(parsed.fileList.some((f) => f.endsWith("/chat_history.json"))).toBe(true);
    expect(parsed.fileList.some((f) => f.endsWith(".html"))).toBe(true);
  });

  it("the three section parsers tolerate arbitrary values without throwing or echoing", async () => {
    const values: unknown[] = [
      null, undefined, 0, 1.5, "", C_MSG, true, [], [C_MSG], {}, { [C_GRP]: C_MSG },
      JSON.parse(canaryJson()), [[[[C_DN]]]], { Friends: null }, { "Saved Media": {} },
      // A title with a space cannot be a username, so it is hashed even when no row says who sent it
      // (a username-shaped key with unknown direction is filed as a 1:1 username on purpose: see chats.ts).
      { [`${C_GRP} crew`]: [{ IsSender: C_MSG, Created: C_DN, "Media Type": C_LOC, From: C_MSG }] },
      { [`${C_GRP} crew`]: [{ IsSender: C_MSG, Created: "2023-04-01 12:30:00 UTC", "Media Type": C_LOC, From: C_MSG }] },
    ];
    for (const v of values) {
      for (const [name, fn] of [
        ["parseFriendsJson", () => parseFriendsJson(v)],
        ["parseChatHistoryJson", () => parseChatHistoryJson(v)],
        ["parseMemoriesJson", () => parseMemoriesJson(v)],
      ] as const) {
        const { thrown, value } = await probe(fn);
        expect(thrown, `${name} threw`).toBe("");
        expectClean(`${name} output`, value);
      }
    }
  });

  it("a group whose only saved sender is the owner (null title) never exposes its title", async () => {
    // Previously the title was filed as a 1:1 username: no title signal and no other sender.
    const title = `${C_GRP} weekend crew`;
    const history = {
      [title]: [{ From: "me", "Media Type": "TEXT", Created: "2023-04-01 12:30:00 UTC", IsSender: true, "Conversation Title": null }],
    };
    const { thrown, value } = await probe(() => parseChatHistoryJson(history));
    expect(thrown).toBe("");
    const parsed = value as ReturnType<typeof parseChatHistoryJson>;
    expect(parsed.chats).toHaveLength(1);
    expectClean("owner-only group chats", parsed);
    const now = FIXED_NOW;
    const queue = buildCleanupQueue([], parsed.chats, { now });
    expectClean("cleanup queue over owner-only group chats", queue);
  });

  it("validateExport tolerates garbage ParsedExport shapes", async () => {
    const shapes: unknown[] = [
      { friends: {}, chats: [], memories: [], fileList: [], issues: [] },
      { friends: { friends: [{ username: C_DN }] }, chats: [{ conversation: C_GRP }], memories: [{ id: C_MSG }], fileList: [C_LOC], issues: [] },
      {},
      null,
    ];
    for (const s of shapes) {
      const { thrown, value } = await probe(() => validateExport(s as ParsedExport, { now: FIXED_NOW }));
      // A throw is acceptable for a programmer error, but must never contain the data.
      expect(leaks(thrown), "validateExport error text").toEqual([]);
      if (thrown === "") expectClean("validateExport issues", value);
    }
  });

  it("snapshotFromExport without any known time throws a data-free message", async () => {
    const empty = parseExportFiles({});
    const { thrown } = await probe(() => snapshotFromExport({ ...empty, exportedAt: undefined }));
    expect(thrown).not.toBe("");
    expectClean("snapshotFromExport error", thrown);
  });

  it("deserializeLedger never echoes malformed or hostile input", async () => {
    const inputs = [
      "",
      C_MSG,
      `{"version": 1, "snapshots": "${C_MSG}"`,
      JSON.stringify({ version: 99, snapshots: [], note: C_MSG }),
      JSON.stringify({ version: 1, snapshots: [{ id: C_GRP, takenAt: C_MSG, friends: [C_DN], names: { x: { displayName: C_DN } }, extra: C_LOC }] }),
      JSON.stringify({ version: 1, snapshots: [null, 3, C_MSG, { friends: C_MSG }] }),
      JSON.stringify([C_MSG]),
      "null",
    ];
    for (const input of inputs) {
      const { thrown, value } = await probe(() => deserializeLedger(input));
      expect(leaks(thrown), "deserializeLedger error text").toEqual([]);
      if (thrown === "") {
        // Whatever survives loading must again be free of the hostile fields.
        const again = serializeLedger(value as never);
        expect(leaks(again).filter((c) => c !== C_GRP && c !== C_DN), "unknown fields must be dropped on load").toEqual([]);
        expect(again).not.toContain("displayName");
        expect(again).not.toContain("names");
      }
    }
  });

  it("serializeLedger drops extra properties smuggled onto a snapshot", () => {
    const snap = { ...r.snap2, names: { a: { displayName: C_DN } }, displayName: C_DN, text: C_MSG, location: C_LOC } as never;
    const out = serializeLedger(addSnapshot(emptyLedger(), snap));
    expectClean("serializeLedger(extra props)", out);
  });

  it("seal/open errors never echo the passphrase, the ledger or the ciphertext", async () => {
    const pass = `${C_MSG} pass`;
    const sealed = await sealLedger(r.ledger, pass);
    const tampered = sealed.slice();
    tampered[tampered.length - 3] = (tampered[tampered.length - 3]! ^ 1) & 0xff;
    const cases: [string, () => Promise<unknown>][] = [
      ["wrong passphrase", () => openLedger(sealed, `${C_DN} wrong`)],
      ["tampered", () => openLedger(tampered, pass)],
      ["truncated", () => openLedger(sealed.slice(0, 20), pass)],
      ["garbage", () => openLedger(enc(canaryJson()), pass)],
      ["empty", () => openLedger(new Uint8Array(0), pass)],
      ["empty passphrase on seal", () => sealLedger(r.ledger, "")],
      ["empty passphrase on open", () => openLedger(sealed, "")],
    ];
    for (const [label, fn] of cases) {
      const { thrown } = await probe(fn);
      expect(thrown, `${label} should fail`).not.toBe("");
      expect(leaks(thrown), `${label} error text`).toEqual([]);
      expect(thrown).not.toContain(pass);
      expect(thrown).not.toContain(" wrong");
    }
    // Failures are indistinguishable from each other (no oracle on why it failed).
    const msgs = new Set<string>();
    for (const label of ["wrong passphrase", "tampered", "truncated", "garbage"]) {
      const c = cases.find((x) => x[0] === label)!;
      try {
        await c[1]();
      } catch (e) {
        msgs.add((e as Error).message);
      }
    }
    expect(msgs.size).toBe(1);
  }, 20_000);

  it("detectors and queue tolerate hostile ParsedExport / candidate input without echoing", async () => {
    const hostile = {
      friends: {
        friends: [{ username: C_DN, createdAt: C_MSG }, null, 7],
        sentRequests: [{ username: C_GRP }, { username: 12 }],
        pendingRequests: [], deletedFriends: [{ username: C_LOC, deletedAt: "x" }], blocked: [], ignored: [], hiddenSuggestions: [],
      },
      chats: [{ conversation: C_GRP, isGroup: "yes", direction: C_MSG, kind: C_DN, at: C_LOC }, null],
      memories: [{ id: C_MSG, date: C_DN, mediaType: C_LOC, downloadUrl: C_GRP, sizeBytes: "big" }, null],
      fileList: [C_LOC], issues: [], exportedAt: FIXED_NOW,
    } as unknown as ParsedExport;
    const calls: [string, () => unknown][] = [
      ["findOneWay", () => findOneWay(hostile, { now: FIXED_NOW })],
      ["findDormant", () => findDormant(hostile, { now: FIXED_NOW })],
      ["findGhosts", () => findGhosts([{ ...r.snap1, friends: [C_DN, C_GRP] } as never, r.snap2], { now: FIXED_NOW })],
      ["buildCleanupQueue", () => buildCleanupQueue([{ key: "a", category: "ghost", confidence: "low", score: 0.1, evidence: [], protectedBy: [] }], hostile.chats, { now: FIXED_NOW })],
      ["planMemories", () => planMemories(hostile.memories)],
      ["storageMeter", () => storageMeter(hostile.memories, { now: FIXED_NOW })],
      ["snapshotFromExport", () => snapshotFromExport(hostile)],
    ];
    for (const [name, fn] of calls) {
      const { thrown } = await probe(fn);
      // Throwing on programmer error is tolerable; echoing the data is not.
      expect(leaks(thrown), `${name} error text`).toEqual([]);
    }
  });

  it("media helpers reject or ignore garbage without echoing", async () => {
    const junk = [new Uint8Array(0), enc(C_MSG), enc(canaryJson()), Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, ...enc(C_LOC)])];
    for (const b of junk) {
      for (const fn of [() => sniffMediaType(b), () => embedJpegDate(b, FIXED_NOW), () => patchMp4Dates(b, FIXED_NOW), () => embedJpegDate(b, Number.NaN)]) {
        const { thrown } = await probe(fn);
        expect(leaks(thrown), "media helper error text").toEqual([]);
      }
    }
  });

  it("the structure inspector handles garbage and keeps content out of its notes", async () => {
    const files: Record<string, Uint8Array> = {
      "json/friends.json": enc(`{"${C_GRP}": [{"Content": "${C_MSG}"`),
      "json/chat_history.json": enc(canaryJson()),
      [`json/${C_GRP}.json`]: enc(canaryJson()),
      "html/index.html": enc(`<p>${C_MSG}</p>`),
      [`memories/${C_LOC}.jpg`]: enc(C_MSG),
    };
    const { thrown, value } = await probe(() => formatStructureReport(describeStructure(files)));
    expect(thrown).toBe("");
    expectClean("inspector on garbage", value);
  });
});
