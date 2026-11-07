/**
 * Permanent copy lint for the dashboard. It scans the REAL copy module (every string reachable from
 * copy.ts, functions called with sample values), the text the views actually render (in the small
 * fake DOM used by view-rendering.test.ts, with the synthetic sample data), the string literals in
 * the views, and the built page. Each failure names the string.
 *
 * What it checks (the owner's list):
 *   capitalization        sentence case: no Title Case menu items, headings or buttons, no stray capitals
 *   grammar, punctuation  double spaces, space before punctuation, no space after punctuation, repeated
 *                         words, "etc.", lowercase after a full stop, missing final period on full sentences
 *   typographic quotes    curly quotes and apostrophes in prose, never a mix of straight and curly
 *   American English      colour, centre, organise, behaviour, -ise endings, whilst, learnt, and so on
 *   whitespace            leading, trailing and doubled spaces, tabs, line breaks, odd space characters
 *   maximum lengths       menu labels, button labels, headings, notes (words and sentences), stat labels
 *   one-line menu labels  length here; the layout audit measures the real rendered line count
 *   repeats               no sentence of more than 8 words twice on one rendered view, no near-duplicate notes
 *   notices               no leading visible "Note." or "Warning." label; no developer codes outside a
 *                         collapsed Details area; notice text stays in the normal text color
 *   stale names           the command is snappy-export everywhere, and the built page is not stale
 *
 * Deliberately NOT checked: the words ghost, friend and unfriended (owner decision), so the existing
 * brand-voice rules in copy.test.ts stay exactly as they are.
 *
 * The limits sit in LIMITS and the allow-lists in PROPER_WORDS, ACRONYMS and CODE_PATHS, so they are
 * easy to tune and short enough to review. The CLI has its own copy of these rules in
 * apps/cli/test/copy-lint.test.ts.
 */
import { readdirSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Actions } from "../src/actions.ts";
import * as copy from "../src/copy.ts";
import { initialState } from "../src/reducer.ts";
import type { State } from "../src/reducer.ts";
import { Scope, runInScope } from "../src/reactive.ts";
import { buildSampleWorkspace } from "../src/sample.ts";
import { createStore } from "../src/store.ts";
import type { View } from "../src/views/context.ts";
import { FakeElement, FakeText, installFakeDom } from "./fake-dom.ts";
import type { FakeNode } from "./fake-dom.ts";

// The license texts come from a virtual module the build provides.
vi.mock("snappy:licenses", () => ({ licenses: [{ name: "Example", license: "MIT", copyright: "Example authors", text: "License text." }] }));

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(here, "..");
const srcDir = path.join(dashboardRoot, "src");

/* ------------------------------------------------------------------------------------------ */
/* Limits and allow-lists                                                                      */
/* ------------------------------------------------------------------------------------------ */

const LIMITS = {
  /** Menu (sidebar) labels fit on one line at every width, also in the phone menu. */
  menuChars: 20,
  menuWords: 3,
  /** Buttons are a verb plus a short noun. */
  buttonWords: 3,
  buttonChars: 24,
  headingWords: 7,
  /** Notes, notices, warnings, dialogs: one or two short sentences, about 20 words. */
  noteWords: 25,
  noteSentences: 2,
  noteSentenceWords: 20,
  /** Other running text (page leads, explanations). */
  textWords: 45,
  textSentences: 3,
  textSentenceWords: 25,
  /** A stat label must fit one line in a card. */
  statLabelChars: 18,
  labelWords: 12,
};

/**
 * Words that may start with a capital in the middle of a sentence: the product names, Snapchat's own
 * menu and option names (Settings, My Data, Profile, Friends, All Time, User information, Chat history,
 * Snap Map, My AI), and month names in dates. Keep this short.
 */
const PROPER_WORDS = new Set([
  "Snappy", "Snapchat", "JavaScript", "May", "Snap", "Snaps", "Memories", "Memory", "Spotlight", "Map", "Settings", "My", "Data", "All", "Time", "AI", "Inc", "Profile", "Friends", "User", "Chat", "Export",
  "January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec",
]);

/** All-capital words that are acronyms, units or protocol names. */
const ACRONYMS = new Set(["JSON", "HTML", "ZIP", "CSV", "UTF", "AES", "GCM", "PBKDF", "SHA", "CSP", "URL", "USB", "PDF", "NO", "OK"]);

/**
 * Strings that are code, commands or file names rather than prose. They keep straight quotes and
 * are exempt from the prose rules (but not from the stale-name rule).
 */
const CODE_PATHS = [/^guide\.tickKinds/, /^memories\.rescueCommand$/, /^guide\.shapeCommand$/, /^cleanup\.csv/, /^brand\.version$/, /^privacy\.policyLabel$/, /\.csvFile$/];

/**
 * Strings that are fixed on purpose and exempt from note and text limits: the independence line is
 * required verbatim (docs/BRAND.md) and is checked for exact wording in copy.test.ts.
 */
const FIXED_PATHS = [/^brand\.nonAffiliation$/];

/** Copy functions whose result is a prefix that is joined to the next text, so it may end with a space. */
const PREFIX_PATHS = [/^common\.stepPrefix\(/];

/** Verbs a button may start with, plus the two noun-only labels the interface already uses. */
const BUTTON_FIRST_WORDS = new Set([
  "Add", "Apply", "Back", "Cancel", "Change", "Choose", "Clear", "Close", "Continue", "Copy", "Delete", "Dismiss", "Done", "Download", "Edit", "Export", "Go", "Import", "Keep", "Lock", "Menu", "Next", "Open", "Pick", "Print", "Read",
  "Remove", "Rescue", "Reset", "Retry", "Review", "Save", "Seal", "Select", "Set", "Show", "Start", "Stop", "Switch", "Try", "Undo", "Unlock", "Update", "Use", "View",
]);

/** The Start page promises a different headline than its menu label ("Start"); every other page title equals its menu label. */
const TITLE_MAY_DIFFER = new Set(["start"]);

const BRITISH = [
  /\b(colour|flavour|favour|honour|neighbour|behaviour|labour|rumour|humour|harbour|savour)\w*/i,
  /\b(centre|metre|litre|theatre|fibre|calibre|sombre)s?\b/i,
  /\b(analyse|analysed|analysing|paralyse|catalyse|breathalyse)\b/i,
  /\b(licence|defence|offence|pretence|practise|practised|practising)\b/i,
  /\b(cancelled|cancelling|labelled|labelling|travelled|travelling|modelled|modelling|signalled|fuelled|counselled|levelled)\b/i,
  /\b(whilst|amongst|learnt|spelt|burnt|dreamt|leapt|towards|grey|greys|greyed|cheque|catalogue|programme|tyre|kerb|plough|ageing|judgement|fulfil|enrol|artefact|aluminium|mum|maths|fortnight)\b/i,
  /\b(unrecognis\w*|tick|ticks|ticked|ticking)\b/i,
];
/** -ise and -isation verbs and nouns, minus the ordinary English words that end that way in the US too. */
const ISE = /\b[a-z]{3,}(?:is(?:e|es|ed|ing|ation|ations|er|ers))\b/i;
const ISE_OK = /^(?:otherwise|promis\w*|exercis\w*|surpris\w*|advis\w*|revis\w*|precis\w*|rais\w*|prais\w*|nois\w*|premis\w*|disguis\w*|enterpris\w*|expertis\w*|franchis\w*|compris\w*|compromis\w*|supervis\w*|devis\w*|improvis\w*|paradis\w*|wis\w*|likewis\w*|aris\w*|ris\w*|demis\w*|merchandis\w*|despis\w*|apprais\w*|treatis\w*|concis\w*|cruis\w*|bruis\w*|pois\w*|clockwis\w*|surmis\w*|excis\w*|televis\w*|promiser\w*|advis\w*|cris\w*|anis\w*|chemis\w*|noise|raiser|praiser)$/i;
const TYPOS = /\b(teh|recieve|recieved|occured|seperate|definately|untill|accomodate|alot|dont|doesnt|isnt|wasnt|couldnt|shouldnt|wouldnt|becuase|wich|thier|adress|enviroment|neccessary|succesful|begining|writting|refered|dosent|cant|wont)\b/i;

/* ------------------------------------------------------------------------------------------ */
/* Text rules (shared by the copy module, the rendered views, and the literals)                */
/* ------------------------------------------------------------------------------------------ */

type Kind = "link" | "menu" | "title" | "heading" | "button" | "note" | "text" | "label" | "code" | "aria" | "fragment";

interface Entry {
  /** Where the string lives: a copy path, or "overview (rendered): button". */
  id: string;
  text: string;
  kind: Kind;
  /** Separate pieces of one block (a label and its value), each checked on its own for capitals. */
  parts?: string[];
  /** The string is built from several parts that were joined by code, so edges may carry a space. */
  prefix?: boolean;
}

const words = (s: string): string[] => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
/** Sentences: split after . ? ! that is followed by a space and a capital letter, digit or opening quote. */
const sentences = (s: string): string[] => s.split(/(?<=[.?!])["\u201D\u2019)]*\s+(?=[A-Z0-9"\u201C(])/).map((x) => x.trim()).filter(Boolean);
const clip = (s: string): string => (s.length > 70 ? `${s.slice(0, 67)}...` : s);

/** Capitalized words that are not the first word of a sentence, a proper word or an acronym. */
export function strayCapitals(text: string, names: readonly string[] = []): string[] {
  const out: string[] = [];
  let boundary = true;
  // A button or page name quoted in a sentence ("Use Copy list", "on the Start page") keeps its capital.
  let body = text;
  for (const n of names) if (n.length > 2) body = body.split(n).join("@@");
  for (const raw of body.split(/\s+/).filter(Boolean)) {
    if (raw.includes("@@")) {
      boundary = /[.?!]["\u201D\u2019)]*$/.test(raw);
      continue;
    }
    const opening = /^[("\u201C\u2018'\[]/.test(raw);
    const core = raw.replace(/^[("\u201C\u2018'\[]+/, "").replace(/[.,;:!?)"\u201D\u2019'\]]+$/, "").replace(/(?:\u2019s|'s)$/, "");
    const acronym = /^[A-Z][A-Z-]+s?$/.test(core) || /^[A-Z]{2,}-[a-z]+$/.test(core) || /^[A-Z]$/.test(core);
    if (core !== "" && /^[A-Z]/.test(core) && !boundary && !opening && !/\d/.test(core) && !PROPER_WORDS.has(core) && !acronym) out.push(core);
    boundary = /[.?!]["\u201D\u2019)]*$/.test(raw) || /^\d+:$/.test(raw);
  }
  return out;
}

/** Everything that is wrong with the characters and punctuation of one string. */
function whitespaceProblems(e: Entry): string[] {
  const t = e.text;
  const out: string[] = [];
  if (!e.prefix && t !== t.trim()) out.push("has a leading or trailing space");
  if (/ {2,}/.test(t)) out.push("has a double space");
  if (/[\t\n\r\f\v]/.test(t)) out.push("has a tab or line break");
  if (/[\u200B-\u200D\u2060\uFEFF\u2000-\u200A\u2028\u2029\u205F\u3000]/.test(t)) out.push("has an unusual space or invisible character");
  return out;
}

function punctuationProblems(e: Entry): string[] {
  const t = e.text;
  const out: string[] = [];
  if (/\s[,.;:!?](?!\.)/.test(t) && !/\s\.\w/.test(t)) out.push("has a space before punctuation");
  if (/[a-z]{2}[,;][A-Za-z]/.test(t)) out.push("has no space after a comma or semicolon");
  if (/[a-z]{2}[.?!][A-Z][a-z]/.test(t)) out.push("has no space after a full stop");
  if (/[a-z]{3,}[.?!] [a-z]/.test(t) && !/[.?!] (alice|x|y|z)\b/.test(t)) out.push("starts a sentence in lowercase");
  if (/(?:[,;:]{2,}|,\.|\.,|:\.|;\.)/.test(t)) out.push("has doubled punctuation");
  if (/\b(\w{2,}) \1\b/i.test(t) && !/\b(that that|had had)\b/i.test(t)) out.push(`repeats a word ("${/\b(\w{2,}) \1\b/i.exec(t)?.[0] ?? ""}")`);
  if (/\betc\b/i.test(t)) out.push('uses "etc."');
  if (/\d %/.test(t)) out.push("has a space before a percent sign");
  if (TYPOS.test(t)) out.push(`has a typo ("${TYPOS.exec(t)?.[0] ?? ""}")`);
  if (/\ba (?=[aeio][a-z]*\b)(?!one\b|once\b|eu|ok\b)/i.test(t.replace(/\bA(?= )/g, "a"))) out.push(`uses "a" before a vowel ("${/\ba ([aeio][a-z]*)/i.exec(t)?.[0] ?? ""}")`);
  if (/\ban (?=[bcdfgjklmnpqrstvwxz][a-z]*\b)(?!hour|honest|honor|heir)/i.test(t)) out.push(`uses "an" before a consonant ("${/\ban ([bcdfgjklmnpqrstvwxz][a-z]*)/i.exec(t)?.[0] ?? ""}")`);
  return out;
}

function quoteProblems(e: Entry): string[] {
  if (e.kind === "code") return [];
  // CSP directives are code inside prose: connect-src 'none'
  const t = e.text.replace(/[a-z-]+-src '[a-z-]+'/g, "").replace(/'[a-z-]+'/g, (m) => (/^'(none|self|blob|data)'$/.test(m) ? "" : m));
  const straight = /['"]/.test(t);
  const curly = /[\u2018\u2019\u201C\u201D]/.test(e.text);
  const out: string[] = [];
  if (straight) out.push("uses a straight quote or apostrophe; use curly ones in text");
  if (straight && curly) out.push("mixes straight and curly quotes");
  return out;
}

function americanProblems(e: Entry): string[] {
  const out: string[] = [];
  for (const re of BRITISH) {
    const m = re.exec(e.text);
    if (m) out.push(`uses British English ("${m[0]}")`);
  }
  for (const m of e.text.matchAll(new RegExp(ISE.source, "gi"))) if (!ISE_OK.test(m[0])) out.push(`uses an -ise spelling ("${m[0]}")`);
  return out;
}

function capitalizationProblems(e: Entry): string[] {
  if (e.kind === "code") return [];
  const out: string[] = [];
  const stray = (e.parts ?? [e.text]).flatMap((part) => strayCapitals(part, NAMED));
  if (stray.length > 0) out.push(`has capitals that are not sentence case (${[...new Set(stray)].join(", ")})`);
  for (const w of e.text.match(/\b[A-Z]{4,}\b/g) ?? []) if (!ACRONYMS.has(w) && !ACRONYMS.has(w.replace(/\d+$/, ""))) out.push(`has an all-caps word (${w})`);
  if (/^[a-z]/.test(e.text.trim()) && e.kind !== "aria" && e.kind !== "fragment" && !e.prefix && !/^(alice|x|y|z)\b/.test(e.text.trim())) out.push("starts with a lowercase letter");
  return out;
}

/** A leading "Note." or "Warning." label is reported by its own test, so it is not counted as a sentence here. */
const withoutLabel = (s: string): string => s.replace(/^(Note|Warning|Error|Done)[.:]\s+/, "");

function lengthProblems(e: Entry): string[] {
  const out: string[] = [];
  const w = words(withoutLabel(e.text)).length;
  const ss = sentences(withoutLabel(e.text));
  switch (e.kind) {
    case "menu":
      if (e.text.length > LIMITS.menuChars) out.push(`menu label is ${e.text.length} characters, the limit is ${LIMITS.menuChars} (it must stay on one line)`);
      if (w > LIMITS.menuWords) out.push(`menu label is ${w} words, the limit is ${LIMITS.menuWords}`);
      if (/[.!?:,;]$/.test(e.text)) out.push("menu label ends with punctuation");
      break;
    case "title":
    case "heading":
      if (w > LIMITS.headingWords) out.push(`heading is ${w} words, the limit is ${LIMITS.headingWords}`);
      if (/\.$/.test(e.text)) out.push("heading ends with a full stop");
      break;
    case "link":
      if (w > LIMITS.buttonWords) out.push(`link label is ${w} words, the limit is ${LIMITS.buttonWords}`);
      if (/[.!?:;,]/.test(e.text)) out.push("link label has punctuation: it is a short noun phrase or a verb and a noun, never a sentence");
      break;
    case "button":
      if (w > LIMITS.buttonWords) out.push(`button label is ${w} words, the limit is ${LIMITS.buttonWords}: a verb plus a short noun`);
      if (e.text.length > LIMITS.buttonChars) out.push(`button label is ${e.text.length} characters, the limit is ${LIMITS.buttonChars}`);
      if (/[.!?:;,]/.test(e.text)) out.push("button label has punctuation: it is a verb and a noun, never a sentence");
      if (!BUTTON_FIRST_WORDS.has(e.text.trim().split(/\s+/)[0] ?? "")) out.push(`button label does not start with a verb ("${e.text.trim().split(/\s+/)[0] ?? ""}")`);
      break;
    case "note":
      if (w > LIMITS.noteWords) out.push(`note is ${w} words, the limit is ${LIMITS.noteWords}`);
      if (ss.length > LIMITS.noteSentences) out.push(`note is ${ss.length} sentences, the limit is ${LIMITS.noteSentences}`);
      for (const s of ss) if (words(s).length > LIMITS.noteSentenceWords) out.push(`note sentence is ${words(s).length} words, the limit is ${LIMITS.noteSentenceWords}: "${clip(s)}"`);
      if (w >= 5 && !/[.?:]["\u201D\u2019)]?$/.test(e.text.trim())) out.push("note has no final period");
      break;
    case "text":
      if (w > LIMITS.textWords) out.push(`text is ${w} words, the limit is ${LIMITS.textWords}`);
      if (ss.length > LIMITS.textSentences) out.push(`text is ${ss.length} sentences, the limit is ${LIMITS.textSentences}`);
      for (const s of ss) if (words(s).length > LIMITS.textSentenceWords) out.push(`sentence is ${words(s).length} words, the limit is ${LIMITS.textSentenceWords}: "${clip(s)}"`);
      if (w >= 7 && !/[.?:]["\u201D\u2019)]?$/.test(e.text.trim())) out.push("sentence has no final period");
      break;
    case "label":
      if (w > LIMITS.labelWords) out.push(`label is ${w} words, the limit is ${LIMITS.labelWords}`);
      break;
    default:
  }
  return out;
}

const RULES: [name: string, fn: (e: Entry) => string[], skip?: (e: Entry) => boolean][] = [
  ["whitespace", whitespaceProblems],
  ["punctuation and grammar", punctuationProblems, (e) => e.kind === "code"],
  ["typographic quotes", quoteProblems],
  ["American English", americanProblems],
  ["capitalization", capitalizationProblems],
  ["maximum lengths", lengthProblems, (e) => e.kind === "code" || e.kind === "aria"],
];

function lint(entries: Entry[], rule: (typeof RULES)[number]): string[] {
  const [, fn, skip] = rule;
  const out: string[] = [];
  for (const e of entries) {
    if (skip?.(e)) continue;
    if (FIXED_PATHS.some((p) => p.test(e.id))) continue;
    for (const problem of fn(e)) out.push(`${e.id}: "${clip(e.text)}" ${problem}`);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Collecting the copy module                                                                  */
/* ------------------------------------------------------------------------------------------ */

/** Sample values for copy functions: counts, a username, a date, sizes. Results that come out as NaN or undefined are dropped. */
const SAMPLE_ARGS: unknown[][] = [
  [1], [2], [0], [5], [true], [false], ["alice"], ["alice", 3], [0, 0], [1, 1], [3, 12], [12, 12], [3, true], [1, false], [0, false], [3, 12, 5], [1, 2, 3], [0, 3, 0.5], [2, 3],
  ["1.2 GB", "5 GB", "24%"], ["Mar 2027"], ["Nov 6, 2026"], ["0.1.0"],
];

function classify(keys: string[], text = ""): Kind {
  const last = [...keys].reverse().find((k) => !/^[\[(]/.test(k)) ?? "";
  const full = keys.join(".");
  if (CODE_PATHS.some((p) => p.test(full))) return "code";
  // Pieces that code joins to a number or another string ("3" + "people to review"): they start in lowercase on purpose.
  if (/^(unit[A-Z]\w*|confidenceSuffix|dropAlt)$/.test(last)) return "fragment";
  if (keys[0] === "routes" && last === "label") return "menu";
  if (keys[0] === "routes" && last === "title") return "title";
  if (keys[0] === "shell" && /^(navFindings|navMore|mainNav)$/.test(last)) return "menu";
  if (keys[0] === "shell" && last === "menu") return "button";
  if (last === "skipLink") return "label";
  // Table rows: the first cell names the item, the others explain it.
  if (keys.some((k) => /[Rr]ows$/.test(k)) && /^\[\d+\]$/.test(keys[keys.length - 1] ?? "") && keys[keys.length - 1] !== "[0]") return "text";
  // Status and count strings that code builds ("Part 2 of 3: reading, 50% done"): short labels, not sentences.
  if (/^(reading|readingSample|readingPercent|progressText|meterText|listCount|summary|latestExport|versionLabel|protectedNote|changeDisappeared|csvFile)$/.test(last)) return "label";
  if (/For$/.test(last) || /^(copyUsername|copiedUsername|openInSnapchatFor|meterLabel|progressLabel)$/.test(last)) return "aria";
  if (/(Heading|Title)$/.test(last)) return "heading";
  if (/Header$/.test(last)) return "label";
  if (/Link$/.test(last)) return "link";
  if (/(Button|Action|Cancel|Confirm)$/.test(last) || BUTTON_KEYS.has(full.replace(/\(.*$/, ""))) return "button";
  if (keys[0] === "vaultMessages" || keys[0] === "passphraseHint") return last === "label" ? "label" : "note";
  if (/(Note|Notice|Warning|Inference|Help|Hint|Error|Failed|Announce|Banner)$/i.test(last)) return "note";
  if (/Body$/.test(last) && !TEXT_BODIES.has(last)) return "note";
  if (NOTE_KEYS.has(last)) return "note";
  if (/^(lead|promiseLead|promiseMore)$/.test(last) || TEXT_BODIES.has(last)) return "text";
  return words(text).length >= 7 ? "text" : "label";
}

/** Copy keys whose strings are buttons or button-like links, by name, where the key itself does not say so. */
const BUTTON_KEYS = new Set([
  "common.copy", "common.openInSnapchat", "common.keep", "common.unkeep", "common.openSettings", "common.openGuide", "common.addExport", "common.addAnotherExport",
  "start.choose", "start.sampleButton", "cleanup.saveList", "cleanup.copyList", "cleanup.done", "cleanup.clearChecks", "memories.capUpdate", "memories.copyCommand",
  "shell.clearSample", "shell.lockNow", "overview.open", "overview.emptyAction", "settings.setButton", "settings.changeButton", "settings.deleteButton", "settings.deleteCancel",
]);
/** Page text that is longer than a note by design (an explainer paragraph). */
const TEXT_BODIES = new Set(["exportBody", "addBody", "rescueBody", "rangeBody", "shapeBody", "storingBody", "workerBody", "aboutBody", "licensesBody", "keepBody", "sealBody", "promiseMore"]);
/** Notes whose key does not say "note" or "help". */
const NOTE_KEYS = new Set([
  "kept", "unkept", "unknownSizes", "overCap", "projection", "noProjection", "noSizes", "pairingNone", "pairingLinksEmpty", "pairingTodo", "pairingOverlays", "pairingSummary",
  "rescueNetwork", "protectedByChats", "noChatProtection", "laterPartsOnly", "skippedFiles", "notAdded", "rejected", "notZip", "readFailed", "unlockSkip", "healthFromLedger",
  "oneSnapshot", "needTwoKeep", "noChatsLedger", "ledgerOnly", "noMatch", "saveFailed", "protectedBody", "sampleBanner", "sampleLabel", "removalWarning", "storageSession", "storageLocked",
  "storageUnlocked", "storageUnsupported", "mismatch", "tooShort", "deleteFailed", "healthGood", "readDone", "sampleLoaded", "sampleBody", "unlockBody", "networkOk", "networkUnknown",
  "copyFailed", "schemaNote", "pairingWhy", "rescueCommandLabel", "healthIntro", "capError", "countError", "countHelp", "capHelp",
]);

function collectCopy(): Entry[] {
  const out: Entry[] = [];
  const seen = new Set<string>();
  const add = (keys: string[], text: string, suffix = ""): void => {
    if (text.trim() === "" && text === "") return;
    const id = keys.join(".").replace(/\.\[/g, "[") + suffix;
    const key = `${classify(keys, text)}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, text, kind: classify(keys, text), prefix: PREFIX_PATHS.some((p) => p.test(id)) });
  };
  const walk = (value: unknown, keys: string[], suffix: string): void => {
    if (typeof value === "string") add(keys, value, suffix);
    else if (typeof value === "function") {
      for (const args of SAMPLE_ARGS) {
        try {
          const result = (value as (...a: unknown[]) => unknown)(...args);
          if (typeof result === "string" && /NaN|undefined|\[object|null|\b(true|false)\b/.test(result)) continue;
          walk(result, keys, `(${args.map((a) => JSON.stringify(a)).join(", ")})`);
        } catch {
          // A function that rejects these sample arguments contributes nothing for them.
        }
      }
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...keys, `[${i}]`], suffix));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, [...keys, k], suffix);
  };
  for (const [name, value] of Object.entries(copy)) walk(value, [name], "");
  return out;
}

const copyEntries = collectCopy();
/** Names of buttons and pages that sentences may quote with their capital letter ("Use Copy list", "on the Start page"). */
const NAMED: string[] = copyEntries
  .filter((e) => e.kind === "button" || e.kind === "menu" || e.kind === "title")
  .map((e) => e.text)
  .sort((a, b) => b.length - a.length);

/* ------------------------------------------------------------------------------------------ */
/* Rendering the views in the fake DOM                                                         */
/* ------------------------------------------------------------------------------------------ */

const views: Record<string, View> = {};
let sampleState: State;
let emptyState: State;
let sampleCodes: string[] = [];
const ALL_VIEWS = ["start", "overview", "disappeared", "requests", "quiet", "cleanup", "memories", "guide", "privacy", "settings"] as const;

beforeAll(async () => {
  installFakeDom();
  const sample = await buildSampleWorkspace();
  sampleCodes = sample.issues.map((i) => i.code);
  sampleState = { ...initialState(), sample };
  emptyState = initialState();
  const load = async <T>(file: string): Promise<T> => (await import(`../src/views/${file}.ts`)) as T;
  const [ov, fi, cl, me, gu, pr, se, st] = await Promise.all([
    load<{ overviewView: View }>("overview"),
    load<{ disappearedView: View; requestsView: View; quietView: View }>("findings"),
    load<{ cleanupView: View }>("cleanup"),
    load<{ memoriesView: View }>("memories"),
    load<{ guideView: View }>("guide"),
    load<{ privacyView: View }>("privacy"),
    load<{ settingsView: View }>("settings"),
    load<{ startView: View }>("start"),
  ]);
  Object.assign(views, {
    overview: ov.overviewView,
    disappeared: fi.disappearedView,
    requests: fi.requestsView,
    quiet: fi.quietView,
    cleanup: cl.cleanupView,
    memories: me.memoriesView,
    guide: gu.guideView,
    privacy: pr.privacyView,
    settings: se.settingsView,
    start: st.startView,
  });
  // Building the sample workspace does real PBKDF2 and zip work, so under a loaded full run it can pass the default 10 s hook limit.
}, 120_000);

function render(name: string, state: State): FakeElement {
  const view = views[name];
  if (!view) throw new Error(`no view ${name}`);
  const store = createStore(state);
  return runInScope(new Scope(true), () => view({ store, actions: {} as Actions })) as unknown as FakeElement;
}

const BLOCK_TAGS = new Set(["p", "div", "ul", "ol", "li", "section", "table", "thead", "tbody", "tr", "td", "th", "details", "summary", "header", "footer", "main", "nav", "h1", "h2", "h3", "h4", "dl", "dt", "dd", "form", "fieldset", "legend", "caption", "pre", "button", "label", "a", "select", "option"]);
const hasClass = (el: FakeElement, c: string): boolean => el.classList.contains(c);
const isInline = (el: FakeElement): boolean => !BLOCK_TAGS.has(el.tagName) || (el.tagName === "a" && !hasClass(el, "btn") && !hasClass(el, "card-link"));
/** Text of an element; sibling elements are separated by a space, because they are separate boxes on screen. */
function rawText(n: FakeNode): string {
  if (n instanceof FakeText) return n.data;
  if (!(n instanceof FakeElement) || n.tagName === "svg") return "";
  let out = "";
  let prevWasElement = false;
  for (const c of n.childNodes) {
    const isEl = c instanceof FakeElement && c.tagName !== "svg";
    if (isEl && prevWasElement) out += " ";
    out += rawText(c);
    prevWasElement = isEl;
  }
  return out;
}
const textOf = (el: FakeElement): string => rawText(el).replace(/\s+/g, " ").trim();
/** When a block holds only elements with text and no loose text, each is its own piece (a label and its value). */
function partsOf(el: FakeElement): string[] {
  const kids = el.childNodes.filter((c): c is FakeElement => c instanceof FakeElement && textOf(c) !== "");
  const loose = el.childNodes.some((c) => c instanceof FakeText && c.data.trim() !== "");
  return !loose && kids.length >= 2 ? kids.map(textOf) : [textOf(el)];
}
const ancestors = (el: FakeElement): FakeElement[] => {
  const out: FakeElement[] = [];
  for (let n: FakeNode | null = el.parentNode; n; n = n.parentNode) if (n instanceof FakeElement) out.push(n);
  return out;
};

/** The leaf-most text blocks of a rendered view: a paragraph, a list item, a cell, a button. */
function textBlocks(root: FakeElement): FakeElement[] {
  return root.descendants().filter((el) => {
    if (el.tagName === "svg" || el.tagName === "use" || el.tagName === "option" || isInline(el)) return false;
    if (el.childNodes.some((c) => c instanceof FakeElement && !isInline(c) && c.tagName !== "button" && c.tagName !== "label")) {
      // a block that also holds loose text of its own is still a text block for that text
      return el.childNodes.some((c) => c instanceof FakeText && c.data.trim() !== "");
    }
    return textOf(el) !== "";
  });
}

function renderedKind(el: FakeElement): Kind {
  const tag = el.tagName;
  const inNotice = (): boolean => [el, ...ancestors(el)].some((a) => hasClass(a, "notice") || hasClass(a, "banner") || a.getAttribute("role") === "note" || a.getAttribute("role") === "alert" || a.tagName === "dialog" || hasClass(a, "confirm"));
  if (tag === "pre" || tag === "code" || hasClass(el, "command")) return "code";
  const choice = el.hasAttribute("aria-pressed") || el.hasAttribute("aria-checked") || /^(tab|radio)$/.test(el.getAttribute("role") ?? "") || ancestors(el).some((a) => /segmented/.test(a.className));
  if (tag === "button" && choice) return "label";
  if (tag === "button" || (tag === "a" && hasClass(el, "btn"))) return "button";
  if (/^h[1-4]$/.test(tag) || hasClass(el, "section-title") || hasClass(el, "empty-title") || hasClass(el, "card-title")) return "heading";
  if (tag === "th" || tag === "caption" || tag === "legend" || tag === "label" || tag === "summary" || tag === "dt" || hasClass(el, "stat-label") || hasClass(el, "chip") || hasClass(el, "badge")) return "label";
  if (inNotice() || hasClass(el, "empty-body")) return "note";
  if (tag === "p" || tag === "li" || tag === "dd" || tag === "td") return /[.?!](\s|$)/.test(textOf(el)) ? "text" : /^[a-z]/.test(textOf(el)) ? "fragment" : "label";
  return "label";
}

interface RenderedView {
  name: string;
  state: "sample" | "empty";
  root: FakeElement;
  entries: Entry[];
}

function renderAll(): RenderedView[] {
  const out: RenderedView[] = [];
  for (const [state, label] of [[sampleState, "sample"], [emptyState, "empty"]] as const) {
    for (const name of ALL_VIEWS) {
      const root = render(name, state);
      const entries: Entry[] = [];
      for (const el of textBlocks(root)) {
        const text = textOf(el);
        if (text === "" || /^\d[\d,.%]*$/.test(text)) continue;
        const userText = el.descendants().some((d) => hasClass(d, "username") || d.tagName === "code");
        const parts = partsOf(el);
        entries.push({ id: `${name} (${label}): ${renderedKind(el)} <${el.tagName}${el.className ? `.${el.className.split(" ")[0]}` : ""}>`, text, kind: userText ? "code" : renderedKind(el), parts });
      }
      for (const el of root.descendants()) for (const attr of ["aria-label", "title"]) {
        const v = el.getAttribute(attr);
        if (v) entries.push({ id: `${name} (${label}): ${attr} of <${el.tagName}>`, text: v, kind: "aria" });
      }
      out.push({ name, state: label, root, entries });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Tests on the copy module                                                                    */
/* ------------------------------------------------------------------------------------------ */

describe("copy module: the real strings", () => {
  it("has strings of every kind to check", () => {
    expect(copyEntries.length).toBeGreaterThan(250);
    for (const kind of ["menu", "title", "heading", "button", "note", "text", "label"] as const) expect(copyEntries.filter((e) => e.kind === kind).length, kind).toBeGreaterThan(2);
  });

  for (const rule of RULES) {
    it(`${rule[0]}: every string passes`, () => {
      expect(lint(copyEntries, rule)).toEqual([]);
    });
  }

  it("keeps menu labels short and page titles consistent with them", () => {
    const bad: string[] = [];
    for (const [id, route] of Object.entries(copy.routes)) {
      if (route.label.length > LIMITS.menuChars) bad.push(`routes.${id}.label: "${route.label}" is ${route.label.length} characters, the limit is ${LIMITS.menuChars}`);
      if (!TITLE_MAY_DIFFER.has(id) && route.title !== route.label) bad.push(`routes.${id}: title "${route.title}" differs from menu label "${route.label}"`);
    }
    expect(bad).toEqual([]);
  });

  it("writes buttons as a verb plus a short noun, never a sentence", () => {
    expect(lint(copyEntries.filter((e) => e.kind === "button"), RULES[5] as (typeof RULES)[number])).toEqual([]);
  });

  it("names the theme toggle by what pressing it does", () => {
    const all = copyEntries.map((e) => e.text);
    expect(all, "a string for the light switch").toContain("Switch to light theme");
    expect(all, "a string for the dark switch").toContain("Switch to dark theme");
  });

  it("does not show the old session badge text in the shell strings that name the header", () => {
    // The badge moves to the Start session card and Settings; the header strings must not carry it any more.
    const shellStrings = copyEntries.filter((e) => e.id.startsWith("shell.")).map((e) => `${e.id}: ${e.text}`);
    expect(shellStrings.filter((s) => /Session only: nothing is saved/.test(s))).toEqual([]);
  });

  it("writes stat labels that fit one line", () => {
    const rendered = renderAll();
    const bad: string[] = [];
    for (const v of rendered) for (const el of v.root.descendants()) {
      if (!hasClass(el, "stat-label") && !(el.tagName === "dt" && ancestors(el).some((a) => hasClass(a, "stats")))) continue;
      const t = textOf(el);
      if (t.length > LIMITS.statLabelChars) bad.push(`${v.name} (${v.state}): stat label "${t}" is ${t.length} characters, the limit is ${LIMITS.statLabelChars}`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Tests on what the views render                                                              */
/* ------------------------------------------------------------------------------------------ */

describe("rendered views: the words people actually see", () => {
  let rendered: RenderedView[] = [];
  beforeAll(() => {
    rendered = renderAll();
  });

  it("renders text for every view in both states", () => {
    expect(rendered.length).toBe(ALL_VIEWS.length * 2);
    for (const v of rendered) expect(v.entries.length, `${v.name} (${v.state})`).toBeGreaterThan(2);
  });

  for (const rule of RULES) {
    it(`${rule[0]}: every rendered string passes (including notices that come from core)`, () => {
      const all = new Map<string, Entry>();
      for (const v of rendered) for (const e of v.entries) all.set(`${e.kind}|${e.text}`, e);
      expect(lint([...all.values()], rule)).toEqual([]);
    });
  }

  it("shows no sentence of more than 8 words twice on one rendered view", () => {
    const bad: string[] = [];
    for (const v of rendered) {
      const seen = new Map<string, number>();
      for (const el of textBlocks(v.root)) {
        if (ancestors(el).some((a) => hasClass(a, "candidate") || hasClass(a, "rows"))) continue; // one row per person repeats its template on purpose
        for (const s of sentences(textOf(el))) {
          const n = s.toLowerCase().replace(/[.?!]+$/, "");
          if (words(n).length > 8) seen.set(n, (seen.get(n) ?? 0) + 1);
        }
      }
      for (const [s, n] of seen) if (n > 1) bad.push(`${v.name} (${v.state}): "${clip(s)}" appears ${n} times`);
    }
    expect(bad).toEqual([]);
  });

  it("shows no two notes that repeat the same information on one view", () => {
    const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "it", "this", "that", "for", "on", "with", "you", "your", "snappy", "not", "no", "be", "can", "may", "as"]);
    const bag = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== "" && !STOP.has(w)));
    const bad: string[] = [];
    for (const v of rendered) {
      const notes = v.root.descendants().filter((el) => hasClass(el, "notice") || hasClass(el, "banner") || el.getAttribute("role") === "note").map(textOf);
      for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) {
        const a = bag(notes[i] ?? "");
        const b = bag(notes[j] ?? "");
        if (a.size < 4 || b.size < 4) continue;
        const shared = [...a].filter((w) => b.has(w)).length;
        if (shared / (a.size + b.size - shared) >= 0.6) bad.push(`${v.name} (${v.state}): "${clip(notes[i] ?? "")}" and "${clip(notes[j] ?? "")}" repeat each other`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("starts no notice with a visible Note. or Warning. label (the icon says it; a screen-reader label is fine)", () => {
    const bad: string[] = [];
    for (const v of rendered) {
      for (const n of v.root.descendants().filter((el) => hasClass(el, "notice"))) {
        for (const el of n.descendants()) {
          if (ancestors(el).some((a) => hasClass(a, "sr-only")) || hasClass(el, "sr-only")) continue;
          if (/^(Note|Warning|Error|Done|Info)[.:]?\s*$/.test(textOf(el))) bad.push(`${v.name} (${v.state}): notice "${clip(textOf(n))}" starts with the visible label "${textOf(el)}"`);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("shows no developer code outside a collapsed Details area inside the notice", () => {
    const bad: string[] = [];
    const codePattern = sampleCodes.length > 0 ? new RegExp(`\\b(${[...new Set(sampleCodes)].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`) : null;
    for (const v of rendered) {
      for (const el of v.root.descendants()) {
        const own = el.childNodes.filter((c): c is FakeText => c instanceof FakeText).map((c) => c.data).join(" ");
        const shows = /\bCode:\s/.test(own) || (codePattern?.test(own) ?? false) || (el.tagName === "code" && codePattern !== null && codePattern.test(el.textContent));
        if (!shows) continue;
        const notice = ancestors(el).find((a) => hasClass(a, "notice"));
        const details = ancestors(el).find((a) => a.tagName === "details" && (!notice || notice.contains(a)));
        const insideNoticeDetails = notice !== undefined && details !== undefined && notice.contains(details) && !details.open;
        if (!insideNoticeDetails) bad.push(`${v.name} (${v.state}): shows a developer code to people: "${clip(el.textContent)}"`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("keeps stat labels on one line and shows each fact once", () => {
    const bad: string[] = [];
    for (const v of rendered) {
      const cards = v.root.descendants().filter((el) => hasClass(el, "stat") || hasClass(el, "stat-card"));
      const seen: { label: string; value: string }[] = [];
      for (const c of cards) {
        const label = textOf(c.descendants().find((d) => hasClass(d, "stat-label") || d.tagName === "dt") ?? c);
        const value = textOf(c.descendants().find((d) => hasClass(d, "stat-value") || d.tagName === "dd") ?? c);
        if (label.length > LIMITS.statLabelChars) bad.push(`${v.name} (${v.state}): stat label "${label}" is ${label.length} characters, the limit is ${LIMITS.statLabelChars}`);
        const stem = (w: string): string => w.replace(/(ies|y|s)$/, "");
        for (const prev of seen) {
          if (!/\d{2,}/.test(value) || prev.value !== value) continue;
          const a = new Set(prev.label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).map(stem));
          if (label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).some((w) => a.has(stem(w)))) bad.push(`${v.name} (${v.state}): two cards show ${value}: "${prev.label}" and "${label}"`);
        }
        seen.push({ label, value });
      }
      // a sentence that repeats a count a card already shows
      for (const s of seen) {
        if (!/^\d[\d,]+$/.test(s.value)) continue;
        for (const el of textBlocks(v.root)) {
          if (ancestors(el).some((a) => hasClass(a, "stat") || hasClass(a, "stat-card")) || el.tagName === "button") continue;
          const t = textOf(el);
          if (words(t).length >= 4 && new RegExp(`(^|[^\\d,.])${s.value.replace(/,/g, ",")}([^\\d]|$)`).test(t)) bad.push(`${v.name} (${v.state}): "${clip(t)}" repeats the ${s.value} that the "${s.label}" card shows`);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Source literals, the HTML shell and the stylesheet                                          */
/* ------------------------------------------------------------------------------------------ */

function walkFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe("literals in the views and components", () => {
  const files = walkFiles(srcDir).filter((f) => (/[\\/](views|components)[\\/].*\.ts$/.test(f) || /[\\/]main\.ts$/.test(f)) && !/[\\/]copy\.ts$/.test(f));

  it("hold no sentence-like text of their own that breaks the text rules", () => {
    const bad: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
      for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
        const text = (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, "x");
        if (!/^[A-Z][A-Za-z]*(?: [A-Za-z]+)+[.?!:]?$/.test(text.split(/[.?!] /)[0] ?? "")) continue; // sentences only, not class names, selectors or ids
        const entry: Entry = { id: `${path.basename(file)} literal`, text, kind: "text" };
        for (const rule of [whitespaceProblems, punctuationProblems, quoteProblems, americanProblems]) for (const p of rule(entry)) bad.push(`${entry.id}: "${clip(text)}" ${p}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("the HTML shell", () => {
  const html = readFileSync(path.join(srcDir, "index.html"), "utf8");

  it("has noscript and description text that follows the rules", () => {
    const texts: Entry[] = [];
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? "";
    texts.push({ id: "index.html noscript", text: noscript.replace(/<[^>]+>/g, "").trim(), kind: "note" });
    texts.push({ id: "index.html description", text: /name="description" content="([^"]*)"/.exec(html)?.[1] ?? "", kind: "note" });
    const bad = texts.flatMap((e) => [whitespaceProblems, punctuationProblems, quoteProblems, americanProblems, capitalizationProblems, lengthProblems].flatMap((r) => r(e).map((p) => `${e.id}: "${clip(e.text)}" ${p}`)));
    expect(bad).toEqual([]);
  });
});

describe("stylesheet: notices keep the normal text color", () => {
  it("sets no status color on notice body text (only the icon, label, border and bar carry it)", () => {
    const css = readFileSync(path.join(srcDir, "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const bad: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (m[1] ?? "").trim().replace(/\s+/g, " ");
      const decls = m[2] ?? "";
      if (!/\.notice/.test(selector) || /\.icon|label|strong|::before|::after|\.bar|svg|badge/.test(selector)) continue;
      const color = /(?:^|[;\s])color:\s*([^;]+)/.exec(decls)?.[1]?.trim();
      if (color && /-fg\)|--(info|danger|warning|success|error)/.test(color)) bad.push(`${selector} { color: ${color} }`);
    }
    expect(bad).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Stale names                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** "snappy" used as the command, or an old package name. The command and package are snappy-export. */
const STALE = [/\bnpm run (?!snappy-export\b)[\w:.-]*snappy[\w:.-]*/g, /\bsnappy (?:inspect|analyze|memories|keep|unkeep|ledger|demo|help)\b/g, /\bsnappy-cli\b/gi, /\bsnappy_export\b/g, /\bnpx snappy\b/g];
const stale = (text: string): string[] => STALE.flatMap((re) => [...text.matchAll(re)].map((m) => m[0]));

describe("stale names", () => {
  it("says snappy-export in every copy string", () => {
    expect(copyEntries.flatMap((e) => stale(e.text).map((s) => `${e.id}: "${s}"`))).toEqual([]);
  });

  it("says snappy-export in every rendered view", () => {
    const bad: string[] = [];
    for (const v of renderAllCached()) for (const e of v.entries) for (const s of stale(e.text)) bad.push(`${v.name} (${v.state}): "${s}"`);
    expect([...new Set(bad)]).toEqual([]);
  });

  it("says snappy-export in the source files and the page shell", () => {
    const bad: string[] = [];
    for (const file of walkFiles(srcDir).filter((f) => /\.(ts|html|css)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      for (const s of stale(text)) bad.push(`${path.relative(dashboardRoot, file)}: "${s}"`);
    }
    expect(bad).toEqual([]);
  });

  it("ships a built page that matches its sources, with no stale command in it", async () => {
    const dist = path.join(dashboardRoot, "dist", "index.html");
    if (!existsSync(dist)) return; // nothing is built yet; the build test covers building
    const tmp = mkdtempSync(path.join(tmpdir(), "snappy-lint-"));
    try {
      const build = (await import(pathToFileURL(path.join(dashboardRoot, "build.mjs")).href)) as { buildDashboard: (o: { outDir: string }) => Promise<{ file: string }> };
      const fresh = readFileSync((await build.buildDashboard({ outDir: path.join(tmp, "fresh") })).file, "utf8");
      const shipped = readFileSync(dist, "utf8");
      expect(stale(shipped), "stale command in apps/dashboard/dist/index.html").toEqual([]);
      expect(shipped === fresh, "apps/dashboard/dist/index.html is older than the sources: run npm run build:dashboard").toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});

let renderedCache: RenderedView[] | null = null;
function renderAllCached(): RenderedView[] {
  renderedCache ??= renderAll();
  return renderedCache;
}

/* ------------------------------------------------------------------------------------------ */
/* The rules themselves                                                                        */
/* ------------------------------------------------------------------------------------------ */

describe("the lint rules catch what they should", () => {
  const e = (text: string, kind: Kind = "text"): Entry => ({ id: "x", text, kind });
  const problems = (text: string, kind: Kind = "text"): string => RULES.flatMap(([, fn, skip]) => (skip?.(e(text, kind)) ? [] : fn(e(text, kind)))).join(" | ");

  it("flags capitalization", () => {
    expect(problems("Unaccepted Requests", "menu")).toMatch(/capitals/);
    expect(problems("Copy List", "button")).toMatch(/capitals/);
    expect(problems("Snappy reads your export in Snapchat, then Settings.", "note")).not.toMatch(/capitals/);
    expect(problems("Open in Snapchat", "button")).not.toMatch(/capitals/);
  });
  it("flags punctuation and grammar", () => {
    expect(problems("Two  spaces here.")).toMatch(/double space/);
    expect(problems("Trailing space. ")).toMatch(/trailing/);
    expect(problems("A space before , a comma.")).toMatch(/before punctuation/);
    expect(problems("It is the the best way.")).toMatch(/repeats a word/);
    expect(problems("Tidy lists, files, etc. are sorted.")).toMatch(/etc/);
    expect(problems("This ends. and then starts low.")).toMatch(/lowercase/);
  });
  it("flags straight and mixed quotes, but not code", () => {
    expect(problems("Snapchat's cap.")).toMatch(/straight/);
    expect(problems("Snapchat\u2019s cap and \"this\".")).toMatch(/mixes/);
    expect(problems("Snapchat\u2019s cap.")).not.toMatch(/straight|mixes/);
    expect(problems("npm run snappy-export -- inspect \"a\"", "code")).toBe("");
  });
  it("flags British spellings and -ise endings", () => {
    expect(problems("The colour of the centre.")).toMatch(/British/);
    expect(problems("Organise your files whilst you wait.")).toMatch(/-ise|British/);
    expect(problems("Otherwise, promise to exercise.")).not.toMatch(/-ise/);
  });
  it("flags lengths", () => {
    expect(problems("Requests that nobody has accepted yet", "menu")).toMatch(/limit/);
    expect(problems("Copy the whole list now", "button")).toMatch(/limit|verb/);
    expect(problems("Yes, delete all data", "button")).toMatch(/punctuation|limit/);
    expect(problems(`${"word ".repeat(26)}end.`, "note")).toMatch(/limit/);
    expect(problems("A short note that ends well.", "note")).toBe("");
    expect(problems("A short note without a stop", "note")).toMatch(/final period/);
  });
});
