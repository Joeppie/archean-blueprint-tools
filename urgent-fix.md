# URGENT FIX — transform/shift DROPPED faces (holes in a valid balloon)

**Status: FIXED in v1.8.6 (2026-10-23).** Kept as the post-mortem — the bug class
(frame-alignment, not sizing) is subtle and the second defect found here was
invisible from the original report.

## Symptom (user report, with screenshot)

Generate-balloon, **cyl + nose, rx 12 / ry 8 / rz 12 m, fins on**: the ghost
showed a large rectangular hole in the body side ("two equi-sized but too
large" — the mirror pair). The user's crucial observation: **"a valid zeppelin
suddenly misses a face after rotations … depending on where it is rotated,
possibly moved … the size doesn't inherently change"** — a position/frame-level
drop, not a sizing problem. That framing was right and is what pointed at the
real cause.

## Root cause 1 — the transforms dropped instead of cutting (the holes)

The game's 31-slot triangle window is **FRAME-ALIGNED**: with
f = floor(min/12), every v = g − 12f must be in 0..31. A face whose per-axis
span S exceeds 20 encodes ONLY when min sits low enough inside its 12-cell
frame (slack = 31 − S − (min − 12f)); the loft legitimately produces such
faces (**32 faces with span > 20** in the spec above, all valid where staged).

`transformSkinTris()` (app/src/engine/latsphere.ts) is the shared engine of
BOTH ghost transforms (`Engine.clusterGhostRotate` ⟲X/⟲Y/⟲Z, and
`shiftSkinTris` for the drag/commit). It re-encoded through that window law
and **dropped any face whose image no longer fit** — a quarter-turn keeps the
SPAN but re-places `min` within its frame, so fat faces fell out at unlucky
positions and the hole was **persisted into the built file** by commit.

**Fix:** the ruling that shipped `splitFace` — "segment whatever is breaking".
A transformed image that fails to encode is now subdivided (midpoint 1→4,
mirror-symmetric exact-integer ties, depth-capped) and every piece is re-spelled
in the SOURCE record's clothes (`reencodeSkinTri` keeps the full colours[5]/
material/smooth — a splitter-side-effect so a hullify-style prism's five slots
stay verbatim). Faces that already encode stay byte-identical, so no existing
pin or save moved. `balloonfin.mirror()`'s `encodeSkinTri(...)!` non-null
assertion (the same class: the x-mirror re-places `min` too) became
encode-else-split `flatMap`.

## Root cause 2 — the TAIL COMMIT sliced by staged counts (found while pinning)

Measured with the 12×8×12 spec through the live UI: after the fix the GHOST
kept everything (942 faces staged → 960 after ⟲Y) but ✔ Build wrote only 942 —
and not the right 942. `commitBalloon` mapped the whole ghost through the
transforms ONCE, then **sliced it by the staged group sizes** (`bc.skinCount`,
`plan.fillets.X.length`, …). Splitting ADDS records, so every boundary after
the first split drifted: fin pieces leaked into the main skin, panels could
land in the wrong Build, and the tail of the list fell off the end.

**Fix:** each GROUP now travels through the recovered ghost map
(`ghostMap(plan.probes, payload.rides[0], offset)`) on its own — `paintGroup`
re-colours the plan's own group and `transformSkinTris` carries it, so a split
stays GROUP-LOCAL and the panels still nest into their own Build. The
count-slicing `take()` cursor is gone; the skin-only branch (no tail) keeps its
single `shiftSkinTris`.

## Regression pins (all fail on the pre-fix tree — verified)

- `app/src/engine/__tests__/splitface.test.ts` ▸ "transformSkinTris NEVER DROPS":
  non-vacuous fat-face premise, every whole-cell shift and every quarter-turn
  keeps `length >= base.length`, every output piece passes `encodeSkinTri`, the
  summed signed AREA vector stays inside 1 % + 64 cells² (a split moves it by
  ~6 cells², a DROPPED fat face moves it by hundreds), thin crafts stay
  vertex-exact, split pieces re-wear colours[5]/material/smooth, shift
  round-trips.
- `app/src/engine/__tests__/balloonfin.test.ts` ▸ the big-zeppelin tail batch is
  COMPLETE: no undefined/null entry, every record inside its own 32-slot window.
- `app/e2e/sphereskin.spec.ts` ▸ "rotate + drag a big balloon": ghosts the user's
  12×8×12 cyl+nose WITH fins, ⟲Y + a 5-cell drag, ✔ Build, and asserts the
  FILE's total skin area (top-level triangles PLUS every nested Build list)
  equals the ghost's within 1 %. Verified discriminating: restoring the old
  count-slicing commit fails it (the file came up 3859 cells² short).

## Standing rule

Any helper that maps stored skin records through a POSITION change must treat
the frame-aligned window as something to CUT, never to filter: encode-else-
`splitFace`, and never slice a transformed list by pre-transform counts.
