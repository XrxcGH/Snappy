/** The wording checks take synthetic usernames out of the output first; nothing may be left that a second pass would remove. */
import { describe, expect, it } from "vitest";
import { removeAll } from "./helpers.ts";

const USERNAMES = /\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b/g;

describe("removeAll", () => {
  it("removes every match and keeps the text between", () => {
    expect(removeAll("ghost_12 and oneway_3, then active_4.", USERNAMES)).toBe(" and , then .");
    expect(removeAll("nothing to remove", USERNAMES)).toBe("nothing to remove");
    expect(removeAll("", USERNAMES)).toBe("");
  });

  it("removes a match that the first pass joins together from the pieces around another", () => {
    expect(removeAll("aabb", /ab/g)).toBe("");
    expect(removeAll("o<!-- x -->n", /<!--[\s\S]*?-->/g)).toBe("on");
    expect(removeAll("{ta{tag}g}", /{tag}/g)).toBe("");
    expect(removeAll("<!<!-- a -->-- b -->", /<!--[\s\S]*?-->/g)).toBe("");
    expect(removeAll("xxxyyy", /xy/g)).toBe("");
  });

  it("leaves nothing a second pass would remove, for any of these inputs", () => {
    const patterns = [/ab/g, /{tag}/gi, /\bon\w+=/gi, USERNAMES];
    for (const input of ["aabbab", "{ta{TAG}g}", "o{tag}n{tag}click=", "onon{tag}click=click=", "ghost_ghost_12_3 oneway_7"]) {
      for (const pattern of patterns) {
        const once = removeAll(input, pattern);
        expect(removeAll(once, pattern), `${input} / ${pattern}`).toBe(once);
        expect(once.match(pattern), `${input} / ${pattern}`).toBeNull();
      }
    }
  });

  it("refuses a pattern that is not global, as matchAll does, instead of removing only the first match", () => {
    expect(() => removeAll("ab ab", /ab/)).toThrow(TypeError);
  });
});
