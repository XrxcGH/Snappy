import { licenses } from "snappy:licenses";
import { announce } from "../announce.ts";
import { brand, routes, settings, shell } from "../copy.ts";
import type { Theme, State } from "../reducer.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { button } from "../components/button.ts";
import { disclosureSummary, pageHeader, section } from "../components/layout.ts";
import { notice } from "../components/notice.ts";
import { passphraseForm } from "../components/passphraseForm.ts";
import { region } from "../reactive.ts";
import type { View, ViewContext } from "./context.ts";

export const settingsView: View = (ctx) =>
  h(
    "div",
    { class: "view" },
    pageHeader(routes.settings.title),
    themeSection(ctx),
    region(ctx.store, (s) => [s.vault], (s) => storageSection(ctx, s), { className: "region region-section" }),
    aboutSection(),
  );

function themeSection(ctx: ViewContext): HTMLElement {
  const current = ctx.store.get().theme;
  const options: Theme[] = ["system", "light", "dark"];
  return section(
    settings.themeHeading,
    h(
      "fieldset",
      { class: "fieldset" },
      h("legend", { class: "label" }, settings.themeLegend),
      ...options.map((theme) => {
        const input = h("input", { type: "radio", name: "theme", value: theme, class: "check-input", checked: theme === current, "data-key": `theme:${theme}` });
        input.addEventListener("change", () => ctx.actions.setTheme(theme));
        return h("label", { class: "check" }, input, h("span", {}, settings.themes[theme]));
      }),
    ),
  );
}

function storageSection(ctx: ViewContext, s: State): Child[] {
  const { vault } = s;
  const status = !vault.supported ? settings.storageUnsupported : vault.phase === "unlocked" ? settings.storageUnlocked : vault.phase === "locked" ? settings.storageLocked : settings.storageSession;
  const msg = vault.message;

  return [
    section(
      settings.storageHeading,
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
    h("p", { class: "caption muted" }, settings.versionLabel(brand.version)),
    h("p", { class: "caption muted" }, brand.nonAffiliation),
    h("h3", { class: "subheading" }, settings.licensesHeading),
    h("p", {}, settings.licensesBody),
    h(
      "div",
      { class: "licenses" },
      ...licenses.map((lib) =>
        h(
          "details",
          { class: "license" },
          disclosureSummary(`${lib.name}: ${lib.license}`),
          h("p", { class: "caption muted" }, lib.copyright),
          h("pre", { class: "code code-wrap" }, h("code", {}, lib.text)),
        ),
      ),
    ),
  );
}
