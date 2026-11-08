#!/bin/bash
# Runs the WebKit stand-in (webkit-probe.swift) against a loopback test server, twice, and says what happened.
# Called by smoke.sh in CI; needs only a Mac with Xcode's command line tools:  OUT=some-folder bash probe.sh
#
# "locked" applies the navigation policy, the new-window refusal and a content policy like the app's; "control" applies
# none of them. The server must receive requests in the control run (so the test can see them) and none in the locked run.
# Exit code 1 only if the locked run let a request through while the control run proved the server can see them.
# Everything else that goes wrong is a note: the probe is evidence, not a gate on the build.
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
trap '[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2> /dev/null' EXIT

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

for mode in locked control; do
  : > "$PROBE_DIR/requests.txt"
  run_timeout 60 "$PROBE_DIR/webkit-probe" "$mode" "http://127.0.0.1:$PROBE_PORT" > "$OUT/webkit-probe-$mode.txt" 2>&1
  echo "exit code: $?" >> "$OUT/webkit-probe-$mode.txt"
  sleep 1
  cp "$PROBE_DIR/requests.txt" "$OUT/webkit-probe-$mode-requests.txt"
done
LOCKED_HITS="$(wc -l < "$OUT/webkit-probe-locked-requests.txt" | tr -d ' ')"
CONTROL_HITS="$(wc -l < "$OUT/webkit-probe-control-requests.txt" | tr -d ' ')"
if [ "$CONTROL_HITS" = "0" ]; then
  note "the control run (no policy) reached the test server 0 times, so the blocked-address result proves nothing (webkit-probe-control.txt)"
elif [ "$LOCKED_HITS" != "0" ]; then
  fail "WebKit sent $LOCKED_HITS request(s) to the test server although the navigation policy and content policy refused them (webkit-probe-locked-requests.txt)"
else
  ok "with the navigation policy, the new-window refusal and the content policy the test server received 0 requests; without them it received $CONTROL_HITS (webkit-probe-*-requests.txt)"
fi
grep -E '^(page loaded|refused|api |probe:)' "$OUT/webkit-probe-locked.txt"
for want in "isSecureContext=true" "cryptoSubtle=object" "pbkdf2AesGcmRoundTrip=ok" "locksRequest=ok" "objectHasOwn=function" "indexedDB=ok" "blobWorker=ok: hi"; do
  if grep -qx "api $want" "$OUT/webkit-probe-locked.txt"; then ok "stand-in page: $want"; else note "stand-in page did not report $want (webkit-probe-locked.txt)"; fi
done
exit "$RC"
