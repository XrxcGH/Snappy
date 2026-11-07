/**
 * Hash router: #/overview, #/cleanup, and so on. Works from file:// because it never touches the
 * path. Each navigation disposes the previous view's subscriptions, renders the new view, moves
 * focus to its h1 and updates the page title.
 */
import { resetPaging } from "./components/pagedList.ts";
import { routes } from "./copy.ts";
import type { RouteId } from "./copy.ts";
import { Scope, runInScope } from "./reactive.ts";
import { parseRoute } from "./route-parse.ts";
import { cleanupView } from "./views/cleanup.ts";
import type { View, ViewContext } from "./views/context.ts";
import { disappearedView, quietView, requestsView } from "./views/findings.ts";
import { guideView } from "./views/guide.ts";
import { memoriesView } from "./views/memories.ts";
import { overviewView } from "./views/overview.ts";
import { privacyView } from "./views/privacy.ts";
import { settingsView } from "./views/settings.ts";
import { startView } from "./views/start.ts";

const views: Record<RouteId, View> = {
  start: startView,
  overview: overviewView,
  disappeared: disappearedView,
  requests: requestsView,
  quiet: quietView,
  cleanup: cleanupView,
  memories: memoriesView,
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

  const show = (id: RouteId, moveFocus: boolean): void => {
    scope?.dispose();
    resetPaging();
    scope = new Scope(true);
    const node = runInScope(scope, () => views[id](ctx));
    outlet.replaceChildren(node);
    scope.firstPaint = false; // from here on, repaints do not replay the slide-in
    active = id;
    document.title = `${routes[id].title} · Snappy`;
    onRoute(id);
    window.scrollTo(0, 0);
    if (moveFocus) outlet.querySelector<HTMLElement>("#page-title")?.focus({ preventScroll: true });
  };

  let first = true;
  const sync = (): void => {
    const id = parseRoute(location.hash);
    if (id === null) return;
    // A hash that is not a route is rewritten, so the address bar always names the page.
    if (location.hash !== `#/${id}`) history.replaceState(null, "", `#/${id}`);
    show(id, !first);
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
