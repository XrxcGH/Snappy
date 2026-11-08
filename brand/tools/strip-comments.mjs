// Removes HTML and SVG comments. The dashboard build and the brand asset build share it.

/**
 * Removes every comment. One pass can leave a new one behind ("<!<!-- a -->--" becomes "<!--"),
 * so the pass repeats until the text stops changing. An opener with no closer is left as it is.
 */
export function stripComments(text) {
  let current = text;
  for (let previous = ""; previous !== current; ) {
    previous = current;
    let kept = "";
    let from = 0;
    for (;;) {
      const open = current.indexOf("<!--", from);
      const close = open < 0 ? -1 : current.indexOf("-->", open + 4);
      if (close < 0) break;
      kept += current.slice(from, open);
      from = close + 3;
    }
    current = kept + current.slice(from);
  }
  return current;
}
