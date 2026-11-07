import { createActions } from "./actions.ts";
import { applyTheme, buildShell, followTheme } from "./app-shell.ts";
import { browserImport } from "./browser-import.ts";
import { importRunner } from "./platform.ts";
import { initialState } from "./reducer.ts";
import { startRouter } from "./router.ts";
import { createStore } from "./store.ts";
import { createTerminalSession } from "./terminal/session.ts";
import { terminalWorkerSource } from "snappy:terminal-worker";
import { browserVault, readThemePreference, writeThemePreference } from "./vault.ts";
import { spawnBlobChannel } from "./worker-runner.ts";
import type { ToWorker } from "./terminal/protocol.ts";
import type { ViewContext } from "./views/context.ts";

// The page ships with data-theme="dark" on <html>, so the first paint is dark with no script at
// all. A remembered light or "match device" choice is applied here, before the shell is built.
const remembered = readThemePreference();
if (remembered === "light" || remembered === "dark" || remembered === "system") applyTheme(remembered);

function boot(): void {
  const root = document.getElementById("app");
  if (!root) return;

  const store = createStore(initialState());
  const actions = createActions(store, {
    vault: browserVault,
    clock: () => Date.now(),
    // A short timer, not requestAnimationFrame: hidden tabs never run animation frames, which would stall an import.
    yieldToUi: () => new Promise((resolve) => setTimeout(resolve, 20)),
    saveTheme: writeThemePreference,
    // A native shell can swap the reader. It is looked up on each call, not once here.
    runImport: importRunner(browserImport),
    // Lock and Delete data clear the command output and the picked export files too.
    onWipe: () => terminal.reset(),
  });
  // The command blocks: each Run starts its own helper, from the same blob: rule as the background reader.
  const terminal = createTerminalSession({
    spawn: () => spawnBlobChannel<ToWorker, unknown>(terminalWorkerSource),
    vault: browserVault,
    vaultPhase: () => store.get().vault.phase,
    beforeStoreRun: () => actions.beforeStoreRun(),
    afterStoreRun: () => actions.afterStoreRun(),
  });
  const ctx: ViewContext = { store, actions, terminal };

  // Restore a remembered theme into the store first (dark when nothing was remembered), so the
  // header toggle and the Settings control start from the same state as the page.
  if (remembered === "light" || remembered === "dark" || remembered === "system") store.dispatch({ type: "theme", theme: remembered });
  // The header toggle and the Settings control both change store.theme; this keeps the page in step.
  followTheme(store);

  // A file dropped outside the drop zone would make the browser open it and leave the page.
  for (const type of ["dragover", "drop"]) window.addEventListener(type, (e) => e.preventDefault());

  const shell = buildShell(root, ctx);
  startRouter(shell.outlet, ctx, shell.onRoute);

  void actions.init(remembered);
}

boot();
