import { createActions } from "./actions.ts";
import { applyTheme, buildShell, followTheme } from "./app-shell.ts";
import { browserImport } from "./browser-import.ts";
import { initialState } from "./reducer.ts";
import { startRouter } from "./router.ts";
import { createStore } from "./store.ts";
import { browserVault, readThemePreference, writeThemePreference } from "./vault.ts";
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
    runImport: browserImport,
  });
  const ctx: ViewContext = { store, actions };

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
