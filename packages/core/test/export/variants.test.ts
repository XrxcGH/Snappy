import { describe, expect, it } from "vitest";
import { buildVariants, runVariant } from "../../../../tools/import-check/variants.ts";

describe("export variants report the expected issue codes", () => {
  const variants = buildVariants();

  it("has every layout variant it should", () => {
    expect(variants.map((v) => v.id)).toEqual(expect.arrayContaining(["v00", "v01", "v02", "v06", "v15", "v20", "v21a", "v21c", "v21d", "v21e", "v33"]));
  });

  for (const variant of variants) {
    it(`${variant.id} ${variant.title}`, async () => {
      const result = await runVariant(variant);
      expect({
        codes: result.codes,
        ...(variant.friends !== undefined && { friends: result.friends }),
        ...(variant.events !== undefined && { events: result.events }),
      }).toEqual({
        codes: variant.expect,
        ...(variant.friends !== undefined && { friends: variant.friends }),
        ...(variant.events !== undefined && { events: variant.events }),
      });
    });
  }
});
