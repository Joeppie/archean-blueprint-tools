# REWRITE.md — TypeScript + React + Playwright rewrite plan

Status: **planned** (Phase 0 shipped: pointable blueprint folder, AGENTS rule).
The legacy zero-build viewer (`viewer/`) stays live and green on `release`
(Pages) for the whole migration; the new app lives in `app/` and only takes
over the release line when it reaches feature parity (Phase 5).

## Target stack (decided)
| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) | the whole ask |
| App shell | React 19 + Vite 8 (Rolldown bundler), SPA in `app/` | the ask; Vite = zero-config TS/ESM; scaffold landed on Vite 8 after the plan was written |
| UI kit | Tailwind CSS 4 + shadcn/ui (Radix primitives) | the leading React UX framework in 2026; Radix gives accessible sliders/panels/trees without opinionated chrome — right fit for the DevTools-style inspector |
| State | zustand (slices) + immer for the blueprint model | one dirty-checked document store; panels subscribe per-field (no whole-tree rerenders) |
| 3D | three.js (npm, pinned) inside a **headless scene engine class** (`app/src/engine/`), NOT react-three-fiber | the scene is manually merged/culled/on-demand-rendered (PERF.md rules); R3F would rerender the graph per React commit. React mounts `<Viewport>` and calls `engine.attach(canvas)`; engine never imports React |
| Data flow | engine emits events → zustand; React never touches Object3Ds | keeps the 60 fps render path out of React's scheduler |
| Unit tests | vitest (pure logic: palette, blockshapes, hullfit, format math, serialize) | no browser needed for ~40 % of the old suite |
| E2E / UI | Playwright (`@playwright/test`) | the ask; see § Playwright |
| Blueprint root | resolved path served over a tiny dev-server plugin reading `tools/config.py` (`ARCHEAN_BLUEPRINTS` / `blueprints.conf`) | keeps the AGENTS § Blueprint-folder rule through the rewrite |

Vite was **introduced** by this rewrite — it does not replace the legacy
`viewer/`, which stays zero-build (plain ES modules + CDN Three.js, no npm)
and live on `release` until Phase 5 cutover. The toolchain lives ONLY under
`app/` (own npm project; repo-root `tools/`, `tests/` and the zero-build
regtest are unchanged). Deviations from the 2026-10 plan strings, all landed
with P1: Vite 7→8 (Rolldown), ESLint never adopted (Oxlint), vitest runs the
pure engine layer on plain node.

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

## WASM candidates (measured v1.11.2 — first module LANDED, verdicts below)
Load profile (PERF.md): 60 fps is already met through 1.5 M tris; the giant
takes 937 ms to load (JSON parse + build + seal). Nothing is frame-critical
today — WASM is justified ONLY where a ported hot loop measures >2× again.
Ranked by expected payoff, all isolated behind pure typed-array APIs so a
drop-in WASM module never touches React:
1. **Hull build: interior-wall face culling + rectangle stitching + prism
   extrusion** (`buildHull`) — the largest O(blocks×faces) load-time loop;
   clean f32/u32 in/out contract; AssemblyScript. **VERDICT v1.11.2: JS
   improvements shipped (162→154 ms giant), WASM DEFERRED** — the port must
   re-implement the blockshapes clouds + face-grid maps for a load-time-only
   loop; `engine/cull.ts` stays the pure seam (PERF.md §WASM verdict).
2. **Wind step + streamline integration** (`stepFlow`/`sampleVel`, integer
   grid keys already) — 3–8 ms/frame; second candidate; later a better fit
   for WebGPU compute than WASM. **VERDICT v1.11.2: NO** (measured shape:
   typed-array multigrid at V8 speed; expected delta under the 2× bar).
3. **sealStats flood fill + triangle raster** — **LANDED v1.11.2** (promoted:
   the app's `sealedEnvelopeVolume` runs per edit REV behind the LiftWidget,
   219 ms on the giant). `app/wasm/seal.ts` (AssemblyScript, 4.4 kB,
   `npm run build:wasm`), seam `engine/sealwasm.ts`, JS reference twin +
   corpus parity pins `sealwasm.test.ts`; giant 219→~110 ms + LiftWidget
   debounce 250 ms. AssemblyScript landing lessons: PERF.md.
4. JSON parse stays JS (`JSON.parse` beats wasm json); the type-255 mirror
   index stays a Map (perf rule #10).
Phase 2 writes these as pure modules (`engine/hull/build.ts`,
`engine/sim/flow.ts`) with `*View` typed-array signatures — the WASM seam —
and Phase 4 benchmarks before adding a toolchain (assemblyscript is the only
new build dep, kept inside `app/`). **v1.11.2: the benchmark harness is
`app/src/engine/__tests__/load.perf.test.ts` (npx vitest run load.perf —
prints the table, loose anti-regression tripwires); assemblyscript is
installed in `app/` and the module builds via `npm run build:wasm`.**

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
- **P2 — DONE (P2a–P2c + heavy tier)**: `engine/build.ts` (pure,
  THREE-free — WASM seam) merges blocks per palette colour in the RAW frame
  (v0.180 de-mirror: no view z-mirror, authored winding), hull triangles and
  occupancy proxies;
  `engine/scene.ts` is the framework-free renderer (legacy lighting rig
  sky+fog+hemi+warm-sun, ground under the model, legacy fit params, on-demand
  invalidate, raycast pick); React `<Viewport>` mounts it and exposes
  `window.__ARCHEAN__` test hooks + a `SCENE PASS …` title. Verified with
  HEADLESS CHROMIUM (iGPU-pinned shots: chopper 3251580044, GNG-574, ISW-241)
  + Playwright scene specs (draws>0, pick probe, canvas click, switch).
  Caught through the screenshots: block/occupancy `size_*` is INCLUSIVE
  ((size+1)·CELL, legacy blkSpan) — pinned in build.test.
- **P3 — LANDED (core editor loop + subgrids; see the gaps below)**:
  editing + UI on top of the frozen port references:
  - `engine/doc.ts` gained `docSet` (primitive writes keeping literal style);
    `engine/edit.ts` (NEW, pure) is the ONLY write funnel: position/quaternion/
    data-field edits hit bp AND doc together, and `serializeSave` replays the
    legacy serialize() contract — occ cells = occ0 + round(Δ/CELL), the
    type-255 mirrors follow via the CURRENT-key consume-and-rekey index, an
    applied-cells tracker keeps repeated saves exact, and an untouched doc
    re-emits byte-for-byte (pinned over EVERY corpus file + an ISW wheel move).
  - `engine/subgrid.ts` (NEW, pure): the FLATTENED composite_builds decode
    (nested content before its Build, readBuild order; masters may be NESTED —
    doc paths included), the joint-line capture (bbox clamp + the edge/face-
    mounted hinge triad, pin vs pin×span, pivots/tracks longest-dim) and the
    joint-pose algebra (spin about the CAPTURED line, slide, rigid master
    riding — identity at the built pose). Vitest pins: readBuild order, nested
    masters, dolphin 5⇔3+2, XYQ hinges @24.3°, corpus-wide "no master lands
    on a Build", axis rules, pose identity/swing/slide/follow.
  - `engine/scene.ts`: display anchoring (legacy moff: the minimal frame at
    the origin; v0.180: raw frame, z keeps its sign); ONE Group per Build with nested solids
    (parent palette) + nested part proxies (invisible proxies route clicks to
    the SUBGRID only when no component is hit — v0.169 pick routing baked into
    pickNdc) + real models with raycast disabled; `syncSubJoints` after every
    load/edit; heavy tier MERGES the nested stand-in boxes per colour (the
    giant's 659 boxes blew the phone draw budget). Selection: golden
    LineSegments2 box (3.5 px, expanded 0.07 m, depthTest off) + breathing
    pulse (the on-demand loop wakes only while a selection lives) + ease-out
    fly-to (canvas click / list double-click only). Editing API:
    `moveComp` (proxy+real siblings ride, subgrids follow),
    `beginRotEdit`/`setCompQuatDelta` (absolute world YXZ degree deltas
    composed qd·q0, file quaternion stripped through the legacy wheelUndo
    right-multiplier), `refreshComp` (⟲ rebuilds the display pose + undo),
    `setOption/setHullOpacity` (hull⟷wire exclusive; opacity dims solids +
    wire), `setRealModels` (reload with/without the atlas stream).
  - `occupancies` is an ARRAY (real format!) — fixed the type + standInBox/
    buildCompProxies to read `[0]` (the occ-box display silently used origin
    dots for every part before).
  - UI: `components/Panel.tsx` — DevTools rows (slider+number+⟲ with the
    BUILD-TIME reset baseline — a live-prop baseline made ⟲ a no-op after the
    first re-render, caught by the dolphin joint pin), view options (all
    legacy toggles + hull opacity + real models), the component list (by type /
    by subgrid tabs, collapsed groups + search force-open + selection reveal),
    the inspector (position ±2/±1.5 m, world pitch/yaw/roll deltas, PilotSeat
    lean presets, comp.data rows bool/number/string, ⟲ reset this component),
    the subgrid panel (Contents + DECODED masters + live joint angle/slide
    sliders writing the master's data verbatim). App: doc-backed Editor
    (text → parseDoc → makeCtx), dirty → Save downloads the mirror-synced
    byte-identical blueprint.json (also Ctrl+S), keyboard g/o/h/Esc drive the
    same toggles as the checkboxes, mobile panel drawer.
  - e2e `panels.spec.ts`: exclusivity + keyboard pins, search→select→inspector,
    move x → SAVE with the 255 mirror verified in the DOWNLOADED file,
    dolphin subgrid tab → joint slider swings + restores the group pose,
    mobile drawer. Gates: vitest 95/95, tsc strict clean, Playwright 27 pass
    (3 desktop-only skips), iGPU renders: dolphin subs=5, ISW, gantry.
- **GIZMO + MODE WIDGET — landed on top of P3** (the legacy primary
  manipulation path): an engine-owned `TransformControls` on a plain proxy
  group attached at the VISIBLE-geometry bbox centre (v0.167 pivot semantics:
  an off-origin part spins IN PLACE at the rings while the file origin ORBITS
  the pivot at constant radius — pinned); translate = WORLD space, rotate =
  LOCAL rings (v0.158 per-mode rule); Shift snaps 15° / 0.25 m; the base
  rebases on every mouseDown so multi-grip sweeps continue. The writeback
  applies the gesture DELTA motion X ↦ c + dq·(X−c) + t (with the ABSOLUTE
  proxy quaternion a pure translate also rotated the part — caught by the
  pin) and strips the display pose through the legacy right-multiplier undo
  dispQ0⁻¹·viewQ0 — a PRODUCT, not an inverse: the wrong form collapsed
  rotation writebacks to identity, which had silently broken the inspector's
  rotation sliders too; the pin restores the file quaternion to 1e-9 after
  ±30°. The inspector's sliders share the exact undo. The MODE widget
  (⊘/✥/⟳) pops at a deliberate canvas part pick (legacy v0.153; ⇄ lands with
  the symmetry port) and persists; `opt-gizmo` + localStorage keep the legacy
  default ON; subgrid selection carries NO gizmo (v0.170, pinned). Engine
  writes flow through `onEdit` → the doc mirror + dirty, so a gizmo drag is
  Save-able like a slider edit. e2e `gizmo.spec.ts` + gates: vitest 95/95,
  Playwright 31 pass / 7 desktop-only skips; iGPU shot: RGB rings +
  trackball on the ISW beacon.
- **INTERIOR-WALL CULLING + RECT STITCH — landed** (XenonViewer port, pure
  `engine/cull.ts` = the designated WASM seam): full faces cut cell-by-cell
  against a face grid in ABSOLUTE cell+axis keys (cross-frame seams weld),
  survivors stitched into rectangles; covered partials die; identical
  partial footprints (slope-to-slope, exact duplicates) drop BOTH copies;
  transparency asymmetry kept (opaque survives behind glass, glass dies).
  The wire buffer now follows the SURVIVING face outlines only. The heli
  drops 1716 → 521 tris; sealed cabins render clean. Pins: seam plane empty,
  duplicate→0 tris, stitch span 0.75 m, cross-frame weld, Euler-28 wall row,
  glass asymmetry (cull.test suite + re-pinned build pins).
- **SYM TWIN PROPAGATION (⇄) — landed** (legacy v0.160–v0.176 semantics,
  pure `engine/sym.ts` index + engine write-path integration): same-type
  components placed as a MIRROR MASK pair (x→1, y→2, z→4; on-plane axes are
  EQUAL; drift ⇒ no pair). The >5 cm alignment filter AUTO-DISABLES a broken
  pair and revives it on realign (pinned). Propagation rides EVERY write
  path: slider/gizmo moves ship the mask-flipped delta; rotations ship the
  MIRROR-TWIN MOTION md = det(S)·S·dq (normal spin PRESERVED — the red-axis
  wheel rule — tangential FLIPPED) applied ABSOLUTELY to twin bases at edit
  start, twins orbiting their OWN captured centres; joint angle/pos edits
  ship the SAME delta (equal angles ARE the symmetric motion — the captured
  axes carry the mirror). Twins CO-SELECT with their own golden boxes, the
  ⇄ button toggles the master switch (persisted, strikethrough when
  inactive), and the mirror-plane sheet renders at file x=0 when x-pairs
  exist (opt-mirror). Save rides each twin's own occ/type-255 deltas.
  Pin caught a real bug: the twin delta must touch ONLY the edited axis
  (a v-for-all-axes version dragged twin y/z along). Pins: sym.test (mask
  classification, auto-disable window, md sign rules per mask) + e2e
  sym.spec (UI slider → mirrored twin move, drift/disable/revive, XYQ twin
  doors UNISON to 34.3° + ⟲ restores BOTH hinges, mirror option
  round-trip). Gates: vitest 112/112, tsc clean, Playwright 34 pass /
  10 desktop-only skips; iGPU shot: twin aileron boxed + mirror sheet.
- **MASS & CoM + HI-DEF + WORKSHOP LINK — landed**: pure `engine/mass.ts`
  (manifest masses + fallback table, cellMass CALIBRATED so the computed
  total lands on the declared blueprint.mass, implied density as a
  plausibility readout, RAW-space CoM) + the orange marker in the engine
  (opt-com, live on every move) and the panel readout. Hi-def meshes toggle
  (opt-hidef, persisted): the FULL game meshes instead of the decimated
  twins, rebuilt through the load path. Workshop ↗ header link for real
  item ids (fixture ids excluded). Pins: mass.test (symmetric CoM,
  calibration total + floor, corpus ISW density sanity) + e2e (readout,
  marker toggle, hi-def rebuild still draws, wslink href).
  dashboards (buildDashboard: generated board/elements, RAW canvas text on
  the +z face since the v0.180 de-mirror) + the calibrated live readout LANDED with the P3/gizmo commits.
- **POWER-SURGE + LABELS — landed** (legacy v0.14x cable power-surge +
  v0.15x interactive labels): pure `surgePaths()` in pipes.ts — the network
  now records per-pipe view-space polylines + component links; the bolt
  walks AWAY from the picked socket (b-side hits reverse the polyline),
  degenerate <5 cm runs never surge. Engine `startSurges` fires on EVERY
  select(): one additive depthTest-OFF pulse per connected pipe (travel
  550–1600 ms along the EXACT drawn cable path, joint zigzag included), an
  orange SOURCE blip on the picked part and a cyan ARRIVAL blip on the far
  one (world-pinned matrixWorld copies; x-ray overlays excluded), with a
  CUMULATIVE arrival counter so pins never race the 620 ms flash window;
  the loop wakes only while an animation lives (perf rule). Floating
  labels: INTERACT type table + `components[].alias` (the player's text
  always wins, BLUE chip vs gold), canvas chips above the VISIBLE model's
  top (re-measured when the real model streams in), never parented under
  the mirrored part (negative-det sprites render mirrored text), never
  pick targets, OFF by default (opt-in `opt-labels` row, not persisted —
  legacy user rule). The suite also caught a REAL small-window bug: one
  extra view-options row crushed the component list to 8 px at 1280×720
  (rows rendered clipped, clicks intercepted) — the mass/options block now
  shrinks with its own scroll and the list keeps a 160 px minimum.
  Pins: pipes.surgePaths (walk both directions, exact reversal, cum==
  total, degenerate skip) + e2e `select.spec` (one pulse per connected
  pipe, additive+depthTest-off, arrivals == cable degree, deselect
  clears; label opt-in lifecycle through the real checkbox incl. the
  mobile drawer). Gates: vitest 135/135, tsc strict clean, Playwright
  46 pass / 18 desktop-only skips ×2 consecutive runs (config workers
  capped at 3 — the engine-heavy suite + lazy Editor chunk starved rAF at
  6 parallel on this box).
- **KSP-VAB REWORK — merged from the sibling session (fc6f4bd line)**:
  a second OpenCode worktree (`mighty-nebula`) developed THREE commits on
  the same base while the mobile/surge line ran on `main`: parts panel
  docked LEFT with CATALOG (icon tiles + mass, searchable, hold-a-part →
  click-a-surface placement via engine.pickPlacePoint + pure newComponent),
  StaticInfo mass/CoM black box bottom-left, camera-preset cluster
  bottom-right (engine.viewPreset fit/top/front/side), KSP skin (ksp-btn /
  ksp-win / ksp-label in index.css), and crafts.ts: blueprints download
  ONLY on open, streamed byte-progress "Receiving blueprint" overlay,
  IndexedDB cache (cached = zero network; File ▾ Refresh forces). The
  merge re-adapted it to main's structure: their App-inline Editor moved
  into the LAZY Editor.tsx chunk (gallery still ships no three.js), the
  mobile drawer backdrop + ✕ re-landed on the LEFT aside, TopBar keeps
  their KSP skin with the mode bar wrapping to row two on phones, and the
  Panel shell takes their Parts-first order with my min-height guard.
  Both lines independently invented E2E_PORT (port-collision protection) —
  theirs kept, plus the workers:3 cap. Gates: vitest 142/142 (their
  crafts.test included), tsc strict clean, Playwright 58 pass / 18
  desktop-only skips (their download/place specs + the surge/label/mobile
  pins green together).
- **UX REWORK (user feedback round) — landed**:
  ① EDIT TWEAKING: Row fields gained BLENDER-STYLE LABEL SCRUB (drag the
  label horizontally: position 1 cm/px, rotation 0.1° step + 0.25°/px —
  the ±2 m slider over 150 px was 2.6 cm per pixel, untweakable; Shift =
  5× coarse; value snaps to the row step; pin: 40 px ≈ 0.4 m, ⟲ restores).
  ② VIEW OPTIONS moved OUT of the left parts panel into their own ⚙
  popover window over the viewport (toggle-options; the left panel is now
  ONLY Parts + context). ③ WIRE MODE = a dedicated WIDE BOTTOM DOCK
  (38% of the viewport, 3-column workspace: census/auto-wire | manual
  pairing | warnings) while the parts panel + inspector stay live;
  manual wiring is TWO-STEP — pick the source port, then a compatible
  COMPONENT, then explicitly one of ITS free ports (wire-target-port).
  ④ HOVER PREVIEW: mousing over the candidate or warnings lists glows
  that part with a SECOND accent-colored Highlight instance beside the
  selection (never replacing it — leaving restores exactly what you were
  editing); engine.previewHover + hoverActive hook. Pins: scrub drag,
  wire-dock height, hover>=0 on item hover → -1 on leave, two-step
  connect; panels/select/sym specs follow the ⚙ popover. Gates: tsc
  clean, vitest 142, Playwright 59 pass / 19 desktop-only skips.
  Remaining gaps (next): hull element list, P4 perf (BatchedMesh/?perf/
  wasm), force coefficients (lift curve + stall + AoA) on the wind field.
- **⇄ MIRRORED PLACEMENT — landed** (the user: "allow placing blocks with
  mirror too"): a persisted twin switch (⇄ twin ON, `archean-app-plsym`)
  beside the place/select tools in BLOCKS mode drives BOTH placement paths.
  Blocks: pure `engine/blocks.ts` `mirrorBlockCell` mirrors the footprint
  about the SAME plane ⇄ uses (FILE world x = 0 = cell 5.5) and the derived
  `MIRROR_TYPE` table maps every shape to its x-mirrored type — computed at
  module load from blockshapes' own vertex clouds (x → 1−x), so it can never
  drift from the shape table; involutive + closed on 0..52, pinned, plus a
  cell-plane/involution/twin-builder pin set (blocks.test 4). Catalog parts:
  the twin COMPONENT lands at the x-flipped position with the same
  orientation — the exact geometry sym.ts indexes (mask bit 1), so the fresh
  pair co-selects and every later edit propagates through the established
  twin path (no new write machinery). e2e mirror.spec (both projects): one
  click = block + twin at the mirrored cell; held part + twin at the
  mirrored position; ramp visual shot shows the mirrored orientation.
- **WIND TUNNEL (aero) — landed** (replaces the bogus legacy thin-plate
  "aero plates" model per the user; STREAMLINES FIRST as asked): the OFFICIAL
  game model is the SHAPE FIELD (wiki.archean.space §Aerodynamics — fully
  transcribed into FORMAT.md §Aerodynamics): an outer-shell cross-section
  scan where each surface patch knows the SOLID DEPTH behind it; fineness
  along the flow = streamlining ("a tenth of the form drag of a blunt one"),
  sealed cavities count solid, cost bounded by size-scaled resolution.
  Pure `engine/aero.ts` implements exactly that on the collider voxel lattice
  (blocks + nested-subgrid blocks + occupancies): per flow-parallel solid
  run → blockageOf(run) form-blockage + wake deficit (potential flow cannot
  separate — the wake enters from the wiki's own fineness law). The flow
  solve is REAL: incompressible porous-mask potential flow v = κ(U+∇φ),
  face flux σ_f(δ+Δφ) with the ∇κ·U source (uniform air telescopes to φ≡0
  EXACTLY), geometric multigrid (FMV-cycle, red-black GS, full weighting =
  prolong transpose), travel-aligned domain (any of the 6 wind directions,
  voxel auto-scales to a bounded budget). Streamlines: RK2 through the face
  flux field, forward + short backward legs, DIE in the opaque shell,
  DEVIATION colour map (additive: fast warm glow, slow/stagnation blue,
  freestream in a deadband fades out). scanAnalysis: frontal area,
  fineness-weighted form drag %, THIN cross-section (wiki wing criterion)
  lift-area readout — forces (lift curve/stall/AoA) are the next step on
  the SAME field. Engine: `setWindTunnel(on, flowFile)` + the solve pumped
  3 V-cycles every other frame INSIDE the on-demand loop (ISW converges in
  ~13 V-cycles; progressive preview lines from iter 6), `windState()` for
  UI/e2e, rebuilt on every load while active. UI: a sixth MODE tile
  ⌥/≋/WIND + WindPanel (six flow-direction buttons, live solve status,
  shape-field analysis) + `?aero=1` deep link. Pins: aero.test 10 (run
  laws, wake shadow, travel-map exactness, uniform-field identity, plane
  FLUX CONSERVATION on ISW, no-penetration, stagnation-vs-shoulder,
  streamline colours/wake, wing-vs-bluff scan) + e2e aero.spec (mode solve
  → converged, lines>20, retarget, teardown); gates vitest 152, tsc clean,
  iGPU shots ISW + dolphin.
- **P4 — perf (PARTIAL, v1.11.2)**: benchmark harness LANDED
  (`load.perf.test.ts` — the ?perf port for the pure loops, run in CI via
  vitest with anti-regression tripwires); the per-rev loops indexed
  (twin census 91×) and debounced (LiftWidget envelope); **WASM benchmark
  of the candidates DONE with verdicts** (PERF.md §WASM verdict, REWRITE
  §WASM candidates) and the SEALED-ENVELOPE module landed (candidate 3
  promoted — it became the per-rev loop in v1.11). OPEN: BatchedMesh
  proxies (the giant's 12 k-draw cliff — a scene.ts render-graph change),
  optional WebGPU flag.
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

## v1.11.2 code analysis (perf & structure pass — findings + standing plan)

**Measured per-rev / load loops** (numbers + verdicts in PERF.md): sealed
envelope (WASM'd + debounced), twin census (indexed), cull (JS-diet, AS
deferred), wind solve (typed-array multigrid — no WASM), twinSweep cap
lifted. Everything else on the per-frame path already early-exits idle
(v1.9.2 audit).

**Structure — the split plan (deferred deliberately):** `engine/scene.ts`
is 5.7 k lines — the last monolith (the legacy view3d.js pattern). Its
cohesive seams, each with a natural pure/impure cut and existing test
coverage that survives a move: (a) gizmo + mode-widget + ring math
(ringScreenPoint, gestures), (b) placement/pick routing (pickNdc/pickCell/
pinGroup), (c) live-edit + doc mirroring (liveDataEdit/flushLiveEdits),
(d) overlays (x-ray, twin-warn, coord readout, grid sync). Every split is
mechanical (module-scope extraction + Engine fields passed as a context
bag) — the risk is not the code, it is the e2e hook surface
(`window.__ARCHEAN__`) re-wiring; schedule it as its own session with the
full suite as the gate, not inside a perf pass. `Editor.tsx` (1.8 k) and
`ModePanels.tsx` (1.3 k) are the next-largest; both are component-local
(React state pins cover them), lower urgency.
**Deliberately NOT done this pass:** massReport caching (reads are O(n)
sweeps over ≤ 2.5 k entities, sub-ms at every observed call site), the
scene.ts split (above), BatchedMesh (open P4, unchanged scope).

## P7 — Test-pyramid migration (planned 2026-10-26, from the v1.11.8 session)

> **v1.12.1: this plan became the executable ladder with the retirement map
> and the pyramid laws L1–L5 — see docs/TEST-PYRAMID.md (Phase 0 = the
> pixel7 matrix sparsify, LANDED). P7.1/P7.2/P7.3a below stay the technical
> detail for Phases 1/2/4.**

we asked: "why test the viewer? Are we not constructing geometry and locations
in 3D? Can we not test that?" — yes, and the honest boundary is a COUPLING,
not a necessity: ~660 vitest tests already pin every geometry/location LAW on
plain node (rigchain, sockets, pipes, blocks, tris, cull, mass, sym, doc),
but the scene-graph APPLICATION (composing THREE objects + raycast picking)
lives inside `scene.ts`'s `Engine`, whose constructor creates a
`WebGLRenderer`/canvas/DOM listeners — so it can't be imported headless, and
every geometry assertion about the GRAPH (world boxes, pick hits, occlusion
cuts) is trapped in a browser. The wire:279 flake is the tax: a sound raycast
census welded to mouse plumbing, 40 Hz throttles, dwell timers and React
layout timing (the truck's 750-row dock shifting the canvas rect mid-test).

Goal: the graph is a pure function of the blueprint; the renderer is a shell.

- **P7.1 `SceneGraph` split (the enabler).** Extract from `Engine` a module
  that maps data → THREE graph with NO renderer/DOM: the builders
  (`buildSolids`/`buildCompProxies`/`buildReal`/`buildPipesMesh`/
  `buildSubgrids` rig nesting), the transform stack (moff, joint poses,
  rig chains) and the pick/census math (ray setup, `pipePickAt`,
  `xrayCutsFor`, `blockPick`, `pickCell` geometry). THREE's math/objects run
  on plain node (Group/Matrix4/Box3/Raycaster need no GL). `Engine` keeps
  renderer + camera + controls + events and DELEGATES construction. Pin
  headless: world AABBs for the audit crafts (the gearpair numbers become
  node tests — dev-side of the pair stays a browser capture), pick hits,
  census cuts. This retires the browser for every "does it render in the
  right place" class.
- **P7.2 Interaction clocks out of React.** `Viewport.tsx` owns the wire
  hover state machine (40 Hz throttle + trailing edge, 120 ms chip dwell,
  2 s X-ray dwell, arming, restore) and the coord/ghost throttles. Extract
  pure timestamp-driven clocks (`move(x,y,now)`, `leave(now)`, `tick(now)`
  with injected pick) — the Viewport forwards events only. Vitest pins the
  dwell/restore contracts (v1.11.7's "highlight starts immediately" etc.)
  with a synthetic clock; e2e keeps ONE thin "pointermove reaches the seam"
  test.
- **P7.3 Spec re-tiers.** Geometry specs (subride/substats/occupancy/
  plateprobe-style boxes) move to P7.1 headless tests; wire.spec's census
  assertions become node raycasts; the e2e tier keeps pixels (daylight rig,
  palette renders), input plumbing and dev-pair audits. Sparsify the
  AGENTS-acknowledged overlap (pipes.spec + wire.spec hover-pick test the
  SAME seam — keep the node one). Target: fast tier ≤ ~3 min today's CPU
  (9.9m), failures named with their seam in seconds.
- **P7.4 Device harness for the phone pins.** `staticInfo`, modebox dock
  positions, gizmo size are pure functions of (mode, viewport w/h, dpr) —
  extract + vitest; e2e keeps one pixel7 boot smoke per suite.

Gate for each phase: the extracted test reproduces the CURRENT green values
before any behaviour move; the removed e2e coverage must exist at the lower
tier first (no coverage holes, only migrations).

### P7.3a — the x-ray fixture spec — ✅ LANDED v1.12.1

`app/e2e/wire-xray.spec.ts` runs the pin list on 9000007001 (census shape, the
BLOCKED episode with the ≥2 cursor-surges and full restore, the ONE-WAY
input flow, the dock/Beacon negatives); the truck legs (BLOCKED, ONE-WAY,
and the fused truck chain) are RETIRED from `app/e2e/wire.spec.ts` with
notes. Truck DATA laws live headless (scene.headless.test.ts).



`tools/make_xray_test.py` → `testdata/9000007001` ("xray-test", 73 blocks,
9 comps, 4 pipes, boot 0.6 s) replaces the two truck wire specs
(`wire.spec.ts` 'BLOCKED truck cable' + 'ONE-WAY input pulses' — now
@slow-tagged stopgaps; RETIRE them when this spec lands). The fixture is
probe-validated (engine seams, live page):

| pipe | topology                                    | cuts | flowDir | role in the spec |
|------|---------------------------------------------|------|---------|------------------|
| 0    | FJ out.001 ↔ FJ out.002, BEHIND the wall    | 8    | both    | POSITIVE: census pick (max cuts) → episode cuts>0, ≥2 cursor-surges (undirected + interior anchor), full restore |
| 1    | Battery → LVJ lowvoltage-INPUT, behind wall | 6    | ab      | POSITIVE: one-way pulses (v1.11.7 law) |
| 2    | FJ out.001 → FJ fluid-IN, x-clear, floating | 1    | ab      | NEGATIVE: census ranking (never picked while 0 exists); directed ⇒ single pulse |
| 3    | Battery → LVJ port.002 (hub DOWNSTREAM)     | 5    | both    | NEGATIVE: broken-claim pairing lists as claimed, flow degrades sanely |

Fixture negatives beyond pipes: the UNWIRED Beacon (comp 8): port census 0,
hover yields NO cable (probe: null), dock shows exactly 4 rows.

Spec pins to write (`app/e2e/wire-xray.spec.ts`, @ui, desktop only, budget
≤ 30 s total):
1. boot census determinism: cuts === [8,6,1,5], flowDirs ===
   ['both','ab','ab','both'], dock rows 4 (the fixture IS the fixture —
   pin its geometry so a future file edit can't silently move a law).
2. BLOCKED law on pipe 0 (hover mid → dwell → `wireXrayActive().cuts>0`,
   surge peak ≥ 2, un-hover restore {on:false,cuts:0,overlays:0}).
3. ONE-WAY law on pipe 1 (pulse count/dir exactly 'ab' semantics as the
   truck spec asserts today).
4. Negative paths: hover pipe 2 → one-way (never both); pipe 3 claimed &
   listed; beacon pixel → `pipeHoverState()` null; `wire-port` census for
   the beacon = 0 rows.
Then delete both @slow truck specs, and the wire suite drops from ~10 min
to seconds.

## P8 — The Xenon workspace as a standalone module (DIRECTION recorded 2026-10-28, shape open)

We: "I am starting to think that the debugging/computer/screenview thing
should be a modular and standalone app that integrates with a lower coupling
than it does right now." Recorded as the direction for the next structural
pass on this family; P3 (project tree) and P4 (upstream PRs) land INSIDE
the module boundary this section draws. Not scheduled — the rule until then:
**no new cross-import from the core editor into Xenon internals** (new
surface goes through the contract below).

**The family** (today's `app/src` spread): `engine/xenoncode.ts` (extraction,
XenonRun, XenonWorkerRun + `xenonworker.ts`, XenonPump singleton,
`stepperLaw`), `engine/worldsim.ts`, `engine/buzzer.ts`,
`components/XenonDialog.tsx` (IDE + debugger + Auto-test),
`components/ScreensDock.tsx` (+ PilotTouchPad, zoom windows),
`components/AutosavesDialog.tsx` (File ▸ autosaves is Xenon-coupled), the
pilot-key plumbing, the `__XENON__`/`__XENONTEST__` debug doors, and the
`tools/xenoncode` build chain + `src/engine/xenoncode/` assets.

**Current coupling inventory** (what a lower-coupling boundary must absorb):
1. **Blueprint write path** — the IDE saves programs through the core edit
   funnel (`edit.ts setXcFileCode/insertXcFile/removeXcFile`, bp + doc,
   v1.13.16-style doc-mirror law). KEEP as a callback: the module must not
   own a doc writer; the core supplies `saveXcFile(ci, file, code)`.
2. **3-D screens** — `scene.ts buildDashboard` DataTexture faces +
   `Engine.setScreenFeeds`/`screenFeedKeys` + the BUILTIN_SCREEN_TYPES UV
   law; the pump pushes pixels by key. Replace with a tiny PORT interface
   the core implements (`registerScreenFeed(key, onFrame)` +
   `feedKeysChanged(keys)`), module-side opaque.
3. **Shell gates** — TopBar `xenonComps` menu (calls `xenonComputers(bp)`),
   Editor `hasScreens`, `?dash=` deep links, the `?craft=` open funnel.
   Contract: the core passes a `computers` DESCRIPTOR list + a deep-link
   param object; it must stop importing engine/xenoncode itself.
4. **Keyboard** — pilot keys ride the window key events and `pilotKeysActive()`
   gates the core g/o/h/w/5 shortcut map. Contract: a key-bus with
   claim/release (the module claims WASD/arrows/F/E/Q/I/K/J/L/R/digits while
   a dash view is live; the core asks the bus, not the module).
5. **Audio + stores** — `buzzerAudio` (WebAudio, TopBar toggle, Editor-boot
   `arm()`), `localStorage` keys (`archean-worldsim`,
   `archean-xenon-buzzer-sound`, `archean-app-screens-tight`) — all move
   fully inside the module; the core only mounts it.
6. **Pump lifecycle** — today the pump boots on IDE open (and the
   StrictMode double-open race, v1.13.18, lived exactly at this seam).
   Module-owned: single `mountXenonWorkspace(host, contract)` /
   `unmount()` with the pump + worker + SAB inside.

**Shape options (open; same repo either way)**: (a) a vite route/bundle
split (`/xenon` as its own entry, core = host shell, postMessage-ish
contract), (b) a Web Component host slot the editor mounts, (c) a fully
separate small app consuming the blueprint via the download/open API (the
standalone POC at `tools/xenoncode/index.html` is the precedent — it
already boots the identical glue+wasm with ZERO app imports). The ABI
(`XC_ABI`) + the SAB protocol + `stepperLaw` ⇄ EM_JS pairing already give
the module a versioned internal contract; the remaining work is the four
seams (write-path, screen-feed, key-bus, shell-descriptors) above.

**Why it pays**: the family is the app's only wasm+worker+audio+keyboard
grabber; isolating it bounds the flake surface (the v1.13.17/v1.13.18
incidents were all AT this seam), lets the workspace boot standalone for
dev/e2e (seconds, no scene), and keeps the core editor's bundle free of
the 76 kB glue + 1.0 MB wasm assets (`?url` imports today sit in the
Editor chunk graph).

**SLICES A+B+D LANDED (v1.14.0 + v1.14.1, 2026-10-29): slice A = the
beaconNet registry + BEACONS tabs + 📡 dock + HUD-block IDE + avatarsim.
Slice B (v1.14.1) = the HUD VM runtime: the ABI-11 shim (`xc_host.cpp`:
`panel(anchor,w,h)` → anchored "panel#N" surfaces with the full screen
member set, `beacon($tx,$rx):beacon` object (.data/.tx/.rx/.transmit)
with beaconpair/beacontx events, `get(key)` fed by xc_set_world,
screen_w/mouse_*/fov values, xc_beacon_put/xc_set_input_t/xc_set_view/
xc_screen_anchor exports; demo+native probe `tools/xenoncode/demo/
hudradio` via XC_BEACON_PUT), `engine/hudpump.ts` (25 Hz loop: avatarsim
feed → setWorld, viewport → setView, deliveries → beaconPut, events →
registerPair/post, panel# surfaces → live canvases with clicks routed
in), the HudDialog ▶/⏹ + PANELS tab. Slice D = Beacon components as io
devices: output_text on the port posts to beaconNet, deliveries feed
ch0 (input_text(port,0)) every cycle, worker inputs carry text +
beaconPut messages. THE ONE-INTERPRETER GUARD: `engine/runtimemgr.ts`
— a HUD boot closes the computer pump and vice versa (XenonPump.open/
close claim/release); THE FARM (slice C, REMAINING) replaces the mutual
kill with co-owners over a shared per-craft IoBus — the beaconNet
pending-queues are the transport prototype.**

## P9 — Multi-computer sim + HUD/beacon radio (planned 2026-10-29; unlocks ChipOS testing)

**SLICE A LANDED v1.14.0 (2026-10-29): the beaconNet registry (engine/
beaconnet.ts — frequencies, participants seeded from Beacon components +
every beacon() literal, exact-match routing, per-save log survival), the
BEACONS side tab in the computer AND HUD IDEs, the 📡 Beacon dock
(XenonCode menu), the HUD-block IDE (HudDialog — edits data.xc_files
through the '' -container doc funnels; pins in xcfiles.test), and the
AVATARSIM sensor rows (avatar_sensor_* worldsim channels). REMAINING:
slice B = the HUD VM runtime (HUD builtin set on the device shim:
panel()/draw_*/text*/beacon()/get → the xc_host twin + canvas renderer);
slice C = ComputerFarm + shared IoBus; slice D = Beacon-as-io-device.
Below is the original plan; the registry semantics in (3) shipped as
described.**

We (2026-10-29): "we need to have the capacity to have multiple systems
communicating with each other, vis-a-vis multiple computers running at the
same time, and then they should be able to communicate over their
inputs/outputs, this will be vital to test Chip's ChipOS in the future,
which hinges on inter-computer operability" + the HUD/beacon research
(FORMAT §HUD & the Beacon radio).

**Today's limits:** `xenonPump` is a module SINGLETON (`xenoncode.ts:2086`) —
one computer boots; the IDE opens it per `comp.ci`. The io bus is pump-local
(device shim + worldsim overrides). HudController data is untouched by the
sim; the Beacon component is not an io DEVICE at all.

**Shape (lands inside the P8 module, per the four-seam contract):**
1. `ComputerFarm` — a registry keyed by `comp.ci` of `XenonPump`s
   (one per MiniComputer), booted from a per-craft toggle (▶ in a new
   COMPUTERS side tab lists every MiniComputer: boot/kill/boot-all).
   Each pump keeps its own IDE dialog (already per-`comp.ci` DOM).
   Budget guard: the farm shares the 25 Hz CADENCE — one rAF driver
   advances all pumps per tick; N computers ⇒ N× VM cost (cap + warn).
2. **SHARED io bus per craft** — `IoBus{portWriters: Map<alias, per
   pump>, channels}`: `output_number/text(port, ch, v)` from pump A
   lands on the bus; pump B's `input_number(port, ch)` READS the
   device's bus state (device state is per-DEVICE, not per-computer —
   the game law: ports index the craft's device table; two computers
   wired to the same Beacon see the same channels); `input.N` entry
   points fire on every pump whose device table includes the writer.
   The device shim moves from pump-scoped to bus-scoped (XenonRun +
   xc_host.cpp twin — THE STEP LAW discipline applies: two places).
3. **Beacon as a device** — Beacon components join the device table
   (alias, channels: ch0 text = received payload / transmit payload
   path per FORMAT §HUD). In-sim radio = a channel-name registry in
   the bus: writing a beacon's transmitData ENQUEUES the text on its
   `transmitFrequency`; every beacon whose `receiveFrequency` matches
   gets the payload for its next read (loopback included — same-craft
   beacons hear each other, as in the RCS500↔HUD demo).
4. **HUD workspace (later slice)** — HudController's `xc_files` get the
   IDE editor; the HUD program runs against a DOM canvas panel
   implementing the .so API list (panel/draw_*/text*/screen_copy/
   set_resolution_scale + the `beacon()` pair against the bus). The
   HUD canvas docks like a Screens surface; `click` entry points fire
   from real pointer events (the ScreensCell rig is the base).
   ChipOS playtest = boot a computer + a HUD, watch both directions.
   SOURCES (v1.13.33 addendum, FORMAT §Player-installed HUDs): BOTH the
   craft's HudController component AND a plain "installed HUD" `.xc`
   (the `client/hud/<name>/main.xc` shape — the user's "homo" HUD) run
   in the workspace; avatar-sensor feeds (`get("avatar_sensor_*")`)
   come from worldsim; the omfg PRESSURE→flight-power relay proves
   HUD→craft commands are a control path the bus must route.
5. Pins: farm boot/kill (node tier via __XCDBG__-style seam), bus
   cross-talk vitest (two XenonRuns, one IoBus — the pure shim
   interleaves), beacon loopback node pin (RCS500 protocol as the
   fixture: write the dot-kv text, hear it on the paired frequency),
   e2e: two IDE windows live at once + the HUD canvas paints pixels.

Order: (1)+(2) FIRST (ChipOS-critical, no new UI surface), (3) with the
device-table change, (4) rides P8's shell-descriptor seam.

## Non-negotiables carried over
- AGENTS § Blueprint folder (paths via tools/config.py — the vite plugin
  reads it; no hardcoded paths in `app/` either).
- Byte-identical serialize; occupancy/type-255 mirror sync; ONE raw
  quaternion law (v1.5.11 — the earlier Unity-LH conjugate + LEGACY_Q split
  was re-arbitrated away; the generation stamp keys palette resolution
  only); integer grid keys; on-demand rendering;
  merged static geometry; iGPU-pinned headless runs (never contend the
  NVIDIA GPU); release cuts only on explicit user say-so.
