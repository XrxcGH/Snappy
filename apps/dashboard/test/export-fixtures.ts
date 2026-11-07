/** Synthetic exports for the import tests. Nothing here comes from a real account. */
import { syntheticExportParts } from "@snappy-export/core";
import type { SyntheticExportOptions } from "@snappy-export/core";
import { createActions } from "../src/actions.ts";
import type { Actions, Deps } from "../src/actions.ts";
import { initialState } from "../src/reducer.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import type { VaultStore } from "../src/vault.ts";

export const NOW = Date.UTC(2026, 10, 6, 12);

export const SMALL = { friendCount: 40, chatMessageCount: 200, memoryCount: 40 };

/** The three zips of a realistic export as Files, in export order (base, -2, -3). */
export function partFiles(phase: 1 | 2 = 2, opts: Partial<SyntheticExportOptions> = {}): File[] {
  return syntheticExportParts({ now: NOW, phase, ...SMALL, ...opts }).map((p) => new File([new Uint8Array(p.bytes)], p.name, { type: "application/zip" }));
}

export const memoryVault = (): VaultStore => ({
  supported: () => true,
  read: async () => null,
  write: async () => {},
  clear: async () => {},
});

export function setup(overrides: Partial<Deps> = {}): { store: Store; actions: Actions } {
  const store = createStore(initialState());
  const actions = createActions(store, { vault: memoryVault(), clock: () => NOW + 1000, yieldToUi: async () => {}, saveTheme: () => {}, ...overrides });
  return { store, actions };
}

/** Deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
