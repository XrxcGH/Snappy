/* Runs in <head>, before the first paint, so a returning visitor who chose the light theme (or "match device") never
   sees a dark frame first. It only reads the one word saved under "snappy-theme" and sets data-theme on <html>; the
   page ships data-theme="dark", which is what a first visit sees. Nothing is written and nothing leaves the device.
   The key and the three words are the same as vault.ts and app-shell.ts use (a test keeps them in step). The build
   inlines this file and adds its hash to the Content-Security-Policy. */
try {
  var theme = localStorage.getItem("snappy-theme");
  var root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else if (theme === "system") root.removeAttribute("data-theme");
} catch (error) {
  /* Storage can be blocked (private windows, file:// in some browsers): the dark default stays. */
}
