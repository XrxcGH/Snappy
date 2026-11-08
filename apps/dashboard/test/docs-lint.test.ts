/**
 * Wording lint for the written docs people read (README files and the export guide). The same house
 * rules as the dashboard copy, in the parts that are prose: curly apostrophes and quotes outside code,
 * ZIP in capitals, one name for each thing. Code spans and fenced blocks are left alone.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const DOCS = ["README.md", path.join("apps", "cli", "README.md"), path.join("docs", "EXPORT-GUIDE.md"), path.join("docs", "BETA.md"), path.join("docs", "MACOS.md"), path.join("docs", "images", "README.md"), path.join("docs", "UPDATES.md"), path.join("docs", "UPDATE-RUNBOOKS.md")];

/** The prose of a Markdown file: no fenced blocks, no inline code. One entry per line, with its number. */
function prose(file: string): { n: number; text: string; raw: string }[] {
  const out: { n: number; text: string; raw: string }[] = [];
  let fence = false;
  readFileSync(path.join(root, file), "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        fence = !fence;
        return;
      }
      if (fence) return;
      out.push({ n: i + 1, raw: line, text: line.split(/(`[^`]*`)/).filter((_, k) => k % 2 === 0).join(" ") });
    });
  return out;
}

describe.each(DOCS)("%s", (file) => {
  const lines = prose(file);
  const find = (re: RegExp): string[] => lines.filter((l) => re.test(l.text)).map((l) => `${file}:${l.n}: ${l.text.slice(0, 80)}`);

  it("uses curly apostrophes and quotes in prose, never straight ones", () => {
    expect(find(/[A-Za-z]'[a-z]/)).toEqual([]);
    expect(find(/"[^"]+"/)).toEqual([]);
  });

  it("writes ZIP in capitals in prose, and only file names as .zip", () => {
    expect(find(/\bzips?\b/)).toEqual([]);
  });

  it("uses one name for each thing", () => {
    expect(find(/allowlist/i)).toEqual([]);
    expect(find(/Requests no one accepted|Unanswered requests/)).toEqual([]);
    expect(find(/command-line tool/)).toEqual([]);
  });

  it("has no double spaces after a sentence, no trailing spaces and no tabs", () => {
    expect(find(/[.!?]  +[A-Z]/)).toEqual([]);
    expect(lines.filter((l) => /[ \t]+$/.test(l.raw) && l.raw.trim() !== "").map((l) => `${file}:${l.n}`)).toEqual([]);
    expect(find(/\t/)).toEqual([]);
  });
});

/**
 * American English and no pointers to a branch, in every written document. The dashboard's own copy has the same rule
 * (copy.test.ts); the documents had none, and "tick box" and a branch name had both reached the beta text.
 */
describe.each([...DOCS, "CONTRIBUTING.md", "SECURITY.md", path.join("docs", "RELEASES.md"), path.join("docs", "BRAND.md")])("%s voice", (file) => {
  const lines = prose(file);
  const find = (re: RegExp): string[] => lines.filter((l) => re.test(l.text)).map((l) => `${file}:${l.n}: ${l.text.slice(0, 80)}`);

  it("uses American words and names no branch", () => {
    expect(find(/\b(un)?tick(s|ed|ing)?\b/i)).toEqual([]);
    expect(find(/\b(colour|behaviour|organis|centre|favourite|licence)\w*/i)).toEqual([]);
    expect(find(/\bbranch\s+(feat|fix|wip)\//i)).toEqual([]);
  });
});

/**
 * The network claims. Beta 2 added the update check, so a sentence that says there is one network use, only one, or
 * none must name it, in every document and string a person reads. A claim that stays true for the command line
 * tool alone has to say so.
 */
describe("network claims", () => {
  const CLAIM = /one network|only network|sends nothing over a network|nothing else touches the network/i;
  const CLAIM_DOCS = ["README.md", "CONTRIBUTING.md", "SECURITY.md", path.join("apps", "cli", "README.md"), path.join("docs", "BETA.md"), path.join("docs", "RELEASES.md"), path.join("docs", "UPDATES.md")];

  it.each(CLAIM_DOCS)("%s names the update check wherever it counts the network uses", (file) => {
    const bad = prose(file).filter((l) => CLAIM.test(l.raw) && !/update check/i.test(l.raw));
    expect(bad.map((l) => `${file}:${l.n}: ${l.text.slice(0, 80)}`)).toEqual([]);
  });

  it("names the two network features in the same words in README item 5 and SECURITY", () => {
    const readme = prose("README.md").find((l) => /^5\. /.test(l.raw))?.raw ?? "";
    const security = prose("SECURITY.md").find((l) => /network features/i.test(l.raw))?.raw ?? "";
    for (const text of [readme, security]) {
      expect(text).toMatch(/memories --download/);
      expect(text).toMatch(/update check/i);
      expect(text).toMatch(/github\.com/);
      expect(text).toMatch(/turned off|turn it off/);
    }
  });

  it("qualifies the front page's everything-runs-here line", () => {
    const line = prose("README.md").find((l) => /^3\. Everything runs on this device/.test(l.raw))?.raw ?? "";
    expect(line).toMatch(/apart from the two optional network features/);
  });

  it("is kept in the strings the interface shows", async () => {
    const copy = await import("../src/copy.ts");
    const texts: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") texts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(copy);
    expect(texts.filter((t) => CLAIM.test(t) && !/update check/i.test(t))).toEqual([]);
  });
});
