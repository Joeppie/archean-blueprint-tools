# workpackages.md — Xenon debugger workpackages (v1.13.31, 2026-10-28)

Collected from the debugging session on Chip's Mario (3820116990): eight
reports, one landing. Version: Z-bump (fixes + one key law), label v1.13.31.

## Environment law for this batch (read first)
The user browses this dev server REMOTELY over Tailscale
(`http://100.117.137.1:5175`) — plain HTTP on a LAN address is NOT a secure
context, so `sabSupported()` is FALSE there: the user runs the MAIN-THREAD
pump (cycle-granular stepper), not the worker. Localhost e2e runs + Pages
(SW isolation forger) run WORKER mode. Every fix must land in BOTH modes;
the STEP LAW keeps living in TWO places (`stepperLaw()` ⇄ the EM_JS hook in
`xc_host.cpp`) and any change lands in BOTH + re-pins.

## WP1 — breakpoints stop hitting after screen input
Report: "When I have given input to a screen, my breakpoints are not hit."
Root cause (main-thread mode): the XENON-DEBUG v2 pair recorder shares the
`cycleLines.size() < 200000` guard, and main-thread mode never drains
`cycleLines` — it only drains `cyclePairs`. A chatty program (Mario's game
loop after a screen press runs thousands of lines per cycle) pushes the
shared vector over 200k within a few cycles; pair recording then dies
GLOBALLY and permanently — breakpoints never fire again. On the worker the
recorder is the stop-hook (no pair stream) and the pump drains every cycle,
which is why the localhost suite never saw this.
Fix (fork + shim, ABI 10):
- the pair cap becomes its OWN guard (`cyclePairs.size() < 200000`),
  drained every cycle by the pump (main mode) / by the worker cycle fetch;
- the worker stops shipping the pair stream at all (the hook IS the
  debugger there) — see WP6.
Test: native probe (xc_run XC_DEBUG_PAIRS over a long run) + main-mode
browser audit (dbgprobe over the Tailscale origin).

## WP2 — the caret/view must follow the active code position
Report: "When my active code cursor changes to a position that is somewhere
else than on my current screen, I must be moved there."
Breakpoint-follow (v1.13.27) already switches tabs + jumps the caret on a
pause; gaps: the jump only scrolls the line to the viewport EDGE (a hit
below the fold lands at the bottom edge, not "on the caret's text"), and
the pause→jump effect needs the dialog's editor mounted — it covers step
lines (each step is a pause).
Fix: `CodeEditor.jumpTo` centers the target line
(`EditorView.scrollIntoView(pos, { y: 'center' })` + `scrollIntoView`
selection) — used by breakpoint-follow, nav history, Library jumps and
run-to-cursor alike.

## WP3 — the yellow current-line highlight is not cleared on continue
Report: "When continuing debugging, the yellow highlight of current
position is not cleared properly."
Root cause: the dialog derives the editor's `pausedLine` prop from
`pump.pausedFile/pausedLine` ONLY — `pump.paused` is not consulted — and
resume() keeps the last stop's file/line as history. The row wash + gutter
▶ therefore persist after F8.
Fix: `pausedLine={pump.paused ? (file match ? line : 0) : 0}`. The wash
stays while PARKED by ⏸/⏹ (the park highlight is the position indicator,
WP7), clears on resume/re-boot/close.

## WP4 — F10 steps INTO, not over
Report: "When I press f10, it steps into, not over a function."
The v1.13.28 classic step-over = "first fresh pair of the PAUSED FILE";
the pair stream carries no call depth, so a call to a function in the SAME
file lands inside the callee (documented accepted limit — Mario/PLANE code
calls in-file `@functions`, so the limit is exactly what bites).
Fix (XENON-DEBUG v3, fork + shim + app, ABI 10): the interpreter records
the call depth (the Computer's `recursion_depth` at the LINENUMBER opcode)
into a parallel DEPTH stream; the hook seam gains the depth argument;
SAB slot 21 = the depth at the pause. Step-over becomes: stop at the first
fresh pair of the paused file at `depth ≤ pausedDepth` — a callee
(depth+1) is stepped over, a return into the caller (same file,
depth−1) stops. `stepperLaw` gains `depths` + `pausedDepth` (main-thread
twin, vitest-re-pinned; old no-depth callers keep depth 0 semantics).

## WP5 — cannot change variable values from the variables list
Report: "I cannot change variable values from the variables value list."
The WRITEBACK LAW (AGENTS §Xenon): injection is legal only at a PAUSED
moment; on the worker the value rows therefore carry NO edit affordance
while running — and the user had no reliable way to REACH a writable
moment (⏸ on the worker parks at the next line ✓, but STOP killed the
park; on the main-thread pump ⏸ never parked the VM at all).
Fix: WP7's pause/stop-park lands in both modes (the writable moment always
exists after ⏸/⏹/F6), and a value cell clicked while the worker runs
ARMS the park (presses ⏸) and opens the inline editor the moment the VM
is parked. Main-thread live edits of globals keep working (writes land at
cycle boundaries). The pinned WRITABLE-MOMENT law (running worker shows
plain text, no `xenon-val-*` button) stays exactly as pinned.

## WP6 — debugging makes Mario sluggish; idle impact must be ZERO
Report: "Debugging mario feels sluggish… minimize this impact, and if the
computer is not open and no breakpoints exist, this impact shouldnt be
there at all. If possible f5 should mean run. f6 should mean stop."
Per-cycle debug costs: (a) `debugTrack(true)` at open ⇒ every executed line
runs the per-line EM_JS hook (JS boundary crossing) + pushes line/pair (and
with WP4, depth) vectors; (b) the worker JSON-stringifies the FULL pair
stream every cycle (hundreds of KB on Mario) and posts it, main-thread
`UTF8ToString` + `JSON.parse` the same; (c) main mode pays (a)+(b) every
cycle even with zero breakpoints.
Fixes:
- TRACKING GATE: `debugTrack = breaks > 0 || stepMode ≠ off || parkArmed`.
  An IDE open with no breakpoints, no armed step and no pause request runs
  the VM UNTRACKED — no per-line hook, no pair/depth vectors, no pair JSON.
  The gate lands in BOTH modes; `xc_hook_live(on)` (ABI 10) additionally
  gates the C++→JS hook CALL so the main-thread pump never pays EM_JS
  boundary crossings (its stepper reads the pair stream, the hook is inert
  there by protocol).
- worker: pair/depth JSON ships ONLY while tracked (worker mode's debugger
  is the hook — the stream is audit-door payload only).
- "computer not open and no breakpoints ⇒ no impact": structural — the
  pump (the VM) is CLOSED when the IDE and the Screens dock are both
  closed (Editor.tsx law), so nothing runs at all.
- Keys: **F5 = RUN stays** (commit the buffers ⇒ re-boot ⇒ run — the IDE's
  classic run semantics, v1.13.25 law); **F6 = STOP** (new): parks the VM
  at the exact executing line (WP7) and marks the run stopped. F6 joins
  the Run menu, toolbar tooltip and Help row; with only the Screens dock
  open F6 stops the pump's computer (F5 law's twin).
Measure: `app/tools/marioperf.mjs` before/after (game-cycles/s at 1× and
4× CPU throttle), untracked vs armed-breakpoints.
MEASURED (2026-10-28, headless, AMD iGPU pin, Mario 3820116990 in-game,
40 ms pump):

| build                     | origin            | mode        | throttle | cps      |
|---------------------------|-------------------|-------------|----------|----------|
| v1.13.30 (baseline)       | 127.0.0.1 (SAB)   | worker      | 1×       | 25.1     |
| v1.13.30 (baseline)       | 127.0.0.1 (SAB)   | worker      | 4×       | 24.0     |
| v1.13.30 (baseline)       | 100.117.137.1     | main-thread | 4×       | 15.3     |
| v1.13.31 IDE open, unarmed| 127.0.0.1 (SAB)   | worker      | 1×       | 25.1     |
| v1.13.31 IDE open, unarmed| 127.0.0.1 (SAB)   | worker      | 4×       | 24.2     |
| v1.13.31 armed (gate open)| 127.0.0.1 (SAB)   | worker      | 4×       | 24.1     |
| v1.13.31 IDE open, unarmed| 100.117.137.1     | main-thread | 4×       | 15.3     |
| v1.13.31 armed (gate open)| 100.117.137.1     | main-thread | 4×       | 15.3     |

No regression anywhere; the debugger's armed cost is below measurement
noise at every point (the 4× main-thread figure is Mario's own VM cycle
> 40 ms, identical armed and unarmed). The idle cost is removed BY
CONSTRUCTION: tracking, the hook CALL and the pair/depth JSON are gated,
and with the IDE + Screens dock closed the pump — the VM — is closed.
The user's felt sluggishness (remote Tailscale view of a real browser:
pair-JSON parse + per-line EM_JS crossings at 25 Hz on the main thread)
is exactly what the gate deletes; the headless probe cannot reproduce a
remote-display frame budget, so the felt improvement is documented as
structurally-implied, not headless-measured.

## WP7 — pause/stop must stop ON the executing line, then allow edits
Report: "If we pause/stop the execution, I want the code to stop on the
precise line being executed, EVEN IF we do not have a breakpoint there!
And I want to then be able to edit values."
- WORKER mode: ⏸ already parks mid-cycle at the next executed line
  (hook cmd 5) — the precise-line law is native there. ⏹ currently WAKES
  a parked VM and stops the pump at the cycle boundary (the park is lost).
- MAIN-THREAD mode (the user's origin): ⏸ just freezes the pump at a cycle
  boundary — the editor's yellow line stays at the LAST debugger stop (or
  nowhere); ⏹ same. No park at all.
Fix (XENON-DEBUG v3, both modes):
- fork: a PAUSE REQUEST seam — `xc_pause_request()` arms a flag; the next
  executed LINENUMBER records (file,line) and throws a `DebugPause`
  exception; `xc_cycle()` catches it (before the RuntimeError catch, which
  kills the computer) and returns 2; `xc_pause_file()/xc_pause_line()`
  report the stop site. The VM survives (locals live in RAM slots) —
  pump-side this is an EXACT line stop; the interrupted cycle's remainder
  is discarded (cycle-granular honesty, documented in the mode chip).
- app pump: `pause()` = arm park + tracking gate + (worker) cmd 5 /
  (main) pause_request; the pump mirrors the park site (pollSab slot 2/3 /
  pause-file/line) → yellow line + breakpoint-follow (WP2) + Locals frame
  (worker mid-cycle; main cycle-end truth) + EDITABLE VALUES (paused ⇒
  writeback legal in both modes). `stopRunning()` = pause-park + status
  'stopped' (ON→OFF honest, the toolbar pin); resume (▶/F8) restarts.
- ⏹/F6 semantics everywhere: menu, toolbar, key law.
Test: native probe (arm at cycle N → return 2 + exact line + XC_WRITE
lands), audit probe over both origins (breakpoint-free ⏸ lands on a
running line and a global write sticks).

## WP8 — publish
User instruction: "If everything lands successfully and you can retrieve
the dev server and the e2e tests all work, then you can publish to github
pages." → land main (ff), `tools/release.sh v1.13.31` (full viewer suite +
tag), `tools/deploy_pages.py` (rebuild from the release ref), verify the
live URL.

## VALIDATION (2026-10-28/29, all on the final tree)
| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `npm test` (vitest, 950 tests incl. the v3 STEPPER LAW depth pins) | 945 pass / 5 skip |
| `npm run build` | clean (pre-existing chunk-size note) |
| native `xc_run` probes (XC_PAUSE_AT seam → exact line; XC_WRITE into the parked frame → `{"ok":true}` + frame echo 42) | PASS |
| `app/tools/dbgaudit.mjs` @ http://127.0.0.1:5175 (WORKER mode) | **21/21 PASS** |
| `app/tools/dbgaudit.mjs` @ http://100.117.137.1:5175 (MAIN-THREAD — the user's origin) | **19/19 PASS** |
| Playwright (sparing): `xenon.spec.ts` + `xenondbg.spec.ts` + `xenonfresh.spec.ts` @slow/@codeditor | **20/20 PASS** |
| Playwright fast tier (`test:e2e:fast`) | see below |
| viewer suite (pre-commit `--gate` pair, viewer strings staged) | runs at commit |
| marioperf before/after | table under WP6 |

Audit fixes found by the gates (all landed): the stop-hook CALL had to be
gated by `hookLive` ONLY (the hook services runTo/breakpoints while the
pump records nothing — WP6); `dbgFile` (the SOURCEFILE index the hook
checks) must update UNCONDITIONALLY (a frozen 0 killed worker runTo while
untracked); ▶/F8 START cancels a park IN FLIGHT (`xc_pause_cancel` +
SAB cmd-5 cancel; a late park used to yank the tab mid-typing — the
toolbar-leg flake) while deliberate runTo/step commands SURVIVE a start;
park-to-edit re-targets a locals-row press onto the globals row when the
park frame has no such local (running press rows are globals-only).
Spec-semantics update (xenon.spec.ts toolbar leg): ⏹ now parks, so the
breakpoint-follow may move the editor to the executed file — the leg
clicks back to the main tab before typing (comment in the spec).

## Gate ladder for this batch
- `npm test` (vitest: STEPPER LAW re-pinned + depth pins + gate pins) and
  `npx tsc -b`.
- Native runner probes (xc_run): depth stream, pause seam, writeback.
- WASM rebuild: `EMSDK=~/emsdk tools/xenoncode/build.sh wasm-only` (fork
  commit + rebuilt js/wasm in the SAME commit; gitlink recorded).
- Playwright, SPARINGLY (user law): the debugger legs of `xenon.spec.ts`
  + `xenondbg.spec.ts` on dedicated E2E_PORTS — one targeted run; the
  main-thread pump is audited headless over the non-isolated Tailscale
  origin (audit driver, not the suite).
- Perf: marioperf before/after.

## Files (map)
- fork: `tools/xenoncode/upstream` (commit on `archean`: XENON-DEBUG v3)
- shim: `tools/xenoncode/xc_host.cpp` + rebuilt `xenoncode.{js,wasm}` (ABI 10)
- app: `engine/xenoncode.ts` (stepperLaw, pump, XenonRun/WorkerRun),
  `engine/xenonworker.ts`, `engine/xcdbg.ts` (audit verbs),
  `components/XenonDialog.tsx` (paused wash, F5/F6, value park-edit),
  `components/CodeEditor.tsx` (centered jump), `Editor.tsx` (F6 w/ dock)
- docs: AGENTS.md (IDE KEYS + STEP LAW bullets), docs/HISTORY.md, version
  strings (security-scan --versions lockstep)
