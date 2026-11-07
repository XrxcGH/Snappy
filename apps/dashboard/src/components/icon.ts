import type { Confidence } from "@snappy-export/core";
import { svgUse } from "../dom.ts";

/** Names in brand/icons/icons.svg (without the "i-" prefix). */
export type IconName =
  | "content-blind"
  | "vanished"
  | "one-way"
  | "quiet"
  | "memories"
  | "queue"
  | "seal"
  | "import"
  | "export"
  | "file-zip"
  | "settings"
  | "search"
  | "check"
  | "close"
  | "warning"
  | "info"
  | "copy"
  | "remove"
  | "chevron-right"
  | "external";

/** Decorative icon from the sprite. Icon-only buttons name themselves with aria-label, never through the icon. */
export function icon(name: IconName, size: 16 | 20 | 24 | 48 = 20): SVGSVGElement {
  return svgUse(`i-${name}`, { class: "icon", width: String(size), height: String(size), "aria-hidden": "true", focusable: "false" });
}

/** Three stacked bars: filled bars show how many signals were reached. Always paired with a word. */
export function confidenceBars(level: Confidence): SVGSVGElement {
  return svgUse(`conf-${level}`, { class: "icon conf-bars", width: "20", height: "20", "aria-hidden": "true", focusable: "false" });
}

/** The logo mark from the sprite (spine bar uses the accent). */
export function logoMark(size: number): SVGSVGElement {
  return svgUse("logo-mark", { class: "logo-mark", width: String(size), height: String(size), "aria-hidden": "true", focusable: "false" });
}
