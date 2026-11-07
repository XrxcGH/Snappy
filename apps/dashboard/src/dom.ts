/**
 * Safe DOM construction. Views build elements with these helpers and never with markup strings:
 * usernames come from the export and are attacker-influenced, so they are only ever written
 * as text nodes. The helpers also refuse inline styles (the CSP forbids them), event-handler
 * attributes, and any link that is not an in-page route or a Snapchat profile.
 */
import { isAllowedHref, isSafeAttribute } from "./safe.ts";

export type Child = Node | string | number | false | null | undefined;
export type Handler = (event: Event) => void;
export type Props = Record<string, string | number | boolean | Handler | null | undefined>;

function applyProps(el: Element, props: Props): void {
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") {
      el.className = String(value);
    } else if (/^on[a-z]+$/.test(name)) {
      if (typeof value !== "function") throw new Error("Event handlers must be functions.");
      el.addEventListener(name.slice(2), value);
    } else {
      if (typeof value === "function") throw new Error("Only event handlers may be functions.");
      if (!isSafeAttribute(name)) throw new Error("Blocked attribute.");
      const text = value === true ? "" : String(value);
      if (name === "href" && !isAllowedHref(text)) throw new Error("Blocked link.");
      el.setAttribute(name, text);
    }
  }
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

/** Create an element: h("button", { class: "btn", onclick }, "Label"). Children are nodes or plain text. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** SVG element for the icon sprite only (<svg><use href="#id"/></svg>). */
export function svgUse(symbolId: string, props: Record<string, string>): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries(props)) svg.setAttribute(name, value);
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${symbolId}`);
  svg.appendChild(use);
  return svg;
}

/** Set a CSS custom property or width through CSSOM (allowed under the CSP, unlike a style attribute). */
export function setVar(el: HTMLElement, name: string, value: string): void {
  el.style.setProperty(name, value);
}
