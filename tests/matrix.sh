#!/usr/bin/env bash
# tests/matrix.sh — component-matrix verification: regenerate the fixture
# crafts, compute mass & ingredients from the GAME files, scrape the Xenon
# dev viewer's panels for the same blueprints, and diff. Screenshots of both
# viewers at the same iso angle land in reports/matrix/.
#
#   bash tests/matrix.sh                 # all matrix crafts
#   bash tests/matrix.sh 9000001001,9000002001
#   MATRIX_SKIP_SHOTS=1 bash tests/matrix.sh <ids>   # panels only, no pngs
#
# Needs: installed Archean (tools/config.py game_dir), network access to
# viewer.xenontools.dev, app/ npm deps (@playwright/test), chromium browser
# for playwright, python3 + PyYAML.  Full documentation: MATRIX.md.
set -euo pipefail
cd "$(dirname "$0")/.."

IDS=${1:-$(ls testdata | grep -E '^900000[12][0-9]{3}$' | paste -sd, -)}
PORT=${PORT:-8650}

echo "[matrix] regenerating fixtures"
python3 tools/make_matrix_test.py

if ! curl -s -o /dev/null "http://127.0.0.1:$PORT/viewer/index.html"; then
  echo "[matrix] serving repo on :$PORT"
  python3 -m http.server "$PORT" --bind 0.0.0.0 >/tmp/opencode/matrix-http.log 2>&1 &
  SRV=$!
  trap 'kill $SRV 2>/dev/null || true' EXIT
  sleep 1
fi
IP=$(tailscale ip -4 2>/dev/null || echo 127.0.0.1)

echo "[matrix] driving dev viewer + our viewer for $(echo "$IDS" | tr ',' '\n' | wc -l) crafts"
ARGS=(tools/devscrape.mjs --ids "$IDS" --ours "http://127.0.0.1:$PORT")
[ "${MATRIX_SKIP_SHOTS:-}" = 1 ] && ARGS+=(--no-shots)
(cd app && node "${ARGS[@]}")

python3 tools/matrix_verify.py --dir reports/matrix
python3 tools/matrix_sheet.py --dir reports/matrix || true
python3 tools/matrix_iou.py --dir reports/matrix || true
echo "[matrix] report: reports/matrix/REPORT.md  (photos: http://$IP:$PORT/reports/matrix/)"
