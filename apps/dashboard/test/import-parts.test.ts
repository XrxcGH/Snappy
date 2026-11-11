/**
 * Telling the parts of an export apart by what they hold (the directory of each zip), not by what they are called:
 * two different exports are refused, the part with the lists is the first part whatever its name, and parts of
 * photos and videos only are refused whatever their names. Synthetic data only.
 */
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { start } from "../src/copy.ts";
import { startFlow } from "../src/copy-start.ts";
import { checkParts, exportId, scanPart } from "../src/export-parts.ts";
import type { PartScan } from "../src/export-parts.ts";
import type { ImportRunner } from "../src/import-pipeline.ts";
import { partFiles, setup } from "./export-fixtures.ts";

const rename = (file: File, name: string): File => new File([file], name, { type: "application/zip" });
const never: ImportRunner = async () => {
  throw new Error("must not be called");
};
const partIndexes = (memories: { partIndex?: number }[] | undefined): Set<number> => new Set((memories ?? []).map((m) => m.partIndex).filter((p): p is number => p !== undefined));

describe("exportId", () => {
  it("is the digits after the prefix, from any part of that export", () => {
    expect(exportId("mydata~1700000000000.zip")).toBe("1700000000000");
    expect(exportId("MYDATA~1700000000000-3.ZIP")).toBe("1700000000000");
    expect(exportId("mydata~1700000000000 (1).zip")).toBe("1700000000000");
    expect(exportId("holiday.zip")).toBeNull();
    expect(exportId(undefined)).toBeNull();
  });
});

describe("checkParts", () => {
  const lists: PartScan = { listed: true, friends: true, pages: true, media: false };
  const media: PartScan = { listed: true, friends: false, pages: false, media: true };
  const other: PartScan = { listed: true, friends: false, pages: false, media: false };
  const unlisted: PartScan = { listed: false, friends: false, pages: false, media: false };
  const named = (...names: string[]): { name: string }[] => names.map((name) => ({ name }));

  it("puts the part that holds the lists first, then the others in number order", () => {
    const files = named("mydata~1-3.zip", "mydata~1-2.zip", "mydata~1-1.zip");
    const check = checkParts(files, [media, media, lists]);
    expect(check).toMatchObject({ kind: "ok" });
    expect(check.kind === "ok" ? check.ordered.map((f) => f.name) : []).toEqual(["mydata~1-1.zip", "mydata~1-2.zip", "mydata~1-3.zip"]);
  });

  it("reads -part-N names as part numbers", () => {
    const files = named("mydata~1-part-3.zip", "mydata~1.zip", "mydata~1-part-2.zip");
    const check = checkParts(files, [media, lists, media]);
    expect(check.kind === "ok" ? check.ordered.map((f) => f.name) : []).toEqual(["mydata~1.zip", "mydata~1-part-2.zip", "mydata~1-part-3.zip"]);
  });

  it("names the two numbers, smaller first, when the names carry two export numbers", () => {
    expect(checkParts(named("mydata~1710000000000.zip", "mydata~1700000000000-2.zip"), [lists, media])).toEqual({ kind: "mixed", ids: ["1700000000000", "1710000000000"] });
  });

  it("does not count a copy of the same export as another export", () => {
    expect(checkParts(named("mydata~1.zip", "mydata~1 (1).zip"), [lists, lists]).kind).toBe("ok");
  });

  it("leaves names without an export number alone: they are not refused on a guess", () => {
    expect(checkParts(named("a.zip", "b.zip"), [lists, lists]).kind).toBe("ok");
    expect(checkParts(named("mydata~1.zip", "b.zip"), [lists, lists]).kind).toBe("ok");
  });

  it("calls parts later parts when none of them holds a JSON or HTML page, whatever the names", () => {
    expect(checkParts(named("holiday.zip", "mydata~1.zip"), [media, media])).toEqual({ kind: "later-only" });
    // A part with HTML pages only is an export in the wrong format, which the reader explains.
    expect(checkParts(named("mydata~1.zip"), [{ listed: true, friends: false, pages: true, media: false }]).kind).toBe("ok");
  });

  it("does not call a ZIP with no lists and no photos or videos a later part: the reader says what it is", () => {
    expect(checkParts(named("mydata~1.zip"), [other]).kind).toBe("ok");
    expect(checkParts(named("notes.zip", "mydata~1-2.zip"), [other, media]).kind).toBe("ok");
  });

  it("judges a part it could not list by its name alone, so reading it can say why it failed", () => {
    expect(checkParts(named("mydata~1-2.zip"), [unlisted])).toEqual({ kind: "later-only" });
    expect(checkParts(named("broken.zip"), [unlisted]).kind).toBe("ok");
    expect(checkParts(named("mydata~1.zip", "mydata~1-2.zip"), [unlisted, unlisted]).kind).toBe("ok");
  });
});

describe("scanPart", () => {
  it("sees the lists in the first part and none in a part of photos and videos", async () => {
    const [base, second] = partFiles(2) as [File, File];
    expect(await scanPart(base)).toEqual({ listed: true, friends: true, pages: true, media: true });
    expect(await scanPart(second)).toMatchObject({ listed: true, friends: false, pages: false, media: true });
  });

  it("sees no photos or videos in a ZIP that holds only a ZIP or text files", async () => {
    const text = new TextEncoder().encode("hello");
    expect(await scanPart(new File([zipSync({ "inner.zip": [new Uint8Array(30), { level: 0 }] }) as BlobPart], "a.zip"))).toEqual({ listed: true, friends: false, pages: false, media: false });
    expect(await scanPart(new File([zipSync({ "notes.txt": text }) as BlobPart], "b.zip"))).toMatchObject({ pages: false, media: false });
    expect(await scanPart(new File([zipSync({ "photos/a.jpg": text }) as BlobPart], "c.zip"))).toMatchObject({ pages: false, media: true });
  });

  it("reports a file that is not a zip as not listed", async () => {
    expect(await scanPart(new File([new Uint8Array(500)], "x.zip"))).toEqual({ listed: false, friends: false, pages: false, media: false });
  });
});

describe("importing parts by what they hold", () => {
  it("refuses parts of two different exports, names both numbers and reads nothing", async () => {
    const [base, second, third] = partFiles(2) as [File, File, File];
    const { store, actions } = setup({ runImport: never });
    const files = [rename(base, "mydata~1700000000000.zip"), rename(second, "mydata~1700000000000-2.zip"), rename(third, "mydata~1700000000000-3.zip"), rename(base, "mydata~1710000000000.zip")];
    expect(await actions.importZips(files)).toBe("failed");
    const message = store.get().import.message ?? "";
    expect(message).toBe(startFlow.mixedExports("1700000000000", "1710000000000"));
    expect(store.get().real.latest).toBeNull();
    expect(store.get().real.ledger.snapshots).toHaveLength(0);
  });

  it("puts nothing but digits of a file name into that message", async () => {
    const [base] = partFiles(2) as [File];
    const { store, actions } = setup({ runImport: never });
    await actions.importZips([rename(base, "mydata~1700000000000.zip"), rename(base, "mydata~1710000000000 Canary Person.zip")]);
    expect(store.get().import.message).not.toMatch(/canary|person/i);
  });

  it("reads the parts of one export although a browser added a copy marker to one of them", async () => {
    const [base, second, third] = partFiles(2) as [File, File, File];
    const { store, actions } = setup();
    expect(await actions.importZips([rename(third, "mydata~1700000000000-3.zip"), rename(base, "mydata~1700000000000 (1).zip"), rename(second, "mydata~1700000000000-2.zip")])).toBe("done");
    expect(store.get().real.latest?.friends.friends.length).toBeGreaterThan(0);
  });

  it("treats the part that holds the lists as part 1 although its name carries a number", async () => {
    const [base, second, third] = partFiles(2) as [File, File, File];
    const { store, actions } = setup();
    // Named -1, -2, -3: by name alone the first would be taken for a later part and refused.
    expect(await actions.importZips([rename(third, "mydata~1700000000000-3.zip"), rename(second, "mydata~1700000000000-2.zip"), rename(base, "mydata~1700000000000-1.zip")])).toBe("done");
    expect(store.get().real.latest?.memoriesPairing?.paired).toBeGreaterThan(0);
    expect(partIndexes(store.get().real.latest?.memories)).toEqual(new Set([2, 3]));
  });

  it("orders parts named -part-2 and -part-3 after the first, whatever order they were chosen in", async () => {
    const [base, second, third] = partFiles(2) as [File, File, File];
    const { store, actions } = setup();
    expect(await actions.importZips([rename(third, "mydata~1700000000000-part-3.zip"), rename(second, "mydata~1700000000000-part-2.zip"), rename(base, "mydata~1700000000000.zip")])).toBe("done");
    expect(partIndexes(store.get().real.latest?.memories)).toEqual(new Set([2, 3]));
  });

  it("asks for the part with the lists when the chosen parts hold only photos and videos, whatever they are called", async () => {
    const [, second, third] = partFiles(2) as [File, File, File];
    const { store, actions } = setup({ runImport: never });
    expect(await actions.importZips([rename(second, "holiday-photos.zip"), rename(third, "more photos.zip")])).toBe("failed");
    expect(store.get().import.message).toBe(start.laterPartsOnly);
    expect(await actions.importZips([rename(second, "mydata~1700000000000.zip")])).toBe("failed");
    expect(store.get().import.message).toBe(start.laterPartsOnly);
  });

  it("does not call a ZIP of other ZIP files or of text files the numbered parts", async () => {
    const inner = zipSync({ "json/friends.json": new TextEncoder().encode("{}") });
    const { store, actions } = setup();
    for (const entries of [{ "mydata~1700000000000.zip": [inner, { level: 0 }] }, { "notes.txt": new TextEncoder().encode("hello") }] as const) {
      const file = new File([zipSync(entries as never) as BlobPart], "holder.zip", { type: "application/zip" });
      await actions.importZips([file]);
      expect(store.get().import.message).not.toBe(start.laterPartsOnly);
      if ("mydata~1700000000000.zip" in entries) expect(store.get().import.issues?.map((i) => i.code)).toContain("nested-zip");
    }
  });

  it("says to choose all the parts together when later parts are chosen after the first part was loaded", async () => {
    const [base, second] = partFiles(2) as [File, File, File];
    const { store, actions } = setup();
    expect(await actions.importZips([rename(base, "mydata~1700000000000.zip")])).toBe("done");
    const loaded = store.get().real.latest;
    expect(await actions.importZips([rename(second, "mydata~1700000000000-2.zip")])).toBe("failed");
    expect(store.get().import.message).toBe(start.laterPartsLoaded);
    expect(start.laterPartsLoaded).not.toBe(start.laterPartsOnly);
    expect(start.laterPartsLoaded).toMatch(/together/);
    expect(store.get().real.latest).toBe(loaded);
  });
});
