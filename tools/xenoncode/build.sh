#!/usr/bin/env bash
# build.sh — build the XenonCode host (native + browser WASM) FROM THE DEV'S
# OWN CODE (github.com/batcholi/XenonCode), pinned to the provenance recorded
# in XENONCODE_UPSTREAM.md. The upstream clone lives in a gitignored
# upstream/ dir; the compiled artifacts (xenoncode.js/.wasm, run/xc_run) are
# (re)built here so the repo always carries interpreters traceable to the pin.
set -euo pipefail
cd "$(dirname "$0")"

# pinned upstream commit (see XENONCODE_UPSTREAM.md)
PIN=$(sed -n 's/^\* \*\*Pinned commit:\*\* `\([0-9a-f]*\)`.*/\1/p' XENONCODE_UPSTREAM.md)
UP=upstream

if [ ! -d "$UP/.git" ]; then
	git clone https://github.com/batcholi/XenonCode.git "$UP"
fi
git -C "$UP" fetch --quiet origin
git -C "$UP" checkout --quiet --detach "$PIN"
echo "upstream: $(git -C "$UP" rev-parse HEAD) (pinned $PIN)"

mkdir -p run

if [ "${1:-}" != "wasm-only" ]; then
	g++ -O2 -std=c++20 -I"$UP" xc_host.cpp -o run/xc_run
	echo "native:   run/xc_run"
fi

if command -v em++ >/dev/null 2>&1 || [ -n "${EMSDK:-}" ]; then
	[ -n "${EMSDK:-}" ] && source "$EMSDK/emsdk_env.sh" >/dev/null
	# -fexceptions: the interpreter reports Parse/Compile/Runtime errors as
	# C++ exceptions — emscripten strips catch by default, so they must stay
	em++ xc_host.cpp -O2 -std=c++20 -I"$UP" -fexceptions \
		-sDISABLE_EXCEPTION_CATCHING=0 \
		-sMODULARIZE=1 -sEXPORT_NAME=createXenonCode \
		-sEXPORTED_FUNCTIONS=_malloc,_free,_main \
		-sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8 \
		-sENVIRONMENT=web -sFILESYSTEM=1 -o xenoncode.js
	echo "browser:  xenoncode.js + xenoncode.wasm"
	# the app serves its own copy (Pages layout: app/public -> site base)
	mkdir -p ../../app/public/xenoncode
	cp xenoncode.js xenoncode.wasm ../../app/public/xenoncode/
	echo "app:      ../../app/public/xenoncode/"
else
	echo "browser:  SKIPPED (no em++ — source ~/emsdk/emsdk_env.sh to build WASM)"
fi

sha256sum "$UP/XenonCode.hpp" "$UP/XenonScreen.hpp" | sed 's|upstream/||'
