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
5. **XENON-LOCALS** (fork `972b99f`, v1.13.21) — function-local
   introspection for the debugger's Locals tab: the compiler records
   EVERY named declaration made inside a named body (function,
   `system.init`/`system.tick`/`system.timer`/`system.input`, `entrypoint.*`)
   in `Implementation::localVarDecls` with its function name, recursion
   copy (stackId) and RAM slot; `Computer::DumpLocalsAt(file, line)` finds
   the program position executing that line (SOURCEFILE/LINENUMBER walk),
   resolves the owning body by [start, CODE_RETURN) containment (plain
   top-level positions sit in the gaps → `[]`, their variables are the
   XENON-VARS globals) and reads the slot values LIVE — called from the
   debug stop, it answers the paused line's frame mid-cycle.
   `Computer::SourceFilesJson()` exports the compiler's SOURCEFILE table
   so the IDE's file table is VM-authoritative.
6. **XENON-SOURCEPATHS** (fork `8dfaa58`, v1.13.21) — truthful per-file
   (file,line) streams: the include-end FileInfo marker returned to
   `filedir + "/" + filename` (unnormalized — `./main.xc` ≠ `main.xc`),
   registration was a blind `push_back` (one name, several indices), and a
   body region is ENTERED BY JMP, which skips the linearly-emitted
   SOURCEFILE record entirely. Net effect on the pair stream: every body
   declared after an include ran under a third, misnamed registration —
   the PLANE's `functions.xc` bodies reported as `./main.xc`, so
   per-file breakpoints by NAME never fired (the Locals e2e caught it).
   Fix: the marker uses the normalized `src.filepath`; FileInfo
   registration dedups by name; `openFunction` self-tags every body region
   at its start. (The game's binary compiles its own programs — this
   changes only the debugger-facing stream, never semantics.)
7. **XENON-WRITEBACK** (fork `399d852`, v1.13.23) —
   `Computer::WriteVarAt(file, line, name, type, value)`: type-validated
   writeback of one variable visible at a debug stop. The frame of the
   paused line resolves through the XENON-LOCALS table (a local shadows a
   global, the language's own lookup), the globals through XENON-VARS; the
   value lands DIRECTLY in the RAM slot, so the paused program RESUMES
   WITH the injected value. Numbers demand a fully-parsed finite decimal
   (plus the language's `true`/`false` words), text accepts every string,
   storage/array/object refuse (world-save persistence, label-only views).
   Answers `{"ok":true} | {"error":"…"}` for the UI's inline editor.
   (Native-probed: `XC_WRITE=<file>:<line>:<name>:<type>:<value>`.)
8. **XENON-ENTRYPOINT-FRAME** (fork `69802bf`, v1.13.24) — the compiler
   registers an entry point with its human name (`EntryPoint.name =
   'update'`) but opens its body under `"entrypoint." + the vector INDEX`;
   the debugger's frame resolvers (DumpLocalsAt / WriteVarAt) claimed
   `'entrypoint.' + name`, which never equals the recorded function name —
   a break inside an `update`/`shutdown`/`click` block resolved to NO
   frame (the Locals panel said "top level" — a real report on the plane's
   `update` body). Claim by index.

9. **XENON-PANEL-RESIZE** (fork `830f10f`, RECORDED RETROACTIVELY v1.16.8) —
   `XenonScreen::Resize(w,h)`: `$panel.set_size(w,h)` (ABI 13, v1.14.1)
   resizes the pixel + staging vectors in place, filled with bgColor;
   `_width/_height` lose const so the panel keeps its OBJECT IDENTITY (the
   program's `$panel` stays valid; the host's per-cycle metas carry w/h).
   The shipped wasm carried this behavior since v1.14.1 but the header
   patch was never committed — recorded now (the Panel-Bench pin in
   xenonhud.spec is the behavior-parity gate) so the tree builds from the
   pin again.

10. **XENON-SCREEN-VERSION** (fork `64d647d`, v1.16.8) — per-surface WRITE
   counter: every pixel write already funnels through `Dirty()` (the
   XenonScreen draw methods + the host's screen_copy blits), so the flag
   now cumulates into a monotonic sequence the host exports
   (`xc_screen_version`, ABI 15). The app's render pump fetched + blitted
   EVERY visible surface every 25 Hz cycle; the Badger census measures 0.2
   changing surfaces per cycle of 117 — the counter lets the pump (and the
   worker + HUD pump twins) fetch a surface exactly when its pixels moved
   (measured 4.2× on the fetch loop; the browser also skips the ImageData
   + canvas upload). `Update()`/`_dirty` semantics untouched — reads
   unchanged, behavior unchanged.

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

## The shim's debugger law (ABI 9, v1.13.17 + v1.13.21 + v1.13.23)

`xc_host.cpp` is OURS, and since v1.13.17 it carries debugger law of its
own — flag it in any upstream PR batch:

* **ABI 9** (`xc_abi()` = 9): `xc_write_var` + the hook's cmd-6 write
   handoff (editable debug values); ABI 8 added `xc_locals_json` + the
   locals SAB handoff; ABI 7 stamped the LIVE stop hook; the app refuses
   worker mode below ABI 7 (falls back to the main-thread stepper), so old
   artifacts degrade, never corrupt.
* **The LIVE line hook**: the interpreter (fork `0516ccb`, XENON-DEBUG v2)
  calls the weak extern `xc_debug_hook(file, line)` from `RunCode`'s
  LINENUMBER case at EVERY executed line; the shim (not the interpreter)
  defines it as an **EM_JS** that evaluates the STEP LAW in JS and, on a
  stop, parks the worker thread IN PLACE with `Atomics.wait` — the C++
  stack (function locals, nested `@call` frames) stays intact mid-cycle.
* **The SAB protocol** (Int32Array over a SharedArrayBuffer, 8192 bytes
  since v1.13.21) is documented VERBATIM at the hook: `[0]` cmd main→worker
  (0 none · 1 over · 2 into · 3 runTo · 4 resume · 5 pause-at-next-line) ·
  `[1]` worker→main state · `[2..4]` paused fileIdx/line/reason · `[5,6]`
  ref pair · `[7,8]` over body-range (lo>hi ⇒ top-level) · `[9,10]` runTo
  target · `[11]` bp count · `[12..]` bp (fileIdx,line) pairs (max 64) ·
  `[19]` locals-JSON byte length, UTF-8 JSON at BYTE offset 80.. —
  **XENON-LOCALS**: a PARKED worker answers no messages, so the hook itself
  calls `xc_locals_json` at the stop and encodes the frame onto the SAB
  before its release store on `[1]` (the reader acquires through `[1]`).
  The v1.13.17-era 1024-byte SAB degrades honestly: the hook's `i.length`
  guard keeps `[19]` at 0 → the panel says "no locals", never garbage.
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
