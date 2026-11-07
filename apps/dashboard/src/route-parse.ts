import { routes } from "./copy.ts";
import type { RouteId } from "./copy.ts";

/**
 * Map a location hash to a route. An empty hash is the start page; a hash that is not a route
 * (for example the skip link's "#main") returns null so the current view stays.
 */
export function parseRoute(hash: string): RouteId | null {
  if (hash === "" || hash === "#" || hash === "#/") return "start";
  const match = /^#\/([a-z-]+)$/.exec(hash);
  if (!match) return hash.startsWith("#/") ? "start" : null;
  const id = match[1] as string;
  return Object.hasOwn(routes, id) ? (id as RouteId) : "start";
}
