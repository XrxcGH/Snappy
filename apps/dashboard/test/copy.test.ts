/**
 * Voice rules from docs/BRAND.md, checked on every string the interface can show: the copy
 * module, and sentence-like string literals in the views and components.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as copy from "../src/copy.ts";
import { loadCopyModules } from "./copy-rules.ts";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every string reachable from the copy module, calling copy functions with sample values. */
function collect(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") {
    for (const args of [[1], [2], ["alice", 3], [0, 0], [3, 12, 5], ["x", "y", "z"]]) {
      try {
        collect((value as (...a: unknown[]) => unknown)(...args), out);
      } catch {
        // A function that rejects these sample arguments simply contributes nothing for them.
      }
    }
  } else if (Array.isArray(value)) for (const v of value) collect(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collect(v, out);
  return out;
}

const BANNED: [string, RegExp][] = [
  ["ghost", /ghost/i],
  ["unfriend", /unfriend/i],
  ["banned word", /\b(oops|whoops|awesome|simply|just|purge|stalker|exposed|leaked)\b/i],
  ["exclamation mark", /!/],
  ["emoji", /\p{Extended_Pictographic}/u],
  ["color value", /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i],
  ["British spelling", /\b(colour|organis|analys(e|ing)|cancelled|licence|centre|favourite|behaviour|grey)\w*/i],
  ["British wording", /\b(tick|ticks|ticked|ticking|unrecognis\w*)\b/i],
  ["shouting", /\b[A-Z]{5,}\b/],
  ["Dormant, dead, inactive", /\b(dormant|inactive)\b/i],
  ["delete a friend", /\bdelete (a |the )?friend/i],
];

// copy.ts and every src/copy-<name>.ts beside it.
const strings = [...new Set([...collect(copy), ...(await loadCopyModules(srcDir)).flatMap((m) => collect(m))])].filter((s) => s.trim() !== "");

describe("copy module", () => {
  it("has strings to check", () => {
    expect(strings.length).toBeGreaterThan(200);
  });

  it.each(BANNED)("contains no %s", (_name, pattern) => {
    expect(strings.filter((s) => pattern.test(s))).toEqual([]);
  });

  it("writes menu and feature names in sentence case", () => {
    for (const route of Object.values(copy.routes)) {
      expect(route.label).toMatch(/^[A-Z]/);
      expect(route.label).not.toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)+$/);
      expect(route.title).not.toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+){2,}$/);
    }
    expect(copy.routes.disappeared.label).toBe("Disappeared friends");
    // The owner chose this name for the menu, the page and every surface; the route id stays "requests".
    expect(copy.routes.requests.label).toBe("Unaccepted requests");
    expect(copy.routes.quiet.label).toBe("Quiet friends");
    expect(copy.routes.cleanup.label).toBe("Cleanup queue");
    expect(copy.routes.memories.label).toBe("Memories rescue");
  });

  it("hedges removals and carries the non-affiliation line verbatim", () => {
    expect(copy.categories.ghost.lead).toBe("May have removed you");
    expect(copy.brand.nonAffiliation).toBe(
      "Snappy is an independent tool. It is not affiliated with, endorsed by, or sponsored by Snap Inc. Snapchat is a trademark of Snap Inc.",
    );
    expect(copy.brand.privacyLine).toBe("Your export stays on this device. Snappy reads friend names and dates, and skips messages, photos, and locations.");
    expect(copy.brand.basedOn).toBe("Based on your exports, not on anything Snapchat told Snappy.");
    expect(copy.memories.capLabel).toBe("Free storage cap (GB)");
    expect(copy.memories.capHelp).toMatch(/may change/);
    expect(copy.disappeared.needTwoTitle).toBe("Add another export later to compare");
  });

  it("explains that Snapchat sends no signal and that results are inferred", () => {
    expect(copy.disappeared.inference).toMatch(/gives no signal/);
    expect(copy.disappeared.inference).toMatch(/infers/);
  });

  it("names every export value it promises never to read", () => {
    const never = copy.privacy.neverRows.map(([what]) => what.toLowerCase()).join(" | ");
    for (const word of ["message text", "photos and videos", "locations", "display names", "group chat titles", "purchases", "login history"]) expect(never).toContain(word);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe("string literals in views and components", () => {
  const files = walk(srcDir).filter((f) => /[\\/](views|components)[\\/].*\.ts$/.test(f) || /main\.ts$/.test(f));

  it("hold no banned words, exclamation marks or emoji", () => {
    const hits: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      for (const match of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
        const text = match[1] ?? match[2] ?? "";
        if (!/[A-Za-z]{3,} [A-Za-z]{2,}/.test(text)) continue; // sentences only, not class names or ids
        for (const [name, pattern] of BANNED) if (pattern.test(text)) hits.push(`${path.basename(file)}: ${name}: ${text.slice(0, 50)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
