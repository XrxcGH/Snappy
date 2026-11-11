/**
 * Screen-reader announcements through the two live regions in index.html. Messages must be
 * short and must not contain message text, display names, or other personal details.
 *
 * Each region has its own timer, so a message to one never cancels a message to the other. A sentence is cleared a few
 * seconds after it was spoken, and by clearAnnouncements when the page changes, so old text never lingers in the page.
 */
const SPEAK_AFTER_MS = 50;
const CLEAR_AFTER_MS = 5000;

type Timers = { speak?: ReturnType<typeof setTimeout>; clear?: ReturnType<typeof setTimeout> };
const timers: Record<"live-polite" | "live-assertive", Timers> = { "live-polite": {}, "live-assertive": {} };

const region = (id: keyof typeof timers): HTMLElement | null => (typeof document === "undefined" ? null : document.getElementById(id));

export function announce(message: string, assertive = false): void {
  const id = assertive ? "live-assertive" : "live-polite";
  const el = region(id);
  if (!el) return;
  const t = timers[id];
  // Clearing first makes a repeated message announce again.
  el.textContent = "";
  clearTimeout(t.speak);
  clearTimeout(t.clear);
  t.speak = setTimeout(() => {
    el.textContent = message;
    t.clear = setTimeout(() => {
      el.textContent = "";
    }, CLEAR_AFTER_MS);
  }, SPEAK_AFTER_MS);
}

/** Empties text that was already spoken. A message made just before, and not inserted yet, is still spoken. */
export function clearAnnouncements(): void {
  for (const id of ["live-polite", "live-assertive"] as const) {
    const el = region(id);
    if (!el) continue;
    clearTimeout(timers[id].clear);
    el.textContent = "";
  }
}
