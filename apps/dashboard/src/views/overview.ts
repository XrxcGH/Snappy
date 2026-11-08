import { analyze } from "../analysis.ts";
import type { Analysis } from "../analysis.ts";
import { brand, overview, routes, tools } from "../copy.ts";
import { lists } from "../copy-lists.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { formatCount, formatDate } from "../format.ts";
import { routeLink } from "../components/button.ts";
import { chipIcon } from "../components/category.ts";
import { findingCard } from "../components/findingCard.ts";
import { healthGroup } from "../components/healthGroup.ts";
import { icon } from "../components/icon.ts";
import { emptyState, noticeGroup, pageHeader, section, stat, statGrid, subsection } from "../components/layout.ts";
import { issueNotice, notice } from "../components/notice.ts";
import { relatedTools } from "../components/relatedTools.ts";
import { region } from "../reactive.ts";
import { TOOLS } from "../tools/registry.ts";
import { dataDeps } from "./context.ts";
import type { View } from "./context.ts";

/** Whether the "Export health" group is open. Kept here so a repaint does not undo the person's own choice. */
let healthOpen: boolean | undefined;

export const overviewView: View = ({ store }) =>
  h("div", { class: "view" }, pageHeader(routes.overview.title, undefined, { icon: "overview" }), region(store, dataDeps, (s) => render(analyze(s))));

function render(a: Analysis): Child[] {
  if (a.source === "none") {
    return [emptyState({ icon: "import", spot: "import", title: overview.emptyTitle, body: overview.emptyBody, actions: [routeLink("start", overview.emptyAction, "primary")] })];
  }
  return [allClearPanel(a), findingsList(a), toolsSection(), countsSection(a), healthSection(a), h("p", { class: "caption" }, brand.nothingLeft)];
}

/** Shown above the findings only when every area was checked and came up empty. */
function allClearPanel(a: Analysis): Child {
  const canCompare = a.snapshotCount >= 2;
  const clear = canCompare && a.ghosts.length === 0 && a.oneWay.length === 0 && (a.hasChats ? a.dormant.length === 0 : true) && a.queue.items.length === 0;
  if (!clear) return null;
  return emptyState({ icon: "check", spot: "overview", tint: true, category: "cleanup", title: overview.allClearTitle, body: overview.allClearBody });
}

/** One tile per finding area, three across and then two. The sidebar already groups these under "Findings", so there is no heading of its own. */
function findingsList(a: Analysis): HTMLElement {
  const canCompare = a.snapshotCount >= 2;
  const memories = a.plan?.counts.total ?? 0;
  const protectedCount = a.queue.protectedItems.length;
  const gh = a.ghosts.length;
  const ow = a.oneWay.length;
  const dm = a.dormant.length;
  const q = a.queue.items.length;
  const rows = [
    findingCard({
      scope: "disappeared",
      route: "disappeared",
      index: 0,
      ...(canCompare ? { figure: formatCount(gh), unit: overview.unitDisappeared(gh) } : { status: overview.needsTwo }),
    }),
    findingCard({ scope: "requests", route: "requests", index: 1, figure: formatCount(ow), unit: overview.unitRequests(ow) }),
    findingCard({
      scope: "quiet",
      route: "quiet",
      index: 2,
      ...(a.hasChats ? { figure: formatCount(dm), unit: overview.unitQuiet(dm) } : { status: overview.needsChats }),
    }),
    findingCard({
      scope: "cleanup",
      route: "cleanup",
      index: 3,
      figure: formatCount(q),
      unit: overview.unitQueue(q),
      ...(protectedCount > 0 ? { note: overview.protectedNote(protectedCount) } : {}),
    }),
    findingCard({
      scope: "memories",
      route: "memories",
      index: 4,
      ...(memories > 0 ? { figure: formatCount(memories), unit: overview.unitMemories(memories) } : { status: a.source === "ledger" ? lists.cardMemoriesLedger : overview.cardMemoriesNone }),
    }),
  ];
  return h("div", { class: "tiles tiles-findings findings" }, ...rows);
}

/** The Tools hub as one card, so the helpers are found from the first page and not only from the menu. */
function toolsSection(): HTMLElement {
  return section(
    lists.toolsHeading,
    h(
      "a",
      { class: "card card-link tools-card cat-neutral", href: "#/tools" },
      chipIcon("tools"),
      h("p", {}, lists.toolsCardText(TOOLS.length)),
      h("span", { class: "tile-action card-open" }, h("span", {}, tools.open), icon("chevron-right", 16)),
    ),
  );
}

function countsSection(a: Analysis): HTMLElement {
  const friends = a.parsed?.friends.friends.length ?? 0;
  const sent = a.parsed?.friends.sentRequests.length ?? 0;
  const latest = a.parsed?.exportedAt;
  return section(
    a.source === "ledger" ? lists.countsHeadingLedger : overview.countsHeading,
    statGrid(
      stat(overview.friends, formatCount(friends), { icon: "people" }),
      stat(overview.sentRequests, formatCount(sent), { icon: "export" }),
      stat(overview.snapshots, formatCount(a.snapshotCount), { icon: "snapshots" }),
    ),
    latest !== undefined ? h("p", { class: "caption" }, overview.latestExport(formatDate(latest))) : null,
  );
}

/** Notes about the Memories lists and files; their code starts with "memories-". */
const isMemoriesIssue = (i: { code: string }): boolean => i.code.startsWith("memories-");

/** Errors and warnings ask for action and stay tinted; everything else is a quiet note. */
const isLoud = (i: { severity: string }): boolean => i.severity === "error" || i.severity === "warning";

/** One part of Export health: its notes in one block. The count picks the columns on a wide screen, so no note is left alone in a row. */
function healthNotes(count: number, ...children: Child[]): HTMLElement {
  return h("div", { class: `health-notes health-n-${Math.min(count, 6)}` }, ...children);
}

function healthSection(a: Analysis): HTMLElement {
  if (a.source === "ledger") return section(overview.healthHeading, notice("info", overview.healthFromLedger));
  const all = a.workspace.issues;
  if (all.length === 0) return section(overview.healthHeading, notice("success", overview.healthGood), relatedTools(["export-check"]));
  // A Memories note cannot change who looks disappeared, quiet or one-way, so it is not counted in
  // "read these first": it is listed after the others, with a pointer to the page that explains it.
  const memoryNotes = all.filter(isMemoriesIssue);
  const issues = all.filter((i) => !isMemoriesIssue(i));
  const errors = all.filter((i) => i.severity === "error").length;
  const warnings = all.filter((i) => i.severity === "warning").length;
  const notes = all.filter((i) => i.severity === "info").length;
  const friendErrors = issues.filter((i) => i.severity === "error").length;
  const friendWarnings = issues.filter((i) => i.severity === "warning").length;
  // Loud (warning and error) notes first, then the quiet ones, so the group reads in order of need.
  const loud = issues.filter(isLoud);
  const quiet = issues.filter((i) => !isLoud(i));
  const memoryLoud = memoryNotes.filter(isLoud);
  const memoryQuiet = memoryNotes.filter((i) => !isLoud(i));
  return h(
    "section",
    { class: "section" },
    healthGroup(
      {
        errors,
        warnings,
        notes,
        open: healthOpen ?? errors + warnings > 0,
        onToggle: (open) => {
          healthOpen = open;
        },
      },
      issues.length === 0
        ? null
        : healthNotes(
            issues.length,
            friendErrors + friendWarnings > 0 ? h("p", {}, overview.healthIntro(friendErrors, friendWarnings)) : null,
            loud.length > 0 ? h("div", { class: "stack" }, ...loud.map(issueNotice)) : null,
            quiet.length > 0 ? noticeGroup(...quiet.map(issueNotice)) : null,
          ),
      memoryNotes.length === 0
        ? null
        : subsection(
            overview.healthMemoriesHeading,
            h("p", {}, overview.healthMemoriesNote),
            // Tinted warnings keep their own frames; the quiet notes share one.
            healthNotes(
              memoryNotes.length,
              memoryLoud.length > 0 ? h("div", { class: "stack" }, ...memoryLoud.map(issueNotice)) : null,
              memoryQuiet.length > 0 ? noticeGroup(...memoryQuiet.map(issueNotice)) : null,
            ),
            routeLink("memories", overview.healthMemoriesLink),
          ),
      h("p", {}, overview.schemaNote),
      relatedTools(["export-check"]),
    ),
  );
}
