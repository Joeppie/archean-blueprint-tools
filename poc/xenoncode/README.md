# XenonCode-in-the-browser POC

**Question (2026-10-27):** can we run Archean's *XenonCode* (the MiniComputer
programming language) inside our viewer — using the devs' interpreter, as a
VM, compiled to WASM? And can we run a real craft's program — the cheap
exploration airplane **Just-Plane-Easy** (`testdata/3294880085`, a beginner
craft whose `FirstFlight.main.xc` + `functions.xc` total ~7 kB)?

**Answer: yes, as WASM of the dev's own interpreter — proven end-to-end.**

## What XenonCode turns out to be

- The game is the dev's own C++ **Xenon engine** (no Unity); XenonCode is
  **not Lua/QuickJS** — a whole-corpus strings audit of the 56 MB `Archean`
  ELF found no scripting library at all. The language is the dev's own
  parser + bytecode compiler + VM, compiled into the game binary.
- **It is open source**: [`github.com/batcholi/XenonCode`](https://github.com/batcholi/XenonCode)
  ships `XenonCode.hpp` (the parser/compiler/VM, header-only) +
  `XenonScreen.hpp` (the game's screen model incl. the bitmap font) + a CLI.
  The game's own bundled wiki (`Archean-game/wiki/en/xenoncode/`) links it
  and the dev runs an online fiddle at xenoncode.com.
- Blueprints store **plain source only** (`data.components[].data.hdd.xc_files[].plain_code`)
  — no bytecode — so the interpreter (ours = the dev's, compiled) parses the
  file text exactly like the game does at power-on.
- Running the game's *binary* interpreter (e.g. Buttercup-style x86→WASM
  translation) is NOT the path: closed, ABI-undocumented, months of work.
  Compiling the dev's open header to WASM is: one `em++` command.

## What this POC is

`xc_archean.cpp` = a **device shim**: XenonCode is game-agnostic; the
in-game device functions (`screen(...)`, `input_number`, `output_number`,
`print`, colours, `time`, the `update` entry point) are defined by
ARCHEAN_computer inside the game binary. We re-declare a minimal set per the
bundled wiki (`computer.md` / `archean.md`) on top of the dev's own
`XenonScreen` model. One source file builds two ways:

- **native**: `g++ -O2 -std=c++20 -I<XenonCode> xc_archean.cpp -o xc_archean`
  then `./xc_archean run/plane 60` — real 10 Hz clock (the language's timers
  use the real clock), writes `events.json` + `screen.ppm`.
  Measured: compiles the airplane's 112 lines, throttle ramps 5/click on the
  `timer frequency 4`, trim inputs land on `PitchControlJunction`, the
  TrimsDash screen renders its four size-2 text rows.
- **browser**: `em++ … -sMODULARIZE=1 -sEXPORT_NAME=createXenonCode
  -sEXPORTED_FUNCTIONS=_malloc,_free
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8,HEAPU8
  -sENVIRONMENT=web -sFILESYSTEM=1` → `xenoncode_poc.js` + 658 kB
  `xenoncode_poc.wasm`. `index.html` fetches the blueprint, extracts the
  MiniComputer's `xc_files` (`FirstFlight.main.xc` → `main.xc`), boots the
  wasm, pumps 10 Hz cycles (tick + timers + `update`), blits the screen
  framebuffer and shows the live io bus + prints. Pilot = sliders (io 11
  channels) or the auto-pilot demo script.

`poc/xenoncode/*.xc` are the airplane's program files as extracted from
`testdata/3294880085/blueprint.json` (workshop content — NOTICE §2; the
fixtures `run/plane/` = `main.xc` + `functions.xc`).

Verified headless (iGPU chromium): title `XENONCODE POC: 2 files compiled,
running`, event stream + screen pixels present, zero console errors.

## Caveats for a real integration

- **Licensing**: the XenonCode repo carries **no LICENSE file** (code belongs
  to batcholi). The compiled artifacts here are build products in the
  working tree (gitignored), not vendored, not published. An app-shipped
  interpreter panel needs the dev's blessing first — and the dev already
  runs the same library as WASM in their own fiddle (xenoncode.com), so the
  ask is "publish/agree", not "permission to exist".
- The shim covers one beginner program's API surface. The corpus spans far
  more device functions (radio, GPS, radar, dashboard widgets, HUD, storage)
  — a real feature = declaring those per the wiki + the game's observable
  behaviour (the same reverse-engineering ritual as always).
- Device-function **overloads are impossible in the library's declaration
  map** (one prototype per name, `screen::write` collides with itself) —
  the game's embedded compiler is evidently a superset; a real integration
  may need to route overloads through one variadic member.
- The game's global-scope `var $dash = screen(...)` (a runtime expression
  where the docs say compile-time) compiles fine on the library HEAD — the
  repo tracks the game closely, good news for fidelity.
- `xc_archean.cpp` compiles against a local clone of the dev repo
  (`/tmp/opencode/XenonCode` at POC time); keep the clone out of the repo.

## Reproduce

```bash
git clone --depth 1 https://github.com/batcholi/XenonCode.git /tmp/opencode/XenonCode
g++ -O2 -std=c++20 -I/tmp/opencode/XenonCode xc_archean.cpp -o run/xc_archean
./run/xc_archean run/plane 60                     # ~6 s, real clock; XC_FAST=1 to skip
# browser build (needs emsdk):
source <emsdk>/emsdk_env.sh && em++ xc_archean.cpp -O2 -std=c++20 \
  -I/tmp/opencode/XenonCode -sMODULARIZE=1 -sEXPORT_NAME=createXenonCode \
  -sEXPORTED_FUNCTIONS=_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8,HEAPU8 \
  -sENVIRONMENT=web -sFILESYSTEM=1 -o xenoncode_poc.js
python3 -m http.server 8650 --bind 0.0.0.0        # repo root; open /poc/xenoncode/
```
