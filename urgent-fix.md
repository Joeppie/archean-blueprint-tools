# URGENT FIX — transform/shift DROPS faces (holes in a valid balloon)

**Status: UNFIXED — documented deliberately at the end of a full session
(user 2026-10-23: "document this error in urgent-fix.md, and lets fix it
with a fresh prompt; this one is pretty full and it does offer novel
functionality we shall stabilize"). Fix this FIRST, before new features.**

## Symptom (user report, with screenshot)

Generate-balloon, **cyl + nose, rx 12 / ry 8 / rz 12 m, fins on**: the
ghost shows a large rectangular hole in the body side ("two equi-sized
but too large" — the mirror pair). The user's crucial observation:
**"a valid zeppelin suddenly misses a face after rotations … depending on
where it is rotated, possibly moved … the size doesn't inherently
change"** — i.e. a position/frame-level drop, not a sizing problem.

## Root cause (confirmed by deterministic repro, see below)

The game's 31-slot triangle window is **FRAME-ALIGNED**: with
f = floor(min/12), every v = g − 12f must be in 0..31. A face whose
per-axis span S exceeds 20 encodes ONLY when min sits low enough inside
its 12-cell frame (slack = 31 − S − (min − 12f)); the loft legitimately
produces such faces (the probe counted **32 faces with span > 20** in the
exact spec above, all valid at their staged position).

`transformSkinTris()` (app/src/engine/latsphere.ts) is the shared engine
of BOTH ghost transforms:

- `Engine.clusterGhostRotate` (the ⟲X/⟲Y/⟲Z quarter-turns) maps every
  vertex through the turn about the (rounded) bbox pivot;
- `shiftSkinTris()` — used by the balloon/sphere **commit** for the Build
  widget's cell offset — maps through the whole-cell shift.

Both re-encode via the same window law and **DROP any face whose image
no longer fits** ("a triangle whose image no longer fits the 5-bit window
drops out" — the function's own docstring). Rotation/shift preserve the
SPAN but move `min` within its frame → fat faces fall out at unlucky
positions. That is the hole; it is then **persisted into the built file**
by commit (and into every undo snapshot), not just a ghost artifact.

## Repro (add as vitest scratch, or as the regression pins)

```ts
const base = sphereSkinTris(
  { rx: 12, ry: 8, rz: 12, profile: 'cylinder', noseShoulder: 0.35, tailShoulder: 0.6 }, opt);
transformSkinTris(base, g => [g[0], g[1], g[2] + 5]).length   // < base.length — ONE-CELL SHIFT drops faces
// 8x12x12 loses faces under rotY/rotZ about pivots 7/11 and x-shifts 2/5;
// 12x12x12 under rotX about pivots 7/11 and z-shifts 1/5/6.  (Measured this session.)
```

## Related hazard (same class, fix together)

`app/src/engine/balloonfin.ts` `mirror()` ends with
`return encodeSkinTri([...], SKIN0)!` — a **non-null assertion**. The
mirror x → 2·cSide − x also moves `min` within its frame, so a fat fin
face that encodes on one side can return `null` on the other → `undefined`
is pushed into the triangle list (render hole / JSON null). Any future
position-mapping helper must likewise never trust the encode.

## The fix (matches the ruling that shipped splitFace)

User law, already implemented for generation: **"segment whatever is
breaking"** — never refuse, never drop. So:

1. In `transformSkinTris`, when the transformed image fails to encode, do
   NOT drop it — run **`splitFace(imageTri, optAsSkinOptions)`** (already
   in latsphere.ts: 1→4 midpoint subdivision, mirror-symmetric exact
   integer ties, depth-capped) and emit all pieces. Note the current
   function preserves the record's extra fields (colors/material/smooth)
   by copying — feed splitFace a SkinOptions built from the record
   (slot = colors[0], material, smooth) so pieces carry the same paint,
   or post-paint the pieces to the record's exact colours[5] array
   (prisms use all five slots; keep them verbatim).
2. `balloonfin.mirror()`: replace `encodeSkinTri(...)!` with
   `splitFace(...)` (or encode-else-split); it must never push undefined.
3. Keep every face that already encodes **byte-identical** (splitFace's
   own rule) so all existing pins/saves stay stable.

## Regression pins to write with the fix

- For every (spec, transform) pair in the Repro section above:
  `transformSkinTris(base, fn).length >= base.length` (splitting may ADD
  faces, must never lose coverage) **and** total 2D area of the output
  equals the input within a small tolerance **and** every output face
  passes `encodeSkinTri`.
- A round-trip e2e: ghost a 12×8×12 cyl+nose balloon, ⟲Y once, ✔ Build,
  and assert the built `data.triangles` area ≈ the ghost's area (and vice
  versa for a 5-cell drag) — the hole was a FILE-level loss, pin the file.
- `balloonfin.mirror()`: construct a spec whose R face encodes and assert
  the L twin is complete (no undefined/null in the arrays —
  `expect(list.every(Boolean)).toBe(true)`).

## Where everything stands

Everything else shipped and green at session end: 471 vitest, tsc -b
clean, balloon/tools/help e2e green (desktop + Pixel 7), main pushed at
`c51434d`. The tail shape law, splitFace, and the tail batch are all
pinned — this is the one known correctness bug, and it bites exactly on
the big zeppelins the feature is for.
