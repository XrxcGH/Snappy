/**
 * Small HTML helpers for the tests. They walk the text instead of stripping it with one regular
 * expression, which misses upper-case tags, closing tags with attributes ("</script foo>") and
 * markers rebuilt from what a single pass leaves behind ("<scr<script>ipt>").
 */

export interface Element {
  /** Where the opening tag starts, and where the element ends (just after its closing tag). */
  start: number;
  end: number;
  /** The text between the opening and the closing tag. */
  inner: string;
}

/** The index just after the ">" that ends the tag starting at `from`, skipping quoted attribute values; -1 when it never ends. */
function tagEnd(html: string, from: number): number {
  let quote = "";
  for (let i = from + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Every `<tag>…</tag>` element of a raw-text tag such as script or style, in page order. The tag name
 * is matched in any case, the opening tag may carry attributes, and the closing tag may carry
 * whitespace or attributes. An element that never closes runs to the end of the text, as a browser reads it.
 */
export function elements(html: string, tag: string): Element[] {
  const opener = new RegExp(`<${tag}(?=[\\s/>])`, "gi");
  const closer = new RegExp(`</${tag}(?=[\\s/>])`, "gi");
  const found: Element[] = [];
  let at = 0;
  for (;;) {
    opener.lastIndex = at;
    const open = opener.exec(html);
    if (!open) return found;
    const openEnd = tagEnd(html, open.index);
    closer.lastIndex = Math.max(openEnd, 0);
    const close = openEnd < 0 ? null : closer.exec(html);
    if (!close) {
      found.push({ start: open.index, end: html.length, inner: openEnd < 0 ? "" : html.slice(openEnd) });
      return found;
    }
    const closeEnd = html.indexOf(">", close.index + close[0].length);
    const end = closeEnd < 0 ? html.length : closeEnd + 1;
    found.push({ start: open.index, end, inner: html.slice(openEnd, close.index) });
    at = end;
  }
}

/** The text of each element of that tag, in page order. */
export function innerTexts(html: string, tag: string): string[] {
  return elements(html, tag).map((e) => e.inner);
}

/** Removes every element of the given tags. Taking one out can join its neighbors into a new one, so this repeats until the text stops changing. */
export function removeElements(html: string, ...tags: string[]): string {
  let current = html;
  for (let previous = ""; previous !== current; ) {
    previous = current;
    for (const tag of tags) {
      let kept = "";
      let from = 0;
      for (const el of elements(current, tag)) {
        kept += current.slice(from, el.start);
        from = el.end;
      }
      current = kept + current.slice(from);
    }
  }
  return current;
}

/**
 * The text with every tag removed, in one pass over the characters. A "<" opens a tag that runs to
 * the next ">" however many "<" it holds, so "<scr<b>ipt>" leaves "ipt>" and never a rebuilt tag. A "<"
 * with no ">" after it is plain text, and then no tag can follow it either.
 */
export function stripTags(html: string): string {
  let text = "";
  for (let i = 0; i < html.length; ) {
    if (html[i] === "<") {
      const close = html.indexOf(">", i + 1);
      if (close >= 0) {
        i = close + 1;
        continue;
      }
    }
    text += html[i];
    i++;
  }
  return text;
}
