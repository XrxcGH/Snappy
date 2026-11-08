import { createImportFlow } from "../import-flow.ts";
import { folderFilesFromInput } from "../folder-import.ts";
import { announce } from "../announce.ts";
import { failureClass, visibleIssues } from "@snappy-export/core";
import { common, routes, settings, start } from "../copy.ts";
import { startFlow } from "../copy-start.ts";
import { clearReloadNote, reloadNotePending } from "../unload-guard.ts";
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
import type { ImportStatus, State } from "../reducer.ts";
import type { Store } from "../store.ts";
import { parseFriendCount } from "../parse-input.ts";
import { navigate } from "./context.ts";
import type { View, ViewContext } from "./context.ts";

export const startView: View = (ctx) => {
  const { store } = ctx;

  const view = h(
    "div",
    { class: "view view-start" },
    hero(ctx),
    region(store, (s) => [s.vault.phase, s.vault.busy, s.vault.message], (s) => unlockCard(ctx, s)),
    // Before the steps, so the advice to seal a history comes before the first import, not after it.
    region(store, (s) => [s.vault.phase, s.vault.supported], (s) => storageNote(s)),
    // A reload cleared the results of an export that was not saved: say so, until there is something to show again.
    region(store, (s) => [s.real, s.sample, s.import.phase], (s) => reloadNote(s)),
    // The progress and any problem sit here, full width above the three steps: inside the third card they
    // were a narrow column below the fold, and a failed import looked like a click that did nothing.
    region(store, (s) => [s.import.phase, s.import.sample, s.import.message, s.import.issues, s.import.addedToHistory, s.import.canOverride, s.vault.hasSaved, s.real.ledger.snapshots.length], (s) => importStatus(ctx, s)),
    h("div", { class: "step-list" }, getExportSection(), countSection(ctx), addSection(ctx)),
  );
  // The chooser, the drop zone and the sample button wait while a read is going, so a second run cannot start on top of it.
  syncBusy(view, store.get());
  // Registered after the status region above, so its repaint has happened when this runs.
  onDispose(
    store.subscribe((s, previous) => {
      if (s.import.phase === previous.import.phase) return;
      syncBusy(view, s);
      // Stopped by the person (reading to idle): the note that nothing was added is shown and focused, as the progress was.
      const stopped = previous.import.phase === "reading" && s.import.phase === "idle";
      if (s.import.phase === "reading" || s.import.phase === "failed" || stopped) bringIntoView(view);
    }),
  );
  return view;
};

const hasResults = (s: State): boolean => s.real.latest !== null || s.real.ledger.snapshots.length > 0 || s.sample !== null;

function reloadNote(s: State): Child {
  if (!reloadNotePending()) return null;
  // Once an export or the sample is loaded the note has done its work, and does not come back.
  if (hasResults(s) || s.import.phase !== "idle") {
    if (hasResults(s)) clearReloadNote();
    return null;
  }
  return notice("info", startFlow.reloaded);
}

function syncBusy(view: HTMLElement, s: State): void {
  const busy = s.import.phase === "reading";
  for (const key of ["choose-files", "try-sample"]) {
    for (const control of view.querySelectorAll<HTMLElement>(`[data-key=${key}]`)) {
      if (busy) control.setAttribute("disabled", "");
      else control.removeAttribute("disabled");
    }
  }
  for (const zone of view.querySelectorAll<HTMLElement>(".dropzone")) zone.classList.toggle("dropzone-busy", busy);
}

/**
 * Move the person to the import status: scrolled into view and focused. The chooser and the drop zone are
 * out of reach while a part is being read, so focus would otherwise be left on a control that no longer answers.
 */
function bringIntoView(view: HTMLElement): void {
  const status = view.querySelector<HTMLElement>("#import-status");
  if (status === null) return;
  if (typeof status.scrollIntoView === "function") status.scrollIntoView({ block: "nearest" });
  status.focus({ preventScroll: false });
}

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
      // The way in for someone who has no export yet. Once there are results (an export, a saved history or the sample) it has done its work.
      region(ctx.store, (s) => [s.real, s.sample], (s) => (hasResults(s) ? null : sampleAction(ctx))),
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
  const flow = createImportFlow(ctx);

  // A native shell opens its own dialog. A plain browser, or a shell that declines (null or an error), uses the file input.
  const choose = async (): Promise<void> => {
    const pick = platform().pickZips;
    const native = pick ? await pick().catch(() => null) : null;
    if (native === null) picker.click();
    else void flow.files(native);
  };

  const picker = h("input", { type: "file", accept: ".zip,application/zip", multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });
  picker.addEventListener("change", () => {
    const files = [...(picker.files ?? [])];
    picker.value = ""; // lets the same file be chosen again
    void flow.files(files);
  });

  // An export a browser unzipped is a folder: this chooser takes the folder, and Snappy reads only its few JSON files.
  const folderPicker = h("input", { type: "file", webkitdirectory: true, multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });
  folderPicker.addEventListener("change", () => {
    const files = folderFilesFromInput([...(folderPicker.files ?? [])]);
    folderPicker.value = "";
    void flow.folder(files);
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
    // ZIP files, JSON files or a folder: the flow looks at what the drop holds, before it waits for anything.
    void flow.drop(e.dataTransfer);
  });

  return stepSection(
    3,
    start.addHeading,
    h("p", {}, start.addBody),
    dropzone,
    picker,
    h(
      "div",
      { class: "folder-row" },
      h("p", { class: "caption muted" }, startFlow.folderHint),
      button({ label: startFlow.chooseFolder, variant: "quiet", key: "choose-folder", onclick: () => folderPicker.click() }),
      folderPicker,
    ),
  );
}

/**
 * The reading status is built once and updated in place. A live region that is replaced on every
 * tick (up to a hundred of them) is announced inconsistently, and a replaced progress bar never
 * reports a change. The spoken line changes only with the part being read; the percentage is shown
 * but not spoken, and the bar carries it for assistive technology through aria-valuenow.
 */
function readingStatus(ctx: ViewContext): HTMLElement {
  const { store } = ctx;
  const spoken = h("p", { role: "status" });
  const percent = h("p", { class: "caption muted", "aria-hidden": "true" });
  const bar = progressBar({ label: start.progressLabel, value: null });
  // After a few seconds: large exports take minutes, and the time that has passed (never a guess of what is left).
  const hint = h("p", { class: "caption muted", hidden: true }, startFlow.slowHint);
  const elapsed = h("p", { class: "caption muted", "aria-hidden": "true", hidden: true });
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

  const sample = store.get().import.sample;
  if (!sample) {
    const begun = store.get().import.startedAt;
    const startedAt = begun !== undefined && begun <= Date.now() ? begun : Date.now();
    let shown = false;
    const tick = (): void => {
      const ms = Date.now() - startedAt;
      if (ms < SLOW_AFTER_MS) return;
      elapsed.textContent = startFlow.elapsed(ms / 1000);
      if (shown) return;
      shown = true;
      hint.removeAttribute("hidden");
      elapsed.removeAttribute("hidden");
      announce(startFlow.slowHint);
    };
    const timer = setInterval(tick, 1000);
    onDispose(() => clearInterval(timer));
  }
  return h(
    "div",
    { class: "status" },
    spoken,
    percent,
    bar,
    hint,
    elapsed,
    sample ? null : h("div", { class: "actions" }, button({ label: startFlow.cancelButton, key: "cancel-import", onclick: () => ctx.actions.cancelImport() })),
  );
}

/** How long a read runs before the page says that large exports take a while. */
const SLOW_AFTER_MS = 5000;

/** One block for every state of an import. It takes focus, so a failure cannot go unseen. */
function statusBlock(...children: Child[]): HTMLElement {
  return h("div", { class: "import-status", id: "import-status", tabindex: "-1", role: "group", "aria-label": startFlow.statusLabel }, ...children);
}

function importStatus(ctx: ViewContext, s: State): Child {
  const imp = s.import;
  // Not repainted on every progress tick: the reading status updates itself in place.
  if (imp.phase === "reading") return statusBlock(readingStatus(ctx));
  if (imp.phase === "failed") return statusBlock(...failureNotices(ctx, s));
  // Stopped by the person: the chooser is back, and nothing was added.
  if (imp.phase === "idle" && imp.message !== undefined) return statusBlock(notice("info", imp.message));
  if (imp.phase === "done" && !imp.sample) {
    return statusBlock(notice("success", imp.addedToHistory === false ? start.notAdded : start.readDoneShort));
  }
  return null;
}

/**
 * What a failed import says. When the files could not be read at all (damaged, password protected, a ZIP of ZIP
 * files, no JSON), that one cause is the whole message: the headline "looks incomplete" and the notes about lists
 * that were never read would be statements about files Snappy could not open.
 */
function failureNotices(ctx: ViewContext, s: State): Child[] {
  const imp = s.import;
  const problems = visibleIssues(imp.issues ?? []);
  const help = h("p", {}, routeLink("guide", common.openGuide));
  if (failureClass(problems) !== undefined) return [...problems.filter((i) => failureClass([i]) !== undefined).map(issueNotice), help];
  const lead = notice("error", imp.message ?? start.readFailed);
  // An empty friends list with removed friends may be a real list: with nothing saved to compare with, the person may go on.
  // With a saved history, or an earlier export this session, the refusal stands: a list that looks empty would make everyone vanish.
  const mayGoOn = imp.canOverride === true && !s.vault.hasSaved && s.real.ledger.snapshots.length === 0;
  const useAnyway = mayGoOn
    ? h("div", { class: "actions" }, button({ label: startFlow.useAnyway, key: "use-anyway", onclick: () => void goOn(ctx) }))
    : null;
  return [lead, ...problems.map(issueNotice), useAnyway, help];
}

async function goOn(ctx: ViewContext): Promise<void> {
  const result = await ctx.actions.importAnyway();
  if (result === "done") {
    announce(ctx.store.get().import.addedToHistory === false ? start.notAdded : start.readDone);
    navigate("overview");
  } else {
    announce(ctx.store.get().import.message ?? start.readFailed, true);
  }
}

/** One short secondary button under the intro, so a first look at every screen needs no scrolling. The note says the sample is never saved. */
function sampleAction(ctx: ViewContext): HTMLElement {
  return h(
    "div",
    { class: "sample-row" },
    h("p", { class: "sample-lead" }, startFlow.noExportYet),
    h("div", { class: "actions" }, sampleButton(ctx), h("p", { class: "caption muted" }, start.sampleBody)),
  );
}

function sampleButton(ctx: ViewContext): HTMLElement {
  return button({
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
  });
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
