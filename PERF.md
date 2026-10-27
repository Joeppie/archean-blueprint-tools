# PERF.md — profiling results & optimisation catalogue

Measured 2026-10-06, headless chromium (ANGLE/Vulkan) pinned to the **AMD iGPU**
via `tools/perfprobe.py` (real wall-clock numbers; `--virtual-time-budget`
freezes clocks and rAF cadence so `?perf` titles under it are meaningless),
window 1400x900, dpr 1, wind = 2200 particles.

## Measured (fps / draw-calls / triangles / wind-step ms / load ms)

| scene | fps | draws | tris | geo | flowms | loadms |
|---|---|---|---|---|---|---|
| ISW-241 static | 64 | 156 | 124 k | 180 | – | 342 |
| ISW-241 wind | 64 | 168 | 124 k | 188 | 2.8 | 321 |
| ISW-241 lines | 64 | 166 | 124 k | 186 | – | 344 (build 30 ms) |
| ISW-241 real models + wind | 64 | 168 | 289 k | 188 | 2.9 | 329 |
| Jimmy 3334698274 wind (mosaic) | 63 | 1277 | 335 k | 1249 | 2.9 | 469 |
| Semi-truck 3481322297 wind | 63 | **1973** | 1 476 k | 2016 | 2.7 | 447 |
| Semi-truck lines | 63 | 1971 | 1 476 k | 2014 | – | 509 (build 28 ms) |
| Semi-truck real + wind | 62 | 1973 | 3 585 k | 2016 | 2.7 | 446 |
| Dolphin 3417786605 wind (seal) | 64 | 351 | 118 k | 314 | 2.4 | 354 |
| **Giant 3509975859 wind (6.3 MB)** | **14** | **12 375** | **3 705 k** | **11 880** | **13.0** | 937 |

Reading: everything is at full 60 fps through 1.5 M tris and ~2 k draws.
The iGPU is NOT fill/geometry bound at these sizes — draws ~2 k are cheap on
modern GL drivers, and the merged-hull + on-demand-render design works.
One real cliff: the 6.3 MB craft (~1.8 k components → 12 k draw calls,
3.7 M tris) runs 14 fps, and its wind step costs 13 ms (grid grows with bbox).

**v0.137 shipped fixes 1, 2, 4** (below): giant wind is now 6.5 ms at 900
particles (`sim 900 pts (large-craft approx)` in the report); normal crafts
keep all 2200 — ISW cells 1 k, truck 6 k, Jimmy 16 k, all under the full-rate
tier at 60 fps. The giant's 14 fps itself is GPU draw-bound (candidate 3).

**v0.155 aero-plate grid**: sampleVel's per-particle O(plates) scan is now a
uniform-grid superset query (3x3x3 cells of 1.5 m, integer keys) above 200
plates. Giant (1024 plates, 900 pts): flowms 6.3-6.5 → 4.9-5.5 (3 runs each,
2026-10-09; that day the NVIDIA GPU ran the user's AI models at 100 % — fps
titles were contention-noise, flowms is the robust signal). Sub-200-plate
crafts keep the scan: the airliner's 92 plates measured scan 2.4 vs grid
5.0 ms/frame — the grid only pays off once scans dominate the 27 hash probes.

**v0.156 wind scale-up** (user: "more wind particles, from further away"):
baseline 2200 → 4000 particles, spawn box inflated 4 m (was 1.3), kill
margin 9 m (was 2.6), streamline seeds rad+9 upstream. Measured iGPU:
ISW 4000 pts flowms 4.9 (2.8 at 2200), giant 1600 pts 7.8 (5.0 at 900) —
per-particle cost unchanged, frame budget (16 ms) holds; the giant's fps
stays draw-bound.

## Design wins (do not regress — mostly already test-pinned)

- Hull merged into one mesh per palette colour; wire = 1 LineSegments;
  pipes/occupancy/streamlines single meshes.
- On-demand rendering (`invalidate()`); continuous only while flow/labels/
  drag/fly/sock-flutter is active.
- Materials unshared per component *on purpose* (selection emissive).
- Streamline build is 30 ms; wind step ≤3 ms at 2200 particles.
- Seal flood + triangle raster have hard cell/triangle budgets (linear load).

## Harmful candidates (catalogue)

1. **pointermove raycast unthrottled** — FIXED v0.137: hover listener removed
   (user: raycast only on a DELIBERATE press). One pick at pointerdown (the
   moment a drag starts), reused by the click test in pointerup. Orbit drags
   raycast exactly once, never during movement. Pin: `click=true`.
2. **buildStreamlines per slider `input` event** (speed/AoA/azimuth rows) —
   FIXED v0.137: ~120 ms debounce, lines-mode only (wind mode reads
   flowState live and needs no rebuild).
3. **Giant craft GPU-bound (14 fps)**: 12 k draws = per-component proxy node
   trees (each renderable node = own mesh + own material for selection
   highlight). Fix = merge proxies per component, keep per-component (not
   per-node) highlight via per-component overlay mesh; breaks per-node
   emissive — needs design. Severity: only for 1 corpus file. OPEN.
4. **stepFlow 13 ms on the giant** — FIXED v0.137 as game-style physics LOD
   (user framing: the game approximates physics for big crafts because full
   sim cost scales with them). Measured cost driver = solid-cell lookup
   pressure (237 k-cell giant at 2200 pts = 13 ms; 16 k-cell crafts = 3 ms).
   `flowBudget()` tiers the particle count on solidCells.size. v0.155: the
   aero-plate tier is GONE — plates are grid-indexed (see above). v0.156
   re-scaled the tiers: 4000 baseline, 3000/1600/1000 by cell pressure
   (giant 1600 pts, ~7.8 ms). The flight
   report shows `sim N pts (large-craft approx)` when tiered. Pin:
   `windpts=true` (ISW keeps the full 4000).
5. **Load 937 ms (giant)**: JSON parse + build + seal, all budget-capped;
   fine for 6 MB (sub-second). No action.
6. **antialias:true + dpr cap 2.5**: intentional sharpness (documented in
   AGENTS perf rules); the iGPU measures full-rate with AA at 1400x900, so
   leave it. Re-check only for integrated-GPU user reports.
7. **windHud forces 60 fps redraw in lines mode** (sock flutter): 168-draw
   static scene → negligible (64 fps measured). Optional: flutter at 30 fps.
8. **string-keyed grid cells** — v0.155's first aero grid used `'x,y,z'`
   template keys: giant flowms REGRESSED 6.5 → 7.5 (27 string allocs +
   hashes per particle-sample, GC churn). Integer base-8192 keys (the
   cellKeyV encoding) fixed it (→ 5.0). Rule: every per-frame key is an
   integer.
9. **serialize() per-occ full-block scan** — FIXED v0.155: type-255 mirror
   sync was O(comps×occs×blocks) per save. Now a live-reindexed Map keyed
   by CURRENT cell+size+frame; matched blocks are consumed from their old
   key and re-inserted at the shifted cell, reproducing the sequential-scan
   semantics exactly (a later occ keyed by a shifted-to cell matches again).
10. **syncAdapters scanned all of adpQueue per edit** — FIXED v0.155: gizmo/
   livePos drags fire per pointermove over every nub+cable entry; now a Map
   keyed by component index (length sentinel + explicit invalidate at the
   queue rebuild in setModel — clear+refill to the SAME length must drop
   the stale index).

## v1.11.2 load-path & per-rev baseline (app/, node JIT-warmed, vitest)

`app/src/engine/__tests__/load.perf.test.ts` times the ranked hot loops on
committed corpus crafts (run: `npx vitest run load.perf`); the numbers below
are medians on this box.

| loop | before | after | where it runs |
|---|---|---|---|
| sealedEnvelopeVolume giant (9 656 blocks) | 219 ms | **JS 219 ms → WASM ~110 ms (1.6–3×)** + LiftWidget DEBOUNCED 250 ms | every edit rev (LiftWidget) — KNOWN ISSUE 1 CLOSED |
| build-dock twin census (800-cap sweep) | 15–17 ms | **0.16 ms (91×)** indexed `twinConflictCensus`; the 800-block cap is GONE (giant 9 656 records = 6.6 ms) | every edit rev (dock census) |
| culledBlocksSolids giant (9 656 records) | 162 ms | 154 ms (opacity-slot memo, integer footprints, lazy vertex clouds) | load, once |
| buildTunnel + 30 solveSteps ISW | 94 ms | 94 ms (untouched) | wind tunnel active only |
| sealedEnvelope zeppelin skin (336 tris) | 6.2 ms | **4.2 ms** | balloon tool edits |

### WASM verdict (AssemblyScript, first module landed)

REWRITE.md ranked the candidates; measured (node, `sealwasm.test.ts` +
`load.perf`), the 2× bar decides:

- **SEALED ENVELOPE — ADOPTED.** `app/wasm/seal.ts` (AssemblyScript, 4.4 kB,
  `npm run build:wasm`), seam `engine/sealwasm.ts`; `sealedEnvelopeVolume`
  answers from the module when booted (Editor background-fetches the ?url
  asset) and from the pure-JS reference twin (`sealedEnvelopeJS`) otherwise —
  pinned byte-equal over the corpus + synthetic seals + balloon skins
  (`sealwasm.test.ts`). Giant: 219 → 106–110 ms (clean-process 2.3–3×,
  shared-worker 1.6×); the LiftWidget debounce removes the rest from the
  per-rev path.
- **HULL CULL + STITCH (`culledBlocksSolids`) — JS improvements shipped,
  WASM deferred.** The string→integer footprint quantisation, the per-slot
  opacity memo and the lazy vertex clouds buy 162→154 ms (the cost is the
  face-grid Map + stitch scans, not the formatting). An AssemblyScript port
  must re-implement the blockshapes vertex clouds + the face-grid maps — a
  ~500-line second implementation of the trickiest culling law for a
  load-time-only loop that stays sub-second on the single 6 MB craft. The
  pure `CulledBlocks` contract in `engine/cull.ts` remains the seam.
- **WIND SOLVE (aero multigrid) — no.** Red-black GS + FMV multigrid is
  already a typed-array cache-friendly loop; the expected WASM delta over
  V8-optimised f64 arrays is ~1.2×, under the bar (REWRITE's own read: a
  better future fit is WebGPU compute).

Landing lessons (AssemblyScript, cost ~2 h): `--maxMemory` is
`--maximumMemory`; the AS 0.28 runtime IMPORTS `env.abort`; `inline function`
returning values does not compile (LLVM inlines at -O3 anyway); **typed-array
indexing keeps bounds checks — the giant BFS made the naive port SLOWER than
JS (0.44×) until the flood arrays became raw `__alloc` pointers +
`load<u8>/store<u8>` (0.44× → 2.3×)**; the fixed-address ABI
(blocks i32 @0, tri verts f64 @1 MiB, OUT @17 MiB, heap `--memoryBase` 18 MiB)
lets JS serialise via zero-copy views (re-create the views per call — the
buffer grows); `wallPtr()/seenPtr()/gridN()` exports let tests diff the wall
maps cell-for-cell (they caught a vertex-stride bug that the tetra fixture
masked: symmetric coords survive an axis-rotated stride).


## v1.12.2 BOOT COST pass (app/, browser, `app/tools/bootprobe.mjs`)

Measured on the PRODUCTION preview (the exact stack playwright drives: fresh
context per boot, ANGLE-Vulkan on the iGPU, `?craft=` deep link, backdrop-skip
fixture), medians of 3 boots. Phase marks: main → eval → render1 → canvas →
engine → attach → atlas → scene-load (marks in main/App/Editor/Viewport/scene).

| boot | SCENE-PASS before | after | scene-load mark before/after |
|---|---|---|---|
| ISW 3812927875 | 571 ms | **482 ms** | 456 / 386 |
| x-ray fixture 9000007001 | 458 | **465** (flat) | 395 / 375 |
| truck 3481322297 | 1047 | **720** | 781 / 517 |
| giant 3509975859 | 2423 | **1144** | 2345 / 1025 |
| testframe 9000005001 | 433 | **438** (flat) | 372 / 371 |

What paid (per-load `stats().loadPhases`, lpStep marks in `load()`):

- **CABLES AS INSTANCED MESHES** (the batch's headline): the clone +
  mergeGeometries fan-out (one CylinderGeometry clone per bar, merged with
  computeVertexNormals) was THE load hot spot — `pipes` phase: ISW 21.8 →
  2.5 ms, truck **253 → 8.9 ms**, giant **1054 → 14.4 ms** (73×); total load
  truck 291 → 56 ms, giant 1309 → 271 ms. Every reload() (block edit, twin
  write, rebuildPipes cable re-drape) re-pays it — this is the interactive
  snappier-app win on big crafts, and ~2 ms × every e2e boot.
- **symTwinIndex allocation-free inline scan** (per-type O(n²) pair test):
  the giant's anchor phase 28 → ~6 ms (3.2 M mask tests no longer allocate
  a 3-element array PAIR each); directed-pair fuzz pin (30 seeds).
- **Boot parallelization**: the model manifest (107 kB) fetch starts WITH the
  Editor chunk import (App.tsx) instead of serially behind the blueprint
  download (giant: atlas mark 751 → 665, the manifest lands @30 ms every
  boot); deep-link boots pre-resolve the chunk (main.tsx `bootEditor`) so
  the editor renders in the root's SYNCHRONOUS initial mount (no time-sliced
  Suspense reveal — the bootprofile showed the reveal amortized over ~250 ms
  of 5-ms slices).
- **Chunk diet** (vite advancedChunks three/vendor groups + lazy ToolsDialog
  / HelpDialog / LiftWidget / CostWidget): Editor chunk **1 369 → 365 kB**
  (116 gz); three = 260 gz + vendor 68 gz are STABLE-CACHEable across
  releases on Pages. Costs ~30 ms/boot on the local preview (9 chunks vs 2,
  module compilation) — the trade is the real user on the real network.

Measured, NOT shipped: the `renderer` mark (~330 ms) is headless ANGLE/Vulkan
CONTEXT + compositor init — a bare `getContext('webgl2')` on the same stack
costs 2 ms; the CPU profile of the boot window shows ~107 ms main-thread busy
vs ~400 ms wall = ~26 headless compositor frames; `--use-angle=gl` (mesa EGL)
and shared XDG_CACHE_HOME change nothing, default (SwiftShader) is 3× worse.
The floor is the headless environment, not app code — the ANGLE-Vulkan pin
stays (AGENTS § GPU). WebGL context creation is NOT the cost, and the app
pays ~110 ms of real JS per boot.

e2e wall: fast tier **2.5 → 1.8 min** (204 runs, 4 workers, preview+iGPU) —
backdrop-skip fixture + boot costs; @slow 11/11.

## Tooling

- `?perf` (live browser): title shows `fps draw flowms buildms loadms tris geo`
  measured over a 1.6 s window armed 0.8 s after the first rendered model
  frame (real wall clock).
- `tools/perfprobe.py URL [s]`: headless iGPU real-clock probe via DevTools
  protocol (no npm, hand-rolled websocket); prints the title timeline.
