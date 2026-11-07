/**
 * Small, pure iCalendar (RFC 5545) helpers: text escaping, line folding and a strict validator.
 * No clock, no I/O. The validator is deliberately stricter than most calendar apps: it checks
 * the exact shape this module writes (one VEVENT, optional VALARM) and rejects anything that
 * could carry personal data or reach the network (URL, ATTACH, ATTENDEE and similar).
 */

/** Hard line limit from RFC 5545 section 3.1, in octets and not counting the CRLF. */
export const MAX_LINE_OCTETS = 75;

const CRLF = "\r\n";

function octets(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

function octetLength(s: string): number {
  let n = 0;
  for (const ch of s) n += octets(ch.codePointAt(0) as number);
  return n;
}

/**
 * Escapes a TEXT value: backslash, semicolon, comma and line breaks. Other control characters
 * are dropped (a tab becomes a space) because they are not allowed in TEXT.
 */
export function escapeIcsText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] as string;
    if (ch === "\r") {
      if (value[i + 1] === "\n") i++;
      out += "\\n";
    } else if (ch === "\n") out += "\\n";
    else if (ch === "\\" || ch === ";" || ch === ",") out += "\\" + ch;
    else if (ch === "\t") out += " ";
    else {
      const c = ch.charCodeAt(0);
      if (c >= 0x20 && c !== 0x7f) out += ch;
    }
  }
  return out;
}

/**
 * Folds one content line to at most 75 octets per physical line. Continuation lines start with
 * one space (which counts toward the limit). Never splits a UTF-8 character. Linear time.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let used = 0;
  for (const ch of line) {
    const size = octets(ch.codePointAt(0) as number);
    if (used + size > MAX_LINE_OCTETS) {
      parts.push(current);
      current = " ";
      used = 1;
    }
    current += ch;
    used += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

/** Folds each content line and joins them with CRLF, ending with a final CRLF. */
export function joinIcsLines(lines: readonly string[]): string {
  let out = "";
  for (const line of lines) out += foldIcsLine(line) + CRLF;
  return out;
}

// ------------------------------------------------------------------ validator ---

export interface IcsIssue {
  /** Stable machine code, for example "line-too-long". */
  code: string;
  /** 1-based physical line the problem is on, when it has one. Never carries file content. */
  line?: number;
}

export interface IcsValidation {
  valid: boolean;
  issues: IcsIssue[];
}

/** Properties this tool never writes: they can hold people, places or links. */
const FORBIDDEN_PROPERTIES = new Set([
  "URL", "ATTACH", "ORGANIZER", "ATTENDEE", "CONTACT", "LOCATION", "GEO", "COMMENT", "RELATED-TO",
  "CONFERENCE", "IMAGE", "SOURCE", "RECURRENCE-ID",
]);
const TEXT_PROPERTIES = new Set(["SUMMARY", "DESCRIPTION"]);
const NAME_RE = /^[A-Z][A-Z0-9-]*$/;
const PARAM_RE = /^[A-Z][A-Z0-9-]*=[^;:",]+$/;
const LINK_RE = /[a-z][a-z0-9+.-]*:\/\/|mailto:/i;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
const UID_RE = /^[A-Za-z0-9._@-]+$/;
const DURATION_RE = /^[+-]?P(?=\d|T\d)(?:\d+W|(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?)$/;

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

interface TimeValue {
  kind: "date" | "datetime";
  /** Epoch-style number built from the fields. Only comparable between values of the same kind. */
  key: number;
  utc: boolean;
}

function parseTimeValue(raw: string, dateOnly: boolean): TimeValue | null {
  if (dateOnly) {
    const m = DATE_RE.exec(raw);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
    return validDate(y, mo, d) ? { kind: "date", key: Date.UTC(y, mo - 1, d), utc: false } : null;
  }
  const m = DATE_TIME_RE.exec(raw);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i])) as [number, number, number, number, number, number];
  if (!validDate(y, mo, d) || h > 23 || mi > 59 || s > 59) return null;
  return { kind: "datetime", key: Date.UTC(y, mo - 1, d, h, mi, s), utc: m[7] === "Z" };
}

/** True when every backslash is a valid escape and no raw comma or semicolon is left. */
function validText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") {
      const next = value[i + 1];
      if (next === undefined || !"\\;,nN".includes(next)) return false;
      i++;
    } else if (ch === ";" || ch === ",") return false;
  }
  return true;
}

interface Line {
  name: string;
  params: string[];
  value: string;
  /** 1-based physical line where the logical line starts. */
  line: number;
}

/**
 * Strict check of an .ics text. Returns stable codes only and never echoes the text.
 *
 * Rules: CRLF everywhere with a final CRLF; physical lines at most 75 octets; valid folding;
 * VCALENDAR with VERSION 2.0 and PRODID; exactly one VEVENT with UID, DTSTAMP (UTC) and DTSTART
 * (DATE or date-time); DTEND after DTSTART of the same kind, never together with DURATION;
 * at most one VALARM with ACTION DISPLAY, TRIGGER and DESCRIPTION; correctly escaped TEXT;
 * no forbidden properties (people, places, links) and no link-like value anywhere.
 */
export function validateIcs(text: string): IcsValidation {
  const issues: IcsIssue[] = [];
  const add = (code: string, line?: number) => void issues.push(line === undefined ? { code } : { code, line });
  if (typeof text !== "string" || text.length === 0) return { valid: false, issues: [{ code: "empty-input" }] };

  if (/[\r\n]/.test(text.replace(/\r\n/g, ""))) add("bare-line-break");
  if (!text.endsWith(CRLF)) add("missing-final-crlf");

  const physical = text.split(CRLF);
  if (physical[physical.length - 1] === "") physical.pop();

  // Pass 1: physical lines, then unfold into logical lines.
  const lines: Line[] = [];
  let open: { text: string; line: number } | null = null;
  const flush = () => {
    if (!open) return;
    const m = /^([^:;]*)((?:;[^:;]*)*):(.*)$/s.exec(open.text);
    if (!m) add("malformed-line", open.line);
    else lines.push({ name: m[1] as string, params: (m[2] as string).split(";").filter(Boolean), value: m[3] as string, line: open.line });
    open = null;
  };
  physical.forEach((raw, idx) => {
    const n = idx + 1;
    if (octetLength(raw) > MAX_LINE_OCTETS) add("line-too-long", n);
    if (CONTROL_RE.test(raw)) add("control-character", n);
    if (LONE_SURROGATE_RE.test(raw)) add("split-character", n);
    if (raw === "") return add("empty-line", n);
    if (raw[0] === " " || raw[0] === "\t") {
      if (open) open.text += raw.slice(1);
      else add("orphan-continuation", n);
      return;
    }
    flush();
    open = { text: raw, line: n };
  });
  flush();

  // Pass 2: structure. VCALENDAR > VEVENT > VALARM, each opened and closed in order.
  const stack: string[] = [];
  const scoped: Record<string, Line[]> = { VCALENDAR: [], VEVENT: [], VALARM: [] };
  let events = 0;
  let alarms = 0;
  let closed = false;
  for (const l of lines) {
    if (closed) {
      add("content-after-end", l.line);
      break;
    }
    if (!NAME_RE.test(l.name)) add("bad-property-name", l.line);
    for (const p of l.params) if (!PARAM_RE.test(p)) add("bad-parameter", l.line);
    if (LINK_RE.test(l.value)) add("link-in-value", l.line);
    const top = stack[stack.length - 1];
    if (l.name === "BEGIN") {
      const want = top === undefined ? "VCALENDAR" : top === "VCALENDAR" ? "VEVENT" : top === "VEVENT" ? "VALARM" : "";
      if (l.value !== want) add("unexpected-component", l.line);
      if (l.value === "VEVENT") events++;
      if (l.value === "VALARM") alarms++;
      stack.push(l.value);
    } else if (l.name === "END") {
      if (stack.pop() !== l.value) add("mismatched-end", l.line);
      if (stack.length === 0) closed = true;
    } else if (top === undefined) add("property-outside-calendar", l.line);
    else {
      if (FORBIDDEN_PROPERTIES.has(l.name)) add("forbidden-property", l.line);
      scoped[top]?.push(l);
    }
  }
  if (stack.length > 0) add("unclosed-component");
  if (lines[0]?.name !== "BEGIN" || lines[0]?.value !== "VCALENDAR") add("missing-vcalendar");
  if (events !== 1) add("expected-one-event");
  if (alarms > 1) add("too-many-alarms");

  // Pass 3: required properties and value shapes.
  const one = (list: Line[], name: string): Line | undefined => {
    const found = list.filter((l) => l.name === name);
    if (found.length === 0) add(`missing-${name.toLowerCase()}`);
    else if (found.length > 1) add(`duplicate-${name.toLowerCase()}`, found[1]?.line);
    return found[0];
  };

  const cal = scoped.VCALENDAR as Line[];
  const version = one(cal, "VERSION");
  if (version && version.value !== "2.0") add("bad-version", version.line);
  one(cal, "PRODID");

  const ev = scoped.VEVENT as Line[];
  const uid = one(ev, "UID");
  if (uid && !UID_RE.test(uid.value)) add("bad-uid", uid.line);
  const stamp = one(ev, "DTSTAMP");
  if (stamp) {
    const v = parseTimeValue(stamp.value, false);
    if (!v || !v.utc || stamp.params.length > 0) add("bad-dtstamp", stamp.line);
  }
  const parseTime = (p: Line): TimeValue | null => {
    const dateOnly = p.params.length === 1 && p.params[0] === "VALUE=DATE";
    return p.params.length > 0 && !dateOnly ? null : parseTimeValue(p.value, dateOnly);
  };
  const start = one(ev, "DTSTART");
  const startVal = start ? parseTime(start) : null;
  if (start && !startVal) add("bad-dtstart", start.line);
  const end = ev.find((l) => l.name === "DTEND");
  if (end) {
    const endVal = parseTime(end);
    if (!endVal) add("bad-dtend", end.line);
    else if (startVal && (endVal.kind !== startVal.kind || endVal.utc !== startVal.utc)) add("dtend-kind-mismatch", end.line);
    else if (startVal && endVal.key <= startVal.key) add("dtend-not-after-dtstart", end.line);
    if (ev.some((l) => l.name === "DURATION")) add("dtend-and-duration", end.line);
  }
  for (const l of ev) if (TEXT_PROPERTIES.has(l.name) && !validText(l.value)) add("bad-text-escape", l.line);

  if (alarms === 1) {
    const al = scoped.VALARM as Line[];
    const action = one(al, "ACTION");
    if (action && action.value !== "DISPLAY") add("bad-alarm-action", action.line);
    const trigger = one(al, "TRIGGER");
    if (trigger && (trigger.params.length > 0 || !DURATION_RE.test(trigger.value))) add("bad-trigger", trigger.line);
    const desc = one(al, "DESCRIPTION");
    if (desc && !validText(desc.value)) add("bad-text-escape", desc.line);
  }

  return { valid: issues.length === 0, issues };
}
