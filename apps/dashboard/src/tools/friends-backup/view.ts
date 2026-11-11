import { insights } from "@snappy-export/core";
import { dataTable } from "../../components/dataTable.ts";
import type { TableCell } from "../../components/dataTable.ts";
import { commandBlock } from "../../components/commandBlock.ts";
import { section, stepCards } from "../../components/layout.ts";
import { toolPage } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatCount, formatDate } from "../../format.ts";
import type { View, ViewContext } from "../../views/context.ts";
import type { ToolMeta } from "../types.ts";
import { compareBox } from "./compare.ts";
import { copy } from "./copy.ts";
import { backupFileName, computeFriendsBackup, LIST_NAMES } from "./model.ts";
import type { BackupNote, FriendsBackupResult } from "./model.ts";

export const meta: ToolMeta = { id: "friends-backup", group: "friends", category: "requests", icon: "people", needs: ["export", "friends"] };

const count = (n: BackupNote): number => n.params.count ?? 0;

/** The sentence for one note. Hedged where Snappy infers. */
function noteText(n: BackupNote): string {
  switch (n.code) {
    case "usernames-skipped":
      return copy.skippedNote(count(n));
    case "duplicates-merged":
      return copy.duplicatesNote(count(n));
    case "timestamps-invalid":
      return copy.invalidDatesNote(count(n));
    case "timestamps-in-future":
      return copy.futureDatesNote(count(n));
    case "entries-over-limit":
      return copy.overLimitNote(count(n));
    case "lists-overlap":
      return copy.overlapNote(count(n));
    case "friends-empty":
      return copy.friendsEmptyNote;
    case "time-unknown":
      return copy.timeUnknownNote;
  }
}

/**
 * The page. A saved backup can be compared here, with a file the person chooses. The compare command is also a Copy-only block, for
 * a terminal: it names a saved file by its path, which a page cannot open, and the block needs the page's context to be drawn.
 */
const page = (ctx: ViewContext): HTMLElement =>
  toolPage<FriendsBackupResult>(ctx, {
    meta,
    copy,
    compute: computeFriendsBackup,
    summary: ({ counts }) => copy.doneAnnounce(counts.friends.people, counts.blocked.people, counts.ignored.people),
    isEmpty: ({ total }) => total === 0,
    render: ({ backup, counts }, ui) => [
      section(
        copy.contentsHeading,
        dataTable(
          copy.contentsCaption,
          [copy.listHeader, copy.peopleHeader, copy.datedHeader],
          LIST_NAMES.map((list): TableCell[] => [
            copy.lists[list],
            { text: formatCount(counts[list].people), label: copy.unitPeople(counts[list].people) },
            { text: formatCount(counts[list].dated), label: copy.unitDated(counts[list].dated) },
          ]),
        ),
        h("p", {}, backup.takenAt === null ? copy.unknownTimeLine : copy.madeLine(formatDate(backup.takenAt))),
      ),
      section(copy.nextHeading, stepCards([copy.saveStep, copy.keepStep, copy.compareStep])),
      section(copy.compareFileHeading, compareBox(ui.data)),
      section(copy.compareHeading, commandBlock(ctx, "backup", { key: "friends-backup-compare", copyOnly: true, title: copy.compareTitle, append: ["--compare", "<file.json>"] })),
    ],
    notes: ({ notes }): ToolNote[] => notes.map((n) => ({ kind: n.code === "friends-empty" || n.code === "lists-overlap" ? "warning" : "info", text: noteText(n) })),
    download: {
      label: copy.downloadLabel,
      note: copy.downloadNote,
      build: ({ backup }) => ({ fileName: backupFileName(backup.takenAt), text: insights.friendsBackup.backupToJson(backup), mime: "application/json" }),
    },
    command: "backup",
  });

export const view: View = page;
