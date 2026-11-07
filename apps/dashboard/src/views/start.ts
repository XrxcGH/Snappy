import { announce } from "../announce.ts";
import { start, settings } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { button, routeLink } from "../components/button.ts";
import { icon } from "../components/icon.ts";
import { section } from "../components/layout.ts";
import { issueNotice, notice } from "../components/notice.ts";
import { passphraseForm } from "../components/passphraseForm.ts";
import { progressBar, updateProgress } from "../components/progressBar.ts";
import { onDispose, region } from "../reactive.ts";
import type { State } from "../reducer.ts";
import type { Store } from "../store.ts";
import { parseFriendCount } from "../parse-input.ts";
import { navigate } from "./context.ts";
import type { View, ViewContext } from "./context.ts";

export const startView: View = (ctx) => {
  const { store } = ctx;

  return h(
    "div",
    { class: "view view-start" },
    hero(),
    region(store, (s) => [s.vault.phase, s.vault.busy, s.vault.message], (s) => unlockCard(ctx, s)),
    // Before the steps, so the advice to seal a history comes before the first import, not after it.
    region(store, (s) => [s.vault.phase, s.vault.supported], (s) => storageNote(s)),
    getExportSection(),
    countSection(ctx),
    addSection(ctx),
    sampleSection(ctx),
  );
};

function hero(): HTMLElement {
  return h(
    "header",
    { class: "page-header hero" },
    h("div", { class: "hero-icon" }, icon("content-blind", 48)),
    h("h1", { id: "page-title", tabindex: "-1" }, start.promiseTitle),
    h("p", { class: "lead" }, start.promiseLead),
    h("p", {}, start.promiseMore, " ", h("a", { href: "#/privacy" }, start.privacyLink), "."),
  );
}

function unlockCard(ctx: ViewContext, s: State): Child {
  if (s.vault.phase !== "locked") return null;
  const msg = s.vault.message;
  return h(
    "section",
    { class: "card card-pad", "aria-labelledby": "unlock-title" },
    h("h2", { id: "unlock-title", class: "section-title" }, h("span", { class: "title-icon" }, icon("seal", 24)), start.unlockHeading),
    h("p", {}, start.unlockBody),
    passphraseForm({
      mode: "unlock",
      key: "unlock",
      submitLabel: s.vault.busy ? start.unlocking : start.unlockButton,
      busy: s.vault.busy,
      onSubmit: async (pass) => {
        const ok = await ctx.actions.unlock(pass);
        if (ok) {
          announce(start.unlockedAnnounce);
          if (ctx.store.get().real.ledger.snapshots.length > 0) navigate("overview");
        } else {
          const problem = ctx.store.get().vault.message?.text;
          if (problem) announce(problem, true);
        }
        return ok;
      },
    }),
    msg ? notice(msg.kind, msg.text) : null,
    h("p", { class: "caption muted" }, start.unlockSkip),
  );
}

function getExportSection(): HTMLElement {
  return section(
    start.exportHeading,
    h("p", {}, start.exportBody),
    h("ul", { class: "plain-list" }, ...start.exportPoints.map((p) => h("li", {}, p))),
    h("p", {}, routeLink("guide", start.exportGuideLink)),
  );
}

function countSection(ctx: ViewContext): HTMLElement {
  const input = h("input", {
    id: "friend-count",
    class: "input input-narrow",
    type: "text",
    inputmode: "numeric",
    autocomplete: "off",
    "aria-describedby": "friend-count-help friend-count-error",
    "data-key": "friend-count",
    value: ctx.store.get().expectedFriendCount === null ? "" : String(ctx.store.get().expectedFriendCount),
  });
  // role=alert, like the other form errors, so a screen reader hears the problem as it is typed.
  const error = h("p", { class: "field-error", id: "friend-count-error", role: "alert" });
  input.addEventListener("input", () => {
    const parsed = parseFriendCount(input.value);
    if (parsed === undefined) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = start.countError;
      return;
    }
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    ctx.actions.setExpectedFriendCount(parsed);
  });
  return section(
    start.countHeading,
    h(
      "div",
      { class: "field" },
      h("label", { class: "label", for: "friend-count" }, start.countLabel),
      h("p", { class: "caption muted", id: "friend-count-help" }, start.countHelp),
      input,
      error,
    ),
  );
}

function addSection(ctx: ViewContext): HTMLElement {
  const { store, actions } = ctx;

  const run = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    announce(start.reading(0, files.length));
    const result = await actions.importZips(files);
    const s = store.get();
    if (result === "done") {
      announce(s.import.addedToHistory === false ? start.notAdded : start.readDone);
      navigate("overview");
    } else {
      announce(s.import.message ?? start.readFailed, true);
    }
  };

  const picker = h("input", { type: "file", accept: ".zip,application/zip", multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });
  picker.addEventListener("change", () => {
    const files = [...(picker.files ?? [])];
    picker.value = ""; // lets the same file be chosen again
    void run(files);
  });

  const dropzone = h(
    "div",
    { class: "dropzone" },
    icon("file-zip", 24),
    h("p", { class: "dropzone-title" }, start.dropTitle),
    h("p", { class: "caption muted" }, start.dropAlt),
    button({ label: start.choose, variant: "primary", icon: "import", key: "choose-files", onclick: () => picker.click() }),
  );
  const setActive = (on: boolean): void => void dropzone.classList.toggle("dropzone-active", on);
  dropzone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    setActive(true);
  });
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    setActive(true);
  });
  dropzone.addEventListener("dragleave", (e) => {
    if (!dropzone.contains(e.relatedTarget as Node | null)) setActive(false);
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    setActive(false);
    void run([...(e.dataTransfer?.files ?? [])]);
  });

  return section(
    start.addHeading,
    h("p", {}, start.addBody),
    dropzone,
    picker,
    // Not repainted on every progress tick: the reading status below updates itself in place.
    region(store, (s) => [s.import.phase, s.import.sample, s.import.message, s.import.issues, s.import.addedToHistory], (s) => importStatus(store, s)),
  );
}

/**
 * The reading status is built once and updated in place. A live region that is replaced on every
 * tick (up to a hundred of them) is announced inconsistently, and a replaced progress bar never
 * reports a change. The spoken line changes only with the part being read; the percentage is shown
 * but not spoken, and the bar carries it for assistive technology through aria-valuenow.
 */
function readingStatus(store: Store): HTMLElement {
  const spoken = h("p", { role: "status" });
  const percent = h("p", { class: "caption muted", "aria-hidden": "true" });
  const bar = progressBar({ label: start.progressLabel, value: null });
  const update = (s: State): void => {
    const imp = s.import;
    if (imp.phase !== "reading") return;
    const text = imp.sample ? start.readingSample(imp.step, imp.steps) : start.reading(imp.step, imp.steps, imp.fraction);
    const line = imp.sample ? text : start.reading(imp.step, imp.steps);
    if (spoken.textContent !== line) spoken.textContent = line;
    percent.textContent = !imp.sample && imp.fraction !== undefined && imp.fraction !== null ? start.readingPercent(imp.fraction) : "";
    // The bar shows the real share of the bytes read. Before the first measurement, or when there
    // is nothing to measure, parts count instead, and a single file stays "unknown" until it is done.
    const value = imp.sample ? imp.step / imp.steps : imp.fraction !== undefined && imp.fraction !== null ? imp.fraction : imp.steps > 1 ? imp.step / imp.steps : null;
    updateProgress(bar, { label: start.progressLabel, value, valueText: text });
  };
  update(store.get());
  onDispose(store.subscribe((s) => update(s)));
  return h("div", { class: "status" }, spoken, percent, bar);
}

function importStatus(store: Store, s: State): Child {
  const imp = s.import;
  if (imp.phase === "reading") return readingStatus(store);
  if (imp.phase === "failed") {
    const problems = imp.issues ?? [];
    return problems.length === 0
      ? notice("error", imp.message ?? start.readFailed)
      : h("div", { class: "stack" }, notice("error", imp.message ?? start.readFailed), ...problems.map(issueNotice));
  }
  if (imp.phase === "done" && !imp.sample) {
    return notice("success", imp.addedToHistory === false ? start.notAdded : start.readDoneShort);
  }
  return null;
}

function sampleSection(ctx: ViewContext): HTMLElement {
  return section(
    start.sampleHeading,
    h("p", {}, start.sampleBody),
    h(
      "div",
      { class: "actions" },
      button({
        label: start.sampleButton,
        icon: "search",
        key: "try-sample",
        onclick: () => {
          announce(start.readingSample(0, 3));
          void ctx.actions.loadSample().then((result) => {
            if (result === "done") {
              announce(start.sampleLoaded);
              navigate("overview");
            }
          });
        },
      }),
    ),
  );
}

function storageNote(s: State): Child {
  if (!s.vault.supported) return notice("warning", settings.storageUnsupported);
  if (s.vault.phase === "session") {
    return h(
      "section",
      { class: "card card-pad" },
      h("h2", { class: "section-title" }, start.sessionOnlyTitle),
      h("p", {}, start.sessionOnlyBody),
      h("p", {}, routeLink("settings", start.sessionOnlyAction)),
    );
  }
  return null;
}
