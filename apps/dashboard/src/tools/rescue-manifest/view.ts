import { commandBlock } from "../../components/commandBlock.ts";
import type { IconName } from "../../components/icon.ts";
import { section, stat, statGrid, stepCards } from "../../components/layout.ts";
import { toolPage } from "../../components/toolPage.ts";
import type { ToolNote } from "../../components/toolPage.ts";
import { h } from "../../dom.ts";
import { formatCount } from "../../format.ts";
import { COMMANDS, displayTextWith } from "../../terminal/commands.ts";
import type { View, ViewContext } from "../../views/context.ts";
import type { ToolMeta } from "../types.ts";
import { copy } from "./copy.ts";
import { computeRescueManifest, manifestText } from "./model.ts";
import type { RescueManifestResult, RescueNote } from "./model.ts";

export const meta: ToolMeta = { id: "rescue-manifest", group: "memories", category: "memories", icon: "memories", needs: ["memories"] };

/** The sentence for one note about the manifest. */
function noteOf(n: RescueNote): ToolNote {
  const count = n.params.count;
  switch (n.code) {
    case "path-skipped":
      return { kind: "warning", text: copy.pathSkippedNote(count) };
    case "path-duplicate":
      return { kind: "warning", text: copy.pathDuplicateNote(count) };
    case "overlay-skipped":
      return { kind: "warning", text: copy.overlaySkippedNote(count) };
    case "id-replaced":
      return { kind: "info", text: copy.idReplacedNote(count) };
    case "time-in-future":
      return { kind: "info", text: copy.futureNote(count) };
    case "time-invalid":
      return { kind: "info", text: copy.invalidNote(count) };
    case "size-missing":
      return { kind: "info", text: copy.sizesNote };
    default:
      return { kind: "info", text: copy.otherNote };
  }
}

const tile = (label: string, value: number, icon: IconName): HTMLElement => stat(label, formatCount(value), { icon, scope: "memories" });

/**
 * The words that check a rescue folder later: `rescue --verify <manifest file> --folder <rescue folder>`. The catalog's own
 * command is `rescue <export>`, and a check reads no export (the command line tool refuses ZIP files with --verify), so this
 * block starts from the bare `rescue` word. It can only be copied: this page cannot open a folder, so a terminal has to run it.
 */
export function verifyText(): string {
  return displayTextWith({ ...COMMANDS["rescue-manifest"], argv: ["rescue"] }, ["--verify", copy.unitVerifyManifest, "--folder", copy.unitVerifyFolder]);
}

/** The check, as the shared copy-only command block: no export is named, and the check's own words follow the bare `rescue`. */
const verifyBlock = (ctx: ViewContext): HTMLElement =>
  commandBlock(ctx, "rescue-manifest", {
    key: "rescue-verify",
    copyOnly: true,
    withoutExport: true,
    title: copy.verifyTitle,
    append: ["--verify", copy.unitVerifyManifest, "--folder", copy.unitVerifyFolder],
  });

export const view: View = (ctx) =>
  toolPage<RescueManifestResult, Record<string, never>>(ctx, {
    meta,
    copy,
    compute: computeRescueManifest,
    summary: ({ manifest }) => copy.listedAnnounce(manifest.counts.items),
    isEmpty: ({ manifest }) => manifest.counts.items === 0,
    render: ({ manifest }) => {
      const c = manifest.counts;
      return [
        section(
          copy.holdsHeading,
          statGrid(
            tile(copy.memoriesHeader, c.items, "memories"),
            tile(copy.photosHeader, c.images, "photo"),
            tile(copy.videosHeader, c.videos, "video"),
            tile(copy.otherHeader, c.unknown, "file"),
            tile(copy.overlaysHeader, c.overlayFiles, "list"),
            tile(copy.undatedHeader, c.undated, "calendar"),
          ),
        ),
        section(copy.checkHeading, stepCards([copy.saveStep, copy.rescueStep, copy.verifyStep]), verifyBlock(ctx)),
      ];
    },
    notes: ({ notes, repeats }): ToolNote[] => [
      ...(repeats > 0 ? [{ kind: "info" as const, text: copy.repeatsNote(repeats) }] : []),
      ...notes.map(noteOf),
      { kind: "info", text: copy.checkNote },
    ],
    download: {
      label: copy.downloadButton,
      note: copy.downloadNote,
      build: (result) => ({ fileName: copy.unitFileName, text: manifestText(result), mime: "application/json" }),
    },
    command: "rescue-manifest",
  });
