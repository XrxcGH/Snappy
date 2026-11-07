import { insights } from "@snappy-export/core";
import { dataTable } from "../../components/dataTable.ts";
import { section, stepCards } from "../../components/layout.ts";
import { toolView } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatDate } from "../../format.ts";
import type { ToolMeta } from "../types.ts";
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

export const view = toolView<FriendsBackupResult, Record<string, never>>({
  meta,
  copy,
  compute: computeFriendsBackup,
  summary: ({ counts }) => copy.doneAnnounce(counts.friends.people, counts.blocked.people, counts.ignored.people),
  isEmpty: ({ total }) => total === 0,
  render: ({ backup, counts }) => [
    section(
      copy.contentsHeading,
      dataTable(
        copy.contentsCaption,
        [copy.listHeader, copy.peopleHeader, copy.datedHeader],
        LIST_NAMES.map((list) => [copy.lists[list], copy.unitPeople(counts[list].people), copy.unitDated(counts[list].dated)]),
      ),
      h("p", {}, backup.takenAt === null ? copy.unknownTimeLine : copy.madeLine(formatDate(backup.takenAt))),
    ),
    section(copy.nextHeading, stepCards([copy.saveStep, copy.keepStep, copy.compareStep])),
  ],
  notes: ({ notes }): ToolNote[] => notes.map((n) => ({ kind: n.code === "friends-empty" || n.code === "lists-overlap" ? "warning" : "info", text: noteText(n) })),
  download: {
    label: copy.downloadLabel,
    note: copy.downloadNote,
    build: ({ backup }) => ({ fileName: backupFileName(backup.takenAt), text: insights.friendsBackup.backupToJson(backup), mime: "application/json" }),
  },
  command: "backup",
});
