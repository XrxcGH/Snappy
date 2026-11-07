import { routes } from "./copy.ts";
import type { RouteId } from "./copy.ts";

/** A place in the app: a page, and for the Tools page the tool inside it (null for the hub itself). */
export interface Location {
  id: RouteId;
  tool: string | null;
}

/**
 * Map a location hash to a place. An empty hash is the start page; a hash that is not a route
 * (for example the skip link's "#main") returns null so the current view stays. Tools live under
 * one route: "#/tools" is the hub and "#/tools/<id>" a tool. Whether the tool exists is the router's
 * question (it asks the registry), so a mistyped id here still names the Tools page.
 */
export function parseLocation(hash: string): Location | null {
  if (hash === "" || hash === "#" || hash === "#/") return { id: "start", tool: null };
  const tool = /^#\/tools\/([a-z][a-z0-9-]*)?$/.exec(hash);
  if (tool) return { id: "tools", tool: tool[1] ?? null };
  const match = /^#\/([a-z-]+)$/.exec(hash);
  if (!match) return hash.startsWith("#/") ? { id: "start", tool: null } : null;
  const id = match[1] as string;
  return { id: Object.hasOwn(routes, id) ? (id as RouteId) : "start", tool: null };
}

/** The page a hash names, ignoring which tool: a tool's page belongs to "tools". */
export function parseRoute(hash: string): RouteId | null {
  return parseLocation(hash)?.id ?? null;
}

/** The hash that names a place. */
export const hashFor = (location: Location): string => (location.tool === null ? `#/${location.id}` : `#/${location.id}/${location.tool}`);
