import { describe, expect, it } from "vitest";
import { MAX_OUT_TEXT, parseFromWorker, parseToWorker } from "../src/terminal/protocol.ts";

/** Every message goes through the structured clone the browser applies, so what is checked is what arrives. */
const clone = <T>(v: T): T => structuredClone(v);

describe("parseFromWorker", () => {
  it("accepts each well-formed message from the helper", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    for (const message of [
      { type: "out", text: "hello\x1b[0m" },
      { type: "out", text: "" },
      { type: "ask-secret", id: 1, question: "Passphrase for your saved history: " },
      { type: "store-read", id: 2 },
      { type: "store-write", id: 3, bytes },
      { type: "files", files: [{ path: "memories/2021/a.jpg", bytes, mtimeMs: 1_600_000_000_000 }] },
      { type: "files", files: [] },
      { type: "exit", code: 0 },
      { type: "exit", code: 130 },
    ]) {
      expect(parseFromWorker(clone(message)), JSON.stringify(message)).toEqual(message);
    }
  });

  it("drops what is not a message at all", () => {
    for (const bad of [null, undefined, 5, "out", [], [{ type: "out", text: "x" }], () => 1, true]) expect(parseFromWorker(bad)).toBeNull();
    expect(parseFromWorker({})).toBeNull();
    expect(parseFromWorker({ type: "nope" })).toBeNull();
    expect(parseFromWorker({ type: "run" })).toBeNull();
  });

  it("drops a message whose fields have the wrong type or size", () => {
    expect(parseFromWorker({ type: "out", text: 5 })).toBeNull();
    expect(parseFromWorker({ type: "out" })).toBeNull();
    expect(parseFromWorker({ type: "out", text: "x".repeat(MAX_OUT_TEXT + 1) })).toBeNull();
    expect(parseFromWorker({ type: "ask-secret", id: "1", question: "q" })).toBeNull();
    expect(parseFromWorker({ type: "ask-secret", id: -1, question: "q" })).toBeNull();
    expect(parseFromWorker({ type: "ask-secret", id: 1.5, question: "q" })).toBeNull();
    expect(parseFromWorker({ type: "ask-secret", id: 1, question: 7 })).toBeNull();
    expect(parseFromWorker({ type: "ask-secret", id: 1, question: "q".repeat(500) })).toBeNull();
    expect(parseFromWorker({ type: "store-read" })).toBeNull();
    expect(parseFromWorker({ type: "store-write", id: 1, bytes: [1, 2] })).toBeNull();
    expect(parseFromWorker({ type: "store-write", id: 1, bytes: "abc" })).toBeNull();
    expect(parseFromWorker({ type: "exit", code: "0" })).toBeNull();
    expect(parseFromWorker({ type: "exit", code: -1 })).toBeNull();
    expect(parseFromWorker({ type: "exit", code: 256 })).toBeNull();
    expect(parseFromWorker({ type: "exit", code: 1.5 })).toBeNull();
    expect(parseFromWorker({ type: "exit", code: Number.NaN })).toBeNull();
  });

  it("drops a files message with any bad entry, and any path that is not inside /out", () => {
    const ok = { path: "a.bin", bytes: new Uint8Array(1), mtimeMs: 1 };
    expect(parseFromWorker({ type: "files", files: [ok, { ...ok, path: "" }] })).toBeNull();
    expect(parseFromWorker({ type: "files", files: [{ ...ok, path: "/etc/passwd" }] })).toBeNull();
    expect(parseFromWorker({ type: "files", files: [{ ...ok, path: "../escape" }] })).toBeNull();
    expect(parseFromWorker({ type: "files", files: [{ ...ok, path: "a/../../escape" }] })).toBeNull();
    expect(parseFromWorker({ type: "files", files: [{ ...ok, path: "a\0b" }] })).toBeNull();
    expect(parseFromWorker({ type: "files", files: [{ ...ok, bytes: [1] }] })).toBeNull();
    expect(parseFromWorker({ type: "files", files: [{ ...ok, mtimeMs: Number.NaN }] })).toBeNull();
    expect(parseFromWorker({ type: "files", files: [{ ...ok, mtimeMs: "1" }] })).toBeNull();
    expect(parseFromWorker({ type: "files", files: "none" })).toBeNull();
    expect(parseFromWorker({ type: "files", files: [null] })).toBeNull();
  });

  it("keeps only the known fields", () => {
    const parsed = parseFromWorker({ type: "out", text: "x", extra: "y", __proto__: { polluted: true } });
    expect(parsed).toEqual({ type: "out", text: "x" });
    expect(Object.keys(parsed as object)).toEqual(["type", "text"]);
  });
});

describe("parseToWorker", () => {
  const run = { type: "run", runId: "r1", argv: ["help"], files: [{ name: "a.zip", blob: new Blob(["x"]) }], columns: 80, coarse: false, outCap: 1024 };

  it("accepts each well-formed message from the page", () => {
    expect(parseToWorker(clone(run))).toMatchObject({ type: "run", runId: "r1", argv: ["help"], columns: 80 });
    expect(parseToWorker({ type: "secret", id: 1, value: "a passphrase" })).toEqual({ type: "secret", id: 1, value: "a passphrase" });
    expect(parseToWorker({ type: "secret", id: 1, value: null })).toEqual({ type: "secret", id: 1, value: null });
    expect(parseToWorker({ type: "cancel" })).toEqual({ type: "cancel" });
    expect(parseToWorker({ type: "store-reply", id: 1, ok: true, bytes: null })).toMatchObject({ ok: true, bytes: null });
    expect(parseToWorker({ type: "store-reply", id: 1, ok: true, bytes: new Uint8Array(2) })).toMatchObject({ ok: true });
    expect(parseToWorker({ type: "store-reply", id: 1, ok: false, code: "EACCES" })).toMatchObject({ ok: false, code: "EACCES" });
  });

  it("drops a run with the wrong shape", () => {
    for (const patch of [
      { runId: 5 },
      { argv: "help" },
      { argv: ["help", 5] },
      { files: [{ name: "a.zip", blob: "not a blob" }] },
      { files: [{ blob: new Blob([]) }] },
      { files: "x" },
      { columns: 5 },
      { columns: 1000 },
      { columns: 80.5 },
      { coarse: "no" },
      { outCap: -1 },
      { outCap: Number.POSITIVE_INFINITY },
    ]) {
      expect(parseToWorker({ ...run, ...patch }), JSON.stringify(Object.keys(patch))).toBeNull();
    }
  });

  it("carries the app's version label, and drops one that is not a version", () => {
    expect(parseToWorker({ ...clone(run), version: "0.1.0-beta.3" })).toMatchObject({ version: "0.1.0-beta.3" });
    expect(parseToWorker({ ...clone(run), version: "1.2.3" })).toMatchObject({ version: "1.2.3" });
    expect(Object.keys(parseToWorker(clone(run)) as object)).not.toContain("version");
    for (const bad of ["", "v1.2.3", "1.2", "0.1.0-beta.3 ", "0.1.0-beta 2", "0.1.0-<b>", 5, null, "1.2.3-" + "x".repeat(40)]) {
      expect(parseToWorker({ ...clone(run), version: bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it("drops bad answers and unknown messages", () => {
    for (const bad of [null, 1, "x", [], {}, { type: "other" }, { type: "secret", value: "x" }, { type: "secret", id: 1, value: 5 }, { type: "secret", id: 1, value: "x".repeat(5000) }, { type: "store-reply", id: 1 }, { type: "store-reply", id: 1, ok: true, bytes: "x" }]) {
      expect(parseToWorker(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
