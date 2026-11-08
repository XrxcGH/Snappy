#!/bin/bash
# Runs the WebKit stand-in (webkit-probe.swift) against a loopback test server and says what happened.
# Called by smoke.sh in CI; needs only a Mac with Xcode's command line tools:  OUT=some-folder bash probe.sh
#
# Each blocked-address scenario is one page load that tries one family of ways to reach the server (so one channel cannot
# hide another), run twice: "locked" applies the navigation policy, the new-window refusal and a content policy like the
# app's; "control" applies none of them and lets a new window open. The server must receive each channel's request in the
# control run (so the test can see it) and none in the locked run. Exit code 1 if the locked run let ANY request through.
#
# Two more checks, whose results are separate lines:
#   * The sampler around the control run. netwatch.py watches the stand-in's processes while the control run holds a
#     request open to the server, and must list a socket of the com.apple.WebKit.Networking helper. That is the evidence that
#     `lsof -i` can see the sandboxed helper's sockets, which the connection watch of the real app depends on.
#   * Two download scenarios: a Save click (a blob link with a download name) with a download handler (what the shell now
#     has) must save the file, and the same click without one (what the shell had before) must save nothing.
#
# A stand-in that cannot be built or started is a note, not a failure: the probe is evidence, not a gate on the build.
# A control that cannot see the helper's sockets, and a locked run that leaks, are failures.
# Plain bash 3.2.

set -u -o pipefail
: "${OUT:?set OUT to the folder that will hold the output}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
RC=0
ok() { echo "ok:   $*"; }
note() { echo "note: $*"; }
fail() {
  echo "FAIL: $*"
  RC=1
}
run_timeout() {
  local secs="$1"
  shift
  perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
}

PROBE_DIR="$(mktemp -d)"
SERVER_PID=""
WATCH_PID=""
trap '[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2> /dev/null; [ -n "$WATCH_PID" ] && kill "$WATCH_PID" 2> /dev/null' EXIT

if ! xcrun swiftc -swift-version 5 -O "$HERE/webkit-probe.swift" -o "$PROBE_DIR/webkit-probe" > "$OUT/webkit-probe-build.txt" 2>&1; then
  note "the WebKit stand-in did not compile (webkit-probe-build.txt): not run"
  exit 0
fi
python3 -I "$HERE/probe-server.py" "$PROBE_DIR/port" "$PROBE_DIR/requests.txt" &
SERVER_PID=$!
for _ in $(seq 1 40); do
  [ -s "$PROBE_DIR/port" ] && break
  sleep 0.25
done
PROBE_PORT="$(cat "$PROBE_DIR/port" 2> /dev/null)"
if [ -z "$PROBE_PORT" ]; then
  note "the probe's test server did not start: the blocked-address check was not run"
  exit 0
fi
BASE="http://127.0.0.1:$PROBE_PORT"

# run_probe MODE SCENARIO: one page load. Output goes to webkit-probe-MODE-SCENARIO.txt, the server's requests are appended
# to webkit-probe-MODE-requests.txt.
run_probe() {
  local mode="$1" scenario="$2" file
  file="$OUT/webkit-probe-$mode-$scenario.txt"
  : > "$PROBE_DIR/requests.txt"
  run_timeout 60 "$PROBE_DIR/webkit-probe" "$mode" "$scenario" "$BASE" > "$file" 2>&1
  echo "exit code: $?" >> "$file"
  sleep 1
  cat "$PROBE_DIR/requests.txt" >> "$OUT/webkit-probe-$mode-requests.txt"
}

: > "$OUT/webkit-probe-locked-requests.txt"
: > "$OUT/webkit-probe-control-requests.txt"
SCENARIOS="subresources link-self form location-replace location-href"

# ---- The locked runs, then the control runs; the control's first run is watched by the sampler.
for scenario in $SCENARIOS; do run_probe locked "$scenario"; done

STOP="$PROBE_DIR/stop-watch"
rm -f "$STOP"
SNAPPY_MATCH="$PROBE_DIR/webkit-probe" python3 -I "$HERE/netwatch.py" --log "$OUT/webkit-control-sockets.log" --stop-file "$STOP" --interval 0.3 --require-webkit-socket &
WATCH_PID=$!
sleep 2
for scenario in $SCENARIOS; do
  run_probe control "$scenario"
  if [ "$scenario" = "subresources" ]; then
    touch "$STOP"
    wait "$WATCH_PID"
    WATCH_RC=$?
    WATCH_PID=""
    case "$WATCH_RC" in
      0) ok "the sampler listed sockets of the WebKit networking helper while the stand-in talked to the test server (webkit-control-sockets.log)" ;;
      6) fail "the sampler counted no WebKit networking helper for the stand-in (webkit-control-sockets.log): the app's watch could not be trusted" ;;
      7) fail "the sampler counted the WebKit networking helper but lsof listed none of its sockets (webkit-control-sockets.log): the app's watch could not have seen its connections" ;;
      5) fail "the sampler never saw the stand-in's processes (webkit-control-sockets.log)" ;;
      *) fail "the sampler stopped with code $WATCH_RC around the stand-in (webkit-control-sockets.log)" ;;
    esac
    grep -E '^(samples|WebKit networking|sockets of any kind|loopback-only)' "$OUT/webkit-control-sockets.log" | sed 's/^/      /'
  fi
done

# ---- Per channel: what reached the test server.
CHANNELS="fetchHold:/hold windowOpen:/window-open linkBlank:/link-blank fetch:/fetch xhr:/xhr image:/image.png iframe:/iframe webSocket:/websocket beacon:/beacon linkSelf:/link-self form:/form locationReplace:/location-replace locationHref:/location-href"
reached() { # reached REQUESTS-FILE PATH
  grep -qE " $2(\?.*)?\$" "$1" && echo yes || echo no
}
TOTAL=0
SHOWN=0
NOT_SHOWN=""
LEAKED=""
{
  echo "channel: reached the test server in the control run / in the locked run"
  for c in $CHANNELS; do
    name="${c%%:*}"
    path="${c#*:}"
    in_control="$(reached "$OUT/webkit-probe-control-requests.txt" "$path")"
    in_locked="$(reached "$OUT/webkit-probe-locked-requests.txt" "$path")"
    echo "  $name ($path): control $in_control, locked $in_locked"
    TOTAL=$((TOTAL + 1))
    if [ "$in_control" = "yes" ]; then SHOWN=$((SHOWN + 1)); else NOT_SHOWN="$NOT_SHOWN $name"; fi
    if [ "$in_locked" = "yes" ]; then LEAKED="$LEAKED $name"; fi
  done
} > "$OUT/webkit-probe-channels.txt"
cat "$OUT/webkit-probe-channels.txt"
LOCKED_HITS="$(wc -l < "$OUT/webkit-probe-locked-requests.txt" | tr -d ' ')"
if [ "$SHOWN" = "0" ]; then
  note "the control runs (no policy) reached the test server with none of the $TOTAL channels, so the blocked-address result proves nothing (webkit-probe-control-*.txt)"
elif [ -n "$LEAKED" ] || [ "$LOCKED_HITS" != "0" ]; then
  fail "WebKit sent $LOCKED_HITS request(s) to the test server although the policies refused them; channels:${LEAKED:- (see webkit-probe-locked-requests.txt)}"
else
  ok "the locked runs sent 0 requests to the test server; the control runs showed that $SHOWN of the $TOTAL channels do reach it"
  if [ -n "$NOT_SHOWN" ]; then note "channels the control did not show reaching the server (so their zero in the locked run proves nothing):$NOT_SHOWN"; fi
fi
grep -hE '^(refused|opened|navigated)' "$OUT"/webkit-probe-locked-*.txt "$OUT"/webkit-probe-control-*.txt 2> /dev/null | sort | uniq -c | sed 's/^/      /'

# ---- Web features under the custom scheme.
grep -E '^(page loaded|api |probe:)' "$OUT/webkit-probe-locked-subresources.txt"
for want in "isSecureContext=true" "cryptoSubtle=object" "pbkdf2AesGcmRoundTrip=ok" "locksRequest=ok" "objectHasOwn=function" "indexedDB=ok" "blobWorker=ok: hi"; do
  if grep -qx "api $want" "$OUT/webkit-probe-locked-subresources.txt"; then ok "stand-in page: $want"; else note "stand-in page did not report $want (webkit-probe-locked-subresources.txt)"; fi
done

# ---- A Save click, with and without a download handler.
for variant in handler nohandler; do
  mkdir -p "$PROBE_DIR/downloads-$variant"
  SNAPPY_PROBE_DOWNLOADS="$PROBE_DIR/downloads-$variant" run_probe locked "download-$variant"
done
SAVED="$PROBE_DIR/downloads-handler/probe-save.txt"
if [ -f "$SAVED" ] && [ "$(cat "$SAVED")" = "synthetic file body" ]; then
  ok "a Save click (blob link with a download name) saved the file when the policy was 'download' (what the shell now does on macOS)"
  cp "$SAVED" "$OUT/webkit-probe-saved-file.txt"
else
  fail "a Save click did not save the file even with a download policy (webkit-probe-locked-download-handler.txt): the shell's download handler would not help"
fi
if [ -n "$(ls -A "$PROBE_DIR/downloads-nohandler" 2> /dev/null)" ]; then
  note "the same click saved a file although the policy was 'cancel' (webkit-probe-locked-download-nohandler.txt)"
else
  ok "the same click saved nothing when the policy was 'cancel' (what the shell did before the handler)"
fi
grep -h '^download:' "$OUT/webkit-probe-locked-download-handler.txt" "$OUT/webkit-probe-locked-download-nohandler.txt" 2> /dev/null | sed 's/^/      /'
exit "$RC"
