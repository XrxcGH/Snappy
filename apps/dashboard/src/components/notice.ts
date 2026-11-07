import type { ExportIssue } from "@snappy-export/core";
import { common } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { icon } from "./icon.ts";
import type { IconName } from "./icon.ts";
import { disclosureSummary } from "./layout.ts";

export type NoticeKind = "error" | "warning" | "info" | "success";

const ICONS: Record<NoticeKind, IconName> = { error: "warning", warning: "warning", info: "info", success: "check" };

export interface NoticeOptions {
  /** A developer code for bug reports. Kept inside a collapsed "Details" area, never shown up front. */
  code?: string;
  extra?: Child[];
  /**
   * Quiet style: a plain surface with a thin status-colored bar and a small status icon.
   * Defaults to true for info and success, false for warning and error, which ask for action and
   * stay tinted. Body text always uses the normal text color; only the icon, border and bar
   * carry the status color.
   */
  quiet?: boolean;
}

/**
 * Brand notice: a status icon and the text. The kind is read aloud by a hidden label (the icon is
 * decorative), and shown by the icon, border and accent bar, so color is never the only signal.
 */
export function notice(kind: NoticeKind, body: Child, options: NoticeOptions = {}): HTMLElement {
  const quiet = options.quiet ?? (kind === "info" || kind === "success");
  return h(
    "div",
    { class: `notice notice-${kind}${quiet ? " notice-quiet" : ""}` },
    icon(ICONS[kind], 20),
    h(
      "div",
      { class: "notice-body" },
      h("p", { class: "notice-text" }, h("span", { class: "sr-only" }, `${common.noticeLabels[kind]}. `), body),
      options.code
        ? h("details", { class: "notice-details" }, disclosureSummary(common.details), h("p", { class: "caption muted" }, `${common.code}: `, h("code", {}, options.code)))
        : null,
      ...(options.extra ?? []),
    ),
  );
}

/** An export issue from core. Its message is already free of export values. Info notes are quiet. */
export function issueNotice(issue: ExportIssue): HTMLElement {
  return notice(issue.severity, issue.message, { code: issue.code });
}
