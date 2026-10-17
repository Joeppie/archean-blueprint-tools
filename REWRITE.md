# REWRITE.md — TypeScript + React + Playwright rewrite plan

Status: **planned** (Phase 0 shipped: pointable blueprint folder, AGENTS rule).
The legacy zero-build viewer (`viewer/`) stays live and green on `release`
(Pages) for the whole migration; the new app lives in `app/` and only takes
over the release line when it reaches feature parity (Phase 5).

## Target stack (decided)
| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) | the whole ask |
| App shell | React 19 + Vite 7, SPA in `app/` | the ask; Vite = zero-config TS/ESM |
| UI kit | Tailwind CSS 4 + shadcn/ui (Radix primitives) | the leading React UX framework in 2026; Radix gives accessible sliders/panels/trees without opinionated chrome — right fit for the DevTools-style inspector |
| State | zustand (slices) + immer for the blueprint model | one dirty-checked document store; panels subscribe per-field (no whole-tree rerenders) |
| 3D | three.js (npm, pinned) inside a **headless scene engine class** (`app/src/engine/`), NOT react-three-fiber | the scene is manually merged/culled/on-demand-rendered (PERF.md rules); R3F would rerender the graph per React commit. React mounts `<Viewport>` and calls `engine.attach(canvas)`; engine never imports React |
| Data flow | engine emits events → zustand; React never touches Object3Ds | keeps the 60 fps render path out of React's scheduler |
| Unit tests | vitest (pure logic: palette, blockshapes, hullfit, format math, serialize) | no browser needed for ~40 % of the old suite |
| E2E / UI | Playwright (`@playwright/test`) | the ask; see § Playwright |
| Blueprint root | resolved path served over a tiny dev-server plugin reading `tools/config.py` (`ARCHEAN_BLUEPRINTS` / `blueprints.conf`) | keeps the AGENTS § Blueprint-folder rule through the rewrite |

## three.js fork investigation (verdict — no fork)
No third-party fork beats stock three.js for this workload (2026 survey):
- **WebGPURenderer** (official, production-capable since r171, WebGL2 auto-
  fallback) is NOT a free win: on many-mesh scenes it measures CPU-slower
  than WebGLRenderer (three.js forum, r183; GitHub #30560). It only pays
  once the scene is BATCHED, or via compute/TSL for particle sims.
- The ecosystem's real lever matches our only measured cliff (PERF.md:
  giant craft 12 375 draws → 14 fps, everything else 60 fps):
  **THREE.BatchedMesh / InstancedMesh** per-component proxies —
  cuts the 12 k-draw cliff ~90 % on BOTH renderers. That is an engine-
  internal change, not a dependency swap.
- Optional later: WebGPURenderer behind a flag once BatchedMesh lands, and
  WebGPU compute for the 4 000-particle wind sim (Vite dynamic import,
  WebGL fallback stays default).
So: **keep stock three, adopt BatchedMesh; re-evaluate WebGPURenderer in
Phase 4 with the ?perf port instrumenting draw counts.**

## WASM candidates (identified; deliberately deferred)
Load profile (PERF.md): 60 fps is already met through 1.5 M tris; the giant
takes 937 ms to load (JSON parse + build + seal). Nothing is frame-critical
today — WASM is justified ONLY where a ported hot loop measures >2× again.
Ranked by expected payoff, all isolated behind pure typed-array APIs so a
drop-in WASM module never touches React:
1. **Hull build: interior-wall face culling + rectangle stitching + prism
   extrusion** (`buildHull`) — the largest O(blocks×faces) load-time loop;
   clean f32/u32 in/out contract; AssemblyScript.
2. **Wind step + streamline integration** (`stepFlow`/`sampleVel`, integer
   grid keys already) — 3–8 ms/frame; second candidate; later a better fit
   for WebGPU compute than WASM.
3. **sealStats flood fill + triangle raster** — load-time only, budget-
   capped; low priority.
4. JSON parse stays JS (`JSON.parse` beats wasm json); the type-255 mirror
   index stays a Map (perf rule #10).
Phase 2 writes these as pure modules (`engine/hull/build.ts`,
`engine/sim/flow.ts`) with `*View` typed-array signatures — the WASM seam —
and Phase 4 benchmarks before adding a toolchain (assemblyscript is the only
new build dep, kept inside `app/`).

## Phases
- **P0 — DONE**: pointable blueprint folder (`tools/config.py` + AGENTS rule).
- **P1 — DONE (scaffold + pure core)**: `app/` = Vite 8 + React 19 + TS(strict)
  + Tailwind 4/shadcn-ready; vitest (29 pins: palette, blockshapes, grid maths,
  hull lattice, and corpus-wide byte-identical re-emit through `engine/doc.ts`,
  the raw-number-literal document that preserves the game writer's int/float
  split — plain JSON.stringify could not, measured 61/61 corpus mismatches);
  Playwright (4 passing UI tests through the `/corpus/` vite plugin, which
  honours ARCHEAN_BLUEPRINTS/blueprints.conf per the AGENTS rule); SPA shell
  with ?craft= deep links. Corpus config resolution is mirrored in
  `app/tools/vite-corpus.ts` — no hardcoded paths in `app/` either.
- **P2 — IN PROGRESS (P2a landed: first render)**: `engine/build.ts` (pure,
  THREE-free — WASM seam) merges blocks per palette colour with the view
  z-mirror + flipped winding, hull triangles and occupancy proxies;
  `engine/scene.ts` is the framework-free renderer (legacy lighting rig
  sky+fog+hemi+warm-sun, ground under the model, legacy fit params, on-demand
  invalidate, raycast pick); React `<Viewport>` mounts it and exposes
  `window.__ARCHEAN__` test hooks + a `SCENE PASS …` title. Verified with
  HEADLESS CHROMIUM (iGPU-pinned shots: chopper 3251580044, GNG-574, ISW-241)
  + Playwright scene specs (draws>0, pick probe, canvas click, switch).
  Caught through the screenshots: block/occupancy `size_*` is INCLUSIVE
  ((size+1)·CELL, legacy blkSpan) — pinned in build.test.
  Next (P2b): interior-wall face culling + rect stitch, pipes/adapters,
  component real models + display-pose rules, subgrid kinematics, IBL/PMREM.
- **P3 — React UI**: DevTools-style panels as shadcn components
  (ViewOptions, component list tabs + collapse + search, inspector rows →
  controlled sliders writing the store, mode widget, gizmo = engine-owned
  canvas overlay, panels get keyboard a11y for free via Radix).
- **P4 — perf**: BatchedMesh proxies, ?perf port, wasm benchmark of
  candidate 1, optional WebGPU flag.
- **P5 — parity gate + cutover**: Playwright suite mirrors the old suites
  (below), corpus fixture runner over the configured blueprint folder,
  landing/gallery in React, release.sh extended to build `app/dist`.
  Legacy `viewer/` retires only here, with the user's say-so.

## Playwright plan (`app/e2e/`)
- Config: chromium project, `webServer` = vite preview + the corpus plugin;
  iGPU pin env passthrough (VK_ICD_FILENAMES) exactly like run_tests.sh.
- Determinism: a `?cam=` URL pose + fixture craft from the configured
  blueprint folder; pixel-free assertions via engine hooks exposed on
  `window.HARCHEAN` (same philosophy as today's title/#out reporting).
- Suites:
  - `select.spec.ts` — canvas click picks a component (click=true pin),
    widget pops at the part, subgrid-content routing + invisible-proxy
    rule (comp-pick), co-selection/glow of mirror twins.
  - `gizmo.spec.ts` — real mouse drag on the rotate ring: hover fattens
    ONLY the aimed ring (gizmohover/gizmofat/gizmostyle pins as visual +
    state assertions), pitch-then-roll intrinsic order, knob continuity
    past ±180°, translate arrows stay world-axis, twin mirror rotation
    (symrot/symrot-x sign rules), pivot = visible-geometry centre.
  - `panels.spec.ts` — every control through the real UI (uitest port):
    tabs, collapse, filter, keyboard g/o/h, presets, dirty→save, hull fade.
  - `subgrid.spec.ts` — select-by-master, joint sliders ride the subgrid,
    twin unison.
  - `format.spec.ts` — open each corpus craft (folder from config),
    expect REGTEST-grade invariants through a debug endpoint.
- Legacy suites keep running unchanged until P5.

## Non-negotiables carried over
- AGENTS § Blueprint folder (paths via tools/config.py — the vite plugin
  reads it; no hardcoded paths in `app/` either).
- Byte-identical serialize; occupancy/type-255 mirror sync; Unity-LH
  conjugate + LEGACY_Q split; integer grid keys; on-demand rendering;
  merged static geometry; iGPU-pinned headless runs (never contend the
  NVIDIA GPU); release cuts only on explicit user say-so.
