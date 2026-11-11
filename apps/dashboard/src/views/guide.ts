import { guide, routes } from "../copy.ts";
import { shellCopy } from "../copy-shell.ts";
import { cliTool } from "../copy-tools.ts";
import { REPOSITORY_ADDRESS } from "../diagnostics.ts";
import { h } from "../dom.ts";
import { routeLink } from "../components/button.ts";
import { commandBlock } from "../components/commandBlock.ts";
import { copyTextButton } from "../components/listActions.ts";
import { dataTable } from "../components/dataTable.ts";
import { pageHeader, section, stepCards } from "../components/layout.ts";
import { cliPrefix } from "../terminal/commands.ts";
import type { View } from "./context.ts";

export const guideView: View = (ctx) =>
  h(
    "div",
    { class: "view" },
    pageHeader(routes.guide.title, guide.lead, { icon: "guide" }),
    section(
      guide.tickHeading,
      dataTable(guide.tickHeading, [guide.optionHeader, guide.tickHeader, guide.whyHeader], guide.rows, { pills: { column: 1, kinds: guide.tickKinds } }),
    ),
    section(guide.rangeHeading, h("p", {}, guide.rangeBody)),
    section(guide.afterHeading, stepCards(guide.afterSteps)),
    section(
      cliTool.heading,
      h("p", {}, cliTool.body),
      h("p", {}, cliTool.where),
      h("p", {}, `${shellCopy.repositoryLabel}: `, h("code", { class: "repository" }, REPOSITORY_ADDRESS)),
      h("div", { class: "actions" }, copyTextButton({ label: shellCopy.copyAddressButton, key: "copy-address", done: shellCopy.addressCopiedAnnounce, text: () => REPOSITORY_ADDRESS })),
      h("p", {}, cliTool.prefixLine(cliPrefix()), " ", cliTool.appLine),
    ),
    section(guide.shapeHeading, h("p", {}, guide.shapeBody), commandBlock(ctx, "inspect", { key: "guide-inspect" })),
    section(
      guide.tryHeading,
      h("p", {}, guide.tryBody),
      commandBlock(ctx, "help", { key: "guide-help" }),
      commandBlock(ctx, "demo-run", { key: "guide-demo" }),
      commandBlock(ctx, "analyze-save", { key: "guide-analyze" }),
      commandBlock(ctx, "ledger-status", { key: "guide-ledger" }),
    ),
    section(guide.storingHeading, h("p", {}, guide.storingBody), h("p", {}, routeLink("start", guide.addLink, "primary"))),
  );
