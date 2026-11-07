/** The three single-category finding views: disappeared friends, unaccepted requests, quiet friends. */
import { analyze, protectionByUser } from "../analysis.ts";
import type { Analysis } from "../analysis.ts";
import type { Candidate } from "@snappy-export/core";
import type { Actions } from "../actions.ts";
import { common, disappeared, quiet, requests, routes } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { formatCount } from "../format.ts";
import { routeLink } from "../components/button.ts";
import { CATEGORY_ICON } from "../components/category.ts";
import type { CategoryId } from "../components/category.ts";
import { candidateRow } from "../components/candidateRow.ts";
import { emptyState, factList, pageHeader, section } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { pagedList } from "../components/pagedList.ts";
import { region } from "../reactive.ts";
import { dataDeps } from "./context.ts";
import type { View, ViewContext } from "./context.ts";

const addExport = (): HTMLElement => routeLink("start", common.addExport, "primary");

/** Candidate rows, with protection (keep list, recent chat) shown from the merged queue. */
function candidateList(a: Analysis, items: readonly Candidate[], actions: Actions, key: string): HTMLElement {
  const protectedBy = protectionByUser(a.queue);
  return pagedList(
    items,
    (c, index) => {
      const reasons = protectedBy.get(c.key) ?? [];
      return candidateRow({ candidate: { ...c, protectedBy: reasons }, actions, mode: reasons.length > 0 ? "protected" : "review", index, profileLinks: !a.sample });
    },
    { key, className: "rows candidate-list" },
  );
}

function view(id: CategoryId, title: string, lead: string, inference: string, body: (ctx: ViewContext) => (a: Analysis) => Child[]): View {
  return (ctx) => {
    const render = body(ctx);
    return h(
      "div",
      { class: `view cat-${id}` },
      pageHeader(title, lead, { icon: CATEGORY_ICON[id], category: id }),
      notice("info", inference),
      region(ctx.store, dataDeps, (s) => render(analyze(s))),
    );
  };
}

export const disappearedView: View = view("disappeared", routes.disappeared.title, disappeared.lead, disappeared.inference, (ctx) => (a) => {
  if (a.source === "none") return [emptyState({ icon: "vanished", spot: "import", category: "disappeared", title: disappeared.noExportTitle, body: disappeared.noExportBody, actions: [addExport()] })];
  if (a.snapshotCount < 2) {
    const sealed = ctx.store.get().vault.phase === "unlocked";
    return [
      emptyState({
        icon: "vanished",
        spot: "empty",
        category: "disappeared",
        title: disappeared.needTwoTitle,
        body: sealed ? disappeared.needTwoBody : `${disappeared.needTwoBody} ${disappeared.needTwoKeep}`,
        actions: sealed ? [] : [routeLink("settings", common.openSettings)],
      }),
    ];
  }

  const diff = a.lastDiff;
  const changes = diff
    ? section(
        disappeared.changesHeading,
        factList([
          { label: disappeared.changeDisappeared, value: formatCount(diff.disappeared.length), icon: "vanished", scope: "disappeared" },
          { label: disappeared.changeRemoved, value: formatCount(diff.removedByUser.length), icon: "remove" },
          { label: disappeared.changeAdded, value: formatCount(diff.added.length), icon: "people" },
          { label: disappeared.changeAccepted, value: formatCount(diff.requestsAccepted.length), icon: "check" },
        ]),
      )
    : null;

  if (a.ghosts.length === 0) return [changes, emptyState({ icon: "check", spot: "overview", category: "disappeared", title: disappeared.noneTitle, body: disappeared.noneBody })];
  return [
    changes,
    section(disappeared.listHeading, h("p", { class: "summary" }, disappeared.listCount(a.ghosts.length)), candidateList(a, a.ghosts, ctx.actions, "ghost")),
  ];
});

export const requestsView: View = view("requests", routes.requests.title, requests.lead, requests.inference, (ctx) => (a) => {
  if (a.source === "none") return [emptyState({ icon: "one-way", spot: "import", category: "requests", title: requests.noExportTitle, body: requests.noExportBody, actions: [addExport()] })];
  if (a.oneWay.length === 0) return [emptyState({ icon: "one-way", spot: "overview", category: "requests", title: requests.emptyTitle, body: requests.emptyBody })];
  return [h("p", { class: "summary" }, requests.listCount(a.oneWay.length)), candidateList(a, a.oneWay, ctx.actions, "one-way")];
});

export const quietView: View = view("quiet", routes.quiet.title, quiet.lead, quiet.inference, (ctx) => (a) => {
  if (a.source === "none") return [emptyState({ icon: "quiet", spot: "import", category: "quiet", title: quiet.noExportTitle, body: quiet.noExportBody, actions: [addExport()] })];
  if (!a.hasChats) {
    return [
      emptyState({
        icon: "quiet",
        spot: "empty",
        category: "quiet",
        title: quiet.noChatsTitle,
        body: a.source === "ledger" ? quiet.noChatsLedger : quiet.noChatsBody,
        actions: [routeLink("guide", common.openGuide)],
      }),
    ];
  }
  if (a.dormant.length === 0) return [emptyState({ icon: "check", spot: "overview", category: "quiet", title: quiet.emptyTitle, body: quiet.emptyBody })];
  return [h("p", { class: "summary" }, quiet.listCount(a.dormant.length)), candidateList(a, a.dormant, ctx.actions, "dormant")];
});
