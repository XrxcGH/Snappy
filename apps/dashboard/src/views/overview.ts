import { analyze } from "../analysis.ts";
import type { Analysis } from "../analysis.ts";
import { brand, overview, routes } from "../copy.ts";
import type { RouteId } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { formatCount, formatDate } from "../format.ts";
import { routeLink } from "../components/button.ts";
import { icon } from "../components/icon.ts";
import type { IconName } from "../components/icon.ts";
import { emptyState, pageHeader, section, slideIn, stat } from "../components/layout.ts";
import { issueNotice, notice } from "../components/notice.ts";
import { region } from "../reactive.ts";
import { dataDeps } from "./context.ts";
import type { View } from "./context.ts";

export const overviewView: View = ({ store }) =>
  h("div", { class: "view" }, pageHeader(routes.overview.title), region(store, dataDeps, (s) => render(analyze(s))));

function render(a: Analysis): Child[] {
  if (a.source === "none") {
    return [emptyState({ icon: "import", title: overview.emptyTitle, body: overview.emptyBody, actions: [routeLink("start", overview.emptyAction, "primary")] })];
  }
  return [healthSection(a), countsSection(a), findingsSection(a), h("p", { class: "caption muted" }, brand.nothingLeft)];
}

function healthSection(a: Analysis): HTMLElement {
  if (a.source === "ledger") return section(overview.healthHeading, notice("info", overview.healthFromLedger));
  const all = a.workspace.issues;
  if (all.length === 0) return section(overview.healthHeading, notice("success", overview.healthGood));
  // A Memories note cannot change who looks disappeared, quiet or one-way, so it is not counted in
  // "read these first": it is listed after the others, with a pointer to the page that explains it.
  const memoryNotes = all.filter(isMemoriesIssue);
  const issues = all.filter((i) => !isMemoriesIssue(i));
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return section(
    overview.healthHeading,
    issues.length === 0 ? null : h("p", {}, overview.healthIntro(errors, warnings)),
    issues.length === 0 ? null : h("div", { class: "stack" }, ...issues.map(issueNotice)),
    memoryNotes.length === 0
      ? null
      : h(
          "div",
          { class: "stack" },
          h("h3", {}, overview.healthMemoriesHeading),
          h("p", { class: "caption muted" }, overview.healthMemoriesNote),
          ...memoryNotes.map(issueNotice),
          routeLink("memories", overview.healthMemoriesLink),
        ),
    h("p", { class: "caption muted" }, overview.schemaNote),
  );
}

/** Notes about the Memories lists and files; their code starts with "memories-". */
const isMemoriesIssue = (i: { code: string }): boolean => i.code.startsWith("memories-");

function countsSection(a: Analysis): HTMLElement {
  const friends = a.parsed?.friends.friends.length ?? 0;
  const sent = a.parsed?.friends.sentRequests.length ?? 0;
  const latest = a.parsed?.exportedAt;
  return section(
    overview.countsHeading,
    h("dl", { class: "stats" }, stat(overview.friends, formatCount(friends)), stat(overview.sentRequests, formatCount(sent)), stat(overview.snapshots, formatCount(a.snapshotCount))),
    latest !== undefined ? h("p", { class: "caption muted" }, overview.latestExport(formatDate(latest))) : null,
  );
}

function findingCard(index: number, route: RouteId, iconName: IconName, count: string, accent = false): HTMLElement {
  const [figure = "", ...rest] = count.split(" ");
  return slideIn(
    h(
      "a",
      { class: "card card-link", href: `#/${route}` },
      h("span", { class: "card-icon" }, icon(iconName, 24)),
      h("h3", { class: "card-title" }, routes[route].label),
      // The one violet element on this view: just the key figure, not the sentence around it.
      h("p", { class: "card-count" }, ...(accent ? [h("span", { class: "card-figure" }, figure), ` ${rest.join(" ")}`] : [count])),
      h("span", { class: "card-open" }, overview.open, icon("chevron-right", 16)),
    ),
    index,
  );
}

function findingsSection(a: Analysis): HTMLElement {
  const canCompare = a.snapshotCount >= 2;
  const memories = a.plan?.counts.total ?? 0;
  return section(
    overview.findingsHeading,
    canCompare ? null : h("p", {}, overview.oneSnapshot),
    h(
      "div",
      { class: "cards" },
      findingCard(0, "disappeared", "vanished", overview.cardDisappeared(a.ghosts.length, canCompare)),
      findingCard(1, "requests", "one-way", overview.cardRequests(a.oneWay.length)),
      findingCard(2, "quiet", "quiet", overview.cardQuiet(a.dormant.length, a.hasChats)),
      findingCard(3, "cleanup", "queue", overview.cardQueue(a.queue.items.length, a.queue.protectedItems.length), true),
      findingCard(4, "memories", "memories", memories > 0 ? overview.cardMemories(memories) : overview.cardMemoriesNone),
    ),
  );
}
