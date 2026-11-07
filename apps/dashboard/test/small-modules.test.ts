import { describe, expect, it } from "vitest";
import { blocksNetwork } from "../src/csp.ts";
import { formatBytes, formatCount, formatDate, formatMonth, gibToBytes } from "../src/format.ts";
import { parseCapGiB, parseFriendCount } from "../src/parse-input.ts";
import { parseRoute } from "../src/route-parse.ts";

describe("parseRoute", () => {
  it("maps hashes to routes and keeps the current view for non-route hashes", () => {
    expect(parseRoute("")).toBe("start");
    expect(parseRoute("#")).toBe("start");
    expect(parseRoute("#/")).toBe("start");
    expect(parseRoute("#/cleanup")).toBe("cleanup");
    expect(parseRoute("#/memories")).toBe("memories");
    expect(parseRoute("#/nope")).toBe("start");
    expect(parseRoute("#/constructor")).toBe("start");
    expect(parseRoute("#/a/b")).toBe("start");
    expect(parseRoute("#main")).toBeNull();
    expect(parseRoute("#something")).toBeNull();
  });
});

describe("number input", () => {
  it("parses friend counts", () => {
    expect(parseFriendCount("")).toBeNull();
    expect(parseFriendCount(" 120 ")).toBe(120);
    expect(parseFriendCount("0")).toBe(0);
    for (const bad of ["-1", "1.5", "abc", "1e3", "100001", "1,200", "٣"]) expect(parseFriendCount(bad)).toBeUndefined();
  });

  it("parses the storage cap", () => {
    expect(parseCapGiB("5")).toBe(5);
    expect(parseCapGiB("7.5")).toBe(7.5);
    expect(parseCapGiB("1,000")).toBe(1000);
    for (const bad of ["", "0", "0.05", "-3", "abc", "10001", "1e2", ".5"]) expect(parseCapGiB(bad)).toBeUndefined();
  });
});

describe("format", () => {
  it("formats dates in UTC and sizes with the cap's units", () => {
    expect(formatDate(Date.UTC(2026, 10, 6, 23, 59))).toBe("Nov 6, 2026");
    expect(formatMonth(Date.UTC(2027, 2, 1))).toBe("March 2027");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(gibToBytes(5))).toBe("5 GB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(-1)).toBe("unknown size");
  });
});

describe("blocksNetwork", () => {
  it("is true only for a policy that blocks all connections", () => {
    expect(blocksNetwork("default-src 'none'; connect-src 'none'; img-src data:")).toBe(true);
    expect(blocksNetwork("default-src 'none'; connect-src https://example.com")).toBe(false);
    expect(blocksNetwork("default-src *; connect-src 'none'")).toBe(false);
    expect(blocksNetwork(null)).toBe(false);
  });
});
