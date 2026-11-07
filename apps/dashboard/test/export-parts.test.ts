import { describe, expect, it } from "vitest";
import { isLaterPartsOnly, orderParts } from "../src/export-parts.ts";

const named = (...names: string[]): { name: string }[] => names.map((name) => ({ name }));
const namesOf = (files: { name?: string }[]): (string | undefined)[] => files.map((f) => f.name);

describe("orderParts", () => {
  it("puts the base name first, then -2, -3, whatever order they were chosen in", () => {
    const shuffled = named("mydata~1234567890123-3.zip", "mydata~1234567890123.zip", "mydata~1234567890123-2.zip");
    expect(namesOf(orderParts(shuffled))).toEqual(["mydata~1234567890123.zip", "mydata~1234567890123-2.zip", "mydata~1234567890123-3.zip"]);
  });

  it("orders numerically, not as text", () => {
    const shuffled = named("mydata~1-10.zip", "mydata~1-2.zip", "mydata~1.zip", "mydata~1-9.zip");
    expect(namesOf(orderParts(shuffled))).toEqual(["mydata~1.zip", "mydata~1-2.zip", "mydata~1-9.zip", "mydata~1-10.zip"]);
  });

  it("ignores case and the .zip ending's case", () => {
    expect(namesOf(orderParts(named("MyData~1-2.ZIP", "MYDATA~1.zip")))).toEqual(["MYDATA~1.zip", "MyData~1-2.ZIP"]);
  });

  it("keeps exports with different names apart and in a stable order", () => {
    const files = named("b-2.zip", "a.zip", "b.zip", "a-2.zip");
    expect(namesOf(orderParts(files))).toEqual(["a.zip", "a-2.zip", "b.zip", "b-2.zip"]);
    const ordered = orderParts([
      { name: "x.zip", tag: 1 },
      { name: "x.zip", tag: 2 },
    ]);
    expect(ordered.map((f) => f.tag)).toEqual([1, 2]);
  });

  it("returns a new list and leaves the input alone", () => {
    const input = named("mydata~1-2.zip", "mydata~1.zip");
    const before = [...input];
    const out = orderParts(input);
    expect(out).not.toBe(input);
    expect(input).toEqual(before);
  });

  it("copes with files that have no name", () => {
    expect(orderParts([{}, { name: "a.zip" }])).toHaveLength(2);
    expect(orderParts([])).toEqual([]);
  });
});

describe("isLaterPartsOnly", () => {
  it("is true when only the numbered media parts were chosen", () => {
    expect(isLaterPartsOnly(named("mydata~1234567890123-2.zip"))).toBe(true);
    expect(isLaterPartsOnly(named("mydata~1234567890123-2.zip", "mydata~1234567890123-3.zip"))).toBe(true);
  });

  it("is false as soon as the first part is among them", () => {
    expect(isLaterPartsOnly(named("mydata~1234567890123.zip", "mydata~1234567890123-2.zip"))).toBe(false);
    expect(isLaterPartsOnly(named("mydata~1234567890123.zip"))).toBe(false);
  });

  it("never refuses a zip on a guess: other names, no names, no files", () => {
    expect(isLaterPartsOnly(named("my-export-2.zip"))).toBe(false);
    expect(isLaterPartsOnly(named("holiday-2023.zip"))).toBe(false);
    expect(isLaterPartsOnly([{}])).toBe(false);
    expect(isLaterPartsOnly([])).toBe(false);
  });
});
