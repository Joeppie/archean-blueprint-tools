# tools/xenoncode — the dev's XenonCode interpreter, as WASM, in the browser

A **standalone entry point for executing XenonCode**: the language core is
the game dev's own code (see `XENONCODE_UPSTREAM.md` — pinned upstream commit,
`build.sh` clones `upstream/` at that pin and builds from it). We wrote only:

| file | role |
|---|---|
| `xc_host.cpp` / `xc_host.h` | the **device shim** — the ARCHEAN_computer side (screen object, `input_number`/`output_number`, `print`, colours, `time`, entry points) per the game's bundled wiki, plus the CLI runner and the browser exports |
| `index.html` | **the standalone landing**: pick a program, drive its external numeric inputs, watch the io bus + the screen (open via the repo-root static server: `/tools/xenoncode/`) |
| `demo/hello/main.xc` | **Hello World** (our authorship): `print`, an `input_number(1, 7)` channel fed PURELY as an external numerics by the simulated computer panel, `screen(...)` text + per-pixel drawing, a `storage` boot counter that survives reboot, an `output_number` echo |
| `xenoncode.js` + `xenoncode.wasm` | committed build products of the pinned upstream (NOTICE §6) |
| `FirstFlight.main.xc` `functions.xc` | the Just-Plane-Easy program (extracted from `testdata/3294880085` — workshop content, NOTICE §2) kept as the real-craft fixture; the page also re-extracts it live from the blueprint |

## The simulated-computer contract

The panel provides inputs **as numerics addressed by io/channel numbers** —
exactly what `input_number(io, channel)` reads in game — and records every
`output_number(io, port, value)` onto a bus table. Inputs: sliders
(`xc_set_input(io, ch, v)` from JS; `XC_DIAL` env on the CLI). `screen(name,
i)` returns a real `XenonScreen` (the dev's own model + bitmap font):
`write` text, `blank`, `text_size`, `char_h`, and a `pixel(x,y,color)` point
write into the live framebuffer; the page blits that framebuffer every 5
frames. `tick`/`update`/timers run at the game's 10 Hz cadence (the language
times on the real clock); `storage` vars persist across the panel's re-boot
button; `init` runs at boot.

This is the seam for the next step: **bind a panel to a real craft** — done
since v1.12.11: the Inspector app has **Xenon ▾** (TopBar) opening the
in-game-style IDE for the open craft's MiniComputers
(`app/src/engine/xenoncode.ts` + `app/src/components/XenonDialog.tsx`; the
interpreter ships as `app/public/xenoncode/` — `build.sh` refreshes that
copy; screens = the Dashboard's Screen/HdScreen elements, `#NODES` graphs
rendered, inputs as io/channel numerics; pins: engine/__tests__/xenoncode
.test.ts + e2e/xenon.spec.ts).

## Building / running

```bash
bash build.sh                 # native run/xc_run + xenoncode.js/.wasm (needs emsdk)
./run/xc_run demo/hello 30    # native, real 10 Hz clock (XC_DIAL=0.5, XC_FAST=1)
./run/xc_run . 60             # the airplane program (main.xc = FirstFlight.main.xc)
```

Verified headless (iGPU chromium): `XenonCode — hello running` (boot count,
dial→bus echo `1[0]=0.8`, 70-px pixel bar at dial 0.4),
`XenonCode — plane running` (throttle/trim bus + TrimsDash) and
`XenonCode — cep running` (the literal *Cheap Exploration Plane*, craft
3327182790 — its node-generated flight-control program on the stick sliders).
`?prog=hello|plane|cep` deep-links.

The Badger torture test (v1.12.12, app side): craft 3326372833 — 57 files,
1.8 MB of .xc — boots the dev VM in-browser in ~2 s and runs its workshop
firmware end to end. The issues that cropped up and their fixes are the
`build.sh` patch list (see XENONCODE_UPSTREAM.md) plus the device-shim
families: `virtualscreen`/`screen_copy`, Component Inspection
(`device*`) over the blueprint's io-port + alias device table, the
`screen(alias, channel)` binding to Dashboard Screen/HdScreen elements and
component screen overrides, the Computer-context built-in values, and the
Chrome wasm-memory flags. Native 150-cycle run: 5,422 outputs, 118 painted
surfaces, boot prints up to `Smart Quad is ready`.

## Interpreter notes (learned building this)

- **Overloads**: the library keys device functions by NAME (one prototype per
  member; redeclaring `write(...)` throws "Cannot override a device object
  member"), and call sites are not arity-checked — so we declare the WIDEST
  form and **dispatch on the runtime argument count** inside one lambda
  (`write(x,y,c,t)` / `write(x,y,t)`, `blank()` / `blank(c)`). That's the
  variadic-member pattern; the game's embedded compiler is a superset of the
  open library (it accepts true overloads + global-scope device-call
  initialisers), and every corpus program tried so far compiles identically
  on the open HEAD.
- **Exceptions**: emscripten strips C++ catch by default; the interpreter
  reports ALL parse/compile/runtime errors as exceptions, so the wasm MUST
  build with `-fexceptions -sDISABLE_EXCEPTION_CATCHING=0` (build.sh does) —
  without it, a mere syntax error aborts the whole module.
- **UTF-8**: allocate wasm buffers with `lengthBytesUTF8`, not `.length` —
  two em dashes in a comment truncate the program's tail mid-line.
- **Timers** (`timer frequency N`) use the real wall clock — the 10 Hz pump
  must be real-time paced, not fast-forwarded (native: sleep per cycle;
  page: rAF + the browser clock).
