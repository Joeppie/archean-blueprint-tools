# XenonCode upstream provenance

Everything `tools/xenoncode/` runs on is **the devs' own XenonCode code** — we
write only the device shim (`xc_host.cpp`/`xc_host.h`) and the pages.

* Repository: https://github.com/batcholi/XenonCode (by `batcholi` — the
  game's developer; the game's bundled wiki `wiki/en/xenoncode/documentation.md`
  links this repository and its `XenonCode.hpp` integration path)
* **Pinned commit:** `e5d3167dad501ffbe3220a7e07436150a198c8e4` (library
  version 0.1.0, fetched 2026-10-27)
* Files used (unmodified): `XenonCode.hpp` (parser + bytecode compiler + VM),
  `XenonScreen.hpp` (screen model + bitmap font)
* `build.sh` clones `upstream/` (gitignored), checks out the pinned commit,
  and prints both files' SHA-256 so every build is traceable.

## License posture

The upstream repository carries **no LICENSE file** — XenonCode's code
belongs to batcholi, like the rest of the game's content. The project owner
ruled (2026-10-27) that using a WASM build of it in our viewer **is
intended** (the dev publishes the library openly and runs it as WASM
themselves at xenoncode.com). Per NOTICE.md's general posture: no
rights-holder permissions are claimed, reuse is presumed in good faith,
CC-attribution spirit, objections handled amicably via issues. The compiled
`xenoncode.js`/`xenoncode.wasm` committed here are build products of the
pinned upstream source, redistributed with this attribution.

## Game-side note

The game embeds XenonCode inside its C++ engine binary (closed, and a
superset of the open library — e.g. it accepts device-member overloads and
global-scope device-call initialisers; see README.md). We compile the OPEN
library; every corpus program we have run through it so far (the airplane)
compiles identically, so the open HEAD tracks the game closely.
