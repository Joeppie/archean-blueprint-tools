# AGENTS.md — development guide

This repo reverse-engineers the **Archean** game's `blueprint.json` format and
provides a zero-build browser viewer/inspector. Everything is static: plain ES
modules + Three.js from CDN. No bundler, no npm.

## Layout
```
viewer/index.html + view3d.js   the inspector (Three.js, one file, ~1300 lines)
viewer/hullfit.js               generic hull-grid fitter (pure functions, no THREE)
viewer/models/                  real game component models: manifest.json (mass,
                                renderable node tree, joints, adapters, colliders
                                per type) + <Type>.json geometry, lazy-loaded
regtest/regtest.html            format-validation suite over testdata/ (importable)
testdata/<workshop-id>/blueprint.json   regression corpus (24 craft, 1 kB..530 kB)
tools/adjust_seat.py            reference example of a safe format edit
tools/extract_models.py         regenerates viewer/models/ from an installed game
tests/run_tests.sh              headless-Chromium test runner (selftest+regtest+renders)
FORMAT.md                       format documentation (start here)
NOTICE.md                       licensing: GPL code, game content belongs to batcholi/FloDKSM
```

## Commands
```bash
tests/run_tests.sh                      # full headless suite (python3 + chromium)
python3 -m http.server 8650             # manual serving (repo root)
# viewer:   http://127.0.0.1:8650/viewer/index.html
# selftest: http://127.0.0.1:8650/viewer/index.html?selftest  (tab title: SELFTEST PASS)
# regtest:  http://127.0.0.1:8650/regtest/regtest.html         (page ends 'REGTEST: PASS')
# other craft: viewer/index.html?open=../testdata/<id>/blueprint.json
# perf probe: viewer/index.html?perf → tab title: PERF fps=… draw=<draw-calls> …
python3 tools/extract_models.py <Archean-game-dir> -o viewer/models
```
Headless render shots: `chromium --headless=new --no-sandbox --disable-gpu
--enable-unsafe-swiftshader --window-size=1400,900 --virtual-time-budget=15000
--screenshot=out.png <url>` (add `--dump-dom` to read page text/titles).

## Format facts (verified — do not re-derive)
- 1 grid cell = 0.25 m; `pos_*` ∈ 0..12; `frame_*` in 3 m units;
  `world = (pos − 5.5)·0.25 + frame·3.0`. −z is the nose (this craft).
- Components' `occupancies` are mirrored by type-255 entries in `data.blocks`.
  **Any save must keep them in sync** (round(delta/0.25) cells, both places).
- Save format must serialize byte-identical to the game's JS:
  `json.dumps(..., separators=(',',':'), ensure_ascii=False)` — no spaces,
  key order preserved, no reformatting.
- `components[].colors` may be a dict (`color1`/`color2`) in v2 files — handle both.
- Hull triangles: vertices are lattice slots:
  `world_ax = (v_ax + W·frame_ax)·pitch_ax + C_ax`, W detected from cross-frame
  weld pairs (identical other-axis slot coords), pitches by tight bbox fit, y
  anchored at aileron height + box top. Shared slots = welded points; the file
  stores 49 slots for 63 usages on ISW-241 (canopy hinge), cross-frame welds at
  Δv = W, gaps at W±2 mark openings. Game layers ~0.125 m thickness onto the
  triangle planes; winding order flips the normal.
- `pipes` segments: `dir` 0..5 = +x,+y,+z,−x,−y,−z; the first/last segment ends
  are world-space connector positions (trace pipes to place ports).
- `components[].type === 'Build'` = editor construction-site ghost, far outside
  the bbox — never render it as geometry.
- Palette slots: `data.colors[256]`; `opacity < 8` ⇒ transparent (glass).
- Component models: game ships per component a `.gltf` (materials named
  `color1`/`color2` = player-painted surfaces ⇄ `components[].colors`) and an
  `.ini` (mass, `[RENDERABLE]` node tree, `[JOINT]` with angular limits,
  `[TARGET]` frame nodes, `[ADAPTER]` port positions, collider box).
  `extract_models.py` packs these into `viewer/models/`. **Placement truth is
  the `.ini` tree** (renderable/joint/target parents, euler order **ZYX** like
  the game engine); gltf node translations are Blender authoring offsets
  (MiniComputer's geometry sits 3 m from its origin!) and must NOT be baked
  into geometry. Real models are dense (raytracing-grade): the viewer shows
  low-poly proxies by default (boxes + hexagon cylinders) and swaps in real
  geometry only via the “real game models” checkbox / `?real` (persisted in
  localStorage). `Build` type has no model (skipped).

## Performance rules (iGPU-targeted — keep them)
- Static geometry is MERGED: all blocks → 1 vertex-color mesh, occupancy
  boxes → 1 line mesh, pipes → 1 mesh, streamlines → 1 LineSegments, all
  adapter nubs → 1 mesh per port type (world-merged, rebuilt on edit).
- Rendering is ON-DEMAND: call `invalidate()` after anything changes; the
  loop only draws on invalidation, controls movement, or while flow is on.
  Never reintroduce unconditional per-frame `renderer.render`.
- Material sharing is intentionally NOT done for component materials:
  selection highlight writes `material.emissive` per mesh (shared materials
  would light up every component of that colour).
- `?perf` writes `draw=<renderer.info.render.calls>` into the title; the
  ISW-241 scene is ≈150 draws. SwiftShader fps numbers are meaningless —
  compare draw-call counts only.

## Invariants that tests enforce (keep them green)
1. `?selftest`: edit→serialize round-trip preserves bytes except intended fields;
   occupancy + type-255 mirror stay synced after position edits.
2. `regtest`: every testdata blueprint parses; blocks/components within bbox
   margins; hull fit (when triangles exist) maps every vertex inside the bbox.
3. `fitHull` must stay **generic**: zero per-craft constants. New fit heuristics
   must pass on all 24 corpus files, not just ISW-241.

## Conventions
- view3d.js is one flat file with `// ---------- sections ----------`; follow it.
- UI = DevTools-style rows built by `row()`; new tunables get sliders, not prompts.
- Keep headless testability: no top-level awaits on user input, report results in
  `document.title` / `#out` for `--dump-dom`.

## Backlog
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
- Relicensing by mutual agreement of rights holders is allowed, fee-free,
  documented in NOTICE.md — respect that process in PRs touching licensing.
