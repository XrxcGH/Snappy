import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { posixPath } from "../src/posix-path.ts";

/** A small seeded generator, so a failing case can be replayed. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ["", ".", "..", "a", "b", "abc", "x.zip", "...", "a b", "/", "//"];

function randomPath(rand: () => number): string {
  const count = Math.floor(rand() * 6);
  let out = rand() < 0.4 ? "/" : "";
  for (let i = 0; i < count; i++) out += (PIECES[Math.floor(rand() * PIECES.length)] as string) + (rand() < 0.7 ? "/" : "");
  return out;
}

describe("posixPath", () => {
  it("matches node:path/posix on seeded random paths", () => {
    const rand = prng(20261107);
    for (let i = 0; i < 4000; i++) {
      const a = randomPath(rand);
      const b = randomPath(rand);
      const c = randomPath(rand);
      expect(posixPath.join(a, b, c), `join ${JSON.stringify([a, b, c])}`).toBe(posix.join(a, b, c));
      expect(posixPath.resolve(a, b, c), `resolve ${JSON.stringify([a, b, c])}`).toBe(posix.resolve("/", a, b, c));
      expect(posixPath.dirname(a), `dirname ${JSON.stringify(a)}`).toBe(posix.dirname(a));
      expect(posixPath.basename(a), `basename ${JSON.stringify(a)}`).toBe(posix.basename(a));
      expect(posixPath.relative(a, b), `relative ${JSON.stringify([a, b])}`).toBe(posix.relative(posix.resolve("/", a), posix.resolve("/", b)));
      expect(posixPath.isAbsolute(a)).toBe(posix.isAbsolute(a));
    }
  });

  it("removes .. so a path cannot climb out of the root", () => {
    expect(posixPath.resolve("/in", "../../..", "app")).toBe("/app");
    expect(posixPath.resolve("/in/../app/x")).toBe("/app/x");
    expect(posixPath.relative("/out", "/out/a/b.txt")).toBe("a/b.txt");
    expect(posixPath.relative("/out", "/in/a")).toBe("../in/a");
    expect(posixPath.sep).toBe("/");
  });
});
