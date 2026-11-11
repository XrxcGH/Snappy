import { copyText } from "../clipboard.ts";
import { common } from "../copy.ts";
import { h } from "../dom.ts";
import { displayUsername } from "../safe.ts";
import { icon } from "./icon.ts";
import { say } from "./listActions.ts";

/** The username itself, in the mono font. Written as text only. */
export function usernameText(username: string): HTMLElement {
  return h("code", { class: "username" }, displayUsername(username));
}

/** Copy button for a username: icon only, named for screen readers. */
export function copyUsernameButton(username: string, key?: string): HTMLButtonElement {
  const btn = h(
    "button",
    {
      class: "btn btn-quiet btn-icon",
      type: "button",
      "aria-label": common.copyUsername(displayUsername(username)),
      "data-key": key,
    },
    icon("copy", 20),
  );
  btn.addEventListener("click", () => {
    void copyText(username).then((ok) => say(ok, common.copiedUsername(displayUsername(username)), common.copyFailed));
  });
  return btn;
}

/** Username chip: mono text on a sunken fill, with a copy affordance beside it. */
export function usernameChip(username: string, options: { copy?: boolean; key?: string } = {}): HTMLElement {
  return h(
    "span",
    { class: "chip-group" },
    h("span", { class: "chip" }, usernameText(username)),
    options.copy === false ? null : copyUsernameButton(username, options.key),
  );
}
