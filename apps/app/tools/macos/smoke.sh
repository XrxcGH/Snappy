#!/bin/bash
# Smoke test of the unsigned universal macOS build, run by the "macOS universal build" job in
# .github/workflows/desktop-smoke.yml on a GitHub-hosted macOS runner. Run from the repository root:
#
#   BUNDLE_ROOT=apps/app/src-tauri/target/universal-apple-darwin/release/bundle OUT=macos-evidence bash apps/app/tools/macos/smoke.sh
#
# It reads no secret and signs nothing. It checks the finished files (Info.plist, architectures, ad-hoc signature, no
# entitlements, the disk image), then installs the app into a temporary folder, starts it, and checks that it stays alive,
# has a window, makes no connection outside this computer for OBSERVE_SECONDS (default 60), and exits when asked.
# Then probe.sh runs a stand-in (a plain WKWebView, not the app): it tries to reach a loopback test server, checks that the
# sampler can list the sockets of the web view's networking helper, and clicks a Save link.
# Every check writes its raw output into $OUT, which the job uploads. A failed check does not stop the script: it keeps
# collecting evidence and exits 1 at the end if anything failed.
#
# What a runner cannot tell you is in docs/RELEASES.md ("What CI checks, and what it cannot"). In short: this is an
# Apple silicon computer with no person at it, so Gatekeeper prompts, notarization, how the window looks and behaves
# under a real user, the file dialog, an Intel Mac and any macOS older than the runner's are all unchecked here.
#
# Plain bash 3.2 (the one macOS ships), so no associative arrays and no mapfile.

set -u -o pipefail

: "${BUNDLE_ROOT:?set BUNDLE_ROOT to the folder that holds macos/ and dmg/}"
: "${OUT:?set OUT to the folder that will hold the evidence}"
OBSERVE_SECONDS="${OBSERVE_SECONDS:-60}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
FAILURES="$OUT/failures.txt"
SUMMARY="$OUT/summary.txt"
: > "$FAILURES"
: > "$SUMMARY"

say() { echo "$*" | tee -a "$SUMMARY"; }
ok() { echo "ok:   $*" | tee -a "$SUMMARY"; }
note() { echo "note: $*" | tee -a "$SUMMARY"; }
fail() {
  echo "FAIL: $*" | tee -a "$SUMMARY" "$FAILURES"
  echo "::error::$*"
}
expect_eq() {
  if [ "$2" = "$3" ]; then ok "$1 is $3"; else fail "$1 is '$2', expected '$3'"; fi
}
# run_timeout SECONDS COMMAND...: macOS has no `timeout`; perl is always there.
run_timeout() {
  local secs="$1"
  shift
  perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
}

APP_PID=""
MNT=""
WATCH_PID=""
cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then kill -KILL "$APP_PID" 2>/dev/null; fi
  if [ -n "$WATCH_PID" ] && kill -0 "$WATCH_PID" 2>/dev/null; then kill "$WATCH_PID" 2>/dev/null; fi
  if [ -n "$MNT" ] && [ -d "$MNT" ]; then hdiutil detach "$MNT" -force > /dev/null 2>&1 || true; fi
}
trap cleanup EXIT

VERSION="$(node -p "require('./apps/app/src-tauri/tauri.conf.json').version")"
SHORT="${VERSION%%-*}"
say "Snappy $VERSION, macOS smoke test, $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
{
  sw_vers
  echo "machine: $(uname -m), $(sysctl -n machdep.cpu.brand_string 2>/dev/null || true)"
  xcodebuild -version 2>/dev/null || true
} > "$OUT/runner.txt" 2>&1
cat "$OUT/runner.txt" | tee -a "$SUMMARY"

# ------------------------------------------------------------------------------------------------
say ""
say "== 1. The built files =="
APP_BUILT="$BUNDLE_ROOT/macos/Snappy.app"
DMG_COUNT="$(ls "$BUNDLE_ROOT"/dmg/*.dmg 2>/dev/null | wc -l | tr -d ' ')"
expect_eq "number of .dmg files" "$DMG_COUNT" "1"
if [ "$DMG_COUNT" != "1" ] || [ ! -d "$APP_BUILT" ]; then
  fail "the build did not leave one .dmg and Snappy.app under $BUNDLE_ROOT"
  ls -R "$BUNDLE_ROOT" > "$OUT/bundle-listing.txt" 2>&1 || true
  exit 1
fi
DMG="$(ls "$BUNDLE_ROOT"/dmg/*.dmg | head -n 1)"
DMG_NAME="$(basename "$DMG")"
expect_eq "disk image name" "$DMG_NAME" "Snappy_${VERSION}_universal.dmg"
du -sk "$APP_BUILT" | awk '{ print "Snappy.app: " $1 " KB on disk" }' | tee -a "$SUMMARY"
echo "$DMG_NAME: $(stat -f %z "$DMG") bytes" | tee -a "$SUMMARY"

PLIST="$APP_BUILT/Contents/Info.plist"
plutil -lint "$PLIST" > "$OUT/Info.plist.lint.txt" 2>&1 && ok "Info.plist is valid" || fail "Info.plist is not valid"
plutil -p "$PLIST" > "$OUT/Info.plist.txt" 2>&1
plist_value() { /usr/libexec/PlistBuddy -c "Print :$1" "$PLIST" 2> /dev/null || echo "(missing)"; }
expect_eq "CFBundleIdentifier" "$(plist_value CFBundleIdentifier)" "com.snappy.export"
expect_eq "CFBundleName" "$(plist_value CFBundleName)" "Snappy"
expect_eq "CFBundleShortVersionString" "$(plist_value CFBundleShortVersionString)" "$SHORT"
expect_eq "CFBundleVersion" "$(plist_value CFBundleVersion)" "$SHORT"
expect_eq "SnappyReleaseVersion" "$(plist_value SnappyReleaseVersion)" "$VERSION"
expect_eq "LSMinimumSystemVersion" "$(plist_value LSMinimumSystemVersion)" "13.3"
expect_eq "LSApplicationCategoryType" "$(plist_value LSApplicationCategoryType)" "public.app-category.utilities"
expect_eq "NSHighResolutionCapable" "$(plist_value NSHighResolutionCapable)" "true"
if /usr/libexec/PlistBuddy -c "Print :NSAppTransportSecurity" "$PLIST" > /dev/null 2>&1; then
  fail "Info.plist has an NSAppTransportSecurity section (a network exception)"
else
  ok "Info.plist has no NSAppTransportSecurity section"
fi
EXE_NAME="$(plist_value CFBundleExecutable)"
EXE="$APP_BUILT/Contents/MacOS/$EXE_NAME"
[ -f "$EXE" ] && ok "executable $EXE_NAME exists" || fail "executable $EXE_NAME is missing"
for f in LICENSE NOTICE; do
  [ -s "$APP_BUILT/Contents/Resources/$f" ] && ok "$f is inside the app (Contents/Resources)" || fail "$f is missing from Contents/Resources"
done
ICON="$(plist_value CFBundleIconFile)"
if [ -f "$APP_BUILT/Contents/Resources/$ICON" ] || [ -f "$APP_BUILT/Contents/Resources/$ICON.icns" ]; then ok "icon $ICON is in the bundle"; else fail "icon $ICON is missing from Resources"; fi

# ------------------------------------------------------------------------------------------------
say ""
say "== 2. Architectures and the oldest macOS the program says it runs on =="
{
  lipo -info "$EXE"
  file "$EXE"
} > "$OUT/lipo.txt" 2>&1
ARCHS="$(lipo -archs "$EXE" 2> /dev/null)"
echo "lipo -archs: $ARCHS" | tee -a "$SUMMARY" "$OUT/lipo.txt"
case " $ARCHS " in *" arm64 "*) ok "the executable has an arm64 slice" ;; *) fail "the executable has no arm64 slice" ;; esac
case " $ARCHS " in *" x86_64 "*) ok "the executable has an x86_64 slice" ;; *) fail "the executable has no x86_64 slice" ;; esac
for arch in arm64 x86_64; do
  minos="$(otool -arch "$arch" -l "$EXE" 2> /dev/null | awk '/LC_BUILD_VERSION/ { f = 1 } f && /minos/ { print $2; exit }')"
  if [ -z "$minos" ]; then
    minos="$(otool -arch "$arch" -l "$EXE" 2> /dev/null | awk '/LC_VERSION_MIN_MACOSX/ { f = 1 } f && /version/ { print $2; exit }')"
  fi
  echo "minos ($arch): ${minos:-unknown}" | tee -a "$SUMMARY" "$OUT/lipo.txt"
  if [ -z "$minos" ]; then
    note "could not read the minimum macOS version of the $arch slice"
  elif [ "$(printf '%s\n%s\n' "$minos" "13.3" | sort -V | tail -n 1)" != "13.3" ]; then
    fail "the $arch slice needs macOS $minos, newer than the 13.3 that Info.plist promises"
  else
    ok "the $arch slice needs macOS $minos or newer, not newer than 13.3"
  fi
done
otool -arch arm64 -L "$EXE" > "$OUT/linked-libraries.txt" 2>&1 || true

# ------------------------------------------------------------------------------------------------
say ""
say "== 3. Signature (ad hoc), hardened runtime off, no entitlements =="
codesign -dv --verbose=4 "$APP_BUILT" > "$OUT/codesign.txt" 2>&1
if grep -q 'Signature=adhoc' "$OUT/codesign.txt"; then ok "the signature is ad hoc"; else fail "the signature is not ad hoc (see codesign.txt)"; fi
if grep -Eq 'flags=0x[0-9a-f]+\(.*runtime' "$OUT/codesign.txt"; then fail "hardened runtime is on (see codesign.txt)"; else ok "hardened runtime is off"; fi
if grep -q 'TeamIdentifier=not set' "$OUT/codesign.txt"; then ok "no team identifier"; else note "a team identifier is set (see codesign.txt)"; fi
if codesign --verify --deep --strict --verbose=2 "$APP_BUILT" > "$OUT/codesign-verify.txt" 2>&1; then ok "codesign --verify --deep --strict passes"; else fail "codesign --verify fails (see codesign-verify.txt)"; fi
ENTITLEMENTS="$(codesign -d --entitlements - "$APP_BUILT" 2> /dev/null)"
if [ -z "$ENTITLEMENTS" ]; then ok "the app carries no entitlements"; else fail "the app carries entitlements: $ENTITLEMENTS"; fi
echo "entitlements: ${ENTITLEMENTS:-none}" >> "$OUT/codesign.txt"

# ------------------------------------------------------------------------------------------------
say ""
say "== 4. The disk image =="
if hdiutil verify "$DMG" > "$OUT/dmg-verify.txt" 2>&1; then ok "hdiutil verify passes"; else fail "hdiutil verify fails (see dmg-verify.txt)"; fi
MNT="$(mktemp -d)/mount"
mkdir -p "$MNT"
hdiutil imageinfo "$DMG" > "$OUT/dmg-imageinfo.txt" 2>&1
if grep -q 'Software License Agreement: false' "$OUT/dmg-imageinfo.txt"; then ok "opening the disk image shows no license agreement"; else fail "the disk image carries a license agreement that opening it would show (see dmg-imageinfo.txt)"; fi
# printf answers "Y" to a license prompt, if one is there, so the rest of the checks can still run.
if printf 'Y\n' | hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG" > "$OUT/dmg-attach.txt" 2>&1; then
  ls -la "$MNT" > "$OUT/dmg-contents.txt" 2>&1
  [ -d "$MNT/Snappy.app" ] && ok "the disk image holds Snappy.app" || fail "the disk image has no Snappy.app"
  if [ -L "$MNT/Applications" ]; then
    expect_eq "the Applications link in the disk image points to" "$(readlink "$MNT/Applications")" "/Applications"
  else
    fail "the disk image has no Applications symlink"
  fi
  # Anything else in the image is listed, not failed: a hidden .background or .DS_Store may be there.
  find "$MNT" -maxdepth 1 -mindepth 1 -print | sed "s|^$MNT/||" | sort | tr '\n' ' ' | sed 's/^/top level of the disk image: /; s/$/\n/' | tee -a "$SUMMARY"
else
  fail "the disk image would not mount (see dmg-attach.txt)"
fi

APPS="$(mktemp -d)/Applications"
mkdir -p "$APPS"
if [ -d "$MNT/Snappy.app" ]; then
  ditto "$MNT/Snappy.app" "$APPS/Snappy.app"
  if [ "$(shasum -a 256 < "$MNT/Snappy.app/Contents/MacOS/$EXE_NAME")" = "$(shasum -a 256 < "$EXE")" ]; then ok "the app in the disk image is the app that was built"; else fail "the executable in the disk image differs from the built one"; fi
else
  ditto "$APP_BUILT" "$APPS/Snappy.app"
fi
hdiutil detach "$MNT" > /dev/null 2>&1 || hdiutil detach "$MNT" -force > /dev/null 2>&1 || true
if codesign --verify --deep --strict "$APPS/Snappy.app" > /dev/null 2>&1; then ok "the installed copy still verifies"; else fail "the installed copy does not verify"; fi
xattr -lr "$APPS/Snappy.app" > "$OUT/xattr.txt" 2>&1 || true
if grep -q 'com.apple.quarantine' "$OUT/xattr.txt"; then note "the installed copy carries a quarantine mark"; else ok "the installed copy has no quarantine mark (a download would have one)"; fi
{
  echo "spctl --assess --type execute on the installed copy (information only; an ad-hoc app is expected to be rejected):"
  spctl --assess --type execute --verbose=4 "$APPS/Snappy.app" 2>&1
  echo "exit code: $?"
} > "$OUT/gatekeeper.txt" 2>&1
sed -n '1,6p' "$OUT/gatekeeper.txt" | tee -a "$SUMMARY"

# ------------------------------------------------------------------------------------------------
say ""
say "== 5. Positive control for the connection sampler (an ordinary process; the web view's helper is checked in section 7) =="
if python3 -I "$HERE/netwatch.py" --control --log "$OUT/control.log"; then
  ok "lsof listed a held connection of an ordinary child process (control.log); this does not show it can list the web view's helper (section 7)"
else
  fail "the sampler did NOT see the control connection, so its silence proves nothing (control.log)"
fi

# ------------------------------------------------------------------------------------------------
say ""
say "== 6. Start the app, watch it for ${OBSERVE_SECONDS} seconds =="
export SNAPPY_MATCH="$APPS/Snappy.app/Contents/MacOS/"
STOP="$OUT/.stop-watch"
rm -f "$STOP"
python3 -I "$HERE/netwatch.py" --log "$OUT/connections.log" --stop-file "$STOP" --interval 0.5 &
WATCH_PID=$!
sleep 3
LAUNCHED="$(date +%s)"
open -n "$APPS/Snappy.app"
for _ in $(seq 1 60); do
  APP_PID="$(pgrep -f -- "$SNAPPY_MATCH" | head -n 1)"
  [ -n "$APP_PID" ] && break
  sleep 0.5
done
if [ -z "$APP_PID" ]; then
  fail "no Snappy process appeared within 30 seconds of open -n"
else
  ok "Snappy is running as process $APP_PID"
  sleep 12
  if kill -0 "$APP_PID" 2>/dev/null; then ok "the process is still alive 12 seconds after it started"; else fail "the process died within 12 seconds of starting"; fi

  # A window: the window server must list one owned by the app. If this session has no window server access at all
  # (no window of any process is listed), say so and do not pretend.
  xcrun swift "$HERE/windows.swift" "$APP_PID" > "$OUT/windows.txt" 2>&1
  TOTAL="$(sed -n 's/^total=//p' "$OUT/windows.txt")"
  MINE="$(sed -n 's/^mine=//p' "$OUT/windows.txt")"
  if [ -z "$TOTAL" ]; then
    note "could not list windows (see windows.txt): the window check is not verified"
  elif [ "$TOTAL" = "0" ]; then
    note "the window server lists no windows at all in this session, so a window for Snappy cannot be confirmed or denied"
  elif [ "${MINE:-0}" -ge 1 ]; then
    BIG="$(awk '/^window / { for (i = 1; i <= NF; i++) { if ($i ~ /^w=/) { w = substr($i, 3) + 0 } if ($i ~ /^h=/) { h = substr($i, 3) + 0 } if ($i ~ /^layer=/) { l = substr($i, 7) + 0 } } if (l == 0 && w >= 400 && h >= 300) { print w "x" h; exit } }' "$OUT/windows.txt")"
    if [ -n "$BIG" ]; then ok "the window server lists a Snappy window of $BIG points (layer 0), among $TOTAL windows"; else fail "Snappy owns $MINE window(s) but none is a normal window of at least 400 x 300 (see windows.txt)"; fi
  else
    fail "the window server lists $TOTAL windows but none belongs to Snappy (see windows.txt)"
  fi

  # Screenshots: of the window if it can be found, and of the screen. Both can come out empty on a runner without the
  # Screen Recording permission, so the file is kept and the job reports what it got. A person looks at it.
  WID="$(sed -n 's/^window id=\([0-9]*\) layer=0 .*/\1/p' "$OUT/windows.txt" | head -n 1)"
  if [ -n "$WID" ]; then
    screencapture -x -o -l "$WID" "$OUT/snappy-window.png" > "$OUT/screencapture.txt" 2>&1 || true
  fi
  screencapture -x "$OUT/screen.png" >> "$OUT/screencapture.txt" 2>&1 || true
  for f in snappy-window.png screen.png; do
    if [ -s "$OUT/$f" ]; then
      echo "$f: $(sips -g pixelWidth -g pixelHeight "$OUT/$f" 2> /dev/null | awk '/pixel/ { printf "%s ", $2 }') pixels, $(stat -f %z "$OUT/$f") bytes" | tee -a "$SUMMARY"
    else
      note "$f was not written (see screencapture.txt)"
    fi
  done

  # The menu bar, through System Events. Needs the Accessibility permission, which a runner may not grant.
  MENU_QUERY="tell application \"System Events\" to tell (first process whose unix id is $APP_PID) to get name of every menu bar item of menu bar 1"
  run_timeout 30 osascript -e "$MENU_QUERY" > "$OUT/menu.txt" 2>&1
  EDIT_QUERY="tell application \"System Events\" to tell (first process whose unix id is $APP_PID) to get name of every menu item of menu 1 of menu bar item \"Edit\" of menu bar 1"
  run_timeout 30 osascript -e "$EDIT_QUERY" >> "$OUT/menu.txt" 2>&1
  cat "$OUT/menu.txt" | tee -a "$SUMMARY"
  if grep -q 'Edit' "$OUT/menu.txt" && grep -q 'Copy' "$OUT/menu.txt" && grep -q 'Paste' "$OUT/menu.txt" && grep -q 'Select All' "$OUT/menu.txt"; then
    ok "the menu bar has an Edit menu with Copy, Paste and Select All"
  elif grep -qiE 'not allowed|assistive|-1743|-25211|-1719' "$OUT/menu.txt"; then
    note "the menu bar could not be read (no Accessibility permission for this session): the Edit menu is not verified"
  else
    fail "the menu bar has no Edit menu with Copy, Paste and Select All (see menu.txt)"
  fi

  ps -axo pid,ppid,rss,command | grep -E "Snappy|com\.apple\.WebKit" | grep -v grep > "$OUT/processes.txt" 2>&1 || true

  NOW="$(date +%s)"
  REMAIN=$((LAUNCHED + OBSERVE_SECONDS - NOW))
  if [ "$REMAIN" -gt 0 ]; then sleep "$REMAIN"; fi
  if kill -0 "$APP_PID" 2>/dev/null; then ok "the process is still alive after $OBSERVE_SECONDS seconds"; else fail "the process died before $OBSERVE_SECONDS seconds had passed"; fi

  # Ask it to quit the way a person would, then end it if that did nothing. The job needs it gone.
  run_timeout 20 osascript -e 'tell application id "com.snappy.export" to quit' > "$OUT/quit.txt" 2>&1
  for _ in $(seq 1 30); do
    kill -0 "$APP_PID" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$APP_PID" 2>/dev/null; then
    note "the Quit Apple event did not end the app within 15 seconds (quit.txt); sending SIGTERM"
    kill -TERM "$APP_PID" 2>/dev/null
    for _ in $(seq 1 30); do
      kill -0 "$APP_PID" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$APP_PID" 2>/dev/null; then
      fail "the app ignored SIGTERM for 15 seconds and had to be killed"
      kill -KILL "$APP_PID" 2>/dev/null
    else
      ok "the app exited after SIGTERM"
    fi
  else
    ok "the app exited after the Quit Apple event"
  fi
  sleep 3
  if pgrep -f -- "$SNAPPY_MATCH" > /dev/null; then fail "a process of the app is still running after it exited"; else ok "no process of the app is left"; fi
  ps -axo pid,ppid,rss,command | grep -E "Snappy|com\.apple\.WebKit" | grep -v grep > "$OUT/processes-after.txt" 2>&1 || true
fi

touch "$STOP"
wait "$WATCH_PID"
WATCH_RC=$?
WATCH_PID=""
case "$WATCH_RC" in
  0) ok "no connection to a non-loopback address from the app's processes (connections.log)" ;;
  3) fail "the app's processes had a connection to a non-loopback address (connections.log)" ;;
  5) fail "the sampler never saw the app (connections.log)" ;;
  6) fail "no WebKit networking helper that started after the watch was counted as the app's, so its connections could not have been seen (connections.log)" ;;
  *) fail "the sampler stopped with code $WATCH_RC (connections.log)" ;;
esac
grep -E '^(samples|the app first appeared|WebKit networking|sockets of any kind|connections to a non-loopback|loopback-only|sockets those)' "$OUT/connections.log" | tee -a "$SUMMARY"

# ------------------------------------------------------------------------------------------------
say ""
say "== 7. A WebKit stand-in: the sampler on the web view's helper, blocked addresses, web features, a Save click =="
say "(Not the Snappy app: a plain WKWebView that applies the same WebKit hooks. See webkit-probe.swift.)"
OUT="$OUT" bash "$HERE/probe.sh" 2>&1 | tee -a "$SUMMARY"
if [ "${PIPESTATUS[0]}" != "0" ]; then fail "a WebKit stand-in check failed (see the FAIL lines above)"; fi

# ------------------------------------------------------------------------------------------------
say ""
say "== 8. What the app left on this computer (for docs/MACOS.md) =="
{
  echo "Entries under ~/Library whose name contains snappy (any case), at most 5 levels deep, with sizes in KB:"
  find "$HOME/Library" -maxdepth 5 -iname '*snappy*' -print 2> /dev/null | while IFS= read -r p; do
    du -sk "$p" 2> /dev/null
  done
  echo
  echo "Everything inside those folders (first 60 entries):"
  find "$HOME/Library/WebKit/com.snappy.export" "$HOME/Library/Caches/com.snappy.export" "$HOME/Library/Application Support/com.snappy.export" "$HOME/Library/Saved Application State/com.snappy.export.savedState" "$HOME/Library/Preferences/com.snappy.export.plist" -print 2> /dev/null | head -n 60
} > "$OUT/data-locations.txt" 2>&1
cat "$OUT/data-locations.txt" | tee -a "$SUMMARY"

# ------------------------------------------------------------------------------------------------
say ""
say "== 9. The files that are uploaded =="
mkdir -p "$OUT/files"
cp "$DMG" "$OUT/files/$DMG_NAME"
TAR_NAME="Snappy_${VERSION}_universal.app.tar.gz"
COPYFILE_DISABLE=1 tar -C "$BUNDLE_ROOT/macos" -czf "$OUT/files/$TAR_NAME" Snappy.app
(
  cd "$OUT/files" || exit 1
  shasum -a 256 "$DMG_NAME" > "$DMG_NAME.sha256"
  shasum -a 256 "$TAR_NAME" > "$TAR_NAME.sha256"
  cat "$DMG_NAME.sha256" "$TAR_NAME.sha256"
) | tee -a "$SUMMARY"

say ""
if [ -s "$FAILURES" ]; then
  say "RESULT: $(wc -l < "$FAILURES" | tr -d ' ') check(s) failed:"
  cat "$FAILURES"
  exit 1
fi
say "RESULT: every check passed (the notes above say what could not be checked on this runner)."
