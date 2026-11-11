import { tools } from "../copy.ts";
import { terminalTools } from "../copy-tools.ts";
import { h } from "../dom.ts";
import { saveTextFile } from "../download.ts";
import { copyTextButton, say } from "./listActions.ts";

export interface OfferedFile {
  fileName: string;
  text: string;
  mime: string;
}

/**
 * A Copy button for a file's text, with one line that says when to use it. Saving goes through a link on a Blob, and a web engine that
 * blocks it can say nothing at all, so the person is always given a way to get the same text without a download.
 */
export function copyFallback(file: Pick<OfferedFile, "fileName" | "text">): HTMLElement {
  const copy = copyTextButton({ label: terminalTools.copyFallback, text: () => file.text, done: terminalTools.copiedFile, key: "file-copy" });
  copy.setAttribute("aria-label", terminalTools.copyFallbackFor(file.fileName));
  return h("div", { class: "download-fallback" }, h("p", { class: "caption" }, terminalTools.fallbackHint), h("div", { class: "actions" }, copy));
}

/**
 * Save a text file and say how it went, and hand back the Copy fallback for the same text. The caller puts the fallback on the page
 * where the person can reach it, next to the Save button that was pressed. Nothing is read or built until this is called.
 */
export function offerFile(file: OfferedFile): { saved: boolean; fallback: HTMLElement } {
  const saved = saveTextFile(file.fileName, file.text, file.mime);
  say(saved, tools.downloadSaved, tools.downloadFailedNote);
  return { saved, fallback: copyFallback(file) };
}
