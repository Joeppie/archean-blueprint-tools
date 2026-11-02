# IMPORT-3D.md — external 3D models → Archean geometry (research)

Researched 2026-11-02. **STATUS: tier ONE LANDED v1.17.3** —
`engine/import.ts` (the quantiser, 20 vitest pins) + `components/
ImportDialog.tsx` (the § 7 preview) + File ▸ / palette entry; the § 8
python tier (heavy FBX/.blend pre-bake, α-wrap scan repair, corpus
fixtures) stays BACKLOG.

Goal: take an EXISTING 3D asset — a ship glTF, a statue
scan, an STL, an AI-generated mesh — and emit a VALID `blueprint.json` of
blocks and/or hull skin triangles, so it flies as an Archean craft. All the
format constraints below are quoted from FORMAT.md — not re-derived.
Nothing here is landed code: this file is the library/technique survey and the
adapted pipeline; the implementation entry is in AGENTS.md ▸ Backlog.

## 0. The target constraints (why "just import it" is not a thing)

- The lattice is the product: 1 cell = 0.25 m, skin vertices satisfy
  `world_ax = (v_ax + 12·frame_ax)·0.25 − 1.5` EXACTLY; every triangle fits one
  FRAME-ALIGNED 32-slot vertex window (`encodeSkinTri` IS the law); cross-frame
  weld pairs sit Δv = 12. Blocks: `pos_*` ∈ 0..12, sanity size ≤ 24,
  `occupancies` ↔ type-255 mirror on save.
- Colour = palette slots only (256, LINEAR rgb), material = gameplay identity.
- Every hull triangle renders as a closed 0.05 m prism (five colours).
- Consequence: an importer is a **lattice quantizer**. Everything before the
  quantizer is normalisation; everything after it is validation. Smooth-source
  beauty is traded for lattice-exact fidelity — the blocky aesthetic is the
  contract, the staircase is managed, never removed.

## 1. Load + normalise (mature, pip-installable)

| lib | loads | note |
|---|---|---|
| **trimesh** (MIT, python) | glTF/GLB, OBJ, STL, PLY, OFF, **.vox** | our anchor: scene→mesh, `mesh.simplify_...` hooks, booleans via manifold3d, `.contains()` winding/ray tests, transform maths |
| **pyassimp / assimp** (ISC) | FBX, COLLADA, 3DS | fills trimesh's FBX gap |
| **Blender `bpy` headless** (GPL) | every format | pre-bake: scale, join, decimate, retopo; run as a subprocess tool, GPL-clean |
| **Open3D** (MIT) | glTF/PLY/etc | repair/decimate/cluster-simplify + Chamfer + Poisson; big wheel, all one import |

Interactive prepping (human-in-the-loop, exports feed the pipeline): Blender,
**Blockbench** (block-first editor, glTF/voxel formats), MagicaVoxel/Qubicle
(.vox → trimesh reads it).

Normalise: bbox → fit N×M×K cells (we pick the voxel-size scale, never rescale
the lattice); up-axis → Archean axes (−z nose, FORMAT §Coordinate system);
centre on a lattice corner.

## 2. Repair (every found asset needs this — the 3D-printing toolkit transfers 1:1)

Found assets are self-intersecting, open, non-manifold, stacked shells (a ship
= hull + deck + masts as separate shells).

- **Manifold3d** (MIT, `pip manifold3d`; trimesh's default boolean engine):
  a self-UNION merges all shells and removes self-intersections with
  **guaranteed manifold output** (ε-valid theory documented in its wiki; the
  GPU BVH booleans are ~ms–s on million-triangle meshes). THE workhorse —
  one call turns a soup into a solid.
- **CGAL Alpha_wrap_3** (CGAL is GPL — fine for our GPL tooling): watertight
  α-wrapping of noisy scans/soups; α ≈ 2–4 cells closes scan gaps and deletes
  internal cavities. The scan path's repair.
- **Screened Poisson** (Open3D `create_triangle_mesh_screened_poisson`;
  Kazhdan's SDK is BSD) for point clouds → watertight mesh.
- pymeshfix / MeshFix: skips — bundles TetGen (NON-COMMERCIAL license).
  Manifold3d covers its cases.
- Sanity: `mesh.volume > 0`, `is_watertight`, winding-number point tests
  (trimesh `.contains` / `dvx` below) as the gate before quantising.

## 3. Decimate (mesh → lattice-appropriate budget)

The lattice sets the budget: sub-cell features collapse at quantise time, so
the useful target is ≈ surface area / cell² (hundreds–thousands of tris, not
100 k). All pip, all fast:

- **fast-simplification** (pyvista org, MIT): QEM edge collapse, boundary
  preservation, collapse-replay (LOD ladders);
- **pyfqmr** (MIT): equivalent quadric reduction, Cython;
- Open3D `simplify_quadric_decimation` / `simplify_sphinx` equivalents.

Crease care: a dihedral-angle pre-pass protects hard edges (ship plates) so
QEM doesn't round them before quantisation has a chance to snap them.

## 4. Path A — blocks (voxels)

1. **Voxelize** (pick by input quality):
   - **SDF flood** — classify each cell centre inside/outside by winding number
     (`trimesh.contains` vectorised over the grid; ray-cast on BVH). Robust to
     open/soup meshes; same law family as our `sealedEnvelopeVolume` flood.
     THE default.
   - **dvx** (`dvx-python`, BSD-3, SIGGRAPH 2026): smoothed winding-number
     voxel grids — purpose-built for open/self-overlapping meshes, no watertight
     requirement. The modern robust pick.
   - **CVVA-style contour voxelization** (Vishner, topology-preserving exact
     voxelisation of watertight soups — preserves THIN sheets): the right tool
     for sails/flag/blade shells; code availability is poor (paper-era), so
     "implement only if thin-feature loss bites".
   - trimesh `.voxelized()` / Open3D VoxelGrid — surface-sampling, weak solid
     fill (known complaints); fine as prefilters.
   - **OpenVDB** `mesh_to_volume` (MPL) only for 10 M-tri monsters.
2. **Box-merge** voxels → block records: classic **greedy meshing**
   (per-plane maximal rectangles → per-axis maximal boxes), capped at size ≤ 24
   and the 0..12 position rule; emit `data.blocks` boxes + mirror the
   component `occupancies` (AGENTS save law).
3. **Shell mode default**: solidify only voxels touching the boundary
   (voxel ∩ dilate(boundary)) — interior fill multiplies mass + build cost by
   the game's model for zero visual gain.
4. **Bevel pass (phase 2)**: fit surface patches against our OWN shape table
   (`viewer/blockshapes.js`: slopes 1–12, corners 13–20, pyramids 21–44,
   inverse corners 45–52): for each boundary voxel, accept the slope/corner
   that lowers Chamfer distance. Prior art that proves this exact trick:
   **ObjToSchematic** (MIT — OBJ→Minecraft WITH stair/slab shape matching; the
   closest open-source ancestor of this whole file), **BrickFormer** (2026,
   3D→LEGO part-dictionary fitting), the voxel→brick stochastic-fitting
   literature.
5. Palette: k-means over the source material colours → nearest built-in slot
   in LINEAR space; face-wise `colors[7]` per block.

Prior art at 1-cell scale (proof of UX): ObjToSchematic, Bloxelizer,
BlockBlender, eisenwave/obj2voxel (exact C++ OBJ/STL voxelizer, texture-aware).
MagicaVoxel as authoring tool. Minecraft's whole import ecosystem is this exact
pipeline with a 1 m lattice.

## 5. Path B — hull skin triangles (the ship/statue path)

A lattice-exact closed triangle sheet. The known recipe, quantise-and-union to
a fixed point:

1. watertight + decimated mesh (§2–3).
2. **Lattice quantise**: snap every vertex to the cell lattice, weld by lattice
   key, drop degenerate faces. (Open3D `simplify_vertex_clustering` is the same
   shape of operator — voxel clusters + collapse — but averages cluster
   centroids OFF-lattice; lattice-anchor the grid and snap the centroids.)
3. **Union-fixpoint loop**: quantisation makes self-intersections → Manifold3d
   self-union (output is manifold but OFF-lattice again) → re-snap → re-union;
   iterate until the triangle count stops moving (2–3 rounds; the ε-valid
   theory says it converges for ε ≪ cell).
4. **Keep the outer shell**: split connected components, keep shells with
   volume over a threshold (enclosed cavities = air, not geometry).
5. **Frame-split + encode**: clip the sheet at frame (12-cell) planes; per
   triangle apply the window law. The TS twin `encodeSkinTri`/`splitFace`
   (latsphere.ts) is implemented and pinned — the python writer mirrors it,
   cross-pinned like `mass.ts` ⇄ `game_data.py`.
6. Winding → outward (closed manifold ⇒ `repair.fix_winding`-trivial); per-tri
   material → palette slot (dominant material / texture-pixel average at the
   triangle centroid).
7. **Validate** (all existing harnesses): regtest format suite; the
   lattice-shell manifold pin (every lattice edge in exactly 2 skin records);
   `straysOf == 0` containment; **matrix_sheet/matrix_iou** silhouette vs a
   render of the SOURCE mesh (our harness, built for exactly this); Chamfer
   distance (Open3D `compute_chamfer_distance` on samples).

What we ALREADY have for this path: `encodeSkinTri`/`splitFace` (window law +
midpoint rescuts), latsphere Quickhull (convex lattice hulls, ratio≥12 refusal
— the convex special case), `hullify` (block faces → skin),
`stitchHullSkin` (display welds). The MISSING general piece is exactly steps
2–4 (quantise-union-fixpoint for non-convex shells). Thin parts (rigging,
blades) ride as back-to-back double-sided triangle pairs — legal, pin one.

## 6. Where the "existing models" come from

- **Ready meshes**: Sketchfab (CC filters; glTF/OBJ downloads), free STL ship/
  airframe collections, other games' assets (personal use — publishing derived
  craft on Pages is a rights question → NOTICE). Steam Workshop ALREADY has
  Archean craft: `tools/add_workshop.py` ingests them (no conversion needed).
- **Statues/scans**: photogrammetry — COLMAP (BSD), Meshroom (MPL), mobile
  Scaniverse/Polycam/Luma (mesh + splat exports); iOS LiDAR depth → PLY. Then
  Poisson + α-wrap (§2) → Path B.
- **AI image→3D** (concept ships from one drawing): **TRELLIS / TRELLIS.2**
  (Microsoft, MIT, textured mesh from a single image), **Hunyuan3D 2.x**
  (Tencent — check the community license per release), **InstantMesh**
  (Apache-2), Stable Fast 3D (Stability community license), TripoSG (NC —
  personal only). All export glTF; expect dense, non-watertight,
  over-textured output → §2 repair exists for this.
- **CAD** (hard-surface ships): STEP → mesh via gmsh/OCC python, then Path B.

## 7. THE PREVIEW LAW — import never runs blind (we, 2026-11-02)

> "If we do any importing I want there to be a preview window, and it should
> feature a 3d grid system so we can see how it would intersect with where
> triangles can be placed, so we could tweak scale/size or whatever other
> options would make sense algorithmically. Supporting normal/common 3d
> formats would be nice, like things that you can download either blender
> or from 3dmodels sites."

The law:
- The importer is a PREVIEW DIALOG riding the existing render rig
  (Viewport.tsx, the grid.ts zoom-adaptive world-lattice ladder, ±axis marks,
  on-demand invalidation). The GRID IS the product: the 0.25 m cell lattice
  plus 3 m frame borders drawn as boxes — the frame box IS the 32-slot
  triangle-window legal zone (FORMAT §Triangles), so "where triangles can be
  placed" is literally rendered. A face that outgrows its window marks RED
  (splitFace will recut it — shown, never hidden).
- Layers, each toggleable: ① source mesh as a translucent ghost (the
  unquantised intent), ② the lattice output as REAL blocks/skins rendered as
  the game renders them (prism law), ③ grid + frame boxes, ④ legality
  overlays (window overflow, degenerate faces, non-manifold edges).
- EVERY knob requantises LIVE on the worker (debounced `previewAsync`, OK
  DISABLED while planning — the ToolDialog law): scale (source metres →
  cells, snapped so extents land on integer cells), up-axis/rotation map
  (−z nose), representation (blocks | skin | block-core + skin-shell),
  decimation budget, shell vs solid, bevel pass (blockshapes table) on/off,
  lattice offset (align an extent to a frame border), palette mode (k-means |
  one slot), mirror axis.
- Live stats card: blocks + cells, skin tris, mass (mass.ts), build cost
  (economy.ts), envelope lift, watertight/manifold edge counts, silhouette
  IoU vs the source (the matrix_iou law).
- THE PREVIEW-WRITER IDENTITY LAW: the preview quantizer IS the writer's
  quantizer (one engine module — the hullify preview/apply pair law). A GPU
  preview voxelizer is GHOST-DECORATION ONLY; the lattice layer always shows
  what the writer will write. Import = commit the previewed state through
  the doc funnels.

Format tiers (the "normal/common 3d formats" of the law):
- **Browser drag-drop**: GLB/glTF, OBJ (+MTL colour pairs), STL, PLY, 3DS —
  the three.js loaders (GLTFLoader/OBJLoader/MTLLoader/STLLoader/PLYLoader/
  TDSLoader). This covers the download-site
  corpus (Sketchfab/Fab/CGTrader are GLB-first) and every Blender export.
- **FBX**: a python-tier hop (assimp → GLB). Browser FBX parsers are
  SDK-derived and license-fragile; pre-baking is the clean door.
- **.blend**: never parsed. "Export GLB" in Blender is one menu hop; batch
  via `bpy` headless (python tier).
- **.gsm** (asked 2026-11-02): the 3D-domain .gsm is a **Graphisoft ArchiCAD
  library part** — a parametric object in GDL SOURCE code (the geometry is
  computed by ArchiCAD's interpreter; no public parser, not a mesh). The
  honest door: Archicad ▸ File ▸ Libraries and Objects ▸ Export 3D
  Geometry… ▸ OBJ, then drop the OBJ. (The other .gsm: GSM 06.10 audio —
  not a 3D format at all.)
- Textures: baseColor factors + vertex colours quantise directly (k-means →
  slots, LINEAR); baked images sample per-face at the triangle centroid.
  The MTL Kd colour rides into the preview for OBJ+MTL pairs; image maps
  are deliberately unread by the palette quantiser.

The TS tier must run the loop at UI speed (tens–hundreds of ms per
requantise): **manifold-3d** (npm, MIT — the wasm twin of the python kernel)
for the self-union, **meshoptimizer** `simplify()` (MIT, the JS QEM twin of
fast-simplification), custom snap+weld+degenerate-cull mirroring the pinned
latsphere window law, SDF flood on typed arrays as the writer's voxelizer
(deterministic, pinned); @pixiv/three-voxelizer (MIT, GPU) only for the
ghost layer.

## 8. Proposed implementation (when scheduled)

TIER ONE (the product — § 7): `engine/import.ts` (loader-neutral in →
decimate → snap+weld → manifold-3d wasm union fixpoint → frame-split +
`encodeSkinTri` twin | SDF flood + greedy box-merge + shape-table bevels →
palette quantiser) + `ImportDialog.tsx` (the preview dialog, § 7). Pins:
vitest quantiser laws (window legality, file-space manifold pin, degenerate
cull, shell mode, palette, python-twin parity); e2e `import.spec` @slow
(drag a real GLB → live counts + IoU + zero red overlays — `// e2e-tier
because:` drag-drop, real loaders, canvas).

TIER TWO (heavy + corpus): `tools/import_model.py` (python, like
`game_data.py`):
trimesh/pyassimp load → Manifold3d self-union (α-wrap fallback for scans) →
fast-simplification to the lattice budget → fit to N cells + axis snap →
mode `blocks` (SDF flood / dvx → greedy box merge → shape-table bevels phase 2)
| mode `skin` (quantise-union fixpoint → frame split → encodeSkinTri twin) →
palette k-means → emit `blueprint.json` (byte-identical writer laws + the
occupancies mirror) → validate: regtest + lattice-shell manifold pin +
`matrix_iou` vs source.
Pins: `tools/make_import_test.py` → fixture 900000NNNN from a tiny licence-
clean STL (teapot/bunny); `engine/import.ts` ⇄ the python reference
cross-pinned like `mass.ts` ⇄ `game_data.py`.

Licensing of the stack: trimesh/manifold3d (pip+npm)/fast-simplification/
pyfqmr/Open3D/dvx/assimp/meshoptimizer/three are MIT/BSD/Apache; OpenVDB MPL;
CGAL GPL (compatible with us). The ONE poison pill to keep out: TetGen-derived
tools (pymeshfix) — non-commercial.

## 9. Risks / open questions

- **Staircase**: 0.25 m steps are the aesthetic for ships; for statues they
  are the product's limit. Mitigations only: slope/corner shapes (Path A),
  dense skins (Path B). No smooth shading exists in the format.
- **File size + prism render**: every skin tri is a record + a rendered prism;
  a 5 k-tri statue = 5 k records. Measure with `tools/perfprobe.py` before
  raising any budget.
- **Mass/cost blowup**: the game's server model charges per cell and per
  skin area — shell-mode default + the ⌖ Info readout is the honest answer.
- **Quantisation vs watertightness**: Manifold guarantees manifold in float;
  the re-snap can nick it — the fixed-point loop + the file-space manifold pin
  (§5.7) is the defence.
- **Palette 256**: richly textured assets quantise to ~17-family mud; k-means
  in LINEAR space + per-build scoped palettes is the ceiling the format allows.
- **Thin features under one cell**: voxels lose them, skins keep them — biases
  ships with rigging toward Path B and chunky hulls toward Path A; a mixed
  export (block core + skin skin) is the eventual shape.
- **Preview speed vs huge meshes**: a 5 M-tri download cannot requantise in
  the UI loop — decimate-on-load to the lattice budget BEFORE the first
  preview pass and stream the ghost layer; the writer stays exact.

## 10. Sources (surveyed 2026-11-02)

trimesh · pyassimp · Open3D (`simplify_vertex_clustering`,
`simplify_quadric_decimation`, voxelization, Chamfer, Poisson) ·
manifold3d (elalish/manifold + wiki) · CGAL Alpha_wrap_3 · dvx-python
(SIGGRAPH 2026, winding-number voxel grids) · fast-simplification · pyfqmr ·
OpenVDB · ObjToSchematic (LucasDower) · Bloxelizer · BlockBlender ·
eisenwave/obj2voxel · Blockbench · MagicaVoxel · BrickFormer · CVVA
(topology-preserving voxelization paper; code effectively unpublished) ·
COLMAP · Meshroom · TRELLIS/TRELLIS.2 · Hunyuan3D · InstantMesh ·
manifold-3d (npm wasm twin) · meshoptimizer (`simplify`) · three.js loaders
(GLTF/OBJ/STL/PLY) · @pixiv/three-voxelizer ·
FORMAT.md §§ Coordinate system, blocks, Triangles (hull) mapping, Colour &
materials (the constraints side — normative).
