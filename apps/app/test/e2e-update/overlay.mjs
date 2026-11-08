/**
 * The configuration overlay the update drill hands to `tauri build --config`, made from tauri.e2e.conf.json.
 * The file carries a `$comment` that explains it to a reader, but Tauri's configuration schema allows no extra
 * properties and the build stops with "'$comment' was unexpected", so every key that starts with `$` is dropped here,
 * and the version of the build is added.
 */
export function overlayFor(fileText, version) {
  const parsed = JSON.parse(fileText);
  const kept = Object.fromEntries(Object.entries(parsed).filter(([key]) => !key.startsWith("$")));
  return { ...kept, version };
}
