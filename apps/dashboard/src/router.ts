/**
 * Hash router: #/overview, #/cleanup, and so on; a tool is #/tools/<id>. Works from file:// because it never touches the
 * path. Each navigation disposes the previous view's subscriptions, renders the new view, moves
 * focus to its h1 and updates the page title.
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

export function startRouter(outlet: HTMLElement, ctx: ViewContext, onRoute: (id: RouteId) => void): Router {
  let scope: Scope | null = null;
  let active: RouteId | null = null;

  const show = ({ id, tool }: Location, moveFocus: boolean): void => {
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
    window.scrollTo(0, 0);
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
    show(place, !first);
    first = false;
  };

  window.addEventListener("hashchange", sync);
  sync();
  return {
    current: () => active ?? "start",
    stop: () => {
      window.removeEventListener("hashchange", sync);
      scope?.dispose();
    },
  };
}
