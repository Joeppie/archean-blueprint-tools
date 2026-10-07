#!/usr/bin/env bash
# Headless test runner for the Archean blueprint tools.
#
# Requires: python3 (http.server) and a Chromium-family browser
#           ($CHROME, or auto-detected: chromium / chromium-browser / google-chrome).
#
# Runs:  1. viewer selftest  — edit→serialize→occupancy/mirror sync, byte round-trip
#        2. regtest suite    — format invariants + hull fit over every testdata craft
#        3. proxytest        — low-poly vs real geometry per component type
#        4. smoke render     — one WebGL screenshot (iGPU Vulkan via ANGLE;
#                              GPU=0 forces the slow SwiftShader CPU fallback)
#
# Exit code: 0 = all passed. Artifacts in $OUT (default /tmp/archean-tests).
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
OUT="${OUT:-/tmp/archean-tests}"
PORT="${PORT:-8650}"
CHROME="${CHROME:-$(command -v chromium chromium-browser google-chrome 2>/dev/null | head -1)}"
[ -n "$CHROME" ] || { echo "no chromium found (set CHROME=...)"; exit 2; }
# GPU rendering is the default: real Vulkan via ANGLE. We PIN THE AMD iGPU
# (VK_ICD_FILENAMES hides the NVIDIA ICD from chromium entirely) because the
# discrete GPU is usually running AI models — contending with it jeopardizes
# their continuity, and RADV renders this viewer in <1 s headless.
# QUICK CHECK before GPU runs: `nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv`
# — if util/mem show live work, keep the iGPU pin (i.e. leave this as-is).
# GPU=0 falls back to SwiftShader (CPU rasterizer): every virtual frame then
# costs ~13-300 ms wall, so dump budgets >10 s and screenshots at budgets
# ≥10 s stop completing — a SwiftShader limit, not a viewer problem.
IGPU_ICD="/usr/share/vulkan/icd.d/radeon_icd.json"
if [ "${GPU:-1}" = "1" ] && [ -f "$IGPU_ICD" ]; then
  export VK_ICD_FILENAMES="$IGPU_ICD"
  chrome() { timeout "${SHOT_TIMEOUT:-90}" "$CHROME" --headless=new --no-sandbox \
    --disable-dev-shm-usage --use-gl=angle --use-angle=vulkan "$@"; }
else
  chrome() { timeout "${SHOT_TIMEOUT:-240}" "$CHROME" --headless=new --no-sandbox \
    --disable-gpu --disable-dev-shm-usage --enable-unsafe-swiftshader "$@"; }
fi
SMBUD=15000; [ "${GPU:-1}" = "1" ] || SMBUD=8000   # swiftshader dies at 15000 (see above)
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

echo "── position tests (placement fixtures + generic button sweep)"
for c in 3812927875 3518436870 3417786605 3803780241; do
  title=$(chrome --virtual-time-budget=12000 \
    --dump-dom "$BASE/viewer/index.html?open=../testdata/$c/blueprint.json&postest" 2>/dev/null \
    | grep -oPm1 '(?<=<title>)[^<]*')
  echo "   $c: $title"
  case "$title" in *POSTEST*PASS*) ;; *) echo "   FAIL"; fail=1;; esac
done

echo "── smoke render"
chrome --window-size=1400,900 --virtual-time-budget=$SMBUD \
  --screenshot="$OUT/viewer.png" "$BASE/viewer/index.html" 2>/dev/null
[ -s "$OUT/viewer.png" ] && [ "$OUT/viewer.png" -nt "$OUT/.start" ] && echo "   ok: $OUT/viewer.png" || { echo "   FAIL (no screenshot)"; fail=1; }

echo "── flow render (with streamlines)"
FBUD=$SMBUD; [ "${GPU:-1}" = "1" ] || FBUD=2500
chrome --window-size=1000,700 --virtual-time-budget=$FBUD \
  --screenshot="$OUT/flow.png" "$BASE/viewer/index.html?flow&flowlow" 2>/dev/null
[ -s "$OUT/flow.png" ] && [ "$OUT/flow.png" -nt "$OUT/.start" ] && echo "   ok: $OUT/flow.png" || { echo "   FAIL (no screenshot)"; fail=1; }

[ $fail -eq 0 ] && echo "ALL TESTS PASS" || echo "TESTS FAILED"
exit $fail
