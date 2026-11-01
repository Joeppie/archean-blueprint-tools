# CFD-FEASIBILITY — can an OpenFOAM-like aerodynamic sim run in the editor?

Status (v1.17.0): **no Navier–Stokes field solve ships in the editor**; the
FLIGHT LAB (`engine/flightlab.ts`, FORMAT §Aerodynamics) answers the design
questions with closed-form shape-field maths over a voxel census. This
document records WHY a true CFD was not landed and what it would take, so
the next person does not re-derive it (we: "see if openfoam like sim can be
used to simulate aerodynamics. Consider actual proper hull, as baked.
Eddies/drag problems should be highlighted. Ensure aero flow properly
simulated too").

## What the FLIGHT LAB already answers (and how)
- planform census from the block/skin voxels (thin-broad test along the
  thickness axis), Diederich finite-wing lift-curve + 15° stall, fineness +
  Reynolds form/skin drag, induced drag K = 1/(π·e·AR), trim AoA/elevator,
  CG-vs-neutral-point static margin, per-surface authority and a BURIED-
  PLATE census (a surface inside the collider mass reads ≈ no authority —
  the Falcon catch), a lift/drag curve to 25°.
- This is a **steady, attached-flow, lifting-line class** model. It is the
  same family of tooling the game's own flight numbers use; it is NOT a
  field solver: no separation bubble, no vortex shedding, no ground effect,
  no transonics.

## Where "eddy/drag problems" genuinely need more
Questions the closed-form model CANNOT answer: bluff-body wake separation
behind a boxy fuselage, corner vortices on a hull chine, shedding
frequency (buffet), interference drag where a pod meets a wing, heat from
a reentry profile. These need a solved velocity/pressure FIELD.

## Option study (OpenFOAM-class, in/browser/out)
1. **OpenFOAM WASM — IT EXISTS (measured 2026-11-01, we: "but openfoam
   could be wasm? how large would it be?"): FoamScience/openfoam-wasm
   (https://foamscience.github.io/openfoam-wasm/) compiles OpenFOAM with
   Emscripten (wmake-rules patches, whole-archive link with the runtime
   selector disabled — the dynamic .so dlopen machinery must go). Probed
   live: scalarTransportFoam.wasm = **16.8 MB**, blockMesh.wasm =
   **17.6 MB** (~10 MB compressed transfer); READY in 3.7 s (download +
   wasm compile); pitzDaily (12,225 cells, 21 steps) solved in **7.4 s**
   single-threaded in a headless Chromium tab. SIZE LADDER by extrapolation
   (wasm does NOT escape template bloat; brotli ≈ 3× off the transfer):
   simpleFoam-class steady RANS one-solver bundle ≈ **30–60 MB raw
   (15–20 MB wire)**; + compressible/ multiphase per family ≈ +20–60 MB
   each; full multi-solver + snappyHexMesh ≈ **150–400 MB raw**. What size
   does NOT fix: (a) NO snappyHexMesh in the port today — and meshing the
   BAKED hull is the hard half of the ask; (b) vanilla OpenFOAM parallelises
   by MPI domain decomposition, which browsers do not have — you get ONE
   core at ~0.5–0.75× native; (c) wasm32 = 4 GB linear memory (MEMORY64 →
   16 GB, fine). Realistic browser envelope: ~10–100k-cell blockMesh-able
   cases in minutes — a toy airframe, NOT a 2–10 M-cell boundary-layer hull
   run (that stays overnight-on-a-server math). Verdict: shippable NOW as
   an OPT-IN "CFD sandbox" (lazy ~10 MB chunk, real solver, honest toy
   meshes — the voxel census staircased to polyMesh, bounding-shape flows,
   NOT the baked skin); the baked-hull promise still runs through
   snappyHexMesh ⇒ P11-S2 or an octree-mesher slice.
2. **WASM-compiled solver** (e.g. a small LBM or panel method compiled with
   emscripten): viable size budget (a panel code is ~100–300 KB), but the
   mesh pipeline is the cost: OpenFOAM needs a watertight surface MESH. Our
   hull truth is the lattice (blocks + skin prisms); `hullify` is FACE-EXACT
   and watertight-ish, but meshing it (snappyHexMesh-grade) is a project,
   and the bake target ("the actual proper hull, as baked") means the
   stitched skin surfaces (`hull.ts stitchHullSkin`) — display-only today.
   Verdict: a panel-method MVP (Source/Vortex Lattice over the STITCHED
   skin quads) is the one credible in-editor upgrade — no volumetric mesh,
   steady attached flow, but real spanwise loading + induced-drag
   distribution + tip-vortex strength (a better authority map, not eddies).
3. **Real-time LBM on the GPU** (WebGPU ping-pong, ~128³ lattice): the only
   in-browser route that shows EDDIES (separation + shedding are visible).
   Cost: a WebGPU-only feature (this is an iGPU/ANGLE WebGL2 codebase),
   a voxelisation of the craft into the lattice (we already voxelise for
   the tunnels), and the editor's render law (on-demand draws) fights a
   continuous solver. Verdict: research spike territory, not a feature
   with an iGPU budget; parked in REWRITE § P11.

## What v1.17.0 DOES ship toward the ask
- The ANALYSIS report (§ AnalysisWindow, xcgraph `buildAnalysisHtml`)
  includes the flight section ONLY for craft carrying control surfaces
  (the rover/Mario gate), surfaces its stall/L/D/static-margin/authority
  numbers in one document, and **HIGH-LIGHTS the buried-surface census**
  as the drag/authority suspect we can actually detect from the lattice.
- FORMAT §Aerodynamics + § Subgrids remain the law source; the FLIGHT LAB
  is the engine seam any future solver replaces behind the same report.

## P11-S3 (NEW, enabled by openfoam-wasm) the opt-in CFD sandbox
Bundle the proven openfoam-wasm build recipe (their build.sh + patches are
GPL like us — one commit, upstream-credit) behind a lazy ⚗ "CFD sandbox"
button: blockMesh + a chosen solver download ONLY on click (~10 MB wire);
cases generated from the voxel census (stair-case polyMesh, 20–50k cell
cap, 2D slice or coarse 3D); results parsed back into the analysis report
as "real FVM, toy mesh" beside the closed-form numbers. The baked-skin
case stays gated on a mesher (P11-S2 service or an octree-mesh slice).

## If we ever do a panel MVP (the cheap 20%)
1. Mesh: take `stitchHullSkin` quads (already lattice-exact) + block
   boxes → quad panels; no volumetric mesh.
2. 3-D VLM (LLT): horseshoe vortices, collocation at ¾ chord; ~500 panels
   solve a dense N×N once (boot-time, off-thread); gives Cl/Cdᵢ
   distribution, local α, tip-vortex Γ — a spanwise authority heat-strip
   on the ⚗ report.
3. NO separation/eddies (that is RANS/LES territory) — the report line
   stays honest: "no separation modelling".
Estimate: one focused session + the geometry care the hull laws demand.
