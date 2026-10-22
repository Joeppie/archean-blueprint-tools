# Why the Spheroid generator FAILED — archived attempt

**Scrapped from `main` on 2026-10-22** by reverting its three commits
(`ff57b9f` v1.6.0, `360c945` v1.6.1, `a35194a` v1.6.2). This branch,
`failed/spheroid-hull-dents-lattice-quantization`, keeps the whole approach
+ its 279 unit + 10 e2e tests green, for the record and for picking parts
back. Nothing here was ever released (no tag, Pages never moved).

## Why the branch is named this
Every iteration produced **visible indentations in the hull**, and the root
cause is the same in blocks and in the triangle skin: **quantizing a curved
hull onto the 0.25 m block lattice with per-position heuristics leaves
uneven facets / gouges — dents**. No local placement rule and no
nearest/outward vertex snap fixes that; only a proper error-diffusing
lattice-quantization algorithm can, and none was ever implemented here.

## The three iterations (each shipped green, each rejected by eye)
1. **v1.6.0** — per-cell corner-mask matcher against the block-shape table
   (inv-corner/slope/corner/pyramid chosen by mask IoU + volume + gradient).
   → cells were decided *independently*: wedges beside flat caps, seams
   everywhere. User: "jagged … many indentations".
2. **v1.6.1** — coherent voxel staircase; chamfers derived from the 6-face
   air pattern; NEW watertight hull-triangle SKIN (the "just triangles"
   idea) at zeppelin scale (24 m axes). Chamfers still **cut into solid
   cells** — a corner tetra keeps 1/6 of a cell, a wedge run meeting a
   plateau, a cove carved into a wall: any cut not ending flush **is** a
   dent. User: "all spheres have edges with indentations where I can see a
   triangle is missing".
3. **v1.6.2** — purely **additive** bevels: cube staircase never cut;
   slope/pyramid/inv-corner placed into AIR cells seated on their full
   faces (flush seats — pinned); skin vertices snapped **outward-biased**
   so no vertex is inside; facet budget scaled to craft size.
   → still dents: outward snapping prevents *inside* vertices, not the
   creases — independently-snapped neighbours differ by up to ~2 lattice
   cells and their facets read exactly as indentations. User: "All spheres
   have indents … Find algo online! … Triangles instead of blocks." Scrapped
   on instruction.

## Root causes (the honest list)
- **Block hulls cannot be smooth at this lattice scale.** Curvature radii
  of 4–16 cells vs unit steps: any bevel that removes material risks a
  gouge; additive bevels can only bump. There is no local rule that
  guarantees a visually round hull.
- **Triangle-skin vertices are integers** (FORMAT §Hull triangles: world =
  (g−6)·CELL, integer slots). Nearest- or outward-snap of a UV-sphere is
  not a quantization scheme: errors are independent per vertex, so facet
  orientations wobble — that wobble IS the visible dent/crease. The needed
  algorithm class (Bresenham/midpoint error-diffused circle & ellipse
  rasterization, monotone-staircase radii, convex-hull-of-lattice-points
  shrinkwrap, or marching cubes at sub-lattice resolution welded back) was
  identified only at the end and **never implemented or tested**.
- **The pins verified the wrong properties.** Sealed / disjoint / watertight
  / outward / mirror-symmetric / pixel-count pins all passed for versions
  the user immediately rejected. "No visible indentations" was never
  encoded, so green meant nothing.

## Before anyone rebuilds this
1. **Study existing algorithms** (the user's explicit instruction — they
   exist: midpoint-ellipse / Bresenham with error carry, lattice convex
   hulls, marching cubes + decimation) — do not invent local heuristics.
2. **Pin indentation first, UI last**: sample the generated hull silhouette
   against the ideal ellipse/ellipsoid — no excursion inside −ε, bounded
   facet-angle discontinuity between adjacent triangles; only then build.
3. **Judge in the real editor, not our own viewer** — and where handedness
   or look matters, in-game pixels remain the only sanctioned arbiter
   (AGENTS). The user's acceptance bar was always "smooth hull, dents
   damage volume and aerodynamics" — that exact sentence is the spec.

## What is in the archived range (69df372..a35194a)
- `app/src/engine/spheroid.ts` — three full generator rewrites.
- `app/src/engine/blockshapes.ts` — `getTypeRotation` export (harmless,
  reverted too; re-add if ever needed).
- `app/src/engine/blocks.ts` — `shiftBlocks` (placement-drag utility).
- `app/src/engine/scene.ts` — cluster placement ghost (blocks AND triangle
  skins), widget ownership, `clusterGhostState/Shift/ScreenPoint`.
- `app/src/components/ToolsDialog.tsx` — the PLACEMENT-tool framework
  (`ToolDef.place{stage,commit}`), `range`/`toggle`/`color` field kinds,
  the Spheroid ToolDef, `shiftTriangles`.
- `app/src/components/Viewport.tsx` — the place-label (✕ Cancel / ✔ Build).
- `app/src/Editor.tsx` — placement staging + commit wiring.
- `app/e2e/spheroid.spec.ts`, `app/src/engine/__tests__/spheroid.test.ts`,
  `testdata/9000007001`, `app/tools/makespheroid.mjs`,
  `app/tools/spheroid-shot.mjs`, `app/tools/shot.mjs`.

The placement-tool framework (dialog → movable ghost → Cancel/Build) was
actually well received and is fully tested here — if a corrected generator
ever lands, the plumbing can be ported back from this branch unchanged.
