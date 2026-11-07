/**
 * Screen-reader announcements through the two live regions in index.html. Messages must be
 * short and must not contain message text, display names, or other personal details.
 */
let timer: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string, assertive = false): void {
  const el = document.getElementById(assertive ? "live-assertive" : "live-polite");
  if (!el) return;
  // Clearing first makes a repeated message announce again.
  el.textContent = "";
  clearTimeout(timer);
  timer = setTimeout(() => {
    el.textContent = message;
  }, 50);
}
