import { announce } from "../announce.ts";
import { copyText } from "../clipboard.ts";
import { common, memories } from "../copy.ts";
import { h } from "../dom.ts";
import { button } from "./button.ts";

export interface CodeBlockOptions {
  /** Key for focus restoration. */
  key: string;
}

/**
 * A command to copy. The compact Copy button sits inside the block at the top right (placement
 * is the stylesheet's job: `.code-block` is the positioned frame, `.code-copy` the button), and the
 * code scrolls sideways on small screens. The button is named "Copy command" for screen readers.
 */
export function codeBlock(text: string, options: CodeBlockOptions): HTMLElement {
  return h(
    "div",
    { class: "command code-block" },
    h("pre", { class: "code", tabindex: "0" }, h("code", {}, text)),
    button({
      label: common.copy,
      icon: "copy",
      variant: "quiet",
      className: "code-copy",
      ariaLabel: memories.copyCommand,
      key: options.key,
      onclick: () => void copyText(text).then((ok) => announce(ok ? memories.commandCopied : common.copyFailed)),
    }),
  );
}
