/**
 * Hash router: #/overview, #/cleanup, and so on; a tool is #/tools/<id>. Works from file:// because it never touches the
 * path. Each navigation disposes the previous view's subscriptions, renders the new view, moves
 * focus to its h1 and updates the page title.
 *
 * Scroll: a new page opens at the top. Going Back or Forward to a page that was already open returns to where it was
 * scrolled to, from a map that lives only in memory for this session (it holds a number per address, never anything
 * about the export, and nothing is stored). An entry counts as visited once its history state is marked, so a link
 * click (a new entry, no mark) is told apart from Back and Forward (an old entry, marked).
 */
import { resetPaging } from "./components/pagedList.ts";
import { routes } from "./copy.ts";
import type { RouteId } from "./copy.ts";
import { Scope, runInScope } from "./reactive.ts";
import { hashFor, parseLocation } from "./route-parse.ts";
import type { Location } from "./route-parse.ts";
import { toolById } from "./tools/registry.ts";
import { cleanupView } from "./views/cleanup.ts";
import type { View, ViewContext } from "./views/context.ts";
import { disappearedView, quietView, requestsView } from "./views/findings.ts";
import { guideView } from "./views/guide.ts";
import { memoriesView } from "./views/memories.ts";
import { overviewView } from "./views/overview.ts";
import { privacyView } from "./views/privacy.ts";
import { settingsView } from "./views/settings.ts";
import { startView } from "./views/start.ts";
import { toolsView } from "./views/tools.ts";

const views: Record<RouteId, View> = {
  start: startView,
  overview: overviewView,
  disappeared: disappearedView,
  requests: requestsView,
  quiet: quietView,
  cleanup: cleanupView,
  memories: memoriesView,
  tools: toolsView,
  guide: guideView,
  privacy: privacyView,
  settings: settingsView,
};

export interface Router {
  current(): RouteId;
  stop(): void;
}

/** What history.state holds on an entry this router has shown. */
const VISITED = { snappy: "visited" };
const isVisited = (state: unknown): boolean => typeof state === "object" && state !== null && (state as { snappy?: unknown }).snappy === VISITED.snappy;

export function startRouter(outlet: HTMLElement, ctx: ViewContext, onRoute: (id: RouteId) => void): Router {
  let scope: Scope | null = null;
  let active: RouteId | null = null;

  // Where each page was scrolled to when it was left, by address. Session memory only.
  const positions = new Map<string, number>();
  let shown: string | null = null;
  let lastY = 0;
  const onScroll = (): void => {
    lastY = window.scrollY;
  };
  // The browser would restore its own position into a page that is not drawn yet; the router does it after drawing.
  try {
    history.scrollRestoration = "manual";
  } catch {
    // An engine that does not allow it keeps its own behavior; the router then also sets the position.
  }

  const show = ({ id, tool }: Location, moveFocus: boolean, restoreTo: number): void => {
    scope?.dispose();
    resetPaging();
    scope = new Scope(true);
    // Tools share one route, so the menu keeps Tools marked while a tool is open. A tool's page is its own view and title.
    const descriptor = tool === null ? undefined : toolById(tool);
    const view = descriptor?.view ?? views[id];
    const node = runInScope(scope, () => view(ctx));
    outlet.replaceChildren(node);
    scope.firstPaint = false; // from here on, repaints do not replay the slide-in
    active = id;
    document.title = `${descriptor?.title ?? routes[id].title} · Snappy`;
    onRoute(id);
    window.scrollTo(0, restoreTo);
    lastY = restoreTo;
    if (moveFocus) outlet.querySelector<HTMLElement>("#page-title")?.focus({ preventScroll: true });
  };

  let first = true;
  const sync = (): void => {
    const parsed = parseLocation(location.hash);
    if (parsed === null) return;
    // A tool that does not exist is the hub. A hash that is not a route is rewritten, so the address bar always names the page.
    const place: Location = parsed.tool !== null && toolById(parsed.tool) === undefined ? { id: parsed.id, tool: null } : parsed;
    const hash = hashFor(place);
    if (location.hash !== hash) history.replaceState(null, "", hash);
    // Leaving a page: remember where it was scrolled to.
    if (shown !== null) positions.set(shown, lastY);
    // Back and Forward land on an entry this router has already shown; a link click lands on a fresh one.
    const traversal = isVisited(history.state);
    show(place, !first, traversal ? (positions.get(hash) ?? 0) : 0);
    shown = hash;
    // Mark the entry, keeping its address, so a later Back or Forward to it is known for what it is.
    history.replaceState(VISITED, "");
    first = false;
  };

  window.addEventListener("hashchange", sync);
  window.addEventListener("scroll", onScroll, { passive: true });
  sync();
  return {
    current: () => active ?? "start",
    stop: () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("scroll", onScroll);
      scope?.dispose();
    },
  };
}
