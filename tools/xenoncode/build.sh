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
# ---- shim patches on the pinned checkout (documented, reproducible) -------
# LENIENT TEXT->NUMBER: the game's binary treats a non-numeric text cast as 0;
# the open library's stoll/stoul THROW (std::invalid_argument) and the VM
# dies mid-program ("stoll on bytecode …" virtual crash the Badger hits on
# its first settings read). strtoll/ststrtoul return 0 for junk — the game's
# observable behaviour.
sed -i 's/return stoll(textValue);/return textValue.empty() ? 0 : strtoll(textValue.c_str(), nullptr, 10);/; s/return stoull(textValue);/return textValue.empty() ? 0 : strtoull(textValue.c_str(), nullptr, 10);/; s/return stoul(textValue);/return textValue.empty() ? 0 : (unsigned long)strtoull(textValue.c_str(), nullptr, 10);/g' "$UP/XenonCode.hpp"
python3 patch_xenon_vars.py "$UP/XenonCode.hpp"   # XENON-VARS introspection (see the script)
python3 patch_xenon_debug.py "$UP/XenonCode.hpp"   # XENON-DEBUG line tracking (see the script)
python3 patch_xenon_lenient_index.py "$UP/XenonCode.hpp"   # XENON-LENIENT-INDEX (game-tolerant OOB reads)
echo "upstream: $(git -C "$UP" rev-parse HEAD) (pinned $PIN, +lenient-numeric, +XENON-VARS, +XENON-DEBUG, +XENON-LENIENT-INDEX)"

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
