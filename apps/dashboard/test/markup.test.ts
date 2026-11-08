/** The HTML helpers the tests use must handle the inputs a one-pass regular expression gets wrong. */
import { describe, expect, it } from "vitest";
import { elements, innerTexts, removeElements, stripTags } from "./markup.ts";

describe("stripTags", () => {
  it("removes tags and keeps the text", () => {
    expect(stripTags("<p>Open <b>Snappy</b> now.</p>")).toBe("Open Snappy now.");
    expect(stripTags("no tags")).toBe("no tags");
    expect(stripTags("")).toBe("");
  });

  it("leaves no tag when the pieces of one are nested or overlap", () => {
    for (const input of ["<scr<script>ipt>alert(1)", "<<b>script>alert(1)", "<scr<b>ipt>x</scr</b>ipt>", "<<<a>b>c>d", "<img src=x onerror<b>=alert(1)>"]) {
      const out = stripTags(input);
      expect(out, input).not.toMatch(/<\s*\/?\s*script/i);
      expect(out, input).not.toContain("<");
    }
    expect(stripTags("<scr<script>ipt>alert(1)")).toBe("ipt>alert(1)");
  });

  it("keeps a lone less-than sign and anything after it when no tag can close", () => {
    expect(stripTags("5 < 6")).toBe("5 < 6");
    expect(stripTags("a <b>b</b> < c")).toBe("a b < c");
  });

  it("removes a tag whose attribute holds a quote or an upper-case name", () => {
    expect(stripTags("<A HREF='x'>link</A><BR/>")).toBe("link");
    expect(stripTags('<p title="a">x</p>')).toBe("x");
  });
});

describe("elements and innerTexts", () => {
  it("finds scripts in page order, in any case, with attributes on either tag", () => {
    const html = "<SCRIPT>one</SCRIPT> mid <script type=module>two</script foo> end <Script\n>three</SCRIPT\n>";
    expect(innerTexts(html, "script")).toEqual(["one", "two", "three"]);
  });

  it("does not take another tag for the one asked for", () => {
    expect(elements("<scripts>x</scripts><scriptx>y</scriptx>", "script")).toEqual([]);
    expect(innerTexts("<style>a{}</style><styled>b</styled>", "style")).toEqual(["a{}"]);
  });

  it("reads a quoted greater-than sign inside the opening tag as part of the attribute", () => {
    expect(innerTexts('<script data-x="a>b">code</script>', "script")).toEqual(["code"]);
  });

  it("runs an element that never closes to the end of the text", () => {
    const [el] = elements("a<script>unfinished", "script");
    expect(el).toEqual({ start: 1, end: 19, inner: "unfinished" });
    expect(elements("a<script", "script")).toEqual([]);
    expect(elements("a<script x", "script")).toEqual([{ start: 1, end: 10, inner: "" }]);
  });
});

describe("removeElements", () => {
  it("removes scripts and styles in any case, closing tags with attributes included", () => {
    expect(removeElements("a<SCRIPT>x</SCRIPT>b<script>y</script foo>c<style>z{}</STYLE\t>d", "script", "style")).toBe("abcd");
  });

  it("removes an element that the first pass rebuilds from its neighbors", () => {
    expect(removeElements("<scr<script>x</script>ipt>alert(1)</script>", "script")).toBe("");
    expect(removeElements("a<scr<script>x</script>ipt>alert(1)</script>b", "script")).toBe("ab");
    expect(removeElements("<sty<script>x</script>le>a{}</style>", "script", "style")).toBe("");
  });

  it("leaves no element behind for any of these inputs", () => {
    for (const input of ["<scr<script>x</script>ipt>y</script>", "<<script>x</script>script>y</script>", "<SCR<SCRIPT >x</SCRIPT>IPT>y</SCRIPT >"]) {
      expect(elements(removeElements(input, "script"), "script"), input).toEqual([]);
    }
  });

  it("drops an unclosed element to the end", () => {
    expect(removeElements("keep<script>never closed", "script")).toBe("keep");
  });
});
