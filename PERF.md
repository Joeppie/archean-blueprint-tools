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
   `flowBudget()` tiers the particle count on solidCells.size: 2200 ≤100 k
   cells, 1400/900 ≤400 k, 500 above; aero-plate count guards the
   hull-triangle-heavy case (1400/900). Giant: 900 pts, 6.5 ms. The flight
   report shows `sim N pts (large-craft approx)` when tiered. Pin:
   `windpts=true` (ISW keeps the full 2200).
5. **Load 937 ms (giant)**: JSON parse + build + seal, all budget-capped;
   fine for 6 MB (sub-second). No action.
6. **antialias:true + dpr cap 2.5**: intentional sharpness (documented in
   AGENTS perf rules); the iGPU measures full-rate with AA at 1400x900, so
   leave it. Re-check only for integrated-GPU user reports.
7. **windHud forces 60 fps redraw in lines mode** (sock flutter): 168-draw
   static scene → negligible (64 fps measured). Optional: flutter at 30 fps.

## Tooling

- `?perf` (live browser): title shows `fps draw flowms buildms loadms tris geo`
  measured over a 1.6 s window armed 0.8 s after the first rendered model
  frame (real wall clock).
- `tools/perfprobe.py URL [s]`: headless iGPU real-clock probe via DevTools
  protocol (no npm, hand-rolled websocket); prints the title timeline.
