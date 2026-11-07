/**
 * Permanent copy lint for the command line tool. It reads the REAL text: every sentence-like string
 * literal in apps/cli/src (and the CLI's own copy module if one exists), and the output of every
 * command run on synthetic data. Each failure names the string.
 *
 * What it checks (the owner's list):
 *   capitalization        sentence case: no Title Case headings, no stray capitals
 *   grammar, punctuation  double spaces, space before punctuation, no space after punctuation, repeated
 *                         words, "etc.", lowercase after a full stop, missing final period on full sentences
 *   American English      colour, centre, organise, behaviour, -ise endings, whilst, learnt, and so on
 *   whitespace            trailing and doubled spaces, tabs, odd space characters, trailing spaces on output lines
 *   maximum lengths       sentences, errors and notes, help-list descriptions, headings
 *   quotes                no string mixes straight and curly quotes (a terminal may not draw curly ones, so
 *                         straight quotes alone are allowed here; the dashboard requires curly)
 *   repeats               no sentence of more than 8 words twice in one command's output
 *   stale names           the command is snappy-export everywhere
 *
 * Deliberately NOT checked: the words ghost, friend and unfriended (owner decision), so the existing
 * brand-voice rules in brand-voice.test.ts stay exactly as they are.
 *
 * Limits and allow-lists sit at the top, short and commented. The dashboard has its own copy of these
 * rules in apps/dashboard/test/copy-lint.test.ts.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { makeIo, run, stripPaths, tempDir, writeDemoPair, writeSyntheticParts } from "./helpers.ts";
import { INSIGHT_COMMANDS } from "../src/insight-commands.ts";
import { collectInsightOutputs } from "./insight-outputs.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(CLI, "src");

const LIMITS = {
  /** One sentence. */
  sentenceWords: 25,
  /** Errors and notes: one or two short sentences, about 20 words. */
  noteWords: 25,
  noteSentences: 2,
  noteSentenceWords: 20,
  /** A command or option description in a help list: one line. */
  rowChars: 70,
  headingWords: 5,
  /** A prose paragraph in help or output. */
  paragraphSentences: 3,
  paragraphWords: 45,
};

/** Words that may start with a capital in the middle of a sentence: names, and Snapchat's own menu names. Keep short. */
const PROPER_WORDS = new Set([
  "Snappy", "Snapchat", "Snap", "Snaps", "Memories", "Memory", "Spotlight", "Map", "Settings", "My", "Data", "All", "Time", "AI", "Inc", "Profile", "Friends", "User", "Chat", "Export", "JavaScript", "May",
  "January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);
/** All-capital words that are acronyms or protocol names (environment variable names contain an underscore). */
const ACRONYMS = new Set(["JSON", "HTML", "ZIP", "CSV", "UTF", "AES", "GCM", "PBKDF", "SHA", "CSP", "URL", "USB", "PDF", "NO", "OK", "GB", "MB", "KB", "TTY"]);

const BRITISH = [
  /\b(colour|flavour|favour|honour|neighbour|behaviour|labour|rumour|humour|harbour|savour)\w*/i,
  /\b(centre|metre|litre|theatre|fibre|calibre|sombre)s?\b/i,
  /\b(analyse|analysed|analysing|paralyse|catalyse)\b/i,
  /\b(licence|defence|offence|pretence|practise|practised|practising)\b/i,
  /\b(cancelled|cancelling|labelled|labelling|travelled|travelling|modelled|modelling|signalled|fuelled|levelled)\b/i,
  /\b(whilst|amongst|learnt|spelt|burnt|dreamt|leapt|grey|greys|cheque|catalogue|programme|tyre|kerb|plough|ageing|judgement|fulfil|enrol|artefact|aluminium|maths|fortnight)\b/i,
  /\b(unrecognis\w*|tick|ticks|ticked|ticking)\b/i,
];
const ISE = /\b[a-z]{3,}(?:is(?:e|es|ed|ing|ation|ations|er|ers))\b/gi;
const ISE_OK = /^(?:otherwise|promis\w*|exercis\w*|surpris\w*|advis\w*|revis\w*|precis\w*|rais\w*|prais\w*|nois\w*|premis\w*|disguis\w*|enterpris\w*|expertis\w*|franchis\w*|compris\w*|compromis\w*|supervis\w*|devis\w*|improvis\w*|paradis\w*|wis\w*|likewis\w*|aris\w*|ris\w*|demis\w*|merchandis\w*|despis\w*|apprais\w*|treatis\w*|concis\w*|cruis\w*|bruis\w*|pois\w*|clockwis\w*|surmis\w*|excis\w*|televis\w*|cris\w*)$/i;
const TYPOS = /\b(teh|recieve|recieved|occured|seperate|definately|untill|accomodate|alot|dont|doesnt|isnt|wasnt|couldnt|shouldnt|wouldnt|becuase|wich|thier|adress|enviroment|neccessary|succesful|begining|writting|refered)\b/i;

/* ------------------------------------------------------------------------------------------ */
/* Rules                                                                                       */
/* ------------------------------------------------------------------------------------------ */

type Kind = "prose" | "note" | "row" | "heading" | "fragment";
interface Entry {
  id: string;
  text: string;
  kind: Kind;
}

const words = (s: string): string[] => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
const sentences = (s: string): string[] => s.split(/(?<=[.?!])["')]*\s+(?=[A-Z0-9"(])/).map((x) => x.trim()).filter(Boolean);
const clip = (s: string): string => (s.length > 70 ? `${s.slice(0, 67)}...` : s);

function strayCapitals(text: string): string[] {
  const out: string[] = [];
  let boundary = true;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    // "X" stands for a value or a whole sentence that code inserts, so it is neutral and starts a fresh sentence.
    if (/^X(?![A-Za-z])/.test(raw)) {
      boundary = raw === "X" || /^X[.?!]/.test(raw);
      continue;
    }
    const opening = /^[("'\[`]/.test(raw);
    const core = raw.replace(/^[("'\[`]+/, "").replace(/[.,;:!?)"'\]`]+$/, "").replace(/(?:\u2019s|'s)$/, "");
    const acronym = /^[A-Z][A-Z_-]+s?$/.test(core) || /^[A-Z]{2,}-[a-z]+$/.test(core) || /^[A-Z]$/.test(core);
    if (core !== "" && /^[A-Z]/.test(core) && !boundary && !opening && !/\d/.test(core) && !PROPER_WORDS.has(core) && !acronym) out.push(core);
    boundary = /[.?!]["')]*$/.test(raw) || /^\d+:$/.test(raw);
  }
  return out;
}

/** A sentence ends with . ? or :, or with a command, file name or value the person is meant to type (like: snappy-export keep sam_01). */
const endsProperly = (s: string): boolean => {
  const t = s.trim();
  if (/[.?:]["')]?$/.test(t)) return true;
  const last = t.split(/\s+/).pop() ?? "";
  return /[_./=<>\\-]|\d/.test(last) && /\b(like|for example|such as|run|use|try|type)\b/i.test(t);
};

const withoutLabel = (s: string): string => s.replace(/^(Note|Warning|Error|Done)[.:]\s+/, "");

const RULES: [name: string, fn: (e: Entry) => string[]][] = [
  [
    "whitespace",
    (e) => {
      const t = e.text;
      const out: string[] = [];
      if (e.kind !== "fragment" && t !== t.trim()) out.push("has a leading or trailing space");
      if (e.kind !== "row" && / {2,}/.test(t.trim())) out.push("has a double space");
      if (/\t/.test(t)) out.push("has a tab");
      if (/[\u200B-\u200D\u2060\uFEFF\u2000-\u200A\u2028\u2029\u205F\u3000]/.test(t)) out.push("has an unusual space or invisible character");
      return out;
    },
  ],
  [
    "punctuation and grammar",
    (e) => {
      const t = e.text;
      const out: string[] = [];
      if (/[a-z)]\s[,;](?!\w*\.)/.test(t) || /\w\s[.?!](\s|$)/.test(t)) out.push("has a space before punctuation");
      if (/[a-z]{2}[,;][A-Za-z]/.test(t)) out.push("has no space after a comma or semicolon");
      if (/[a-z]{2}[.?!][A-Z][a-z]/.test(t)) out.push("has no space after a full stop");
      if (/[a-z]{3,}[.?!] (?!(?:analyze|memories|inspect|keep|unkeep|ledger|demo|help)\b)[a-z]/.test(t)) out.push("starts a sentence in lowercase");
      if (/(?:[,;]{2,}|,\.|\.,|:\.|;\.)/.test(t)) out.push("has doubled punctuation");
      const rep = /\b(\w{2,}) \1\b/i.exec(t);
      if (rep && !/\b(that that|had had)\b/i.test(t)) out.push(`repeats a word ("${rep[0]}")`);
      if (/\betc\b/i.test(t)) out.push('uses "etc."');
      if (/\d %/.test(t)) out.push("has a space before a percent sign");
      const typo = TYPOS.exec(t);
      if (typo) out.push(`has a typo ("${typo[0]}")`);
      return out;
    },
  ],
  [
    "quotes",
    (e) => (/['"]/.test(e.text.replace(/[A-Za-z]'[a-z]/g, "")) && /[\u2018\u2019\u201C\u201D]/.test(e.text) ? ["mixes straight and curly quotes"] : []),
  ],
  [
    "American English",
    (e) => {
      const out: string[] = [];
      for (const re of BRITISH) {
        const m = re.exec(e.text);
        if (m) out.push(`uses British English ("${m[0]}")`);
      }
      for (const m of e.text.matchAll(ISE)) if (!ISE_OK.test(m[0])) out.push(`uses an -ise spelling ("${m[0]}")`);
      return out;
    },
  ],
  [
    "capitalization",
    (e) => {
      const out: string[] = [];
      const stray = strayCapitals(e.text);
      if (stray.length > 0) out.push(`has capitals that are not sentence case (${[...new Set(stray)].join(", ")})`);
      for (const w of e.text.match(/\b[A-Z]{4,}\b/g) ?? []) if (!ACRONYMS.has(w) && !ACRONYMS.has(w.replace(/\d+$/, ""))) out.push(`has an all-caps word (${w})`);
      if ((e.kind === "prose" || e.kind === "note" || e.kind === "heading") && /^[a-z]/.test(e.text.trim())) out.push("starts with a lowercase letter");
      return out;
    },
  ],
  [
    "maximum lengths",
    (e) => {
      const out: string[] = [];
      const text = withoutLabel(e.text);
      const w = words(text).length;
      const ss = sentences(text);
      switch (e.kind) {
        case "row":
          if (e.text.length > LIMITS.rowChars) out.push(`list description is ${e.text.length} characters, the limit is ${LIMITS.rowChars}: it must stay on one line`);
          break;
        case "heading":
          if (w > LIMITS.headingWords) out.push(`heading is ${w} words, the limit is ${LIMITS.headingWords}`);
          if (/\.$/.test(e.text)) out.push("heading ends with a full stop");
          break;
        case "note":
          if (w > LIMITS.noteWords) out.push(`note is ${w} words, the limit is ${LIMITS.noteWords}`);
          if (ss.length > LIMITS.noteSentences) out.push(`note is ${ss.length} sentences, the limit is ${LIMITS.noteSentences}`);
          for (const s of ss) if (words(s).length > LIMITS.noteSentenceWords) out.push(`note sentence is ${words(s).length} words, the limit is ${LIMITS.noteSentenceWords}: "${clip(s)}"`);
          if (w >= 5 && !endsProperly(e.text)) out.push("note has no final period");
          break;
        case "prose":
          if (w > LIMITS.paragraphWords) out.push(`text is ${w} words, the limit is ${LIMITS.paragraphWords}`);
          if (ss.length > LIMITS.paragraphSentences) out.push(`text is ${ss.length} sentences, the limit is ${LIMITS.paragraphSentences}`);
          for (const s of ss) if (words(s).length > LIMITS.sentenceWords) out.push(`sentence is ${words(s).length} words, the limit is ${LIMITS.sentenceWords}: "${clip(s)}"`);
          if (w >= 6 && /^[A-Z]/.test(e.text.trim()) && !endsProperly(e.text)) out.push("sentence has no final period");
          break;
        default:
      }
      return out;
    },
  ],
];

function lint(entries: Entry[], rule: (typeof RULES)[number]): string[] {
  const out: string[] = [];
  for (const e of entries) for (const problem of rule[1](e)) out.push(`${e.id}: "${clip(e.text)}" ${problem}`);
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Static scan: the sentence-like string literals in the source                                */
/* ------------------------------------------------------------------------------------------ */

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listTs(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

const sources = listTs(SRC)
  .map((p) => ({ path: relative(SRC, p).split(sep).join("/"), text: readFileSync(p, "utf8") }))
  .sort((a, b) => a.path.localeCompare(b.path));

interface RawLiteral {
  body: string;
  /** The literal is the message of a CliError: an error people read. */
  note: boolean;
}

/**
 * Every string and template literal in a source file, found by a small tokenizer so that quotes inside
 * regular expressions, comments and nested templates do not confuse it. A template's ${...} parts become
 * "X"; literals nested inside them are returned too.
 */
function extractLiterals(src: string): RawLiteral[] {
  const out: RawLiteral[] = [];
  const n = src.length;
  let i = 0;
  const prevSignificant = (idx: number): string => {
    for (let k = idx - 1; k >= 0; k--) if (!/\s/.test(src[k] ?? "")) return src[k] ?? "";
    return "";
  };
  const regexStart = (idx: number): boolean => {
    const prev = prevSignificant(idx);
    if (prev === "" || "(,=:[!&|?{};".includes(prev)) return true;
    return /\b(?:return|typeof|case)\s*$/.test(src.slice(Math.max(0, idx - 10), idx));
  };
  const noteBefore = (start: number): boolean => /new CliError\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`),\s*$/.test(src.slice(Math.max(0, start - 90), start));
  const readString = (q: string): string => {
    const start = i;
    i++;
    let s = "";
    while (i < n && src[i] !== q && src[i] !== "\n") {
      if (src[i] === "\\") {
        s += src.slice(i, i + 2);
        i += 2;
      } else s += src[i++];
    }
    i++;
    out.push({ body: s, note: noteBefore(start) });
    return s;
  };
  const readTemplate = (): void => {
    const start = i;
    i++;
    let s = "";
    while (i < n && src[i] !== "`") {
      if (src[i] === "\\") {
        s += src.slice(i, i + 2);
        i += 2;
      } else if (src[i] === "$" && src[i + 1] === "{") {
        i += 2;
        s += "X";
        scan(true);
      } else s += src[i++];
    }
    i++;
    out.push({ body: s, note: noteBefore(start) });
  };
  const skipRegex = (): void => {
    i++;
    let inClass = false;
    while (i < n && src[i] !== "\n") {
      if (src[i] === "\\") i += 2;
      else if (src[i] === "[") (inClass = true), i++;
      else if (src[i] === "]") (inClass = false), i++;
      else if (src[i] === "/" && !inClass) break;
      else i++;
    }
    i++;
    while (/[a-z]/.test(src[i] ?? "")) i++;
  };
  const scan = (insideTemplate: boolean): void => {
    let depth = 0;
    while (i < n) {
      const c = src[i] as string;
      if (c === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
      } else if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        i = end < 0 ? n : end + 2;
      } else if (c === '"' || c === "'") readString(c);
      else if (c === "`") readTemplate();
      else if (c === "/" && regexStart(i)) skipRegex();
      else if (c === "{") (depth++, i++);
      else if (c === "}") {
        if (insideTemplate && depth === 0) {
          i++;
          return;
        }
        depth--;
        i++;
      } else i++;
    }
  };
  scan(false);
  return out;
}

const COMMAND_WORDS = new Set(["analyze", "memories", "inspect", "keep", "unkeep", "ledger", "demo", "help"]);

/** Split one literal into the entries a person reads: table rows (a name, a gap, a description), paragraphs, headings. */
function entriesOfLiteral(file: string, raw: string, isNote: boolean): Entry[] {
  const text = raw.replace(/\\n/g, "\n").replace(/\\(["'`\\])/g, "$1");
  const id = `${file} literal`;
  // the "(code: name)" that ends an error line is printed for bug reports and is not part of the sentence
  const lines = text.replace(/\s*\(code: [a-z-]+\)\s*$/, "").split("\n");
  const rowOf = (line: string): RegExpExecArray | null => /^\s{2,}\S.*?\S\s{2,}(\S.*)$/.exec(line);
  // a single line that starts in lowercase or with a space, or ends with a space, is joined to something else in code
  if (lines.length === 1 && !rowOf(text) && (/^[a-z\s]/.test(text) || /\s$/.test(text))) return [{ id, text, kind: "fragment" }];
  const out: Entry[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join(" ").replace(/ {2,}/g, " ").trim();
    paragraph = [];
    if (joined === "") return;
    if (/^(Usage|Exit codes|Example|Examples):?(\s|$)/.test(joined)) out.push({ id, text: joined, kind: "fragment" });
    else if (/^[a-z]+ /.test(joined) && COMMAND_WORDS.has(joined.split(" ")[0] ?? "")) out.push({ id, text: joined, kind: "fragment" });
    else out.push({ id, text: joined, kind: isNote && lines.length === 1 ? "note" : /^[A-Z][^.?!:]*$/.test(joined) && words(joined).length <= 5 ? "heading" : "prose" });
  };
  for (const line of lines) {
    const row = rowOf(line);
    if (row) {
      flush();
      out.push({ id: `${id} (list row)`, text: (row[1] ?? "").trim(), kind: "row" });
    } else if (line.trim() === "") flush();
    else if (/^\s/.test(line)) flush(); // an indented line that is not a table row: an example or a column of names
    else paragraph.push(line);
  }
  flush();
  return out;
}

function collectLiterals(): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const f of sources) {
    for (const lit of extractLiterals(f.text)) {
      const body = lit.body;
      if (!/[A-Za-z]{2,}\s[A-Za-z]{2,}/.test(body)) continue; // needs two words
      if (/^(\.{1,2}\/|node:|@|--?[a-z])/.test(body) || /=>|===|[{};]\s*$|^\s*[#[\]]/.test(body)) continue; // import paths, code
      if (/^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*$/.test(body) && words(body).length <= 3) continue; // option and command words
      const key = `${f.path}|${body}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const e of entriesOfLiteral(f.path, body, lit.note)) out.push(e);
    }
  }
  return out;
}


/** A CLI copy module, if the copywriter adds one: every string in it is linted as prose. */
async function collectCopyModule(): Promise<Entry[]> {
  const file = join(SRC, "copy.ts");
  if (!existsSync(file)) return [];
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const out: Entry[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") out.push({ id: `copy.ts ${path}`, text: value, kind: "prose" });
    else if (typeof value === "function") {
      for (const args of [[1], [2], [0], ["alice"], ["alice", 3], [3, 12]]) {
        try {
          const r = (value as (...a: unknown[]) => unknown)(...args);
          if (typeof r === "string" && !/NaN|undefined|null/.test(r)) out.push({ id: `copy.ts ${path}(${args.join(", ")})`, text: r, kind: "prose" });
        } catch {
          // not for these arguments
        }
      }
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
  };
  for (const [k, v] of Object.entries(mod)) walk(v, k);
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Runtime output                                                                              */
/* ------------------------------------------------------------------------------------------ */

/** Synthetic usernames are data, not copy. */
const USERNAMES = /\b(?:ghost|oneway|dormant|active|newfriend)_\d+\b/g;

async function collectOutputs(): Promise<Record<string, string>> {
  const dir = tempDir("copy-lint");
  const { earlier, later } = writeDemoPair(dir, { bundleMedia: true });
  const env = { SNAPPY_PASSPHRASE: "lint-test-passphrase" };
  const ledger = join(dir, "ledger.sealed");
  const outputs: Record<string, string> = {};
  const capture = async (name: string, args: string[]): Promise<void> => {
    const r = await run(args, makeIo({ env }));
    // the temp folder's own name is not copy (it starts with the test helper's prefix)
    outputs[name] = stripPaths((r.out + r.err).split(dir).join("<folder>"));
  };
  await capture("help", ["help"]);
  for (const c of ["analyze", "memories", "inspect", "keep", "ledger", "demo"]) await capture(`help ${c}`, ["help", c]);
  await capture("analyze", ["analyze", later, "--earlier", earlier, "--no-save"]);
  await capture("analyze one export", ["analyze", later, "--no-save"]);
  await capture("analyze saved", ["analyze", later, "--ledger", ledger]);
  await capture("keep", ["keep", "ghost_1", "--ledger", ledger]);
  await capture("ledger", ["ledger", "status", "--ledger", ledger]);
  await capture("ledger none", ["ledger", "status", "--ledger", join(dir, "none.sealed")]);
  await capture("memories dry run", ["memories", later, "--dry-run"]);
  await capture("memories", ["memories", later, "--out", join(dir, "out")]);
  const parts = join(dir, "parts");
  writeSyntheticParts(parts);
  await capture("analyze parts", ["analyze", parts, "--no-save"]);
  await capture("memories parts", ["memories", parts, "--out", join(dir, "parts-out")]);
  await capture("demo", ["demo", "--dir", join(dir, "demo")]);
  await capture("errors", ["analyze", join(dir, "missing.zip")]);
  await capture("usage", ["analyze", later, "--bogus"]);
  await capture("unknown", ["bogus"]);
  // The 14 insight commands: their output, options, help and mistakes.
  for (const [name, text] of Object.entries(await collectInsightOutputs())) outputs[name] = stripPaths(text);
  return outputs;
}

/* ------------------------------------------------------------------------------------------ */
/* Tests                                                                                       */
/* ------------------------------------------------------------------------------------------ */

let literals: Entry[] = [];
let outputs: Record<string, string> = {};

beforeAll(async () => {
  literals = [...collectLiterals(), ...(await collectCopyModule())];
  outputs = await collectOutputs();
}, 90_000);

describe("CLI source text", () => {
  it("has sentence-like text to check", () => {
    expect(literals.length).toBeGreaterThan(40);
    expect(literals.filter((e) => e.kind === "row").length, "help list rows").toBeGreaterThan(5);
    expect(literals.filter((e) => e.kind === "note").length, "error messages").toBeGreaterThan(5);
  });

  for (const rule of RULES) {
    it(`${rule[0]}: every literal passes`, () => {
      expect(lint(literals, rule)).toEqual([]);
    });
  }

  it("keeps help-list descriptions on one line and in one style (all end the same way)", () => {
    const rows = literals.filter((e) => e.kind === "row");
    const withStop = rows.filter((e) => /\.$/.test(e.text));
    // The command list ends without a full stop; option rows may end with one. Within one literal the style must match.
    const byLiteral = new Map<string, Entry[]>();
    for (const e of rows) byLiteral.set(e.id, [...(byLiteral.get(e.id) ?? []), e]);
    expect(rows.length).toBeGreaterThan(withStop.length - 1);
    const bad: string[] = [];
    for (const e of rows) {
      if (e.text.length > LIMITS.rowChars) bad.push(`"${clip(e.text)}" is ${e.text.length} characters`);
      if (/^[a-z]/.test(e.text)) bad.push(`"${clip(e.text)}" starts in lowercase`);
    }
    expect(bad).toEqual([]);
  });
});

describe("CLI output", () => {
  it("collects the output of every command", () => {
    expect(Object.keys(outputs).length).toBeGreaterThan(15);
    for (const [name, text] of Object.entries(outputs)) expect(text.length, name).toBeGreaterThan(10);
  });

  it("includes every insight command: its help, both ways, and a run", () => {
    for (const c of INSIGHT_COMMANDS) {
      expect(outputs[`help ${c.name}`], `help ${c.name}`).toBe(stripPaths(c.usage));
      expect(outputs[`${c.name} --help`], `${c.name} --help`).toBe(stripPaths(c.usage));
      const runs = Object.keys(outputs).filter((k) => (k === c.name || k.startsWith(`${c.name} `)) && !k.endsWith("--help"));
      expect(runs.length, `a run of ${c.name}`).toBeGreaterThan(0);
    }
  });

  it("uses American English in every line", () => {
    const bad: string[] = [];
    for (const [name, text] of Object.entries(outputs)) {
      for (const line of text.replace(USERNAMES, "").split("\n")) {
        for (const re of BRITISH) {
          const m = re.exec(line);
          if (m) bad.push(`${name}: "${clip(line.trim())}" uses British English ("${m[0]}")`);
        }
        for (const m of line.matchAll(ISE)) if (!ISE_OK.test(m[0])) bad.push(`${name}: "${clip(line.trim())}" uses an -ise spelling ("${m[0]}")`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("leaves no trailing spaces, tabs or doubled spaces inside sentences", () => {
    const bad: string[] = [];
    for (const [name, text] of Object.entries(outputs)) {
      for (const line of text.split("\n")) {
        if (/[ \t]+$/.test(line)) bad.push(`${name}: "${clip(line)}" ends with a space`);
        if (/\t/.test(line)) bad.push(`${name}: "${clip(line)}" has a tab`);
        if (/[a-z,] {2}[A-Za-z]/.test(line.replace(/^\s+/, "")) && /[.?]$/.test(line.trim()) && !/^\s*\S+\s{2,}/.test(line) && !/^\S+ {2,}/.test(line.trim())) bad.push(`${name}: "${clip(line.trim())}" has a double space`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("mixes no straight and curly quotes on one line", () => {
    const bad: string[] = [];
    for (const [name, text] of Object.entries(outputs)) for (const line of text.split("\n")) if (/['"]/.test(line.replace(/[A-Za-z]'[a-z]/g, "")) && /[\u2018\u2019\u201C\u201D]/.test(line)) bad.push(`${name}: "${clip(line.trim())}"`);
    expect(bad).toEqual([]);
  });

  it("keeps every command in the help overview on one line of 80 characters or fewer", () => {
    const rows = (outputs.help ?? "").split("\n").filter((l) => /^\s{2,}\S/.test(l));
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.filter((l) => l.length > 80).map((l) => `"${clip(l)}" is ${l.length} characters`)).toEqual([]);
  });

  it("shows no sentence of more than 8 words twice in one command's output", () => {
    const bad: string[] = [];
    for (const [name, text] of Object.entries(outputs)) {
      const prose = text.replace(USERNAMES, "").split("\n").filter((l) => l.trim() !== "" && !/^\s/.test(l)).join(" ");
      const seen = new Map<string, number>();
      for (const s of sentences(prose)) {
        const n = s.toLowerCase().replace(/[.?!]+$/, "");
        if (words(n).length > 8) seen.set(n, (seen.get(n) ?? 0) + 1);
      }
      for (const [s, n] of seen) if (n > 1) bad.push(`${name}: "${clip(s)}" appears ${n} times`);
    }
    expect(bad).toEqual([]);
  });

  it("starts every usage line with the command name snappy-export", () => {
    const bad: string[] = [];
    for (const [name, text] of Object.entries(outputs)) for (const line of text.split("\n")) if (/^Usage:/.test(line) && !/^Usage: snappy-export\b/.test(line)) bad.push(`${name}: "${line}"`);
    expect(bad).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Stale names                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** "snappy" used as the command, or an old package name. The command and package are snappy-export. */
const STALE = [/\bnpm run (?!snappy-export\b)[\w:.-]*snappy[\w:.-]*/g, new RegExp(`\\bsnappy (?:inspect|analyze|memories|keep|unkeep|ledger|demo|help|${INSIGHT_COMMANDS.map((c) => c.name).join("|")})\\b`, "g"), /\bsnappy-cli\b/gi, /\bsnappy_export\b/g, /\bnpx snappy\b/g];
const stale = (text: string): string[] => STALE.flatMap((re) => [...text.matchAll(re)].map((m) => m[0]));

describe("stale names", () => {
  it("says snappy-export in every source file", () => {
    expect(sources.flatMap((f) => stale(f.text).map((s) => `${f.path}: "${s}"`))).toEqual([]);
  });

  it("says snappy-export in every command's output", () => {
    expect(Object.entries(outputs).flatMap(([name, text]) => stale(text).map((s) => `${name}: "${s}"`))).toEqual([]);
  });

  it("names the command snappy-export in the CLI package and its README", () => {
    const pkg = JSON.parse(readFileSync(join(CLI, "package.json"), "utf8")) as { name: string; bin: Record<string, string>; scripts: Record<string, string> };
    expect(pkg.name).toBe("snappy-export");
    expect(Object.keys(pkg.bin)).toEqual(["snappy-export"]);
    expect(Object.keys(pkg.scripts)).toContain("snappy-export");
    const readme = join(CLI, "README.md");
    if (existsSync(readme)) expect(stale(readFileSync(readme, "utf8")).map((s) => `README.md: "${s}"`)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* The rules themselves                                                                        */
/* ------------------------------------------------------------------------------------------ */

describe("the lint rules catch what they should", () => {
  const e = (text: string, kind: Kind = "prose"): Entry => ({ id: "x", text, kind });
  const problems = (text: string, kind: Kind = "prose"): string => RULES.flatMap(([, fn]) => fn(e(text, kind))).join(" | ");

  it("flags capitalization", () => {
    expect(problems("Export Check", "heading")).toMatch(/capitals/);
    expect(problems("Export check", "heading")).toBe("");
    expect(problems("Snappy reads your export in Snapchat, then Settings.")).not.toMatch(/capitals/);
  });
  it("flags punctuation and grammar", () => {
    expect(problems("Two  spaces here.")).toMatch(/double space/);
    expect(problems("A space before , a comma.")).toMatch(/before punctuation/);
    expect(problems("It is the the best way.")).toMatch(/repeats a word/);
    expect(problems("Lists, files, etc. are sorted.")).toMatch(/etc/);
    expect(problems("This ends. and then starts low.")).toMatch(/lowercase/);
  });
  it("flags mixed quotes and British English", () => {
    expect(problems("Snapchat\u2019s cap and \"this\".")).toMatch(/mixes/);
    expect(problems("The colour of the centre.")).toMatch(/British/);
    expect(problems("Organise your files whilst you wait.")).toMatch(/-ise|British/);
    expect(problems("Otherwise, promise to exercise.")).not.toMatch(/-ise/);
  });
  it("flags lengths", () => {
    expect(problems("x".repeat(80), "row")).toMatch(/limit/);
    expect(problems(`${"word ".repeat(26)}end.`, "note")).toMatch(/limit/);
    expect(problems("A short note that ends well.", "note")).toBe("");
    expect(problems("A short note without a stop", "note")).toMatch(/final period/);
  });
});
