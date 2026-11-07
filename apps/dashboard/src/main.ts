import { createActions } from "./actions.ts";
import { announce } from "./announce.ts";
import { browserImport } from "./browser-import.ts";
import { button } from "./components/button.ts";
import { icon, logoMark } from "./components/icon.ts";
import type { IconName } from "./components/icon.ts";
import { brand, routes, shell } from "./copy.ts";
import type { RouteId } from "./copy.ts";
import { h } from "./dom.ts";
import { region } from "./reactive.ts";
import { initialState } from "./reducer.ts";
import type { Theme } from "./reducer.ts";
import { startRouter } from "./router.ts";
import { createStore } from "./store.ts";
import { browserVault, readThemePreference, writeThemePreference } from "./vault.ts";
import type { ViewContext } from "./views/context.ts";

const NAV: { id: RouteId; icon: IconName }[] = [
  { id: "start", icon: "import" },
  { id: "overview", icon: "search" },
  { id: "disappeared", icon: "vanished" },
  { id: "requests", icon: "one-way" },
  { id: "quiet", icon: "quiet" },
  { id: "cleanup", icon: "queue" },
  { id: "memories", icon: "memories" },
  { id: "guide", icon: "file-zip" },
  { id: "privacy", icon: "content-blind" },
  { id: "settings", icon: "settings" },
];

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

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

  // Apply the remembered theme before the first paint of the shell.
  const remembered = readThemePreference();
  if (remembered === "light" || remembered === "dark") applyTheme(remembered);
  store.subscribe((s, p) => {
    if (s.theme !== p.theme) applyTheme(s.theme);
  });

  // A file dropped outside the drop zone would make the browser open it and leave the page.
  for (const type of ["dragover", "drop"]) window.addEventListener(type, (e) => e.preventDefault());

  // The sample-data banner lives inside <main>, so the skip link and landmark navigation reach it.
  const outlet = h("div", { class: "outlet" });
  const navList = h("ul", { class: "nav-list" });
  const navLinks = new Map<RouteId, HTMLAnchorElement>();
  for (const item of NAV) {
    const link = h("a", { class: "nav-link", href: `#/${item.id}` }, icon(item.icon, 20), h("span", {}, routes[item.id].label));
    navLinks.set(item.id, link);
    navList.appendChild(h("li", {}, link));
  }
  const nav = h("nav", { id: "site-nav", class: "nav", "aria-label": shell.mainNav }, navList);

  const menu = button({ label: shell.menu, icon: "queue", key: "menu", ariaLabel: shell.menu });
  menu.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-controls", "site-nav");
  menu.classList.add("menu-button");
  const setMenu = (open: boolean): void => {
    nav.dataset.open = String(open);
    menu.setAttribute("aria-expanded", String(open));
  };
  menu.addEventListener("click", () => setMenu(nav.dataset.open !== "true"));
  nav.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.dataset.open === "true") {
      setMenu(false);
      menu.focus();
    }
  });

  const status = region(
    store,
    (s) => [s.vault.phase, s.vault.supported],
    (s) => {
      if (s.vault.phase === "unlocked") {
        return [
          h("span", { class: "status-pill" }, icon("seal", 16), h("span", {}, shell.statusUnlocked)),
          button({ label: shell.lockNow, key: "header-lock", onclick: () => void actions.lock().then(() => announce(shell.lockedShort)) }),
        ];
      }
      return [h("span", { class: "status-pill" }, icon("seal", 16), h("span", {}, s.vault.phase === "locked" ? shell.statusLocked : shell.statusSession))];
    },
    { className: "header-status" },
  );

  const sampleBanner = region(
    store,
    (s) => [s.sample !== null],
    (s) =>
      s.sample
        ? h(
            "div",
            { class: "banner", role: "note" },
            h("p", {}, h("strong", {}, `${shell.sampleLabel} `), shell.sampleBanner),
            button({
              label: shell.clearSample,
              key: "clear-sample",
              onclick: () => {
                actions.clearSample();
                announce(shell.sampleCleared);
              },
            }),
          )
        : null,
    { className: "banner-slot" },
  );

  const main = h("main", { id: "main", class: "main", tabindex: "-1" }, sampleBanner, outlet);
  const skip = h("a", { class: "skip-link", href: "#main" }, shell.skipLink);
  skip.addEventListener("click", (e) => {
    e.preventDefault();
    main.focus();
  });

  root.replaceChildren(
    skip,
    h(
      "header",
      { class: "site-header" },
      h("a", { class: "brand", href: "#/start", "aria-label": `${brand.name}: ${routes.start.label}` }, logoMark(32), h("span", { class: "wordmark" }, brand.name)),
      status,
      menu,
    ),
    h("div", { class: "layout" }, nav, h("div", { class: "content" }, main)),
    h("footer", { class: "site-footer" }, h("p", { class: "caption" }, brand.nonAffiliation)),
  );

  startRouter(outlet, ctx, (id) => {
    for (const [route, link] of navLinks) {
      if (route === id) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    setMenu(false);
  });

  void actions.init(remembered);
}

boot();
