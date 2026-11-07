import { copyText } from "../clipboard.ts";
import { announce } from "../announce.ts";
import { common, guide, memories, routes } from "../copy.ts";
import { h } from "../dom.ts";
import { button, routeLink } from "../components/button.ts";
import { dataTable } from "../components/dataTable.ts";
import { pageHeader, section } from "../components/layout.ts";
import type { View } from "./context.ts";

export const guideView: View = () =>
  h(
    "div",
    { class: "view" },
    pageHeader(routes.guide.title, guide.lead),
    section(
      guide.tickHeading,
      dataTable(guide.tickHeading, [guide.optionHeader, guide.tickHeader, guide.whyHeader], guide.rows),
    ),
    section(guide.rangeHeading, h("p", {}, guide.rangeBody)),
    section(guide.afterHeading, h("ol", { class: "steps" }, ...guide.afterSteps.map((s) => h("li", {}, s)))),
    section(
      guide.shapeHeading,
      h("p", {}, guide.shapeBody),
      h(
        "div",
        { class: "command" },
        h("pre", { class: "code" }, h("code", {}, guide.shapeCommand)),
        button({
          label: common.copy,
          icon: "copy",
          ariaLabel: memories.copyCommand,
          key: "copy-inspect",
          onclick: () => void copyText(guide.shapeCommand).then((ok) => announce(ok ? memories.commandCopied : common.copyFailed)),
        }),
      ),
    ),
    section(guide.storingHeading, h("p", {}, guide.storingBody), h("p", {}, routeLink("start", guide.addLink, "primary"))),
  );
