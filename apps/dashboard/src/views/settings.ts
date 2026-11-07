import { licenses } from "snappy:licenses";
import { announce } from "../announce.ts";
import { brand, routes, settings, shell } from "../copy.ts";
import type { Theme, State } from "../reducer.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { button } from "../components/button.ts";
import { icon } from "../components/icon.ts";
import { columns, detailsBody, disclosureSummary, pageHeader, section, subsection } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { passphraseForm } from "../components/passphraseForm.ts";
import { region } from "../reactive.ts";
import type { View, ViewContext } from "./context.ts";

export const settingsView: View = (ctx) =>
  h(
    "div",
    { class: "view" },
    pageHeader(routes.settings.title, undefined, { icon: "settings" }),
    columns(themeSection(ctx), region(ctx.store, (s) => [s.vault], (s) => storageSection(ctx, s), { className: "region region-section" }), aboutSection()),
  );

/**
 * The theme control. It reads and writes the same state as the header toggle (the store, through
 * actions.setTheme), so the two always agree. A compact segmented control: Dark, Light, Match device.
 */
function themeSection(ctx: ViewContext): HTMLElement {
  const options: Theme[] = ["dark", "light", "system"];
  return region(
    ctx.store,
    (s) => [s.theme],
    (s) =>
      section(
        settings.themeHeading,
        h(
          "div",
          { class: "segmented segmented-theme", role: "group", "aria-label": settings.themeHeading },
          ...options.map((theme) => button({ label: settings.themes[theme], key: `theme:${theme}`, pressed: s.theme === theme, onclick: () => ctx.actions.setTheme(theme) })),
        ),
        h("p", {}, settings.themeNote),
      ),
    { className: "region region-section" },
  );
}

function storageSection(ctx: ViewContext, s: State): Child[] {
  const { vault } = s;
  const status = !vault.supported ? settings.storageUnsupported : vault.phase === "unlocked" ? settings.storageUnlocked : vault.phase === "locked" ? settings.storageLocked : settings.storageSession;
  const msg = vault.message;

  return [
    section(
      settings.storageHeading,
      // The sealed-history status shows here and nowhere else.
      vault.phase === "unlocked" ? h("p", {}, h("span", { class: "pill" }, icon("seal", 16), h("span", {}, shell.sealedOn))) : null,
      h("p", {}, status),
      msg ? notice(msg.kind, msg.text) : null,
      vault.supported && vault.phase !== "locked"
        ? passphraseForm({
            mode: "set",
            key: "set-pass",
            submitLabel: vault.phase === "unlocked" ? settings.changeButton : settings.setButton,
            busy: vault.busy,
            onSubmit: async (pass) => {
              const ok = await ctx.actions.sealWith(pass);
              if (ok) announce(ctx.store.get().vault.message?.text ?? settings.sealed);
              return ok;
            },
          })
        : null,
    ),
    vault.phase === "unlocked"
      ? section(
          settings.lockHeading,
          h("p", {}, settings.lockBody),
          button({
            label: shell.lockNow,
            icon: "seal",
            key: "lock-now",
            onclick: () => {
              void ctx.actions.lock().then(() => announce(settings.lockedAnnounce));
            },
          }),
        )
      : null,
    deleteSection(ctx),
  ];
}

/** Two steps inside the page, never window.confirm: a button, then a confirmation with the consequences. */
function deleteSection(ctx: ViewContext): HTMLElement {
  const box = h("div", { class: "delete" });

  const showStart = (): void => {
    box.replaceChildren(
      h("p", {}, settings.deleteBody),
      button({ label: settings.deleteButton, variant: "danger", icon: "remove", key: "delete-start", onclick: showConfirm }),
    );
  };

  const showConfirm = (): void => {
    const cancel = button({
      label: settings.deleteCancel,
      key: "delete-cancel",
      onclick: () => {
        showStart();
        box.querySelector<HTMLElement>("[data-key=delete-start]")?.focus();
      },
    });
    box.replaceChildren(
      h(
        "div",
        { class: "confirm", role: "group", "aria-labelledby": "delete-confirm-title" },
        h("h3", { id: "delete-confirm-title", class: "subheading" }, settings.deleteConfirmTitle),
        h("p", {}, settings.deleteConfirmBody),
        h(
          "div",
          { class: "actions" },
          button({
            label: settings.deleteConfirm,
            variant: "danger",
            icon: "remove",
            key: "delete-confirm",
            onclick: () => {
              void ctx.actions.deleteAll().then((ok) => announce(ok ? settings.deleted : settings.deleteFailed, !ok));
            },
          }),
          cancel,
        ),
      ),
    );
    // Cancel is the safe default: focus lands there, not on the destructive button.
    cancel.focus();
  };

  showStart();
  return section(settings.deleteHeading, box);
}

function aboutSection(): HTMLElement {
  return section(
    settings.aboutHeading,
    h("p", {}, settings.aboutBody),
    h("p", { class: "caption" }, settings.versionLabel(brand.version)),
    subsection(
      settings.licensesHeading,
      h("p", {}, settings.licensesBody),
      h(
        "div",
        { class: "licenses" },
        ...licenses.map((lib) =>
          h(
            "details",
            { class: "license" },
            disclosureSummary(lib.name),
            detailsBody(h("p", { class: "caption" }, `${lib.license}. ${lib.copyright}`), h("pre", { class: "code code-wrap" }, h("code", {}, lib.text))),
          ),
        ),
      ),
    ),
  );
}
