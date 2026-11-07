/**
 * Defense in depth for the command helper: before any command code runs, the helper removes the
 * browser features that could reach the network or start other code. This is not the boundary (the
 * page's security policy and the build, which leaves out the downloader, are), but a command can
 * then never find these by accident. It leaves crypto, which sealing needs, and navigator.locks.
 *
 * This is the one file that names those features, and it names them only in the lists below, as
 * strings. A source check keeps it that way.
 */

/** Names on the helper's global scope that are removed. */
export const SCRUBBED_GLOBALS: readonly string[] = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "Worker",
  "SharedWorker",
  "indexedDB",
  "caches",
];

/** Names on the helper's navigator that are removed. */
export const SCRUBBED_NAVIGATOR: readonly string[] = ["sendBeacon"];

function remove(target: object, name: string): boolean {
  try {
    // Shadow whatever is on the object or its prototypes with a fixed, empty value.
    Object.defineProperty(target, name, { value: undefined, writable: false, configurable: false, enumerable: false });
    return true;
  } catch {
    try {
      return Reflect.deleteProperty(target, name);
    } catch {
      return false;
    }
  }
}

/** Remove the listed features from `scope` (and `navigator`). Returns the names that could not be removed. */
export function scrubScope(scope: object, navigator?: object): string[] {
  const failed: string[] = [];
  for (const name of SCRUBBED_GLOBALS) if (!remove(scope, name)) failed.push(name);
  if (navigator !== undefined) for (const name of SCRUBBED_NAVIGATOR) if (!remove(navigator, name)) failed.push(`navigator.${name}`);
  return failed;
}
