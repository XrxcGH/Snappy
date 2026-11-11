/**
 * The page frame: skip link, header (logo, theme toggle, menu button), the sidebar and phone
 * menu, the sample-data strip, and the footer with the legal line. It is built here, not in
 * main.ts, so tests can render the same frame the page uses.
 */
import { button } from "./components/button.ts";
import { CATEGORY_ICON } from "./components/category.ts";
import type { CategoryId } from "./components/category.ts";
import { icon, logoMark } from "./components/icon.ts";
import type { IconName } from "./components/icon.ts";
import { themeToggle } from "./components/themeToggle.ts";
import { announce } from "./announce.ts";
import { brand, routes, shell } from "./copy.ts";
import type { RouteId } from "./copy.ts";
import { shellCopy } from "./copy-shell.ts";
import { h } from "./dom.ts";
import { installKeys, openShortcuts } from "./keys.ts";
import { platform } from "./platform.ts";
import { region } from "./reactive.ts";
import type { Theme } from "./reducer.ts";
import type { Store } from "./store.ts";
import { shellToastHost } from "./components/toast.ts";
import { navigate } from "./views/context.ts";
import type { ViewContext } from "./views/context.ts";

interface NavItem {
  id: RouteId;
  icon: IconName;
  /** Finding areas carry their category color on the nav glyph. */
  category?: CategoryId;
}

interface NavGroup {
  /** Heading text and element id; the first group has none. */
  label?: { id: string; text: string };
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    items: [
      { id: "start", icon: "import" },
      { id: "overview", icon: "overview" },
      // One item for all the tools: a tool's page keeps it marked, so the menu never grows with the tool count.
      { id: "tools", icon: "tools" },
    ],
  },
  {
    label: { id: "nav-findings", text: shell.navFindings },
    items: [
      { id: "disappeared", icon: CATEGORY_ICON.disappeared, category: "disappeared" },
      { id: "requests", icon: CATEGORY_ICON.requests, category: "requests" },
      { id: "quiet", icon: CATEGORY_ICON.quiet, category: "quiet" },
      { id: "cleanup", icon: CATEGORY_ICON.cleanup, category: "cleanup" },
    ],
  },
  {
    // The rescue finds nothing to review, so it does not sit under Findings: it copies photos and videos out of the export.
    label: { id: "nav-memories", text: shellCopy.navMemories },
    items: [{ id: "memories", icon: CATEGORY_ICON.memories, category: "memories" }],
  },
  {
    label: { id: "nav-more", text: shell.navMore },
    items: [
      { id: "guide", icon: "guide" },
      { id: "privacy", icon: "seal" },
      { id: "settings", icon: "settings" },
    ],
  },
];

/** The footer's second line, in an installed beta only: the build's version, so a bug report can name it. Nothing in the web build. */
const betaLine = (): HTMLElement | null => {
  const release = platform().release;
  return release?.beta ? h("p", { class: "caption" }, shell.betaLine(release.version)) : null;
};

/** A quiet footer button that opens the list of keyboard shortcuts. The stylesheet shows it only where a keyboard is likely (wide windows with a pointer). */
const shortcutsHint = (): HTMLElement =>
  h("div", { class: "footer-keys" }, h("kbd", { class: "key", "aria-hidden": "true" }, "?"), button({ label: shellCopy.showShortcutsButton, variant: "quiet", key: "footer-shortcuts", onclick: () => openShortcuts() }));

/** Put the chosen theme on the page. "Match device" removes the attribute, so the device decides. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** Keep the page's theme attribute in step with the store, whichever control changed it. */
export function followTheme(store: Store): void {
  applyTheme(store.get().theme);
  store.subscribe((s, p) => {
    if (s.theme !== p.theme) applyTheme(s.theme);
  });
}

export interface Shell {
  /** Where the router puts the current view. */
  outlet: HTMLElement;
  /** Call after each navigation: marks the current menu item and closes the phone menu. */
  onRoute: (id: RouteId) => void;
}

export function buildShell(root: HTMLElement, ctx: ViewContext): Shell {
  const { store, actions } = ctx;

  // The sample-data strip lives inside <main>, so the skip link and landmark navigation reach it.
  const outlet = h("div", { class: "outlet" });
  const navLinks = new Map<RouteId, HTMLAnchorElement>();
  const navParts: HTMLElement[] = [];
  for (const group of NAV) {
    const list = h("ul", { class: "nav-group", "aria-labelledby": group.label?.id });
    for (const item of group.items) {
      const cls = item.category ? `nav-link nav-link-cat cat-${item.category}` : "nav-link";
      const link = h("a", { class: cls, href: `#/${item.id}` }, icon(item.icon, 20), h("span", {}, routes[item.id].label));
      navLinks.set(item.id, link);
      list.appendChild(h("li", {}, link));
    }
    if (group.label) navParts.push(h("p", { class: "nav-label", id: group.label.id }, group.label.text));
    navParts.push(list);
  }
  const nav = h("nav", { id: "site-nav", class: "nav", "aria-label": shell.mainNav }, ...navParts);

  const menu = button({ label: shell.menu, icon: "list", key: "menu", ariaLabel: shell.menu });
  menu.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-controls", "site-nav");
  menu.classList.add("menu-button");
  const setMenu = (open: boolean): void => {
    nav.dataset.open = String(open);
    menu.setAttribute("aria-expanded", String(open));
  };
  menu.addEventListener("click", () => setMenu(nav.dataset.open !== "true"));
  // Escape closes the open menu from inside it and from the Menu button itself (where focus stays after opening it).
  const closeOnEscape = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && nav.dataset.open === "true") {
      setMenu(false);
      menu.focus();
    }
  };
  nav.addEventListener("keydown", closeOnEscape);
  menu.addEventListener("keydown", closeOnEscape);

  // One slim line: what this is, and a small Clear button. Sample data is never saved.
  const sampleStrip = region(
    store,
    (s) => [s.sample !== null],
    (s) =>
      s.sample
        ? h(
            "div",
            { class: "banner banner-slim", role: "note" },
            // The short words show on phones, the full line from about 640 px (the stylesheet swaps them), so the strip stays one row.
            h("p", { class: "banner-text" }, icon("info", 16), h("span", { class: "banner-long" }, shell.sampleStrip), h("span", { class: "banner-short" }, shell.sampleStripShort)),
            button({
              label: shell.clearSampleShort,
              ariaLabel: shell.clearSample,
              variant: "secondary",
              className: "banner-clear",
              key: "clear-sample",
              onclick: () => {
                actions.clearSample();
                announce(shell.sampleCleared);
                // The strip, and the button with it, is gone: focus goes to the page heading, as after a page change.
                outlet.querySelector<HTMLElement>("#page-title")?.focus({ preventScroll: true });
              },
            }),
          )
        : null,
    { className: "banner-slot" },
  );

  const main = h("main", { id: "main", class: "main", tabindex: "-1" }, sampleStrip, outlet);
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
      // The inner row has the same width and centering as the page shell, so the logo lines up with the
      // menu and the toggle lines up with the right edge of the content column.
      h(
        "div",
        { class: "site-header-inner" },
        h("a", { class: "brand", href: "#/start", "aria-label": `${brand.name}: ${routes.start.label}` }, logoMark(32), h("span", { class: "wordmark" }, brand.name)),
        // Logo on the left; theme toggle and menu button on the right. Nothing else lives here: the
        // session and sealed-history status are shown only where they matter (Start and Settings).
        h("div", { class: "header-actions" }, themeToggle(store, actions), menu),
      ),
    ),
    h("div", { class: "layout" }, nav, h("div", { class: "content" }, main)),
    // The legal line appears once on every page, here. No page repeats it. It starts at the content column.
    h("footer", { class: "site-footer" }, h("div", { class: "site-footer-inner" }, h("p", { class: "caption" }, brand.nonAffiliation), betaLine(), shortcutsHint())),
    // A page that draws no toast host of its own still shows the note after a copy or a save here.
    shellToastHost(),
  );

  // One listener for the whole app: ? lists the shortcuts, / jumps to the search box, g then a letter goes to a page.
  if (typeof window !== "undefined") installKeys(window, { go: navigate });

  return {
    outlet,
    onRoute(id) {
      for (const [route, link] of navLinks) {
        if (route === id) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
      setMenu(false);
    },
  };
}
