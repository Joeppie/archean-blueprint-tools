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
| finish-family bases | polished 80, metal 120, glass 160 (matte 40 shared) | polished 84, metal 128, glass 172 → `legacySlot()` +4/+8/+12 |
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
palette key now drives ONLY colour resolution (`legacySlot()`), never
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
  re-anchoring (floorDiv to the frame) is required.
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
  (`xc_files`), Beacon holds frequency + last transmitted payload, PilotSeat holds
  `{emitPlayerToken, smoothControls}`, HudController holds HUD `.xc` source.

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
• **A pipe needs ≥ 2 segments IN THE FILE** — the dev reader warns
  (`blueprint.js`: "the game expects at least two"), and the balloon-tail
  generator honours it at write time (`balloonfin.pipeSegments` keeps only
  true axis-aligned hops, so a broken route is DROPPED, never patched into
  a diagonal). The Generate-balloon LV runs (v1.9) additionally honour the
  user rule "the wire must, right after the pivot plug, run INTO the body":
  lead off the stub axis → one cell deeper through the skin → a long run
  along the body axis INSIDE the envelope (hidden), all waypoints asserted
  inside-envelope by the vitest pins (`balloonfin.test.ts`).
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
