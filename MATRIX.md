# MATRIX.md — component matrix: mass, ingredients & render vs the dev viewer

Purpose: prove, per COMPONENT TYPE, that this repo's data and renderers agree
with the ground truth — the installed GAME FILES for the numbers, the dev's
XenonViewer for what the game's own editor tooling displays — and give a
repeatable release test to re-run **whenever the game version increments**.

## Scope (current state)

Per component type (all 106 in `viewer/models/manifest.json`), batched three
to a craft to keep the number of test cases down:

1. **render** — the component at rest and, where it has joint/state data, in
   a deflected state (`Torus` vs `TorusReverse`, mudguard, aileron −15°,
   hinge 90°, track +0.25 m, open door, lever 0.7, button pressed, tank
   fluid…). Both viewers draw the real game models; screenshots at the SAME
   camera (the dev's `iso` preset: azimuth 0.9, elevation 0.45 rad; since the
   v0.180 de-mirror our view space IS file space → camera dir (0.705, 0.435, +0.560)).
2. **mass** — the game's server model: component `[ENTITY] mass` from the
   `.ini`; per-material density per 0.25 m cell cube (composite .25,
   concrete 10, steel 1, aluminium .5, glass 1, lead 150, titanium .6 kg),
   shaped blocks = half their rect, hull triangles `area·0.05 m`, struts
   1 kg/m, frame beams 10 kg, tank contents = fraction × capacity
   (FluidTank 1.5 m³, SmallFluidTank 0.2, BigFluidTank 14) × the game's
   "very crude" liquid density from atomic masses (radius ∝ n³).
   Center of mass = kg-weighted positions — a second, position-sensitive
   check the dev's panel exposes for free.
3. **ingredients** — the Blueprint tool's content list (`GetBlueprintContents`,
   ARCHEAN_build/common.hh): blocks cost their FULL rect of the material's
   block item (shape irrelevant), triangles `ceil(vol)` ≥ 1, struts 100 rods
   per m (ceil), cables truncate PER SEGMENT in cm (2×1.5 cm = 2 cm, not 3),
   frames = SteelBeams, components = 1 item keyed `module.Type` **as the file
   says**, `Build` subgrids dropped, Dashboard → one DashboardTool.
   Raw materials = recursive crafter-recipe unfold (`RepairEconomy.h` rule):
   first crafter recipe outputting an item wins, fractional batches, items
   with no recipe are raw UNLESS they are catalog components (then
   "unresolved" = the stuck rows; a stuck component ⇒ wrong module mapping).

Sources inside the install: `modules/<module>/components/<Type>/<Type>.ini`
(mass) + `modules/<module>/config.yaml` (items, recipes; shorthand bare-string
inputs, dynamic `input.composition.*` outputs only for non-crafter contexts —
dropped). The dev's own catalog (`models/catalog.json`) is generated from the
game SOURCE on the dev's schedule; ours from the installed build
(`APP_VERSION_BUILD_NUMBER.txt`). Cross-checks 2026-10-19 (build 136):
111/111 masses, 140/140 crafter recipes, 165/165 items identical. **A
mismatch after a game update is expected drift, not automatically a bug.**
The port attribution for the formulas follows NOTICE §2 (dev viewer + game
headers), same terms as the existing ports; knowledge is mirrored into
FORMAT.md so answers stay offline.

## Files

| path | role |
|---|---|
| `tools/game_data.py` | our extraction + mass/cost model from GAME FILES; `--selfcheck <blueprint>` prints items/raw/mass for any craft |
| `tools/make_matrix_test.py` | generates the fixture corpus rows (ids `90000010NN` rest, `90000020NN` deflected) — deterministic |
| `app/tools/devscrape.mjs` | Playwright: uploads each fixture to the Xenon viewer (it has NO URL loader — file input only), scrapes mass/cost/contents/notes panels, screenshots; drives OUR viewer via `?open=` + the `window.HARCHEAN` hooks only (frozen viewer untouched), camera matched to the dev iso, proxy + `&real` shots |
| `tools/matrix_verify.py` | diffs the scraped panels vs `game_data` numbers → `reports/matrix/REPORT.md`, exit code |
| `tools/matrix_sheet.py` | side-by-side `dev │ ours` PNGs + a coarse silhouette-correlation screen (orders the eyeball queue; a low score ≠ failure, a human decides) |
| `tools/matrix_iou.py` | framing-invariant screen: foreground-mask bbox normalised per side, IoU → `render-iou.json` (the QUEUE for step-0 triage) |
| `tests/matrix.sh` | orchestrates all of the above |

## Running

```bash
bash tests/matrix.sh                    # all matrix crafts (network + game install)
bash tests/matrix.sh 9000001001,9000002001   # just these
MATRIX_SKIP_SHOTS=1 bash tests/matrix.sh     # panels only (faster triage)
python3 tools/matrix_verify.py --dir reports/matrix   # re-diff only
python3 tools/matrix_iou.py --dir reports/matrix      # re-screen renders only
# ours-side only re-shoot (keeps scraped dev panels in the dossiers):
(cd app && node tools/devscrape.mjs --ids <ids> --ours http://127.0.0.1:8650 --no-dev)
```

Outputs land in `reports/matrix/`: per-craft `<id>.json` dossier, `<id>-dev.png`,
`<id>-ours-proxy.png`, `<id>-ours-real.png`, `REPORT.md`.
The dev viewer loads each blueprint from OUR generated file — the comparison
is the same blueprint through both pipelines, not two approximations.

## Reading the verdicts

* `stuck in dev raw: MODULE.Type` → the module written in our fixture (and
  the manifest) is wrong for that type, or the game added/renamed a recipe.
* `mass dev X vs ours Y` → ini mass parse drift or a model rule changed
  (check `--selfcheck` against a real craft of that game build).
* `raw ... differ` → recipe table update (also compare
  `python3 tools/game_data.py --list-recipes` vs the dev catalog).
* dev `notes` entries → the dev rejected part of our fixture: field-level
  format regression, fix the generator and pin the format in FORMAT.md.
* render diffs on deflected twins → the data-driven node selection
  (conditional renderables, joint pose) disagrees with the dev.

## What the DATA files define for rendering (verified 2026-10-19, build 136)

A census of all 117 component `.ini`s + every `config.yaml` + the dev's
scene.js settles where per-part rendering comes from:

* **Placement IS data**: `[RENDERABLE <node>] parent/position/rotation`,
  `[JOINT <node>]` (+ `angular_x|y|z`, `linear_x|z` axis keys), `[ADAPTER]`,
  `[TARGET]`, `[COLLIDER]` (+`is_build_block`, `displacement_volume`),
  `[ENTITY]` (`mass`, `airtight`, `base_planes`, `symmetric`). Euler ZYX
  node-tree composition — exactly what `viewer/models/manifest.json`
  (renderables/joints) already encodes; gltf node transforms stay ignored.
  VERTEX SPACE (2026-10-19): the dev re-expresses that chain in the glTF basis
  C=(x,z,-y), which equals the raw chain over Rx(+90)-baked verts; the game's
  own loader bakes per asset (majority Z-up, minority already Y-up — its
  `.ini` collider box arbitrates). app/ implements this via
  `tools/asset_space.py` + models.ts `UNITY_BAKED_TYPES` (FORMAT §Per-asset
  gltf VERTEX SPACE); a wrong-space part renders the SAME parts rotated 90°
  about the part's placement — re-run the tool after game updates.
* **Part visibility/animation is NOT data**: no ini/yaml key hides or moves
  a part. The game client toggles `renderables["mudguard"]->active` etc.
  per frame by part NAME + `data` (C++). The dev mirrors it with a
  hardcoded drop table: `ARCHEAN_wheel.Wheel`: drop `mudguard` iff
  `data.mudguard === false` (mounted unless explicitly false), drop `Torus`
  if `data.reverse` else `TorusReverse`; `BigWheel`: the torus pair only.
  Our `COND_PARTS` (view3d.js) is semantically identical — any app/ port
  must key the same way, and the table must be re-verified on game updates
  (a new conditional part shows up as an extra gltf node name).
* **The dev renders kinematic parts at REST**: its scene.js reads ONLY
  `data.reverse`, `data.mudguard`, Propeller geometry params (it GENERATES
  the prop surface from `blades/radius/width/twist/pitch`) and Dashboard
  element states. No `data.angle`, `data.pos` or component `data.state`
  exists anywhere in its modules. We DO animate those (the saved values are
  the game's authored pose — FORMAT §Subgrids, selftest aileron pins), so
  on deflected twins a deflected-OURS vs rested-DEV is the expected,
  correct difference; the dev-facing job of a twin is the parts the dev
  honours: wheel selection, propeller geometry, tank contents (mass panel).
* Dev switch/lever state poses (±45° switch, 0.01 m press) are its own
  approximations for DASHBOARD ELEMENTS only — not component truth.

## Interpreting a render mismatch — the triage procedure

A mismatch = one screenshot pair (`<id>-dev.png` vs
`<id>-ours-real.png`, side-by-sides under `sheets/`) differing beyond
lighting/framing. `render-iou.json` (silhouette IoU: per-row modal
background removal → MORPHOLOGICAL OPENING (kills label glyph strokes, grid
and wire hair) → largest connected component → bbox-normalised 160×120)
only ORDERS the eyeball queue — framing-invariant by design, but styling
still floors the score (~0.5+ typical); a human verdict is the gate.
Screenshot staging is symmetric by construction: the dev pair is shot with
its `ground grid` + `shadows` options OFF (sky/ground stays ON — off turns
the canvas transparent and page furniture floods the mask); ours hides the
120 m ground plane, the grid helper and the occupancy wire via the
HARCHEAN hooks. Work the ladder; the first failing gate names the owning
layer:

1. **Re-shoot before believing it**: `bash tests/matrix.sh <id>` (fresh
   contexts). `ours_real.filestatus` must show the right alias + component
   count, `dev.warnings` inside the tolerance rule, zero page errors. Stale
   or half-loaded PNGs are the top false-positive source.
2. **Bind the diff to ONE type**: the row's three types sit left→right at
   file x=−1.375/0.125/1.625 (left→right at the paired iso camera since the
   v0.180 de-mirror); the in-scene label names it.
3. **Part missing/extra** → node tree + conditional rules: re-run
   `python3 tools/extract_models.py <game> -o viewer/models`, diff the
   type's `renderables` against its `[RENDERABLE]` sections, re-check the
   drop table above. Fix = extractor or the conditional rule; then extend
   `DEFLECT_DATA` so BOTH states stay pinned in new twins.
4. **Right parts, wrong REST position/rotation** → composition chain vs ini
   (`parent/position/rotation`, euler ZYX; gltf offsets must NOT be baked —
   v0.143/v0.145 revert lesson: never touch per-asset alignment without a
   measured pin, AGENTS §Known open issues). The dev composes the same ini:
   it is the reference. Corrective = loader fix + a postest-style pin.
5. **Wrong only at deflection** → ours-only by definition (the dev rests):
   judge against our own joint pins, never against the dev.
6. **Colour/material** → albedo LINEAR both sides; diff the type's material
   names against the dev catalog (`models/catalog.json`,
   `components[id].materials`) and our manifest `materials` — game renames
   surface here first.
7. **Whole part scaled** → unit traps: Dashboard cm/100, ini metres, hull
   lattice 0.25, Propeller `radius` metres.
8. **Rotated mounts mirrored (dev side only)** → known dev raw-quaternion
   bug — since the v0.180 de-mirror OUR render is the game-true one here;
   not fixable on our side (identity fixtures; see divergences).

Loop: fix the owning layer → re-run the single id → pair agrees → run the
FULL matrix → transcribe the root cause into FORMAT.md in the SAME commit
(offline knowledge rule; NOTICE §2 attribution when the fact came from the
dev's implementation).

## Game-version bump ritual

1. `python3 tools/game_data.py --selfcheck testdata/3812927875/blueprint.json`
   — parser survives the new ini/yaml dialect.
2. `python3 tools/extract_models.py <new game> -o viewer/models` → the git
   diff IS the per-part placement/material/mass/joint change list of the
   update (review it like a code diff).
3. `bash tests/matrix.sh` (full): mass/recipe drift shows per row;
   distinguish GAME change (our numbers and the dev panels move TOGETHER →
   update FORMAT tables; declared masses regenerate with the fixtures) from
   PARSER break (they disagree) from DEV STALENESS (their `catalog.json`
   `generated` date lags the install's `APP_VERSION_BUILD_NUMBER.txt`;
   compare `--list-recipes` vs the fetched catalog before blaming either).
4. New component types appear via `manifest.json` automatically:
   `make_matrix_test.py` re-batches alphabetically in threes.

## Known intentional viewer divergences (not failures)
* **sheets are DIRECT pairs since the v0.180 de-mirror**: our viewer now
  renders the GAME's own view (raw positions, standard RH camera — FORMAT
  §"Chirality vs in-game truth", corrective plan LANDED 2026-10-19); the
  dev's raw-numbers render shows the SAME side at the paired camera, so
  `<id>-ours-real.png` compares to `<id>-dev.png` WITHOUT any flip
  (`matrix_iou.py`'s mask mirror was retired — keeping it would double-flip;
  devscrape's ISO_DIR is the dev camera direction un-mirrored). Screenshots
  and triage notes from before v0.180 carry one horizontal flip between the
  two sides. A flip maps faces to faces, so it could never explain content
  VISIBLE on one side and MISSING on the other (e.g. the 9000001007
  Dashboard 'TEST' Label): that class was a text/SIDE-path question anyway —
  and the raw-canvas dashboard fixed it.
* **rotated 2026 files**: the ONE remaining true divergence — the dev places
  components with the RAW Unity quaternion, while the game (and we) place
  palette-bearing files with the CONJUGATE (data-pinned: pipes 0.000 m,
  mural flushfrac; FORMAT §"Chirality vs in-game truth"). After the
  de-mirror ours and the dev's sheets agree everywhere EXCEPT here: rotated
  mounts in V2 files show the dev mirroring the PART (its raw-quat bug;
  triage step 8). **V1 files are the dev's correct case** — raw placement IS
  the legacy convention, so side-by-sides of mosaic-era craft agree
  pose-wise (FORMAT §V1/V2). Fixtures therefore all sit at identity —
  rotated comparisons against the dev would flag a KNOWN dev-side error.
* our default is proxies, `&real` the game models; the dev always renders the
  real models — compare `<id>-ours-real.png` against `<id>-dev.png`.
* `ArrowButton` + `Led` are dashboard-BUILTIN element models (they live under
  `components/Dashboard/`), not catalog parts: the dev viewer has no catalog
  entry, draws a placeholder and says so in its notes panel — we draw the
  real model. Their craft rows are EXPECTED to show that one note; the
  verifier tolerates exactly that.
* occupancy display defaults differ (our viewer shows occupancy boxes, the
  dev draws them in its `occupancies` layer per its scene options) — the
  harness compares the OCCUPANCY DATA via the panels/geometry, not the layer
  visibility.
* lighting/HDR/sky differ by design; the harness compares GEOMETRY, pose,
  occupancy layer content and the numbers — eyeball the pairs side by side.
* **Propeller is a REAL gap (backlog, fix in app/)**: the game client (and
  the dev — see its `propellerGeometry`) GENERATE the prop surface from
  `data.blades/radius/width/twist/pitch`; our viewer draws the static gltf
  `prop` template. Propeller rows score ~0.23–0.40 on the screen for this
  reason; the numbers side (mass/cost) is unaffected. Implement generator +
  Playwright pin when the app render pass reaches it.
* screen caveat: rows whose parts TOUCH/touch-project can make the
  largest-component mask span different scopes per side (dev merges, ours
  separates) → low IoU with no rendering fault (e.g. C01 1001, C13 1013,
  C19/26/32). The triage step is the ASCII/mask eyeball, not the score.

## Extending (next phases)

* block-type rows (types 0..52, then multi-cell sizes) — same harness, extend
  `make_matrix_test.py`; occupancy/material columns ride along.
* app/ port: when the React app covers these components, add `--ours2
  <app-url>` second-pass shots to devscrape and pin the deltas as Playwright
  expectations in app/e2e.
* occupancy exactness: fixtures carry 1-cell occupancies; deriving the GAME's
  own footprint rule (collider box → cells) would let us generate the exact
  occupancies the editor would write — compare against client saves
  (`Archean-data/client/blueprints`) which contain real footprints.
