import { licenses } from "snappy:licenses";
import { announce } from "../announce.ts";
import { brand, routes, settings, shell } from "../copy.ts";
import { shellCopy, whatsNew } from "../copy-shell.ts";
import { REPOSITORY_ADDRESS, buildDiagnostics } from "../diagnostics.ts";
import { openShortcuts } from "../keys.ts";
import type { Theme, State } from "../reducer.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { saveBlob } from "../download.ts";
import { formatDate } from "../format.ts";
import { HISTORY_FILE_NAME, buildHistoryFile, hasHistory, readHistoryFile } from "../history-file.ts";
import type { Snapshot } from "@snappy-export/core";
import { button } from "../components/button.ts";
import { icon } from "../components/icon.ts";
import { columns, detailsBody, disclosureSummary, pageHeader, section, subsection } from "../components/layout.ts";
import { copyTextButton } from "../components/listActions.ts";
import { notice } from "../components/notice.ts";
import { platform } from "../platform.ts";
import { passphraseForm } from "../components/passphraseForm.ts";
import { region } from "../reactive.ts";
import type { View, ViewContext } from "./context.ts";

export const settingsView: View = (ctx) =>
  h(
    "div",
    { class: "view" },
    pageHeader(routes.settings.title, undefined, { icon: "settings" }),
    columns(themeSection(ctx), region(ctx.store, (s) => [s.vault], (s) => storageSection(ctx, s), { className: "region region-section" }), historySection(ctx), historyFileSection(ctx), helpSection(ctx), aboutSection()),
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
          ...options.map((theme) =>
            button({
              label: settings.themes[theme],
              key: `theme:${theme}`,
              pressed: s.theme === theme,
              // The buttons are drawn again when the theme changes (the key keeps focus on the same one), so the change is said here, as the header toggle says it.
              onclick: () => {
                ctx.actions.setTheme(theme);
                announce(theme === "dark" ? shell.themeChangedDark : theme === "light" ? shell.themeChangedLight : shellCopy.themeMatchAnnounce);
              },
            }),
          ),
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
    const cancelDelete = (): void => {
      showStart();
      box.querySelector<HTMLElement>("[data-key=delete-start]")?.focus();
    };
    const cancel = button({ label: settings.deleteCancel, key: "delete-cancel", onclick: cancelDelete });
    const confirm = h(
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
    );
    // Escape cancels, as it does on the terminal's confirm card and the passphrase prompt.
    confirm.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") {
        e.preventDefault();
        cancelDelete();
      }
    });
    box.replaceChildren(confirm);
    // Cancel is the safe default: focus lands there, not on the destructive button.
    cancel.focus();
  };

  showStart();
  return section(settings.deleteHeading, box);
}

/**
 * The saved history as a list of the exports in it: the date and how many friends, never a name. Each can be deleted
 * in two steps, like Delete data. It shows the real history (the sample has none), and nothing while the history is locked.
 */
function historySection(ctx: ViewContext): HTMLElement {
  return region(
    ctx.store,
    (s) => [s.real.ledger, s.vault.phase],
    (s) => {
      if (s.vault.phase === "locked") return null;
      const snapshots = [...s.real.ledger.snapshots].sort((a, b) => b.takenAt - a.takenAt);
      return section(
        shellCopy.historyHeading,
        h("p", {}, shellCopy.historyNote),
        snapshots.length === 0 ? h("p", {}, shellCopy.historyEmpty) : h("ul", { class: "history-list" }, ...snapshots.map((snap) => historyRow(ctx, snap))),
      );
    },
    { className: "region region-section" },
  );
}

function historyRow(ctx: ViewContext, snap: Snapshot): HTMLElement {
  const date = formatDate(snap.takenAt);
  const slot = h("div", { class: "history-actions" });
  // Set while the confirmation is showing, so Escape knows there is something to cancel.
  let asking = false;
  const showDelete = (focus: boolean): void => {
    asking = false;
    const start = button({ label: shellCopy.historyDeleteButton, ariaLabel: shellCopy.historyDeleteFor(date), icon: "remove", key: `history-delete:${snap.id}`, onclick: showConfirm });
    slot.replaceChildren(start);
    if (focus) start.focus();
  };
  const showConfirm = (): void => {
    asking = true;
    const cancel = button({ label: shellCopy.historyCancelButton, key: `history-cancel:${snap.id}`, onclick: () => showDelete(true) });
    const confirm = button({
      label: shellCopy.historyConfirmButton,
      variant: "danger",
      icon: "remove",
      key: `history-confirm:${snap.id}`,
      onclick: () => {
        ctx.store.dispatch({ type: "snapshot-removed", id: snap.id });
        announce(shellCopy.historyDeletedAnnounce);
      },
    });
    slot.replaceChildren(h("p", { class: "caption" }, shellCopy.historyConfirmNote(date)), h("div", { class: "actions" }, confirm, cancel));
    // Cancel is the safe default, as in Delete data.
    cancel.focus();
  };
  // Escape cancels, as it does everywhere else a confirmation asks.
  slot.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape" && asking) {
      e.preventDefault();
      showDelete(true);
    }
  });
  showDelete(false);
  return h("li", { class: "history-row" }, h("span", { class: "history-what" }, shellCopy.historyRow(date, snap.friends.length)), slot);
}

/**
 * The history as a file: Save history file seals it with a passphrase typed here, and Open history file adds a chosen
 * file's exports, keep list and checkmarks to what is on screen (an unlocked history then saves them like any edit).
 * Nothing is shown while the history is locked: there is nothing on screen to save or to add to.
 */
function historyFileSection(ctx: ViewContext): HTMLElement {
  return region(
    ctx.store,
    (s) => [s.real.ledger, s.real.allowlist, s.real.checkedOff, s.real.ticks, s.vault.phase],
    (s) => {
      if (s.vault.phase === "locked") return null;
      return section(
        shellCopy.fileHeading,
        h("p", {}, shellCopy.fileNote),
        subsection(
          shellCopy.fileSaveHeading,
          hasHistory(s.real)
            ? passphraseForm({
                mode: "set",
                key: "history-file-save",
                submitLabel: shellCopy.fileSaveButton,
                busy: false,
                onSubmit: async (pass) => {
                  try {
                    const bytes = await buildHistoryFile(ctx.store.get().real, pass);
                    const saved = saveBlob(HISTORY_FILE_NAME, new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }));
                    announce(saved ? shellCopy.fileSavedAnnounce : shellCopy.fileSaveFailedNote, !saved);
                    return saved;
                  } catch {
                    announce(shellCopy.fileSaveFailedNote, true);
                    return false;
                  }
                },
              })
            : h("p", {}, shellCopy.fileNothingNote),
        ),
        subsection(shellCopy.fileOpenHeading, openFileBox(ctx)),
      );
    },
    { className: "region region-section" },
  );
}

/** Choose a history file, then its passphrase. The file is read in memory and forgotten; its name is never shown. */
function openFileBox(ctx: ViewContext): HTMLElement {
  const box = h("div", { class: "history-open" });
  const picker = h("input", { type: "file", accept: ".sealed,application/octet-stream", hidden: true, "aria-hidden": "true", tabindex: "-1" });
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = ""; // lets the same file be chosen again
    if (file) showAsk(file);
  });

  const showChoose = (focus: boolean): void => {
    const choose = button({ label: shellCopy.fileChooseButton, icon: "import", key: "history-file-choose", onclick: () => picker.click() });
    box.replaceChildren(choose, picker);
    if (focus) choose.focus();
  };

  const showAsk = (file: Blob): void => {
    const status = h("div", { class: "history-open-status" });
    const form = passphraseForm({
      mode: "unlock",
      key: "history-file-open",
      submitLabel: shellCopy.fileOpenButton,
      busy: false,
      onSubmit: async (pass) => {
        status.replaceChildren();
        const result = await readHistoryFile(file, pass);
        if (!result.ok) {
          const text = result.problem === "passphrase" ? shellCopy.fileWrongNote : shellCopy.fileUnreadableNote;
          status.replaceChildren(notice("error", text));
          announce(text, true);
          return false;
        }
        // The browser's clock is only used when no export was read yet; see the reducer.
        ctx.store.dispatch({ type: "history-merged", saved: result.saved, now: Date.now() });
        announce(shellCopy.fileOpenedAnnounce);
        showChoose(false);
        return true;
      },
    });
    const cancel = button({ label: shellCopy.fileCancelButton, variant: "quiet", key: "history-file-cancel", onclick: () => showChoose(true) });
    box.replaceChildren(h("p", {}, shellCopy.fileChosenNote), status, form, h("div", { class: "actions" }, cancel));
    form.querySelector<HTMLElement>("input")?.focus();
  };
  // Escape backs out of the passphrase question, as it does everywhere a question is asked.
  box.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape" && box.querySelector("form")) {
      e.preventDefault();
      showChoose(true);
    }
  });

  showChoose(false);
  return box;
}

/**
 * Help and feedback: Copy diagnostics (version, system, counts, never names), the repository address as text to copy
 * (the desktop app cannot open links), and what is new in the version that is running.
 */
function helpSection(ctx: ViewContext): HTMLElement {
  const entry = whatsNew.find((w) => w.version === (platform().release?.version ?? brand.version));
  return section(
    shellCopy.helpHeading,
    h("p", {}, shellCopy.diagnosticsNote),
    h(
      "div",
      { class: "actions" },
      copyTextButton({ label: shellCopy.copyDiagnosticsButton, key: "copy-diagnostics", done: shellCopy.diagnosticsCopiedAnnounce, text: () => buildDiagnostics(ctx.store.get(), platform(), typeof navigator === "undefined" ? {} : navigator) }),
      button({ label: shellCopy.showShortcutsButton, key: "show-shortcuts", onclick: () => openShortcuts() }),
    ),
    h("p", {}, shellCopy.reportNote),
    h("p", {}, `${shellCopy.repositoryLabel}: `, h("code", { class: "repository" }, REPOSITORY_ADDRESS)),
    h("div", { class: "actions" }, copyTextButton({ label: shellCopy.copyAddressButton, key: "copy-address", done: shellCopy.addressCopiedAnnounce, text: () => REPOSITORY_ADDRESS })),
    entry ? subsection(shellCopy.whatsNewHeading, h("ul", { class: "plain-list" }, ...entry.lines.map((line) => h("li", {}, line)))) : null,
  );
}

function aboutSection(): HTMLElement {
  return section(
    settings.aboutHeading,
    h("p", {}, settings.aboutBody),
    h("p", { class: "caption" }, settings.versionLabel(platform().release?.version ?? brand.version)),
    subsection(
      settings.licensesHeading,
      h("p", {}, settings.licensesBody),
      h(
        "div",
        { class: "licenses" },
        ...licenses.map((lib, i) => {
          const summary = disclosureSummary(lib.name);
          summary.setAttribute("id", `license-${i}-name`);
          return h(
            "details",
            { class: "license" },
            summary,
            detailsBody(
              h("p", { class: "caption" }, `${lib.license}. ${lib.copyright}`),
              h("span", { class: "sr-only", id: `license-${i}-for` }, shellCopy.licenseTextLabel),
              // The text scrolls inside a fixed height, so a keyboard must reach it and it needs a name (WebKit does not make scrollers
              // focusable by itself). The name is "License text for" and the library's name from the summary above it.
              h("pre", { class: "code code-wrap", tabindex: "0", role: "region", "aria-labelledby": `license-${i}-for license-${i}-name` }, h("code", {}, lib.text)),
            ),
          );
        }),
      ),
    ),
  );
}
