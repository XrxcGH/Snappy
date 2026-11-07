import { brand, privacy, routes } from "../copy.ts";
import { blocksNetwork, pagePolicy } from "../csp.ts";
import { h } from "../dom.ts";
import { icon } from "../components/icon.ts";
import { dataTable } from "../components/dataTable.ts";
import { notice } from "../components/notice.ts";
import { pageHeader, section } from "../components/layout.ts";
import type { View } from "./context.ts";

export const privacyView: View = () => {
  const policy = pagePolicy();
  return h(
    "div",
    { class: "view" },
    pageHeader(routes.privacy.title, privacy.lead),
    section(privacy.readsHeading, dataTable(privacy.readsHeading, [privacy.whatHeader, privacy.detailHeader], privacy.readsRows)),
    section(privacy.neverHeading, dataTable(privacy.neverHeading, [privacy.whatHeader, privacy.detailHeader], privacy.neverRows)),
    section(
      privacy.networkHeading,
      blocksNetwork(policy) ? notice("success", privacy.networkOk) : notice("warning", privacy.networkUnknown),
      h("p", {}, privacy.networkDetail),
      h("h3", { class: "subheading" }, privacy.workerHeading),
      h("p", {}, privacy.workerBody),
      h("p", { class: "label" }, privacy.policyLabel),
      h("pre", { class: "code code-wrap" }, h("code", {}, policy ?? "")),
    ),
    section(
      privacy.sealHeading,
      h("p", { class: "seal-icon" }, icon("seal", 24)),
      ...privacy.sealBody.map((p) => h("p", {}, p)),
      h("h3", { class: "subheading" }, privacy.keepHeading),
      h("p", {}, privacy.keepBody),
    ),
    h("p", { class: "caption muted" }, brand.nonAffiliation),
  );
};
