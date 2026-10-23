# Generate balloon — the algorithm and its limits
Tags: sphere ellipsoid spheroid skin hull triangles algorithm convex hull lattice limitations dents bulge sag quickhull zeppelin blimp aspect ratio window tau cylinder rocket nose tail paint finish metallic matte polished glass rotate quarter-turn facets balloon balloon fins rudder aileron pivot hinge coupler junction volume wire LV tail post cap

**Tools ▸ Generate balloon…** grows an ellipsoid out of hull triangles — a closed
convex SKIN whose vertices are integer lattice points (the same 0.25 m grid
the blocks and the game's own hull triangles share). Slider to 48 m radii
(96 m across); the number boxes take any size beyond. The **cyl + nose**
body (the shipped default, v1.9.0) gains a **tail section** (v1.9) —
rudder + aileron fins on hinge subgrids, a coupler and one enclosed
Volume block, all described below.

## Two bodies (v1.7.2, ends independent since v1.7.3)

| Body | Shape | When |
|---|---|---|
| **ellipsoid hull** | the convex hull of every lattice point hugging the ideal ellipsoid — maximum roundness | spheres and gentle blends |
| **cyl + nose** *(the shipped default, v1.9.0)* | FLAT CYLINDER SIDES along the longest axis + tapered, POINTIER ends (`nose %` and `tail %` sliders set how much of EACH half tapers — the nose is the − end of the longest axis, the aircraft's −z nose; `facets` picks 48/12/8 sides around the section) | zeppelins — and the body the TAIL section builds on; also stores sizes where the pure hull hits the game's triangle-window limit and must refuse |

The two ends taper INDEPENDENTLY (v1.7.3): the defaults (nose 65 %, tail
40 %, both sliders 10…90) give a rocket/airship profile — a long pointy
nose, a blunt tail. Aim the nose with the ghost's ⟲ quarter-turns.

The simple body is built as a LOFT: integer cross-section rings at ≤ 20-cell
axial slices (shoulder rings kept), a single lattice APEX at each tip, and
merge-walked triangle strips whose every edge is subdivided to ≤ 9 cells —
closed manifold, no dents (the profile is concave), and the 31-cell window
holds BY CONSTRUCTION, so long needles store too. The live preview prints
the deviation: a coarse `blocky` body is simpler but the sag it prints
grows — the trade is honest.

## Tail section (v1.9 — cyl + nose bodies)

With **tail fins ▸ rudder+2 ailerons**, the balloon grows a classical
airship tail ON THE UNTOUCHED CONE — the tail's triangle pattern keeps
flowing (an early build added a straight fin POST; it broke the tail's
line and was retired: the fins now ride the natural cone).

- **ONE straight top line** rules the whole tail (sketch #3: the moving
  part must CONTINUE the beginning, and the line "should be straight" —
  no curvature): it starts at the SHOULDERS where the cone begins to
  yield and rises aft at a slope that IS the fin size, through a hinge
  line just before the apex and CONTINUING over the hung fin to its
  trailing edge. A modest fin keeps the line nearly horizontal — flush
  with the top of the ship; a big one steepens the taper.
- **A fixed fillet** fills between the hull and that line (root clinging
  tight to the cone — the orange of the sketch), shoulder to hinge.
  **The MOVABLE rudder/ailerons hang to a horizontal keel line** like
  stern-post rudders (the green shape) hanging BEHIND the tail: under
  the hull the panel's upper edge FOLLOWS THE HULL CONTOUR onto the tail
  end (its hinge side is contour-following, not square, and it never
  cuts into the ship), and aft of the hinge the vane spans keel-to-line
  to a vertical trailing edge. The side fins' hung panels keep a clear
  gap to the cone — their inner edge is a flat, slightly stepped plane,
  so nothing strikes the tail's radius. The TOP rudder yaws about the
  vertical pivot; the MIRRORED port/starboard pair rolls about the
  longitudinal axis. Panels are hull TRIANGLES, never parts; the pair is
  one plate reflected in the mirror plane, triangle for triangle.
- `fin size %` sets the line's slope (half the girth above the shoulder
  at the hinge line for the normal setting); `oversize` multiplies past
  it — clamped to what the game's triangle window stores, the preview
  refuses before a silently-holed fin.
- **Panels rotate on SmallHinges.** Each hung panel rides a SmallHinge
  (±90°) part joined as a SUBGRID (`composite_builds` → the hinge's
  joint, nested `triangles` in parent-absolute coordinates — the same
  door/hatch mechanics the editor itself builds). In the pilot, turning
  the hinge turns its panel. A free-turning ±360° SmallPivot was offered
  early on and REMOVED (v1.9.0 — a control surface that spins full circle
  steers nothing; the hinge's limited travel IS the control law). Since
  v1.9.0 the hinge's own visible plate turns about the SAME world line as
  its panel (the rudder yaws about the vertical, the ailerons roll about
  the longitudinal — it used to roll the plate like a propeller). This
  triangle-panel-in-a-subgrid combo is what the game's READER carries
  (the dev reader recurses nested `triangles`); the corpus has no
  authored precedent, so the final in-game look of the rotating panels is
  YOUR arbitration — report it if it reads wrong.
- **LV wiring, hidden.** A LowVoltageJunction (the low-power COUPLER) sits
  at the envelope centre; every pivot gets one LV cable that leads off its
  socket, dives into the body IMMEDIATELY behind the plug, then runs the
  body's long axis INSIDE the envelope to a coupler port — visible only if
  you open the hull.
- **ONE Volume block, on/off.** `volume block` is a yes/no toggle
  (v1.9.0): ON places exactly ONE Volume straight UP out of the coupler
  (facing up, 1 kg displacement) where a 1-cell skin margin is guaranteed
  — OFF places none. (The old 0…16 count stack made no sense: one block
  is what the game's airtight volume mechanic wants.)
- **Everything rides the ghost.** ⟲ quarter-turns and the cell drag carry
  the fillets, panels, pivots, coupler, volumes AND cables with the skin
  (a probe tetrahedron round-trips the exact turn matrix), and ✔ Build is
  ONE undo step for the whole batch. Tail bodies need a tail zone of at
  least 3 m — the preview says so instead of failing.

## The algorithm (ellipsoid hull): a lattice convex-hull shrinkwrap

1. **Shell** — every lattice point whose radial excess over the ideal
   ellipsoid lies in [0, τ] (default 0.75 cells): a thin skin of points just
   OUTSIDE the surface. The test depends only on position-squared, so the
   point set is EXACTLY mirror-symmetric.
2. **Convex hull** — an incremental beneath-beyond hull (the Quickhull
   family: Barber–Dobkin–Huhdanpaa 1996; CGAL's convex_hull_3 is the same
   class) with conflict lists. Every predicate runs on INTEGER coordinates,
   decided exactly in doubles — zero epsilon heuristics.
3. **Optimality certificate** — Qhull's postcondition loop: each face plane
   is support-tested against the full shell; any point beyond a face joins
   the candidates and the hull rebuilds until nothing is missed. The result
   is provably EXACTLY hull(shell).
4. The hull faces ARE the skin, emitted as game Triangle records (outward
   winding, flat shading by default = the game's own authoring convention).

**Why it cannot dent:** a convex polyhedron is convex from EVERY viewing
direction — a concavity nowhere exists to see. Earlier attempts quantized
the surface with per-vertex heuristics; independent per-vertex errors read
as dents. Here smoothness is a THEOREM, not a hope.

## Deviation you can read before building

The dialog's live preview prints it: `dev −0.00/+0.18 m` — the worst face
sag INTO the ideal surface (measured EXACTLY 0 at every size) and the worst
vertex bulge OUT (≤ τ·0.25 m ≤ 0.19 m), plus triangles, skin mass, enclosed
volume and sea-level lift per gas (vacuum / helium / hydrogen).

## Limits — what the game can store

| Limit | Value | What it means for you |
|---|---|---|
| lattice | 0.25 m cells, integers | radii snap to 0.25 m steps; placement moves in whole cells |
| triangle window | 32 slots, FRAME-ALIGNED | every face must fit one 31-cell aligned window (v = g − 12·floor(min/12)); faces that outgrow it are **subdivided by splitFace** (midpoint 1→4, mirror-symmetric) instead of refused — smooth spheroids at any size. The same cut applies when you ⟲-turn or drag the ghost: a big face can fit its window where it was planned and not after the move, so the transform re-cuts it — a balloon never loses a panel to a rotation |
| convexity | strict | no dents, hollows or tori — a skin is a convex blob |
| smallest radius | ≥ 0.25 m | below a cell there is no lattice to hull |
| shading | flat │ smooth:1 | flat = the game's authored default; smooth:1 asks the game to weld normals |

The storable size/shape limit of the ellipsoid hull is **not a clean ratio**
(measured: an 8:1 needle of length 12 m stores, a 2:1 ellipsoid 20 m long at
r=10 does not, while a 32×32×48 one does). The **cyl + nose** body sidesteps
it entirely (the flank is sliced, so no face spans more than two slices —
pointy blends that the hull refuses become the SIMPLEST skins on the craft).
Since v1.9 window-blown faces SPLIT instead of refusing, so the ellipsoid
path really always stores. The one honest refusal left is a shape below a
lattice cell (no hull to build) — **⚖ Fix the shape** one-tap lifts it to
the smallest storable sphere; for near-limit blends it still PROBES the
worker for the nearest fully-storable blend (first shortening the long
axis — a zeppelin keeps its girth — then thickening the short ones).

## Workflow

OK previews a **movable ghost** on the block widget (cell-snapped). Its
label carries the whole placement kit (v1.7.2):

- **⟲x ⟲y ⟲z** — turn the ghost a QUARTER turn about that world axis. The
  lattice only stores exact 90° rotations of integer vertices, so the snap
  is the FORMAT law, not a taste; ✔ Build writes exactly what is ghosted.
- **↩ edit** — back to the dialog with every parameter kept (and the spot
  you dragged to). Retune, OK again, done — nothing starts from scratch.
- **✕ Cancel** (or Esc while the ghost is up) drops it — but Esc while the
  ↩-reopened dialog is up closes the DIALOG only.
- **✔ Build** writes the triangles into the craft (your chosen material +
  ONE palette slot for all five faces of every triangle). The **paint is a
  single control** (v1.7.3): the RGB swatch/hex, the **finish** — `matte`,
  `polished`, `metal` or `glass`, exactly the shading the game's palette
  families carry — and where it lands: **+ new palette slot** writes a new
  slot WITH that finish, **≈ nearest** snaps to the closest existing slot
  that WEARS it (falling back to the nearest colour when none does).
  Ctrl+Z removes the whole skin as ONE undo step.
