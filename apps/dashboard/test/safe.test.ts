import { describe, expect, it } from "vitest";
import { displayUsername, isAllowedHref, isSafeAttribute, isSafeUsername, safeProfileUrl } from "../src/safe.ts";

describe("safeProfileUrl", () => {
  it("builds the one allowed link for plain usernames, normalised", () => {
    expect(safeProfileUrl("alice")).toBe("https://www.snapchat.com/add/alice");
    expect(safeProfileUrl("  Alice_01  ")).toBe("https://www.snapchat.com/add/alice_01");
    expect(safeProfileUrl("a.b-c_d")).toBe("https://www.snapchat.com/add/a.b-c_d");
    expect(safeProfileUrl("x")).toBe("https://www.snapchat.com/add/x");
  });

  it.each([
    "",
    " ",
    "../etc/passwd",
    "a/b",
    "a b",
    "a?b=1",
    "a#frag",
    "a&b",
    "a%2fb",
    "javascript:alert(1)",
    "https://evil.example/x",
    "<script>alert(1)</script>",
    '"onmouseover="x',
    "al\u0000ice",
    "\u202ealice",
    "\u0430lice", // Cyrillic a: a look-alike of "a"
    "alice\u200b",
    "-alice",
    "alice.",
    "..",
    ".",
    "a".repeat(65),
  ])("rejects %j", (name) => {
    expect(safeProfileUrl(name)).toBeNull();
  });

  it("trims surrounding whitespace, including a trailing newline", () => {
    expect(safeProfileUrl("alice\n")).toBe("https://www.snapchat.com/add/alice");
  });

  it("never lets a name change the path, query or scheme", () => {
    for (const name of ["alice", "a.b", "a-b_c", "0day"]) {
      const url = new URL(safeProfileUrl(name) as string);
      expect(url.origin).toBe("https://www.snapchat.com");
      expect(url.pathname).toBe(`/add/${name}`);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    }
  });

  it("handles names that collide with object properties", () => {
    expect(safeProfileUrl("constructor")).toBe("https://www.snapchat.com/add/constructor");
    expect(safeProfileUrl("__proto__")).toBeNull();
  });
});

describe("isSafeUsername", () => {
  it("accepts only lower-case ascii usernames", () => {
    expect(isSafeUsername("alice")).toBe(true);
    expect(isSafeUsername("Alice")).toBe(false);
    expect(isSafeUsername(42)).toBe(false);
    expect(isSafeUsername(undefined)).toBe(false);
  });
});

describe("displayUsername", () => {
  it("replaces invisible and direction-changing characters", () => {
    expect(displayUsername("al\u202eice\u0000")).toBe("al?ice?");
    expect(displayUsername("plain_name")).toBe("plain_name");
  });
});

describe("isAllowedHref", () => {
  it("allows page routes and Snapchat profile links only", () => {
    expect(isAllowedHref("#/overview")).toBe(true);
    expect(isAllowedHref("#main")).toBe(true);
    expect(isAllowedHref("https://www.snapchat.com/add/alice")).toBe(true);
    for (const bad of ["javascript:alert(1)", "https://example.com/", "http://www.snapchat.com/add/a", "data:text/html,x", "//evil.example", "https://www.snapchat.com/add/a/../b", "https://www.snapchat.com.evil.example/add/a", "blob:abc"]) {
      expect(isAllowedHref(bad)).toBe(false);
    }
  });
});

describe("isSafeAttribute", () => {
  it("refuses inline styles, event handlers and frames", () => {
    for (const bad of ["style", "STYLE", "onclick", "onerror", "srcdoc", "formaction", "xlink:href", "bad name", ""]) expect(isSafeAttribute(bad)).toBe(false);
    for (const ok of ["class", "href", "aria-label", "data-key", "type", "for", "role"]) expect(isSafeAttribute(ok)).toBe(true);
  });
});
