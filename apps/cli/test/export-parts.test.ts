import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandWildcards, orderExportParts } from "../src/export-parts.ts";
import { makeIo, tempDir } from "./helpers.ts";

describe("orderExportParts", () => {
  it("puts the base name first, then -2, -3 and so on numerically", () => {
    const names = ["mydata~1-10.zip", "mydata~1-3.zip", "mydata~1.zip", "mydata~1-2.zip"];
    expect(orderExportParts(names)).toEqual(["mydata~1.zip", "mydata~1-2.zip", "mydata~1-3.zip", "mydata~1-10.zip"]);
  });

  it("keeps the parts of one export together and ignores letter case", () => {
    const names = ["B~2-2.zip", "a~1.zip", "B~2.zip", "A~1-2.zip"];
    expect(orderExportParts(names)).toEqual(["a~1.zip", "A~1-2.zip", "B~2.zip", "B~2-2.zip"]);
  });

  it("does not change what it is given", () => {
    const names = ["x-2.zip", "x.zip"];
    orderExportParts(names);
    expect(names).toEqual(["x-2.zip", "x.zip"]);
  });
});

describe("expandWildcards", () => {
  it("expands * and ? in the file name to the zips that match, and passes other arguments through", async () => {
    const dir = tempDir("parts");
    for (const n of ["mydata~1.zip", "mydata~1-2.zip", "MYDATA~1-3.ZIP", "mydata~1.txt", "other.zip", "._mydata~1.zip"]) writeFileSync(join(dir, n), "x");
    mkdirSync(join(dir, "mydata~sub.zip"));
    const star = (await expandWildcards(makeIo(), [join(dir, "mydata*.zip")])).map((p) => p.slice(dir.length + 1)).sort();
    // A folder that happens to end in .zip is not a part.
    expect(star).toEqual(["MYDATA~1-3.ZIP", "mydata~1-2.zip", "mydata~1.zip"].sort());
    const question = (await expandWildcards(makeIo(), [join(dir, "mydata~?.zip")])).map((p) => p.slice(dir.length + 1));
    expect(question).toEqual(["mydata~1.zip"]);
    expect(await expandWildcards(makeIo(), ["plain.zip", dir])).toEqual(["plain.zip", dir]);
  });

  it("treats other characters in a pattern literally", async () => {
    const dir = tempDir("parts");
    writeFileSync(join(dir, "a+b(1).zip"), "x");
    writeFileSync(join(dir, "aab(1).zip"), "x");
    expect((await expandWildcards(makeIo(), [join(dir, "a+b(*).zip")])).map((p) => p.slice(dir.length + 1))).toEqual(["a+b(1).zip"]);
  });

  it("explains a pattern that matches nothing and a folder that is missing", async () => {
    const dir = tempDir("parts");
    await expect(expandWildcards(makeIo(), [join(dir, "none*.zip")])).rejects.toMatchObject({ code: "no-zips" });
    await expect(expandWildcards(makeIo(), [join(dir, "missing", "x*.zip")])).rejects.toMatchObject({ code: "not-found" });
  });
});
