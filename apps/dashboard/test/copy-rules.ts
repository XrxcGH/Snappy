/**
 * The copy lint's rules and helpers, shared by the dashboard's copy lint (copy-lint.test.ts, which lints copy.ts and the
 * views) and by the tools' lint (tools/contract.test.ts, which lints every folder under src/tools). The limits, the
 * allow-lists and the classification of strings by key name live here once, so a tool is held to exactly the rules
 * every other page is held to.
 */
import { readdirSync } from "node:fs";
import { FakeElement, FakeText } from "./fake-dom.ts";
import type { FakeNode } from "./fake-dom.ts";

/**
 * The words of a feature track live in their own src/copy-<name>.ts file next to copy.ts. Every lint that reads copy.ts
 * reads these too, through this one loader, so a new file is checked everywhere the moment it exists.
 */
export async function loadCopyModules(srcDir: string): Promise<Record<string, unknown>[]> {
  const names = readdirSync(srcDir).flatMap((f) => /^(copy-[a-z-]+)\.ts$/.exec(f)?.[1] ?? []);
  return Promise.all(names.map((name) => import(`../src/${name}.ts`) as Promise<Record<string, unknown>>));
}

/** The names of buttons and pages that sentences may quote with their capital letter. Set by the test that owns the copy. */
let NAMED: readonly string[] = [];
export function useNames(names: readonly string[]): void {
  NAMED = names;
}

/* ------------------------------------------------------------------------------------------ */
/* Limits and allow-lists                                                                      */
/* ------------------------------------------------------------------------------------------ */

export const LIMITS = {
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
export const PROPER_WORDS = new Set([
  "Snappy", "Snapchat", "Microsoft", "Windows", "Linux", "WebKitGTK", "Mac", "Safari", "GitHub", "JavaScript", "May", "Snap", "Snaps", "Memories", "Memory", "Spotlight", "Map", "Settings", "My", "Data", "All", "Time", "AI", "Inc", "Profile", "Friends", "User", "Chat", "Export",
  "January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec",
]);

/** All-capital words that are acronyms, units or protocol names. */
export const ACRONYMS = new Set(["JSON", "HTML", "ZIP", "CSV", "UTF", "AES", "GCM", "PBKDF", "SHA", "CSP", "URL", "USB", "PDF", "NO", "OK"]);

/**
 * Strings that are code, commands or file names rather than prose. They keep straight quotes and
 * are exempt from the prose rules (but not from the stale-name rule).
 */
export const CODE_PATHS = [/^guide\.tickKinds/, /^cleanup\.csv/, /^brand\.version$/, /^privacy\.policyLabel$/, /\.csvFile$/];

/**
 * Strings that are fixed on purpose and exempt from note and text limits: the independence line is
 * required verbatim (docs/BRAND.md) and is checked for exact wording in copy.test.ts.
 */
export const FIXED_PATHS = [/^brand\.nonAffiliation$/];

/** Copy functions whose result is a prefix that is joined to the next text, so it may end with a space. */
export const PREFIX_PATHS = [/^common\.stepPrefix\(/];

/** Verbs a button may start with, plus the two noun-only labels the interface already uses. */
export const BUTTON_FIRST_WORDS = new Set([
  "Add", "Apply", "Back", "Cancel", "Change", "Check", "Choose", "Clear", "Close", "Continue", "Copy", "Delete", "Dismiss", "Done", "Download", "Edit", "Export", "Go", "Import", "Keep", "Lock", "Menu", "Next", "Open", "Pick", "Print", "Read",
  "Remove", "Rescue", "Reset", "Restart", "Retry", "Review", "Run", "Save", "Seal", "Select", "Set", "Show", "Start", "Stop", "Switch", "Turn", "Try", "Undo", "Unlock", "Update", "Use", "View",
  // Short answers of the desktop app's update banner and first-run notice (apps/app/src/update-copy.ts).
  "Later", "OK",
]);

/** The Start page promises a different headline than its menu label ("Start"); every other page title equals its menu label. */
export const TITLE_MAY_DIFFER = new Set(["start"]);

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

export type Kind = "link" | "menu" | "title" | "heading" | "button" | "note" | "text" | "label" | "code" | "aria" | "fragment";

export interface Entry {
  /** Where the string lives: a copy path, or "overview (rendered): button". */
  id: string;
  text: string;
  kind: Kind;
  /** Separate pieces of one block (a label and its value), each checked on its own for capitals. */
  parts?: string[];
  /** The string is built from several parts that were joined by code, so edges may carry a space. */
  prefix?: boolean;
}

export const words = (s: string): string[] => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
/** Sentences: split after . ? ! that is followed by a space and a capital letter, digit or opening quote. */
export const sentences = (s: string): string[] => s.split(/(?<=[.?!])["\u201D\u2019)]*\s+(?=[A-Z0-9"\u201C(])/).map((x) => x.trim()).filter(Boolean);
export const clip = (s: string): string => (s.length > 70 ? `${s.slice(0, 67)}...` : s);

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
export function whitespaceProblems(e: Entry): string[] {
  const t = e.text;
  const out: string[] = [];
  if (!e.prefix && t !== t.trim()) out.push("has a leading or trailing space");
  if (/ {2,}/.test(t)) out.push("has a double space");
  if (/[\t\n\r\f\v]/.test(t)) out.push("has a tab or line break");
  if (/[\u200B-\u200D\u2060\uFEFF\u2000-\u200A\u2028\u2029\u205F\u3000]/.test(t)) out.push("has an unusual space or invisible character");
  return out;
}

export function punctuationProblems(e: Entry): string[] {
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

export function quoteProblems(e: Entry): string[] {
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

export function americanProblems(e: Entry): string[] {
  const out: string[] = [];
  for (const re of BRITISH) {
    const m = re.exec(e.text);
    if (m) out.push(`uses British English ("${m[0]}")`);
  }
  for (const m of e.text.matchAll(new RegExp(ISE.source, "gi"))) if (!ISE_OK.test(m[0])) out.push(`uses an -ise spelling ("${m[0]}")`);
  return out;
}

export function capitalizationProblems(e: Entry): string[] {
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

export function lengthProblems(e: Entry): string[] {
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

export const RULES: [name: string, fn: (e: Entry) => string[], skip?: (e: Entry) => boolean][] = [
  ["whitespace", whitespaceProblems],
  ["punctuation and grammar", punctuationProblems, (e) => e.kind === "code"],
  ["typographic quotes", quoteProblems],
  ["American English", americanProblems],
  ["capitalization", capitalizationProblems],
  ["maximum lengths", lengthProblems, (e) => e.kind === "code" || e.kind === "aria"],
];

export function lint(entries: Entry[], rule: (typeof RULES)[number]): string[] {
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
export const SAMPLE_ARGS: unknown[][] = [
  [1], [2], [0], [5], [true], [false], ["alice"], ["alice", 3], [0, 0], [1, 1], [3, 12], [12, 12], [3, true], [1, false], [0, false], [3, 12, 5], [1, 2, 3], [0, 3, 0.5], [2, 3],
  ["1.2 GB", "5 GB", "24%"], ["Mar 2027"], ["Nov 6, 2026"], ["0.1.0"],
];

export function classify(keys: string[], text = ""): Kind {
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
export const BUTTON_KEYS = new Set([
  "common.copy", "common.openInSnapchat", "common.keep", "common.unkeep", "common.openSettings", "common.openGuide", "common.addExport", "common.addAnotherExport",
  "start.choose", "start.sampleButton", "cleanup.saveList", "cleanup.copyList", "cleanup.done", "cleanup.clearChecks", "memories.capUpdate",
  "shell.clearSample", "shell.lockNow", "overview.open", "overview.emptyAction", "settings.setButton", "settings.changeButton", "settings.deleteButton", "settings.deleteCancel",
]);
/** Page text that is longer than a note by design (an explainer paragraph). */
export const TEXT_BODIES = new Set(["exportBody", "addBody", "rescueBody", "rangeBody", "shapeBody", "storingBody", "workerBody", "aboutBody", "licensesBody", "keepBody", "sealBody", "promiseMore"]);
/** Notes whose key does not say "note" or "help". */
export const NOTE_KEYS = new Set([
  "kept", "unkept", "unknownSizes", "overCap", "projection", "noProjection", "noSizes", "pairingNone", "pairingLinksEmpty", "pairingTodo", "pairingOverlays", "pairingSummary",
  "rescueNetwork", "protectedByChats", "noChatProtection", "laterPartsOnly", "skippedFiles", "notAdded", "rejected", "notZip", "readFailed", "unlockSkip", "healthFromLedger",
  "oneSnapshot", "needTwoKeep", "noChatsLedger", "ledgerOnly", "noMatch", "saveFailed", "protectedBody", "sampleBanner", "sampleLabel", "removalWarning", "storageSession", "storageLocked",
  "storageUnlocked", "storageUnsupported", "mismatch", "tooShort", "deleteFailed", "healthGood", "readDone", "sampleLoaded", "sampleBody", "unlockBody", "networkOk", "networkUnknown",
  "copyFailed", "schemaNote", "pairingWhy", "rescueCommandLabel", "healthIntro", "capError", "countError", "countHelp", "capHelp",
]);

export function collectCopy(source: Record<string, unknown>): Entry[] {
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
  for (const [name, value] of Object.entries(source)) walk(value, [name], "");
  return out;
}

export const BLOCK_TAGS = new Set(["p", "div", "ul", "ol", "li", "section", "table", "thead", "tbody", "tr", "td", "th", "details", "summary", "header", "footer", "main", "nav", "h1", "h2", "h3", "h4", "dl", "dt", "dd", "form", "fieldset", "legend", "caption", "pre", "button", "label", "a", "select", "option"]);
export const hasClass = (el: FakeElement, c: string): boolean => el.classList.contains(c);
export const isInline = (el: FakeElement): boolean => !BLOCK_TAGS.has(el.tagName) || (el.tagName === "a" && !hasClass(el, "btn") && !hasClass(el, "card-link"));
/** Text of an element; sibling elements are separated by a space, because they are separate boxes on screen. */
export function rawText(n: FakeNode): string {
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
export const textOf = (el: FakeElement): string => rawText(el).replace(/\s+/g, " ").trim();
/** When a block holds only elements with text and no loose text, each is its own piece (a label and its value). */
export function partsOf(el: FakeElement): string[] {
  const kids = el.childNodes.filter((c): c is FakeElement => c instanceof FakeElement && textOf(c) !== "");
  const loose = el.childNodes.some((c) => c instanceof FakeText && c.data.trim() !== "");
  return !loose && kids.length >= 2 ? kids.map(textOf) : [textOf(el)];
}
export const ancestors = (el: FakeElement): FakeElement[] => {
  const out: FakeElement[] = [];
  for (let n: FakeNode | null = el.parentNode; n; n = n.parentNode) if (n instanceof FakeElement) out.push(n);
  return out;
};

/** The leaf-most text blocks of a rendered view: a paragraph, a list item, a cell, a button. */
export function textBlocks(root: FakeElement): FakeElement[] {
  return root.descendants().filter((el) => {
    if (el.tagName === "svg" || el.tagName === "use" || el.tagName === "option" || isInline(el)) return false;
    if (el.childNodes.some((c) => c instanceof FakeElement && !isInline(c) && c.tagName !== "button" && c.tagName !== "label")) {
      // a block that also holds loose text of its own is still a text block for that text
      return el.childNodes.some((c) => c instanceof FakeText && c.data.trim() !== "");
    }
    return textOf(el) !== "";
  });
}

export function renderedKind(el: FakeElement): Kind {
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

/**
 * The strings a rendered page shows, as lint entries: each text block with its kind, and every aria-label and title.
 * `where` names the page in the failure message. Text in code or a username counts as code.
 */
export function renderedEntries(root: FakeElement, where: string): Entry[] {
  const entries: Entry[] = [];
  for (const el of textBlocks(root)) {
    const text = textOf(el);
    if (text === "" || /^\d[\d,.%]*$/.test(text)) continue;
    const userText = el.descendants().some((d) => hasClass(d, "username") || d.tagName === "code");
    const parts = partsOf(el);
    entries.push({ id: `${where}: ${renderedKind(el)} <${el.tagName}${el.className ? `.${el.className.split(" ")[0]}` : ""}>`, text, kind: userText ? "code" : renderedKind(el), parts });
  }
  for (const el of root.descendants()) {
    for (const attr of ["aria-label", "title"]) {
      const v = el.getAttribute(attr);
      if (v) entries.push({ id: `${where}: ${attr} of <${el.tagName}>`, text: v, kind: "aria" });
    }
  }
  return entries;
}
