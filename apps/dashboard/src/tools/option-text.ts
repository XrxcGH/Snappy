/**
 * A sentence that names command options ("--top"): each option goes in its own code element, so a narrow screen never
 * breaks it at its hyphens and the person can see which words to type. Text only: nothing here reads an export value.
 */
import { h } from "../dom.ts";

const OPTION = /(--[a-z][a-z-]*[a-z])/;

export function withOptions(text: string): (string | HTMLElement)[] {
  return text.split(OPTION).map((part) => (OPTION.test(part) ? h("code", { class: "option-name" }, part) : part)).filter((part) => part !== "");
}
