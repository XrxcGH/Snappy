/**
 * Runs a tool's `compute` after the page has painted, and remembers the last result of each tool.
 *
 * Opening a tool paints its frame and a short "working" line first, then does the one pass over the
 * data in a later task (after a short wait, so the line is really on screen), so a large history never freezes the navigation. The result is kept per tool,
 * keyed on the data object and the tool's own parameters, so coming back to the page (or a repaint)
 * costs nothing. The memo is cleared with the analysis cache on Lock and Delete data.
 */
import { onAnalysisReset } from "../analysis.ts";
import type { ToolData } from "./data.ts";

interface Held {
  data: ToolData;
  params: string;
  result: unknown;
}

const held = new Map<string, Held>();

onAnalysisReset(() => held.clear());

/** The remembered result for these inputs, or undefined. */
export function cachedResult<R>(id: string, data: ToolData, params: string): { result: R } | undefined {
  const hit = held.get(id);
  return hit && hit.data === data && hit.params === params ? { result: hit.result as R } : undefined;
}

/**
 * How long the page waits before a tool's pass starts, so the "working" line is on screen first. A timer of 0 can run before the
 * browser paints, and a pass over a large export would then freeze the page with nothing shown. It is a short timer and not an
 * animation frame for the same reason as the import's (see main.ts): hidden tabs never run animation frames.
 */
export const PAINT_FIRST_MS = 20;

/** Runs `work` in a later task, after the page has had time to paint, and remembers its result. A thrown error rejects, and nothing is remembered. */
export function runTool<R>(id: string, data: ToolData, params: string, work: () => R): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    setTimeout(() => {
      try {
        const result = work();
        held.set(id, { data, params, result });
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }, PAINT_FIRST_MS);
  });
}
