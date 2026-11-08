import { privacy, routes } from "../copy.ts";
import { blocksNetwork, pagePolicy } from "../csp.ts";
import { h } from "../dom.ts";
import { dataTable } from "../components/dataTable.ts";
import { notice } from "../components/notice.ts";
import { platform } from "../platform.ts";
import { columns, detailsBody, disclosureSummary, pageHeader, section, subsection } from "../components/layout.ts";
import type { View } from "./context.ts";

/** What the desktop app adds to this page. The engine paragraphs name only what was checked, and only for the system that was checked. */
function desktopNote(system: "windows" | "macos" | "other"): string[] {
  if (system === "windows") return [privacy.desktopOwnPage, privacy.desktopWindows, privacy.desktopWindowsTest, privacy.desktopWindowsOff];
  if (system === "macos") return [privacy.desktopOwnPage, privacy.desktopMac, privacy.desktopMacTest, privacy.desktopMacLimit];
  return [privacy.desktopOwnPage, privacy.desktopOther];
}

/** The legal line is shown once per page, in the footer; this page does not repeat it. */
export const privacyView: View = () => {
  const policy = pagePolicy();
  const desktop = platform().desktop;
  return h(
    "div",
    { class: "view" },
    pageHeader(routes.privacy.title, privacy.lead, { icon: "seal" }),
    section(privacy.readsHeading, dataTable(privacy.readsHeading, [privacy.whatHeader, privacy.detailHeader], privacy.readsRows)),
    columns(
      section(privacy.neverHeading, h("p", {}, privacy.neverBody), h("ul", { class: "plain-list" }, ...privacy.neverRows.map(([what]) => h("li", {}, what)))),
      section(
        privacy.networkHeading,
        blocksNetwork(policy) ? notice("success", privacy.networkOk) : notice("warning", privacy.networkUnknown),
        h("p", {}, privacy.workerBody),
        desktop === undefined ? null : subsection(privacy.desktopHeading, ...desktopNote(desktop).map((line) => h("p", {}, line))),
        h(
          "details",
          { class: "tech-details" },
          disclosureSummary(privacy.policyHeading, "policy-details"),
          // The developer tools check is for a browser; the desktop app has no developer tools.
          detailsBody(desktop === undefined ? h("p", {}, privacy.networkDetail) : null, h("p", {}, privacy.policyWorker), h("p", { class: "label" }, privacy.policyLabel), h("pre", { class: "code code-wrap", tabindex: "0" }, h("code", {}, policy ?? ""))),
        ),
      ),
      section(
        privacy.sealHeading,
        ...privacy.sealBody.map((p) => h("p", {}, p)),
        subsection(privacy.keepHeading, h("p", {}, privacy.keepBody), h("p", {}, privacy.themeNote)),
        h("details", { class: "tech-details" }, disclosureSummary(privacy.policyHeading, "seal-details"), detailsBody(h("p", {}, privacy.sealTech))),
      ),
    ),
  );
};
