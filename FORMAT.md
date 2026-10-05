# Archean blueprint.json — format notes (reverse-engineered, AI-friendly)

Craft: "ISW-241" (workshop_item_id 3812927875). File is a **single-line, compact JSON**
(`separators=(',',':')`, keys alphabetical, UTF-8 with literal `°`/`«` characters, **no**
`\u` escapes, no trailing newline). A Python round-trip with
`json.dumps(obj, separators=(',',':'), ensure_ascii=False)` is **byte-identical**, so
programmatic editing is safe.

## Top level

| key | meaning |
|---|---|
| `author`, `alias`, `datetime`, `workshop_item_id` | metadata |
| `mass` | total craft mass (kg, computed) |
| `type` | blueprint kind (`"Vessel"`) |
| `version` | format version (2) |
| `box_min` / `box_max` / `box_size` | craft bounding box in world metres (x ±3.5, y 0.19..2.25, z −4.75..7) |
| `data` | the actual build (below) |

## `data` keys

`blocks`, `components`, `colors` (256-slot palette of {r,g,b,metallic,roughness,opacity}),
`pipes` (data-port pipe geometry), `triangles` (freeform mesh), `doors`, `frames`,
`labels`, `struts`, `composite_builds` (all empty here), `indestructible`,
`symmetry_axis`, `version`.

## Coordinate system (verified)

- Unity left-handed, metres: **x = lateral** (x=0 is centerline, +x = starboard),
  **y = up**, **z = longitudinal**. For this craft **−z is the nose, +z is the tail**
  (nose wheel at z=−3.6, main wheels/RCS at z=+4.1..+4.25, main wings/aft ailerons at
  z=+6.1, canards at z=−3.9).
- Grid: every `pos_*` is an integer **0..12** (13 values) in **0.25 m** steps; a block's
  `pos_*` is its center cell. `frame_*` is an integer frame offset where **1 frame = 12
  cells = 3.0 m**. This is the "max ~12 positions" rule. World position from grid:

      world = (pos − 5.5) × 0.25 + frame × 3.0      (per axis, center cell)

  Verified, e.g. FluidPort `pos_z 6, frame_z 0` → z = 0.125; block `pos_x 5, frame_x 1`
  → x = −0.125 + 3 = 2.875; `pos_y 9` → y = 0.875.
- Components additionally store a free (non-grid) `position` — the exact model pivot in
  world metres, and `orientation` as a **quaternion {w,x,y,z}** (Unity convention).
  The grid `occupancies` record is the snap/attach footprint; `position` is the truth
  for where the model sits.

### Handedness — the Unity left-handed quaternion (verified against `data.pipes`)

The game engine is Unity: a **left-handed** world. `orientation` is stored with Unity's
rotation sense, so feeding the quaternion straight into a right-handed renderer (Three.js,
glTF, any RH math) rotates the **opposite** way about every axis — beacons lean to the
wrong side, steering casters pitch the wrong way, wheels sit inboard of their mounts,
control surfaces deflect inverted. It is not cosmetic; the mirror is only visible on parts
off the centerline.

**The file's `q` is a left-handed rotation. The right-handed equivalent is the
conjugate `q* = {w, −x, −y, −z}`** (equivalently, negate the rotation angle). Proof, so
this never has to be re-derived: `data.pipes` segment endpoints are *game-computed world
positions* of each component's adapter ports. For every port,
`position + R(q*)·adapter_local` reproduces the stored pipe end to **0.000 m**, while
`position + R(q)·adapter_local` is **0.18–0.66 m** off. The game's own data settles it.

The standard Unity→right-handed fix mirrors one axis. `viewer/view3d.js` mirrors **z**:

    view_pos  = (x, y, −z)          view_quat(file w,x,y,z) = (w, x, y, −z)

`model.data`, the serialized save, the inspector's numbers, and all reports stay in **raw
file space** (the z-mirror is a pure display transform, so edits convert back); component
*local* geometry keeps raw `.ini`/gltf numbers and a root `scale.z = -1` absorbs the
mirror (Three.js flips triangle winding for negative-determinant matrices, and sprite
labels are unaffected). `?selftest` asserts the beacon mast points nose-ward in view
space, so a regression that reintroduces raw-`q` placement fails the suite.

## `blocks` — the voxel build

`{colors[7], frame_x/y/z, material, pos_x/y/z, size_x/y/z, type}`

- `type` encodes **shape + orientation** in one int (game `BlockShapes.hh`;
  full table + vertices in `viewer/blockshapes.js`):
  `0` cube · `1..12` slope (the thin tilted "rods" are slope type 4) ·
  `13..20` corner · `21..44` pyramid · `45..52` inverse corner ·
  **`type:255` entries are invisible occupancy markers for components** — e.g.
  block #12 mirrors the PilotSeat's occupancies exactly. If you move a
  component's occupancy, update its 255-mirror in `blocks` too.
  This is why voxel craft look curved/diamond-cut: hulls are built from
  slopes/corners/pyramids, not cubes.
- `size_*`: extent beyond the center cell (footprint = `size+1` cells); the
  shape is scaled into that box (e.g. type 4 slope with `size_z 14` = 3.5 m
  tilted rod).
- `colors[7]`: one palette slot (`data.colors`) **per face**, in the face order
  of `SHAPE_FACES` in `blockshapes.js` (cube: top, bottom, right, left, front,
  back; slopes/corners/pyramids: their own order, slant face first). Slots with
  `opacity < 15` render transparent, alpha = (opacity+1)/16 (glass) — see
  “Colour & materials” below for the full PBR semantics.
- `material`: 0..6 = composite, concrete, steel, aluminium, glass, lead,
  titanium (visual: palette slots carry the metallic/roughness per face).

## `components` — the machines (30 here)

`{alias, colors{color1,color2,...}, data{}, mirrorAxis, module, occupancies[], orientation, position, type}`

- `type` / `module`: e.g. `PilotSeat`/`ARCHEAN_avatar`, `MiniComputer`/`ARCHEAN_computer`,
  `HudController`/`ARCHEAN_hud`, `Beacon`/`ARCHEAN_beacon`, `Aileron`/`ARCHEAN_aileron`,
  `SmallWheel`/`ARCHEAN_wheel`, `RCS`/`ARCHEAN_rcs`, `FluidPort`/`ARCHEAN_chemical`,
  `FluidJunction`, `PowerConverter`, `SolarPanel`, `TiltSensor`, `LowVoltageBattery`,
  `SmallTurboPump`, `OwnerPad`.
- `occupancies[]`: same shape as a block entry (frame/pos/size), grid footprint.
- `position` / `orientation`: free transform (model pivot, rotation about it).
- `data`: per-type payload — MiniComputer holds visual-program nodes + `.xc` source
  (`xc_files`), Beacon holds frequency + last transmitted payload, PilotSeat holds
  `{emitPlayerToken, smoothControls}`, HudController holds HUD `.xc` source.

## `pipes`

Data-port cables: `{a_component, a_port, b_component, b_port, radius, segments[]}` where
`a_component`/`b_component` are indices into `data.components`, and `segments[]` are cached
render geometry (absolute world `start`, `dir` 0..5 = `+x,+y,+z,−x,−y,−z` (verified from
segment deltas), `length`, per-segment `r,g,b,a`). The first segment `start` and the last
segment's end are the **connector positions in world space** — tracing pipes tells you
exactly where every part's ports are (e.g. SmallTurboPump fluid-in at x −0.22, fluid-out
at +0.22 → the pump lies sideways with ports left/right). Connections are by
component index, so cached segments may render slightly stale after a component moves;
the game regenerates them on next save from the editor. The viewer renders pipes as tubes
with blue/green connector markers at the a/b ends.
**Pipes are NOT straight chains** (verified on all 30 ISW-241 pipes): every joint has a
0.04–0.14 m offset between `seg[i].start + dir·len` and `seg[i+1].start` (rounded-cap
cable smoothing). Each tube MUST be anchored at its own segment `start` — accumulating
`cur += dir·len` drifts every pipe and leaves the endpoint markers far off the ports
(the v0.97 "green spheres don't match the cables" bug). Cable endpoints also sit
0.1–0.4 m out along each connector's stub from the `.ini` adapter origin: a port's
**connection point is the pipe endpoint**, and adapter nubs are drawn there whenever a
cable exists. Exception: the Beacon records its endpoints in the connector's upright
frame (`p + (0,−0.145,±0.062)` for every orientation) — exempt in the connector test.
The viewer's `?comptest` sweeps all of this on ISW-241: every endpoint must have a nub
(≤0.06 m), a tube (≤0.06 m) and the owner's model surface (≤0.35 m) — 60/60, with
PilotSeat (user-moved in editor) and Beacon exempt from the model check only.
Note: `components` may contain a `Build` type — the editor's construction-site ghost
(e.g. y −24.75, far outside the craft). It is not physical geometry; the viewer skips it.

## The PilotSeat (this craft)

`components[13]`: occupancy `frame(0,0,1) pos(5,8,5) size(1,5,2)` → world cell span
x∈[5,6], y∈[8,13], z∈[6..8 cells] + 3 m (frame_z=1), i.e. centered ≈ (−0.125, 0.375,
3.125); pivot `position` (0, **0.929**, **3.109**); `orientation` identity
`{w:1,x:0,y:0,z:0}`. The seat's pilot/camera inherits the seat's orientation, so
rotating `orientation` pitches the rider. Mirrored occupancy: `blocks[12]` (type 255,
identical frame/pos/size).

## Empirical findings (from the 12° lean experiment, Oct 4)

- Editing `PilotSeat.position` (and its occupancy + type-255 mirror) **persisted**
  in-game: the seat moved toward the tail. ✔ position edits work.
- The 12° forward lean via `orientation` was **silently flattened by the game**:
  after load/save, `{w:0.9945, x:-0.1045}` (−12°) came back as
  `{w:0.99999, x:+0.0017}` (−0.2°, i.e. snapped upright). The PilotSeat mesh
  ignores free rotation — it snaps to the grid. **You cannot lean the chair via
  `orientation`.** For a lower aerodynamic profile: move the seat (position,
  persists), and/or shape the cockpit area with `triangles` (hull) around it.
- The saved file's seat drifted to pos_z 5→7 and z 3.109→3.609 (+0.5 m), consistent
  with editor nudges; `blocks` mirror tracked `occupancies` — our save format
  emulation (see viewer) matches what the game itself writes.

## Triangles (hull) mapping — EXACT lattice (verified via game maths + XenonViewer, Oct 5)

Triangle vertices live on the **same lattice as blocks** — no fitting involved:

    world_ax = frame_ax · 3.0 − 1.5 + v_ax · 0.25
             = (v_ax + 12·frame_ax) · 0.25 − 1.5        (W=12, pitch=CELL, C=−FRAME/2)

Evidence (ISW-241, 21 triangles):

- 63 vertex usages occupy only **49 distinct slots** — shared slots are welded
  vertices (the two canopy side panels share exactly 2 slots: the hatch hinge).
- Cross-frame weld pairs: canopy top ridge stored as `(5,27,20)@frame_x 0` and
  `(17,27,20)@frame_x −1` — same v_y/v_z, Δv_x = **12** = cells-per-frame
  (dominant Δv across the corpus, 37/54 pairs); bottom counterparts at 12±2
  encode deliberate 2-slot **gaps** = openings (the canopy opening at the rear:
  welded hinge, gaped bottom — matches in-game).
- Vertex positions are exact multiples of 0.25 offset by frame·3−1.5, and the
  resulting bbox matches the craft box (x exactly, y/z inside) on every corpus
  file. **The old per-file "pitch fit" (py 0.2667, pz 0.2866) was an artefact of
  stretching the vertex span onto `box_min/box_max` — the box is not the skin's
  tight bbox. Do not reintroduce per-axis fits**; they leave the skin 3–15 % off
  the block hull, so no triangle edge meets a block edge.
- Each triangle is a closed **0.05 m prism** (game `TRIANGLE_THICKNESS_METERS`):
  `colors[0]` front face, `colors[1]` back face, `colors[2..4]` the three side
  walls along edges v0-v1, v1-v2, v2-v0. All five colours matter (ISW-241 uses
  slots 0 = hull navy, 4 = glass, 51 = chrome rims). Winding order flips the
  normal. The viewer renders the prisms per-colour; the wireframe overlay
  (“wireframe (hull + blocks)”) shows the raw triangle edges **and** the block
  face edges together — one LineSegments each, vertex-coloured.
- Render symmetry (viewer heuristic, not the game): shared slots weld (0.025 m),
  near-mirror vertex pairs average |x|, near-axis points snap to x = 0.

## Colour & materials — the game's exact semantics (verified from shader notes
in the dev's XenonViewer + the shipped `.gltf`/`.ini` assets, Oct 5)

- Palette entries `data.colors[slot]` = `{r,g,b 0..255, opacity 0..15,
  roughness 0..7, metallic 0|1}`:
  - **r/g/b are LINEAR albedo** — the engine uses `vec3(r,g,b)/255` raw.
    Decoding them as sRGB darkens everything ~^2.2 (the ISW-241 navy renders
    as a black hole). Three.js: `new THREE.Color().setRGB(r/255,g/255,b/255,
    THREE.LinearSRGBColorSpace)`.
  - transparency: `opacity < 15` ⇒ alpha = **(opacity+1)/16**, depthWrite off
    (`opacity < 8` is glass; built-in slot 4 = white/opacity 0 = clear glass).
  - roughness = value/7; metallic ∈ {0,1} and the tracer lights every surface
    with diffuse when roughness>0 even for metallic=1 (rough steel sun-lit
    bright, chrome mirror-dark) ⇒ `metalness = metallic · (1 − roughness/7)`.
  - Slots **0..10 are engine-reserved** (the reader re-imposes the built-ins);
    full built-in table in `viewer/palette.js` (from the game's BlockShapes.hh,
    same source the dev's XenonViewer generates from).
- Component painted materials: gltf materials named `color1`/`color2` take
  `components[].colors.color1/color2` (same entry format; per-component dict).
  Defaults when fields missing: color1 = white, op 15, rough 0, metal 0
  (polished); color2 = 204³, op 15, rough 7, metal 1 (matte grey).
- Fixed (non-painted) gltf materials carry real `pbrMetallicRoughness` factors,
  also LINEAR: `tire` [0.0134³, metal 0, rough 0.5], `body` [0.01..0.03³,
  metal 0], `pin` (chrome, rough 0), `data-connector` [0,0.05,0.5],
  `lv-connector` [0.5,0,0], `hv-connector` [0.5,0.15,0]. glTF defaults when a
  factor is absent: color 0.8³, metallic 1, roughness 1.
  `extract_models.py` keeps these per type in `viewer/models/manifest.json`
  under `materials`. (Wheels rendered as grey discs before this was extracted.)
- **Conditional renderables**: a Wheel/BigWheel gltf contains BOTH tire toruses
  `Torus`/`TorusReverse` plus a `mudguard`; the client mounts one torus
  (`data.reverse` picks) and the guard unless `data.mudguard === false`.
  Rendering all = double-stacked tire (the “wheels look wrong” bug).
- Component placement truth = the `.ini` node tree (RENDERABLE/JOINT/TARGET
  parents, euler **ZYX**); gltf node translations are Blender layout offsets
  (Beacon base node +0.339 z ↔ .ini −0.339 y; MiniComputer 3 m; PilotSeat seat
  pan +0.82 m) and must NOT be baked into geometry — the beacon renders at the
  game's position only with the .ini transform. Node `parent` refs may appear
  in any order: build the full node map, then link.
- `mirrorAxis` exists in files; **0 = none** (axis indices are 1=x,2=y,3=z,
  mirrored = negative scale in the component's local frame). No corpus file
  uses a nonzero value.

## Local sources of truth (no web fetch needed)

All of the above is derivable offline — a fresh session should NOT need to
fetch https://viewer.xenontools.dev/ (the dev's authoritative JS viewer; its
key semantics are transcribed above and in the code headers):

- Game assets on disk: `~/.local/share/Steam/steamapps/common/Archean/Archean-game/modules/<module>/components/<Type>/<Type>.{gltf,ini,png}`
  — per component: mesh + material factors (gltf), node tree/mass/colliders/
  joints/adapters (ini). Regenerate the atlas:
  `python3 tools/extract_models.py ~/.local/share/Steam/steamapps/common/Archean/Archean-game -o viewer/models`
  (only `manifest.json` changes for material-table updates; geometry jsons
  are byte-stable).
- The dev's viewer (`viewer.xenontools.dev`, js/{scene,blueprint,palette,blockshapes}.js)
  remains the reference implementation when a format question is genuinely new;
  anything learned there MUST be transcribed into this file + code comments so
  it stays offline.

## Live viewer: viewer/index.html + view3d.js

Zero-build Three.js (WebGL) inspector: `python3 -m http.server 8650` (repo root)
→ http://127.0.0.1:8650/viewer/index.html
- Click a component → DevTools-style sliders for position/rotation + editable
  `data` fields; live-updates the 3D scene instantly.
- `Save` (Ctrl+S) serialises in the game's exact compact format; occupancy
  `pos_*` and the type-255 block mirror are auto-synced from the position delta
  (round(delta/0.25) cells). Direct in-place save via File System Access API in
  Chrome/Edge ("Open file…" with write permission); Firefox downloads the file.
- `viewer/index.html?selftest` runs a headless-safe integration test
  (edit→serialize→verify occupancy sync + format round-trip), tab title reports.
- `?open=../testdata/<id>/blueprint.json` loads any corpus craft.
- `regtest/regtest.html` = format regression suite over **all testdata craft**:
  parse + geometry invariants + hull fit containment. Run:
  `chromium --headless=new --dump-dom http://127.0.0.1:8650/regtest/regtest.html`
  → `REGTEST: PASS` (24/24; only ISW-241 has hull triangles).
- Flight analysis: "kg / block cell" = mass per 0.25 m structural cell (calibrate
  button solves it so parts+cells = declared `mass`). Flow shows particles **and**
  streamlines (integrated through the same stylized deflection field; blue =
  freestream, red = accelerated flow. Stylized, not CFD).
- **Display poses (`applyDisplayPose`, display-only):** per-component canonical
  display quaternions, all writing back through an inverse (`userData.wheelUndo`)
  so saved quaternions stay file-exact.
  - *Wheel suspension droop:* the file stores the BUILD pose — suspension arm
    horizontal, wheel centre 0.447 m off the pivot (`SmallWheel` nodes: pivot
    +0.124 y, axle +0.323 y) — while in-game a loaded wheel hangs BELOW its
    mount. The droop rotates the component about its (horizontal) axle so the
    arm points to −y: a physical roll, the axle and tire plane are untouched,
    rolling geometry stays exact. Vertical-axle casters (ISW crawler mounts)
    can't droop about their axle and keep the file pose.
  - *FluidJunction — game pose is the only layout where cables connect
    (v0.96 revert of the v0.95 flat pose):* the .ini port frame is local **±z**
    (inlet (0,0,−0.125); outlets (±0.375/±0.125, 0, +0.125)) and `data.pipes`
    endpoints sit at x ±0.125 from the component origin (verified 0.000 m): the
    ports are on the SIDE faces — inlet faces port (view −x = LEFT), the
    4-outlet row faces starboard (+x = RIGHT) as a vertical stack at four deck
    heights, and every pipe/cable meets a port exactly. The comb body stands
    vertical (1.0 m, local x → world y). The v0.95 "flat" pose (display
    quaternion R_y(−90), row along the fuselage) put the outlets on top-ish and
    ≤0.4 m off the file's upright pipe endpoints — reverted: the file pose is
    kept verbatim. The proxy stays rebuilt to the true ±z port frame (its old
    ±y stubs were the source of the "it used to be flat" impression).
- **Aileron deflection is saved per component:** `components[].data.angle` is
  the joint angle in **DEGREES** (the .ini `[JOINT] angular_x` limits are
  −45/+45 — a radian reading of ISW-241's −4.609 normalises to +95.9°, past
  the physical joint; degrees = a gentle −4.6° droop, tip DOWN in view).
  ISW-241: front canard −4.609° (leading edge droops), rear pair ±0.0958°
  ≈ neutral (saved mid-roll, differential). Viewer: proxy `pivot.rotation.x`
  and real-model `jp.rotateX` both use `+deg2rad(data.angle)` (the z-mirror
  LH→RH flip and the 180°-z q conjugation cancel). Hinge geometry from the
  .ini: `[JOINT]` at local (0, 0.181, 0) above the plate, `aileron` renderable
  at joint + (0, 0.07, 0) — the proxy pivot sits on the joint line so the
  flap rotates about where the game's does.
- **Floating labels are parented to `compGroup`, never to a mirrored mesh:**
  GPU sprite quads under a negative-determinant (scale.z=−1) parent render
  MIRRORED text on some rasterizers (user report; SwiftShader never mirrors,
  so it is not headless-reproducible). Labels keep `userData.dy` and follow
  their component in `tick()`.

## Editing recipe (used for the seat adjustment)

Tilt forward = rotate about world **X** with a **negative** angle (Unity left-handed:
positive X-rotation tilts +Y toward +Z = toward tail; negative tips the seatback toward
the nose/−z). Quaternion for angle θ about X: `{w: cos θ/2, x: sin θ/2, y: 0, z: 0}`.
Shift toward tail = increase `position.z` (and keep grid in sync: +0.25 m = +1 `pos_z`
in both `occupancies[0]` and the `blocks` type-255 mirror). See `adjust_seat.py`.
