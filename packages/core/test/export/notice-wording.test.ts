/**
 * The export-check notices are read by people, in the dashboard and in the command line. They must
 * stay short and plain. This test reads the source of every notice (issue("severity", "code", "text"))
 * and checks the words: at most 20 of them, no jargon, no semicolons, no developer codes.
 * Pieces of text that change with a count ("Memory has" or "Memories have") are collapsed to one
 * word, so the real notice is at most a word or two longer than what is measured here.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const EXPORT_DIR = join(import.meta.dirname, "../../src/export");
const MAX_WORDS = 20;
const JARGON = /bare list|top-level|isSender|decompress|mis-grouped|one-way|payload|schema|re-request|\bflag\b|\bparse[ds]?\b|timestamp|\barchive\b/i;

/** The text between the matching parentheses that open at `start` (the index of "("). */
function callBody(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i]!;
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return source.slice(start + 1, i);
  }
  return "";
}

/** Split call arguments at top-level commas. */
function splitArgs(body: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "`" || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      args.push(body.slice(from, i));
      from = i + 1;
    }
  }
  args.push(body.slice(from));
  return args;
}

/** Remove every ${...} expression (with nested braces) from template text, leaving a one-word stand-in. */
function collapseExpressions(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "$" && text[i + 1] === "{") {
      let depth = 0;
      for (; i < text.length; i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}" && --depth === 0) break;
      }
      out += "N";
    } else out += text[i];
  }
  return out;
}

interface Notice {
  where: string;
  code: string;
  text: string;
}

function noticesIn(file: string): Notice[] {
  const source = readFileSync(join(EXPORT_DIR, file), "utf8");
  const found: Notice[] = [];
  for (const m of source.matchAll(/\bissue\(/g)) {
    const args = splitArgs(callBody(source, m.index! + m[0].length - 1));
    if (args.length < 3 || !/^\s*"(error|warning|info)"\s*$/.test(args[0]!)) continue;
    const message = args.slice(2).join(",");
    const pieces = [...message.matchAll(/`((?:\\.|[^`\\])*)`|"((?:\\.|[^"\\])*)"/g)];
    // Alternatives (a ternary) are measured one at a time; pieces joined with + are measured together.
    const texts = pieces.map((p) => collapseExpressions(p[1] ?? p[2] ?? ""));
    const joined = /\+\s*["`]/.test(message);
    for (const text of joined ? [texts.join("")] : texts) found.push({ where: file, code: args[1]!.trim(), text });
  }
  return found;
}

const FILES = readdirSync(EXPORT_DIR).filter((f) => f.endsWith(".ts"));
const NOTICES = FILES.flatMap(noticesIn).filter((n) => n.text !== "");

describe("export-check notices", () => {
  it("finds the notices it is meant to check", () => {
    expect(NOTICES.length).toBeGreaterThan(30);
  });

  it("are one or two short sentences of 20 words or fewer", () => {
    const tooLong = NOTICES.filter((n) => n.text.split(/\s+/).filter(Boolean).length > MAX_WORDS);
    expect(tooLong.map((n) => `${n.where} ${n.code}: ${n.text}`)).toEqual([]);
  });

  it("use plain words, one idea per sentence, and no jargon", () => {
    const bad = NOTICES.filter((n) => JARGON.test(n.text) || n.text.includes(";"));
    expect(bad.map((n) => `${n.where} ${n.code}: ${n.text}`)).toEqual([]);
  });

  it("never print their own code to people", () => {
    const bad = NOTICES.filter((n) => /\bcode\b/i.test(n.text) || n.text.includes(n.code.replace(/"/g, "")));
    expect(bad.map((n) => `${n.where} ${n.code}`)).toEqual([]);
  });
});
