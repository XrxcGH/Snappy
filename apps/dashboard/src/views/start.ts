import type { NamedBlob } from "../actions.ts";
import { announce } from "../announce.ts";
import { common, routes, settings, start } from "../copy.ts";
import { h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { button, routeLink } from "../components/button.ts";
import { chipIcon } from "../components/category.ts";
import { icon } from "../components/icon.ts";
import type { IconName } from "../components/icon.ts";
import { pointList, stepSection } from "../components/layout.ts";
import { issueNotice, notice } from "../components/notice.ts";
import { passphraseForm } from "../components/passphraseForm.ts";
import { progressBar, updateProgress } from "../components/progressBar.ts";
import { platform } from "../platform.ts";
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
    hero(ctx),
    region(store, (s) => [s.vault.phase, s.vault.busy, s.vault.message], (s) => unlockCard(ctx, s)),
    // Before the steps, so the advice to seal a history comes before the first import, not after it.
    region(store, (s) => [s.vault.phase, s.vault.supported], (s) => storageNote(s)),
    h("div", { class: "step-list" }, getExportSection(), countSection(ctx), addSection(ctx)),
  );
};

function hero(ctx: ViewContext): HTMLElement {
  const [onDevice, neverOpens, noNetwork] = start.trustChips;
  const pill = (name: IconName, text: string): HTMLElement => h("span", { class: "pill" }, icon(name, 16), h("span", {}, text));
  return h(
    "header",
    { class: "page-header hero" },
    h(
      "div",
      { class: "page-header-main" },
      h("div", { class: "page-title-row" }, chipIcon("import", "lg"), h("h1", { id: "page-title", tabindex: "-1" }, routes.start.title)),
      h("p", { class: "lead" }, start.promiseLead),
      sampleAction(ctx),
    ),
    // The three promises sit under the lead, in the same column.
    h("div", { class: "trust-row" }, pill("device", onDevice), pill("content-blind", neverOpens), pill("shield", noNetwork)),
  );
}

function unlockCard(ctx: ViewContext, s: State): Child {
  if (s.vault.phase !== "locked") return null;
  const msg = s.vault.message;
  return h(
    "section",
    { class: "card card-pad card-tint card-split", "aria-labelledby": "unlock-title" },
    h("h2", { id: "unlock-title", class: "section-title" }, start.unlockHeading),
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
    h("p", {}, start.unlockSkip),
  );
}

function getExportSection(): HTMLElement {
  return stepSection(
    1,
    start.exportHeading,
    h("p", {}, start.exportBody),
    pointList(start.exportPoints),
    h("p", {}, routeLink("guide", common.openGuide)),
  );
}

function countSection(ctx: ViewContext): HTMLElement {
  const input = h("input", {
    id: "friend-count",
    class: "input input-narrow",
    type: "text",
    inputmode: "numeric",
    autocomplete: "off",
    placeholder: start.countPlaceholder,
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
  return stepSection(
    2,
    start.countHeading,
    h(
      "div",
      { class: "field" },
      h("label", { class: "label", for: "friend-count" }, start.countLabel),
      input,
      h("p", { id: "friend-count-help" }, start.countHelp),
      error,
    ),
  );
}

function addSection(ctx: ViewContext): HTMLElement {
  const { store, actions } = ctx;

  const run = async (files: NamedBlob[]): Promise<void> => {
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

  // A native shell opens its own dialog. A plain browser, or a shell that declines (null or an error), uses the file input.
  const choose = async (): Promise<void> => {
    const pick = platform().pickZips;
    const native = pick ? await pick().catch(() => null) : null;
    if (native === null) picker.click();
    else void run(native);
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
    chipIcon("file-zip", "lg"),
    h("p", { class: "dropzone-title" }, start.dropTitle),
    h("p", { class: "caption muted" }, start.dropAlt),
    button({ label: start.choose, variant: "primary", icon: "import", key: "choose-files", onclick: () => void choose() }),
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

  return stepSection(
    3,
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

/** One short secondary button under the intro, so a first look at every screen needs no scrolling. The note says the sample is never saved. */
function sampleAction(ctx: ViewContext): HTMLElement {
  return h(
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
    h("p", { class: "caption muted" }, start.sampleBody),
  );
}

function storageNote(s: State): Child {
  if (!s.vault.supported) return notice("warning", settings.storageUnsupported);
  if (s.vault.phase === "session") {
    return h(
      "section",
      { class: "card card-pad card-tint card-band" },
      h("h2", { class: "section-title" }, start.sessionOnlyTitle),
      h("p", {}, start.sessionOnlyBody),
      h("p", {}, routeLink("settings", start.sessionOnlyAction)),
    );
  }
  return null;
}
