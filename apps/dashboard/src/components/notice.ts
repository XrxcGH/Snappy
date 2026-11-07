import type { ExportIssue } from "@snappy-export/core";
import { common } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { icon } from "./icon.ts";
import type { IconName } from "./icon.ts";

export type NoticeKind = "error" | "warning" | "info" | "success";

const ICONS: Record<NoticeKind, IconName> = { error: "warning", warning: "warning", info: "info", success: "check" };

/** Brand notice: tinted panel with an icon and a text label, so colour is never the only signal. */
export function notice(kind: NoticeKind, body: Child, options: { code?: string; extra?: Child[] } = {}): HTMLElement {
  return h(
    "div",
    { class: `notice notice-${kind}` },
    icon(ICONS[kind], 20),
    h(
      "div",
      { class: "notice-body" },
      h("p", { class: "notice-text" }, h("strong", { class: "notice-label" }, `${common.noticeLabels[kind]}. `), body),
      options.code ? h("p", { class: "caption muted" }, `${common.code}: `, h("code", {}, options.code)) : null,
      ...(options.extra ?? []),
    ),
  );
}

/** An export issue from core. Its message is already free of export values. */
export function issueNotice(issue: ExportIssue): HTMLElement {
  return notice(issue.severity, issue.message, { code: issue.code });
}
