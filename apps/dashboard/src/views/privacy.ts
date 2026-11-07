import { privacy, routes } from "../copy.ts";
import { blocksNetwork, pagePolicy } from "../csp.ts";
import { h } from "../dom.ts";
import { dataTable } from "../components/dataTable.ts";
import { notice } from "../components/notice.ts";
import { detailsBody, disclosureSummary, pageHeader, section, subsection } from "../components/layout.ts";
import type { View } from "./context.ts";

/** The legal line is shown once per page, in the footer; this page does not repeat it. */
export const privacyView: View = () => {
  const policy = pagePolicy();
  return h(
    "div",
    { class: "view" },
    pageHeader(routes.privacy.title, privacy.lead, { icon: "seal" }),
    section(privacy.readsHeading, dataTable(privacy.readsHeading, [privacy.whatHeader, privacy.detailHeader], privacy.readsRows)),
    section(privacy.neverHeading, h("p", {}, privacy.neverBody), h("ul", { class: "plain-list" }, ...privacy.neverRows.map(([what]) => h("li", {}, what)))),
    section(
      privacy.networkHeading,
      blocksNetwork(policy) ? notice("success", privacy.networkOk) : notice("warning", privacy.networkUnknown),
      h("p", {}, privacy.workerBody),
      h(
        "details",
        { class: "tech-details" },
        disclosureSummary(privacy.policyHeading, "policy-details"),
        detailsBody(h("p", {}, privacy.networkDetail), h("p", {}, privacy.policyWorker), h("p", { class: "label" }, privacy.policyLabel), h("pre", { class: "code code-wrap", tabindex: "0" }, h("code", {}, policy ?? ""))),
      ),
    ),
    section(
      privacy.sealHeading,
      ...privacy.sealBody.map((p) => h("p", {}, p)),
      subsection(privacy.keepHeading, h("p", {}, privacy.keepBody), h("p", {}, privacy.themeNote)),
      h("details", { class: "tech-details" }, disclosureSummary(privacy.policyHeading, "seal-details"), detailsBody(h("p", {}, privacy.sealTech))),
    ),
  );
};
