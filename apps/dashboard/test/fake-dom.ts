/**
 * A very small stand-in for the browser DOM, just enough to render the dashboard's views in the
 * node test environment and look at what they build. It supports what dom.ts, reactive.ts and the
 * components use: elements, text, attributes, classes, dataset, children, simple selectors and
 * listeners. It is not a browser: it does not lay anything out, run CSS or fire events.
 */

export class FakeNode {
  parentNode: FakeElement | null = null;
  get textContent(): string {
    return "";
  }
}

export class FakeText extends FakeNode {
  readonly data: string;
  constructor(data: string) {
    super();
    this.data = data;
  }
  override get textContent(): string {
    return this.data;
  }
}

class FakeClassList {
  private readonly el: FakeElement;
  constructor(el: FakeElement) {
    this.el = el;
  }
  private list(): string[] {
    return (this.el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  }
  contains(name: string): boolean {
    return this.list().includes(name);
  }
  add(...names: string[]): void {
    const next = this.list();
    for (const n of names) if (!next.includes(n)) next.push(n);
    this.el.setAttribute("class", next.join(" "));
  }
  remove(...names: string[]): void {
    this.el.setAttribute("class", this.list().filter((n) => !names.includes(n)).join(" "));
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.contains(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

export class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly attrs = new Map<string, string>();
  readonly childNodes: FakeNode[] = [];
  readonly classList = new FakeClassList(this);
  /** Custom properties set through the CSSOM (never serialized as a style attribute). */
  readonly styleProps = new Map<string, string>();
  readonly style = { setProperty: (name: string, value: string): void => void this.styleProps.set(name, value) };
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  open = false;
  checked = false;
  value = "";
  hidden = false;
  /** Layout does not exist here; a test sets these to try scrolling code. */
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  clientWidth = 0;
  /** Focus requests, so a test can see what was focused. */
  focusCount = 0;

  constructor(tagName: string) {
    super();
    this.tagName = tagName.toLowerCase();
  }

  get className(): string {
    return this.getAttribute("class") ?? "";
  }
  set className(v: string) {
    this.setAttribute("class", v);
  }
  get dataset(): Record<string, string | undefined> {
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_t, key: string) => this.attrs.get(`data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`),
      set: (_t, key: string, value: string) => {
        this.attrs.set(`data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, String(value));
        return true;
      },
    });
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  appendChild<T extends FakeNode>(child: T): T {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore<T extends FakeNode>(child: T, before: FakeNode | null): T {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const at = before === null ? -1 : this.childNodes.indexOf(before);
    if (at < 0) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    return child;
  }
  append(...children: (FakeNode | string)[]): void {
    for (const c of children) this.appendChild(typeof c === "string" ? new FakeText(c) : c);
  }
  replaceChildren(...children: FakeNode[]): void {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    for (const c of children) this.appendChild(c);
  }
  contains(node: FakeNode | null): boolean {
    for (let n: FakeNode | null = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  removeChild<T extends FakeNode>(child: T): T {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  /** Take this element out of its parent. */
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  /** What a file input holds, set by a test before it fires "change". */
  files: unknown[] | null = null;
  /** Run the click listeners, as pressing the element would. */
  click(): void {
    for (const fn of this.listeners.get("click") ?? []) fn({ target: this, preventDefault: () => undefined });
  }
  /** Run the listeners of any event, for tests. */
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ target: this, preventDefault: () => undefined, ...event });
  }
  /** The element that was focused last, for tests of focus management. */
  static lastFocused: FakeElement | null = null;
  focus(): void {
    this.focusCount++;
    FakeElement.lastFocused = this;
  }
  override get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  override set textContent(v: string) {
    this.replaceChildren(new FakeText(v));
  }
  /** Every descendant element, in document order. */
  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (el: FakeElement): void => {
      for (const c of el.childNodes) {
        if (c instanceof FakeElement) {
          out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  querySelectorAll<T = FakeElement>(selector: string): T[] {
    const parts = selector.trim().split(/\s+/);
    return this.descendants().filter((el) => matchesChain(el, parts, this)) as unknown as T[];
  }
  querySelector<T = FakeElement>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }
}

function matchesCompound(el: FakeElement, compound: string): boolean {
  const tokens = compound.match(/^[a-z0-9-]+|[.#][\w-]+|\[[^\]]+\]/gi) ?? [];
  return tokens.every((t) => {
    if (t.startsWith(".")) return el.classList.contains(t.slice(1));
    if (t.startsWith("#")) return el.getAttribute("id") === t.slice(1);
    if (t.startsWith("[")) {
      const m = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(t);
      if (!m) return false;
      const value = el.getAttribute(m[1] ?? "");
      return m[2] === undefined ? value !== null : value === m[2];
    }
    return el.tagName === t.toLowerCase();
  });
}

function matchesChain(el: FakeElement, parts: string[], scope: FakeElement): boolean {
  const last = parts[parts.length - 1] ?? "";
  if (!matchesCompound(el, last)) return false;
  let rest = parts.slice(0, -1);
  for (let a = el.parentNode; a && a !== scope && rest.length > 0; a = a.parentNode) {
    if (matchesCompound(a, rest[rest.length - 1] ?? "")) rest = rest.slice(0, -1);
  }
  return rest.length === 0;
}

/** Install `document` and the element classes the code under test checks with instanceof. */
export function installFakeDom(): { body: FakeElement; document: Record<string, unknown> } {
  const body = new FakeElement("body");
  const doc = {
    body,
    documentElement: new FakeElement("html"),
    title: "",
    activeElement: null,
    createElement: (tag: string) => new FakeElement(tag),
    createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
    createTextNode: (data: string) => new FakeText(data),
    getElementById: (id: string) => body.descendants().find((e) => e.getAttribute("id") === id) ?? null,
    querySelector: (selector: string) => body.querySelector(selector),
  };
  const g = globalThis as Record<string, unknown>;
  g.document = doc;
  g.HTMLElement = FakeElement;
  g.Node = FakeNode;
  return { body, document: doc };
}
