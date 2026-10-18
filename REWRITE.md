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
- **P2 — DONE (P2a–P2c + heavy tier)**: `engine/build.ts` (pure,
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
    the origin, view-z flips sign); ONE Group per Build with nested solids
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
  dashboards (buildDashboard: generated board/elements, PRE-MIRRORED canvas
  text) + the calibrated live readout LANDED with the P3/gizmo commits.
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
