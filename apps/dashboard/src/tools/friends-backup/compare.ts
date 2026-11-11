/**
 * The in-page compare of a Friends backup: choose a backup file you saved earlier, and Snappy compares it with the export this page
 * holds. The file is read in memory with the browser's own file reader and forgotten; its name is never shown. The result is counts
 * only (core's compare, run in model.ts), so it names no one, and nothing is saved, sent or changed.
 */
import { announce } from "../../announce.ts";
import { button } from "../../components/button.ts";
import { dataTable } from "../../components/dataTable.ts";
import type { TableCell } from "../../components/dataTable.ts";
import { toolNotes } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import type { ToolData } from "../data.ts";
import { copy } from "./copy.ts";
import { LIST_NAMES, MAX_BACKUP_BYTES, compareBackupText } from "./model.ts";
import type { CompareOutcome, ComparisonNote } from "./model.ts";

/** A file as the page reads it: a size, and its text. */
export interface BackupFile {
  readonly size: number;
  text(): Promise<string>;
}

/** The sentence for a file that could not be compared. Says only which kind of problem it was. */
export function failureText(error: "unreadable" | Extract<CompareOutcome, { ok: false }>["error"]): string {
  switch (error) {
    case "too-large":
      return copy.fileTooLargeNote;
    case "unsupported-version":
      return copy.fileVersionNote;
    case "too-many-entries":
      return copy.fileTooManyNote;
    case "unreadable":
      return copy.fileUnreadableNote;
    default:
      return copy.fileNotBackupNote;
  }
}

function noteText(n: ComparisonNote): ToolNote | null {
  switch (n.code) {
    case "current-empty":
      return { kind: "warning", text: copy.currentEmptyNote };
    case "many-removed":
      return { kind: "warning", text: copy.manyMissingNote(n.params.removed ?? 0, n.params.backup ?? 0) };
    case "usernames-skipped":
      return { kind: "info", text: copy.namesLeftOutNote(n.params.count ?? 0) };
    default:
      return null;
  }
}

/** The result of one comparison: the line that says what it came to, a table of counts per list, and the notes. */
function resultNodes(outcome: Extract<CompareOutcome, { ok: true }>): HTMLElement[] {
  const rows: TableCell[][] = [];
  const left: string[] = [];
  for (const list of LIST_NAMES) {
    const c = outcome.lists[list];
    if (c === null) {
      left.push(copy.lists[list].toLowerCase());
      continue;
    }
    rows.push([
      copy.lists[list],
      { text: formatCount(c.backup), label: copy.unitInBackup(c.backup) },
      { text: formatCount(c.added), label: copy.unitNew(c.added) },
      { text: formatCount(c.removed), label: copy.unitMissing(c.removed) },
      { text: formatCount(c.unchanged), label: copy.unitInBoth(c.unchanged) },
    ]);
  }
  const notes: ToolNote[] = [];
  if (left.length > 0) notes.push({ kind: "info", text: copy.notComparedNote(left.join(", ")) });
  for (const n of outcome.notes) {
    const text = noteText(n);
    if (text !== null) notes.push(text);
  }
  return [
    h("p", {}, outcome.identical ? copy.compareSameLine : copy.compareLegendLine),
    dataTable(copy.compareCaption, [copy.listHeader, copy.compareInBackupHeader, copy.compareNewHeader, copy.compareMissingHeader, copy.compareSameHeader], rows),
    h("p", { class: "caption" }, outcome.takenAt === null ? copy.unknownTimeLine : copy.compareMadeLine(formatDate(outcome.takenAt))),
    ...(notes.length > 0 ? [toolNotes(notes)] : []),
  ];
}

/**
 * The compare box: a line, a Choose button and the result under it. The picker opens only from a press, never by itself, and is
 * cleared after each use so the same file can be chosen again.
 */
export function compareBox(data: ToolData): HTMLElement {
  const input = h("input", { type: "file", accept: ".json,application/json", hidden: true, "aria-hidden": "true", tabindex: "-1" });
  const choose = button({ label: copy.compareFileButton, icon: "import", variant: "secondary", key: "friends-backup-compare-file", onclick: () => input.click() });
  const result = h("div", { class: "backup-compare-result" });

  const fail = (text: string): void => {
    result.replaceChildren(toolNotes([{ kind: "warning", text }]));
    announce(text, true);
  };

  const compare = async (file: BackupFile): Promise<void> => {
    if (file.size > MAX_BACKUP_BYTES) return fail(failureText("too-large"));
    let text: string;
    try {
      text = await file.text();
    } catch {
      return fail(failureText("unreadable"));
    }
    const outcome = compareBackupText(text, data);
    if (!outcome.ok) return fail(failureText(outcome.error));
    result.replaceChildren(...resultNodes(outcome));
    const total = (key: "removed" | "added"): number => LIST_NAMES.reduce((sum, list) => sum + (outcome.lists[list]?.[key] ?? 0), 0);
    announce(outcome.identical ? copy.compareSameAnnounce : copy.compareAnnounce(total("removed"), total("added")));
  };

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = ""; // lets the same file be chosen again
    if (file) void compare(file);
  });

  return h("div", { class: "backup-compare" }, h("p", {}, copy.compareFileLine), h("div", { class: "actions" }, choose, input), result);
}
