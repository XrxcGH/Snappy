/**
 * The names the picked files get under /in. The page and the helper both use this one function, so
 * the page can write /in/<name> into a command before the helper has seen the files. Pure.
 */

/** A name that is safe as one file name: no separators or NUL, never empty. */
export function safeInputName(name: string): string {
  const cleaned = name.replace(/[\\/\0]/g, "_").trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "file" : cleaned;
}

/** One name per input, in order. A name taken twice becomes "a (2).zip", "a (3).zip", and so on. */
export function assignInputNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((raw) => {
    const base = safeInputName(raw);
    let name = base;
    for (let n = 2; taken.has(name); n++) {
      const dot = base.lastIndexOf(".");
      name = dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
    }
    taken.add(name);
    return name;
  });
}
