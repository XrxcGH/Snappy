/**
 * Importing several zip parts through the actions: order, progress in the store, the hint for
 * media-only parts, and calm errors. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { analyze } from "../src/analysis.ts";
import { start } from "../src/copy.ts";
import type { ImportRunner } from "../src/import-pipeline.ts";
import { initialState, reduce } from "../src/reducer.ts";
import type { ImportStatus } from "../src/reducer.ts";
import { NOW, partFiles, setup } from "./export-fixtures.ts";

function watchImport(store: ReturnType<typeof setup>["store"]): ImportStatus[] {
  const seen: ImportStatus[] = [];
  store.subscribe((s, p) => {
    if (s.import !== p.import) seen.push(s.import);
  });
  return seen;
}

describe("importing the parts of an export", () => {
  it("reads all three parts chosen in any order, as one export", async () => {
    const [base, second, third] = partFiles(2);
    const { store, actions } = setup();
    expect(await actions.importZips([third as File, base as File, second as File])).toBe("done");
    const latest = store.get().real.latest;
    expect(latest?.friends.friends.length).toBeGreaterThan(0);
    expect(latest?.memoriesPairing?.paired).toBeGreaterThan(0);
    // Pairing is counted, but where each file sits and what it is called is not kept: nothing here opens a file.
    expect(latest?.bundledMedia).toBeUndefined();
    expect(new Set(latest?.memories.map((m) => m.partIndex).filter((p) => p !== undefined))).toEqual(new Set([2, 3]));
    expect(latest?.memories.some((m) => m.overlayPaths !== undefined || m.overlayParts !== undefined)).toBe(false);
    expect(JSON.stringify(latest?.memories)).not.toMatch(/memories\/|\.jpg|\.mp4|https?:/);
    expect(store.get().real.ledger.snapshots).toHaveLength(1);
  });

  it("keeps how many parts it read, for the tools that say so", async () => {
    const { store, actions } = setup();
    await actions.importZips(partFiles(2));
    expect(store.get().real.parts).toBe(3);
  });

  it("gives the same result whatever order the parts were chosen in", async () => {
    const files = partFiles(2);
    const a = setup();
    const b = setup();
    await a.actions.importZips(files);
    await b.actions.importZips([...files].reverse());
    expect(b.store.get().real.latest).toEqual(a.store.get().real.latest);
  });

  it("shows Part 1 of 3 first, a real percentage that grows, and the end", async () => {
    const { store, actions } = setup();
    const seen = watchImport(store);
    await actions.importZips(partFiles(2));
    const reading = seen.filter((s) => s.phase === "reading");
    expect(reading[0]).toMatchObject({ step: 0, steps: 3 });
    expect(start.reading(0, 3, 0)).toBe("Part 1 of 3: reading, 0% done");
    const fractions = reading.map((s) => s.fraction).filter((f): f is number => typeof f === "number");
    expect(fractions.length).toBeGreaterThan(3);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i] as number).toBeGreaterThanOrEqual(fractions[i - 1] as number);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(reading.map((s) => s.step).slice(-1)[0]).toBe(3);
    expect(seen[seen.length - 1]).toMatchObject({ phase: "done" });
  });

  it("counts Snaps, so a friend who only sends Snaps is not quiet", async () => {
    const { store, actions } = setup();
    await actions.importZips(partFiles(2));
    const a = analyze(store.get());
    expect(a.hasChats).toBe(true);
    const kinds = new Set(store.get().real.latest?.chats.map((c) => c.kind));
    expect(kinds.has("IMAGE") || kinds.has("VIDEO")).toBe(true);
    // The generator's snapper_N friends only exchange Snaps, recently: they must not look quiet.
    const friends = (store.get().real.latest?.friends.friends ?? []).map((f) => f.username.toLowerCase());
    const snappers = friends.filter((u) => u.startsWith("snapper_"));
    expect(snappers.length).toBeGreaterThan(0);
    const quiet = new Set(a.dormant.map((q) => q.key));
    for (const u of snappers) expect(quiet.has(u)).toBe(false);
  });

  it("asks for part 1 when only the numbered media parts are chosen, and reads nothing", async () => {
    const [, second, third] = partFiles(2);
    let ran = 0;
    const runImport: ImportRunner = async () => {
      ran++;
      throw new Error("must not be called");
    };
    const { store, actions } = setup({ runImport });
    expect(await actions.importZips([second as File, third as File])).toBe("failed");
    expect(ran).toBe(0);
    expect(store.get().import).toMatchObject({ phase: "failed", message: start.laterPartsOnly });
    expect(start.laterPartsOnly).toMatch(/part 1/);
    expect(store.get().real.latest).toBeNull();
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("does not let media parts replace an export that was already added", async () => {
    const [base, second, third] = partFiles(2);
    const { store, actions } = setup();
    await actions.importZips([base as File, second as File, third as File]);
    const before = store.get().real.latest;
    await actions.importZips([second as File, third as File]);
    expect(store.get().real.latest).toBe(before);
    expect(store.get().import.phase).toBe("failed");
  });

  it("passes part 1 on its own through, with the media parts left out", async () => {
    const [base] = partFiles(2);
    const { store, actions } = setup();
    expect(await actions.importZips([base as File])).toBe("done");
    expect(store.get().real.latest?.memoriesPairing).toBeUndefined();
    expect(store.get().real.issues.map((i) => i.code)).toContain("memories-no-media-source");
  });
});

describe("when reading fails", () => {
  it("says so calmly, with fixed text and no file detail, and clears the progress", async () => {
    const runImport: ImportRunner = async (_blobs, hooks) => {
      hooks.onProgress({ step: 0, steps: 3, fraction: 0.4 });
      throw new Error("C:\\Users\\someone\\private-name.zip could not be read");
    };
    const { store, actions } = setup({ runImport });
    expect(await actions.importZips(partFiles(2))).toBe("failed");
    const imp = store.get().import;
    expect(imp.phase).toBe("failed");
    expect(imp.message).toBe(start.readFailed);
    expect(imp.fraction).toBeUndefined();
    expect(JSON.stringify(imp)).not.toContain("private-name");
    expect(store.get().real.latest).toBeNull();
  });

  it("refuses an export with errors and adds nothing to the history", async () => {
    const { store, actions } = setup();
    expect(await actions.importZips([new File([new Uint8Array(500)], "mydata~1234567890123.zip")])).toBe("failed");
    expect(store.get().import.message).toBe(start.rejected);
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("ignores a progress report that arrives after the import ended", async () => {
    let late: (() => void) | undefined;
    const runImport: ImportRunner = async (blobs, hooks) => {
      late = () => hooks.onProgress({ step: 1, steps: 3, fraction: 0.9 });
      return (await import("../src/import-pipeline.ts")).runImport(blobs, hooks);
    };
    const { store, actions } = setup({ runImport });
    await actions.importZips(partFiles(2));
    const done = store.get().import;
    late?.();
    expect(store.get().import).toBe(done);
  });

  it("uses the clock it was given for the export date check", async () => {
    const { store, actions } = setup({ clock: () => NOW + 1000 });
    await actions.importZips(partFiles(2));
    expect(store.get().real.now).toBe(NOW + 1000);
  });
});

describe("import progress in the reducer", () => {
  it("records the step and fraction while reading, and nothing once the import is over", () => {
    const reading = reduce(initialState(), { type: "import-started", steps: 3, sample: false });
    expect(reading.import.fraction).toBeUndefined();
    const half = reduce(reading, { type: "import-progress", step: 1, fraction: 0.5 });
    expect(half.import).toMatchObject({ phase: "reading", step: 1, steps: 3, fraction: 0.5 });
    expect(reduce(half, { type: "import-progress", step: 2, fraction: null }).import.fraction).toBeNull();

    const failed = reduce(half, { type: "import-failed", message: "m" });
    expect(failed.import.fraction).toBeUndefined();
    expect(reduce(failed, { type: "import-progress", step: 2, fraction: 0.7 })).toBe(failed);
    expect(reduce(initialState(), { type: "import-progress", step: 0, fraction: 0.1 }).import.phase).toBe("idle");
  });
});
