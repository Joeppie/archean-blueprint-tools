#!/usr/bin/env bash
# Headless test runner for the Archean blueprint tools.
#
# Requires: python3 (http.server) and a Chromium-family browser
#           ($CHROME, or auto-detected: chromium / chromium-browser / google-chrome).
#
# Runs:  1. viewer selftest  — edit→serialize→occupancy/mirror sync, byte round-trip
#        2. regtest suite    — format invariants + hull fit over every testdata craft
#        3. smoke render     — one WebGL screenshot (needs swiftshader in headless)
#
# Exit code: 0 = all passed. Artifacts in $OUT (default /tmp/archean-tests).
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
OUT="${OUT:-/tmp/archean-tests}"
PORT="${PORT:-8650}"
CHROME="${CHROME:-$(command -v chromium chromium-browser google-chrome 2>/dev/null | head -1)}"
[ -n "$CHROME" ] || { echo "no chromium found (set CHROME=...)"; exit 2; }
mkdir -p "$OUT"

python3 -m http.server "$PORT" --directory "$REPO" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
BASE="http://127.0.0.1:$PORT"
fail=0

echo "── selftest (viewer)"
title=$("$CHROME" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=20000 \
  --dump-dom "$BASE/viewer/index.html?selftest" 2>/dev/null | grep -oPm1 '(?<=<title>)[^<]*')
echo "   $title"
case "$title" in *SELFTEST\ PASS*) ;; *) echo "   FAIL"; fail=1;; esac

echo "── regtest (all testdata blueprints)"
reg=$("$CHROME" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=90000 \
  --dump-dom "$BASE/regtest/regtest.html" 2>/dev/null \
  | python3 -c "import sys,re,html; t=sys.stdin.read(); m=re.search(r'id=\"out\">(.*?)</div>', t, re.S); print(html.unescape(m.group(1)) if m else 'NO OUTPUT')")
echo "$reg" | grep -v ' OK$' | tail -8
echo "$reg" | grep -q 'REGTEST: PASS' || fail=1

echo "── smoke render"
"$CHROME" --headless=new --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
  --window-size=1400,900 --virtual-time-budget=15000 \
  --screenshot="$OUT/viewer.png" "$BASE/viewer/index.html" 2>/dev/null
[ -s "$OUT/viewer.png" ] && echo "   ok: $OUT/viewer.png" || { echo "   FAIL (no screenshot)"; fail=1; }

echo "── flow render (with streamlines)"
"$CHROME" --headless=new --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
  --window-size=1400,900 --virtual-time-budget=15000 \
  --screenshot="$OUT/flow.png" "$BASE/viewer/index.html?flow" 2>/dev/null
[ -s "$OUT/flow.png" ] && echo "   ok: $OUT/flow.png" || { echo "   FAIL (no screenshot)"; fail=1; }

[ $fail -eq 0 ] && echo "ALL TESTS PASS" || echo "TESTS FAILED"
exit $fail
