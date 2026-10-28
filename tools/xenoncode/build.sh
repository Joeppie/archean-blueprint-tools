#!/usr/bin/env bash
# build.sh — build the XenonCode host (native + browser WASM) FROM THE DEV'S
# OWN CODE. upstream/ is a GIT SUBMODULE: the public fork
# github.com/Joeppie/XenonCode, branch archean = batcholi/XenonCode at the
# commit recorded in XENONCODE_UPSTREAM.md + our patches as real commits
# (lenient text→number, XENON-VARS, XENON-DEBUG, XENON-LENIENT-INDEX).
# The build NEVER clones, resets or patches the checkout — the submodule
# gitlink IS the pin, and every change to the interpreter is a commit on
# the fork, PR-able upstream.
set -euo pipefail
cd "$(dirname "$0")"

UP=upstream

# ---- the pinned sources = the submodule's recorded gitlink ----------------
if [ ! -d "$UP/.git" ] && [ ! -f "$UP/.git" ]; then
	echo "upstream/ not initialised — run: git submodule update --init tools/xenoncode/upstream" >&2
	exit 1
fi
# the recorded gitlink (index) must equal the checkout: never build an
# unrecorded interpreter (a detached HEAD from an experiment, stale
# worktrees). Update the gitlink in the same commit as an intentional bump.
PIN=$(git ls-files -s "$UP" | awk '{print $2}')
HEAD_SHA=$(git -C "$UP" rev-parse HEAD)
if [ "$PIN" != "$HEAD_SHA" ]; then
	echo "upstream/ HEAD ($HEAD_SHA) != the pinned gitlink ($PIN)." >&2
	echo "Record the bump (git add $UP) or restore it (git submodule update)." >&2
	exit 1
fi
if ! git -C "$UP" log --format=%s | grep -q "XENON-LENIENT-INDEX"; then
	echo "upstream/ HEAD is not the archean branch (our patches missing)" >&2
	exit 1
fi
echo "upstream: $HEAD_SHA (archean gitlink: base $(sed -n 's/^\* \*\*Pinned commit:\*\* `\([0-9a-f]*\)`.*/\1/p' XENONCODE_UPSTREAM.md) + lenient-numeric + XENON-VARS + XENON-DEBUG + XENON-LENIENT-INDEX)"

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
		-sENVIRONMENT=web -sFILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=4096MB \
		-o xenoncode.js
	echo "browser:  xenoncode.js + xenoncode.wasm"
	# the app serves its own copy (Pages layout: app/public -> site base)
	mkdir -p ../../app/public/xenoncode
	cp xenoncode.js xenoncode.wasm ../../app/public/xenoncode/
	echo "app:      ../../app/public/xenoncode/"
else
	echo "browser:  SKIPPED (no em++ — source ~/emsdk/emsdk_env.sh to build WASM)"
fi

sha256sum "$UP/XenonCode.hpp" "$UP/XenonScreen.hpp" | sed 's|upstream/||'
