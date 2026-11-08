/**
 * Everything that has side effects: reading files, the clock, the sealed vault. Views call these
 * and read results from the store. Dependencies are injected so the logic runs under test
 * without a browser.
 */
import { LedgerFormatError, SealError, forgetMediaHandles, openLedger, sealLedger, snapshotFromExport } from "@snappy-export/core";
import type { ExportIssue, ParsedExport, Snapshot } from "@snappy-export/core";
import { resetAnalysisCache } from "./analysis.ts";
import { settings, start, vaultMessages } from "./copy.ts";
import { startFlow } from "./copy-start.ts";
import { checkParts, scanPart } from "./export-parts.ts";
import { runImport } from "./import-pipeline.ts";
import type { ImportRunner } from "./import-pipeline.ts";
import { exportHealth } from "./issues.ts";
import { estimateStrength } from "./passphrase.ts";
import { packSaved, unpackSaved } from "./persist-codec.ts";
import type { CleanupView, Theme, VaultStatus } from "./reducer.ts";
import { buildSampleWorkspace } from "./sample.ts";
import type { Store } from "./store.ts";
import type { VaultStore } from "./vault.ts";

export interface NamedBlob extends Blob {
  readonly name?: string;
}

export interface Deps {
  vault: VaultStore;
  clock: () => number;
  /** Lets the page paint between slow steps (progress bars need frames to move). */
  yieldToUi: () => Promise<void>;
  saveTheme: (theme: Theme) => void;
  /** Reads the zip parts. The page passes the background reader; the default reads on the calling thread. */
  runImport?: ImportRunner;
  /** Everything held on screen was forgotten (Lock or Delete data): the command output and picked files go too. */
  onWipe?: () => void;
}

export type ImportResult = "done" | "failed";

export interface Actions {
  init(savedTheme: string | null): Promise<void>;
  importZips(files: readonly NamedBlob[]): Promise<ImportResult>;
  loadSample(): Promise<ImportResult>;
  clearSample(): void;
  keep(username: string): void;
  unkeep(username: string): void;
  toggleChecked(username: string): void;
  clearChecked(): void;
  /** Tick or untick a self-reported checklist item. Saved only when the person turned saving on; otherwise it lasts this session. */
  setTick(id: string, on: boolean): void;
  setTheme(theme: Theme): void;
  setExpectedFriendCount(count: number | null): void;
  setCapGiB(gib: number): void;
  setCleanupView(patch: Partial<CleanupView>): void;
  unlock(passphrase: string): Promise<boolean>;
  sealWith(passphrase: string): Promise<boolean>;
  lock(): Promise<void>;
  deleteAll(): Promise<boolean>;
  /**
   * A command is about to save history (the terminal's analyze). The dashboard's own copy is locked first, so
   * nothing can write over the file the command writes, and what was saved is remembered.
   */
  beforeStoreRun(): Promise<void>;
  /** The command ended. If it changed the saved history, say so and ask to unlock to see it. */
  afterStoreRun(): Promise<void>;
  /** Resolves when every queued save has finished. */
  settled(): Promise<void>;
}

const ZIP_NAME = /\.zip$/i;

/** Clocks drift and zips get edited; a day of slack before an export date counts as "in the future". */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

export function createActions(store: Store, deps: Deps): Actions {
  /** Lives only in this closure: never in state, never written anywhere. */
  let passphrase: string | null = null;

  const setVault = (patch: Partial<VaultStatus>): void => store.dispatch({ type: "vault", patch });

  // ---------------------------------------------------------------- saving ---

  async function saveNow(): Promise<void> {
    const pass = passphrase;
    if (pass === null) return;
    const { ledger, allowlist, checkedOff, ticks } = store.get().real;
    try {
      const sealed = await sealLedger(packSaved({ ledger, allowlist, checkedOff, ticks }), pass);
      await deps.vault.write(sealed);
    } catch {
      setVault({ message: { kind: "error", text: vaultMessages.saveFailed } });
    }
  }

  // Saves are chained so two never overlap, and a save requested while another is still waiting
  // for its turn is folded into it (saveNow always reads the newest state when it starts).
  let chain: Promise<void> = Promise.resolve();
  let queued = false;
  function requestSave(): Promise<void> {
    if (!queued) {
      queued = true;
      chain = chain.then(() => {
        queued = false;
        return saveNow();
      });
    }
    return chain;
  }

  // Only edits made while unlocked are saved; the unlock and seal steps save explicitly.
  store.subscribe((state, previous) => {
    if (state.vault.phase !== "unlocked" || previous.vault.phase !== "unlocked") return;
    const a = state.real;
    const b = previous.real;
    if (a.ledger !== b.ledger || a.allowlist !== b.allowlist || a.checkedOff !== b.checkedOff || a.ticks !== b.ticks) void requestSave();
  });

  // ---------------------------------------------------------------- import ---

  async function importZips(files: readonly NamedBlob[]): Promise<ImportResult> {
    const zips = files.filter((f) => ZIP_NAME.test(f.name ?? ""));
    if (zips.length === 0) {
      store.dispatch({ type: "import-failed", message: start.notZip });
      return "failed";
    }

    // What each part holds comes from its directory, not its name. Parts that hold photos and videos only would add
    // an empty export that could replace a good one, so the person is told where the lists are instead. Parts of
    // two different exports would merge into one set of friends, so they are refused too.
    const check = checkParts(zips, await Promise.all(zips.map((zip) => scanPart(zip))));
    if (check.kind === "later-only") {
      store.dispatch({ type: "import-failed", message: start.laterPartsOnly });
      return "failed";
    }
    if (check.kind === "mixed") {
      store.dispatch({ type: "import-failed", message: startFlow.mixedExports(check.ids[0], check.ids[1]) });
      return "failed";
    }

    // Parts are read in export order: the part with the lists first, then -2, -3, whatever order they were chosen in.
    const ordered = check.ordered;
    store.dispatch({ type: "import-started", steps: ordered.length, sample: false });
    try {
      await deps.yieldToUi(); // lets "Part 1 of N" paint before the first read
      // Whichever reader ran (the worker or this page), file locations and links are forgotten before
      // anything is kept: nothing here opens a file, so nothing needs them.
      const combined = forgetMediaHandles(
        await (deps.runImport ?? runImport)(ordered, {
          yieldToUi: deps.yieldToUi,
          onProgress: ({ step, fraction }) => store.dispatch({ type: "import-progress", step, fraction }),
        }),
      );

      const now = deps.clock();
      // The export date comes from the newest file time inside the zip, which anyone can set. A
      // far-future date would sort this export after every later one for good, so it is not trusted.
      const futureDated = combined.exportedAt !== undefined && combined.exportedAt > now + FUTURE_SLACK_MS;
      const merged: ParsedExport = futureDated ? { ...combined, exportedAt: undefined } : combined;
      const issues: ExportIssue[] = exportHealth(merged, { expectedFriendCount: store.get().expectedFriendCount ?? undefined, now });

      // An export with errors is refused outright, as the command-line tool does: its lists may be
      // cut off, and a cut-off list makes everyone look like they vanished. Nothing is added to the
      // history and nobody is suggested for removal.
      if (issues.some((i) => i.severity === "error")) {
        store.dispatch({ type: "import-failed", message: start.rejected, issues });
        return "failed";
      }
      // A file that is not a .zip was left out. If it was a part of the export, what was read is incomplete.
      if (zips.length < files.length) issues.push({ severity: "warning", code: "files-skipped-not-zip", message: start.skippedFiles(files.length - zips.length) });
      const snapshot = snapshotOf(merged, now, issues, futureDated);
      store.dispatch({ type: "import-finished", latest: merged, issues, snapshot, now, parts: ordered.length });
      return "done";
    } catch {
      store.dispatch({ type: "import-failed", message: start.readFailed });
      return "failed";
    }
  }

  /**
   * A snapshot needs a trustworthy time. Without a generation time the export is dated "now" and
   * the person is told. An export with no friends, requests or deletions at all would only
   * teach the ledger that everyone vanished, so it is not added.
   */
  function snapshotOf(merged: ParsedExport, now: number, issues: ExportIssue[], futureDated: boolean): Snapshot | null {
    const f = merged.friends;
    if (f.friends.length === 0 && f.sentRequests.length === 0 && f.deletedFriends.length === 0) return null;
    if (merged.exportedAt === undefined) {
      issues.push(
        futureDated
          ? {
              severity: "warning",
              code: "export-time-future",
              message: start.exportTimeFuture,
            }
          : {
              severity: "warning",
              code: "export-time-unknown",
              message: start.exportTimeUnknown,
            },
      );
    }
    return snapshotFromExport(merged, { takenAt: merged.exportedAt ?? now });
  }

  async function loadSample(): Promise<ImportResult> {
    store.dispatch({ type: "import-started", steps: 3, sample: true });
    try {
      const workspace = await buildSampleWorkspace(async (step) => {
        store.dispatch({ type: "import-step", step });
        await deps.yieldToUi();
      });
      store.dispatch({ type: "sample-loaded", workspace });
      return "done";
    } catch {
      store.dispatch({ type: "import-failed", message: start.readFailed });
      return "failed";
    }
  }

  // ----------------------------------------------------------------- vault ---

  async function init(savedTheme: string | null): Promise<void> {
    if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") store.dispatch({ type: "theme", theme: savedTheme });
    if (!deps.vault.supported()) {
      setVault({ supported: false });
      return;
    }
    try {
      const blob = await deps.vault.read();
      if (blob) setVault({ hasSaved: true, phase: "locked" });
    } catch {
      setVault({ supported: false, message: { kind: "error", text: vaultMessages.storageUnavailable } });
    }
  }

  async function unlock(pass: string): Promise<boolean> {
    if (pass === "") return false;
    setVault({ busy: true, message: undefined });
    await deps.yieldToUi();
    try {
      const blob = await deps.vault.read();
      if (!blob) {
        setVault({ busy: false, hasSaved: false, phase: "session", message: { kind: "error", text: vaultMessages.nothingSaved } });
        return false;
      }
      const saved = unpackSaved(await openLedger(blob, pass));
      const real = store.get().real;
      const hadSession = real.ledger.snapshots.length > 0 || real.allowlist.length > 0 || real.checkedOff.length > 0 || real.ticks.length > 0;
      passphrase = pass;
      store.dispatch({ type: "unlocked", saved, now: deps.clock() });
      // Things added before unlocking now belong to the saved history: write the merged result.
      if (hadSession) await requestSave();
      return true;
    } catch (e) {
      const unreadable = e instanceof LedgerFormatError;
      const wrong = e instanceof SealError;
      setVault({ busy: false, message: { kind: "error", text: wrong ? vaultMessages.wrongPassphrase : unreadable ? vaultMessages.unreadable : vaultMessages.storageUnavailable } });
      return false;
    }
  }

  async function sealWith(pass: string): Promise<boolean> {
    const vault = store.get().vault;
    if (!vault.supported) {
      setVault({ message: { kind: "error", text: vaultMessages.storageUnavailable } });
      return false;
    }
    if (vault.phase === "locked") {
      setVault({ message: { kind: "error", text: vaultMessages.lockedFirst } });
      return false;
    }
    if (!estimateStrength(pass).acceptable) {
      setVault({ message: { kind: "error", text: settings.tooShort } });
      return false;
    }

    // A tab opened before anything was saved still says "session only". Look before writing, so it
    // cannot replace a history another tab has saved since.
    if (vault.phase === "session") {
      try {
        if (await deps.vault.read()) {
          setVault({ hasSaved: true, phase: "locked", message: { kind: "error", text: vaultMessages.savedElsewhere } });
          return false;
        }
      } catch {
        setVault({ message: { kind: "error", text: vaultMessages.storageUnavailable } });
        return false;
      }
    }

    const wasUnlocked = vault.phase === "unlocked";
    const previous = passphrase;
    setVault({ busy: true, message: undefined });
    await deps.yieldToUi();
    passphrase = pass;
    try {
      const sealed = await sealLedger(packSaved(store.get().real), pass);
      await deps.vault.write(sealed);
    } catch {
      passphrase = previous;
      setVault({ busy: false, message: { kind: "error", text: vaultMessages.saveFailed } });
      return false;
    }
    setVault({ busy: false, hasSaved: true, phase: "unlocked", message: { kind: "success", text: wasUnlocked ? settings.changed : settings.sealed } });
    return true;
  }

  /** Close the history: forget the passphrase and every result held in memory. */
  async function closeHistory(): Promise<void> {
    await chain;
    passphrase = null;
    store.dispatch({ type: "locked" });
    resetAnalysisCache();
  }

  /** The person pressed Lock: the screen is cleared, and so is the command output, with its files. */
  async function lock(): Promise<void> {
    await closeHistory();
    deps.onWipe?.();
  }

  // ------------------------------------------------------- commands that save ---

  /** The sealed bytes as they were when the last command started, to tell afterwards whether it changed them. */
  let before: Uint8Array | null = null;

  const readVault = async (): Promise<Uint8Array | null> => {
    try {
      return await deps.vault.read();
    } catch {
      return null;
    }
  };

  async function beforeStoreRun(): Promise<void> {
    // An open history is locked first: it holds the passphrase and saves on every change, which would write over the command's file.
    // Not lock(): the command that is starting must keep its own output.
    if (store.get().vault.phase === "unlocked") await closeHistory();
    before = await readVault();
  }

  async function afterStoreRun(): Promise<void> {
    const after = await readVault();
    const previous = before;
    before = null;
    if (after === null) return;
    const changed = previous === null || previous.length !== after.length || previous.some((byte, i) => byte !== after[i]);
    if (!changed) return;
    // Whatever was on the page before stays in memory and joins the saved history when it is unlocked.
    setVault({ hasSaved: true, phase: "locked", message: { kind: "success", text: vaultMessages.historyUpdated } });
  }

  async function deleteAll(): Promise<boolean> {
    // Without a passphrase no save can start, so an edit made while the delete is pending cannot
    // write the sealed data back after it is gone. Saves already running finish first.
    const previous = passphrase;
    passphrase = null;
    await chain;
    try {
      await deps.vault.clear();
    } catch {
      passphrase = previous;
      if (previous !== null) void requestSave(); // edits made during the attempt were skipped
      setVault({ message: { kind: "error", text: settings.deleteFailed } });
      return false;
    }
    store.dispatch({ type: "wiped" });
    resetAnalysisCache();
    deps.onWipe?.();
    setVault({ message: { kind: "success", text: settings.deleted } });
    return true;
  }

  return {
    init,
    importZips,
    loadSample,
    clearSample() {
      store.dispatch({ type: "sample-cleared" });
      resetAnalysisCache();
    },
    keep: (username) => store.dispatch({ type: "keep", username }),
    unkeep: (username) => store.dispatch({ type: "unkeep", username }),
    toggleChecked: (username) => store.dispatch({ type: "toggle-checked", username }),
    clearChecked: () => store.dispatch({ type: "clear-checked" }),
    setTick: (id, on) => store.dispatch({ type: "tick", id, on }),
    setTheme(theme) {
      store.dispatch({ type: "theme", theme });
      deps.saveTheme(theme);
    },
    setExpectedFriendCount: (count) => store.dispatch({ type: "expected-friend-count", count }),
    setCapGiB: (gib) => store.dispatch({ type: "cap", gib }),
    setCleanupView: (patch) => store.dispatch({ type: "cleanup-view", patch }),
    unlock,
    sealWith,
    lock,
    deleteAll,
    beforeStoreRun,
    afterStoreRun,
    settled: () => chain,
  };
}
