/**
 * Application state and its pure reducer. No I/O here: persistence, parsing and the clock are
 * handled by actions.ts, which dispatches the results into this reducer.
 *
 * Data lives in a Workspace. There are two: the real one, and an optional sample one that
 * shadows it while "Use sample data" is on. Changes made while looking at the sample
 * (keeping someone, ticking a checkbox) never touch the real workspace, so they are never saved.
 */
import { addSnapshot, emptyLedger } from "@snappy-export/core";
import type { CandidateCategory, Confidence, ExportIssue, Ledger, ParsedExport, Snapshot } from "@snappy-export/core";
import { mergeSaved, sortedUnique } from "./persist-codec.ts";
import type { Saved } from "./persist-codec.ts";

/** Dark is the default on a first visit, whatever the operating system prefers. "system" follows the device when chosen. */
export type Theme = "system" | "light" | "dark";

export const DEFAULT_THEME: Theme = "dark";

export interface Workspace {
  /** The newest export read this session (merged parts). Null when only a saved ledger is loaded. */
  latest: ParsedExport | null;
  ledger: Ledger;
  /** Normalised usernames to keep. */
  allowlist: string[];
  /** Normalised usernames ticked off in guided removal. */
  checkedOff: string[];
  /** Self-reported checklist ticks ("tool-id:item-id"). Saved with the history when saving is on; otherwise this session only. */
  ticks: string[];
  issues: ExportIssue[];
  /** Epoch ms used for age calculations; fixed for sample data. */
  now: number;
  /** How many ZIP parts made `latest`. Unknown (absent) for sample data and saved snapshots. */
  parts?: number;
}

export type ImportPhase = "idle" | "reading" | "done" | "failed";

export interface ImportStatus {
  phase: ImportPhase;
  /** Completed steps (files, or sample-building stages). */
  step: number;
  steps: number;
  sample: boolean;
  /** While reading: share of the bytes to read that are done (0..1), or null when it cannot be measured. */
  fraction?: number | null;
  /** Fixed, user-safe text (never file names or export values). */
  message?: string;
  /** Set when an export was refused: what was wrong with it (core's messages, free of export values). */
  issues?: ExportIssue[];
  /** Set when done: did the export enter the history? */
  addedToHistory?: boolean;
  /** When the import started, by the clock the actions were given (ms). For the elapsed time shown on a long read. */
  startedAt?: number;
  /** Set when an export was refused for a reason the person may choose to go on with: the page then offers "Use anyway". */
  canOverride?: boolean;
}

export type VaultPhase = "session" | "locked" | "unlocked";

export interface VaultStatus {
  /** IndexedDB is usable in this browser/page. */
  supported: boolean;
  /** A sealed blob exists on this device. */
  hasSaved: boolean;
  phase: VaultPhase;
  busy: boolean;
  message?: { kind: "error" | "success"; text: string };
}

export interface CleanupView {
  category: "all" | CandidateCategory;
  confidence: "all" | Confidence;
  guided: boolean;
}

export interface State {
  theme: Theme;
  real: Workspace;
  sample: Workspace | null;
  expectedFriendCount: number | null;
  /** Snapchat's free storage cap in GB, as the user last set it. */
  capGiB: number;
  import: ImportStatus;
  vault: VaultStatus;
  cleanup: CleanupView;
}

export const DEFAULT_CAP_GIB = 5;

export function emptyWorkspace(now = 0): Workspace {
  return { latest: null, ledger: emptyLedger(), allowlist: [], checkedOff: [], ticks: [], issues: [], now };
}

export function initialState(): State {
  return {
    theme: DEFAULT_THEME,
    real: emptyWorkspace(),
    sample: null,
    expectedFriendCount: null,
    capGiB: DEFAULT_CAP_GIB,
    import: { phase: "idle", step: 0, steps: 0, sample: false },
    vault: { supported: true, hasSaved: false, phase: "session", busy: false },
    cleanup: { category: "all", confidence: "all", guided: false },
  };
}

export type Action =
  | { type: "theme"; theme: Theme }
  | { type: "expected-friend-count"; count: number | null }
  | { type: "cap"; gib: number }
  | { type: "cleanup-view"; patch: Partial<CleanupView> }
  | { type: "import-started"; steps: number; sample: boolean; at?: number }
  | { type: "import-step"; step: number }
  | { type: "import-progress"; step: number; fraction: number | null }
  | { type: "import-failed"; message: string; issues?: ExportIssue[]; canOverride?: boolean }
  /** The person stopped the import: nothing was added. The message says so. */
  | { type: "import-canceled"; message: string }
  | { type: "import-finished"; latest: ParsedExport; issues: ExportIssue[]; snapshot: Snapshot | null; now: number; parts?: number }
  | { type: "import-reset" }
  | { type: "sample-loaded"; workspace: Workspace }
  | { type: "sample-cleared" }
  | { type: "keep"; username: string }
  | { type: "unkeep"; username: string }
  | { type: "toggle-checked"; username: string }
  | { type: "clear-checked" }
  | { type: "tick"; id: string; on: boolean }
  | { type: "vault"; patch: Partial<VaultStatus> }
  | { type: "unlocked"; saved: Saved; now: number }
  | { type: "locked" }
  | { type: "wiped" };

export const activeWorkspace = (state: State): Workspace => state.sample ?? state.real;

/** True when `a` should replace `b` as "the latest export": newer, or equal, or b unknown. */
function isNewerOrSame(a: ParsedExport, b: ParsedExport | null): boolean {
  if (b === null) return true;
  return (a.exportedAt ?? Infinity) >= (b.exportedAt ?? -Infinity);
}

function editActive(state: State, edit: (ws: Workspace) => Workspace): State {
  const current = activeWorkspace(state);
  const next = edit(current);
  if (next === current) return state;
  return state.sample ? { ...state, sample: next } : { ...state, real: next };
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "theme":
      return { ...state, theme: action.theme };
    case "expected-friend-count":
      return { ...state, expectedFriendCount: action.count };
    case "cap":
      return { ...state, capGiB: action.gib };
    case "cleanup-view":
      return { ...state, cleanup: { ...state.cleanup, ...action.patch } };

    case "import-started":
      return { ...state, import: { phase: "reading", step: 0, steps: action.steps, sample: action.sample, startedAt: action.at } };
    case "import-step":
      return { ...state, import: { ...state.import, step: action.step } };
    case "import-progress":
      // A late report after the import ended must not bring the progress bar back.
      return state.import.phase === "reading" ? { ...state, import: { ...state.import, step: action.step, fraction: action.fraction } } : state;
    case "import-failed":
      return { ...state, import: { ...state.import, phase: "failed", message: action.message, issues: action.issues, fraction: undefined, canOverride: action.canOverride } };
    case "import-canceled":
      return { ...state, import: { phase: "idle", step: 0, steps: 0, sample: false, message: action.message } };
    case "import-reset":
      return { ...state, import: { phase: "idle", step: 0, steps: 0, sample: false } };

    case "import-finished": {
      const ledger = action.snapshot ? addSnapshot(state.real.ledger, action.snapshot) : state.real.ledger;
      const useAsLatest = isNewerOrSame(action.latest, state.real.latest);
      const real: Workspace = {
        ...state.real,
        ledger,
        latest: useAsLatest ? action.latest : state.real.latest,
        issues: useAsLatest ? action.issues : state.real.issues,
        now: action.now,
        // The part count belongs to the export it describes, so it follows `latest`.
        parts: useAsLatest ? action.parts : state.real.parts,
      };
      return {
        ...state,
        real,
        // A real export always ends sample mode: the person came here to see their own results.
        sample: null,
        import: { phase: "done", step: state.import.steps, steps: state.import.steps, sample: false, addedToHistory: action.snapshot !== null },
      };
    }

    case "sample-loaded":
      return { ...state, sample: action.workspace, import: { phase: "done", step: state.import.steps, steps: state.import.steps, sample: true } };
    case "sample-cleared":
      return { ...state, sample: null, import: { phase: "idle", step: 0, steps: 0, sample: false } };

    case "keep":
      return editActive(state, (ws) => ({ ...ws, allowlist: sortedUnique([...ws.allowlist, action.username]) }));
    case "unkeep":
      return editActive(state, (ws) => ({ ...ws, allowlist: ws.allowlist.filter((u) => u !== action.username) }));
    case "toggle-checked":
      return editActive(state, (ws) => ({
        ...ws,
        checkedOff: ws.checkedOff.includes(action.username) ? ws.checkedOff.filter((u) => u !== action.username) : sortedUnique([...ws.checkedOff, action.username]),
      }));
    case "clear-checked":
      return editActive(state, (ws) => (ws.checkedOff.length === 0 ? ws : { ...ws, checkedOff: [] }));

    // Checklist ticks are the person's own word, not something Snappy checked. The sample never touches the real list.
    case "tick":
      return editActive(state, (ws) => {
        const has = ws.ticks.includes(action.id);
        if (has === action.on) return ws;
        return { ...ws, ticks: action.on ? sortedUnique([...ws.ticks, action.id]) : ws.ticks.filter((t) => t !== action.id) };
      });

    case "vault":
      return { ...state, vault: { ...state.vault, ...action.patch } };

    case "unlocked": {
      const merged = mergeSaved(action.saved, { ledger: state.real.ledger, allowlist: state.real.allowlist, checkedOff: state.real.checkedOff, ticks: state.real.ticks });
      return {
        ...state,
        real: { ...state.real, ledger: merged.ledger, allowlist: merged.allowlist, checkedOff: merged.checkedOff, ticks: merged.ticks ?? [], now: action.now },
        vault: { ...state.vault, phase: "unlocked", hasSaved: true, busy: false, message: undefined },
      };
    }

    // Lock and wipe both forget every in-memory result. "Locked" keeps the saved blob; "wiped" is after deletion.
    case "locked":
      return { ...initialState(), theme: state.theme, capGiB: state.capGiB, vault: { ...state.vault, phase: "locked", hasSaved: true, busy: false, message: undefined } };
    case "wiped":
      return { ...initialState(), theme: state.theme, capGiB: state.capGiB, vault: { ...state.vault, phase: "session", hasSaved: false, busy: false, message: undefined } };
  }
}
