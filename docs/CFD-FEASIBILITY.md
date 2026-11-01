# CFD-FEASIBILITY — can an OpenFOAM-like aerodynamic sim run in the editor?

Status (v1.17.0, ruled 2026-11-01): **OpenFOAM — native OR WASM — is NOT
FEASIBLE for this product; the question is closed.** No Navier–Stokes field
solve ships in the editor; the FLIGHT LAB (`engine/flightlab.ts`,
FORMAT §Aerodynamics) answers the design questions with closed-form
shape-field maths over a voxel census. This document keeps the MEASURED
evidence (incl. a live run of the OpenFOAM-WASM demo) so the question is
not re-litigated with a budget. (we: "see if openfoam like sim can be
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
   run (that stays overnight-on-a-server math). VERDICT (ruled 2026-11-01):
   NOT FEASIBLE for this product — the sandbox idea was considered and the
   four rejections are in § P11-S3 (a blockMesh-only solver answers the
   WRONG geometry; real residuals over a fake hull read as false authority;
   the one-core envelope never opens for hull-grade meshes; fork-of-a-fork
   upkeep). True hull CFD, if ever, is P11-S2: an external user-run
   SERVICE with snappyHexMesh doing what a browser cannot.
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

## P11-S3 the opt-in CFD sandbox — REJECTED 2026-11-01 (we: "document
openfoam findings, it's not feasible")
Considered: bundle the proven openfoam-wasm build behind a lazy ⚗ button
(~10 MB wire), cases stair-cased from the voxel census. Rejected, and the
rejections are the findings:
1. THE MESH IS THE ANSWER. blockMesh-only means stair-cased blocks; for
   bluff-body flows the stair-steps trip separation WHERE WE PAINTED THEM.
   A steady-RANS solve on that mesh does not approximate "the actual proper
   hull, as baked" — it answers a different geometry's question. The one
   mesher that could honour the baked skin (snappyHexMesh-grade) is the
   unported hard half. A CFD that cannot mesh the hull is theatre.
2. FALSE CONFIDENCE IS WORSE THAN NONE. The ⚗ report's value is that every
   number's class is labelled honestly (closed-form shape-field). A real
   solver emitting real residuals over a fake hull reads MORE authoritative
   than the honest closed-form numbers while being less representative.
3. THE ENVELOPE NEVER OPENS. One core (vanilla OpenFOAM parallelises by
   MPI, browsers have none) at ~0.5–0.75× native, 4 GB wasm32 (16 GB with
   MEMORY64): the demo's 12k cells solved in 7.4 s, but hull-grade runs
   need 10^5–10^6× that work. Minutes-scale interactive CFD on OUR craft
   geometry remains out of reach for a static-site client, at any bundle
   size (16.8–400 MB measured ladder above).
4. COST/UPKEEP. Fork-of-a-fork build chain (their wmake patches tracking
   OpenFOAM releases), ~35 MB+ lazy asset surface, and a results pipeline
   for a feature whose honest output we already approximate better with
   the FLIGHT LAB for the questions the editor actually answers.
CONSEQUENCE: P11-S2 (external OpenFOAM SERVICE, user-run, does the snappy
meshing + overnight cores) is the only future door for true hull CFD; the
browser stays what it is: closed-form, honestly labelled. P11-S0 (VLM over
the stitched skin — no volumetric mesh, steady attached flow) stays on the
ladder as the only in-editor upgrade worth considering.

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
