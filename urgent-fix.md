# URGENT FIX — DONE (v1.9.0 batch): tail rudder, tool-desk fixes

**Status: FIXED and pinned (this file documents the fixes; the v1.8.6
face-drop post-mortem stays at the bottom as the post-mortem of that bug
class).**

Naming/style note (permanent): we write "we / us / our", never "the user"
(the shared `~/.config/opencode/AGENTS.md` rule). Historical `user:` quotes
in older bullets stay as written.

---

## 1 · THE TAIL RUDDER SWUNG SIDEWAYS LIKE A PROPELLER — FIXED

**What we saw:** after Generate balloon ▸ fins, the rudder's visible plate
turned sideways about the fore–aft axis — the way a propeller spins — while
the big triangle panel yawed about the vertical. The part and its panel
disagreed about which line the hinge turns on.

**Measured first (the arbitration, as demanded).** Three live-scene probes
(now kept as audit tools): `app/tools/rudderprobe.mjs` (subgrid group
quaternion axis + panel bbox under a data.angle turn), `app/tools/plateprobe.mjs`
(the hinge PART's real-model world box under the same turn — it re-resolves
the root on every read because liveDataEdit rebuilds it in place) and
`app/tools/jointturn.mjs` (joint-line fixedness). Result at rx 2 / ry 2 /
rz 8, no ghost turns:

| item | captured axis / measured motion | verdict |
|---|---|---|
| rudder PANEL subgrid | group quaternion axis (0,1,0); pin fixed; vertical span constant; lateral span grows | yaw — CORRECT |
| aileron PANEL subgrids | axis (0,0,1); twins the same axis | roll — CORRECT |
| rudder part PLATE | bbox tilts sideways: tip travels ~0.2 m lateral at +35°, rotates about (±1,0,0) | ROLL about fore–aft — THE BUG |

So the panel law (jointChain: world axis `R(q)·qAxle·ê`, the in-game-pinned
law for every corpus hinge) was right; the part's OWN model was wrong.

**Root cause.** `applyJointPoses` (scene.ts) spun the part's `.ini` axle
node about the RAW axis-key vector ê while the node chain hangs under the
engine CONTENT BASIS C = Rx(−90) (FORMAT §Component VERTEX SPACE). The
plate's WORLD line was therefore `R(q)·C·ê` — for ê = ŷ that is the
fore–aft axis: a propeller. For ê = x̂ the content basis is INVARIANT
(C·x̂ = x̂), which is exactly why the law was introduced on the X-axis
Aileron flap and never bit until a y/z-axis joint (SmallHinge = `angular_y`)
got a visible subgrid panel. A latent second defect hid next to it:
`real.userData = {…}` REPLACED the userData that buildReal had filled with
`jrefs`, so `applyLiveJointPose` (the dataEdited path) was a silent no-op
on every real model.

**The fix — THE PLATE LAW.** Pure helpers `jointNodeAxis` / `jointNodeSlide`
(engine/subgrid.ts) conjugate the content basis out of the node-local axis:
rotation `v = baseQ⁻¹·C⁻¹·baseQ·ê`, slide `d = C⁻¹·baseQ·ê`, so the plate's
world line is EXACTLY the panel's captured line. scene.ts builds the
`JointPose.axisV/slideV` vectors through them, `applyJointPoses` turns about
those, and all four `real.userData` write sites became `Object.assign`
merges so the `jrefs` handle survives (applyLiveJointPose is live again).
x-key joints (Aileron, LinearTrack) are byte-identical by construction.

**Pins.** vitest `subgrid.test.ts` "THE PLATE LAW" (26 pins: for four axle
eulers × three keys the C-image of the node axis equals the panel-law line
to 1e-9; x̂ invariance; the rudder end-to-end case axis == world up). e2e
`sphereskin.spec.ts` TAIL test now sweeps each built hinge +30° and asserts
the SWEEP DIRECTION from WORLD COORDINATES (the standing lesson: data-only
assertions cannot pin a rotation direction): rudder group axis ∝ ŷ, panel
vertical extent constant while the lateral extent grows, the PART PLATE's
vertical extent survives (>0.9) and its centre stays on the hinge line
(|Δx| < 0.03 — a prop roll circles it ~0.06 m and shears the extent toward
cos); aileron twins keep (0,0,±1). Verified discriminating: pre-fix the
plate assertions fail, the panel ones already passed.

## 2 · VOLUME: exactly ONE block — a yes/no toggle — DONE

`volumes` is a two-option select (`off` / `on`, default ON, exactly like
`fins`) and `BalloonOptions.volumes` a boolean: ON places ONE Volume at
`centre +0.187 m` on the coupler roof where a 1-cell margin under the skin
is guaranteed (`volFit >= 1`), OFF places none — the honest "does not fit"
path. `counts.volumes` ∈ {0,1}; the "(clamped from N — envelope)" preview
note is gone. Re-pinned: `balloonfin.test.ts` (ONE on / none off + the
enclosed guarantee; a new pin asserts EVERY pivot is a SmallHinge),
`tooldoc.test.ts` (one Volume in the saved file), e2e tail test
(`tool-opt-volumes-on/off`, the choice-specific line, `volumes: 1` in the
built craft).

## 3 · THE PREVIEW LINE — short and choice-specific — DONE

`tailNote` is one compact clause that mirrors the controls:
`· tail: +F+P fin tri · rudder + 2 ailerons on SmallHinges (±90°) · LV×3
hidden · volume 1 enclosed` (or `volume off`). `spherePreviewLine` gained
the `N×N×N m` body size and the paint SLOT mode (`+ new slot` / `≈ nearest`)
and kept every token the pins read (`N triangles`, `dev −x/+y m`,
`cylinder + N% nose / M% tail`, `smooth:1`/`flat`, `<finish> paint`,
`lift@SL … He … H₂`, the honest `nothing to place` refusals). The e2e polls
`rudder` / `volume 1 enclosed` / `volume off` (the toggle flips the line —
proven in the tail test).

## 4 · CYLINDER (zeppelin) IS THE DEFAULT BODY — DONE

`initial.profile = 'cylinder'`: the tool opens on the zeppelin shape and
the tail section is visible immediately (the tail test now asserts
fin-fields-VISIBLE on open and the round ▸ hidden ▸ cylinder ▸ visible
cycle). Deliberate re-pins, not accidents: the ellipsoid-era suites
(`needles/refuse/repair`, `BOTH bodies store`, the skin/lift/mass build
test, the ↩ test) now click `tool-opt-profile-round` EXPLICITLY — the
`stage()` helper does it for them — so their round-body numbers keep
meaning what they meant.

## 5 · NO ±360° PIVOT FOR THE TAIL — DONE (the same-day request)

"Remove the option for a 360 rotation for the rudder/tail that doesn't
make sense": the `pivot part` select (SmallHinge ±90° vs SmallPivot
±360° free) is GONE from the tool; `BalloonOptions.pivotType` is deleted;
the planner authors SmallHinges ONLY (vitest-pinned above). A control
surface with unbounded travel steers nothing — the hinge's ±90° IS the
control law. The help topic tells the story; e2e asserts
`tool-field-pivot` has count 0.

## 6 · LANGUAGE: we / us, never "the user" — standing

Recorded in the shared AGENTS.md; new prose here and in the code follows it
(older quotes stay as written).

---

## ADDENDUM (v1.9.1) · "the hinge for the rudder is wrongly pointed … it
shouldn't be positioned as though it was a pivot" — FIXED

What we saw: at the tail, the two aileron SmallHinges read as hinges lying
along their panels, but the rudder's stood at the cone apex like a
turntable — a pivot silhouette.

Measured before touching anything (screenshots + world bboxes + the game
files): the SmallHinge's displayed slave hub extends ALONG its joint line
(gltf slave bbox y −0.09..0.375 with the mass concentrated at the knuckle;
baked chain ẑ → under the content basis C the part's FILE ŷ — the same
direction jointChain rotates the panel about). The game's own XYQ-615 door
hinges prove the same pose in authored data: hub UP along the vertical car
door line, barrel horizontal. So a yawing rudder MUST show its hub up —
that half is law, not taste. What was wrong was the TWIST about the hub:
the old frame {ax: u×t, ay: u, az: t} is a cyclic 120° permutation of the
aileron mount — it laid the master slab FLAT (thin axis up) and stuck the
barrel boss fore–aft: lying on its back, the turntable look.

Fix: the rudder mount is now the aileron mount turned ONE −90° about the
lateral axis — frame {ax: −tHat, ay: uHat, az: sHat}. The slab stands
upright in the fin plane, the barrel points sideways, the hub stays on the
vertical joint line: literally "just one angle 90 degrees rotated compared
to those for fins". Panel kinematics are untouched (axis0 = R(q)·ŷ = up in
both), so every v1.9.0 kinematic pin still holds.

Pins: `balloonfin.test.ts` 'the rudder hinge is the FIN hinge turned ONE
90°' (barrel/arm axes + the exact quarter relation q_rud ≡ Rx(−90)·q_ail;
5 dp because component quats carry the writer's 6-decimal literals) and
the reframed e2e tail pin — the plate discriminator is now FRAME-FREE: a
spin about a vertical line keeps the model's vertical extent and centroid
height EXACT (≤5 %/≤0.01 m), while any horizontal-axis roll shears both.
`tooldoc.test.ts` re-pinned: the authored rudder quat is Ry(+90), so
after a ghost ⟲y the stored orientation is a pure 180° about y.

Recorded in the shared AGENTS.md; new prose here and in the code follows it
(older quotes stay as written).

---

# DONE · v1.8.6 — the skin transform CUTS, never drops (post-mortem, shipped in `b13e6a5`)

Kept as the post-mortem — the bug class (frame-alignment, not sizing) is subtle
and the second defect found there was invisible from the original report.

**Symptom:** Generate-balloon, cyl + nose, rx 12 / ry 8 / rz 12 m, fins on: the
ghost showed a large rectangular hole in the body side, and "a valid zeppelin
suddenly misses a face after rotations … depending on where it is rotated,
possibly moved … the size doesn't inherently change" — a frame-level drop, not
a sizing problem.

**Root cause 1 — the transforms dropped instead of cutting.** The game's
31-slot triangle window is FRAME-ALIGNED: with `f = floor(min/12)`, every
`v = g − 12f` must be in 0..31, so a face whose per-axis span exceeds 20
encodes ONLY while `min` sits low enough inside its 12-cell frame (the spec
above has 32 such faces, all valid where staged). `transformSkinTris()`
(the engine of BOTH `Engine.clusterGhostRotate` and the commit's `shiftSkinTris`)
re-encoded through that law and DROPPED any face whose image no longer fit; a
quarter-turn keeps the SPAN but re-places `min`, so fat faces fell out and the
hole was persisted into the built file. Fix: the ruling that shipped
`splitFace` — "segment whatever is breaking" — encode-else-split with a RECORD
PAINTER (`reencodeSkinTri`) so pieces re-wear the source's colours[5]/material/
smooth verbatim; already-valid faces stay byte-identical. `balloonfin.mirror()`'s
`encodeSkinTri(...)!` (the x-mirror moves `min` too, so it could push
`undefined`) became encode-else-split `flatMap`.

**Root cause 2 — the TAIL COMMIT sliced by staged counts** (found while pinning):
after fix 1 the ghost kept everything (942 staged → 960 after ⟲Y) but ✔ Build
wrote 942 — and not the right 942. `commitBalloon` transformed the whole ghost
list once, then sliced it by the STAGED group sizes; splitting ADDS records, so
every boundary after the first split drifted: fin pieces into the main skin,
panels into the wrong Build, the tail off the end. Fix: each GROUP travels
through the recovered `ghostMap(plan.probes, payload.rides[0], offset)` on its
own (`paintGroup`), so a split stays GROUP-LOCAL; the `take()` cursor and the
`balloon.skinCount` count contract are deleted so they cannot come back.

**Pins (all verified discriminating — reverting each fix fails them):**
`splitface.test.ts` "transformSkinTris NEVER DROPS" (non-vacuous fat-face
premise, every shift/quarter-turn keeps `length >= base`, every piece passes
`encodeSkinTri`, the summed signed AREA vector within 1 % + 64 cells² — a split
moves it ~6, a dropped fat face hundreds — thin crafts vertex-exact, pieces
re-wear the record's paint, shift round-trips), `balloonfin.test.ts` (the big
tail batch is COMPLETE: no undefined, every record inside its own window),
e2e `sphereskin.spec.ts` "rotate + drag a big balloon" (⟲Y + a 5-cell drag ⇒ the
FILE's area, top-level PLUS nested Build triangles, equals the ghost's).

**Standing rule:** any helper that maps stored skin records through a POSITION
change treats the frame-aligned window as something to CUT, never to filter —
and never slices a transformed list by pre-transform counts.
