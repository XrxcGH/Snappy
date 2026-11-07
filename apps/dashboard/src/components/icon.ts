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
  | "external"
  | "overview"
  | "people"
  | "snapshots"
  | "guide"
  | "photo"
  | "video"
  | "file"
  | "file-missing"
  | "calendar"
  | "list"
  | "storage"
  | "device"
  | "shield"
  | "minus"
  | "sun"
  | "moon"
  | "tools";

/** Spot illustrations in the sprite (ids "g-<name>", 160 by 120). Decorative only; colored by --spot-hi and --spot-wash. */
export type SpotName = "import" | "overview" | "empty" | "memories" | "privacy" | "guide";

/** Decorative icon from the sprite. Icon-only buttons name themselves with aria-label, never through the icon. */
export function icon(name: IconName, size: 16 | 20 | 24 | 48 = 20): SVGSVGElement {
  return svgUse(`i-${name}`, { class: "icon", width: String(size), height: String(size), "aria-hidden": "true", focusable: "false" });
}

/** Decorative spot illustration from the sprite. Built from pill bars; always aria-hidden. */
export function spot(name: SpotName, className = "spot"): SVGSVGElement {
  // Every scene is a wash card from (8, 8) to (152, 112). The view box crops to it, so the drawing's edge is the
  // svg's edge and lines up with the column it sits in, with no hidden margin.
  const svg = svgUse(`g-${name}`, { class: className, width: "144", height: "104", viewBox: "8 8 144 104", "aria-hidden": "true", focusable: "false" });
  const use = svg.firstChild as Element | null;
  use?.setAttribute("x", "0");
  use?.setAttribute("y", "0");
  use?.setAttribute("width", "160");
  use?.setAttribute("height", "120");
  return svg;
}

/** Three stacked bars: filled bars show how many signals were reached. Always paired with a word. */
export function confidenceBars(level: Confidence): SVGSVGElement {
  return svgUse(`conf-${level}`, { class: "icon conf-bars", width: "20", height: "20", "aria-hidden": "true", focusable: "false" });
}

/** The logo mark from the sprite (spine bar uses the accent). */
export function logoMark(size: number): SVGSVGElement {
  return svgUse("logo-mark", { class: "logo-mark", width: String(size), height: String(size), "aria-hidden": "true", focusable: "false" });
}
