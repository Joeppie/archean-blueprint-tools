# XenonCode upstream provenance

Everything `tools/xenoncode/` runs on is **the devs' own XenonCode code** — we
write only the device shim (`xc_host.cpp`/`xc_host.h`) and the pages.

* **Upstream:** https://github.com/batcholi/XenonCode (by `batcholi` — the
  game's developer; the game's bundled wiki `wiki/en/xenoncode/documentation.md`
  links this repository and its `XenonCode.hpp` integration path)
* **Our fork:** https://github.com/Joeppie/XenonCode — consumed as a **git
  submodule** at `upstream/`, checked out on branch **`archean`**
* **Base commit:** `e5d3167dad501ffbe3220a7e07436150a198c8e4` (library
  version 0.1.0, fetched 2026-10-27)
* Files used: `XenonCode.hpp` (parser + bytecode compiler + VM),
  `XenonScreen.hpp` (screen model + bitmap font)
* The submodule gitlink **is** the pin: `build.sh` builds exactly what is
  recorded in the index and refuses to build a checkout that diverges from
  it (no clone, no reset, no patching at build time — a one-time fix
  2026-10-28 replaces the old clone + regex-patch-in-place flow, whose
  patchers were non-idempotent and asserted on their own anchors when
  rerun).

## The `archean` branch = upstream + our patches as real commits

Applied in this order on top of the base commit; each is a normal commit
with the description in its message, PR-able upstream:

1. **LENIENT TEXT->NUMBER conversions** — the game's binary treats a
   non-numeric text cast as `0`; the open library's `stoll`/`stoul`
   conversions THROW (`std::invalid_argument`), so real craft programs die
   mid-run ("stoll on bytecode …" — the Badger's first settings read).
   `strtoll`/`strtoull` with a 0-on-junk fallback = the game's behaviour.
2. **XENON-VARS** (`patch_xenon_vars.py`) — global-variable +
   storage-object introspection: the compiler records global declarations
   (name, code type, KV children, text value incl. `.on{1}.red{255}`
   segments) and `Computer::DumpVarsJson` serialises them (RAM values live,
   storage-cache values). Powers the IDE variables panel. Anchors prefixed
   `xv::`.
3. **XENON-DEBUG** (`patch_xenon_debug.py`) — executed-line tracking: the
   `LINENUMBER` case in `Computer::RunCode` records the source line of
   every executed line during a cycle (flag-gated: one branch when off).
   Powers the debugger's break detection and line highlight; the mid-line
   stop hook (true line-stepping) builds on this same case.
4. **XENON-LENIENT-INDEX** (`patch_xenon_lenient_index.py`) — game-tolerant
   indexing: text char index OOB READS = empty (game-tolerant), OOB
   text-char WRITES skipped (no growth), array OOB READS = `Var::None`,
   indexed writes GROW (standard), OOB `{channel}`/`{section}` subkey reads
   on text KV = empty, `Var::AsText()` for numbered-key text KVs joins the
   keyed values. The game's binary is tolerant where the open library
   panics; real craft programs (3381670618 settings reads, the Badger
   reboot with a fresh VM) hit exactly these paths. Anchors prefixed
   `xli::`.

`patch_xenon_vars.py` / `patch_xenon_debug.py` / `patch_xenon_lenient_index.py`
stay in this directory **for provenance** — they are how the branch commits
were authored (the exact edits + anchors documented), and they can
re-derive the patches onto a NEWER upstream commit during a rebase
(`git checkout -b archean-next <new-upstream>` + run them in the order
above + fix anchors that moved). `build.sh` no longer runs them.

## Source integrity

`build.sh` records the SHA-256 of the two headers it builds against, so
every compiled artifact is traceable to a branch commit. The app's copy of
the built interpreter is `app/src/engine/xenoncode/` (git LFS for the wasm —
compiled artifacts are tracked by the repo-root `.gitattributes`); rebuild
with `tools/xenoncode/build.sh` (emsdk 6.x: `source $EMSDK/emsdk_env.sh`)
and commit the rebuilt js/wasm in the same commit as the gitlink bump.
v1.13.17 L4: the glue builds with `-sEXPORT_ES6=1` — an **ES module**
(`export default createXenonCode`) imported through the app's module graph
via `?url` (the seal.wasm precedent); the old classic-script/global form
and the worker's fetch+blob export-shim are retired.

## The shim's debugger law (ABI 7, v1.13.17)

`xc_host.cpp` is OURS, and since v1.13.17 it carries debugger law of its
own — flag it in any upstream PR batch:

* **ABI 7** (`xc_abi()` = 7): the shim stamps the app↔wasm feature contract;
  the app refuses worker mode below ABI 7 (falls back to the main-thread
  stepper), so old artifacts degrade, never corrupt.
* **The LIVE line hook**: the interpreter (fork `0516ccb`, XENON-DEBUG v2)
  calls the weak extern `xc_debug_hook(file, line)` from `RunCode`'s
  LINENUMBER case at EVERY executed line; the shim (not the interpreter)
  defines it as an **EM_JS** that evaluates the STEP LAW in JS and, on a
  stop, parks the worker thread IN PLACE with `Atomics.wait` — the C++
  stack (function locals, nested `@call` frames) stays intact mid-cycle.
* **The SAB protocol** (Int32Array over a SharedArrayBuffer) is documented
  VERBATIM at the hook: `[0]` cmd main→worker (0 none · 1 over · 2 into ·
  3 runTo · 4 resume · 5 pause-at-next-line) · `[1]` worker→main state ·
  `[2..4]` paused fileIdx/line/reason · `[5,6]` ref pair · `[7,8]` over
  body-range (lo>hi ⇒ top-level) · `[9,10]` runTo target · `[11]` bp count
  · `[12..]` bp (fileIdx,line) pairs (max 64).
* **The step law lives in TWO places and must stay in lockstep**: this
  EM_JS ⇄ `app/src/engine/xenoncode.ts` `stepperLaw()` (the main-thread
  pair-stream walk, vitest-pinned; its header carries the cross-reference).
  Any change to the stop conditions lands in BOTH + re-pins.
* **`--js-library` is a dead end (measured 2026-10-28):** emscripten
  6.0.13 JS-lib symbols do NOT satisfy undefined C symbols at link — the
  hook must be EM_JS inside the emitted glue, not a JS library file. Do
  not resurrect `library_xc.js`.

## Upstream PR policy

The four commits above are interpreter-generic (the game's own observable
behaviour + debugger/inspector hooks) and are staged as pull requests to
batcholi/XenonCode — one commit per PR. The **device shim** (`xc_host.cpp`:
the Archean io-bus, screens, worldsim, ABIs) is Archean-specific and stays
in THIS repo — the fork's master tracks upstream untouched; `archean`
rebases onto upstream moves as needed, and the submodule gitlink bump is
the visible, reviewable record of every interpreter change.
