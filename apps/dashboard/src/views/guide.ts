import { guide, routes } from "../copy.ts";
import { h } from "../dom.ts";
import { routeLink } from "../components/button.ts";
import { codeBlock } from "../components/codeBlock.ts";
import { dataTable } from "../components/dataTable.ts";
import { pageHeader, section, stepCards } from "../components/layout.ts";
import type { View } from "./context.ts";

export const guideView: View = () =>
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
    section(guide.shapeHeading, h("p", {}, guide.shapeBody), codeBlock(guide.shapeCommand, { key: "copy-inspect" })),
    section(guide.storingHeading, h("p", {}, guide.storingBody), h("p", {}, routeLink("start", guide.addLink, "primary"))),
  );
