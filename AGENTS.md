# AGENTS.md — development guide

This repo reverse-engineers the **Archean** game's `blueprint.json` format and
provides a zero-build browser viewer/inspector. Everything is static: plain ES
modules + Three.js from CDN. No bundler, no npm.

## Layout
```
viewer/index.html + view3d.js   the inspector (Three.js, one file, ~1100 lines)
viewer/hullfit.js               generic hull-grid fitter (pure functions, no THREE)
regtest/regtest.html            format-validation suite over testdata/ (importable)
testdata/<workshop-id>/blueprint.json   regression corpus (24 craft, 1 kB..530 kB)
tools/adjust_seat.py            reference example of a safe format edit
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

## Known TODOs
- Aerodynamics: full 360° velocity vector (nose may be ±X/±Z), automatic search
  of stable flight direction at low/high speed + ambiguity warning.
- Aero model is stylized thin-plate (Cn = 2π·sinα·cosα), not CFD — label keeps.
- Component proxies are facsimiles; port positions come from pipe endpoints.

## Licensing notes (see NOTICE.md)
- Code is GPL-3.0; game data belongs to the game developer (batcholi/FloDKSM).
- Investigate provenance of anything of uncertain origin before extending it.
- Relicensing by mutual agreement of rights holders is allowed, fee-free,
  documented in NOTICE.md — respect that process in PRs touching licensing.
