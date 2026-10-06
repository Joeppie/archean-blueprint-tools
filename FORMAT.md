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

**The dev viewer's convention, read from its source (viewer.xenontools.dev
`js/blueprint.js` + `js/scene.js`, Oct 5):** components are placed with the
**raw** numbers — `new THREE.Quaternion(q.x, q.y, q.z, q.w)` composed with the
raw position, no conjugate, no axis mirror. Its scene is therefore the
*mirror image of the game* (self-consistent, so it "looks perfect": the
mirror flips nose-lean to tail-lean, flips text baked in geometry, puts
ownership pads face-down, and turns dashboards 45° away from their pilots —
our users see exactly these symptoms when comparing the two viewers side by
side; they are the mirror, not a bug in either viewer). The same raw chain
places dev's adapters **0.18–0.66 m away from its own recorded cable
endpoints** (the `data.pipes` proof above), which the mirror chain nails to
0.000 m. Both viewers are valid mirror pairs; ours is the game-true side
(v0.93 `d94e867`), the dev's is the raw-numbers side. Dev extras worth
porting, transcribed here: `components[].mirrorAxis` (1/2/3 = x/y/z) = the
game's left-right symmetry flag, applied as a negative scale on that axis of
the component instance (0/null in all corpus files today); dashboard button
elements (ToggleButton/PushButton/ArrowButton/Led) are REAL glTF models from
the Dashboard folder, based at the element centre z=0.01 with a 180° Y half
turn, .ini node transform, element spin (ArrowButton `rotation`×90° Z,
ToggleButton `horizontal` → 90° Z) and state animation (switch tilts ∓45° X
± 0.005 y, button/arrow sink 0.01·state z; `led` material emissive when
lit); its pixel text is 8px XenonPixel on a fixed 6×9-px grid, binarised
(alpha>0 ⇒ lit pixel, no AA), canvas = 5 px per cm, NearestFilter, texture in
sRGB.

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
  - **IBL is mandatory for that model** (v0.144, user: "the specular/
    metallic is just too dark" — dolphin + truck): metallic=1 roughness≈0
    is a pure mirror with ZERO diffuse; sun+ambient alone leaves it with
    nothing to reflect → near-black. The game shades through a skybox.
    The viewer PMREMs a RoomEnvironment studio at
    scene.environmentIntensity 0.6 (matte/glass shift barely: dielectric
    Fresnel ~4%). Pin `metal=true`.
  - Slots **0..10 are engine-reserved** (the reader re-imposes the built-ins);
    full built-in table in `viewer/palette.js` (from the game's BlockShapes.hh,
    same source the dev's XenonViewer generates from).
- **v1-format files (23 of the 24 corpus files!) carry NO `data.colors`
  palette** — every slot references the BUILT-IN table. The legacy palette is
  four 17-colour families (white, 3 greys, 3×red, 3×green, 3×blue, yellow,
  cyan, orange, violet, magenta), one per finish: matte slots **40..56**
  (rough 7 — the dashboard/mosaic crafts live here), polished **84..100**,
  metal **128..144**, tinted glass **172..188** (opacity 2). Transcribed from
  the dev's XenonViewer `js/palette.js` (BlockShapes.hh-generated, NOTICE §2).
  v1 `components[].colors` is a `[slot, slot]` **index pair** (color1, color2),
  not a dict. Unresolvable slots render as a magenta marker — a craft "all in
  purple" means the built-in groups are missing, not that the file is odd.
  - **v1 family bases sit FOUR slots below the v2 bases** (v2 inserted 4 new
    head colours per family): v1 polished = **80..96**, metal = **120..136**,
    glass = **160..176**; matte 40..56 is identical in both generations. The
    256-slot built-in table is the v2 one, so a v1 file's indices 80-83,
    120-126, 160-171 land in the empty gaps below each family — that was the
    purple blocks (26 of the 61 corpus files). Fix = `legacySlot(i)` in
    `palette.js`: +4 / +8 / +12 into the matching v2 family, applied only for
    palette-less (v1) files — a v2 file genuinely missing slot 81 stays magenta.
- Component painted materials: gltf materials named `color1`/`color2` take
  `components[].colors.color1/color2` (same entry format; per-component dict).
  Defaults when fields missing: color1 = white, op 15, rough 0, metal 0
  (polished); color2 = 204³, op 15, rough 7, metal 1 (matte grey).
- **Dashboard geometry is GENERATED from `data` — its glTF is the 1.5×1 m
  editor template, not the panel.** Units are CENTIMETRES: the board spans
  from the local origin (CORNER pivot, not centred!) to
  `(size_x/100, size_y/100, 0.01)`; panel plane = local X·Y, normal +z.
  Elements (Label/ToggleButton/PushButton/ArrowButton/Led/screens) sit at
  `pos_*/100` with `size_*/100`, z 0.01..0.02 (+Z face carries Label text:
  pixel raster, 5 px/cm, 6×9 px char grid, 8 px font, hard alpha threshold;
  `textAlign 16` = centred). The `dataport` is the only glTF piece kept,
  re-centred at `(w/2, h/2, 0)`. Colours: `data.color` + per-element
  base/main colours are 0..255 **LINEAR** with metallic/roughness taken
  straight off 0..255 (NOT the blocks' 0-7/0|1 scales). Mosaic crafts tile
  these: 5×5 = 5 cm painted "stars" over the hull art, ~4×2 m sheets laid
  diagonally over slopes so the stair-stepped block wall reads smooth, and
  the flat interior faces get panelled solid. Viewer: `buildDashboard()`
  (ported from the dev viewer's scene.js under NOTICE §2; buttons are
  faceplate approximations, text uses a monospace face).
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
- **FluidJunction flat display pose (v0.99, cable-cache frame):** ISW-241's
  pipe endpoints (delta table, 100 pipes measured) show the junction cables
  were authored in the BUILDER's flat frame — outlets pointing UP (view +y),
  the 4-outlet row along the fuselage (view z), inlet down — with only the
  0.135 m connector-stub offset. The conjugate (file) pose stands the comb
  upright and matches NONE of these cables (the user: junctions "stick out"
  of their pipes). Display pose = mirror-conjugate file quaternion
  `(w,−x,−y,z)` = the builder/v0.91 layout: model lies flat, ports align with
  its own cached cables (selftest: inlet faces view −y). Display-only via the
  wheelUndo write-back; saved quaternions stay file-exact. No endpoint
  translation is needed (and none is done): the cables' cache frame IS the
  display frame, so they meet the flat model as recorded.
- **Recorded endpoints ARE the connection points; `.ini` adapter positions
  are NOT the visible sockets:** the game writes each cable tip at the part's
  VISIBLE socket, which can differ from the `.ini` [ADAPTER] position — ISW's
  battery cables end at the front-face socket (tip 0.06 m in front of the
  face) while the adapters are the 2×2 terminal grid on the bottom face.
  v0.99 snapped nubs to adapter positions >0.30 m from cable ends → nubs sat
  off the model connectors and taper-shifted segment paths broke the
  axis-aligned joints ("cables under the craft, broken lines"). Reverted:
  paths are drawn EXACTLY as recorded, nubs at the recorded endpoints.
  The SolarPanel ground-sphere mystery (red+blue spheres "sitting on the
  ground plane under the panel"): its two CABLE-FREE adapters (`data-port`,
  `lowvoltage-port.001`) sit 1.0 m from the panel pivot — a build-time
  flange reaching into the deck; the panel's rotation maps that to view
  y 0.03 = ground level, where nub spheres rendered as objects that "fell
  down". Viewer rule: cable-free adapter nubs are skipped when the adapter
  is >0.5 m from the part origin. comptest checks raw recorded endpoints
  (`pipeEndsV`). `PilotSeat` (editor-moved), `Beacon` (endpoints in the
  connector's upright frame) and `SolarPanel` (corner-vertex-only plate,
  cable tip at the plate edge, ~0.6 m from the nearest corner vertex) are
  exempt from the model-surface check.
- **Floating labels are parented to `compGroup`, never to a mirrored mesh:**
  GPU sprite quads under a negative-determinant (scale.z=−1) parent render
  MIRRORED text on some rasterizers (user report; SwiftShader never mirrors,
  so it is not headless-reproducible). Labels keep `userData.dy` and follow
  their component in `tick()`.
- **Beacon flash is procedural**: the gltf ships housing + mast only (no lens
  material, no emissive, `Beacon.png` is unused by the mesh) — the game shader
  animates the red flash. A plain render shows a grey pin ("beacon no longer
  looks like a beacon"), so the viewer adds a static emissive red lens sphere
  (0xff2222) at the `body` prim's mast tip on every real/low Beacon model
  (selftest `lens=true`). No animation: the render loop stays on-demand.
- **Text chirality — settled by the orient fixture (v107), not by derivation.**
  `tools/make_orient_test.py` generates `testdata/9000000001/blueprint.json`:
  six single-cell cubes (one per face: +x red, −x green, +y blue, −y yellow,
  +z cyan, −z magenta) around a centre cell, a +z-facing 1.0×0.6 m Dashboard
  labelled `TEST`, a Beacon on the +x cube with a +45° file-z quaternion, and
  a world label. Ground-truth facts (pixel-verified in the dev viewer via its
  `window.XenonViewer` capture API, front = camera on file +z): the game
  authors text **readable from the plate's +normal side** — dev renders the
  raw canvas readable from +z, and raw `R(q)` leans the beacon mast toward
  −x (green). Our z-mirrored chain therefore must **counter-mirror every
  text layer locally, never flip the world convention** (raw = pre-v0.93
  state: beacon lean/caster droop break): dashboard canvas text is
  **PRE-MIRRORED** (`translate(w,0); scale(-1,1)` before drawing — a raw
  canvas reads mirrored from the authored side through our z-mirror; v104's
  rule, v105's revert was the regression), and baked glyph prims
  (`code_button_text`, `reboot_button_text`, `code`, `subscribe`, `codein`,
  `activein`) are mirrored **in-plane about their own bbox centre**
  (`flipGeomX`: x → 2cx−x, swap winding) — a z-flip nets the raw geometry
  (= still mirrored from the pilot side; v105's bug), a flip about x=0 would
  slide off-centre strings across their buttons. Through the chain, `TEST`
  reads from +z, the mast (+red lens) leans toward the red cube, red cube
  LEFT of a +z camera, blue top, yellow bottom — the exact mirror pair of the
  dev render, on the game-true side of every data-checked fact. Selftest
  pins: `dashmirror=true` (pre-mirror pixel probe) + `textx=true`
  (`flipGeomX` centre-mirror semantics).
- **`components[].mirrorAxis` is the game's per-component symmetry mirror**
  (dev `scene.js`: `scale[mirrorAxis−1] = −1` on the component — draws the
  part geometry mirrored on x/y/z for 1 (negative) symmetry builds). Every
  corpus file has 0, so it is inert today; a non-zero value is the ONE
  genuinely per-component mirroring knob in the format (backlog: apply the
  same local scale sign so both viewers agree if such a file appears).
- **Component rotation STORAGE flips with the game generation — two
  conventions, keyed on `data.colors` (v108).**
  • **Legacy files (2024–2025, no `data.colors`): the Unity LH quaternion is
    stored RAW** — the game places parts with `R(q)` directly. Proof: the
    mosaic craft (3334698274) is a wall mural of dashboard plates; fitting a
    plane to coplanar dashboard constellations (raw normal clusters, 49 and
    17 members, position spread along the plane normal 0.26–0.32 m = the
    block-wall depth) shows every plate flush under raw `R(q)·ẑ`
    (flushfrac 1.00, |dot| 0.999 on dash 235's wall) and standing ~45° out
    of the wall under the conjugate (|dot| 0.70 / 0.00). The builder glued
    these flat in-game, and dashboard text authored readable from the plate
    side then faces the pilot (dash 84 'test' +0.57 toward seat 59 under
    raw+front=−ẑ). Raw-conversion view quat = `(w,−x,−y,z)`.
  • **2026 files (`data.colors` present): stored CONJUGATE** — ISW-241's own
    `data.pipes` endpoints reproduce only under `R(q*)` (0.000 m, comptest
    60/60; beacon lean, caster droop, junction flat-frame all verified).
    View quat = `(w,x,y,−z)`.
  The key is structural (palette feature = same game update as the
  serialization change); corpus: 24 palette-less files (2024-08..2025-07)
  raw, the one 2026 file conjugate. Dev-viewer consequence (explains
  long-standing confusion): raw placement is CORRECT for legacy files —
  the dev renders the 2024 mosaic "perfectly" — and 45°-tilted for 2026
  craft (its ISW dashboards/battery lean); we are game-true for both.
  Selftest `mural=true` pins the legacy side. `viewQuat`/`rawFromView`
  switch on `LEGACY_Q` (set in `setModel`); saved files stay byte-exact.

## Propulsion & the viewer's wind model (v0.122)

Thrust axes (from each propulsor's game `.ini` `[TARGET plasma]/[thrust]`
nodes; a TARGET `rotation = -90 0 0` maps node-forward (−z) to local −y):

| type | local thrust axis | class weight |
|---|---|---|
| BigThruster | (0,−1,0) | 1.0 |
| MiniThruster | (0,−1,0) | 0.4 |
| SmallThruster | (0,+1,0) | 0.15 |
| RCS | (0,0,−1) | 0.25 |
| Propeller | (0,−1,0) | 0.6 |

Blueprints store no newton figures — weights are display ratios. **Propellers
thrust BOTH ways** (user-verified behaviour): their arrows render double-headed
and they are EXCLUDED from the net-thrust vector. Net = Σ axis·weight over
rockets; |net| < 0.15·Σweight ⇒ "net ~0 (symmetric bank)" (ISW-241's 9 RCS do
this) and no direction is suggested.

Relative wind = −flight axis. The axis comes from flow-src `auto` | `seat` |
`thrust`, yawed by the "wind from side" azimuth slider and elevated by AoA
(props reverse → the direction stays user-controllable, `?flowsrc=` presets it).
**`auto` uses only the MAIN drive net (BigThruster); RCS and Mini/Small
thrusters are attitude/landing jets and must NOT set the direction** — the
ISW's landing-thruster net points down, and auto flow "from below" was the
user's complaint; RCS-propelled craft have no main drive, so `auto` falls back
to the COCKPIT: "cockpits almost always face in the right direction". On
contested (multi-seat) craft the PilotSeat REACHING a Computer/MiniComputer/
OwnerPad over the `data.pipes` graph (`p.a_component`/`p.b_component` edges)
wins — the editor wires the pilot's cockpit to the flight computer. Manual
`thrust` mode = user override, full net incl. RCS.

Voxel wind grid (viewer, VIEW space, 0.25 m cells): cell index =
`pos + 12·frame − 5.5` (z mirrored). Sources: blocks (type≠255), component
`occupancies`, **Build subgrid blocks** (a closed hatch stores its real blocks
at true grid coords → they seal; the Build component's OWN occupancies are the
construction-site ghost far outside the bbox → skip), and hull-triangle
surfaces rasterized at 0.11 m sampling (exact lattice `(v+12f)·0.25 − 1.5`).
NEVER add `frame·3.0` on top of `(12f)·0.25` — that double-pitch bug put every
cell 3 m off per frame (v0.117 shipped with it).

Sealing = flood-fill from the padded bbox corner (unreached cells are windless)
**plus a ray-enclosure pass**: flood-reached cells that have solid on all six
axial rays are CABIN (windless). Block-built shells leak through intakes and
gaps, so flood alone under-seals; enclosure rescues e.g. BionicDolphin
(testdata/3417786605 → ~230 cabin cells), while ISW-241 is an open-tail tube →
0 cabin cells, correctly wind-swept. Selftest `seal=true` pins the dolphin case
via pure `sealStats(data)`.
CAUTION (v0.129 fix): grid index is `(y·n[0]+x)·n[2]+z` — decode MUST use
`x = t % n[0]; y = t / n[0]`. Decoding with `n[1]` strides (as the flood,
enclosure ray and sealedSample all did) phantom-connects the 6-neighbour flood
on non-cubic grids: sealed interiors read as wind-open (the mosaic craft's
"leaked cabin" — its shell never leaked; true counts: mosaic 36,442 sealed,
dolphin 2,696, ISW 0).

`sampleVel` returns 0 velocity in windless cells (streamlines break, particles
respawn outside the hull). Turbulence = animated sinusoidal field, amplitude ∝
wake/shear (|v|/V − 1 × turbulence slider; particles and their trails shade
blue→red-magenta with local turbulence.

**Wake deficit (v0.138, stylized — not game data):** inviscid thin-plate flow
has no separation: behind a blunt hull the air ran at full freestream, so the
flow *visually ignored the geometry* (user: "things magically happen 10 m in
front, nothing responds"). sampleVel now walks up to 3 m UPSTREAM along the
flow dir; the first solid cell casts a downstream deficit cone: v ×= 1 −
0.6·e^(−d/3.5 m) (4th return value = deficit fraction). Downstream-of-mid-plane
only for the streamline billow (gate `wake>0`): the old gate fired on >2 %
ACCELERATION = on the nose = waves in clean inflow air. Colours: the deviation
map uses ABSOLUTE intensity (gain 2·V/(V+40)) — dynamic pressure scales V², so
the ramp is muted at 25 m/s and saturated at 150 m/s (the honest speed-slider
response: inviscid pattern SHAPE is speed-invariant, unsteadiness ∝ V lives in
the wake billow, amplitude `wm·V·0.45·min(1.6, V/60)`). Pins: `inflow=true`
(no line vertex upstream of mid-plane deviates >0.45 m from its seed ring),
`wake=true` (1.5 m behind the tail |v| < 0.75V, ahead of the nose ≈ V).

**Physics LOD (v0.137):** particle count tiers on solid-cell count (the
measured cost driver — Map lookup pressure: 237 k cells = 13 ms/frame at
2200): 2200 ≤100 k, 1400/900 ≤400 k, 500 above; aero-plate count guards
triangle-heavy hulls. Mirrors the game coarsening physics on big crafts;
the report says `sim N pts (large-craft approx)`. Pin `windpts=true` (2200
on normal crafts). Picking: ONE raycast per deliberate pointerdown (no
hover raycasts — user perf rule), pin `click=true`.

## v1 legacy files + real-model author space (v0.143)

The 23 palette-less corpus files (v1, 2024-25) decode through THREE format
conventions, all keyed on the same `LEGACY_Q` predicate (no `data.colors`):
1. Rotations: RAW Unity LH quaternions (`viewQuat` switch, see Handedness).
2. Positions: `components[].position` is direct METRES (float, e.g. 3.725000
   001490116), not quantized `pos_*`+`frame_*` — `viewPos` takes it as-is.
   Occupancies still use grid `pos_*`+`frame_*`, craft-local (small frames).
3. type-255 occupancy mirrors sit on each part's BUILD-TIME builder grid:
   they can be 1-2 frames (3-6 m) off the craft grid (mosaic lamp 3.5 m).
   NEVER draw occupancy boxes from them — `components[].occupancies` is
   craft-local and contains the component pivot in BOTH formats; the viewer
   occ-box overlay iterates components (the 255 mirror stays data-only,
   selftest keeps it in sync for edits).

Real-model geometry is authored in Blender/gltf export space, related to
Unity by Unity = (gx, −gz, gy) — proven by every .ini [RENDERABLE] position
equaling its gltf node translation under that mapping (Crafter ini
(−1.014, 0, −0.728) vs gltf (−1.014, −0.728, 0)). Stored prims are raw, so
buildRealComponent pre-rotates −90° about x (`ROT_AUTH2UNITY`): author →
Unity raw, which the z-mirror chain maps correctly. Pre-fix, parts with
asymmetric author-space layouts rendered rotated/mirrored (mosaic Crafter
stood up, Crusher jaws shifted — user); ISW parts hid it (axis-symmetric).
Dashboard prims are EXEMPT (plate generated in Unity space, mural pin
proves text shares it). Single-mesh fallback renderables (extractor: parent
null, position 0) apply their gltf translation as Unity (gx, −gz, gy).
Pin `legacyfmt=true`: Crafter 2 m axis horizontal at identity + lamp occ
box contains the pivot.

## Display anchoring + wind seat rule (v0.140)

Blueprints store the builder's world position (`frame·3.0` — Jimmy sits at
x = 1102 m). The viewer normalizes this away: `model.moff = -3·min(frame)`
shifts the scene groups, `model.cv = +12·min(frame)` shifts every point→cell
decode (round/floor of exact multiples stays exact). Saved files and all
reports keep raw coordinates. ISW and most corpus crafts are anchored at
(0,0,0): moff = cv = 0, bit-identical rendering.

Wind seat rule: the cockpit-first flow direction uses the seat's HEADING
(yaw) only, unit length — a chair's pitch/roll is a comfort axis; pitching
the seat must not steer or slow the wind (was: reclining the ISW seat shrank
the un-normalized flow vector → wind "changed direction and speed", user).
Pin `seatpitch=true`.

## Editing recipe (used for the seat adjustment)

Tilt forward = rotate about world **X** with a **negative** angle (Unity left-handed:
positive X-rotation tilts +Y toward +Z = toward tail; negative tips the seatback toward
the nose/−z). Quaternion for angle θ about X: `{w: cos θ/2, x: sin θ/2, y: 0, z: 0}`.
Shift toward tail = increase `position.z` (and keep grid in sync: +0.25 m = +1 `pos_z`
in both `occupancies[0]` and the `blocks` type-255 mirror). See `adjust_seat.py`.
