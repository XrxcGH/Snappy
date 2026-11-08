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
const DOCS = ["README.md", path.join("apps", "cli", "README.md"), path.join("docs", "EXPORT-GUIDE.md"), path.join("docs", "BETA.md"), path.join("docs", "images", "README.md"), path.join("docs", "UPDATES.md"), path.join("docs", "UPDATE-RUNBOOKS.md")];

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
