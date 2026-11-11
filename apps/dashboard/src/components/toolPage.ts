/**
 * The frame every tool page shares, so a tool's own view only says what is special about it.
 *
 *   back link, title and description, a "what this reads" line
 *   the controls the tool offers (optional), kept in place while the result repaints
 *   the result, drawn after the page has painted: a short working line first, then the tool's sections,
 *     its notes and an optional download button
 *   an honest empty state when the export lacks what the tool needs, and another when the tool found nothing
 *   an optional command block (Copy and Run) for the matching command line command
 *
 * The tool provides pure functions: compute(data, params) and render(result, ui). The frame does the
 * waiting, the memo (tools/run.ts), the announcements, the empty states and the layout. Everything is
 * text through h(): no innerHTML, no inline style.
 */
import type { Actions } from "../actions.ts";
import { announce } from "../announce.ts";
import { common, tools } from "../copy.ts";
import { commandNotes } from "../copy-tools.ts";
import { append, h } from "../dom.ts";
import type { Child } from "../dom.ts";
import { onDispose, region, runInScope, Scope } from "../reactive.ts";
import { activeWorkspace } from "../reducer.ts";
import type { CommandId } from "../terminal/commands.ts";
import { cachedResult, runTool } from "../tools/run.ts";
import { toolData, toolDeps, unmetNeed } from "../tools/data.ts";
import type { ToolData } from "../tools/data.ts";
import type { ToolCopy, ToolMeta, ToolNeed } from "../tools/types.ts";
import type { View, ViewContext } from "../views/context.ts";
import { button, routeLink } from "./button.ts";
import { scopeClass } from "./category.ts";
import { commandBlock } from "./commandBlock.ts";
import { offerFile } from "./fileOffer.ts";
import { icon } from "./icon.ts";
import { emptyState, pageHeader, section } from "./layout.ts";
import { toastHost } from "./toast.ts";
import { progressBar } from "./progressBar.ts";

/** A short, hedged line about a result. `info` is a plain observation; `warning` asks the person to look. */
export interface ToolNote {
  kind: "info" | "warning";
  text: string;
}

export interface ToolUi<P> {
  readonly data: ToolData;
  readonly params: P;
  /** For a checklist tool: tick and untick with actions.setTick. Everything else on the page is read-only. */
  readonly actions: Actions;
  /** The self-reported ticks right now ("tool-id:item-id"), read fresh on every repaint. */
  readonly ticks: readonly string[];
  /** Change the tool's parameters. The result is computed again and only the result repaints. */
  set(patch: Partial<P>): void;
}

export interface ToolDownload<R> {
  /** Button label: a verb and a short noun, such as "Download JSON". */
  label: string;
  /** A short line under the button, such as what the file holds. */
  note?: string;
  /** Called only when the button is pressed, never while the page is drawn. */
  build(result: R): { fileName: string; text: string; mime: string };
}

export interface ToolPageOptions<R, P extends object> {
  meta: ToolMeta;
  copy: ToolCopy;
  /** The tool's own parameters and their starting values. Omit when it has none. */
  params?: P;
  /** Pure. One pass over the data; returns a small plain result. May be slow, so it runs after the page has painted. */
  compute(data: ToolData, params: P): R;
  /** One short sentence for screen readers when a result appears. No usernames. */
  summary(result: R): string;
  /** True when the tool ran and found nothing. Needs copy.empty. */
  isEmpty?(result: R): boolean;
  /** Inputs for the parameters. Built once per page, so typing is never interrupted by a repaint of the result. */
  controls?(ui: ToolUi<P>): Child | Child[];
  /** The sections of the result, as sections, tables and lists from the shared components. */
  render(result: R, ui: ToolUi<P>): Child[];
  notes?(result: R, ui: ToolUi<P>): readonly ToolNote[];
  download?: ToolDownload<R>;
  /** The matching command in the catalog (terminal/commands.ts), shown as a command block with Copy and Run. */
  command?: CommandId;
}

/** The tool that tells what an export lacks. Its own empty state does not point at itself. */
const CHECK_TOOL = "export-check";

const NEED_COPY: Record<ToolNeed, { title: string; body: string }> = {
  export: { title: tools.needs.exportTitle, body: tools.needs.exportBody },
  friends: { title: tools.needs.friendsTitle, body: tools.needs.friendsBody },
  chats: { title: tools.needs.chatsTitle, body: tools.needs.chatsBody },
  memories: { title: tools.needs.memoriesTitle, body: tools.needs.memoriesBody },
};

/** The honest empty state for a missing need: what is missing, and the next step. */
function needState(need: ToolNeed, data: ToolData, meta: ToolMeta): HTMLElement {
  const words = NEED_COPY[need];
  const body = need !== "export" ? words.body : data.importFailed ? tools.needs.exportFailedBody : data.source === "ledger" ? tools.needs.exportLedgerBody : words.body;
  const action = need === "export" ? routeLink("start", common.addExport, "primary") : meta.id === CHECK_TOOL ? null : routeLink("tools/export-check", tools.needs.checkLink);
  return emptyState({ icon: meta.icon, spot: "empty", category: meta.category, title: words.title, body, actions: action ? [action] : [] });
}

/** Notes as a quiet list: a small status icon and one short sentence each. No notice frames, so the page stays calm. */
export function toolNotes(notes: readonly ToolNote[]): HTMLElement {
  return h("ul", { class: "tool-notes" }, ...notes.map((n) => h("li", { class: `tool-note tool-note-${n.kind}` }, icon(n.kind === "info" ? "info" : "warning", 20), h("span", {}, n.text))));
}

export function toolPage<R, P extends object = Record<string, never>>(ctx: ViewContext, o: ToolPageOptions<R, P>): HTMLElement {
  const { meta, copy } = o;
  let params = (o.params ?? {}) as P;
  const header = pageHeader(copy.title, copy.description, { icon: meta.icon, category: meta.category });

  const reads = h("div", { class: "tool-reads" }, h("p", { class: "label" }, tools.readsHeading), h("p", {}, `${copy.reads} ${tools.readsNever}`));

  const body = region(
    ctx.store,
    toolDeps,
    (s) => {
      const data = toolData(s);
      const need = unmetNeed(data, meta.needs);
      if (need !== null) return needState(need, data, meta);

      const ui: ToolUi<P> = {
        data,
        actions: ctx.actions,
        get ticks() {
          return activeWorkspace(ctx.store.get()).ticks;
        },
        get params() {
          return params;
        },
        set(patch) {
          params = { ...params, ...patch };
          settle(true);
        },
      };
      const host = h("div", { class: "tool-result", "aria-busy": "true" });
      const scope = new Scope(false);
      let disposed = false;
      let turn = 0;
      onDispose(() => {
        disposed = true;
        scope.dispose();
      });

      const working = (): HTMLElement => h("div", { class: "tool-working" }, progressBar({ label: tools.workingLabel, value: null }), h("p", { class: "caption" }, tools.workingLabel));

      const paint = (result: R, announced: boolean): void => {
        scope.dispose();
        const nodes = runInScope(scope, () => draw(result));
        host.replaceChildren();
        append(host, nodes);
        host.removeAttribute("aria-busy");
        if (announced) announce(o.summary(result));
      };

      const draw = (result: R): Child[] => {
        if (o.isEmpty?.(result) === true && copy.empty) return [emptyState({ icon: meta.icon, spot: "empty", category: meta.category, title: copy.empty.title, body: copy.empty.body })];
        const out: Child[] = [...o.render(result, ui)];
        const notes = o.notes?.(result, ui) ?? [];
        if (notes.length > 0) out.push(section(tools.notesHeading, toolNotes(notes)));
        if (o.download) out.push(downloadSection(o.download, result));
        return out;
      };

      /** `changed` is true when a control caused this: a held result is then announced too, since the person asked for it and would otherwise hear nothing. */
      function settle(changed: boolean): void {
        const key = JSON.stringify(params);
        const hit = cachedResult<R>(meta.id, data, key);
        if (hit) {
          paint(hit.result, changed);
          return;
        }
        const mine = ++turn;
        host.setAttribute("aria-busy", "true");
        host.replaceChildren();
        host.appendChild(working());
        runTool(meta.id, data, key, () => o.compute(data, params)).then(
          (result) => {
            if (!disposed && mine === turn) paint(result, true);
          },
          () => {
            // The reason can hold export values, so only a fixed line is shown.
            if (disposed || mine !== turn) return;
            host.removeAttribute("aria-busy");
            host.replaceChildren();
            host.appendChild(h("p", { class: "tool-failed", role: "alert" }, tools.failedNote));
          },
        );
      }

      settle(false);
      const controls = o.controls?.(ui);
      return [...(controls === undefined ? [] : Array.isArray(controls) ? controls : [controls]), host];
    },
    { className: "tool-body" },
  );

  return h(
    "div",
    // tool-<id> is the one class a tool's own stylesheet may start its selectors with.
    { class: `view tool tool-${meta.id} ${scopeClass(meta.category)}`, "data-tool": meta.id },
    // The back link and the header are one block, a heading gap apart, so the page still starts the way every page does.
    h("div", { class: "tool-top" }, h("div", { class: "tool-back" }, h("a", { class: "back-link", href: "#/tools" }, tools.backLink)), header),
    reads,
    toastHost(),
    body,
    o.command ? section(tools.commandHeading, commandBlock(ctx, o.command, { key: `${meta.id}-command`, cliLink: true, note: o.controls ? commandNotes.defaultView : undefined })) : null,
  );
}

function downloadSection<R>(download: ToolDownload<R>, result: R): HTMLElement {
  // After a press the same text is offered for copying, because a blocked download says nothing at all.
  const fallback = h("div", { class: "download-slot" });
  return section(
    tools.downloadHeading,
    download.note ? h("p", {}, download.note) : null,
    h(
      "div",
      { class: "actions" },
      button({
        label: download.label,
        icon: "export",
        variant: "secondary",
        key: "tool-download",
        onclick: () => fallback.replaceChildren(offerFile(download.build(result)).fallback),
      }),
    ),
    fallback,
  );
}

/** A tool's view, from its options. Tools export `view` built this way and nothing else needs to know how. */
export const toolView =
  <R, P extends object = Record<string, never>>(options: ToolPageOptions<R, P>): View =>
  (ctx) =>
    toolPage(ctx, options);
