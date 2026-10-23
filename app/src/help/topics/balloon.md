# Generate balloon — the algorithm and its limits
Tags: sphere ellipsoid spheroid skin hull triangles algorithm convex hull lattice limitations dents bulge sag quickhull zeppelin blimp aspect ratio window tau cylinder rocket nose tail paint finish metallic matte polished glass rotate quarter-turn facets balloon balloon fins rudder aileron pivot hinge coupler junction volume wire LV tail post cap

**Tools ▸ Generate balloon…** grows an ellipsoid out of hull triangles — a closed
convex SKIN whose vertices are integer lattice points (the same 0.25 m grid
the blocks and the game's own hull triangles share). Slider to 48 m radii
(96 m across); the number boxes take any size beyond. The **cyl + nose**
body gains a **tail section** (v1.9) — rudder + aileron fins, pivots, a
coupler and a volume stack, all described below.

## Two bodies (v1.7.2, ends independent since v1.7.3)

| Body | Shape | When |
|---|---|---|
| **ellipsoid hull** | the convex hull of every lattice point hugging the ideal ellipsoid — maximum roundness | spheres and gentle blends |
| **cyl + nose** | FLAT CYLINDER SIDES along the longest axis + tapered, POINTIER ends (`nose %` and `tail %` sliders set how much of EACH half tapers — the nose is the − end of the longest axis, the aircraft's −z nose; `facets` picks 48/12/8 sides around the section) | pointy blends and zeppelins: FEWER triangles, and it stores sizes where the pure hull hits the game's triangle-window limit and must refuse |

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

With **tail fins ▸ rudder + 2 ailerons**, the balloon grows a classical
blimp tail. The tail cone is TRUNCATED at 80 % of its taper and closed by a
straight-sided **fin post** + shrinking cap: the post re-uses the cone's own
cut ring vertex-for-vertex, so the surface stays one CONTIGUOUS area — flush
with the end of the tail section, exactly where the fins can sit.

- **Fins are SWEPT triangle panels, never parts** (shape from the user's
  sketch): the root starts about HALFWAY through the tail-cone taper and
  runs to the post end, clinging to the hull; the height/span grows
  LINEARLY outward so the panel is a right triangle — vertical trailing
  edge at the post, a long sloping leading edge coming down towards where
  the cone starts yielding, exactly like a classical airship fin. The
  pivots sit on the root chord near the aft end, so the MOVABLE vane
  sweeps out of the cone region past the tail. A TOP rudder (yaws about
  the vertical) and a MIRRORED port/starboard aileron pair (roll about the
  longitudinal axis) — the pair is one plate reflected in the mirror plane,
  triangle for triangle. `fin size %` sets the NORMAL proportion (45 % of
  the girth at the trailing edge); `oversize` multiplies past it (clamped
  to what the game's triangle window stores — the preview refuses before a
  silently-holed fin).
- **Panels rotate on pivots.** Each panel rides a SmallHinge (±90°, the
  default) or SmallPivot (±360°) part joined as a SUBGRID (`composite_builds`
  → the pivot's joint, the subgrid's nested triangles in parent-absolute
  coordinates — the same door/hatch mechanics the editor itself builds). In
  the pilot, turning the pivot turns its panel. This triangle-panel-in-a-
  subgrid combo is what the game's READER carries (the dev reader recurses
  nested `triangles`); the corpus has no authored precedent, so the final
  in-game look of the rotating panels is YOUR arbitration — report it if it
  reads wrong.
- **LV wiring, hidden.** A LowVoltageJunction (the low-power COUPLER) sits
  at the envelope centre; every pivot gets one LV cable that leads off its
  socket, dives through the skin IMMEDIATELY behind the plug, then runs the
  body's long axis INSIDE the envelope to a coupler port — visible only if
  you open the hull.
- **Volume blocks enclosed.** `volume blocks` stacks Volume parts straight
  UP out of the coupler (facing up, 1 cell pitch); the count CLAMPS so the
  top keeps a skin margin — the stack is guaranteed enclosed.
- **Everything rides the ghost.** ⟲ quarter-turns and the cell drag carry
  the panels, pivots, coupler, volumes AND cables with the skin (a probe
  tetrahedron round-trips the exact turn matrix), and ✔ Build is ONE undo
  step for the whole batch. Tail bodies need a tail zone of at least 3 m —
  the preview says so instead of failing.

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
| triangle window | 32 slots, FRAME-ALIGNED | every face must fit one 31-cell aligned window (v = g − 12·floor(min/12)); long flat flanks can fail **for the ellipsoid hull** — the simple LOFT body holds the window by construction |
| convexity | strict | no dents, hollows or tori — a skin is a convex blob |
| smallest radius | ≥ 0.25 m | below a cell there is no lattice to hull |
| shading | flat │ smooth:1 | flat = the game's authored default; smooth:1 asks the game to weld normals |

The storable size/shape limit of the ellipsoid hull is **not a clean ratio**
(measured: an 8:1 needle of length 12 m stores, a 2:1 ellipsoid 20 m long at
r=10 does not, while a 32×32×48 one does). The **cyl + nose** body sidesteps
it entirely (the flank is sliced, so no face spans more than two slices —
pointy blends that the hull refuses become the SIMPLEST skins on the craft).
If even a blend refuses, the dialog says so and **⚖ Fix the shape** PROBES
the worker for the nearest fully-storable blend (first shortening the long
axis — a zeppelin keeps its girth — then thickening the short ones). A
sphere always stores.

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
