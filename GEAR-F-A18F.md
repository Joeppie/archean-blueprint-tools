# F/A-18F (3521588534) landing gear — measurements & the RIG CHAIN law (v1.11.8)

Blueprint: `testdata/3521588534/blueprint.json` (235 top-level comps, 489 flattened,
292 pipes, 25 top-level Builds). Coordinates are FILE coords: x lateral (+ =
starboard), y UP, z longitudinal (nose = −z).

## The report (2026-10-26)

We pointed at the right main gear in the app: "there are missing cables, or not
rendered and a hinge that seems to be in an incorrect position … see if it
happens in xenondev viewer too." (The `x 1.80 y -0.70 z 17.35` chip in the
screenshot is the coord readout following the cursor — incidental, per we.)

## What the file actually stores

The gear legs are **nested Build assemblies with baked transforms** (raw
`position` + RAW `orientation` quaternion), mirrored L/R, e.g. the R leg:

```
TOP 185  pos ( 7.98, 0, 1.5)   ∓27° ŷ      wing/gear-bay panel (JOINED: master SmallHinge a=27)
  189    pos (0,0,0)           identity    (assembly pass-through)
   191   pos (−14.16, 0, 9.93)  59.4° ŷ    retraction hinge  (invariant line x −1.61 z 17.40)
    192  pos (0, −18.25, 16.5)  90° x̂      knee              (invariant line y 0.375 z 17.375)
     195 pos ( 1.02, 0.59, 0)   29.7° ẑ    steering
      196 Wheel fp (1.79, −2.0, 17.31)     ← the leg in the file is BUILT-POSE (deployed)
```

The nested steering pivots (fp ±1.625, 0.375, 17.375; data.angle 59.4/300.6)
and the nested MiniRouters sit **on the rigs' invariant lines** — the chain
leaves them exactly in place (vitest-pinned); the leg/wheel swing up into the
bay. This is why the game (and dev) show the gear RETRACTED: the saved pose of
the assembly is its display pose.

Cables: 292 runs all resolve both sockets (sockets.ts census). The gear
harnesses (hv pipes 0/276 to the nested SmallPivot; lv pipes 7/269 to the
nested MiniRouter, depth 2–3) end on nested parts. In dev, pipe segments are
transformed by their build's matrix (scene.js:785); ours draws top-level
segments as recorded (v1.8.1) and re-anchors nested ends via the v1.11.5
harness attach, which now rides the same chain.

## The law (dev blueprint.js readBuild — reference implementation)

```js
const local = compose(position, quaternion, 1);      // raw
const world = parentWorld · local;                   // per Build nesting
readBuild(data, null, new THREE.Matrix4(), 0, null); // TOP build = identity
// scene.js: blocks/triangles/struts/frames/PIPES/components all get
//           model.builds[b.build].matrix
```

Top-level Build content is parent-absolute (identity matrix at top = v0.168
standing); **content nested inside a Build is local to that Build's frame**
and composes through the chain of raw affines. v1.11.6 rendered nested
assemblies at identity (content at file coords) — invisible on identity-bench
crafts (XYQ doors, dolphin fins, Badger: all nested benches are
(0,0,0)+identity), wrong on rig crafts (the F/A-18's gear legs hang deployed,
the steering pivots strand mid-bay, the nested harness sockets bury in the
hull = "missing cables").

The app implements this as `rigChainOfPath/rigPush/rigApply` (subgrid.ts,
THE RIG CHAIN) + rig groups in `buildSubgrids` + the chain∘group attach in
`buildPipesMesh` (v1.11.5 harness attach generalized to the nesting chain).

## Audit — app live scene vs dev live scene (tools/gearpair.mjs, tol 0.2 m)

Pairing by flattened (dev readBuild) index; world AABB centres of the
streamed REAL models (same GLTF both viewers), file frame.

**F/A-18F: 100 nested parts, every one paired ≤ 0.177 m** — gear wheels at
0.000 (dev (±2.31,−0.94,18.70) = ours), harness bridges/routers/pivots at
0.000–0.02, wing dashboards/ailerons/docking ports at 0.000–0.07; the
residuals ≥ 0.12 are the SmallHinge conditional-part and PLATE-LAW-animated
box conventions (poses identical, box geometry/plate animation differ).
Before the fix the gear sat AT THE FILE POSE (deployed): 1.8–2.5 m from dev.

**The 13 rig crafts of the corpus** (3294879498, 3298465282, 3308603448,
3309955432, 3332487383, 3351518711, 3417786605, 3445304576, 3481737379,
3509975859, 3510792645, 3816936540 + 3521588534): **zero geometry
mismatches at tol 0.2** (pre-fix 12-craft baseline: 172 mismatches on
3445304576 alone). The 104 identity-bench crafts are byte-identical (the
composed chain is the identity transform). Two non-geometry audit rows:
- 3481737379 `LinearTrack` Δ12.76 = the app shows the catapult carriage at
  its SAVED `data.pos` (the v1.10.2 joint-state law, in-game validated)
  inside the box union; dev renders the static construction pose. The app
  is closer to the game there.
- 3509975859 (giant) renders its stand-ins merged (heavy tier, PERF.md):
  the per-part audit is blind; the v1.11.6 nested-wheel census pins cover
  it (green).

**The nose-gear rotation (we: "the front-wheel of the F18 seems to be
rotated wrong")** was a SEPARATE pre-existing bug, exposed by the audit:
`displayQuat`'s caster arm→down roll (v0.134 droop special case, validated
for SmallWheel casters) fired on the F/A-18's big `Wheel` nose-gear pair
(w=±0.707, y=∓0.707 — ±90°ŷ steering mounts): the gate passed and the roll
yawed each wheel 90° about the longitudinal axis (box: app thin-ŷ blade vs
dev thin-x̂ transverse tyre). The roll is now SmallWheel-only
(`compparts.ts`, pinned in `compparts.test.ts`: 'Wheel'/'BigWheel' return
the plain view quaternion, SmallWheel keeps the roll about the axle); the
nose wheels pair with dev at 0.001 m and `wheels.spec.ts` (8 caster pins)
is green.

## Deliberately NOT changed (the v1.10.2 law stands)

The TOP-level group display pose stays the v1.10.2 joint pose (master `.ini`
axle, captureJrefs-clamped pivot, baked-angle delta rule) — in-game-validated
on XYQ/dolphin/gantry. Dev's raw top affine agrees with it wherever the
builder authored the panel rotation about the master's hinge line (bench
census 157/166 exact rotation-part collinearity) and differs (by
2·sin(θ/2)·dist, ≤ ~1.5 m) where the master is a control hinge and the affine
turns about a fold beam (this craft's bay/wing assemblies). If in-game pixels
say the fold-beam affine is the game's law at top level too, that is a
v1.10.2 revisit — a separate, corpus-wide arbitration.
