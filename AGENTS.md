# AGENTS.md — development guide

This repo reverse-engineers the **Archean** game's `blueprint.json` format and
provides a zero-build browser viewer/inspector. Everything is static: plain ES
modules + Three.js from CDN. No bundler, no npm.

## Layout
```
viewer/index.html + view3d.js   the inspector (Three.js, one file, ~1400 lines)
viewer/hullfit.js               exact hull-lattice mapping (pure function, no THREE)
viewer/blockshapes.js           block shape+orientation table (type -> geometry/faces)
viewer/palette.js               the game's built-in 256-slot palette + slot resolution
viewer/models/                  real game component models: manifest.json (mass,
                                renderable node tree, joints, adapters, colliders
                                per type) + <Type>.json geometry, lazy-loaded
regtest/regtest.html            format-validation suite over testdata/ (importable)
testdata/<workshop-id>/blueprint.json   regression corpus (25 craft + 9000000001
                                orient fixture, 1 kB..530 kB)
tools/adjust_seat.py            reference example of a safe format edit
tools/make_orient_test.py       regenerates the chirality probe craft 9000000001
tools/make_landing.py         regenerates the landing gallery + viewer/workshop.json
tools/add_workshop.py <id>      ingest a locally-subscribed workshop craft
                                (names: tools/ws-names.tsv, fetched slowly — Steam rate-limits)
tools/extract_models.py         regenerates viewer/models/ from an installed game
tools/perfprobe.py URL [s]      real-clock headless perf probe (DevTools ws;
                                ?perf titles under --virtual-time-budget are
                                meaningless — clocks/rAF freeze there)
tests/run_tests.sh              headless-Chromium test runner (selftest+regtest+renders)
FORMAT.md                       format documentation (start here)
PERF.md                         measured perf baseline + harmful-candidate catalogue
                                (run perfprobe before touching render/flow hot paths)
NOTICE.md                       licensing: GPL code, game content belongs to batcholi/FloDKSM
```

## Commands
```bash
tests/run_tests.sh                      # full headless suite (python3 + chromium)
python3 -m http.server 8650             # manual serving (repo root)
# viewer:   http://127.0.0.1:8650/viewer/index.html
# selftest: http://127.0.0.1:8650/viewer/index.html?selftest  (tab title: SELFTEST PASS)
# gizmatest: viewer/index.html?gizmatest (GIZMATEST PASS n=15; &shot=1|2|3 = WYSIWYG screenshot states)
# regtest:  http://127.0.0.1:8650/regtest/regtest.html         (page ends 'REGTEST: PASS')
# other craft: viewer/index.html?open=../testdata/<id>/blueprint.json
# perf probe: viewer/index.html?perf → tab title: PERF fps=… draw=<draw-calls> …
#   (live browsers only; headless: python3 tools/perfprobe.py <url> 12)
python3 tools/extract_models.py <Archean-game-dir> -o viewer/models
```
Headless render shots — use the **AMD iGPU** (~1 s/shot, full budgets):
```bash
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json \
chromium --headless=new --no-sandbox --disable-dev-shm-usage \
  --use-gl=angle --use-angle=vulkan --window-size=1400,900 \
  --virtual-time-budget=15000 --screenshot=out.png <url>   # --dump-dom for titles
```
VK_ICD_FILENAMES hides the NVIDIA ICD from chromium entirely — the discrete
GPU usually runs the user's AI models and MUST NOT be contended (quick check:
`nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv`; if busy,
keep the iGPU pin). tests/run_tests.sh does this by default (whole suite ~6 s).
GPU=0 = SwiftShader CPU fallback: every virtual frame costs 13-300 ms wall,
screenshots at virtual budgets ≥10 s never complete (wall-time cliff) — keep
budgets ≤8000 in that mode.
NOTE: to kill a dev server, use `pkill -f "[h]ttp.server 8650"` — plain
`pkill -f "http.server 8650"` also matches (kills) the calling shell.

## Publishing (GitHub Pages)
The live site is the repo root served by GitHub Pages:
`https://joeppie.github.io/archean-blueprint-tools/viewer/index.html`.
`git push origin main` is all it takes — Pages rebuilds automatically (the build is an Actions job: during GitHub Actions runner incidents
typically queues "waiting for a hosted runner" — check githubstatus.com before suspecting the push)
(README viewer link is versioned; bump `v0.xx` in index.html title/header,
landing page and README together when the viewer changes).

## Sources of truth (all offline — do NOT web-fetch to answer format questions)
- **FORMAT.md is the knowledge base.** Everything reverse-engineered lives
  there (grid maths, block culling rules, hull triangle exact lattice, linear
  colour/PBR semantics, palette defaults, gltf material factors, conditional
  wheel parts, .ini placement rules). Read it before investigating anything.
- Game assets on disk: `~/.local/share/Steam/steamapps/common/Archean/Archean-game/modules/<module>/components/<Type>/<Type>.{gltf,ini}`
  = ground truth for models/materials/node trees (read the `.gltf` materials +
  `.ini` directly; regenerate `viewer/models/` after extractor changes).
- The dev's own viewer (https://viewer.xenontools.dev/, js modules under /js/)
  is the reference implementation for genuinely NEW format questions. When
  used, transcribe the finding into FORMAT.md + code comments in the SAME
  commit so the knowledge stays offline (see FORMAT.md § Local sources of
  truth, and NOTICE.md §2 for its GPL-adjacent porting terms).

## Format facts (verified — do not re-derive)
- 1 grid cell = 0.25 m; `pos_*` ∈ 0..12; `frame_*` in 3 m units;
  `world = (pos − 5.5)·0.25 + frame·3.0`. −z is the nose (this craft).
- **Unity left-handed orientation:** `orientation` is a left-handed quaternion; a
  right-handed renderer must use the conjugate `{w,−x,−y,−z}` (raw `q` mirrors the
  game — beacons lean the wrong way, casters pitch the wrong way, wheels go inboard).
  Verified: `position + R(q*)·adapter_local` reproduces the game-written `data.pipes`
  endpoints to 0.000 m (raw `q` is 0.18-0.66 m off). Viewer converts to a z-mirrored
  view space `pos (x,y,−z)`, `quat (w,x,y,−z)`; all data/reports stay raw. See
  FORMAT.md § Handedness.
- **Rotation storage has TWO conventions keyed on `data.colors` (v108):**
  palette-less legacy files (2024-25 corpus, 23 of them) store the Unity LH
  quaternion **RAW** — the game places with `R(q)` (proof: mosaic craft
  3334698274's dashboard murals are flush only under raw: |dot| 0.999,
  conj = 45° out of the wall; selftest `mural=true`); palette-bearing 2026
  files store the **conjugate** (ISW pipes 0.000 m under `R(q*)`). Viewer:
  `LEGACY_Q` (set in `setModel`) switches `viewQuat`/`rawFromView` between
  `(w,−x,−y,z)` (legacy) and `(w,x,y,−z)` (modern). This also explains the
  dev viewer: raw placement is exact for legacy craft ("renders the mosaic
  perfectly") and 45°-tilted for 2026 ones. See FORMAT.md § Handedness.
- Blocks: `type` = shape+orientation (0 cube, 1-12 slope [4 = thin tilted
  rod], 13-20 corner, 21-44 pyramid, 45-52 inverse corner — table in
  `viewer/blockshapes.js`, transcribed from the game's BlockShapes.hh via the
  dev's XenonViewer); `colors[7]` = palette slot per face (face order in
  blockshapes.js). Interior-wall culling (ported from XenonViewer): full faces
  cut cell-by-cell against a full-face grid in absolute cell coords, surviving
  cells stitched back into rectangles; partial/slant faces die when fully
  cell-covered, and two blocks presenting the SAME partial-face footprint
  (slope glued to slope) form an interior partition — both copies drop.
  Subgrids: `Build` components carry nested blueprint data
  (hatches/doors), stored CLOSED at grid coords.
- Components' `occupancies` are mirrored by type-255 entries in `data.blocks`.
  **Any save must keep them in sync** (round(delta/0.25) cells, both places).
- Save format must serialize byte-identical to the game's JS:
  `json.dumps(..., separators=(',',':'), ensure_ascii=False)` — no spaces,
  key order preserved, no reformatting.
- `components[].colors` may be a dict (`color1`/`color2`) in v2 files — handle both.
- Hull triangles: vertices live on the SAME lattice as blocks —
  `world_ax = (v_ax + W·frame_ax)·pitch_ax + C_ax` with **W=12, pitch=0.25,
  C=−1.5** exactly (v are cell-slot integers, cross-frame weld pairs sit
  Δv = 12). The old per-file pitch fit (≈0.23-0.29) was an approximation that
  left the skin 3-15 % off the block hull — do not reintroduce it. Shared
  slots = welded points; winding order flips the normal. The game renders
  each triangle as a closed 0.05 m prism: colours[0] front, colours[1] back,
  colours[2..4] the side walls along edges v0-v1, v1-v2, v2-v0 (all five
  colours matter; ISW-241 uses slots 0, 4, 51 = hull, glass, chrome).
- `pipes` segments: `dir` 0..5 = +x,+y,+z,−x,−y,−z; the first/last segment ends
  are world-space connector positions (trace pipes to place ports). Pipes are
  NOT straight chains — every segment anchors at its OWN `start` (joints have
  0.04-0.14 m offsets; accumulating dir*len drifts tubes off the cables).
  Endpoints ARE the connection points: the game writes cable tips at the
  part's VISIBLE socket, which can differ from the `.ini` [ADAPTER] position
  (battery socket on the front face; adapters = bottom terminal grid). Draw
  paths exactly as recorded — adapter-snapping endpoints + taper-shifting
  paths is the v0.99 regression (broken lines, nubs off the model): do not
  reintroduce. Cable-free adapter nubs >0.5 m from the part origin are
  build-time flanges (SolarPanel's spare ports sit 1.0 m below the pivot =
  "red & blue spheres on the ground under the panel") — skip them.
  FluidJunction cables are cached in the builder's FLAT frame (outlets up,
  row along fuselage) — the junction's display pose matches that frame
  (mirror-conjugate file quat), which is why the comb lies flat along its
  pipes. See FORMAT.md.
- `components[].type === 'Build'` = editor construction-site ghost, far outside
  the bbox — never render it as geometry.
- **Subgrids** (v0.153, join decoded v0.154): Build components carrying nested
  blueprints (doors/hatches) live as ONE Group per Build (`userData.sub`);
  their attach transform is the Build component's own `position`/`orientation`
  (dev-viewer composes nested content under the Build matrix; dolphin doors
  ride real pivots 0/126/180° = saved mid-swing). The Mount is DECODED, not
  guessed: `composite_builds[].slaveBuildId` = the Build's index in the
  FLATTENED component array (nested content numbers BEFORE its Build,
  recursive subtree sizes — dev readBuild order); exact for 342/342 corpus
  entries. Masters are any part type (hinges/pivots kinematic, dashboards/
  RTGs/batteries static hosts, metres away); joint state lives on the MASTER
  (`angle` DEGREES / `pos` metres). Pins: selftest `subjoin`, dolphin/XYQ
  postest sub-master fixtures. See FORMAT.md §Subgrids.
- Palette slots: `data.colors[256]`, entry = {r,g,b 0-255, opacity 0-15,
  roughness 0-7, metallic 0|1}. **r/g/b are LINEAR albedo** — the engine's
  shaders use them raw; decoding as sRGB darkens the craft ~^2.2 (the ISW-241
  navy read as black). `opacity < 15` ⇒ transparent, alpha = (opacity+1)/16
  (`opacity < 8` = glass). The engine re-imposes slots 0..10 over the file.
  Metal is shaded as metallic·(1 − roughness/7): the game's tracer lights all
  roughness>0 surfaces diffusely, so metalness=1 would wrongly darken painted
  parts (color1's default is metallic 0, roughness 0). See `viewer/palette.js`.
- **v1 files (23 of the 24 corpus!) carry NO `data.colors` at all**: block
  slots and v1 `components[].colors` (a `[slot,slot]` **index pair**, not a
  dict) reference the built-in legacy palette — four 17-colour finish
  families: matte 40..56, polished 84..100, metal 128..144, glass 172..188
  (full table in `viewer/palette.js`, ported from the dev viewer, NOTICE §2).
  **v1 family bases are 4 slots below these v2 bases** (polished 80..96, metal
  120..136, glass 160..176) — the v2 built-in table leaves those v1 indices in
  the empty gaps = the purple blocks (26/61 files). `legacySlot()` remaps
  +4/+8/+12 for palette-less (v1) files only. An all-purple craft = missing
  built-in groups (magenta = missing-slot marker), not a broken file. See FORMAT.md.
- **Dashboard geometry is GENERATED from `data` (glTF = editor template):**
  board = box origin→(size_x/100, size_y/100, 0.01) — CENTIMETRES, corner
  pivot, plane X·Y normal +z; elements at pos/100 z 0.01..0.02; dataport
  re-centred at (w/2,h/2,0); colours 0-255 LINEAR with metal/rough off
  0..255. Viewer `buildDashboard()` (dev-viewer port). Hull UI: blocks +
  triangles share ONE "hull" toggle; the hull-opacity slider fades blocks,
  triangle skin AND the wireframe overlay (v0.149 — lattice pitch/offset
  sliders + auto-fit button REMOVED: the exact fit applies silently).
- Component models: game ships per component a `.gltf` (materials named
  `color1`/`color2` = player-painted surfaces ⇄ `components[].colors`, plus
  fixed materials whose `pbrMetallicRoughness` baseColorFactor/metallic/
  roughness factors are the real colours — tire 0.013 black, body 0.01-0.03
  black, pin/chrome rough 0, connectors (0,.05,.5)/(0.5,0,0)/(0.5,.15,0)
  LINEAR — factors are glTF defaults when absent: color 0.8 grey, metal 1,
  rough 1) and an `.ini` (mass, `[RENDERABLE]` node tree, `[JOINT]` with
  angular limits, `[TARGET]` frame nodes, `[ADAPTER]` port positions, collider
  box). `extract_models.py` packs these into `viewer/models/`. **Placement
  truth is the `.ini` tree** (renderable/joint/target parents, euler order
  **ZYX** like the game engine); gltf node translations are Blender authoring
  offsets (MiniComputer's geometry sits 3 m from its origin, Beacon's base
  node +0.339 z vs the .ini −0.339 y) and must NOT be baked into geometry —
  node parents may reference each other in ANY order, so build the whole node
  map first, then link. Some renderables are CONDITIONAL: a Wheel/BigWheel
  gltf carries both tire toruses (`data.reverse` picks one) and an optional
  mudguard (`data.mudguard === false` removes it) — showing all stacks a
  double tire. Real models are dense (raytracing-grade): the viewer shows
  low-poly proxies by default (boxes + hexagon cylinders) and swaps in real
  geometry only via the “real game models” checkbox / `?real` (persisted in
  localStorage key `archean-real-models-v2` — v0.139 bumped the key so fresh
  opens honour the user-set defaults: hull on, wireframe off, labels off,
  real models off). `Build` type has no model (skipped).

## Performance rules (iGPU-targeted — keep them)
- Static geometry is MERGED: blocks → one mesh per distinct palette colour
  (crafts use a handful; materials are real PBR per colour, full faces are
  stitched to rectangles so a 3 m deck = 2 quads), block+wire edges →
  1 LineSegments (vertex-coloured), occupancy
  boxes → 1 line mesh, pipes → 1 mesh, streamlines → 1 LineSegments, all
  adapter nubs → 1 mesh per port type (world-merged, rebuilt on edit).
- Data structures (v0.155 audit): per-frame and per-edit queries go through
  hash indexes, never linear scans — aero plates get a uniform-grid SUPERSET
  index (3×3×3 probe of 1.5 m cells ≥ max influence 1.48 m; exact slab/r2
  tests run on the result = bit-identical streamlines) above 200 plates;
  below that the ~6 ns allocation-free scan beats 27 hash probes (adaptive,
  `aeroUseGrid`; giant craft 1024 plates 6.5→5.0 ms, airliner 92 plates must
  KEEP the scan — grid measured 2.4→5.0 regression). All per-frame cell keys
  are INTEGERS (`cellKeyV` base-8192 encoding; string keys regressed the
  giant 6.5→7.5, PERF.md #8). serialize()'s type-255 mirror sync (live
  Map index, sequential semantics preserved) and syncAdapters (Map by comp
  index, invalidated at the setModel queue rebuild) index likewise.
- Rendering is ON-DEMAND: call `invalidate()` after anything changes; the
  loop only draws on invalidation, controls movement, or while flow is on.
  Never reintroduce unconditional per-frame `renderer.render`.
- Material sharing is intentionally NOT done for component materials:
  selection highlight writes `material.emissive` per mesh (shared materials
  would light up every component of that colour).
- `renderer.setPixelRatio` is floored at 1 (capped at 2.5, re-applied in
  onResize): browser zoom-out drops `devicePixelRatio` below 1, and
  feeding that through renders the canvas BELOW CSS resolution — upscaled
  = the user's "zoomed in and grainy" on fresh opens. NOTE: Chrome PERSISTS
  per-site zoom across reloads (Ctrl-F5 keeps it; only Ctrl+0 resets), so
  HiDPI+zoom gives dpr 3 — the cap is 2.5, not 2, to keep those sharp.
  view3d also COUNTERACTS Chrome's PERSISTED SITE ZOOM (set by Ctrl+wheel
  over the canvas — Chrome grabs it before the page; saved in profile
  content settings, which apply in INCOGNITO too and survive Ctrl-F5:
  the user's "random stuck zoomed viewer, incognito, fixed by monitor
  move"). Mechanism: baseline dpr = lowest seen (localStorage) with
  zoom-in cancelled by inverse CSS zoom; cold/incognito starts factor
  devicePixelRatio into standard OS scales × Chrome zoom steps and undo
  zoom-IN only (deliberate zoom-outs respected; dpr 1.5625 = 125% screen
  × 125% zoom). Escape hatches: `?nozoom`, View-Options "reset page zoom"
  button; the Chrome-side entry only Ctrl+0 clears.
  `fitCameraToModel` frames at `max(1.85r, 3.6m)` — a 1 m craft framed at
  1.1 m felt like "stuck zoom, tiny FOV, low res" (the user's report;
  fly-to never runs on load — canvas click / list dblclick only).
- `?perf` writes `draw=<renderer.info.render.calls>` into the title; the
  ISW-241 scene is ≈150 draws. SwiftShader fps numbers are meaningless —
  compare draw-call counts only.

## Known open issues (v0.146 state)
- **v0.143/v0.145 were REVERTED** (user-confirmed regressions on Pages: beacon mast +
  aileron real models rotated wrong). v0.144 (IBL) was re-landed as the PMREM commit.
  Re-land the legacy alignment + per-asset loader bake ONLY with new pins first
  (real Beacon mast tip in world, comptest-grade; aileron real-model tip below hinge
  on a palette file) — existing pins are sign-invariant on axisymmetric parts, so a
  bake flip passes the suite silently. Details: FORMAT.md § Per-asset gltf loader
  conventions.
- Beacon "point forward" display convention (user): parked — blocked on an asymmetric
  probe craft (180°-quaternion z-sign ambiguity, see FORMAT.md).

## Invariants that tests enforce (keep them green)
1. `?selftest`: edit→serialize round-trip preserves bytes except intended fields;
   occupancy + type-255 mirror stay synced after position edits; the ISW beacon
   mast must point nose-ward in VIEW space (pins the Unity handedness fix); the
   ISW front caster wheel must hang below its pivot (suspension droop, display-only),
   the FluidJunction inlet must face view −y (flat builder-cache display pose —
   the cables are authored in that frame; see FORMAT.md), the ISW front aileron
   (saved `data.angle` in DEGREES = −4.609°) must droop a few degrees below its
   hinge (view tip y ≈ −0.08; the joint limit is ±45°),
   raycast picking must work through the mirrored component transforms; the
   v1 built-in palette must resolve WITHOUT a file palette (slot 48 = matte
   dark green, slot 53 cyan; v1 comp colours are slot-index
    pairs); the real Beacon model must carry the emissive red lens the game
    draws procedurally (user: "beacon no longer looks like a beacon");
     dashboard canvas text must be PRE-MIRRORED (`dashmirror=true`: a
     left-aligned label lands on the canvas RIGHT half) and baked text prims
     mirrored about their own centre (`textx=true`) — the orient fixture
     (testdata/9000000001, tools/make_orient_test.py) proved the game authors
     text readable from the plate's +normal side, so both layers need local
     counter-mirrors in our z-mirror chain (v105's normal-canvas/z-flip combo
     read mirrored from the pilot side = the v107 fix).
     legacy (no-palette) files must use RAW quaternions: the mosaic
     dashboard-mural plate normal must be parallel to its fitted wall plane
     (`mural=true`; conj quaternions tilt it ~45° out of the wall).
     the green ground plane + grid must sit just under the lowest rendered
     geometry — nothing of a craft renders below ground, ever (the
     3481322297 "Classic American Semi Truck" builds down to y=−1.5;
     `ground=true`).
     selecting a component must fire cable power-surges: one travelling
     pulse per connected pipe (data.pipes graph), the far component blips
     on arrival; pulses/blips/selection glow render additive with
     depthTest off — visible THROUGH the hull (`surges=true`).
     the windsock HUD is a camera child and its tail aims along flowDir()
     in camera space (`sock=true`, dot > 0.93 after an explicit updateWindHud);
     hull solids and wireframe are mutually exclusive checkboxes (`excl=true`);
     the wind particle budget tiers with scene cost, normal crafts full 4000
     (v0.156 "more wind particles, from further away": spawn box inflated
     4 m, kill margin 9 m; `windpts=true`); canvas picking = deliberate
     press only (`click=true`),
     and a subgrid hit CLOSER than any component routes the click to the
     subgrid info panel (v0.153 — content of a subgrid and anything BEHIND it
     lose; pinned in the dolphin postest, ISW has no subgrids);
     streamlines are UNDISTURBED upstream of the body mid-plane (`inflow=true`)
     while the wake deficit behind it slows the flow >25% (`wake=true`);
     pitching the PilotSeat must NOT steer/slow the wind (heading-only,
     `seatpitch=true`); display anchoring is a no-op on frame-(0,0,0) crafts
     like ISW (`anchor=true`). The rotate gizmo (Blender-style rings,
     v0.151) drags INTRINSIC (space='local'): each drag spins the axis
     the ring is CURRENTLY DRAWN along, so pitch-then-roll composes exactly
     as seen (user WYSIWYG rule); scene-root proxy, writeback qv = P·Ry(π)
     (THREE decompose absorbs the negative scale by negating sx). `gizmo=
     true` pins the writeback round-trip; `?gizmatest` (synthetic single-
     seat blueprint, camera facing the pilot, n=15 + &shot=1|2|3 visual
     states) pins the order algebra, the LIVE pose, and v0.156 KNOB
     CONTINUITY (`gizmoUnwrap`): TransformControls reports ring drags as a
     raw atan2 angle, so a knob sweep past 180° POPS back toward the start
     (user report) — the objectChange writeback unwraps per-event wrapped
     deltas into a continuous spin, both directions. Rings are thickened
     annuli at full opacity (TGC's default 0.02-wide/25 % reads invisible).
     The selection is boxed by a FAT 3px LineSegments2 outline (outline=
     true: 12 segments on select, hidden on none; Box3Helper's 1px lines
     vanished on HiDPI — user "selection should be more clear"). Connectors
     (adapter nubs) default HIDDEN on their own View-Options toggle
     (conndef=true), pipes/cables keep theirs. The v0.153 MODE
     WIDGET: a canvas click on a part pops ⊘/✥/⟳/ℹ TIED TO THE PART
     (v0.156: projected bbox centre, re-projected every rendered frame
     while open — no/move/rotate/info; last choice persists,
     `archean-gizmo-mode`);
     move = translate gizmo on the same proxy, writeback is the mirror
     involution (view z-flip) minus the compGroup display anchor, occ +
     type-255 mirror cells follow via serialize()'s round(delta/CELL) shift
     exactly like the position sliders — the gizmo never touches blueprint
     math. Shift snaps 15° AND 0.25 m cells. The explode/assembly
     feature (v0.140/141) was
     REMOVED in v0.142 (user: "a catastrophe") — do not resurrect.
     thrust display + wind model: every DIRECTIONAL propulsor (THRUST
     table = .ini TARGET axes; Propeller double-headed + excluded from
     the net) feeds a normalized net-thrust vector, while the
     directionless RCS blob (5-way in the game, nothing stored in the
     file) renders/counts as a tail-ward push along −cockpit heading
     ONLY when it is the sole propulsion class — ISW net+main pin to
     view (0,0,−1), never the old straight-down TARGET-axis arrow
     (`thrust=true`); sealStats (blocks+occup+hatch blocks+triangle
     raster on cell = pos+12f−5.5, z-view) flood+ray-enclosure seals
     BionicDolphin's cabin (>100 cells) while ISW stays wind-swept;
     sampleVel is zero inside sealed cells (`seal=true cabin=…`). The
     selection is an incandescent X-ray overlay (shared-geometry meshes,
     matrix-synced every rendered frame so it tracks live edits). Camera
     fly-in is MANUAL-only: canvas click, component-list double-click
     (never list single-click, ?sel= deep links, or selftest).
2. `regtest`: every testdata blueprint parses; blocks/components within bbox
   margins; the hull lattice map (when triangles exist) puts every vertex
   inside the bbox.
2b. `?comptest`: connector-alignment sweep over ISW-241 — every `data.pipes`
   endpoint (the game's own record of its port positions) must have an adapter
   nub ≤0.06 m, a cable tube ≤0.06 m, and the owning component's model surface
   ≤0.35 m. 60/60 PASS, PilotSeat (editor-moved) + Beacon (connector-frame
   endpoint quirk) exempt from the model check. Catches: tube chaining (pipes are
   NOT straight chains — anchor every segment at its own `start`), component
   pose/orientation, nub placement.
2c-b. `?uitest` (v0.147): headless UI sweep — drives EVERY panel control
   through its real handler (checkboxes, buttons, sliders, ⟲ resets) plus the
   paths state-pins miss: filter, LIST TABS (listtabs: by type / by subgrid,
   v0.156 — every flat part listed in both tabs, one search filters both,
   the pick persists), list-click select, keyboard g/o/h (which
   must move groups AND stay synced with their checkboxes; h = blocks +
   triangles together), preset buttons (must actually MOVE the part — the
   row.set()/onInput dead-button bug), comp.data write-through, real-model
   toggle + localStorage persistence, wind-mode/flow-src/CoM/thrust buttons,
   hull-opacity slider (fades blocks + skin + wire together),
   hull-list flash row, Steam wslink, dirty→Save
   lifecycle, calibrated-mass report, ⟲ RE-PAINT pin (invalSeq), component-
   level ⟲ pin (compreset: proxy + real siblings move, repaints, and writes a
   PLAIN numeric file quaternion — spreading a THREE.Quaternion copies its
   _x/_y accessor BACKING = NaN quats at the next rebuild), rotate-gizmo
   attach/toggle pins, mode-widget pins (modebox: a synthetic canvas click
   pops the widget at the part, ⊘/✥/⟳ buttons drive tctl mode + attach state
   + localStorage; movemode: proxy drag writes comp.position RAW, moves mesh
   AND real siblings, undo through the same path).
   Title: `UITEST PASS n=<pins> ctrls=N`
   (n counts ok() live, nothing hardcoded) /
   `UITEST FAIL <pins>`, captured errors in #out.
2c-c. `?gizmatest` (v0.151): rotate-gizmo ROTATION-ORDER suite on a
   synthetic single-PilotSeat blueprint, camera focused in front of the seat
   (user-suggested isolation). Asserts the PURE gizmoSpinRing/gizmoSpinEye
   contract (UI-free algebra: ring drag = intrinsic spin about the ring's
   drawn axis; trackball = eye-axis extrinsic; pitch90→roll90 order matters
   and uses the MOVED axis) + the shipped config (rotate/local) + the LIVE
   writeback through applyGizmoOrientation (file decode, mesh pose, ring
   tracking, visible nose swing) + v0.153 move-mode pins (movecfg: the mode
   switch toggles tctl translate↔rotate and persists; moveinv: the
   position writeback is the raw/mirror involution). `&shot=1|2|3` leaves
   the scene at
   before/+pitch90/+pitch90+roll90 for headless eyeball (runner saves
   gizmo1..3.png). Title: `GIZMATEST PASS n=15`.
2c. `?postest`: placement fixtures keyed per craft (the POSTESTS table in
   view3d.js — the sanctioned exception to "no per-craft constants": fixtures
   probe the RENDERED scene where generic checks cannot see a pose bug).
   ISW-241 + RCS-infinity (3518436870) FluidJunction rows: comb flat
   (world bbox y ≤ 0.40 m), one-height row at file y, cable endpoints on the
   −y side, ports ≤ 0.20 m of the model bbox (cable tips sit on visible
   sockets = 0.14 m off the proxy box). Guards the convention-independent
   junction display pose (FORMAT.md: file quat (w,−x,−y,z), never derived
   from the mapped view quat). Giant (3509975859) AERO-GRID pins (only
   grid-path craft, 1024 plates): grid ON, the 3×3×3 query is a SUPERSET of
   the influencing plates at 250 golden-ratio box points, freestream
   upstream, wake deficit >0.25 anchored on the first inserted solid cells
   (bbox-face probes fly through its sparse skin). Craft without fixtures
   report POSTEST SKIP.
   A GENERIC btn-* suite runs on every postest craft: ToggleButton renders
   exactly ONE lever (state picks axle/switch vs axle2/switch2), the lever
   centre matches the .ini derivation pivot+qV·mirror(Rz(0|−π)·Rx(18°)·
   (0,−0.16,−0.018)) within 0.07 m, and single-sided buttons show no base2.
   Catches state-ghost stacking (dolphin door buttons) in both rotations.
   v0.146: lever/plate expectations include the game's mount bake (local
   yaw-180, plate front on the mount face pilot-side — raw file quat leaves
   the plate 0.68 m behind the pivot = dolphin/Cede gap defect).
   v0.153 dolphin (3417786605) SUBGRID fixtures: one THREE.Group per Build
   subgrid (userData.sub), a ray from OUTSIDE the craft toward a door must
   route to the SUBGRID (front priority — the hull behind it loses),
   selectSub opens the info panel (Contents/Mount/Pivot rows) showing the
   DECODED master (sub-masters pin: 5 entries, Build[22]←SmallPivot), and a
   pivot edit tracks the group live with the file quat staying plain-numeric.
   XYQ-615 (3803780241) decodes Build[41]←ToggleButton, Build[5]←Dashboard.
   Dev-shot hooks leave final states for headless screenshots: uitest
   `&wbshot` (mode widget + move gizmo on a part), postest `&subshot`
   (subgrid panel + widget at the door).
3. `fitHull` must stay **generic**: zero per-craft constants. The exact lattice
   (W=12, pitch=CELL, C=−FRAME/2) passes on all 24 corpus files, not just ISW-241.

## Conventions
- view3d.js is one flat file with `// ---------- sections ----------`; follow it.
- UI = DevTools-style rows built by `row()`; new tunables get sliders, not prompts.
- Component list (v0.156): two tabs (`#ltabs`, persisted `archean-list-tab`) —
  `by type` (alphabetical sections) and `by subgrid` (one section per Build:
  decoded masters + indented nested rows whose click = selectSub; then
  'Hull & parts (no subgrid)'), ONE search (`#filter`, position unchanged)
  filters both; rows carry the `.i` index badge, section headers are
  `.sec` (count spans must NOT use class `i` — uitest counts rows by it).
  The nose/tail/up nudge presets were REMOVED (user: meaningless — sliders +
  gizmo cover nudging); the PilotSeat lean presets stay (seatpreset pin).
- `row().set()` MUST repaint (it calls `invalidate()`): programmatic
  `.value` assignment fires no 'input' event, and the global input→invalidate
  listener is what keeps sliders live — without it ⟲/presets moved the UI but
  froze the picture (v0.149 user report).
- `markDirty()` MUST repaint (it calls `invalidate()`): BUTTON handlers mutate
  data too but fire no 'input' event, so the global input→invalidate listener
  cannot cover them — v0.152: "⟲ reset this component" updated data+sliders
  while the 3D view sat still (its real-model siblings + nubs must be synced
  there as well, mirroring livePos/liveRot).
- Keep headless testability: no top-level awaits on user input, report results in
  `document.title` / `#out` for `--dump-dom`.

## Backlog
- Dashboard BUTTON elements (Toggle/Push/Arrow/Led) as real glTF models with
  the game's base transform + state animation (dev-viewer parity, transcribed
  in FORMAT.md §Handedness); today we draw plate+text approximations.
- Better flight-characteristics / stability analysis (beyond the stylized
  thin-plate model: full 360° velocity vector — nose may be ±X/±Z, automatic
  search of stable flight direction at low/high speed + ambiguity warning,
  trim/drag polar). User-requested, deliberately deferred.
- Aero model is stylized thin-plate (Cn = 2π·sinα·cosα), not CFD — label keeps.
- Joint animation is static (ailerons hinged at fixed droop from preview);
  in-game deflection state is not stored in the blueprint file.
- Optional before wider publishing: trim `testdata/` to the author's own craft
  (the other 23 files are other players' workshop copies — see NOTICE §2).

## Licensing notes (see NOTICE.md)
- Code is GPL-3.0; game data belongs to the game developer (batcholi/FloDKSM).
- Investigate provenance of anything of uncertain origin before extending it.
- No rights-holder permissions are claimed; reuse is presumed in good faith,
  CC-attribution spirit. Rights-holder objections are handled amicably via
  issues (NOTICE §4) — keep that transparency in any licensing-related change.
