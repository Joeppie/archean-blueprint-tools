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
| `version` | container version — **always 1 in the whole corpus** (incl. ISW-241); NOT the v1/v2 discriminator (see §V1/V2 audit below) |
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
**⟵ RETRACTED 2026-10-21 (v1.5.11).** That measurement was taken through the pre-v0.180
MIRRORED display chain (mirrored positions + mirror-conjugated quats + z-flipped
adapter locals) and its conclusion — a generation-keyed conjugate READ law — did not
survive re-measurement in the raw file frame: re-running the endpoint comparison over
the whole corpus (6309 pipe-port pairs, correct .ini node-chain composition) puts BOTH
laws far from 0.06 m (medians 0.29–0.39 m) with RAW scoring strictly better on V1
(279 vs 182 hits) and no worse on V2. The 0.000 m figure was a property of the removed
mirror chain, not of the file. The placement law is now ONE RAW LAW for every
generation — see the v1.5.11 ruling below.

**The de-mirrored display chain (v0.180, 2026-10-19 — see §"Chirality vs
in-game truth" below, which is the arbiter):** the game projects the RAW
file frame with standard right-handed camera math, so the viewer renders
file coordinates directly —

    view_pos  = (x, y, z)           view_quat (EVERY generation) = (w, x, y, z)  [raw q]

— since v1.5.11 (2026-10-21) ONE raw placement law for palette AND
palette-less files (the old LEGACY_Q conjugate/raw split is RETIRED — the
v1.5.11 ruling below is normative), applied WITHOUT any axis mirror.
`model.data`, the
serialized save, the inspector's numbers and all reports stay in raw file
space, and component *local* geometry keeps raw `.ini`/gltf numbers with
**no** root mirror (the historic `scale.z = -1` + emit-time z-flip chain,
v0.93→v0.179, rendered a horizontal MIRROR IMAGE of the game — every pin
then passed because each was reflection-invariant). `?selftest` asserts the
beacon mast points nose-ward (raw −z) so a regression to raw-`q` placement
on modern files fails the suite, and the `liver` pin (airliner 3309955432
livery raster reads U-N-I-T-E-D from file −x) cannot pass under a mirror.

**ERRATUM + HARD RULE (2026-10-20, user in-game reports):** whatever the
conjugate/raw READ law per generation, the game STORES orientation values
VERBATIM across generations and re-saves: ISW-241's workshop file
(3518436870, 2025-07, no palette) and the game's own 2026 palette re-save
(3812927875) carry BYTE-IDENTICAL `orientation` values for the same scene —
the game never converted the quats when it embedded the palette. The app's
open-time v1→v2 migration (normalize rule 4) conjugated every quaternion of
a palette-less craft and saved the result, so such exports loaded into the
game FLIPPED: the caster wheel spawned ON TOP of its strut (image:
`blueprint - 2026-10-20T175450.486.json`), Jimmy's (3334698274) two-axis
dashboard murals tore apart, while single-axis/180° parts (whose conjugate
IS the same rotation) stayed fine — the exact symptom profile users
reported, including the "rotation of the dashboards wrongly ordered" L/R
probes. Rule 4 is DELETED: open→save keeps every `components[].orientation`
byte-exact (`savefidelity.test.ts` + `e2e/savefidelity.spec.ts`, fixture
`testdata/9000004001` = the game-written two-axis L/R dashboards). The
migration keeps ONLY the palette/color conversion (what the game itself
does on re-saves).

**V1.5.11 RULING — ONE RAW QUATERNION LAW (2026-10-21, NORMATIVE).** The
palette-keyed V2-conjugate READ law is DEAD: the game places components as
`world = position + R(q)` with the STORED quaternion AS-IS, for palette AND
palette-less files alike ("legacy" differs ONLY in colors + the colors
shape). The arbitration set, all game-built files that load perfect in
game (the only sanctioned arbiter — in-game pixels):
  • IAS-418 `testdata/9000005001` (the user's `testframe.json`, a fresh
    2026 PALETTE-BEARING craft: deck + corner-block pyramid + 8 dashboards
    drawn onto the faces): under RAW every board normal sits EXACTLY on a
    block face plane (|dot| = 1.000, ≤ 0.13 m to the surface; the 5-board
    asterisk + the two deck boards + the side board); under the conjugate
    the same boards skew through the deck (|dot| ≤ 0.94) — the user's
    screenshot of 2026-10-21. Pinned by `placement-law.test.ts` +
    `app/tools/flushcheck.mjs 9000005001` (live-scene audit, PASS).
  • `testdata/9000004001` (game-written two-axis L/R dashboards): raw lands
    the boards corner-to-corner flush (1.5 cm); conjugate misses by 1.46 m.
  • ISW-241's two saves (V1 3518436870 + V2 re-save 3812927875) keep
    BYTE-IDENTICAL orientations for the same scene — the game converts
    nothing across generations, so identical bytes MUST display identically;
    the two-law split made our OWN corpus render one craft two ways.
  • The engine's own export-fidelity finding (v1.5.10): the game placed our
    open-time-CONJUGATED exports flipped (wheel on the strut, murals torn)
    — i.e. it read the written bytes RAW.
  • The corpus-wide pipes re-measurement (above) shows the old 0.000 m
    proof was a mirrored-chain artifact, with RAW ≥ conjugate everywhere.
What remains true: the STORED numbers are Unity left-handed quaternions —
but the file's coordinate numbers are read consistently in that same LH
frame, so a right-handed renderer that plots positions as raw numbers gets
the game's (mirrored, §Chirality) view with the RAW quaternion; conjugation
would place the parts in the MIRRORED world, which is exactly the "united
reads backwards / dashboards skew" mismatch. Consequence for tooling: any
Euler-order or yaw-pitch-roll round-trip on an orientation is FORBIDDEN —
quaternion bytes ride untouched (v1.5.10 hard rule, unchanged).

**The dev viewer's convention, read from its source (viewer.xenontools.dev
`js/blueprint.js` + `js/scene.js`, Oct 5):** components are placed with the
**raw** numbers — `new THREE.Quaternion(q.x, q.y, q.z, q.w)` composed with the
raw position, no conjugate, no axis mirror. Per the game's own workshop
screenshots (§Chirality vs in-game truth, 2026-10-19) that raw-numbers scene
IS the game's view for positions, identity mounts and unrotated text — the
dev's one deviation is ROTATED parts in V2 files, where the game places with
the CONJUGATE and the dev's raw quaternion mirrors the part. ~~(The pre-2026-10
narrative here claimed the dev's scene was "the mirror image of the game"
and ours the game-true side — that direction was BACKWARDS; the old z-mirror
chain was the mirror image, and the symptoms users saw when comparing
viewers were that mirror.)~~ Both viewers now agree with the game on the same
side (ours since the v0.180 de-mirror); ~~for rotated V2 parts the dev's raw
chain additionally places its adapters away from its own recorded
`data.pipes` endpoints (the conjugate law nails those to 0.000 m — the proof
above).~~ **v1.5.11: the dev's raw-quat placement is correct for rotated V2
parts too** — its "documented own bug" never existed; it was measured against
our conjugate law, which is the law that was wrong (§Handedness v1.5.11
ruling). Dev extras worth
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

- **Left-right symmetry in the file is GEOMETRIC (v0.160 decode).** The
  editor's mirror tool writes the twin as a SEPARATE component of the same
  type at a mirrored `position` (x flips, y/z identical): dolphin's twin
  tail-door hinges are `SmallHinge[29]/[49]` at x=±1.125; twin `Build`
  (subgrid) pairs exist in 12 of the 25 corpus crafts (XYQ-615:
  `Build[5]/[41]` at ±0.635 = the door pair). The twin's `orientation` is
  NOT forced-mirrored (the dolphin hinges mount 90° apart — builder
  geometry, not a file law), so the viewer's gizmo moves propagate the
  MIRRORED DELTA (dx,dy,dz)→(−dx,dy,dz) in the file frame — which since the
  v0.180 de-mirror IS the view frame) and leave each twin's pose and joint
  state its own; the
  twins' occ/type-255 mirrors follow the save-time per-component delta
  shift. `mirrorAxis`-flagged parts (the gantry craft: 21 entries) are
  SELF-MIRRORED instances — a single entry renders both halves.
  v0.161 makes propagation a SWITCH: the mode widget's ⇄ button toggles it
  (persisted), and propagation auto-disables for a PAIR THAT NO LONGER
  MIRRORS — twin pairs are indexed at load time (clean baseline), and at
  every position edit (gizmo writeback AND the inspector position sliders,
  v0.162) the twin list is filtered by CURRENT mirror-alignment (all axes
  within 5 cm: a manually nudged twin breaks it), evaluated BEFORE the
  mover's own file write. The viewer also draws the symmetry
  plane x=0 on symmetric crafts (striped sheet + frame + ⇄ arrows, resting
  on the ground plane; View-Options "mirror plane" toggles it).
  v0.164 makes propagation VISIBLE: while ⇄ is live and the pair aligned,
  the twins CO-SELECT — they glow with the selection (the shared pulsing
  x-ray overlay covers twin meshes, and twin SUBGRID groups too) and the
  first twin gets its own golden outline box; twin subgrid groups also
  ride the mirrored delta in the 3D scene (their `base.p` is the file
  frame, so the same (−dx,dy,dz) applies, then joints re-compose — before
  this a twin Build moved in the file only, invisible in the viewport).
  v0.165 extends propagation to ROTATION: a mirror reflection CONJUGATES
  rotation deltas by R180° about the mirror normal x̂, so a delta
  dq=(w,x,y,z) maps to (w,x,−y,−z) — spins about x̂ (roll; the aileron
  hinge, the wheel axle) are mirror-INVARIANT (rolling a wheel back
  rolls its twin back), spins about ŷ/ẑ flip sign; the same formula in
  the view and file frames. Hooks: the rotate gizmo (the
  incremental drag delta), the inspector rotation sliders (absolute
  qd·q0 writes → twin delta against a base-pose snapshot captured at the
  FIRST edit of the gesture) and the master-part writebacks (a twin
  subgrid group `base.q` + file quat re-composes through its joints).
  Twin POSES stay independent —
  only the delta propagates (builders orient twins freely: the dolphin
  hinges mount 90° apart). v0.165 SHIPPED the full quaternion conjugate
  (w,−x,−y,−z) — the mirror-normal component flipped too, so twin
  WHEELS rolled opposite (user report); its pins only tested ŷ/ẑ.
  v0.166 generalises the whole subsystem to a per-pair MIRROR MASK:
  symMaskAt classifies every axis of a same-type pair as mirrored
  (|a+b|≈0, off-plane) or equal (|a−b|≈0; on-plane counts as equal —
  the centreline rule per axis), requires ≥1 mirrored axis and no
  unclassifiable axis. Left-right = mask 1 (x), so every v0.160 pair
  keeps its exact behaviour; y (top-bottom, e.g. the mosaic truck),
  z (nose-tail), two-axis (180° twist) and three-axis (point) pairs
  work by the same law. Position deltas flip the mask axes; rotation
  deltas take md = det(S)·S·dq (S = diag(−1 on mask axes)) — one axis
  reproduces the R180-normal conjugation above, and drift
  auto-disable = the live (5 cm) mask must equal the indexed mask.

### V1/V2 flavours — definition table, corpus census, mirror verdict (audited 2026-10-19)

**What actually separates the two generations.** Neither the top-level
`version` (always **1** in every corpus file, ISW-241 included) nor
`data.version` (always **2**, also on the 2024 files and the synthetic
fixtures) discriminates. The single structural key is the **presence of a
non-empty `data.colors` palette** — the same game update that introduced
palette editing also changed the rotation serialisation and the component
colour shape:

| property | V1 (legacy, 2024–25) | V2 (2026) |
|---|---|---|
| `data.colors` | **absent/empty** → built-in palette | present, 256 entries |
| `components[].orientation` | Unity LH quaternion **RAW** | **RAW too** (v1.5.11: one law; the old "conjugate" claim was a mirrored-chain artifact) |
| `components[].colors` | `[slot, slot]` **index pair** | `{color1:{…}, color2:{…}}` dict |
| finish-family bases | polished 80, metal 120, glass 160 (matte 40 shared) | **identical table** — v1.11.0: XenonViewer `js/palette.js` (fetched 2026-10-25) carries the families at 40/80/120/160 for BOTH generations; the old "v2 bases 84/128/172 + `legacySlot()` +4/+8/+12" row was a transcription offset of THIS repo's table, RETIRED (identity) |
| view-quat chain (v1.5.11) | stored quat **as-is** `(w,x,y,z)` | stored quat **as-is** `(w,x,y,z)` (pre-v1.5.11: conj `(w,−x,−y,−z)` — RETRACTED; pre-v0.180: `(w,−x,−y,z)` / `(w,x,y,−z)` mirrored view) |

**Corpus census (111 files under testdata/, 2026-10-19):** all are
`version:1` + `data.version:2`. 60 workshop craft split **51 V1
(palette-less) / 9 V2** (`3278744757, 3326372833, 3445304576, 3468267043,
3510792645, 3521588534, 3732302108, 3803780241, 3812927875` — every V2 file
also carries dict comp colours, every V1 file pair colours). 51 synthetic
fixtures (`9000000001`, `90000010NN`, `90000020NN`) carry a full palette +
dict-level V2 keys **but `[slot,slot]` comp-colour pairs** (`colors:[0,3]`
from `tools/make_matrix_test.py`) — a legal hybrid: the colour PAIR branch
must key on the SHAPE of `comp.colors` (`compColor`'s
`Array.isArray(comp.colors)` test), NOT on palette presence. The fixtures'
quaternions are all identity (matrix law: identity mounts only), so raw vs
conjugate is convention-invariant there and neither viewer can tell them
apart. ~~The palette↔quat coupling is verified on the two proof craft only
(mosaic `3334698274` mural flushfrac 1.00 RAW; ISW `3812927875` pipes
0.000 m CONJ)~~ — v1.5.11: the quat half of that coupling is VOID (one raw
law, §Handedness); the palette + colours-SHAPE split above stands. The
palette key now drives ONLY the wheel-droop display gate (colour
resolution is generation-blind since v1.11.0 — one built-in table, no
`legacySlot()` shift), never
placement; every law probe craft (`9000004001`, `9000005001`) reads raw.

**Mirror verdict for the "every scene seems MIRRORED" report (dev|ours
sheets).** ~~Expected, not a bug: our z-mirror chain renders the GAME's
view, the dev's raw placement renders its MIRROR image.~~ **SUPERSEDED
the SAME DAY (§Chirality vs in-game truth below): the chirality
DIRECTION was wrong. The game's own workshop screenshots prove the DEV's
raw render equals the game's view and OUR z-mirror chain renders its
horizontal mirror image.** This audit only had the two viewers to
compare and no external arbiter. The OBSERVED relation stands (dev|ours
screens related by one horizontal flip at the M-paired camera, which
`tools/matrix_iou.py`'s mask mirror compensated — RETIRED with the v0.180
de-mirror: ours now renders the same side as the dev, so the masks compare
directly). Two
further sheet effects must not be confused with it: ~~(a) on **rotated
mounts in V2 files** the DEV mirrors the part itself (raw-quat bug,
matrix triage step 8 — fixtures are identity, so matrix rows never show
it; per the pipes/mural data proofs the GAME places rotated V2 parts
with the CONJUGATE, so here dev ≠ game — this remains the ONE live
divergence)~~ — **VOID v1.5.11**: the ONE raw law is the game's law for
BOTH generations (§Handedness), so the dev's raw placement AGREES with
the game and (a) was never a divergence — the pipes-0.000 m / mural
"conjugate proofs" it leaned on were mirrored-chain artifacts; (b) **deflected**
twins (`90000020NN`) differ because the dev renders parts AT REST while we
apply `data.angle`/`data.pos` — ours-only by definition (triage step 5).
A flip maps faces to faces, so it can NEVER make geometry appear on one
side and vanish on the other: a symptom like the **9000001007 Dashboard
row** ("TEST" Label visible in dev, not in ours) is NOT the flip — the
mount is identity (convention-invariant) and the Label data is present
(`{type:Label,text:'TEST',state:0}`); it points at our dashboard
text/SIDE path (the `dashmirror`/`textx` pre-mirror rules) or the staged
camera side, and needs one eyeball pass on the PNG pair to bind.
**LIKELY RESOLVED by the v0.180 de-mirror:** with the raw +z-face canvas and
both viewers on the same side, our sheet should draw the 'TEST' label like
the dev's — CONFIRM on the next `bash tests/matrix.sh 9000001007` re-shoot
before closing it out.

**DECISION (user, 2026-10-19): the viewer/app support V2 semantics
internally; V1 files get an ad-hoc LOAD-TIME conversion.** Implemented in
`app/` as `app/src/engine/normalize.ts` (`normalizeDoc`, called at open in
`Editor.tsx`): embed used built-in entries at their v2-base indices, remap
block/triangle slots through `legacySlot`, pair→dict comp colours, recurse
into Build subgrids, bump `data.version=2`; saving a converted file writes
the V2 form (intentional migration — such a file no longer round-trips
byte-identical to the game's original). ~~The conversion also rewrote
orientations `q' = {w,−x,−y,−z}` (the "rule-4 conjugation", with a
FluidJunction exemption to keep the legacy comb flat)~~ — **DELETED
v1.5.10**: the game round-trips quaternion bytes VERBATIM, so a rewriting
converter placed the flipped rotations in game (ISW caster wheel on TOP of
its strut, Jimmy's two-axis murals torn apart); orientations are now
UNTOUCHED at open AND save (the savefidelity pins). The FluidJunction
flat-comb display rule stands on its own: "display = R(the as-written
file quat)" for both generations, which needs no conversion step to keep
the legacy comb flat (viewer-side pinned by postest rcs-fj-flat/-touch).
The file's GENERATION is still read before the migration and carried on
the live bp (`__legacyQ`) — since v1.5.11 it keys palette resolution and
the wheel-droop gate only, never a rotation law.

### Chirality vs in-game truth (2026-10-19) — VERDICT B CONFIRMED; DE-MIRRORED IN v0.180 — this section is NORMATIVE

**The question (user):** the game renders with a custom raytracer in a
Unity left-handed world — maybe everything it shows (dashboard text
included) is mirrored in world space and only "un-mirrored" by the
game's own camera, in which case any third-party viewer is chasing an
unsolvable mirroring, and the dashmirror/textx rules + the "we show the
game's view" claim may have the sides backwards.

**The epistemics first.** File space IS the game's physical world — the
pipes/mural proofs pin placements to 0.000 m, so left/right in FILE
numbers is physically real to the in-game builder. The engine's screen
IS the ground truth a human sees; there is no un-mirrored "true world"
behind it to chase. The whole question therefore operationalises to one
measurable fact: **does a viewer's render match the game's rendered
pixels from the same physical camera?** All offline evidence so far
pinned PLACEMENT — chirality-free under a global reflection — never
this. The orient fixture (v107) "pixel-proved" "+normal readable"
against the DEV viewer's capture API plus the ASSUMED front (file +z),
never against an in-game image: it pinned us to the dev's convention,
not to the game.

**The external arbiter — workshop craft 3309955432 "United Airlines
Airliner" (DOMINATOR), in-corpus, workshop gallery shots rendered by the
game's own engine**
(https://steamcommunity.com/sharedfiles/filedetails/?id=3309955432;
described here, images not stored — NOTICE §2):

- **Cockpit POV shot:** the pilot looks toward the NOSE = file −z (the
  cockpit sits at z≈−12, the cabin extends aft to the "VIP ONLY"
  partition at z=+26). The red quadrant + "Throttle" plate — data.label
  at **x=−0.13** — appears on the IMAGE LEFT; the second ThrottleLever
  (file x=+0.125, green quadrant, plate relabelled "Trim" by the author)
  on the image RIGHT; every text element (dash Labels, data.labels
  plates, the "This plane is very fuel hungry…" note at comp 356,
  x=−2.1, image LEFT) reads CORRECTLY. The "Main Power Breaker" label
  (dir=+z, facing aft toward the pilot) reads correctly from the seat ⇒
  data.label `dir` = the readable face, in-game. ⇒ **the game's screen,
  for a camera facing file −z with up +y, has its right side at file
  +x: the game projects the raw file frame with STANDARD RIGHT-HANDED
  camera math** (Unity's built-in LH camera would put Throttle on the
  right). The "LH quaternion" story was always a PLACEMENT fact
  (conjugate vs raw q); the game's custom raytracer does not use Unity's
  LH camera projection.
- **Ground side views (nose left, upright, gear down)** show the blue
  pixel-block "UNITED" livery reading CORRECTLY — with the RH screen
  fact above, the side shown is the file **x<0** side. The livery is
  NOT text: solid-colour Dashboard plates (baseColor (2,2,32)) arranged
  as pixel-font U-N-I-T-E-D strokes at x≈−2.8..−3.3, y 12.2..13.4,
  z −6.6..+1.5 (U at the nose end), tilted with the fuselage
  tumblehome, normals outboard. The x=+3 side carries a SEPARATE
  hand-plated spelling — the two sides' plate z-clusters are NOT
  mirror-equal, the builder painted both sides to read correctly from
  their own outside (like real livery; `symmetry_axis` notwithstanding).
- The two EMERGENCY EXITS labels (dir=±x INBOARD) read correctly from
  the cabin aisle in another shot — again `dir` = readable face.

**The two viewers at the same physical cameras** (probes
`app/tools/sidechir.mjs` + `app/tools/devchir.mjs`, re-runnable;
iGPU-pinned headless chromium, ours via the HARCHEAN hooks with
H.select(-1); dev driven through its `window.XenonViewer.open()/capture
({azimuth,elevation})` capture API — its azimuth is the camera DIR in
RAW file space, az=−90° ⇒ camera on the −x side):

| view | GAME (workshop photos) | DEV (raw numbers) | OURS (z-mirror chain) |
|---|---|---|---|
| fuselage −x side | UNITED READABLE, nose left | UNITED READABLE, nose left | **DETINUD mirrored** |
| fuselage +x side | (separately painted readable) | UNITED READABLE | **DETINUD mirrored** |
| cockpit seat | note panel (x=−2.1) IMAGE LEFT, text readable | — (same side by construction) | note panel IMAGE **RIGHT**, text still readable ⇒ scene MIRRORED, text locally counter-flipped |
| iso pair (dev az 51.56°/el 25.78° vs ours ISO_DIR z-mirrored cam) | — | reference | mirrored image |

**Verdict B: our display chain renders the game's view horizontally
flipped.** The dev's raw-numbers render IS the game's view (positions,
identity mounts, unrotated text always; ~~for ROTATED parts in V2 files
the dev still uses raw q — its one known deviation from the game, whose
data-pinned placement is the conjugate~~ — v1.5.11: the dev's raw-q rotated
placement equals the game too, it had no deviation). Our scene is exactly M(file)
(M = z-mirror) rendered RH. Every selftest/postest/comptest pin is
INVARIANT under a global reflection (nose-ward, below-pivot,
flush-to-wall, endpoints-on-pipes), so the whole suite stayed green
across the mirror's entire life (v0.93→). The text rules then read as
what they are: `dashmirror`/`TEXT_MIRROR_X` pre-flip glyph strings
INSIDE the mirrored world — a local double-mirror that keeps text
readable while the surrounding scene stays flipped; they made the
mirror self-consistent-looking from inside. v107's finding "the game
authors text READABLE FROM THE PLATE'S +NORMAL SIDE" is TRUE (the s2/s7
screenshots confirm it via the labels' dir faces) — and dev shows it
too; what v107 never measured was WHICH side of a plate the GAME shows
text on from a given camera, because its arbiter was the dev's pixels,
not the game's.

**The corrected model of the game's pixels** (reconciles ALL evidence —
mosaic murals, label readability, livery, cockpit, and since v1.5.11 the
pyramid/dashboard flush probes; the old "pipes 0.000 m" datum is retracted,
§Handedness): raw file POSITIONS, NO world mirror, standard RH camera;
rotations **R(q) AS STORED for every generation** (the LEGACY_Q table is
RETIRED v1.5.11 — one raw law); dashboards = RAW canvas on the
board's +z face (readable from +z, text-up = local +ŷ, string advances
+x̂ — verified readable in the game's own s2 dash; comp551's mount quat
maps ŷ to the up-aft slope, consistent); labels readable from the dir
face with right = (−dir)×up — which is exactly the dev viewer's
`buildLabels` basis x = up×dir (transcribed from viewer.xenontools.dev
`js/scene.js`, NOTICE §2) — and its dashboard Label texture chain
(5 px/cm, +z face, no pre-mirror), matching game readability in the
same screenshots.

**Consequences:**
- *Harness (matrix ritual):* pre-v0.180 devscrape's ISO_DIR = M(dev cam) was
  the right pairing (our mirror ⇒ one flip, compensated by matrix_iou's mask
  mirror). **LANDED v0.180:** the de-mirrored viewer's view space IS file
  space, so ISO_DIR is the dev camera direction UNMIRRORED and
  matrix_iou.py compares masks directly (its mirror was retired — keeping it
  would double-flip). The flip observed in 4882dcc belonged to the mirror
  era; only its stated reason was backwards.
- *Today's V1/V2 audit (d1b4085):* its "Mirror verdict" paragraph is
  SUPERSEDED (struck in place above); the rest (census, palette/quat
  table, normalizeDoc analysis) is chirality-neutral and stands —
  normalizeDoc's q→q* with V2 re-save preserves placement under either
  display chain.
- *The viewer/app themselves:* LANDED v0.180 (2026-10-19, user-approved) —
  see the corrective plan below, marked step by step.
- *Epistemic rule going forward:* the mirror was invisible to every
  data-driven test ever written — only in-game pixels can bind
  chirality. Future chirality claims MUST cite a game screenshot. The
  v0.180 suite encodes the rule: the selftest `liver` + `orienttext` pins
  CANNOT pass under a mirror (liver even reports `raster reads DETINUD
  (mirrored!)` explicitly if the scene flips again).

**Corrective plan (de-mirror) — APPROVED and LANDED in v0.180 (2026-10-19):**
1. Display chain (`viewer/view3d.js`; the app port mirrors it): drop M —
   view_pos = raw pos; view_quat: V2 = q* = (w,−x,−y,−z), V1 = raw q
   (the LEGACY_Q table's placement law, without the mirror
   conjugation); local geometry drops `scale.z = -1` and the winding
   compensations it implied (hull-triangle z-flip on emit, blockshape
   face winding, basis flips). The scene then equals the corrected
   model above.
2. Text: REMOVE the `dashmirror` canvas pre-mirror and `TEXT_MIRROR_X`
   `flipGeomX` (raw canvas reads correctly un-mirrored, per s2).
   data.labels stay unrendered, or get a first implementation using the
   readable-from-dir rule.
3. Writebacks: `rawFromView` and its ±z signs collapse to identity;
   gizmo writebacks (`gizmoSpinRing`, `applyGizmoOrientation`, the
   P·Ry(π) proxy trick) become plain q math; symmetry mask deltas — the
   file-frame (−dx,dy,−dz) variants become the view-frame (−dx,dy,dz);
   rotation conjugation md = det(S)·S·dq unchanged; mirror-plane
   overlay, cables/adapters unchanged.
4. FluidJunction `applyDisplayPose`: re-key displayQuat to read the
   view-frame quat under the new chain (RCS-infinity postest recheck).
5. Pins that flip sign/expectation (~30): selftest beacon-mast side,
   caster droop, mural flush side, `dashmirror`/`textx` pins (inverted
   to raw), dash text positions; postest dolphin `dooraxis`/`doorpivot`/
   `subjoint-angle` cross-product signs, fluke/rail axis dots, XYQ
   `xyq-dooraxis`, ISW `symrot*` twin sides, `subtwin-angle` mirror
   sign, gizmatest ring-order nose-swing phase; app vitest + hinge e2e
   likewise. Add NEW pins that CANNOT pass under a mirror: an
   orient-fixture probe measured in OUR OWN viewer (not vs dev), and an
   airliner-livery check — the file-derived plate raster must read
   UNITED when viewed from −x, per this section's screenshots.
6. Doc sweep once landed: this table becomes normative; §Handedness's
   "our view is the game's" narrative retired; MATRIX.md/PERF.md mirror
   notes re-worded.

**Landing notes (v0.180):** steps 1-6 shipped as commits `de-mirror(1-4/7)`
(viewer chain + text + junction + pins), `de-mirror(5/7)` (matrix harness:
devscrape ISO_DIR un-mirrored, matrix_iou mask mirror retired),
`de-mirror(6/7)` (app port + normalize FluidJunction EXEMPTION — the earlier
audit's latent note became REQUIRED, verified), and the doc sweep. New
mirror-proof selftest pins: `dashtext` (raw left-advancing canvas),
`orienttext` (orient fixture 9000000001 rebuilt through the shipped chain in
OUR viewer: +z text face, raw canvas, no mirror scale), `liver` (airliner
plate raster reads U-N-I-T-E-D from −x, screen-right = +z). Pins whose
constants flipped as genuinely chirality-dependent: beacon mast (nose = raw
−z), junction display +y, mural raw-q + z-negated wall normal, btn-lever/
plate raw offsets, doorpivot raw-z clamp constants, ISW symrot/symrot-x
mount-axis signs, gizmohover/aimCamera + fitCamera/cam-fit to the −z nose
side, app pins (format/build/compparts/hull/pipes/subgrid/gizmo-e2e).
Rebuilt, not flipped: selftest wake probe (ok24 — the old bbox-offset probe
only found the wake because mirrored voxel cells and raw-numbered centres
COINCIDED in z; it now stands 1.5 m off the downstream-most SOLID CELL),
selftest pick (explicit lookAt; the old pass rode a stale fit quaternion).
Side fix landed with step 1: per-engine THRUST ARROWS previously drew at
z-MIRRORED positions off their own parts (raw part coords rendered under the
mirrored worldM) — they now sit on their engines. Chirality-invariant pins
(mask deltas md=det(S)·S·dq, droop y-tests, subgrid |axis| dots, twin
unison, comptest, seal/inflow/wake magnitudes) were NOT relaxed — they pass
unchanged.

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
  **Appearance is NOT per material (measured, app v1.7, corpus 47 580
  geometry blocks + every `data.colors` entry):** palette entries carry
  exactly the six shading keys (`r,g,b,opacity,roughness,metallic`) — no
  material/name field — and slot→material is many-to-many (340 slots map to
  one material somewhere, 49 slots carry TWO+ materials across the corpus),
  so no slot means "iron" and no material implies a look. `material` is the
  GAMEPLAY identity: `GetMaterialProperties(material)` drives
  `densityFactor` (mass = rect × density, non-cube = HALF, FORMAT §Mass
  model), `thermalDestructionK`/`meltingPointK`, `thermalConductivity`,
  `specificHeat`, `pressureYieldPa`, `frictionCoefficient`, `metallic`
  (collider/shader hint), and the build cost is
  `(sx+1)(sy+1)(sz+1) × ARCHEAN_build.<Material>Block`. The blueprint tool
  therefore renders slots ONLY and edits `material` as a separate,
  non-visual row (app `engine/materials.ts` + `BlockPanel` MATERIALS); the
  `iconRaster.frag.glsl` `mat` index (Frame/Composite/Concrete/Steel/
  Aluminium/Glass/Lead/Titanium = -1..6) is workshop-ICON cosmetics, not a
  scene-shading rule. `Triangle` carries the SAME `material` byte
  (`Triangle.inc.glsl`: 5-bit vertices `v∈0..31`, `color[5]`, `material`).
- **Cell lattice (app v1.4.0 arbitration, corpus-verified):** cell `c` covers
  world `[(c−6)·CELL, (c−5)·CELL)` — the cell-BOUNDARY lattice every builder
  uses (cull's origin = `(abs−5.5)·CELL − CELL/2`, hull vertices
  `(v+12f)·CELL − 1.5`, tris.ts `cornerOf = round(p/CELL + 6)`); a point's
  cell is `floor(p/CELL + 6)`. The ⇄ block twin of footprint `[c, c+e)` about
  the FILE world x = 0 plane is `[12−c−e, 12−c)` — counting x-twin block
  pairs across the workshop corpus gives the `12−c−e` constant overwhelmingly
  (airliner 3309955432: 3705 pairs vs 592 accidental for `11−c−e`). The old
  app constant `11−c−(e−1)` (plane at cell 5.5) and the legacy `+5.5` point→
  cell floor were pre-v0.180 corner-convention leftovers (half-cell off).
  `pos_*` may exceed 12 together with `size_*` (corpus max `pos+size` 15) —
  blocks legitimately span frame boundaries; only the WRITER's pos_ ∈ 0..12
  re-anchoring (floorDiv to the frame) is required. Census (2026-10-25,
  over testdata/): **26 053 blocks** have `pos + size + 1 > 12` (max 16-cell
  spans at pos 11 — e.g. 3521588534, 3510792645). A size write moves no
  cell, so growing a block NEVER violates pos ∈ 0..12 — an editor clamp
  `size ≤ 12 − pos_in_frame` (the app had one until v1.10.6) is pure loss
  of function: blocks near a frame edge become un-growable on that axis.
- **Constructor-tool placement UX (official wiki, ConstructorTool §Block
  Modes, transcribed 2026-10-20 — drives the app's Blocks-place mode):**
  aim at a block or beam and quick left-click places the block; the drag/
  resize plane is the hit face's normal; the scroll wheel rotates the shape
  through its orientation family (cubes have one). **“Hold Shift before
  pressing left-click to copy the block you're aiming at or logically add
  the next block.”** — the app's `complementBlock`: the continuation rides
  the aimed block's size+paint; a SLANT hit keeps its shape+orientation and
  takes the coplanar lattice step (Σ mᵢ·dᵢ/eᵢ = 0 over the slant-normal
  pairs — for a unit slope the diagonal cell beyond the high/low edge),
  which continues the slanted surface exactly. **An AXIS-face hit takes the
  aimed block's FLUSH MATE, not a plain copy (v1.5.2 user rule, in-game
  observation: against a slope's flat face the game places the inverted
  quarter, not the same type):** the next cell across the face fills with
  the shape-family orientation whose shared-plane solid section bilaterally
  covers the aimed face (a same-type copy behind a wedge's flat square face
  touches only along an EDGE — a void at the joint), preferring the one
  whose slant-face normal LINES match the aimed block's, so the surface
  continues as a slab (slope type 1 behind its flat face → the 180°-turned
  type 3). Cubes have one orientation (unchanged); where the copy IS the
  flush mate (a slope's triangular side faces = the sideways ramp extension)
  the rule keeps it. Probed 12×12 over the shared rectangle; with no flush
  mate the plain copy stands. Removal:
  aim + hold right-click + quick left-click. Symmetry mirroring is the ⇄
  path above; the in-game axis is adjustable at 0.125 m precision (the app
  keeps the single file x = 0 plane).

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
  (`xc_files`; `plain_code` is the ONLY stored program form — no bytecode; the
  language is the dev's own XenonCode, open source at
  github.com/batcholi/XenonCode — we run it as WASM in `tools/xenoncode/`,
  see NOTICE §6), Beacon holds frequency + last transmitted payload, PilotSeat holds
  `{emitPlayerToken, smoothControls}`, HudController holds HUD `.xc` source.

### The Xenon virtual disk + device-shim laws (transcribed 2026-10-27,
game wiki `Archean-game/wiki/en/xenoncode/{computer,dashboard,ide}.md`,
implementation `tools/xenoncode/xc_host.cpp` + `app/src/engine/xenoncode.ts`)

- `data.hdd = {capacity, label, xc_files:[{name, plain_code}]}` is the
  computer's **virtual disk** — the IDE edits these files IN the blueprint
  (key order `{name, plain_code}`; app/ edit.ts `setXcFileCode` /
  `insertXcFile` / `removeXcFile` mirror bp + doc, v1.6.1 rule; the game
  auto-reboots the computer on save — ide.md "Running the code" — our
  writeback re-boots the WASM VM the same way). A file named exactly
  `main.xc` is the BIOS-like entry (runs first, `include`s the programs;
  craft 3381670618 ships `main.xc` + `Cede.main.xc` + `screen.xc`); the
  MiniComputer runs the FIRST program on the disk; programs end `.main.xc`
  and their `#NODES` graph header lives in the FIRST LINE comment.
- **Entry-file selection** (`xenonComputers`): `<program>.main.xc` →
  literal `main.xc` → any `*.main.xc` → first file; `xcDiskFiles()` maps the
  run-side `main.xc` back to the disk's true name for writeback.
- **Screen surfaces** are keyed by the LITERAL token the program passes to
  `screen(aliasOrIoNumber, channel)` (lowercased): `screen(10,0)` keys
  `10#0` — the app registers the io NUMBER key (sized from the Dashboard's
  Screen/HdScreen element, pixels = size+1) AND the alias key; a number
  resolves through the computer's `data_port.NN` cables. `virtualscreen(w,h)`
  keys `virtual#N`. The 3-D dashboards display what is given to them: the
  pump's 10 Hz tick pushes each surface's RGBA framebuffer onto the bound
  element's face (`Engine.setScreenFeeds` + `pushScreen`, DataTexture).
- **THE NET-SCREEN LAW (v1.16.11, the 3828773626 blank screens)**: a
  program's references are NOT always literals — ChipOS's display.xc scans
  the device() rows and passes VARIABLES (`screen($dd_a,$dd_c)` for an
  aliased dashboard, `screen($dd_p,$dd_c)` for a bare one), so NO static
  scan registers its surfaces. The binding law is purely topological
  (computer.md + MiniRouter.md): every **Dashboard on the computer's
  ROUTER NET** pre-registers every Screen/HdScreen element's surface at the
  6 px/unit size — keyed by the LOWERCASED alias for an aliased board, by
  the io-NUMBER token for a bare one (exactly the addressing display.xc
  itself picks) — registered BEFORE boot where `xc_addScreen`'s first-wins
  beats the shim's 640×480 dev-tool seed (`xenonNetScreens`). The 3-D face
  binds ALL of its keys (setScreenFeeds keeps a key LIST per ci:channel;
  pushScreen by any key lands on the shared DataTexture) and the LIVE
  farm's auto-boot feeds the boards with NO IDE window open.
  THE NEVER-PAINTED GATE (v1.16.12): the net law registers every board on
  EVERY router-net computer, so the idle app-1/app-2 pumps hold the SAME
  keys ChipOS paints — the shim's screen write-counter counts the
  constructor's bg fill as #1, so a surface at seq ≤ 1 has never been
  painted by its program, and the pump ships NO pixels for it. Without the
  gate every pump pushed the same key each cycle — black buffers fighting
  the painter frame-by-frame (visible flicker) and filling the ▣ SCREENS
  dock with black tiles (the dock shows the farm's PAINTED surfaces, each
  key owned by the pump that paints it). Pins: xenonvm net-screen legs
  (idle app-1 seq ≤ 1 / chipos paints) + e2e dock leg (farm-merged cells +
  press-to-repaint push).
- **ROUTER POWER GATING (v1.16.11, the deferred v1.16.10 design)**:
  MiniRouter and Router carry a `[ADAPTER lowvoltage]` — they ARE the
  alias resolvers, so an UNPOWERED Mini/Router makes its whole net subtree
  invisible to every computer (device table, io tokens AND alias
  addressing drop). DataJunction and DataBridge carry NO power port —
  passive conductors, never gated. Grid-less crafts stay power-unaware
  (every router live), the engine/power.ts convention unchanged.
- **Buttons** (computer.md:143, dashboard.md:84): `button_rect(x,y,w,h,color)`
  draws AND **evaluates true if clicked** (a void declaration was craft
  3381670618's compile error — `if $screen.button_rect(...)` needs the
  return); legacy `button(x,y,color,w,h)` + `draw(x,y,color,w,h)` carry the
  COLOUR 3rd. `pixel(x,y)` is a GETTER (the current packed colour), drawing
  is `draw_point`. A host click is visible to the buttons and the
  `clicked`/`click_x`/`click_y` built-ins for ONE cycle, then the
  `click`/`click_hold`/`scroll` entry points run (per-screen with the
  surface as ref = `click.$screen`, plain for the integrated `main#0`).
- **Variables** are introspectable via `tools/xenoncode/patch_xenon_vars.py`
  (documented patch on the pinned upstream): the compiler's global-scope
  declarations (name, CODE_TYPE, slot) are recorded, `Computer::DumpVarsJson`
  reads RAM live + the STORAGE rows from the storage cache (names in
  `assembly.storageRefs`; values are STRINGS, `atof`-parsed by the VM).
  CODE_TYPE: 50/51 storage, 70/71 RAM, 60/61+80/81 arrays, 128+ objects
  (screen handles), 40/41 ROM constants; names containing `.` (e.g.
  `disp.init` = a function) and `@` are compiler artifacts, hidden. Text
  values in the language's KV serialization (`.on{1}.red{255}`, README:421 —
  the `device()` records use the same shape) break open in the Vars panel.
- **input_number reads** are reported per cycle as `{"e":"in","io":N,
  "port":C,"v":V}` events — the IDE's io-addressed node cards show the value
  the program ACTUALLY read from its component.
- **The debugger** (F9 break · F10/F11 step · F8 resume): RunCode's
  LINENUMBER case records the executed line per cycle behind a flag
  (`tools/xenoncode/patch_xenon_debug.py`, `xc_cycle_lines()`); the host
  pauses the pump at the cycle that TOUCHED a breakpoint line, and one step
  = one 10 Hz computer cycle (line-granular suspend/resume does not exist in
  the library's VM architecture). Break lines match the cycle's executed-line
  list, which MIXES included files (v1 caveat).
- **Reboot semantics (the law the Badger taught twice)**: rebooting a
  computer = a FRESH VM whose RAM starts at ZERO while the host's surface
  registry SURVIVES — the program's `var $screen = screen(...)` globals
  re-run in `vars_init`, and any device call the VM makes before them sees a
  NULL object var: every shim screen member and `screen_copy` must
  null-guard (unguarded `screenOf(o)->Blank()` segfaulted the host, gdb
  `this=0x0`). Storage round-trips are equally game-lenient:
  `patch_xenon_lenient_index.py` makes out-of-range array/text indexing
  return `0`/`""` (indexed array WRITES grow), OOB text-char writes skip —
  the game's binary treats junk as data, the open library throws (the
  Badger's strict-off path on its own written storage is the repro,
  XC_REBOOT=1).
- **The CRAFTER is a computer with a BUILT-IN SCREEN** (wiki
  components/miscellaneous/Crafter.md): its program is NOT stored in
  `blueprint.json` (like MiniComputer storage, it lives on the world's
  server HDD, ide.md Persistency) - the game PUBLISHES the full built-in
  program in the wiki, we ship it (`app/src/engine/crafterbuiltin.ts`) and
  synthesize the device's one-file disk (`xenonComputers`: builtin: true).
  Its integrated touchscreen is the plain screen-function target (the shim's
  `main#0`) and is **200×200 px** (v1.15.3: the shipped
  `modules/ARCHEAN_machines/components/Crafter/main.xc` draws its how-to
  popup at `draw_rect(4,5,196,195)` — coords that only fit 200×200; the
  app's old 128×72 was a guess).
- **THE COMPUTER'S INTEGRATED SCREEN IS 200×160 px** (v1.15.3, we: "that is
  the size it should have… this SHOULD be documented online? No?" — YES):
  wiki components/computers/Computer.html states "The resolution of the
  integrated screen is 200x160 pixels"; the game's BIOS script
  `modules/ARCHEAN_computer/components/Computer/main.xc` draws 200-px-wide
  rows. The **MiniComputer has NO built-in screen** (wiki: "does not have a
  built-in screen and therefore cannot display a BIOS") — it registers no
  `deviceScreen`, so its plain `screen()` draws land on the shim's dev-tool
  `main#0` seed and never on a 3-D face. The app registers the Computer's
  panel at its AUTHORED 200×160 as `main` before boot (first-wins over the
  shim's 640×480 seed) — the dock cell, the 3-D face texture and the
  program's `screen_w/screen_h` are all the panel; Space Invaders'
  squadron spans it edge-to-edge exactly as in-game (inception fix).
  **Facing (v1.15.4, we: "THE 3D SCREEN OF COMPUTER IS MIRRORED"):** the
  lid's BACK is a plain panel; the DISPLAY + deck (CODE/REBOOT) face the
  PILOT and in-game the text READS from that deck side. Scene law: the
  built-in panel UV is v WITH its v-axis, u 1-MINUS (the v1.13.8 ruling,
  restored — v1.13.11's u-revert rendered the pilot side mirrored for
  three eras; its chair-side visibility report was solved by DoubleSide,
  the u law never had to move). The scene quad's winding-normal points
  at the BACK panel; readable from the OPPOSITE side. Pinned:
  `app/e2e/faceorient.spec.ts` + fixture `tools/make_face_test.py`
  (testdata/9000009020: a yellow 'L' painted RIGHT on the panel must
  project RIGHT from the pilot side).
- **Component OVERRIDE screens are AUTHORED PER COMPONENT** (Computer
  V ▸ Override Screen): the game's own `modules/<mod>/components/<Type>/
  main.xc` scripts size them (the FissionReactor draws 400-px-wide rows;
  the modding tutorial example creates an 80×40 from material `screen1`).
  The app keeps a 128×72 stand-in for uncensused types (backlog: the
  per-component script census). Device functions the built-in program needs, added to the shim:
  `progress`, `fluid_level`, `start_craft(item, qty)` / `cancel_craft`
  (recorded as bus events), `enough_power`. Run-side convention: the VM
  always boots from `main.xc` - a synthesized disk names its file main.xc
  and carries the disk-side name in entryName.
- **Element surfaces are 6 PIXELS PER LATTICE UNIT** (`XenonDraw` scale):
  pilot-screen's 50×50-unit element is a 300×300 px surface — the firmware's
  own print `Screen dimensions: 300x300` is the proof, and firmware draws at
  unit·6 coordinates (compositing via `screen_copy` from virtualscreen
  atlases). Registering them at size+1 px clips every composite; the app's
  `xenonScreens` uses `size*6`. A MiniComputer has NO integrated screen
  (wiki) — no auto `main#0`. Behind-a-router components are addressed by
  ALIAS (computer.md) — no router emulation is needed beyond the alias
  resolution the shim already does.
- **io numbers resolve to COMPONENTS, channels to GAME MEANINGS**
  (`tools/extract_channels.py` → `viewer/models/channels.json`, 52 types):
  each type's wiki page carries `### List of inputs/outputs` tables
  (`|Channel|Function|Range|` — 2- or 3-column). A type's **outputs** are
  what it SENDS on its data port (the meaning of `input_number` on an io
  cabled to it); its **inputs** are what `output_number` writes.
  `input_number`/`output_number` take an **aliasOrIoNumber** (computer.md):
  the shim resolves a TEXT argument through the device table — a cabled
  device reads on its io port, an ALIAS-only device (the Badger's 82) on a
  synthetic `1000+id` port that `xc_set_input_a` wires the panel sliders to.
  Types whose wiki pages carry no table (ThrottleLever, SpeedSensor, …)
  show a bare `ch N` — no invented meanings.
- **WORLDSIM (v1.13.x, `app/src/engine/worldsim.ts` + `xc_host`)**: the
  simulator's stand-in for the world — a GLOBAL, name-keyed, localStorage-
  persisted store (every craft shares one world; the pump only binds names
  to the running computer's io/ch). Channels are NAMED
  `${device-slug}.${channel-slug}` from the game's own tables and driven by
  an EXPRESSION IN `t` (elapsed seconds) the pump evaluates each cycle;
  SENSOR rows (observers: *Sensor types, navinstruments, altimeters) also
  carry a g($val, t) OVERRIDE — `$val + 2` makes an instrument read high;
  controls/actuators group apart with f(t)+manual only. Defaults fly the
  craft in level flight at 2000 m / 80 m/s
  (altitude 2000+5·sin(t/20), airspeed 80+2·sin(t/13), heading (42+0.5t)%360,
  ISA 281.5 K, battery 0.8 draining, the PilotSeat stick oscillating,
  Celestial "EARTH"…). `xc_seedWorld` is only the pre-first-tick seed; the
  live source is the expression. PROGRAM-SIDE API (declared device
  functions, native fixture `demo/worldsim`): `setworldsim(name, v)`
  OVERRIDES a row (the pump honours it every cycle; `pow(10,40)` releases —
  XenonCode has no e-notation literals), `getworldsim(name)` answers the
  row's CURRENT effective value (the pump streams every row back via
  `xc_worldsim_sync`). The World tab edits f(t) per row, shows the live
  value, marks program-override rows, and offers per-row manual sliders.
- **Autosaves are app-side, not format** — shadow copies of the doc text
  live in IndexedDB `archean-autosaves` (`app/src/engine/autosave.ts`),
  keyed by craft id (unsaved docs `new:<title>`), newest-first with
  timestamps; restoring opens through the normal open funnel.

## Mass & build cost — the game's server/editor rules (transcribed 2026-10-19,
verified vs the installed build 136 + the dev viewer panels; implementation
`tools/game_data.py`, cross-check harness MATRIX.md)

- **Sources**: per-component mass = `[ENTITY] mass` in
  `modules/<module>/components/<Type>/<Type>.ini`; items + crafter recipes =
  `modules/<module>/config.yaml` (`items: {id: {max_stack}}`, `recipes:
  [{label, context, category, time, input, output}]`; shorthand bare-string
  input = qty 1; dynamic `input.composition.*` quantities exist only in
  non-crafter contexts (crusher) — never part of the cost unfold).
  Item ids are `MODULE.Type`; 165 items / 140 crafter recipes / 111 component
  masses on build 136.
- **Blueprint-tool content list** (game `GetBlueprintContents`,
  ARCHEAN_build/common.hh, via the dev's port): blocks cost their FULL rect
  `(sx+1)(sy+1)(sz+1)` of `ARCHEAN_build.<Material>Block` (Composite,
  Concrete, Steel, Aluminium, Glass, Lead, Titanium by `material` 0..6) —
  shape/orientation irrelevant; hull triangles cost
  `max(ceil(area·0.05 m / 0.25³), 1)` blocks; struts `ceil(len·100)`
  SteelRod; **frame beams** 1 × SteelBeam each — a `frames[]` RECORD is a 3 m
  cube carrying up to 12 beams (its `beams` boolean flags), so the bill is
  one beam per LIT FLAG, not one per record; cables cost their length in cm
  with the game's quirk of **truncating per SEGMENT** (2×1.5 cm = 2 cm);
  components 1 item keyed by the file's `module.Type`; `Build` subgrid items
  deleted; `Dashboard` replaced by 1 × DashboardTool.
- **Strut endpoints** (`data.struts[] {color, frame_x/y/z, v0_*, v1_*}`):
  MODERN files store `v0_*`/`v1_*` in METRES relative to the frame corner
  (`f·3 m − 1.5 m`); LEGACY files stored lattice CELLS and are recognised by
  the dev viewer's own probe `Number.isInteger(v0_x) && |v0_x| < 32`, which
  scales by 0.25 (js/blueprint.js; a modern endpoint that happens to be an
  exact integer below 32 is therefore ambiguous). The corner offset cancels
  in the endpoint difference, so only the scale matters for length/cost.
  Verified 2026-10-22 on `testdata/3803780241` (18 struts, 75.39 m of rod,
  7,548 SteelRod items; mass family `struts` 75.4 kg = 1 kg/m agrees with the
  file's declared 10,700.19 kg to 0.06 %).

- **Raw-material unfold** (game `RepairEconomy.h`): recursive through crafter
  recipes, first recipe outputting an item wins, fractional batches
  `qty/out_qty`, craft time += `time·batches`. No recipe ⇒ RAW, unless the id
  is a catalog component or a recipe cycle ⇒ UNRESOLVED (the dev UI's 'stuck'
  rows) — a stuck component item therefore means a wrong module mapping.
- **Mass model** (game `MaterialProperties.hh` + server collider update, via
  the dev's port, verified against game-written blueprint `mass` fields):
  densities are per 0.25 m CELL CUBE (not kg/m³): composite 0.25, concrete
  10, steel 1, aluminium 0.5, glass 1, lead 150, titanium 0.6; blocks =
  rect × density, **any non-cube type costs HALF its rect**; triangles
  `area·0.05 m / cell³ × density`; struts 1 kg/m; beams 10 kg; components the
  ini mass; **tank contents are FRACTIONS of capacity** (FluidTank 1.5 m³,
  SmallFluidTank 0.2, BigFluidTank 14) × the game's "very crude" liquid
  density = `Σ atomic_mass·n · 1.6605402e-27 / Σ (4/3)π(0.92e-10·n)³` with
  the game's atomic table (H 1.008 … U 238.03; isotope suffixes stripped,
  e.g. `(U235)F6` → UF6). Centre of mass = mass-weighted cell/part centres.
- The viewer's mass panel (view3d.js) is its own calibration display (declared
  vs computed); the AUTHORITATIVE calculator for the matrix suite is
  `tools/game_data.py compute_mass/required_items/expand_to_raw`.
  **v1.7.1: the APP's `engine/mass.ts` now implements this model DIRECTLY**
  (the TS twin of `compute_mass`, pinned against its corpus numbers) plus the
  subgrid recursion the python top-level scan omits: `Build` components nest
  their content in `c.data` (parent-frame absolute coords) — counting it
  recursively closes the gap to the game-written mass (giant 151 189.5 vs
  151 195.5 kg, dolphin 1 620 vs 1 621). The old calibrated display is retired
  in the app (it absorbed every edit into a recalibrated hull, so a committed
  hull skin could never move the displayed weight); the legacy viewer keeps
  its calibration display (frozen). Frame beams count mass but are not
  CoM-weighted (the corpus carries no frame record to pin a position for).

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

### v1.8.1 — the drawing law, the style fields, and where a cable REALLY plugs in

Transcribed from the game client through the dev's XenonViewer (`scene.js buildPipes`,
user-confirmed = the game's look) and arbitrated by a whole-corpus sweep of 18 407
recorded endpoints in 57 files:

• **A cable is a CYLINDER** of the pipe's `radius` (corpus per kind: data/lowvoltage
0.02, highvoltage 0.04, fluid 0.045, item 0.08). Square ONLY where the segment carries
`box: true` — the corpus census shows **only `item` ducts set it** (the user's
"in-game: round, not square… item is square indeed"). DISPLAY OVERRIDE (v1.8.3,
`KIND_SECTION`): the user rules the viewport read — "Data cables should be thinner.
And less round, item cables square" — so the DATA bus draws SQUARE at 60% of its
file radius (`half = 0.012`); the file's radius stays the physical truth. Elbow direction changes close
with a SPHERE of the cable radius (two butt cylinders leave a notch), and the LAST
segment is stored REVERSED (it points from the b-adapter back into the path) — the
elbow test must read its useful direction as `(dir+3)%6`.
• **Every segment serialises its full style**: `r,g,b,a` (0..255, LINEAR albedo like
palette slots — blueprint.js defaults absent channels to 128), `box`, `chrome`, `metal`,
`glossy`, `flexible`, `striped`, `rounded_caps`. The client draws those verbatim; the
corpus majority per kind: data navy `(16,24,96)`, lowvoltage `(96,8,4)`, highvoltage
orange `(255,64,4)`, fluid WHITE + `chrome`, item WHITE + `box`+`metal`. OLDER saves
(the ISW) write nearly-black sheaths like `(1,1,12)` — the FILE colour is truth, there
is no fixed per-kind palette (the dev's `PIPE_COLORS` is UI legend only).
• **FLEXIBLE pairs are not two segments**: when both segments of a 2-segment pipe carry
`flexible`, segment[0] carries the cable's LENGTH + colour (its `dir` is meaningless —
drawing along it made "wires fly in every direction") and segment[1] (zero length) only
marks the ARRIVAL point. The client draws a sagging parabolic chain between the ends:
`slack = len/dist − 1`, `sag = dist·√(3·slack/8)`, chunk count `≈ 4·√(len/r/12)` capped
2..64, 1 chunk when the sag drops under the radius.
• **The client adds a black COLLAR at every cable end** — not serialised (the dev's
viewer deliberately draws "exactly what the file contains"; the app draws the collars
as plug seats).
• **THE SOCKET ANCHOR LAW** (`app/src/engine/sockets.ts`): a `.ini [ADAPTER]` is in the
engine CONTENT frame; its FILE-frame socket pose is

      at   = position + R(qraw)·(ax, az, −ay)
      axis = R(qraw)·(Rz(rz)·Ry(ry)·Rx(rx)·ẑ  mapped the same way)

  with the quaternion stored AS-IS (the v1.5.11 raw law — one law both generations;
  the Euler order is confirmed by the 114 multi-axis adapters). The corpus sweep:
  p95 tangential residual **0.000 m**, seating offset along the stub 0..0.135 m —
  i.e. **every cable tip lies ON the adapter's stub axis** (this is "how to determine
  where they go in": the round grey socket discs on the models ARE the adapters —
  e.g. FluidPort's `fluid-connector` flange is model material `fluid-connector`, grey
  0.5, on the socket face). Exemptions as in comptest: PilotSeat (user-moved) and
  Beacon (connector-frame tips).
• **THE DATA-GENERATED DASHBOARD PORT (v1.16.11)**: the Dashboard board is
  GENERATED from `data` (size_x/size_y centimetres), so its `.ini`
  `[ADAPTER data-connector]` at content (0, 0.018, 0) is the **gltf
  template's corner** and sits OFF the real board. Measured law (every FRESH
  `data-connector` tip in the corpus — 8 endpoints incl. both sides of
  3828773626, residual **0.020 m** = one cable radius): the plug sits at
  LOCAL FILE **(W/2, H/2, −0.038)** = the CENTRE of the board's BACK,
  on the −normal stub from the socket plane −0.018. In the `.ini` content
  frame: position (W/2, 0.018, H/2), rotation (−90,0,0) — the same back-
  plane offset as the template, centred on the DATA. `sockets.dashboardAdapter`
  synthesizes it; the generic corner law applies to every OTHER type.
• **The cached route goes stale** when a part moves after wiring (the game re-routes
  at save; a file is a snapshot). An end is FRESH iff it is within 0.45 m of its
  socket AND within 0.15 m of its stub axis; otherwise it re-anchors onto the live
  socket keeping an in-band [0, 0.135] recorded depth (garbage → 0.05 default seat).
  Live proof: 3481322297's Dashboard tips sit 0.40 m LATERAL off-axis (board turned
  after wiring) and the LowVoltageBattery gantry tip 0.20 m — both re-seat. The old
  wireops port census read `(x, y, −z)`-double-mirrored (a pre-v0.180 artifact); it
  is this law now — auto-created cables start at the true sockets, with the game's
  per-kind segment styles.
• **THE DIRECTION RULE** (v1.8.2, user: "the wire must always connect in the right
  direction ONTO/FROM the connector and the radius of the wire is the minimum
  distance it must continue in the same direction as the connector"): the bar
  touching a connector runs ALONG the connector's stub axis and continues straight
  for a LEAD of 2× the cable radius (clamped to the first hop) before the route may
  bend — elbow sphere at the bend — and a re-seated plug tip stands at least ONE
  cable radius off the socket face. The game agrees quantitatively: over 17 815
  fresh ends the first recorded hop leaves along the stub axis with median dot
  +0.97..+1.000 per kind, so for fresh files the lead bar is collinear with the
  route (invisible); it bites exactly where the cache came loose from the part.
  Guard: a lead is laid only while the route leaves the plug outward/sideways
  (dot ≥ −0.25 of the axis) — a stale route that dives back INTO the part through
  the socket gets an honest straight lead-in instead of a folded wire. Audit:
  `checkLeads(net)` (exposed through `__ARCHEAN__.engine.pipeInfo().leads`). Pins: `app/src/engine/__tests__/sockets.test.ts` (law +
  corpus sweep), `pipes.test.ts` (drawing + re-anchoring), `app/e2e/pipes.spec.ts`
  (rendered net + a moved part drags its ends), triage: `app/tools/worsttangent.mjs`.
• **THE DRAPE LAW** (v1.11.3, user: "flexible cables should simulate physics
  … have a hang/sag depending on how tight they are, like it is in game, and
  move toward/attach to where they physical connection it; sag then depends
  on how overstretched they are for their actual length"): a cable run whose
  cached ends no longer sit on their sockets (a part moved) and whose BOTH
  sockets resolve is re-draped PHYSICALLY — the game re-routes such cables
  on save; the viewport previews that live. The run's REST LENGTH is the
  file's truth (Σ `segment.length`; a flexible pair carries its length in
  segment[0] by convention). Between the plug necks (tips + 2r axial leads,
  the DIRECTION RULE above) the cable is the CATENARY solved for that arc:
  y(x) = a·cosh((x−xm)/a)+c with 2a·sinh(dh/2a) = √(L²−dv²) in the vertical
  plane through the two anchors (dh = horizontal separation, dv = height
  difference). Consequences the pins assert: REST LENGTH ≤ span ⇒ TAUT, one
  straight bar (an overstretched cable is pulled straight, as in game);
  sag grows monotonically with overstretch L/span; a VERTICAL span hangs
  STRAIGHT (no side-bow — the old XenonViewer chord-offset parabola bowed);
  sampled arc length ≈ the rest length. THE GATE IS THE FILE'S `flexible`
  FLAG (v1.11.5, we: "You drapped cables that are NOT flexible … they are
  either axis aligned pipes OR flexible cables in appearance" — superseding
  the v1.11.4 overreach that draped every run): a run is drawn as a
  hanging rope IFF its segments carry `flexible` (whole corpus: the flag
  occurs on EXACTLY the 2-segment pairs, 1126/1126 — the flex branch IS
  the flag). Routed runs are the game's RIGID conduit (axis-aligned
  pipes): the recorded builder-cache route IS the shape and draws verbatim
  (stale ends re-seat on the live sockets, v1.8.2 axial leads).
• **THE HARNESS ATTACH** (v1.11.5, we: "the cable to the small pivot … goes
  to the OLD position of that pivot, rather than its actual current one" +
  the Dorito SSTO door-harness screenshot): cables on SUBGRID parts are
  flexible by definition (door harnesses), and the doors render at their
  joint pose (SmallPivot/SmallHinge data.angle) while the file's tips were
  cached at the BUILT pose (measured on XYQ-615: recorded tip sits 0.165 m
  from the part's FILE spot — the adapter offset — and 1.07 m from its
  display spot with the door saved open 24.3°). So: pipeSockets resolves a
  nested part's adapter through the owning Build group's DISPLAY transform
  (file-space: pose minus the moff anchor), and the SocketAnchor carries
  that rigid transform as `attach` — plugAnchor transforms the recorded tip
  by it, so the harness RIDES THE DOOR continuously (the 0.45 m re-seat
  band is a cache-repair rule for top-level parts; a harness snapping only
  past it reads as "connected to the old spot"). The pipe mesh builds AFTER
  the subgrid groups (load order) and rebuildPipes re-reads the live group
  poses, so hinge drags make harnesses follow (pipesSoon throttle). Pin:
  app/e2e/pipes.spec.ts 'a DOOR HARNESS hangs from the door's LIVE pose'
  (XYQ: swinging the hinge moves the harness end 1.7 m, restores to 1e-6,
  leads clean) + sockets.test 'THE HARNESS ATTACH'. The engine re-drapes on every
  rebuildPipes (Editor pipesSoon = 250 ms leading+trailing throttle, so a
  gizmo drag makes the cables FOLLOW the part at 4 Hz and settle after the
  release). Style: the rerouted run wears its LONGEST recorded segment's
  colour/material (segment[0] is often the black sheath stub). Pin:
  `pipes.test.ts` THE DRAPE LAW (taut, monotonic sag, arc ≈ L, vertical
  straight, exact plug lands, re-drape vs fresh-kept),
  `app/e2e/pipes.spec.ts` (truck: stale runs re-drape + a hung chain dips;
  ISW: moving a part re-drapes its cables, restoring leaves no drape).
• **A pipe needs ≥ 2 segments IN THE FILE** — the dev reader warns
  (`blueprint.js`: "the game expects at least two"), and the balloon-tail
  generator honours it at write time (`balloonfin.pipeSegments` keeps only
  true axis-aligned hops, so a broken route is DROPPED, never patched into
  a diagonal). The Generate-balloon LV runs (v1.9) additionally honour the
  user rule "the wire must, right after the pivot plug, run INTO the body":
  lead off the stub axis → one cell deeper through the skin → a long run
  along the body axis INSIDE the envelope (hidden), all waypoints asserted
  inside-envelope by the vitest pins (`balloonfin.test.ts`).

### v1.10.1 — PORT ROLES AND LOGICAL WIRING (`app/src/engine/wiremodel.ts`)

The `.ini` adapter NAMES are the game's own wiring semantics — a whole-game
census (107 adapter-bearing types) shows the tokens `in`/`input` and
`out`/`output` are the ONLY direction hints, and one type names its TOPOLOGY
outright:

| evidence | reading |
| --- | --- |
| `LowVoltageJunction`: `lowvoltage-input` + `lowvoltage-port.001..004` | exactly ONE input, four downstream outputs |
| `HighVoltageJunction` / `HighVoltageRelay`: `highvoltage-input`, `highvoltage-output` | the same law spelled out |
| `FluidJunction` `fluid-in` + `fluid-out.NNN`; `ItemJunction` `item-in` + `item-out.NNN`; pumps/tanks/furnaces `fluid-in`/`fluidout`/`item-out` | named flows on the EDGES too |
| `DataBridge`: `data-computer.1` + `data-device.0` | the port name states WHO it talks to — computer→router→component is literally in the data |
| `data`, `connector.000`, `hv1`, `data_port.003`, `port1/port2` (bridges) | neutral: any side of a link |

`wiremodel.ts` turns that into one shared abstraction:

- **`portRole(name)`** → `in | out | any` (token-split on `[-_.0-9]`, the
  `fluidin`/`itemout2` names ride the endsWith arms).
- **`compGroup(type, kind)`** → `source | hub | device`: producers
  (batteries, solar panels, RTG, generators, turbines, converters' LV side),
  routers/distributors (*Junction, *Bridge, *Relay, Router, MiniRouter,
  Computer, MiniComputer — per kind), everything else consumes. The same
  type may differ per kind: `PowerConverter` is a lowvoltage SOURCE and a
  highvoltage DEVICE.
- **`hubInputIndex`** — a hub that OWNS an in-role port (junction-style) has
  its remaining ports as downstream outputs; a bridge (`port1/port2`, no
  input) is a two-way link. This is what keeps a device cable off
  `lowvoltage-input` — the balloon rudder bug: control surfaces may only
  TAKE power; the junction input stays free for the battery.
- **`compatible(a, b)`** — never IN↔IN, never OUT↔OUT; a hub input faces
  upstream (sources/hubs, never a device); a junction output never points
  back at a source; power never runs device-to-device; neutral fluid/item
  ports never pair directly (a pump→tank direct edge needs BOTH sides named).
  - The app's `engine/power.ts` reuses these source/hub/device groups as a
    POWER-REACHABILITY net (source → hub → device per voltage kind): a
    computer whose `power_connector` no source reaches is UNPOWERED — the
    auto-boot leaves it off and the editor warns on interaction. Laws in
    LIVING-CRAFT.md § 3.
- **`candidatesFor(draft, free)`** — the manual picker's ranking: tier 0 =
  the game's naming/topology says so (device→hub, source→hub input, hub
  output→device, the named `data-computer` side), tier 1 = legitimate
  alternatives (direct source tap, hub cascade, sources in parallel), tier 2
  = other compatible ports; nearest FIRST WITHIN a tier. **Ranking orders
  the list; it never removes an option** — every compatible port stays
  pickable and a manual pairing is never second-guessed (`makePipe` runs no
  role check: the user's decision wins over the heuristic).

The WIRE workspace (v1.10.1) is built on this: every cable listed
(`Propeller[9].lowvoltage ↔ Computer[0].data_port.001`), a ✕ DISCONNECT per
cable and per component port (bp AND doc — the doc is the save and the
history), reconnect through the ranked candidate flow, a NETWORKS overview
(per kind, connected groups ordered sources → hubs → devices), and the
viewport hover chip + gold overlay for the cable under the cursor
(`pipes.ts pipeAt()` ray-to-polyline pick; net runs carry `piOf` so a
drawn run maps back to its `data.pipes` index for labelling).

Auto-wire (button-only, NEVER on open/edit/save) now runs the model's
STAGES per kind — power: batteries ∥, sources→hub inputs, hub-input cascade,
devices→hub outputs, a direct source tap as the last legitimate step; data:
the named bridge sides, devices→routers/switches, routers→computers, hub
daisy-chains; fluid/item: named flows and junction ports. **A port with no
compatible partner stays OPEN with a printed reason — the v1 pass paired
leftovers "last resort" and that is exactly what plugged devices into the
junction input and painted every LV port** (the user's zeppelin-rudder
report). Re-running auto-wire on a satisfied state is a no-op.
Pins: `app/src/engine/__tests__/wiremodel.test.ts` (naming census, role
table, compatibility matrix, ranking, the rudder regression),
`pipes.test.ts` (`pipeAt`), `app/e2e/wire.spec.ts` (list, hover label,
disconnect → undo → reconnect, phone).

Note: `components` may contain a `Build` type — the editor's construction-site ghost
(e.g. y −24.75, far outside the craft). It is not physical geometry; the viewer skips it.

## The `item` cable + the App Kit protocol (transcribed 2026-10-31, v1.16.10)

**Item cables.** `pipes[]` carry a fourth kind next to `data`/
`lowvoltage`/`highvoltage`: **`type: "item"`** — the game's explicit
conveyor wiring (Jimmy's Adventure carries seven). The endpoint PORT
names give the flow DIRECTION: an `item_output`/`item-out*` end PUSHES
into the far part; an `item-in*` end RECEIVES; item hubs (ItemJunction)
expose one `item-in` plus numbered `item-out.000…003` cable slots.
Components involved: MiningDrill (`item_output`), Container (`item1`,
`item2` — accepts push/pull, never initiates), ItemConveyor (`item-in`
pull-side, `item-out` push-side), ItemJunction/ItemBridge (routing),
Crusher/Crafter (both ends), TrashCan. Endpoints index the FLATTENED
component array like every other pipe (engine/flat.ts).

**The ChipOS App Kit (third-party program protocol, testdata/3828773626
`chipos-appkit.xc` header = the law).** An APP is any computer (usually
aliased `app-*`) on the same router net as the OS computer (aliased
`chipos`). All traffic is `output_text` on io channels:
- app→chipos ch0: the MANIFEST `.kit{3}.name{TETRIS}.color{#rrggbb}
  .glyph{T}.hb{N}` — republished as a heartbeat every 2 s (ChipOS marks
  the app online while `hb` changes: a pulled disk goes stale, honest);
- app→chipos ch1: the FRAME `T~x~y~size~colour~text|B~x~y~w~h~id~label|
  M~x~y~w~h~cols~rows~cells|R~…|G~…|P~…` (positions are % of the app
  area 0-100); ch2: keyboard requests; ch3: beep requests; ch4+n:
  HOME-SCREEN WIDGET frames (up to 4, declared in `.widgets{}`);
- chipos→app: text frames onto the app's router PORT (the app's
  `input.0..15` handlers fire): `.seq{N}.clock{HH:MM}.day{D}.units{U}
  .mins{M}.ev{open|close|tap|tick|uninstall|clear|wtap|input}.id{…}`.
ChipOS discovers apps by scanning the data network every 3 s
(`device_at(i)` census) and polling `input_text(appAlias, 0)` — the app's
transmission is readable under the APP's OWN alias. The registry
(`xa_alias` storage arrays) survives reboots. Simulation law in the app:
`app/src/engine/xenoncode.ts` §appkit (text fan-out + writer-publish +
ABI 16 per-device channels / RunInput); pins `chipos.test.ts`.

## The PilotSeat (this craft)

`components[13]`: occupancy `frame(0,0,1) pos(5,8,5) size(1,5,2)` → world cell span
x∈[5,6], y∈[8,13], z∈[6..8 cells] + 3 m (frame_z=1), i.e. centered ≈ (−0.125, 0.375,
3.125); pivot `position` (0, **0.929**, **3.109**); `orientation` identity
`{w:1,x:0,y:0,z:0}`. The seat's pilot/camera inherits the seat's orientation, so
rotating `orientation` pitches the rider. Mirrored occupancy: `blocks[12]` (type 255,
identical frame/pos/size).

## HUD & the Beacon radio — craft ↔ HUD ↔ craft channels (transcribed 2026-10-29)

**PLAYER HUDs live OUTSIDE blueprints** (v1.17.0 census): the client folder
`Archean-data/client/hud/<name>/` holds one dir per installed player HUD —
`main.xc` + its `include` files as PLAIN TEXT (the same `plain_code` body
dialect), the game's compiled `xc_program.bin`, a `storage/` sidecar and an
`active` marker; a subscribed Workshop HUD item is the SAME folder shape in
`workshop/content/2941660/<id>/` (a bare `main.xc` with a `#workshop_id`
header line — e.g. 3798785211, the speed readout). The programs run with
the HUD builtin set (panel()/beacon()/`get("avatar_sensor_speed")`/…) —
the app's Xenon ▸ Player HUDs loads them into the HUD IDE; saves write the
`.xc` files back (`xc_program.bin` is the game's to recompile, never ours).
Installed HUDs under `client/hud/` are machine-local — NEVER committed;
the law fixture is `testdata/hud/hudbench` (`tools/make_hud_test.py`).

Sources: `strings` over `ARCHEAN_hud.GAME_Mod.so` / `ARCHEAN_beacon.SERVER_Mod.so`
(API signature strings), the workshop craft **3518436870 "RCS Infinity"** (the
user's "RCS500" — its beacon frequencies are literally `RCS-500-HUD-SEND` /
`RCS-500-HUD-RECEIVE`), the client save **3326372833** (Badger fleet tutorial HUD,
999 lines, ships as fixtures 9000001015/9000003044), game doc
`modules/ARCHEAN_computer/components/Computer/documentation.xc`.

- **Beacon component** (`ARCHEAN_beacon/Beacon`, mass 2, adapters `data`+`lowvoltage`)
  carries `data: {transmitFrequency, receiveFrequency, transmitData}` — all TEXT.
  Frequencies are channel-name strings (any text; `RCS-500-HUD-SEND` style). Two
  components on matching frequencies exchange `transmitData` payloads (text).
- **Craft-side access is plain io**: the beacon is a DEVICE on an io port —
  `input_text(port, 0)` READS the payload RECEIVED on receiveFrequency,
  `output_text(port, 0, $t)` writes what TRANSMITS on transmitFrequency
  (RCS500 `main.xc`: `$in = input_text(8,0)` / `output_text(8,0,$in)` — the
  structured text object round-trips; `$in.use = …` mutates fields in place).
- **HUD side (PLAYER CLIENT)**: `HudController` (`ARCHEAN_hud`, mass 1, adapter
  `data`) carries `data: {version:1, xc_files:[{name, plain_code}]}` — the HUD's
  own XenonCode program, run CLIENT-SIDE when the pilot is aboard. Its builtins
  (from the .so, arg-typed): `beacon($transmitFreq:text, $receiveFreq:text):beacon`
  (init-phase/global-scope only) with `.data` (received text) and
  `.transmit($data:text)`; drawing: `panel($anchor,$w,$h):panel`,
  `virtualscreen($w,$h):panel`, `screen_copy($src,$dst,…,$color,$rotation,$bilinear)`,
  `draw_line/rect/triangle/circle`, `text*`, `button*`, `color(r,g,b)/color_a/g/b/r`,
  `set_position`, `set_resolution_scale(n)`, `pixel`, `display`. The craft's
  `beacon()` twin exists in the beacon module's .so too (inter-craft radio from
  programs — NOT confirmed callable from a MiniComputer; the computer-side
  builtin list lacks it: craft↔craft goes through Beacon components on io ports).
- **The payload "structured object" format** is the game's dot-kv TEXT:
  `.use{-40.076}.fl{0}.bat{0.999984}…` — XenonCode kv objects serialize/parse
  1:1 (the app's `parseKv` is the same shape). The Badger FLEET protocol nests
  them: `.schema{badger.secure}.version{2}.kind{join}.from{…}.to{FLEET}.nonce{…}
  .public{.schema{badger.fleet.join}…snapshot{…frequency{badger123}…}}.data{hex}
  .tag{hex}` — data/tag = encrypted+authenticated (key derived from the
  `frequency{badger123}` passphrase string; NOT reverse-engineered — treat as
  opaque). HUD is INFORMATIONAL client-side only ("never tutorial actions" per
  the Badger header: the computer relays pilot subscription only).
- Status: API list = binary strings (authoritative for names/arity), semantics =
  the two craft programs (RCS500 = minimal tx/rx loop; Badger = full drawing
  HUD + 3-resolution panel sets + camera-projection calibration). In-game RUN
  behavior (rates, payload size caps, range) NOT measured — the app today models
  neither HudController programs nor beacon radio in the sim.

### Player-installed HUDs — `Archean-data/client/hud/` (verified 2026-10-29)

The SAME program format also runs as a **player-side installed HUD**, outside
any craft — the user's "homo" HUD lives here:
`client/hud/<name>/main.xc` (+ `include"parse.xc"` shared helpers + the
client-compiled `xc_program.bin` + an `active` flag file); the game ships
`default_huds/readme/` (the in-game welcome UI — written entirely in this
API); F1 settings ▸ HUD tab toggles them. `client/hud/HudControllers/ENTT…/`
(dirs keyed by craft ENTITY id, same `ENTT…` form as the beacon
`from{ENTT…}` field) = the CACHE where a craft's HudController program is
DEPLOYED when launched to the player client (observed empty = transient).

Demonstrated semantics (homo / omfg / readme + the two craft HUDs):
- Frequencies are numbers OR text: `beacon(5,5664)` and
  `beacon("RCS-500-HUD-RECEIVE","RCS-500-HUD-SEND")` both legal.
- **Avatar sensors** (player-side world data): `get("avatar_sensor_speed")`
  (m/s), `get("avatar_sensor_altitude")` (terrain),
  `get("avatar_sensor_altitude_absolute")` — returned TEXT, parsed with a
  numeric parse helper; sea-level datum = absolute − 6 203 000 m.
- Fullscreen layer: `panel(center, screen_w, screen_h)`; anchors are WORDS
  (`top` `bottom` `center` `top_right`); panel coordinates are CENTRE-relative
  (negative offsets land up/left).
- Panel object API: `.blank([color]) .write(x,y,color,text)` (`\n` +
  `text("Page:{}",$n)` format strings) `.text_size(n) .text_align(…)`
  `.draw(color,x,y[,w,h]) .draw_rect/line/circle/triangle(...,color[,fill])
  .button_rect(...)/.button_circle(...)` (return 1 on click) `.set_position`
  `.newline_spacing(n)`; properties `.width .height .x .y .char_w`.
- Builtins/vars seen: `mouse_x mouse_y fov time screen_w set_cps(n)` (redraw
  rate), color words (`white black brown cyan`), `color(r,g,b[,a])` (alpha
  0-255), `size() pow round find sin abs`, string `&` concat, `$text.$i`
  indexing, `$v:number` cast, `for A, B ($x)` loops, `storage var` persists.
- **THE HUD CADENCE LAW (v1.16.13, ABI 17)**: `set_cps(n)` (wiki
  xenoncode/hud.md: "sets the number of HUD cycles per second") is the
  HUD program's OWN cadence, called from `init`. It cannot be pre-parsed —
  init RUNS (in scope), so the shim RECORDS the value (set_cps stamps
  `g_hudCps` in HUD mode only; clamped 1..250) and the app's HUD pump READS
  it live (`xc_hud_cps`) after every cycle, adopting `1000/n` ms the moment
  the call executes. Unset = the 25 Hz CYCLE_MS law; the editor's TURBO ×4
  multiplies on top of the program's own rate. Computers keep the fixed
  25 Hz cadence (the game drives them at server tick); the HUD pump STAMPS
  its VM instance (`hudRuntime: true` → `xc_hud_mode`) — the v1.15.2 law
  made live.
- **HUD→craft commands are a real control path**: the omfg header states the
  HUD relays PRESSURE to the vessel, which auto-reduces flight power —
  bidirectional craft↔HUD operability, "without using too many inputs on the
  computer". The installed-HUD mode is thus a THIRD actor the sim should be
  able to model (P9 HUD workspace covers both sources: craft HudController
  component AND an installed `.xc`).

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
- **The `smooth` flag (game `Triangle.inc.glsl` struct, verified Oct 20 2026)**:
  the in-game Triangle is a 16-byte record — 3 packed 5-bit vertices, `color[5]`,
  `material`, `temperature`, then a 16-bit state word whose bits 0-2 are
  `smooth` (`0` = flat/geometric normals, the default; `1` = smooth normals).
  In the JSON blueprint the state word is spelled out: a `smooth` key on the
  triangle record. Corpus census: workshop files store NO `smooth` key (⇒ flat),
  except 3732302108 where 174/241 triangles carry `"smooth":1` and 67 omit it.
  This flag is a REAL per-triangle record (what exactly it changes in the
  game's shading is only known from its comment — "flat/geometric normals"
  vs "smooth normals" — NOT from a mirrored behaviour; see the seam-render
  retraction below). Winding picks WHICH side is colours[0]-front; both
  directions are geometrically the same prism (our viewer renders them
  identically — hull.ts offsets along the winding normal and closes the
  solid, so inward/outward swap front/back, never shape). hullify writes
  `smooth:1` on every NEW triangle by default (the game's own convention
  in its hull saves), with a `flat` option that omits the key.
- **The storage window is FRAME-ALIGNED, so a MOVE can un-store a face (app
  v1.5.17 law, v1.8.6 consequence):** per axis the record holds
  `frame_ax = floor(min_ax/12)` and three 5-bit `v_ax ∈ 0..31`, i.e. a face
  stores only if its per-axis span fits `31 − (min − 12·floor(min/12))` —
  STRICTER than span ≤ 31: a 29-cell span straddling a frame border stores
  NOTHING while the same face 1 cell over does. Consequence (the user's "a
  valid zeppelin suddenly misses a face after rotations … the size doesn't
  inherently change", v1.8.6): a quarter-turn or a whole-cell drag
  keeps the SPAN but re-places `min` inside its frame, so any face with span
  > 20 can encode where it was authored and fail after the move. THE WRITER'S
  LAW therefore is CUT, NEVER FILTER: a position-mapped face whose image
  fails the window is subdivided (midpoint 1→4, mirror-symmetric ties) until
  every piece stores, and a group of records (main skin vs a Build subgrid's
  panels) is mapped GROUP-WISE — splitting adds records, so slicing one
  transformed list by pre-transform counts mis-assigns and drops faces.
  Implemented in `app/src/engine/latsphere.ts` (`splitFace` /
  `transformSkinTris` / `reencodeSkinTri`); pins `__tests__/splitface.test.ts`
  "transformSkinTris NEVER DROPS" + e2e `sphereskin.spec.ts` "rotate + drag a
  big balloon" (the BUILT file's area, top-level plus nested Build triangles,
  must equal the ghost's).
- **Seam rendering — NOT a documented mechanic (retracted Oct 20 2026)**:
  a same-day reading claimed the game keys triangle edges for adjacency
  (`MakeEdge`) and draws side walls only on FREE edges, making joined
  triangles render flush; our renderer briefly mirrored it (shared-edge
  wall cull + `smooth` cap-normal welding). The user ruled the mechanic
  does not exist, and culling rims turned the ISW-241 chrome wingtips into
  hollow sails — the rims are what makes a prism read solid. BOTH mirrors
  reverted; the viewer draws every prism's full 8 faces. LESSON (kept so
  it is not re-learned): the struct's helper comments (`MakeEdge` "for
  adjacency detection", `HasSameVertices`) describe the constructor/data
  model, NOT proven RENDER behaviour — the game's seam handling lives in
  its compiled builder and stays undocumented until a game-re-saved
  converted craft is byte-diffed against what we wrote. Useful facts from
  the census that stand as DATA (3732302108, in-game-authored skin): 232
  shared-edge pairs among 241 tris, 62 joins cross frames (records key on
  the absolute lattice), 197/232 joiners share identical `colours[0..4]`,
  221/232 the same `material`.
- **Flush mounts vs the skin — experiments PUBLISHED then REVERTED (v1.5.16,
  Oct 21 2026)**: over Oct 20–21 the prism extrusion was experimented with
  three times — placement-time "keep clear" (v1.5.13, user: "poison",
  excised), backward winding-relative extrusion (v1.5.14) and solid-side
  extrusion via block-cell probes + shell-parity voting (v1.5.15, branch
  `experimental/skin-solid-side`). v1.5.14/15 fixed flush Dashboards but
  made authored skin riding the block hull (ISW-241, airliner, Jimmy)
  develop visible block poke-through everywhere — flush caps no longer
  ENCLOSE block faces that bulge a little proud of the skin plane. The
  user reverted the line to the centred prism ("publish last known working
  version, even though dashboards problematic"), making the burial a KNOWN
  ACCEPTED defect. MEASURED FACTS that stand (verified against the real
  files, kept so the next attempt starts from evidence): flush Dashboard
  content is 0..0.02 m proud of its mount; the game skins triangles EXACTLY
  coplanar over its dashboards (fixture 9000006001 outward-wound; Jimmy's
  murals inward-wound at offset 0.0000) and keeps them visible IN GAME;
  the game never moves stored anchors (byte-diffed re-saves); XenonViewer
  centres ±0.025 like us. Both in-game properties (no poke-through AND
  flush visibility) therefore CANNOT come from any per-triangle extrusion
  direction alone — the next attempt must target the RENDER pass (flush
  components never occluded by coplanar skin) while keeping the prism
  enclosing block faces where blocks and skin coexist.
- **v1.16.4 LANDED — FLUSH CAP CULL (`app/src/engine/build.ts`
  `dashPlanes`/`coplanarOverDash`, pins `flushcap.test.ts`, census
  `app/tools/flatdash.mjs`):** the render-pass attack above is law. A prism
  cap (or v1.16.3 flat sheet) that lies IN a Dashboard board plane, OVERLAPS
  the board rect (corner/edge-mid/centroid samples) and FACES THE CONTENT
  SIDE (parallel normals, cap plane 0..HULL_T proud of the board plane) is
  DROPPED for the DISPLAY pass only. Back cap + all rim walls verbatim, every
  non-matching face verbatim, the file untouched — NOTHING moves, so the
  v1.5.14/15 poke-through failure mode cannot occur (caps over block faces
  are never culled; blocks own their faces). Measured: Chip's Badger
  (3326372833) from a seated eye above the chair buried 9/13 dashboards
  under the +0.025 m cap; after the cull 11/13 are visible in BOTH modes
  (the 2 `tri` hits are dashboards mounted OUTSIDE a wall panel — the wall
  occludes them exactly as the blocks did). Viewed from ABOVE a top deck,
  under-deck dashboards stay occluded — real geometry, identical for blocks.
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
  - **v1.11.0 GAME-DAYLIGHT rendering law (XenonViewer `js/viewer.js` +
    `js/scene.js` transcribed 2026-10-25, NOTICE §2).** Reading slots as
    linear is only HALF the law — the dev viewer's render rig is what makes
    the colours READ right, and it is: `LinearToneMapping` @ exposure **0.9**
    (`viewer.js:47 DEFAULT_EXPOSURE`; "ACES compressait et désaturait tout ;
    un mappage linéaire restitue les aplats" — `viewer.js:209-213`), a
    PMREM'd **DAY SKY** environment (blue zenith #2f6ea8 → warm sand
    #6b563c with a sun halo on the LIGHT_DIRECTION; `skyEnvironmentTexture`),
    a full-day light rig — hemisphere 0x9ec4e4/0x8a7250 @ **0.35**, sun
    0xfff6e0 @ **1.0** at (9,12,6), cool fill 0.12, warm bounce 0.10, and a
    build-sized RectArea **softbox** 0.14 (`TIMES_OF_DAY.day`,
    `viewer.js:75-99,254-281`) — and `envMapIntensity` **1 on EVERY
    material** (`pbrMaterial` in `scene.js` sets none; "un métal ne s'éclaire
    pas, il réfléchit, et sans ciel ni sol il rend noir quelle que soit sa
    couleur"). The app+viewer previously lit a ~2.1× brighter studio pair
    (hemisphere 1.1 + sun 2.2, no tone map, RoomEnvironment env on metal
    only at 1.25): blacks read grey, the truck's deep reds washed to
    sky-blue-cast brick, chrome blew out. Measured (iso-framed truck
    render, mean RGB): deepred class dev (66,36,26) vs old-ours (86,55,55)
    → new-ours (65,35,24); black class dev (35,33,30) vs old-ours 3 % of
    the craft → new-ours 11 %.
  - Slots **0..10 are engine-reserved** (the reader re-imposes the built-ins);
    full built-in table in `viewer/palette.js` (from the game's BlockShapes.hh,
    same source the dev's XenonViewer generates from).
- **v1-format files (23 of the 24 corpus files!) carry NO `data.colors`
  palette** — every slot references the BUILT-IN table. The built-in palette
  is FOUR CONTIGUOUS 17-colour families (white, 3 greys, 3×red, 3×green,
  3×blue, yellow, cyan, orange, violet, magenta), one per finish: matte slots
  **40..56** (rough 7 — the dashboard/mosaic crafts live here), polished
  **80..96**, metal **120..136**, tinted glass **160..176** (opacity 2);
  every slot 11..39, 57..79, 97..119, 137..159, 177..255 is EMPTY (the magenta
  marker when referenced). Transcribed VERBATIM from the dev's XenonViewer
  `js/palette.js` (BlockShapes.hh-generated, NOTICE §2; its non-null ranges
  are exactly 0..10 + 40..56 + 80..96 + 120..136 + 160..176, and
  `js/blueprint.js` `resolvePaletteColor` (lines 85-100) applies NO index
  remap to ANY file — v1 and v2 read the SAME table).
  v1 `components[].colors` is a `[slot, slot]` **index pair** (color1, color2),
  not a dict — the game's own migration resolves it through the built-in at
  SAVE time (proof: the game's re-save 3812927875 spells ISW's v1 pair
  `[51,3]` as `color1 {1,1,12}` = matte slot 51's colour verbatim; the app's
  `normalize` mirrors that). Unresolvable slots render as a magenta marker —
  a craft "all in purple" means the built-in groups are missing, not that
  the file is odd.
  - **v1.11.0 — the "+4/+8/+12 `legacySlot()`" remap is RETIRED (identity).**
    v1.5.11 introduced it to plug v1 indices into this repo's built-in table,
    which had TRANSCRIBED THE FAMILIES FOUR SLOTS HIGH (polished 84, metal
    128, glass 172 — the fetched XenonViewer table says 80/120/160). The
    shift + shifted table composed to the CORRECT colours for palette-less v1
    files (slot 85 → 89 → [16,1,1] — the truck's candy red all along), so the
    purple-block class stayed dead — but every PALETTE-CARRYING file reading a
    built-in slot in 84..96 / 128..144 / 172..188 read the family SHIFTED
    (slot 92 resolved [1,8,1] dark green where the game/dev read polished
    yellow [255,255,16]), and slots 97..100/137..144/177..188 carried entries
    the dev table leaves null (no magenta marker for genuinely-missing slots).
    The table is now the dev's verbatim; `legacySlot()` = identity (kept as
    the GENERATION seam for normalize's embed and the wheel-droop gate). The
    v1.10.2 "magenta = EMPTY palette slot, repair the file" rule STANDS —
    it just no longer mixes with a family-shift: a magenta face is ALWAYS a
    cleared/absent slot (see the Badger door entry under §Subgrids).
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
  **ToggleButton is a two-state device the same way**: the `.ini` pairs
  JOINT `axle` (ZYX rot 18,0,−180 = pressed) + RENDERABLE `switch` with JOINT
  `axle2` (18,0,0 = released) + `switch2`; exactly ONE lever renders, keyed on
  `data.state` (missing = false). `base2` is the second-face plate: render
  only when `data.isDualSided` (same for PushButton's base/base2). Drawing
  everything stacks a lever ghost flipped 180° about z — a second lever
  sticking through the mount (the dolphin 3417786605 "misplaced door
  buttons"); pinned by the generic ?postest `btn-*` suite (all 24 corpus
  craft have buttons: 22 legacy + 2 modern).
  **Mount bake (v0.146):** the game mounts buttons base_planes-FLUSH — the
  mount face is the PLATE FRONT (pilot side), which bakes a local **yaw-180**
  into the model: the plate box (0.24 m, sitting at pivot + 0.34 m local −z
  after the bake) covers the authored 1-cell hull gap facing the cockpit and
  the lever hides inside the wall; a pressed deck button flips its lever UP
  out of the deck. The file quaternion does NOT carry this yaw — raw
  placement parks the plate 0.68 m BEHIND the pivot (into/behind the wall):
  the dolphin + Cede crafts (3381670618/3348400160/3373508061, one author,
  identical door trio at x±1.38 z 6.38 + a deck button) rendered as "a gap in
  the fuselage, the button further back, away from cockpit". The cable-cache
  socket sits at the exact pivot → the position is raw-exact, only the model
  yaw is baked. Viewer bakes it display-only (applyDisplayPose, wheelUndo
  write-back). Pinned by postest btn-plate-flush/btn-lever-pose.
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
  joints/adapters (ini). Find the install on ANY machine via
  `python3 tools/find_install.py` (procedure + layout: LOCATIONS.md).
  Regenerate the atlas:
  `python3 tools/extract_models.py ~/.local/share/Steam/steamapps/common/Archean/Archean-game -o viewer/models`
  (only `manifest.json` changes for material-table updates; geometry jsons
  are byte-stable).
- The dev's viewer (`viewer.xenontools.dev`, js/{scene,blueprint,palette,blockshapes}.js —
  full URLs + the xenontools.dev hub and the official Archean wiki page are
  indexed in LOCATIONS.md § Upstream / reference viewer documentation)
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
- Flight analysis (collapsible ▾ panel, remembered): "kg / block cell" = mass per
  0.25 m structural cell — **auto-calibrated on load** so parts+cells = declared
  `mass` (the old "calibrate cells to declared mass" button was removed in
  v0.149: the manual step was inscrutable and the automatic one always runs).
  Flow shows particles **and**
  streamlines (integrated through the same stylized deflection field; blue =
  freestream, red = accelerated flow. Stylized, not CFD).
- **Display poses (`applyDisplayPose`, display-only):** per-component canonical
  display quaternions, all writing back through an inverse (`userData.wheelUndo`)
  so saved quaternions stay file-exact.
  - *Wheel suspension droop — MODERN files only (RE-LANDED 2026-10-19,
    user-confirmed; the LEGACY viewer always drew it):* the rule reads the
    file as storing the BUILD pose (arm horizontal, wheel centre 0.447 m off
    the pivot) and display-rolls the wheel about its axle to hang BELOW the
    mount (vertical-axle casters can't droop and keep the pose). The same
    day's RETIREMENT was arbitrated on the semi truck 3481322297 — a LEGACY
    (raw-quat) file, where the roll swings BigWheel discs ±0.899 m off the
    dev's placement: there the rule stays **OFF** and app == dev to ≤8 mm
    on all 16 wheels (wheelpair). On MODERN (palette/conjugate) files that
    verdict did not carry: the app's content-basis pose left ISW-241's
    crawler casters **sticking up** (hub top 1.705 over the mount y 1.009)
    while the old JS viewer and the sister legacy craft 3518436870 hang the
    identical part to 0.313..1.124 — the user's in-game memory matched the
    hanging look, so the app droops MODERN-file wheels only; after the fix
    the ISW front caster lands on 3518436870's box to the millimetre.
    XenonViewer's modern-file caster pose (its raw-quat roots are its own
    documented bug) is NOT an arbiter here. Pinned by
    `app/e2e/wheels.spec.ts` (@SmallWheel @BigWheel) and
    `compparts.test.ts` (arm→−y for modern, untouched for legacy).
    **v1.11.8 scope narrowing (we: "the front-wheel of the F18 seems to be
    rotated wrong"):** the roll is a CASTER rule — validated for the
    ISW/3518436870 crawler casters, which are `SmallWheel`. It fired on the
    F/A-18F 3521588534 nose gear's big `Wheel` pair (orientations w=±0.707,
    y=∓0.707 = ±90°ŷ steering mounts) because its gate (horizontal axle,
    arm reachable) passes on them, and yawed each wheel 90° about the
    longitudinal axis — a blade-edge-forward wheel in the editor. The roll
    is now **SmallWheel-only**; `Wheel`/`BigWheel` ride the plain view law
    (the F/A-18F nose wheels pair with dev at 0.001 m, wheelpair; the
    crawler hangs are unchanged).
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
  0.135 m connector-stub offset. ~~The conjugate (file) pose stands the comb
  upright and matches NONE of these cables~~ (v1.5.11: under the ONE raw law
  the file pose IS the flat pose — the "sticks out" symptom was our own
  conjugate read, now retracted; the user's junctions "stick out" complaint
  was that). Display pose = the RAW file quaternion `(w,x,y,z)` = the
  builder/v0.91 layout: model lies flat, ports align with
  its own cached cables (selftest: inlet faces view −y). Display-only via the
  wheelUndo write-back; saved quaternions stay file-exact. No endpoint
  translation is needed (and none is done): the cables' cache frame IS the
  display frame, so they meet the flat model as recorded.
  **v1.5.11: the display pose IS the raw FILE quaternion for BOTH
  generations** (the app's `displayQuat` returns `qFile` verbatim) — the
  builder's flat pose is what the single storage convention encodes. The old
  "compute `(w,−x,−y,z)` from the file quat — convention-dependent!" passage
  below is the mirrored-era recipe; kept only as the record of how the
  legacy/modern junction split behaved back then (byte-identical ISW/RCS
  junctions rendered FLAT vs standing-on-end, bbox y-size 1.00 m — a
  symptom of the two-law split, one more reason it died). Pinned by
  `?postest` fixtures rcs-fj-flat/rcs-fj-touch (they assert the FLAT comb,
  which the one raw law satisfies on both generations).
  (Historical: view-derived code matched only modern files and conjugated
  legacy junctions by 120° about (1,1,−1). Proof: ISW-241 and RCS-infinity
  (3518436870) carry byte-identical FluidJunction positions+quats, rows at
  y 0.88 z −1..−3.)
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
  −x (green). This section's old conclusion — that OUR chain therefore had
  to "counter-mirror every text layer locally" (PRE-MIRRORED dashboard
  canvas `translate(w,0); scale(-1,1)` + in-plane `flipGeomX` on baked glyph
  prims `code_button_text`, `reboot_button_text`, `code`, `subscribe`,
  `codein`, `activein`) — was an artefact of the removed world mirror: a
  local double-mirror inside a mirrored world. **Since the v0.180 de-mirror
  both layers render RAW** (FORMAT §"Chirality vs in-game truth"): the raw
  canvas on the board's +z face reads correctly from the authored side, and
  baked prims are untouched geometry. Through the chain, `TEST`
  reads from +z, the mast (+red lens) leans toward the red cube, red cube
  RIGHT of a +z camera (= the game's own side; the dev render agrees) — Selftest
  pins: `dashtext=true` (raw left-advancing canvas probe) + `orienttext=true`
  (the fixture's own plate rebuilt through the shipped chain: +z text face,
  raw canvas, no mirror scale).
- **`components[].mirrorAxis` is the game's per-component symmetry mirror**
  (dev `scene.js`: `scale[mirrorAxis−1] = −1` on the component — draws the
  part geometry mirrored on x/y/z for 1 (negative) symmetry builds). Every
  corpus file has 0, so it is inert today; a non-zero value is the ONE
  genuinely per-component mirroring knob in the format (backlog: apply the
  same local scale sign so both viewers agree if such a file appears).
- ~~**Component rotation STORAGE flips with the game generation — two
  conventions, keyed on `data.colors` (v108).**~~ **RETIRED v1.5.11 —
  ONE RAW LAW (see §Handedness ruling above): both generations store the
  quaternion AS-IS and the game places with `R(q)`.** The two bullets below
  are kept as the historical record of what was measured where; the legacy
  (RAW) half was always right, the 2026-conjugate half was a mirrored-chain
  artifact of the pipes measurement.
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
    raw+front=−ẑ). View quat = the stored quaternion AS-IS (pre-v0.180:
    `(w,−x,−y,z)`).
  • **2026 files (`data.colors` present): stored CONJUGATE** — ISW-241's own
    `data.pipes` endpoints reproduce only under `R(q*)` (0.000 m, comptest
    60/60; beacon lean, caster droop, junction flat-frame all verified).
    View quat = `(w,−x,−y,−z)` (pre-v0.180: `(w,x,y,−z)`).
  The key is structural (palette feature = same game update as the
  serialization change); corpus: 24 palette-less files (2024-08..2025-07)
  raw, the one 2026 file conjugate. Dev-viewer consequence (explains
  long-standing confusion): raw placement is CORRECT for legacy files —
  the dev renders the 2024 mosaic "perfectly" — and 45°-tilted for 2026
  craft (its ISW dashboards/battery lean); we are game-true for both.
  Selftest `mural=true` pins the legacy side. `viewQuat`/`rawFromView`
  switch on `LEGACY_Q` (set in `setModel`); saved files stay byte-exact.
- **Rotate gizmo (v0.150/v0.151) attaches to a scene-root PROXY**
  (v0.163: the proxy rides the part's VISIBLE CENTRE — bbox centre, the
  anchor of the mode widget/selection box/click — not its pivot; the MOVE
  writeback subtracts the stored centre→origin offset `_gizOff`; v0.167:
  the ROTATION writeback ORBITS that centre — `p' = c + R(dq)·(p−c)` with
  c = bbox centre of the VISIBLE geometry (proxy ∪ real siblings; the
  real game meshes render offset from the part origin, e.g. the beacon
  mast, MiniComputer 3 m off — a pivot-only spin lever-swung them, user
  report) captured once per gesture at mouseDown; mirror twins orbit
  their OWN centres (the mirrored self-centre), sliders keep the game's
  pivot semantics; v0.170: subgrids have NO gizmo (they ride their
  masters' joints); the
  axis-less trackball rings
  are hidden and the ring PICKERS hug the visible rings):
  TransformControls writes the attached object's quaternion raw, while parts
  must go through `applyGizmoOrientation` (dirty flag, real-model mirrors,
  `syncAdapters`, then `rawFromView` for the file quaternion). Component
  roots carry `scale.z=−1`, and THREE `decompose()` absorbs a negative
  determinant by negating **sx** — so `getWorldQuaternion()` = `qv·Ry(π)`.
  That stripped frame is exactly the WYSIWYG gizmo frame (its axes are the
  part's VISIBLE raw axes x̂, ŷ, −ẑ), and a local-mode ring drag `P ← P·R(e_k,θ)`
  maps back through `qv ← P·Ry(π)` into the world form `qv' = R(drawn axis,θ)·qv`.
  Ring drag = INTRINSIC (space='local'): each drag spins about the ring's
  currently-drawn axis, so pitch-90-then-roll-90 composes like you see it.
  Writeback shortcuts (plain copy, or a flipZ conjugation) put the part
  180°/mirrored off its rings — `?gizmatest` `live`/`proxy`/`file` pins and
  selftest `gizmo=true` catch both. Order algebra + visual stops: `?gizmatest`
  (synthetic single-PilotSeat blueprint, camera in front of the seat,
  `&shot=1|2|3` screenshots before/+pitch90/+roll90).
- **Gizmo handle geometry + hover picking (v0.165 root cause):** three r169's
  `setupGizmo` BAKES every per-mesh position/rotation/scale INTO the geometry
  (mesh transforms reset to identity), and `updateGizmoResolution` zeroes
  every handle's rotation EVERY frame — the raw-torus ring PICKERS (positioned
  by mesh rotation upstream) collapse into ONE coincident XY-plane torus, so
  TGC's first-surface picker raycast answers a different axis than the ring
  under the cursor (the v0.162/163 "wrong axis becomes yellow and thick").
  The viewer therefore (a) builds fat hover variants by CLONING-and-fattening
  the BAKED geometry in place — toruses: tube scaled in its own plane about
  the ring CIRCLE (a semicircle's bbox centre is NOT its centre, fanning
  about it shifts the fat ring), cylinders: radial about the longest bbox
  axis, boxes/octahedra uniform about centre; and (b) replaces the picker
  raycast with a true ray↔ring-CIRCLE distance on the VISIBLE semicircle
  (`ringPickerRaycast`; baked-plane basis `RING_PLANE`, camera-side wins at
  crossings, scale-aware because TGC rescales handles by camera distance per
  frame). The XYZE trackball pick sphere shrinks to E's 0.16 so ring hovers
  pick rings; centre drags keep the trackball.

## Propulsion & the viewer's wind model (v0.122; RCS rule v0.148)

Thrust axes (from each propulsor's game `.ini` `[TARGET plasma]/[thrust]`
nodes; a TARGET `rotation = -90 0 0` maps node-forward (−z) to local −y):

| type | local thrust axis | class weight |
|---|---|---|
| BigThruster | (0,−1,0) | 1.0 |
| MiniThruster | (0,−1,0) | 0.4 |
| SmallThruster | (0,+1,0) | 0.15 |
| RCS | none — see below | 0.25 |
| Propeller | (0,−1,0) | 0.6 |

Blueprints store no newton figures — weights are display ratios. **Propellers
thrust BOTH ways** (user-verified behaviour): their arrows render double-headed
and they are EXCLUDED from the net-thrust vector. Net = Σ axis·weight over
rockets; |net| < 0.15·Σweight ⇒ "net ~0 (symmetric bank)" and no direction is
suggested.

**RCS is NOT a fixed-axis jet.** Its `.ini` carries no JOINT/gimbal and a
single `[TARGET thrust]` at local +z `rotation 0` (the model's bell flare sits
on +y, so the TARGET is a template pose at best), yet the game can fire the
blob in 5 selectable directions — and the blueprint stores NONE of which. The
old single-axis guess `(0,0,−1)` drew a straight-DOWN thrust arrow at ISW-241's
nose pod (user: "we have no downward pointing propulsion of any kind"). The
rule (user): **an RCS counts as propulsion only when it is the craft's ONLY
propulsion class**, and then "normally it pushes BACKWARD" — arrow, net and
main-drive all point tail-ward along −flight heading (cockpit first, fly-view
+z fallback; heading only, a reclined seat is not yaw). With real engines or a
Propeller aboard, RCS gets no arrow and no net weight at all. FluidPorts never
enter this table — connectors are no more propulsors than wheels are.

Relative wind = −flight axis. The axis comes from flow-src `auto` | `seat` |
`thrust`, yawed by the "wind from side" azimuth slider and elevated by AoA
(props reverse → the direction stays user-controllable, `?flowsrc=` presets it).
**`auto` uses only the MAIN drive net (BigThruster, or an RCS-only craft's
backward push); Mini/Small thrusters are landing/trim jets and must NOT set the
direction** — auto flow "from below" was the user's complaint. RCS-propelled
craft with a cockpit still fall back to the COCKPIT: "cockpits almost always
face in the right direction". On contested (multi-seat) craft the PilotSeat
REACHING a Computer/MiniComputer/
OwnerPad over the `data.pipes` graph (`p.a_component`/`p.b_component` edges)
wins — the editor wires the pilot's cockpit to the flight computer. Manual
`thrust` mode = user override, full net (incl. RCS when sole-class).

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

## Component VERTEX SPACE — the engine content basis C (final, 2026-10-19; XenonViewer-arbitrated)

Every component's glTF meshes are placed by ONE uniform map (no per-asset
exception — the "per-asset" theory of the Oct-6/earlier-today notes was an
artifact, see §Why the census fooled us):

    content = C · chain(.ini RENDERABLE/JOINT/TARGET: T(pos)·R_ZYX(euler)) · C⁻¹ · v_gltf
    C (file → engine content frame) = (x, z, −y) = rotation Rx(−90)

- **Ground truth = the XenonViewer's scene graph**, user-confirmed against the
  game ("100% right in all its shows"), and verified mechanically: reading its
  live scene (`window.__xv`) and inverting each component's own matrix gives
  per-part content boxes that equal OURS only when ours is C-rotated (ISW
  audit 2026-10-19: every discriminating type dev = C(ours)). Its published
  catalog node tables are exactly C-transformed `.ini` chains (axle
  (0,−0.12,0) → (0,0,0.12) etc.).
- **app/ implementation**: `scene.ts buildReal` hangs the RAW .ini node chain
  under a basis group `rotation.x = −π/2` (that's C), over atlas vertices
  baked ONCE at load with `unityBake` = C⁻¹ = (x,−z,y) (`models.ts bakeGeo`,
  full + `lv` prims). Special paths: the **data-generated propeller** soup is
  authored Y-up like the dev's `propellerGeometry` → `unityBake(gen.v)` at
  swap-in; the **Dashboard** builds board/elements in the shared frame with no
  basis wrap, and its dataport glTF piece un-does the bake
  (`m.rotation.x = −π/2`) to match the dev's raw-vert connector; the **Beacon
  lens** rides the model's dominant-spread-axis tip (baked mast = +ẑ).
- **Root quaternion conventions (legacy raw / modern q*, junction-flat,
  ToggleButton yaw-180 display rules; **wheel droop RETIRED in the app
  2026-10-19** — wheels ride qView like everything else, see §Display
  poses): C is a
  CONTENT-basis change below the root, orthogonal to the chirality layer
  (FORMAT §Chirality, §Handedness).

### Why the collider census fooled us (2026-10-19, lesson kept)
The `[COLLIDER]` manifest boxes are authored in the **BAKED-FILE (Unity
import) frame**: raw-chain + C⁻¹-baked verts fits them *axis-perfectly*, while
the RENDERED content (one extra C above the whole chain) sits C-rotated from
them. Fitting "raw vs baked" clouds against those boxes therefore classified
assets into fake "z-up/y-up" families — a basis difference masquerading as
per-asset data. `tools/asset_space.py` (the census) is kept for provenance but
is SUPERSEDED; the collider is only an arbiter within one frame.
Also kept from that era: extract_models DROPS the .ini collider
`position`/`rotation` fields (min/max only) — beware any future collider work.

### The solo-pair routine (the ritual that settled it — RE-RUN after game
updates or loader changes)
```
python3 tools/make_solo_test.py              # one component per craft, ids
                                             # 90000030NN, identity quat, corpus
(cd app && node tools/solopair.mjs)          # each craft rendered in BOTH
                                             # viewers at the dev iso; writes
                                             # reports/solo/<Type>-{dev,app}.png
                                             # + solo.json (per-viewer LOCAL
                                             # content bbox via scene graphs)
python3 tools/solo_verify.py                 # IoU of the silhouettes + local
                                             # box axis check, per type
```
A component that disagrees with the dev viewer is a PER-TYPE exception to
document HERE (never a code table) — as of the first full run all types share
the uniform rule. FIRST FULL VERDICT (2026-10-19, 106 types): LOCAL-BOX
MATCH 104/104 (ArrowButton/Led have no dev-side glTF content to measure) —
every component's content bbox, measured from each viewer's OWN scene graph
and inverse-transformed by its component matrix, agrees to <0.12 m. 74/106
silhouette IoUs ≥0.62; the 32 lower ones ALL carry the box match — the IoU
screen is colour-sensitive exactly like matrix_iou's ("a queue, not a
verdict"): pale parts merge into the dev sky mask, horizon bands hijack the
largest-component pick, thin parts are framing-sensitive. Suspect set = whichever
types the user flags; `--types Aileron,SolarPanel` runs a subset. Pins: vitest
`asset-space.test.ts` (C/bake algebra), e2e
`asset-space.spec.ts` (solo-fixture spans = the C·chain·C⁻¹ clouds),
e2e `propeller.spec.ts` (basis-robust sorted spans).

### The REAL-CRAFT root check (the ritual's blind-spot companion — same rule:
re-run whenever a component looks rotated/translated wrong in a real craft)
The SOLO fixtures are identity-orientation and the box verdict inverts by
each viewer's OWN component matrix, so anything riding the component ROOT
(root quaternion conventions, display-pose rules) is invisible to them BY
CONSTRUCTION. `node app/tools/wheelpair.mjs <craft-id>,… [--types=Wheel|Beacon]`
pairs the live-WORLD bboxes of every matching component in BOTH viewers (dev
`userData.box` / app `compRealBox`) keyed by the component's file position.
FOUND (2026-10-19, this is how the wheel droop died): solo verdict 104/104
green while the semi truck's 16 wheels sat ±0.899 m (BigWheel discs) and
~0.29 m (angled casters) off the dev viewer — the retired DROOP roll. With
it removed: all 16 truck wheels + 4 RCS-infinity wheels/beacons ≤8 mm vs dev
(legacy formats: dev's raw placement ≡ our converted qView). MODERN files:
the dev viewer's raw-quat ROOTS are its own known bug — the game's uniform
law is R(qFile*) (ISW-241's own written pipe endpoints seat its junction
ports at 0.000 m under the conjugate, 0.18–0.29 m under raw), so a modern
root disagreement with dev (ISW rear caster 0.581 m) is arbitrated by the
CABLE LAW, not by dev; see §Display poses wheel-droop entry.

## Subgrids (`Build` components) — attach semantics, fully decoded (v0.153; join decoded v0.154)

`ARCHEAN_build.Build` is the component that CARRIES a sub-construction — the part
that hangs off a pivot/hinge/rail and moves relative to the rest; the game calls
it a *subgrid* in player UI ("Delete subgrid & contents") (dev-viewer comment,
transcribed). Corpus: every craft with subgrids has exactly one
`data.composite_builds` entry per Build component (5 in dolphin; 1 in Jimmy's
Adventure = 3334698274).

- **A Build inside subgrid content is an ASSEMBLY NODE (v1.11.6, we: the
  Dorito SSTO front wheels — Wheels two Builds deep):** the ghost rule
  covers the ENTRY (a Build component renders no geometry of its own);
  the entry's own `data` (blocks/triangles/palette/components) renders
  RECURSIVELY, each Build's faces resolve through ITS OWN `data.colors`
  (the v1.11.0 scoping per build, at every depth).
  A `composite_builds` join whose `slaveBuildId` names a nested Build keys
  to the hosting top-level group (`path[2]`): the subassembly's joint
  line rides the host group's chain (gear swings inside its bay). Pins:
  `app/src/engine/__tests__/subgrid.test.ts` + `app/e2e/subride.spec.ts`
  (engine `subStats()` census === the file's nested census).
- **THE RIG CHAIN (v1.11.8, the F/A-18F gear legs — we: "there are missing
  cables, or not rendered and a hinge that seems to be in an incorrect
  position"):** content nested inside a Build is NOT parent-frame absolute —
  the Build carries a rigid transform for its content: raw `position` + RAW
  `orientation` quaternion (v1.5.11 law), composed down the nesting. The
  reference reader is literal (XenonViewer `blueprint.js` readBuild:
  `world = parentWorld · compose(position, quaternion, 1)`, the top-level
  readBuild starts at the identity matrix, and `scene.js` transforms blocks,
  triangles, struts, frames, PIPES and components by `model.builds[b].matrix`).
  The top-level rule is v0.168 re-derived (identity chain = content
  parent-absolute; the top build's own pose is composed by the app's v1.10.2
  JOINT pose, whose baked-bench rotation part equals the affine's — bench
  census 157/166). Nested levels compose RAW: on identity-bench crafts
  (XYQ doors, dolphin fins, Badger — every nested bench is (0,0,0)+identity)
  the chain is the identity transform and nothing moves; on RIG crafts the
  chain places the saved assembly pose — the F/A-18F stores its gear legs as
  rigs 27°∘59.4°∘90°∘29.7° with telescoping translations, its steering
  pivots + gear harness routers authored ONTO the rigs' invariant lines
  (the chain leaves them EXACTLY in place; the legs/wheels swing up into the
  bay = the retraction the file saved). v1.11.6's identity nesting stranded
  the nested pivots mid-bay and buried the nested harness sockets (pipe ends
  0/7/97/100/102/104/269/276) inside the hull — the "missing cables".
  App: `subgrid.ts rigChainOfPath/rigPush/rigApply` + rig Groups in
  `buildSubgrids` + chain∘group composition in the v1.11.5 harness attach
  (`buildPipesMesh`), so nested sockets AND the recorded tips riding them
  land on the rigged pose. `subBlockBBoxRigs` clamps captureJrefs' pivot onto
  the CHAINED content bbox. Audit (all 13 rig crafts of 117,
  `app/tools/gearpair.mjs` live app↔dev world boxes): 205 parts moved
  TOWARD dev, 3 away (≤ 0.32 m), identity crafts byte-identical. The
  F/A-18 gear-leg residual (~0.7 m) is the v1.10.2-class TOP composition
  (joint pose about the master's clamped line vs dev's raw bay affine about
  the builder's fold beam) — in-game pixels arbitrate; see GEAR-F-A18F.md.
  Pins: `app/src/engine/__tests__/rigchain.test.ts` (dev-verified chain
  literals, invariant-axis parts, identity-craft invariance).
- **The nested data carries `triangles` (v1.9, transcribed from the dev
  reader `blueprint.js`):** `readBuild` is invoked recursively per `Build`
  component and iterates `buildData.triangles` (same frame-corner + CELL
  lattice math as the top level, palette = the build's own), exactly like
  `blocks`/`components`/`pipes`. So a SUBGRID PANEL can be hull triangles —
  the corpus has no authored precedent (no Build ever carried triangles),
  which makes the app's nested-skin pass (`scene.ts buildSubgrids` renders
  `data.triangles` through the same prism buckets as the main skin) and the
  in-game look of a TRIANGLE panel on a hinge the user's in-game territory:
  the Generate-balloon fin panels ship on this law (their rotation follows
  the §Subgrids joint kinematics — panels-ride-pivot like every door).
- **PER-BUILD PALETTE SCOPING (v1.11.0, the Badger's pink doors):** a nested
  `data.colors` is THAT build's whole palette — XenonViewer `readPalette(
  buildData.colors)` per build (`js/blueprint.js:172`), so a nested face slot
  resolves through the BUILD's palette with ONLY the built-in table below it
  — never the parent craft's. Resolving nested faces against the TOP-level
  palette is the bug, and 3326372833 "Chip's Badger" is the proof craft: its
  DOORS are nested Build skins whose own slot 12 = the painted deep red
  [32,2,2,15,7,0], while the top-level palette carries slot 12 CLEARED (`0`).
  The app fed the top-level palette into `buildSolids` for nested content
  (`scene.ts`) → every door face hit the top-level cleared slot → the magenta
  marker painted the doors PINK; XenonViewer (scoped) renders them deep red.
  **RE-DIAGNOSIS of v1.10.2:** "the file palette carries 0 at custom slot 12
  while 41 skin-triangle faces still reference it" looked one palette UP —
  no TOP-level face references slot 12 (census: top-level faces use 0, 3, 4,
  8, 11, 41, 42, 13 only), so the slot-12 file repair whitened a slot nothing
  references at top level, and Chip's next publication (v4.5+,
  2026-10-25: 1255 top-level triangles, nested doors unchanged) showed the
  pink doors unchanged. The rule that stands: a magenta craft face means a
  CLEARED/ABSENT slot IN THE PALETTE THAT FACE RESOLVES THROUGH — check which
  build owns the face before repairing the file. Both engines scope the
  palette per build now (`scene.ts buildSubgrids`, `view3d.js
  addBlockMeshes(..., c.data.colors)`).
- **Stored at grid coords, in the PARENT frame (v0.168 correction):** the nested
  `data.blocks`/`data.components` are authored in the PARENT craft's cell/
  metre coords (a CLOSED hatch seals the hull at its parent cell — see
  §sealStats, which reads `pos+12f−5.5` straight off the nested blocks). They
  are NOT local to the Build. The viewer's per-subgrid group base is therefore
  the IDENTITY (children `viewPos(sc.position)`), NOT `viewPos(Build.position)`
  — composing the Build pose on top double-offsets the content. This was the
  "SU-57 parts exploded out" bug (SU-57 gear doors sit at bench x=±21 ⇒
  rendered x=±39) and the "rotation on the dolphin/subgrids doesn't work"
  report (the group origin WAS the Build bench pose, so gizmos parked metres
  from the doors). Build.position/orientation are the builder's construction-
  site GHOST pose (same convention as the top-level `Build` = far outside the
  bbox, never rendered as geometry) — a DISPLAY offset for the subgrid, applied
  on top of the identity base (so a builder who moved the whole subgrid
  preserves the nested-content offsets), NOT an origin. The per-subgrid group
  carries no scale.z=−1 (the children already embed the single z-mirror).
- **`composite_builds[]` = `{component, slaveBuildId}` — the join IS decodable:**
  BOTH indices are FLATTENED component indices — the array formed by the dev
  readBuild push order, counting nested content recursively **before** the
  Build itself (nested components register first, then the Build). Verified
  over the corpus (dolphin doors are at top-level 4..27 but numbered
  4,9,16,40,45 flattened). Pins: selftest `subjoin`, dolphin + XYQ postest
  fixtures.
- `component` = the MASTER the subgrid rides, in the SAME flattened domain
  (v0.171 fix, user: "jimmy and dorito dont properly id hinge or pivot for
  subgrids"): read as a TOP-LEVEL index the master lands on the static junk
  sitting (nested-prefix) slots earlier in the array — SpotLights, junctions,
  dashboards, an RTG — and 69 masters fell out of range as "deleted editor
  references". Flattened, EVERY entry of every corpus craft resolves to a
  joint part carrying live joint state: the dolphin's 5 subgrids ride 3
  SmallPivots (`data.angle` 180/0/125.9° — the doors' mid-swing display) +
  2 SmallHinges; the XYQ twin doors ride a SmallHinge pair at 24.3°; Jimmy's
  gantry (4 nested dashboards) rides SmallPivot[167] at 54.0° — exactly the
  gantry ghost's 54° pitch, the sub-assembly was BUILT on that pivot.
  Masters carry their LIVE state in `data`: `angle` in DEGREES, `pos` in
  metres (LinearTrack slides). All 51 corpus entries land on TOP-LEVEL
  components (nested masters: none observed; the viewer still resolves
  through the flat array, so a nested master would display/animate fine).
  Master→subgrid distance is DISPLAY info only, never a matching heuristic.
- The Build's own `position`/`orientation` = the builder's ghost pose (above).
  Measured values that read like hinge pivots (dolphin doors 0°, 125.9°,
  180°; XYQ pair ±0.635 m; Jimmy's gantry 54.0° X + (0, −10.14, −8.86)) are
  the bench poses at which the sub-assemblies were built — the MID-SWING
  display of the dolphin doors is the SmallPivot masters' `data.angle`, the
  kinematic drive below. Build.occupancies = ONE cell (the ghost/anchor
  cell), NOT a mirror of the nested blocks. Ghost positions are also the
  SYMMETRY-PAIR key for Build twins (XYQ doors ±0.635 ⇒ x-mirror pair).
  v0.170: subgrids have NO gizmo in the viewer (user: "i can select and
  move or rotate a subgrid. that is WRONG") — they move ONLY via their
  masters' joints, so the ghost fields are never viewer-written any more
  (the old v0.168 gate on the REMOVED applySubGizmo writeback is moot).
- **Kinematic masters DRIVE their subgrid (v0.157; axes fixed v0.171).**
  A master whose game `.ini` declares a `[JOINT]` node (SmallHinge,
  SmallPivot, Aileron, LinearTrack, … — manifest `joints[0]`) has its live
  joint state in `data` (`angle` DEGREES / `pos` metres), and the dev
  viewer composes nested content UNDER that joint node — so the subgrid
  display pose is the joint offset composed on top of the base pose:
  **the spin/slide axes ARE the .ini joint keys** (extract_models stores
  `axis`=angular_x/y/z, `slide`=linear_x/y/z per joint record):
  `axis = R(viewQuat(master)) · axleEuler(ZYX) · e(axis)`,
  `slide = R(same) · e(slide)` — SmallHinge/SmallPivot/Propeller spin
  about the axle's local Ŷ, Aileron/Wheels about X̂/Ẑ, Gyroscopes/Drills
  about Ẑ, LinearTrack slides along X̂, Wheel suspension along Ẑ. The old
  uniform x̂ assumption (a) swung the pivot-mounted dolphin doors DOWN &
  OUT like barn doors instead of the game's car doors (user report),
  (b) was only ever verified on x̂ joints (Aileron droop, LinearTrack).
  `pivot = viewPos(master) + R(viewQuat) · axle.position` (RAW local, like
  every other placement law since the v0.180 de-mirror) = the axle pivot;
  the ANCHOR used is `pivot₀` = that point CLAMPED onto the
  bbox of the subgrid's non-255 blocks (buildSubgrids captures the joint
  line `g.userData.jref` = {axis₀, pivot₀, axle₀, slide₀, p₀, q₀} per
  kinematic master, AFTER the content exists). **THE CLAMP IS FRAME-CRITICAL
  (app fix 2026-10-19):** that bbox must be built in the SAME raw view frame
  as `pivot`/`p₀` — the app's port kept the pre-v0.180 z-negation in
  `subBlockBBox` while jointChain/p0 went raw, so the clamp grabbed the
  panel's MIRROR IMAGE: Jimmy's Adventure gantry pivot clamped to z = +15.9
  for a SmallPivot at z = −14.4 whose panel spans z ∈ [−17.9, −15.9] (a
  30 m phantom lever ⇒ spinning the part 35° swept the panel 11 m; the
  joint-ANGLE term spun the panel about a line 31.75 m from the visible
  hinge — user: "subgrid rotation is way off when I move components
  … rotation isnt properly relative … towards the joints themselves").
  Pinned app-side by `app/e2e/subride.spec.ts` (per pair: the line lies ON
  its panel, no phantom lever, and the group transform equals the exact
  rigid transport of the part's motion) and auditable with
  `node app/tools/subride.mjs <craft>` / `jointturn.mjs` (a point ON the
  joint line must not move when the joint turns). A master mounted ON its
  content (XYQ/SMR: 0.1 m) has its axle pivot INSIDE that bbox ⇒ the
  clamp is the pivot itself and the composition is exactly the game's
  axle one; a distant control master (dolphin: hinges 0.25 m off the fin
  PLANE, pivots 7–16 m from the flukes they drive) pivots at the content
  bbox's nearest face/edge (user: "collapsing outward or inward, rotating
  around the bottom. That goes for all of them").
  **v0.174-177 axis rule:** for a PANEL subgrid (non-empty bbox) the
  rotation/slide axis is the content's OWN longest bbox dimension, not
  the axle key — a door always hinges along its long edge: the XYQ doors
  (longest ŷ) are car doors, Jimmy's 7.5 m gantry (longest x̂) folds like
  a car's BACK door over its top edge, the semi-truck's 3 m doors (longest
  ŷ) hinge vertically while its 0.75 m rear flaps (longest x̂) tailgate
  laterally, the dolphin flukes (longest x̂) deflect as elevons. HINGES
  are sharper (v0.175/177, user: "looking at the rotation of the hinge or
  pivot we can determine the precise way that it should rotate"): the
  hinge's own kinematic TRIAD fixes the axis — pin = the barrel axis (the
  .ini key, chain), span d = the content's longest bbox dimension. An
  EDGE-mounted hinge (content runs ALONG its pin, |pin·d|≈1 — XYQ doors,
  truck flaps: their pins equal the longest dim) swings about the PIN. A
  FACE-mounted hinge (content welded laterally in its face plane — both
  dolphin fins: Build[4] a 0.25 m skin-fin with the axle 0.25 m off its
  plane, Build[27] a 2-cell-deep fin with the axle inside its bbox)
  swings about the THIRD axis **pin×span** — the knuckle's swivel axis:
  world ẑ at the clamped bottom edge, the 2.5 m top edge sweeping in x·y
  — "collapsing outward or inward, rotating around the bottom", "staying
  close to the frame ... on its bottom part"; the pin itself (world x̂,
  v0.171/173) sweeps the fin THROUGH the hull ("the door rolls in and
  out") and the ŷ yaw (v0.174/176) opens it "like a door, incorrectly"
  ("one of the doors opens correctly, like a hatch folding down, but the
  other opens like a door" — v0.177). The cross's SIGN is mirror-
  antisymmetric (Build[4] −ẑ, Build[27] +ẑ under the old chain — the pair's
  signs swap together under the v0.180 de-mirror; the ANTI relation and the
  symmetric fold are unchanged), so equal angles deploy the
  pair MIRROR-SYMMETRICALLY — at +90° both fins lie horizontal at the
  belly line, each pointing OUT to its own side (verified: bbox
  x 1.25..3.75 / −3.5..−1). The .ini axle
  key is the PART's pin, not the animation axis of content welded to it.
  PARTS-ONLY subgrids (empty bbox — nested parts riding the axle node,
  dolphin fin subgrid 6, gantry rails) keep the .ini key chain (v0.171).
  **EPISTEMIC STATUS (2026-10-10 audit, user-requested — read before
  "deriving" anything new from these rules):** the axis rules above are
  an EMPIRICAL FIT to user-confirmed in-game motions (5 crafts pinned:
  dolphin, XYQ, truck, gantry/Jimmy, mosaic), NOT format semantics.
  Format facts established by the audit: (a) all 342 corpus
  `composite_builds` entries carry exactly `{component, slaveBuildId}` —
  the join stores NO axis/pivot/offset fields, so content animation is
  100% runtime-derived by the game; (b) the dev viewer's blueprint.js
  never parses `composite_builds` at all (static subgrids) and its
  readBuild order (nested content BEFORE its Build, global list, pipes
  index it) independently confirms the v0.171 flattened-index decode;
  (c) the part `.ini`s' design intent is the PART graph: `[RENDERABLE
  slave]/[COLLIDER slave] parent = axle` — the hinge's slave plate slot
  extends along LOCAL +ẑ up to 0.375 m (the face content is welded to;
  its pin is `angular_y` = local ŷ), the SmallPivot axle sits at
  (0, 0.152, 0) `angular_y ±360` with the slave 0.098 above (turntable),
  LinearTrack slides `linear_x` with the carriage above the rail; (d)
  master types are EXACTLY SmallHinge/SmallPivot/LinearTrack across the
  corpus — the code's `SmallHinge` type test covers the whole hinge
  family. Where the fit is untested (hundreds of entries on ~30 crafts
  the user never inspected), the rules apply as heuristics.
  `p' = pivot₀ + R(axis₀, angle)·(base.p − pivot₀) + slide₀·pos` then
  `q' = R(axis₀, angle) · base.q`.
  **v1.9.0 THE PLATE LAW (part model ≡ panel):** the part's
  OWN `.ini` chain hangs under the content basis C (§Component VERTEX
  SPACE), so spinning its axle node about the RAW key ê makes the plate's
  WORLD line `R(q)·C·ê` — NOT the panel's pinned `R(q)·axleEuler·ê`. For
  x̂ keys C is invariant (the Aileron-flap origin of the rule never bit);
  for SmallHinge `angular_y` the rudder plate ROLLED about the fore–aft
  axis like a propeller while its triangle panel yawed correctly about
  the vertical (measured live: app/tools/plateprobe.mjs). The part plate
  must therefore rotate about the node-local `v = baseQ⁻¹·C⁻¹·baseQ·ê`
  (slide: `d = C⁻¹·baseQ·ê`) — engine/subgrid.ts
  `jointNodeAxis/jointNodeSlide` (THE PLATE LAW pins) feed
  `JointPose.axisV/slideV`. A related silent defect: overwriting
  `real.userData` wholesale clobbers the `jrefs` handle the live joint
  pose needs (v1.9.0 → Object.assign merges).
  **v0.172 rigid riding:** the master's own pose delta then rides the
  whole composed pose: `p'' = p₀ + dq·(p' − p₀) + (p − p₀)`,
  `q'' = dq · q'` with `dq = viewQuat(orient)·viewQuat(orient₀)⁻¹` —
  the game graph is `M·J·R(angle)·L`, so dragging/rotating a hinge, pivot
  or track drags its subgrid along IMMEDIATELY (user: "i move the hinger,
  the subgrid should immediately move in unison with it"), while a master
  at its built pose composes to identity (bit-identical load display).
  Twin subgrids need no separate mirror write — their twin masters move,
  and the delta term rides them (the v0.164/165 twin-subgrid base writes
  in symPropagate/-Rot are REMOVED: they would DOUBLE-move).
  **v0.176 joint-state twins:** a joint-angle/slide edit on a kinematic
  master propagates the SAME delta to its live symmetry twins
  (`symPropagateJoint`, gated by ⇄ + pair alignment, same-type twins
  only), so a symmetric pair animates in unison (user: "for [a]symmetric
  hinges, the subgrids do not move in unison, when really they should
  ... both the hinges are active when modifying the one"). Equal angles
  ARE the symmetric motion: every corpus twin pair is authored with
  equal joint state (XYQ doors 24.3°/24.3°), and each twin swings about
  its OWN captured axis, which already encodes its side's geometry
  (the dolphin fin pair is built asymmetric — a 0.25 m skin-fin with a
  face-mount ẑ roll and a 2-cell deep fin with an in-bbox ŷ yaw — and
  equal angles fold them mirror-symmetrically).
  Lamp/SpotLight masters have NO joints in the manifest (their `angle` is
  the light aim) ⇒ static hosts, unanimated
  (as are junction/battery/RTG-style masters: no manifest joint).
  Pins: dolphin `subjoint-angle` (sign-sensitive; orbit about the captured
  joint line), dolphin `dooraxis` (parts-riding SmallPivot: spin axis must
  be ~vertical = car-door, .ini angular_y), dolphin `doorpivot` (hinge fin:
  joint line clamped to the panel's bottom edge AND axis = the world
  LONGITUDINAL ẑ = the face-mount pin×span swivel roll, AND the twin
  Build[27] rolls on ẑ with the MIRROR-OPPOSITE sign — v0.177), dolphin
  `flukeaxis` (fluke panel subgrid axis =
  x̂, its longest dimension),
  dolphin `subfollow` (translate +30°-spin unison ride, sign-sensitive,
  exact restore), dolphin `subtwin-angle` (a hinge-angle edit rides the
  symmetry twin's subgrid in unison: +90° about each twin's OWN captured
  axis — the antisymmetric signs make that a mirror-symmetric twin deploy,
  data verbatim, exact restore), 3732302108 `subjoint-pos` (LinearTrack slides along its
  CAPTURED axis) + `railaxis` (panel rail slides along its length, not the
  axle key), XYQ `xyq-dooraxis` (edge-mounted hinge doors stay ±ŷ — the
  face-mount swivel branch must NOT fire there).
- So the subgrid info panel (click a subgrid): Contents; Mount = the DECODED
  master(s) with joint state and measured distance — a KINEMATIC master also
  gets editable joint sliders (angle °/slide m) that write the master's
  `data` verbatim and animate the subgrid live. v0.173: the Pivot offset +
  rotation rows are REMOVED (user: "the six sliders under the hinge ...
  none of them are actually logical. Each of them is something that should
  inherently be a part of ... moving the hinge itself. It should not be a
  separate interface") — the Build ghost fields are construction-site data
  the game never displays; every kinematic part already exposes its joint
  state in its OWN inspector (Component data), and the v0.172 rigid riding
  makes moving the hinge itself the manipulation path.
  v0.170: subgrids have NO gizmo and no mode widget (the v0.159-168
  proxy-attached subgrid gizmo is REMOVED — "i can select and move or
  rotate a subgrid. that is WRONG"): the panel's joint sliders are the
  ONLY manipulation path, and they write the master's `data` verbatim,
  so a slider-edited door and a game-opened door save identically.
  `slaveBuildId`-geometry heuristics (v0.153) are OBSOLETE — the decode is
  exact.

### THE PANEL LAW — the byte-proven statute (v1.10.2, 2026-10-24) — NORMATIVE

The v0.174-177 axis rules above are SUPERSEDED as axis law (kept for
history; they remain close wherever the mount is upright or the pin×span
proxy happens to land on the part line). The corpus itself carries the
game's own answer: **wherever a jointed `Build` is left in a rotated
state, `Build.orientation` IS the panel's saved world rotation** — a
whole-corpus sweep (`tools/bench_census.py`, 2026-10-24, 166 baked pairs
over testdata + the local in-game save dir) shows that rotation is
EXACTLY

    axis₀ = R(viewQuat(master)) · C · ê        (C = Rx(−90) content basis,
    angle = data.angle DEGREES                  §Component VERTEX SPACE)

about the axle-pivot line: **157/166 pairs match `qAxisAngle(axis₀,
data.angle)` to 1e-4, 18/18 collinear** with it. The law includes NEITHER
the axle node's authored euler (R·qAxle·ê: 9/18 on rotated mounts) NOR
the old R·ê chain (0/18). Interpretation: the `.ini` joint keys live in
the part's CONTENT basis, and the part's plug face (−ẑ of a SmallHinge)
IS its hinge line — a hinge standing upright hinges about the horizontal
fore–aft line (XYQ-615's identity mount + Rz(∓24.3) benches prove this
directly; the old "car door ±ŷ" reading was a viewer artifact whose
motion looked plausible). C·ê is x̂-invariant, so every historic
Aileron/LinearTrack x-key behaviour is byte-identical under the law.

The 9 non-exact pairs are the GAME'S MIRRORED TWINS: the physics mirrors
one twin's travel at save, so its bench is `qAxisAngle(axis₀, −angle)`
while `data.angle` keeps the shared authored value (XYQ door 2: bench
Rz(+24.3) vs angle +24.3 about axis −ẑ ⇒ the display is −24.3 — the file
itself records the asymmetry the author complains about in his changelog,
"Batch has fixed the mirroring issue"). A handful of benches also carry
authoring drift (87° baked vs 86° stored).

**Build.POSITION is NOT part of the law** — it is the construction-site
ghost translation: pure-rotation benches sit metres away from their
hinge lines (a gantry case: 23 m). Trust only the rotation part.

Viewer consequences (all shipped v1.10.2, `app/src/engine/subgrid.ts`):
`jointChain` axis/slide = R·C·ê (`CONTENT_KEY`); `captureJrefs` derives
`bakedAngle` = the signed bench angle about axis₀ when a rotated bench
exists (the group renders at the GAME's pose at load — including the
mirror-twin flips — and further data.angle edits ride as DELTAS from the
authored value); the bench rotation's fixed line ANCHORS the pivot for
parts-only subgrids when it lies within 1 m of the raw axle line (a
farther line = ghost, raw axle stays); THE PLATE LAW v2: the part's own
axle node follows the same line via node-local `v = baseQ⁻¹·ê`,
slide `d = ê`. Golden pin: `subgrid.test.ts > BENCH CENSUS` replays the
whole committed testdata corpus through these laws every CI run.

Trigger craft: `3326372833` "Chip's Badger" cockpit doors — SmallPivots
mounted Rz(∓90°) whose data.angle 48/306 the old law drewbridged about
x̂ while the game hinges both about the fore–aft ẑ line through the part
(bench-verified; the door pair also documents the palette law below).

**Palette corollary (same session):** `data.colors` entries may be `0`
(a CLEARED custom slot) while triangles/blocks still reference them.
The game renders such faces with the engine's default (light neutral —
user in-game screenshot); our renderer's dev-viewer-inherited magenta
marker made the Badger's door show pink. Repair the FILE (author the
lost slot — `{255,255,255,15,0,0}` matches the engine default and the
in-game look); do not change the global marker (it still catches v1
family-base bugs).

## Editing recipe (used for the seat adjustment)

Tilt forward = rotate about world **X** with a **negative** angle (Unity left-handed:
positive X-rotation tilts +Y toward +Z = toward tail; negative tips the seatback toward
the nose/−z). Quaternion for angle θ about X: `{w: cos θ/2, x: sin θ/2, y: 0, z: 0}`.
Shift toward tail = increase `position.z` (and keep grid in sync: +0.25 m = +1 `pos_z`
in both `occupancies[0]` and the `blocks` type-255 mirror). See `adjust_seat.py`.

## Aerodynamics — the OFFICIAL game model (transcribed 2026-10-19 from wiki.archean.space/en/aerodynamics.html; kept offline per §Local sources of truth)

The game simulates flight-sim-grade lift/drag/stability/buoyancy/re-entry heating
from the build's SHAPE via a **shape field (cross-section model)**:

- On build finish the engine scans the **outer shell** from six axis directions
  into **surface patches**, each storing position, facing, area and — crucially —
  the **solid depth behind it along the flow (cross-section)**. The snapshot is
  CACHED (rebuilt only on edit/damage); cost is BOUNDED and the scan resolution
  scales with the vehicle size. Only the shell is scanned: interior blocks add
  zero drag, and a sealed cavity counts as solid body ("a hollow shape flies
  exactly like its solid version"). Block subdivision/material are invisible:
  same outer shape ⇒ bit-identical forces (material affects mass/buoyancy only).
- **Lift**: a surface lifts when its cross-section is THIN (a wing is thin along
  the flow, broad in span×chord; a fuselage is deep everywhere ⇒ drag only).
  Realistic lift curve, STALL ≈ 15° AoA; two-sided (a wing buried on one face
  lifts weaker); separated stacked surfaces each lift (air gaps are not solid).
  Lift is applied per patch ⇒ real pitch/roll/yaw moments about the CoM.
- **Drag**: form (p·v², forward-facing) + skin friction (Reynolds-based) +
  induced (with lift). **Fineness = streamlining**: slender-along-flow keeps the
  air attached — "a streamlined shape can have a TENTH of the form drag of a
  blunt one at the same frontal size". Slopes/corners/bevels taper ⇒ pay off.
- Compressibility: transonic/supersonic rise on forward faces, wing lift fades
  supersonically (body lift + control deflection carry). Stability is EMERGENT
  (no artificial weathervaning): tail surfaces behind the CoM restore; CoM at or
  slightly ahead of the lift center = stable, aft = divergent. Control surfaces
  (Aileron parts, ±45°) re-evaluate per frame; authority ∝ area·lever·ρv².
  Damage sheds lift + streamlining per surface (asymmetric ⇒ roll + yaw).
- Air and water are ONE density-sampled model (no water path); RCS attenuates
  ∝ e^(−ρ·4) in fluid; propellers/thrusters/ailerons are EXCLUDED from the
  shape field (own models). Frame beams are aerodynamically invisible.
  (Steam patch notes Jun 2024 already carried "increased aerodynamic volume
  threshold … dramatically increases aerodynamic realism" — same lineage.)
- The app's WIND TUNNEL (`app/src/engine/aero.ts`) implements this shape field
  for VISUALISATION: collider-voxel runs → blockageOf(run) fineness + wake
  deficit, porous-mask potential-flow multigrid solve, deviation-coloured
  streamlines, and the thin-cross-section wing classification readout. The
  legacy viewer's "aero plates" thin-plate wind model was BOGUS (per the user,
  2026-10-19) and was NOT ported; the frozen viewer keeps it only as history.
- **THE FLIGHT LAB (`app/src/engine/flightlab.ts`, v1.16.11) — the forces on
  the SAME field.** THE WING CENSION IS GEOMETRIC and per-thickness-axis:
  "a wing is thin top-to-bottom but broad in span and chord, so it lifts;
  a fuselage is deep in every direction, so it only drags" ⇒ a horizontal
  wing is THIN ALONG Y, so the planform census scans along the THICKNESS
  axis (vertical scan for wings, side scan for fins), keeps runs ≤ 2 voxels
  whose CONNECTED COMPONENT spans ≥ 3 voxels on BOTH planform axes (the
  "broad planform" filter that rejects a fuselage corner), with single-cell
  air seams merged (the sealed-cavity rule) and one-face-buried sections at
  0.6 strength (two-sided lift). Forces: Diederich finite-wing slope
  Clα = 2πAR/(AR+2); the lift curve peaks at STALL ≈ 15° then sheds to a
  flat-plate residual; form drag = the tunnel's fineness-weighted frontal
  area on S, skin friction turbulent-flat-plate Cf(Re), induced Cl²/πeAR.
  STABILITY IS EMERGENT: the pitch static margin is the mass model's CG
  against the neutral point (wing AC + tail with 2.19/√(AR+1) downwash),
  expressed as % MAC (> ~5% stable, 0..5% neutral, < 0 divergent); a yaw
  margin from the fin census. Control AUTHORITY = q·A·(2 sin45 cos45)·lever
  per Aileron part (the game EXCLUDES Ailerons from the shape field, so
  only deflection×area×lever counts) — a plate BURIED in the collider mass
  with a short lever reads ≈ inert, which is the game-side "hidden ailerons
  don't do anything anymore". Stylised closed-form on the shape census —
  the "not CFD" label keeps (AGENTS §Known sharp edges).
