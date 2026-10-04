# Archean Blueprint Tools

Reverse-engineered file format + zero-build browser inspector for workshop
crafts of the game **[Archean](https://store.steampowered.com/app/2941660/Archean/)**
(developed by batcholi / FloDKSM).

Everything is static — plain ES modules, Three.js from CDN, no build step.
Open the viewer on a blueprint, click any component, and edit position,
rotation, and data fields with live 3D feedback; saving writes the game's
exact compact JSON format, keeping the occupancy/block mirror in sync.

## Quick start
```bash
python3 -m http.server 8650          # repo root
# viewer:   http://127.0.0.1:8650/viewer/index.html
# (loads testdata/3812927875 — the ISW-241 fighter — by default;
#  “Open file…” loads any blueprint.json, drop-onto-page works too)
```

## What's inside
| path | what |
|---|---|
| `viewer/` | 3D inspector + editor (DevTools-style live sliders, save in game format) |
| `viewer/hullfit.js` | generic fitter that recovers the hull-triangle lattice (`(v + W·frame)·pitch + C`) per file — vertices are welded lattice slots, shared slots are shared points |
| `regtest/` | format-validation suite over the whole `testdata/` corpus |
| `testdata/` | 24 workshop blueprints (1 kB..530 kB) used as regression corpus |
| `tools/adjust_seat.py` | example of a safe scripted edit (seat pitch/shift + mirror sync) |
| `tests/run_tests.sh` | headless-Chromium test runner (selftest, regtest, render smoke tests) |
| `FORMAT.md` | the format documentation |
| `AGENTS.md` | development guide for humans *and* coding agents |
| `NOTICE.md` | licensing details (code GPL-3.0, game content belongs to the developer) |

## Tests
```bash
tests/run_tests.sh        # python3 + chromium (set CHROME=... if needed); exit 0 = pass
```
Runs the viewer selftest (serialize round-trip + occupancy/mirror sync), the
24-craft regtest (parse + geometry invariants + hull-fit containment), and
headless render shots under `/tmp/archean-tests/`.

## Features in the viewer
- Click-select any of 30 components (seat, ailerons, pump, RCS, …) with
  position/rotation/data sliders, instant 3D update, save button
  (File System Access API in Chromium, download fallback).
- Hull skin: welded + mirror-symmetrized triangle plates (0.125 m thick,
  glass for low-opacity palette slots) + wireframe of the raw surfaces.
- Pipes/cables rendered from `data.pipes` with connector markers at ports.
- Mass & CoM: declared mass verified against parts + calibrated block cells.
- Stylized flight analysis: thin-plate aero per element, CoP/static margin,
  particles + streamlines around the craft (not CFD — clearly labelled).

## Licensing
Code: **GPL-3.0** (see `LICENSE`) — improvements stay open, copyleft is the
point. Game data/format content: belongs to the Archean developer.
Provenance of unattributed material must be investigated; relicensing by
mutual agreement of rights holders is fee-free and documented — see `NOTICE.md`.
