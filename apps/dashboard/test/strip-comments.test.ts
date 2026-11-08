/** The build removes comments from the icon sprite; a comment rebuilt from the leftovers must not survive. */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { stripComments } = (await import(pathToFileURL(path.join(root, "..", "..", "brand", "tools", "strip-comments.mjs")).href)) as { stripComments: (text: string) => string };

describe("stripComments", () => {
  it("removes ordinary comments, across lines, and keeps the rest", () => {
    expect(stripComments("<svg><!-- one --><path/><!--\ntwo\n--></svg>")).toBe("<svg><path/></svg>");
    expect(stripComments("no comments here")).toBe("no comments here");
    expect(stripComments("")).toBe("");
  });

  it("removes a comment that the first pass leaves behind", () => {
    // Taking out the inner comment joins "<!" and "--" into a new opener.
    expect(stripComments("<!<!-- a -->-- b -->")).toBe("");
    expect(stripComments("x<!<!-- a -->-- b -->y")).toBe("xy");
    expect(stripComments("<!<!<!-- a -->-- b -->-- c -->")).toBe("");
  });

  it("never leaves an opener that has a closer after it", () => {
    for (const text of ["<!<!-- a -->-- b -->", "<<!-- a -->!-- b -->", "<!-<!-- a -->- b -->", "<!--<!-- a --> b -->"]) {
      const out = stripComments(text);
      expect(out.includes("<!--") && out.indexOf("-->", out.indexOf("<!--")) >= 0, text).toBe(false);
    }
  });

  it("leaves an opener that never closes, and does not read <!--> as a comment", () => {
    expect(stripComments("a<!-- never closed")).toBe("a<!-- never closed");
    expect(stripComments("a<!-->b")).toBe("a<!-->b");
  });
});
