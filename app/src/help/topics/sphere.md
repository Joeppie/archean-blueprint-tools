# Sphere skin — the algorithm and its limits
Tags: sphere ellipsoid spheroid skin hull triangles algorithm convex hull lattice limitations dents bulge sag quickhull zeppelin blimp aspect ratio window tau cylinder rocket nose rotate quarter-turn facets

**Tools ▸ Sphere skin…** grows an ellipsoid out of hull triangles — a closed
convex SKIN whose vertices are integer lattice points (the same 0.25 m grid
the blocks and the game's own hull triangles share). Slider to 48 m radii
(96 m across); the number boxes take any size beyond.

## Two bodies (v1.7.2)

| Body | Shape | When |
|---|---|---|
| **ellipsoid hull** | the convex hull of every lattice point hugging the ideal ellipsoid — maximum roundness | spheres and gentle blends |
| **cyl + nose** | FLAT CYLINDER SIDES along the longest axis + tapered, POINTIER noses (the `nose %` slider sets how much of each half tapers; `facets` picks 48/12/8 sides around the section) | pointy blends and zeppelins: FEWER triangles, and it stores sizes where the pure hull hits the game's triangle-window limit and must refuse |

The simple body is built as a LOFT: integer cross-section rings at ≤ 20-cell
axial slices (shoulder rings kept), a single lattice APEX at each tip, and
merge-walked triangle strips whose every edge is subdivided to ≤ 9 cells —
closed manifold, no dents (the profile is concave), and the 31-cell window
holds BY CONSTRUCTION, so long needles store too. The live preview prints
the deviation: a coarse `blocky` body is simpler but the sag it prints
grows — the trade is honest.

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
  one palette slot for all five faces of every triangle; pick **+ new
  slot** or **≈ nearest**). Ctrl+Z removes the whole skin as ONE undo step.
