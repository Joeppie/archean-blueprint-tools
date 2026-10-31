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

# Batch 2026-10-30/31 — THE LIVING CRAFT II (ChipOS appkit, power flow, sound, items)

Session plan for "get to a more feature complete simulation": the game's OWN
third-party ecosystem (Chip Patton's ChipOS + App Kit apps + EarthNAV) must
run on the farm, devices must animate with lights that GLOW (never cast),
parts must SOUND, the power grid must FLOW (batteries drain, go negative,
sources produce — warnings only), items must ride CONVEYORS (drill → Rock →
container), and Jimmy's Adventure (+ its crafter installation) must ride it.
Version: tree carries the next Z (v1.16.10); the batch is a FEATURE —
PROPOSE v1.17.0 (merging with the standing HUD Y-proposal 98a0405) at the end.

## Sources (all on disk — wiki.archean.space/en/components is the shipped wiki)
- game wiki: `Archean-game/wiki/en/components/**` (energy, items, mining,
  computers/Router.md alias law, processing/Crafter.md).
- wiki user notes (Chip Patton's appkit protocol docs): the user points at
  wiki.archean.space/en/components + the appkit header in
  testdata/3828773626 (chipos-appkit.xc) — that file's header IS the law.
- workshop corpus: 3828773626 (ChipOS Dev Kit: chipos + app-1 TETRIS +
  app-2 HELLO + MiniRouters + LV grid + 2 dashboards), 3828546114 (ChipOS
  HDD = MiniComputer with the OS disk), 3828827922 (EarthNAV), 3334698274
  (Jimmy's Adventure).

## WP1 — THE APPKIT BUS (DONE) — ChipOS's Tetris becomes available on the
ChipOS install
Gap census found three hard gaps between the farm and the appkit protocol
(output_text alias fan-out, input.N event handlers, router-net device tables):
- [x] shim ABI 16: per-DEVICE channel stores (alias reads stop aliasing one
      router-port wire), input.N handlers FIRE (RunInput on input arrival).
- [x] IoBus TEXT fan-out: output_text lands in every sister pump (the
      manifest/frame/event protocol is text).
- [x] writer-publish: a computer's transmissions are readable UNDER ITS OWN
      alias (ChipOS polls input_text("app-1",0) for the manifest).
- [x] router-net device tables: xenonDevices walks data_port↔Router/
      MiniRouter chains so every net device carries the computer's LOCAL
      port (device_at(i).port, alias→io, input.N routing).
- [x] pins: vmharness boots the REAL dev kit — the TETRIS manifest reaches
      the chipos VM, ChipOS's os_log announces it, the HELLO app joins too;
      events route BACK (open/tap fire the app's input.N → $kit_rx).
- [x] EarthNAV (3828827922) joins the same registry as a module (alias
      app-earthnav; the 9 MB world-data disk compiles and publishes its
      manifest; registry pin at the VM tier, @slow).
- [x] e2e chipos.spec (2 legs): auto-boot of the four, the manifest
      crossing pumps into the IDE bus rows, the relay assert, the power
      chip + battery panel.

## WP2 — HDD INSERT = BOOT (DONE at the law level)
The game: a Computer's hdd bay holds the disk whose code runs; our model is
data.hdd.xc_files + the LIVE auto-boot. Pin: the ChipOS v0.10 HDD craft
boots its disk verbatim (vmharness).

## WP3 — LIGHTS GLOW, NEVER CAST (DONE)
The sim lamp law: channel on ⇒ the model's emissive face lights up (the
palette colour); NO THREE light source is ever added (editor perf law).

## WP4 — THE SOUND OF THE CRAFT (DONE)
Procedural WebAudio (NOTICE-safe: synthesized, no game assets): the devicesim
snapshot edges drive cues — switch CLICK (toggle latch / push momentary),
relay CLACK, drill WHIR while ch0 is on, anchor CHAIN rattle, track/servo
WHINE while moving, conveyor BELT rumble while items ride it, power alarm on
the low-battery warning. Toggle persisted `archean-app-sound` (default on),
gated behind a real gesture like the buzzers.

## WP5 — THE POWER FLOW (DONE)
engine/power.ts stays the reachability gate; NEW engine/energy.ts: per-kind
watts from the wiki/.ini files (sources PRODUCE: solar × sunlight, RTG flat,
diesel × fuel, wind × wind, reactor flat; consumers DRAW: lamps, routers,
computers, actuators, conveyors; batteries STORE (Wh capacity), ALWAYS feed
— charge integrates, may go NEGATIVE (deep discharge) and keeps feeding —
the deficit is a WARNING, never a blackout). The energy panel: per-source
production, draw, battery state bars, the low-battery ⚠. `enough_power`
stays the shim stub (ABI law unchanged).

## WP6 — ITEMS ON BELTS (DONE)
engine/itemsim.ts: ItemConveyor links a chain (adjacency graph over the
belt parts), MiningDrill with ch0 on at terrain MINES a Rock item per
game-rate tick, items ride belt→belt→container/crafter as a VIEW overlay
(small palette cubes + a container count chip); Crafter installation
consumes recipe inputs from linked containers (crafterbuiltin law, sim-view
only). Nothing writes the blueprint.

## WP7 — JIMMY'S ADVENTURE RIDES IT (DONE — probe verdict below)
app/tools/jimmyprobe.mjs: node census over 3334698274 — every programmable
computer booted (power-gated), devicesim stepped, energy census, crafter
installation identified; report = crash list + device table. This is the
driving audit for "as much of the game as we can simulate".

## WP8 — GATES + TRIAGE (DONE — results + the e2e-value verdict below)
npm test + tsc + touched e2e tags + test:e2e:fast. NEW e2e kept minimal (one
chipos end-to-end leg; the sound/item laws stay at vitest/scene tiers).
docs: LIVING-CRAFT.md §§ extend, docs/HISTORY.md provenance, FORMAT.md
appkit-protocol section. NO Pages deploy (standing: deploy only on the
user's explicit ask).


## Probe verdicts (the audit, post-fixes)
- jimmyprobe on 3334698274: FARM [crafter-28:41, GIANTPLANE:41] (the
  flat-endpoint fix boots Jimmy's computer + the Crafter built-in);
  ENERGY +637 kW net (744 kW RTG, the HV drill at 100 kW, 600 kWh at
  100%); ITEMS ⛏ 194 mined / 📦 194 (53 riding the item cables, 141 in
  container 27); PRESS 27 dashboard pressables; ZERO console errors,
  45 ms loads. "Jimmy's crafter installation works": the item cables
  wire drill→container27→junction25→{crusher55, crafter28, conveyor54},
  the built-in program cycles on the farm, the containers publish their
  KV content onto the bus where programs READ it.
- jimmyprobe BEFORE the flat fix: FARM [] + ITEMS 0 — both root-caused
  to the flattened endpoints (see docs/HISTORY.md §12, engine/flat.ts).

## QUESTIONS RESOLVED autonomously (the standing ask: "save up all
## questions and do not get blocked" — none blocked; decisions + grounds)
- Q: does "lights show as being on, not cast" need a new setting? A: no
  setting — the scene lamp lens is MeshBasic (a lit FACE) by
  construction; pinned so (GLOW LAW test, castLightCount = 0). DONE.
- Q: the game's drill rate in the EDITOR (no terrain to drill)? A: the
  wiki's rates stand (10/s LV, 100/s HV) with the wiki's own licence
  (GroundAnchor + power + ch0 gate); the rocks are the sim's 'Rock'
  item. DONE (stylised mining, documented).
- Q: batteries "go negative" — floor where? A: one full capacity below
  zero (deep-discharge floor), chip shows deficit; ALWAYS feeds (power
  reachability untouched — the standing rule). DONE.
- Q: the Crafter: run the game's real automation? A: the built-in
  PROGRAM rides the farm (it boots and cycles — observable); the ITEM
  crafting is a stylised cycle (economy.json recipes, container KV
  feed). Grounds: the game's crafting UI state is server-side, not in
  the blueprint. DONE (documented boundary in LIVING-CRAFT.md § 10).
- Q: SteamTurbine 27 MW with no fluid loop? A: gated on a heat source
  PRESENT (reactor/geothermal), else 0 W — honest seat, documented.
  DONE.
- Q: item links: adjacency or cables? A: discovered on Jimmy — the
  game WIRES items with `type: "item"` pipes (port names = direction);
  cables primary, touching-AABBs fallback. DONE (FORMAT §item cable).
- Q: nested (subgrid) parts in the sim? A: stay outside the top-level
  sim space (flat endpoints → null), matching the existing
  dataNeighbours law. DONE (documented).
- Q: ChipOS's wizard gates the home screen — click through in e2e? A:
  the registry law is pinned at the VM tier (xa_alias) + the bus rows
  at the e2e tier; the click-through wizard + app-tile pixel journey is
  a Pages-tier UX follow-up (kept OUT of the pinned laws, documented).
  OPEN (documented, not blocking).
- Q: ship the ChipOS/EarthNAV workshop files in the repo (3rd-party
  code by Chip Patton)? A: yes — testdata corpus precedent (NOTICE §2:
  CC-attribution spirit, rights-holder issues handled amicably; the
  files are published workshop data, unmodified). DONE (NOTICE covers).
- Q: game AUDIO assets for the sounds? A: NO asset copies (NOTICE: game
  data belongs to the developer) — procedural WebAudio twins of the
  LAWS (switch click, relay clack, drill whir, anchor chain, alarms).
  DONE.


## Gate results (the final runs)
- vitest: 1078 tests — green except the TWO PRE-EXISTING stitch reds
  (3816936540 old-hullify copy; data-source drift, documented in
  docs/HISTORY.md v1.16.3 — red on every corpus this machine has,
  before and after this batch, untouched by it).
- tsc: clean.
- corpus byte-fidelity: the three new benches re-emit BYTE-IDENTICAL
  and keep every orientation literal (the two corpus walks got a
  data-budget timeout for the 9.9 MB bench — the law is unchanged).
- e2e FULL suite (test:e2e): 166 passed / 0 failed / 31 skipped —
  incl. the two chipos legs GREEN (2.2 s + 0.9 s warm) and the
  @codeditor leg hard-polled (CodeMirror's windowed doc fills over its
  first frames: the span count is POLLED, the law is 'the doc is
  highlighted' — the Jimmy-batch first-paint race).
- final vitest: 1067 passed (+ the HDD-insert = boot pin: the workshop
  ChipOS v0.10 HDD craft is ONE MiniComputer carrying the whole 52-file
  disk — xenonComputers lists it, the farm boots it, the BENCH pins
  above are the insert-and-run proof at the VM tier).
- viewer gate: the version-string bump commit ran the SELFTEST+REGTEST
  pair through the pre-commit hook (viewer/ staged) — PASS.

## The e2e-value verdict (the standing ask: "evaluate whether we need
## all the e2e tests you might have created")
- KEEP chipos.spec leg 1 (@slow): the ONLY tier with four real pumps
  co-cycling in one page, the manifest crossing into IDE DOM rows and
  the cascaded-window press plumbing it exercises (the drag-clear step
  doubles as living-window coverage).
- KEEP chipos.spec leg 2 (@ui, 0.9 s): the power-chip DOM + battery
  panel — the whole energy UI surface in under a second; the numbers
  themselves are all vitest-pinned (energy.test), the leg is the wiring
  smoke.
- NOT added as e2e (deliberate): the appkit registry string, the drill
  rates, deep discharge, item flow, device tables, sound graph — every
  one has a smaller-tier home (chipos/energy/items/flat/soundscape
  tests, scene GLOW LAW) — an e2e for them would re-test the engine
  through a browser at 100× the cost. The ChipOS wizard click-through +
  TETRIS tile pixels would be a REAL new journey (Pages-tier UX), not a
  law copy — kept OPEN, NOT written tonight (a green pin we cannot
  ground in observed in-game pixels is a pin we'd have to guess; the
  registry/bus laws are already pinned where they live).
- Probes (node tools, not in the suite): jimmyprobe.mjs is the standing
  census (AGENTS: re-run after any power/devices/items/bus change);
  chiposprobe/benchprobe are its siblings — cheap, informative,
  zero-suite-cost.

## Session end state
- Commits on main (ff from living-craft-2): the ingest, WP1+WP2 appkit
  bus, WP5 power flow, WP6 items, the flat-endpoint fix, WP4 sound,
  docs waves, the e2e greens, the data-budget timeouts.
- Tree label v1.16.10 (Z). THE PROPOSAL for assent: v1.17.0 (merging
  the standing HUD Y-proposal 98a0405 with this feature batch) — per §
  Versioning a Y is proposed, never self-awarded.
- No Pages deploy (the standing rule: deploy only on the explicit ask).

---

# Batch 3 (session of 2026-10-31) — SCREENS + FLIGHT LAB. Label v1.16.11 (Z;
# the v1.17.0 Y-proposal stays open awaiting assent).

Standing brief (user, verbatim): "http://100.117.137.1:5175/?craft=3828773626
doesn't show anything on its screens. Connections to screens aren't in the
middle of the back of them, dataports, they should be. Check wiki and
documentation and go through our code. It simulated aspects and document all.
[If] not yet implemented, then make a subagent that looks at previous session.
I'm still sleeping, gather relevant instructions as per previous session and
then form the subagent summary, continue and implement all gathered
unimplemented aspects insofar possible. Also, investigate the precise
implementation for the windtunnel, identify how the game would simulate or
emulate physics realistically, like for calculating lift and drag, and help
find actual lift. RCS infinity can't fly stable, neither can Jimmy's
adventure. Also Chips Falcon was made for old physics system and has hidden
ailerons, these don't do anything anymore now. Physics may be a tough nut to
crack, but attempt it like the other tasks and if possible reimplement the
wind streamlines functionality and display better stats, so we can figure out
if a craft will fly stable, and what its stall speed is, before we even fly
it in game. Work autonomously and use the subagent findings."

Subagent findings (prev session ses_e71032c38ff…, carry-over list): v1.17.0
assent pending (NEVER self-awarded — skipped); ChipOS wizard pixel journey
needs in-game ground-truth pixels (skipped — a guessed pin is banned);
enough_power shim stub + router power gating + wire-integrity census =
this batch's carry-over slots.

## WP-A — THE SCREENS OF 3828773626 (DONE)
Facts found: the ChipOS Dev Kit's screens are TWO DASHBOARDS (16 'main-screen'
8×HdScreen 50×50, 14 'secondary-screen' 1×HdScreen) cabled to the chipos
MiniComputer ONLY THROUGH MiniRouters (data-connector ↔ data_port.1/.8;
computers hang on data_port.7/.9/.006, router chains 6↔11). ChipOS resolves
screens at RUNTIME — display.xc scans device() rows and calls
screen($dd_a,$dd_c)/screen($dd_p,$dd_c) with VARIABLES; the app's xenonScreens
regex sees only LITERAL screen("x",N)/screen(N,ch) calls → registers ZERO
surfaces → no shim size, no 3-D feed → every screen blank.
THE NET-SCREEN LAW (wiki: a number resolves through the computer's
data_port.NN cables AND the router net; an alias addresses ANY component on
it — computer.md, MiniRouter.md): a computer's screen registry =
literal scan ∪ EVERY Screen/HdScreen element of EVERY Dashboard on the
computer's ROUTER NET, keyed by BOTH the io-number token and the alias token
(shim keys = the literal token lowercased), sized size×6 px (6 px/lattice-
unit law), registered BEFORE boot (xc_addScreen first-wins vs the 640×480
seed). The 3-D face binds ALL its keys (setScreenFeeds accepts key[] per
ci:channel; pushScreen by ANY key lands on the shared DataTexture) — the
program chooses alias- or number-addressing at runtime, we feed both.

## WP-B — THE DASHBOARD DATA PORT IS MID-BACK (DONE)
We measured every fresh Dashboard `data-connector` tip in the corpus
(8 endpoints, dist 0.020 m, all 6 crafts incl. 3828773626 both sides): the
plug sits at LOCAL FILE (W/2, H/2, −0.038) — CENTRE of the board's BACK,
0.02 m out along the −normal stub. The .ini [ADAPTER data-connector]
(0, 0.018, 0) is the gltf TEMPLATE's corner — the board is DATA-GENERATED,
so the socket rides the DATA: at = pos + R(q)·(W/2, H/2, −0.018) (file),
axis = −board normal. Our socket was the .ini corner → cables re-seated to
the CORNER (user: "connections … aren't in the middle of the back").
The generic anchor law stands for every OTHER type (18 407 endpoints,
tangent 0.000); Dashboard data-connector is its data-generated exception.

## WP-C — FLIGHT LAB: FORCES ON THE SHAPE FIELD (DONE)
The named next step (REWRITE: "forces (lift curve/stall/AoA) on the SAME
field"). engine/flightlab.ts implements the wiki's shape-field laws:
planform census (THIN voxel columns = the wiki's wing criterion → spanwise
lift distribution), finite-wing lift curve (Diederich), wiki stall ≈ 15°
with the flat-plate post-stall tail, two-sided lift (buried sections half),
fineness-weighted Cd0 + induced drag, CG (mass model) vs lift centre →
static margin + neutral point per axis (pitch from z-distribution, yaw from
the side-scan fin census), trim AoA, stall speed (isaAt density), control
AUTHORITY per Aileron part (area·lever·½ρv², the wiki's own scaling) —
which QUANTIFIES the Chips Falcon complaint: ailerons buried in the body
carry a lever ≈ 0 → authority ≈ 0 N·m = "don't do anything anymore".
UI: WindPanel gains the FLIGHT ANALYSIS section (speed/altitude rows,
verdicts, lift-curve sparkline) — streamlines stay the visual layer.

## WP-D — CARRY-OVERS INSO FAR AS POSSIBLE
- Router POWER GATING: routers resolve aliases only when powered
  (power.ts reachability × the xenonDevices net walk) — an unpowered router
  drops its subtree from every computer's device/screen/bus space.
- enOUGH_POWER: shim ABI bump (xc_set_enough_power) — the power net drives
  the VM's enough_power() so the Crafter's built-in overlay fires; needs
  build.sh wasm-only + dual-side pins. Land only if A–C green with margin.
NOT taken this batch (reasons): v1.17.0 assent (needs the user), ChipOS
wizard pixel pins (needs in-game ground truth), P8 module (unscheduled),
phone farm UX (design task), full wire-integrity REPAIR (check ships,
re-drop needs a design pass).

## Gate ladder
tsc + vitest per WP; e2e tags @Aero @Xenon + the new netscreens legs; the
jimmyprobe audit for WP-A (power/bus-adjacent); FULL suite before any
release label. Fixtures: make_flight_test.py → 9000009080 FLIGHT BENCH
(thin wing + tail boom + nose ballast vs a flying brick + a tail-heavy twin).

## Session end state (batch 3, 2026-10-31)
- WP-A/B/C/D1 all DONE (marks above). WP-D2 (`enough_power` shim +
  wasm ABI bump) NOT taken — first in the next queue.
- Census logged in docs/HISTORY.md §13: Jimmy margin −2.9% (unstable),
  Falcon 132/150 ailerons buried, Flight Bench pair stable +124% /
  tail-heavy −34%.
- Gates: vitest 1090 (+23, stitch data-drift red = baseline), tsc clean,
  targeted e2e 33/0/3, probes clean. RCS Infinity = 3812927875 (alias
  ISW-241; search via ws-names.tsv) — bench: margin −35.5% UNSTABLE.

---

# Batch 3b (same day, evening) — the NEVER-PAINTED GATE. Label v1.16.12.
User report: "ChipOS devkit screens flicker badly and the screens window
shows only black windows." Root cause + law: LIVING-CRAFT § 11 (gate) —
idle pumps pushed blank buffers on the SAME keys ChipOS paints (seq ≤ 1 =
created, never painted); the dock showed the active (paints-nothing)
pump's nine black registrations. Fixes: gate in BOTH pump modes
(fetchVersioned / worker pixelsFor), dock farm-merge (other pumps: painted
surfaces only, the painting pump owns the cell; the ACTIVE pump lists its
surfaces wholesale — its cell canvases are the want-set bootstrap for
virtual/auto-created surfaces; net-probe artifacts #8..31 filtered), the
LIGHTS-leg push law restated intent-driven (the 472-push count was the
fingerprint). Pins: xenonvm ×2,
e2e netscreens dock leg. RCS Infinity = 3812927875 (ws-names.tsv title;
alias ISW-241): margin −35.5% UNSTABLE — flightlab census leg.

## Full-suite pass (2026-10-31, evening) — gates ALL green
- FULL e2e: 172 passed / 0 failed / 31 skipped (2.4 m, production build).
- FULL vitest (machine corpus): 1094/0 incl. the new COVERAGE_AUTHORED
  class for the dev kit's legal-pair authored skin (stitch 12/12);
  testdata corpus keeps the documented 3816936540 pair red (data drift).
- tsc clean; /tmp/opencode scratch swept (2.3 G of staleness dirs freed).

---

# Batch 4 (2026-10-31, afternoon) — ANALYZER + TURBO + set_cps. Label v1.16.13.
- WP-A THE XENONCODE ANALYZER (DONE): engine/xcanalyze.ts, 11 codes,
  CM6 lint marks + Problems tab; vocabulary ⇄ binary cross-pins; shipped
  disks true-negative; fixture 9000009090; e2e analysis.spec.
- WP-B TURBO ×4 (DONE): pump cadence 100 Hz, virtual dt frozen; ⚡ in IDE/
  dock/menu/HUD; data-cycles observable; e2e turbo.spec.
- WP-C set_cps CADENCE LAW (DONE): shim records (ABI 17), xc_hud_cps,
  HUD pump arm() follows the program live; hudRuntime stamp made live;
  playerhud cadence pins; xenonhud suite re-proves the viewport law.
- Gates: vitest (incl. xcanalyze 21, playerhud 11), e2e analysis+turbo
  (both projects), xenonhud re-run; wasm rebuilt (ABI 17).

## Batch 4b (evening) — button_circle + HUD analyzer + display names
- Shim ABI 18: button_circle (member + MS forms, circle hit law; VM pin
  inside/outside). Analyzer vocabulary += button_circle/transmit/panel
  members; sync pin covers ALL THREE shim declaration sites; new pin:
  shipped player-HUD disks (readme/homo/omfg) analyze clean.
- HudDialog wires the analyzer: lint squiggles + Problems tab
  (playerhud.spec leg). DISPLAY-NAME LAW: homo → 'Human HUD' (labels
  only; folder keys byte-safe).
- Gates: xcanalyze 22, xenonvm 14 (+circle), playerhud 13 (+Problems leg),
  turbo 3/0/1, xenonhud+playerhud+xenon (@codeditor) e2e run, vitest full.

## Batch 5 (v1.16.14) — function-reference hover + HUD fixes
- xcdocs.ts + hover (sig/desc/ORIGIN) + COVERAGE LAW pin (31 vocabulary
  entries without docs found incl. blank); analysis.spec hover leg.
- Root-name law ($beacon.data uses $beacon) + homo regression pin.
- HUD Vars tab (pump run.vars() snapshot; side tab; VM + e2e legs).
- Gates: xcanalyze+playerhud 36/36, tsc clean, playerhud+analysis e2e run.

## Batch 6 (v1.16.15) — cockpit keyboard layout + seat→surface cables
- Cockpit pads = a KEYBOARD (1-0 over QWERT / ASDF / space / arrows / IJKL;
  T, ←/→ inert). SEAT→SURFACE: IoBus.seatChannel + Editor relay via
  seatCableTargets + proxy deflection in applyDevicePoses.
- Fixture 9000009091 SEAT BENCH (seat→aileron wire, inert program).
- Gates: cockpit.spec (sit, latch→aileron >20°, aux digits, lock), tsc,
  vitest full.

## WP-FULLSCREEN (OPEN, planned 2026-11-01, NOT taken — context budget)
We: "for any screen, there needs to be a PROPER fullscreen mode that tries
to use the entire screen (toggle onscreen for stretch/fit, and buttons for
control should overlay on mobile phone (provided there are no buttons in
the way with button_rect or circle_button stuff; if there are, these must
take precedence … make a toggle button on top for toggling that on mobile
phone interface …). Also make toggles for switching to arrows and a
1234567890 input alt".
Plan (surfaces = ScreensCell zoom windows + XenonDialog screen-tab canvas
+ HUD SCREEN window — ONE shared component ScreenFullscreen):
1. Shim (ABI 19): per-surface DRAWN-BUTTON RECTS export — the button_rect/
   button/button_circle declarations record their rects into ScreenSlot
   (rectsThisCycle), exported xc_screen_buttons(idx) -> JSON [{x,y,w,h,
   shape}]; cleared per cycle (the game draws its controls every frame).
2. Engine: XenonRun/XenonWorkerRun screenButtons(key) (typeof-guard, [] on
   old wasm); pump want-set unchanged (rects ride the cycle response).
3. Component: a ⛶ button on every screen canvas frame:
   • requestFullscreen on the canvas wrapper; exit restores (fullscreen-
     change listener keeps state honest).
   • stretch/fit toggle chip (object-fit: canvas CSS 100%/100% vs
     aspect-preserving contain), persisted per surface key
     (localStorage archean-app-screen-fill).
   • MOBILE (<768px) key overlay: bottom-anchored, translucent, reuse the
     cockpit pad law (farm.pressPilot — the seat channels): layout toggle
     chips: [WASD] [↑←↓→] [1234567890] (three overlay modes; the aux
     ladder as the digit layout; arrows = up/down only like the cockpit).
   • PRECEDENCE: when the pump reports non-empty screenButtons for this
     surface (program-drawn button_rect/circle this cycle), overlay HIDES
     and touches route to screenClick (the game's own controls win); a
     small ☰ top-toggle switches overlay on anyway (we: "make a toggle
     button on top … so user still can give input").
   • Desktop: overlay hidden (keyboard is native); rects mode shows a
     faint touch-target outline for debugging (hidden by default).
4. Pins: vitest (buzzerHarmonics pure-1/n ratios — UPDATED); shim probe
   (xc_screen_buttons JSON after a button_rect program); e2e
   screenfull.spec (fixture 9000009050 dash with button_rect: fullscreen
   button present; program-drawn rects → overlay toggle appears; mobile
   viewport: WASD overlay sends pressPilot (assert the worldsim row)).
5. Buzzer fidelity (DONE this batch): pure 1/n spectra (the n^0.1 shaping
   was softening square/saw into sine — we: "for sound fidelity it needs
   them to be that").

## WP-IDE-RETIER (OPEN, 2026-11-01, the user: "the tests for xenoncode IDE
take too long, they run at too high a level. create abstractions where
required and consume from a more standalone situation")
analysis.spec SKIPPED at the file head (the hover-geometry leg is fragile:
CM tooltips need visible-pane mouse coords; 1280×720 clipped the line).
Plan — retier the Xenon IDE e2e mass (xenon.spec is 73 loc of the suite's
slowest):
1. ABSTRACTIONS (pure/jsdom): (a) xcdocs+xcanalyze are already pure — the
   hover CONTENT needs no browser: pin xcDoc(word) per token (done);
   (b) extract the IDE's tab/strip/nav/problems ROW MODEL into
   engine/xcide.ts (pure: files, tabs, dirty set, problems rows, jump
   target) → jsdom mounts assert rendering; (c) a jsdom CODEMIRROR
   harness (view created off-screen, dispatch commands, assert state —
   completion list, indent law, find-panel open/closed) replacing the
   per-keypress e2e legs.
2. e2e keeps ONLY: real-cursor hover (one leg, generous viewport
   init 1440×900 + scrollIntoView BEFORE measuring), IndexedDB save
   round-trip, F5-to-disk, real CM painting (pixel spot-checks).
3. Gate-ladder note: @codeditor full-run drops from minutes to seconds
   once the legs retire; the suite's fast tier gets the jsdom tier.
