#!/usr/bin/env bash
# Headless test runner for the Archean blueprint tools.
#
# Requires: python3 (http.server) and a Chromium-family browser
#           ($CHROME, or auto-detected: chromium / chromium-browser / google-chrome).
#
# Runs:  1. viewer selftest  — edit→serialize→occupancy/mirror sync, byte round-trip
#        2. regtest suite    — format invariants + hull fit over every testdata craft
#        3. proxytest        — low-poly vs real geometry per component type
#        4. smoke render     — one WebGL screenshot (needs swiftshader in headless)
#
# Exit code: 0 = all passed. Artifacts in $OUT (default /tmp/archean-tests).
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
OUT="${OUT:-/tmp/archean-tests}"
PORT="${PORT:-8650}"
CHROME="${CHROME:-$(command -v chromium chromium-browser google-chrome 2>/dev/null | head -1)}"
[ -n "$CHROME" ] || { echo "no chromium found (set CHROME=...)"; exit 2; }
# every browser step is wall-clock capped: a hung SwiftShader render must FAIL,
# not stall the suite (virtual-time-budget only bounds virtual time)
chrome() { timeout "${SHOT_TIMEOUT:-150}" "$CHROME" --headless=new --no-sandbox \
  --disable-gpu --disable-dev-shm-usage --enable-unsafe-swiftshader "$@"; }
mkdir -p "$OUT"
touch "$OUT/.start"          # freshness marker: stale screenshots from old runs must not pass

python3 -m http.server "$PORT" --directory "$REPO" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
BASE="http://127.0.0.1:$PORT"
fail=0

echo "── selftest (viewer)"
title=$(chrome --virtual-time-budget=20000 \
  --dump-dom "$BASE/viewer/index.html?selftest" 2>/dev/null | grep -oPm1 '(?<=<title>)[^<]*')
echo "   $title"
case "$title" in *SELFTEST\ PASS*) ;; *) echo "   FAIL"; fail=1;; esac

echo "── regtest (all testdata blueprints)"
reg=$(chrome --virtual-time-budget=90000 \
  --dump-dom "$BASE/regtest/regtest.html" 2>/dev/null \
  | python3 -c "import sys,re,html; t=sys.stdin.read(); m=re.search(r'id=\"out\">(.*?)</div>', t, re.S); print(html.unescape(m.group(1)) if m else 'NO OUTPUT')")
echo "$reg" | grep -v ' OK$' | tail -8
echo "$reg" | grep -q 'REGTEST: PASS' || fail=1

echo "── proxytest (low-poly meshes vs real geometry, all atlas types)"
title=$(chrome --virtual-time-budget=30000 \
  --dump-dom "$BASE/viewer/index.html?proxytest" 2>/dev/null | grep -oPm1 '(?<=<title>)[^<]*')
echo "   $title"
case "$title" in *PASS*) ;; *) echo "   FAIL"; fail=1;; esac

echo "── comptest (cable endpoints vs nubs/tubes/models, ISW-241)"
title=$(chrome --virtual-time-budget=30000 \
  --dump-dom "$BASE/viewer/index.html?comptest" 2>/dev/null | grep -oPm1 '(?<=<title>)[^<]*')
echo "   $title"
case "$title" in *COMPTEST\ 60/60\ PASS*) ;; *) echo "   FAIL"; fail=1;; esac

echo "── smoke render"
chrome --window-size=1400,900 --virtual-time-budget=15000 \
  --screenshot="$OUT/viewer.png" "$BASE/viewer/index.html" 2>/dev/null
[ -s "$OUT/viewer.png" ] && [ "$OUT/viewer.png" -nt "$OUT/.start" ] && echo "   ok: $OUT/viewer.png" || { echo "   FAIL (no screenshot)"; fail=1; }

echo "── flow render (with streamlines)"
SHOT_TIMEOUT=240 chrome --window-size=640,400 --virtual-time-budget=2500 \
  --screenshot="$OUT/flow.png" "$BASE/viewer/index.html?flow&flowlow" 2>/dev/null
[ -s "$OUT/flow.png" ] && [ "$OUT/flow.png" -nt "$OUT/.start" ] && echo "   ok: $OUT/flow.png" || { echo "   FAIL (no screenshot)"; fail=1; }

[ $fail -eq 0 ] && echo "ALL TESTS PASS" || echo "TESTS FAILED"
exit $fail
