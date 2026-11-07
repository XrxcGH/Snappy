import { describe, expect, it } from "vitest";
import { syntheticExportParts, syntheticExportZip } from "@snappy-export/core";
import { LATER, NOW } from "../../cli/test/helpers.ts";
import { SCRUBBED_GLOBALS, SCRUBBED_NAVIGATOR, scrubScope } from "../src/terminal/scrub.ts";
import { createHelper, installHelper } from "../src/terminal/worker.ts";
import type { ToWorker } from "../src/terminal/protocol.ts";
import { runInHelper } from "./helper-harness.ts";

const later = syntheticExportZip({ now: LATER, friendCount: 40, memoryCount: 20, phase: 2 });
const blobOf = (name: string, bytes: Uint8Array): { name: string; blob: Blob } => ({ name, blob: new Blob([bytes as BlobPart]) });
const PASS = "CANARY-passphrase-zq81 for a test";

describe("scrubScope", () => {
  it("removes the network and code-starting features and leaves crypto and locks", () => {
    const scope: Record<string, unknown> = Object.fromEntries(SCRUBBED_GLOBALS.map((n) => [n, () => "live"]));
    scope.crypto = { subtle: {} };
    const navigator: Record<string, unknown> = { sendBeacon: () => true, locks: { request: () => 1 } };
    expect(scrubScope(scope, navigator)).toEqual([]);
    for (const name of SCRUBBED_GLOBALS) expect(scope[name], name).toBeUndefined();
    for (const name of SCRUBBED_NAVIGATOR) expect(navigator[name], name).toBeUndefined();
    expect(scope.crypto).toBeDefined();
    expect(navigator.locks).toBeDefined();
    // It cannot be put back by assignment either.
    expect(() => {
      scope.fetch = () => "back";
    }).toThrow();
    expect(scope.fetch).toBeUndefined();
  });

  it("removes what is inherited from a prototype, as the browser defines most of them", () => {
    const proto = { fetch: () => "live", indexedDB: {} };
    const scope = Object.create(proto) as Record<string, unknown>;
    scrubScope(scope);
    expect(scope.fetch).toBeUndefined();
    expect(scope.indexedDB).toBeUndefined();
  });

  it("names the features to remove", () => {
    expect(SCRUBBED_GLOBALS).toEqual(expect.arrayContaining(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "SharedWorker", "indexedDB", "caches"]));
    expect(SCRUBBED_NAVIGATOR).toEqual(["sendBeacon"]);
  });
});

describe("installHelper", () => {
  it("scrubs the scope first, then answers messages on it", async () => {
    const posted: unknown[] = [];
    const scope = {
      fetch: () => "live",
      WebSocket: class {},
      onmessage: null as ((e: { data: unknown }) => void) | null,
      postMessage: (m: unknown) => void posted.push(m),
      navigator: { sendBeacon: () => true },
    };
    installHelper(scope);
    expect(scope.fetch as unknown).toBeUndefined();
    expect(scope.navigator.sendBeacon as unknown).toBeUndefined();
    scope.onmessage?.({ data: { type: "run", runId: "r", argv: ["help"], files: [], columns: 80, coarse: false, outCap: 1000 } });
    await new Promise((r) => setTimeout(r, 30));
    expect((posted as { type: string }[]).map((m) => m.type)).toEqual(["out", "exit"]);
  });
});

describe("the helper", () => {
  it("runs a command, reports its output and posts exactly one exit", async () => {
    const r = await runInHelper(["help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: snappy-export <command>");
    expect(r.exits).toBe(1);
    expect(r.messages.at(-1)).toEqual({ type: "exit", code: 0 });
  });

  it("checks the argument list again and refuses what the page would have refused", async () => {
    for (const argv of [["memories", "/in/a.zip", "--out", "/out/m", "--download"], ["analyze", "/in/a.zip", "--ledger", "/out/x"], ["keep", "someone"], ["inspect", "/etc/passwd"], ["analyze", "/in/a.zip", "--csv", "/out/q.csv"]]) {
      const r = await runInHelper(argv, { files: [blobOf("a.zip", later)] });
      expect(r.code, argv.join(" ")).toBe(1);
      expect(r.out).toBe("Snappy cannot run that here.\n");
      expect(r.exits).toBe(1);
    }
  });

  it("ignores a second run request, and anything that is not a message", async () => {
    let send: ((to: ToWorker) => void) | undefined;
    const r = await runInHelper(["help"], { beforeRun: (s) => (send = s) });
    send?.({ type: "run", runId: "second", argv: ["help"], files: [], columns: 80, coarse: false, outCap: 10 });
    const handle = createHelper({ post: () => undefined });
    handle("nonsense");
    handle(null);
    handle({ type: "run" });
    expect(r.exits).toBe(1);
  });

  it("stops at once when cancel arrives before the run, and still exits once", async () => {
    const r = await runInHelper(["analyze", "/in/a.zip", "--no-save"], { files: [blobOf("a.zip", later)], beforeRun: (send) => send({ type: "cancel" }) });
    expect(r.code).toBe(130);
    expect(r.out).toMatch(/Stopped\. Nothing was changed\./);
    expect(r.exits).toBe(1);
  });

  it("keeps the files already saved when cancel arrives part way through a rescue", async () => {
    const parts = syntheticExportParts({ now: LATER, friendCount: 30, memoryCount: 120 });
    let send: ((to: ToWorker) => void) | undefined;
    let reads = 0;
    // Each file read from the third part on counts; the stop request comes after enough of them.
    const files = parts.map((p) => {
      const blob = new Blob([p.bytes as BlobPart]);
      const slice = blob.slice.bind(blob);
      blob.slice = (...args: Parameters<Blob["slice"]>) => {
        if (++reads === 120) send?.({ type: "cancel" });
        return slice(...args);
      };
      return { name: p.name, blob };
    });
    const argv = ["memories", ...parts.map((p) => `/in/${p.name}`), "--out", "/out/memories"];
    const r = await runInHelper(argv, { files, now: () => NOW, beforeRun: (s) => (send = s) });
    expect(r.code).toBe(130);
    expect(r.exits).toBe(1);
    expect(r.files.length).toBeGreaterThan(0);
    // The report is written only by a run that finished, so it is not among them.
    expect(r.files.some((f) => f.path.endsWith("memories-report.json"))).toBe(false);
  });

  it("turns a canceled passphrase prompt into a calm stop, and sends the passphrase nowhere it could be read", async () => {
    const asked = await runInHelper(["analyze", "/in/a.zip"], { files: [blobOf("a.zip", later)], answers: [null], now: () => NOW });
    expect(asked.code).toBe(130);
    expect(asked.out).toContain("Canceled. Nothing was changed.");
    expect(asked.questions).toEqual(["Passphrase for your saved history: "]);
    expect(asked.store.bytes).toBeNull();
  });

  it("never echoes the passphrase into any message, and keeps no copy in what it saves", async () => {
    const r = await runInHelper(["analyze", "/in/a.zip"], { files: [blobOf("a.zip", later)], answers: [PASS, PASS], now: () => NOW });
    expect(r.code).toBe(0);
    const everything = JSON.stringify(r.messages, (_k, v: unknown) => (v instanceof Uint8Array ? Buffer.from(v).toString("latin1") : v));
    expect(everything).not.toContain(PASS);
    expect(everything).not.toContain("CANARY-passphrase");
    // What was saved is sealed: neither the passphrase nor a username is readable in it.
    const sealed = Buffer.from(r.store.bytes as Uint8Array).toString("latin1");
    expect(sealed).not.toContain("CANARY-passphrase");
    expect(sealed.startsWith("SNPL")).toBe(true);
  });

  it("reports a refused saved-history write as a calm failure, not a crash", async () => {
    const r = await runInHelper(["analyze", "/in/a.zip"], { files: [blobOf("a.zip", later)], answers: [PASS, PASS], now: () => NOW, store: { bytes: null, refuseWrites: true } });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/No permission to write/);
    expect(r.store.bytes).toBeNull();
  });

  it("gets the saved history through the page and nowhere else", async () => {
    const first = await runInHelper(["analyze", "/in/a.zip"], { files: [blobOf("a.zip", later)], answers: [PASS, PASS], now: () => NOW });
    const status = await runInHelper(["ledger", "status"], { answers: [PASS], now: () => NOW, store: { bytes: first.store.bytes } });
    expect(status.code).toBe(0);
    expect(status.out).toContain("1 export in your history.");
    const wrong = await runInHelper(["ledger", "status"], { answers: ["not the passphrase"], now: () => NOW, store: { bytes: first.store.bytes } });
    expect(wrong.code).toBe(1);
    expect(wrong.out).toContain("could not unlock");
  });

  it("saves files only in the virtual output folder, and sends them once, before the exit", async () => {
    const parts = syntheticExportParts({ now: LATER, friendCount: 30, memoryCount: 60 });
    const r = await runInHelper(["memories", ...parts.map((p) => `/in/${p.name}`), "--out", "/out/memories"], { files: parts.map((p) => blobOf(p.name, p.bytes)), now: () => NOW });
    expect(r.code).toBe(0);
    const types = r.messages.map((m) => m.type);
    expect(types.filter((t) => t === "files")).toHaveLength(1);
    expect(types.indexOf("files")).toBeLessThan(types.indexOf("exit"));
    expect(r.files.every((f) => !f.path.startsWith("/") && !f.path.includes(".."))).toBe(true);
    expect(r.files.some((f) => f.path === "memories/memories-report.json")).toBe(true);
  });

  it("stops a rescue with a calm message when the virtual folder is full", async () => {
    const parts = syntheticExportParts({ now: LATER, friendCount: 30, memoryCount: 60 });
    const r = await runInHelper(["memories", ...parts.map((p) => `/in/${p.name}`), "--out", "/out/memories"], { files: parts.map((p) => blobOf(p.name, p.bytes)), now: () => NOW, outCap: 2000 });
    // Files that do not fit fail one by one; the report that would list them does not fit either, so the command stops.
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/No space left/);
    expect(r.exits).toBe(1);
  });
});
