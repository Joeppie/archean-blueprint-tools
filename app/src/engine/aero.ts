// aero.ts — the WIND TUNNEL (pure: no THREE, no DOM — vitest layer + a WASM
// seam candidate next to cull.ts).
//
// WHY THIS MODEL (the legacy thin-plate "aero plates" flow was bogus — the
// user killed it 2026-10-19): the official Archean aerodynamics docs
// (wiki.archean.space/en/aerodynamics.html, transcribed into FORMAT.md)
// describe the game's SHAPE FIELD — a cross-section model:
//   • the engine scans the OUTER SHELL of the build into surface patches;
//     each patch knows position, facing, area and how DEEP the solid body is
//     behind it (its cross-section along the flow);
//   • interior blocks are never exposed, and a sealed cavity counts as SOLID
//     body — "a hollow shape flies exactly like its solid version";
//   • FINENESS = streamlining: a slender shape along the flow keeps the air
//     attached and has very LOW form drag; a bluff one has FULL form drag
//     ("a tenth of the form drag of a blunt one at the same frontal size").
// This module implements that shape field on the voxel lattice (blocks +
// occupancies = the collider volumes), then VISUALISES it with a real flow
// solve: incompressible potential flow through a porous mask (Darcy-style
// v = κ(U + ∇φ), ∇·v = 0 — the standard obstacle-in-tunnel idealisation),
// geometric multigrid, red-black GS. Uniform inflow at the inlet,
// zero-gradient outlet, symmetry sides; solid voxels (κ=0) seal their faces,
// so the body is a no-penetration obstacle automatically. Potential flow
// alone cannot separate, so the VISCOUS WAKE is added from the wiki's own
// fineness law: behind a solid run of depth d along the flow, the axial
// flux decays by blockageOf(d)·exp(−x/L) — bluff faces shed a broad slow
// wake, slender profiles keep the flow attached. Streamlines (RK2 through
// the flux field) are coloured by speed: stagnation glows white-blue ahead
// of blunt noses… rather, runs WARM→BRIGHT with speed and dies in the body.
//
// Force coefficients (lift curve + stall, induced drag, Mach) are the NEXT
// step on the SAME field — scanAnalysis() already classifies thin
// cross-sections (the wiki's geometric wing criterion) and reports the
// fineness-weighted form drag.

import type { Block, Blueprint } from './format';
import { CELL } from './format';

export type V3 = [number, number, number];

/** flow directions in FILE space (−z is the nose of the corpus craft): the
 *  "wind" blows FROM that side toward the opposite one. */
export type FlowKey = 'nose' | 'tail' | 'left' | 'right' | 'up' | 'down';
export const FLOWS: Record<FlowKey, V3> = {
  nose: [0, 0, -1], tail: [0, 0, 1], left: [-1, 0, 0],
  right: [1, 0, 0], up: [0, -1, 0], down: [0, 1, 0],
};

export interface Tunnel {
  nx: number; ny: number; nz: number;
  /** dominant flow axis 0=x 1=y 2=z; domain index grows WITH the flow */
  axis: number;
  /** the FILE-space flow this tunnel was built for (index-map key) */
  flow: V3;
  /** voxel edge in metres (CELL × divisor — the wiki's resolution scaling) */
  voxel: number;
  /** min corner of the (travel-aligned) domain in absolute FILE cells */
  o: [number, number, number];
  /** 1 = solid voxel (a collider box covers it), 0 = air */
  solid: Uint8Array;
  /** FORM-BLOCKAGE per solid voxel (wiki drag fineness: bluff→1,
   *  slender→~0.1); 0 in air — drives the wake decay + the scan report */
  blockage: Float32Array;
  /** wake deficit 0..~0.8 per voxel (precomputed from blockage upstream) */
  wake: Float32Array;
  /** body bbox in voxel indices (inclusive max) */
  body: [number, number, number, number, number, number];
  solidCount: number;
}

export interface Solve {
  tun: Tunnel;
  phi: Float32Array;
  levels: Level[];
  res: number;
  res0: number;
  iters: number;
  converged: boolean;
  done: boolean;
}

interface Level {
  nx: number; ny: number; nz: number;
  /** cell permeability (1 = air, 0 = solid; coarse = fluid fraction) */
  kap: Float32Array;
  /** face permeability: 0 when either side is fully/partially solid… */
  cx: Float32Array; cy: Float32Array; cz: Float32Array;
  /** continuity source: the inlet plane injects +kap (uniform inflow), the
   *  outlet plane drains −kap (zero-gradient outflow) */
  src: Float32Array;
  u: Float32Array;              // φ (fine) / correction (coarse)
  f: Float32Array;              // residual
  rb: Uint8Array;
}

export interface SolveStatus { iters: number; res: number; converged: boolean; done: boolean }

export interface Streamlines {
  /** ROOT-space (view, pre-moff) positions, 6 floats per segment */
  positions: Float32Array;
  /** linear-rgb colours, 3 per vertex */
  colors: Float32Array;
  segments: number;
  lines: number;
  vMax: number;                 // max |v|/U∞ sampled
}

export interface ScanReport {
  frontalArea: number;          // m²
  dragW: number;                // Σ area·blockage (m²-equivalent form drag)
  dragCd: number;               // dragW / frontalArea ∈ (0,1]
  liftArea: number;             // m² of THIN cross-section normal to the flow
  thinColumns: number;
  columns: number;
}

// ------------------------------------------------------------- shape field

/** all collider boxes (top-level blocks + NESTED subgrid content + part
 *  occupancies) in absolute FILE cells: origin c, exclusive extent e
 *  (the INCLUSIVE size+1 rule pinned in build.test). */
export function bodyBoxes(bp: Blueprint): { c: V3; e: V3 }[] {
  const out: { c: V3; e: V3 }[] = [];
  const walk = (blocks: Block[] | undefined) => {
    for (const b of blocks ?? []) {
      if (b.type === 255) continue;
      out.push({
        c: [(b.frame_x ?? 0) * 12 + b.pos_x, (b.frame_y ?? 0) * 12 + b.pos_y,
          (b.frame_z ?? 0) * 12 + b.pos_z],
        e: [b.size_x + 1, b.size_y + 1, b.size_z + 1],
      });
    }
  };
  walk(bp.data.blocks);
  for (const c of bp.data.components) {
    if (c.type === 'Build') {
      walk((c as { blueprint?: { data?: { blocks?: Block[] } } }).blueprint?.data?.blocks);
      continue;
    }
    for (const o of c.occupancies ?? []) {
      if (!o || typeof o.pos_x !== 'number') continue;
      out.push({
        c: [(o.frame_x ?? 0) * 12 + o.pos_x, (o.frame_y ?? 0) * 12 + o.pos_y,
          (o.frame_z ?? 0) * 12 + o.pos_z],
        e: [(o.size_x ?? 0) + 1, (o.size_y ?? 0) + 1, (o.size_z ?? 0) + 1],
      });
    }
  }
  return out;
}

/** wiki drag fineness of a solid run of `run` voxels along the flow:
 *  run 1 → 0.50, 2 → 0.33, 4 → 0.23, 10 → 0.15, ∞ → 0.10 (streamlined);
 *  run ≥ 12 → FULL form drag (bluff). */
export const blockageOf = (run: number): number =>
  run >= 12 ? 1 : Math.max(0.1, 1 / (1 + 0.55 * run));

/** Build the shape field for a FILE-space flow direction (e.g. FLOWS.nose).
 *  Returns null for an empty craft. `budget` caps the voxel count (the
 *  wiki's bounded cost); the voxel size doubles until the domain fits. The
 *  DOMAIN is travel-aligned: along the flow axis index 0 is UPSTREAM and
 *  n−1 downstream, whatever the file sign of the flow. */
export function buildTunnel(bp: Blueprint, flow: V3, opts?:
  { budget?: number; padFlow?: number; padSide?: number }): Tunnel | null {
  const boxes = bodyBoxes(bp);
  if (!boxes.length) return null;
  const c0: V3 = [Infinity, Infinity, Infinity], c1: V3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes)
    for (let a = 0; a < 3; a++) {
      c0[a] = Math.min(c0[a]!, b.c[a]!);
      c1[a] = Math.max(c1[a]!, b.c[a]! + b.e[a]!);
    }
  const mag = [flow[0]! * flow[0]!, flow[1]! * flow[1]!, flow[2]! * flow[2]!];
  const axis = mag[0]! >= mag[1]! && mag[0]! >= mag[2]! ? 0 : mag[1]! >= mag[2]! ? 1 : 2;
  const d = flow[axis]! >= 0 ? 1 : -1;               // travel direction, file axes
  const pf = opts?.padFlow ?? 16, ps = opts?.padSide ?? 8;
  const budget = opts?.budget ?? 260_000;
  // travel-aligned extent (absolute cells): g = a===axis ? d·file : file
  const lo: V3 = [0, 0, 0], hi: V3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const pad = a === axis ? pf : ps;
    const wa = a === axis ? d * c0[a]! : c0[a]!;
    const wb = a === axis ? d * c1[a]! : c1[a]!;
    lo[a] = Math.min(wa, wb) - pad; hi[a] = Math.max(wa, wb) + pad;
  }
  let s = 1;                                          // cells per voxel
  while (Math.ceil((hi[0]! - lo[0]!) / s) * Math.ceil((hi[1]! - lo[1]!) / s)
    * Math.ceil((hi[2]! - lo[2]!) / s) > budget && s < 8) s *= 2;
  const nx = Math.max(10, Math.ceil((hi[0]! - lo[0]!) / s)),
    ny = Math.max(10, Math.ceil((hi[1]! - lo[1]!) / s)),
    nz = Math.max(10, Math.ceil((hi[2]! - lo[2]!) / s));
  const N = nx * ny * nz;
  const solid = new Uint8Array(N);

  for (const b of boxes) {
    const lo3 = [0, 0, 0], hi3 = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const wa = a === axis ? d * b.c[a]! : b.c[a]!;
      const wb = a === axis ? d * (b.c[a]! + b.e[a]!) : b.c[a]! + b.e[a]!;
      lo3[a] = Math.max(0, Math.floor((Math.min(wa, wb) - lo[a]!) / s));
      hi3[a] = Math.min([nx, ny, nz][a]!, Math.ceil((Math.max(wa, wb) - lo[a]!) / s));
    }
    if (lo3[0]! >= hi3[0]! || lo3[1]! >= hi3[1]! || lo3[2]! >= hi3[2]!) continue;
    for (let k = lo3[2]!; k < hi3[2]!; k++)
      for (let j = lo3[1]!; j < hi3[1]!; j++) {
        let p = (k * ny + j) * nx + lo3[0]!;
        for (let i = lo3[0]!; i < hi3[0]!; i++, p++) solid[p] = 1;
      }
  }

  // ---- per flow-parallel line: solid runs → blockage + WAKE decay -------
  // potential flow cannot separate; the wiki's fineness law enters HERE:
  // downstream of a run of depth d, the axial flux deficit = blockageOf(d)
  // decaying over an exp mixing length (bluff: broad slow wake; slender:
  // flow stays attached, the shadow reads almost undisturbed).
  const blockage = new Float32Array(N);
  const wake = new Float32Array(N);
  const step = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  const lineLen = [nx, ny, nz][axis]!;
  const nLines = N / lineLen;
  const lineBase = (t: number): number =>
    axis === 0 ? t * nx
      : axis === 1 ? Math.floor(t / nx) * nx * ny + (t % nx)
        : t;                                       // z-lines: column (i,j) at t
  const LMix = Math.max(6, lineLen * 0.08);
  for (let t = 0; t < nLines; t++) {
    const base = lineBase(t);
    let runStart = -1, lastEnd = -1, lastB = 0;
    for (let q = 0; q <= lineLen; q++) {
      const inBody = q < lineLen && solid[base + q * step] === 1;
      if (inBody && runStart < 0) runStart = q;
      if (inBody) continue;
      if (runStart >= 0) {                          // run [runStart,q) ended
        const run = q - runStart;
        lastB = blockageOf(run); lastEnd = q - 1;
        for (let w = runStart; w < q; w++) blockage[base + w * step] = lastB;
        runStart = -1;
      }
      if (q < lineLen) {                            // air cell: wake shadow
        if (lastEnd >= 0) {
          const def = lastB * Math.exp(-(q - 1 - lastEnd) / LMix);
          if (def < 0.02) lastEnd = -1; else wake[base + q * step] = 0.85 * def;
        }
      }
    }
  }

  const body: Tunnel['body'] = [nx - 1, ny - 1, nz - 1, 0, 0, 0];
  let solidCount = 0;
  for (let p = 0; p < N; p++) if (solid[p]) {
    solidCount++;
    const k = Math.floor(p / (nx * ny)), j = Math.floor(p / nx) % ny, i = p % nx;
    if (i < body[0]!) body[0] = i; if (i > body[3]!) body[3] = i;
    if (j < body[1]!) body[1] = j; if (j > body[4]!) body[4] = j;
    if (k < body[2]!) body[2] = k; if (k > body[5]!) body[5] = k;
  }
  if (!solidCount) return null;

  return { nx, ny, nz, axis, flow: [flow[0], flow[1], flow[2]], voxel: s * CELL,
    o: [lo[0]!, lo[1]!, lo[2]!], solid, blockage, wake, body, solidCount };
}

/** voxel position (float index) → ROOT-space metres (the display frame IS
 *  the file frame since the v0.180 de-mirror; PRE-moff: the Engine's root
 *  group carries the display anchor). Inverts the travel-aligned map. */
export function rootPos(t: Tunnel, i: number, j: number, k: number): V3 {
  const axis = t.axis, d = t.flow[axis]! >= 0 ? 1 : -1;
  const abs = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const q = [i, j, k][a]!;
    const g = t.o[a]! + q * (t.voxel / CELL);
    // travel-aligned voxel [g, g+s) ⇔ file cells: d>0 → [g, g+s); d<0 →
    // (−g−s, −g] = file [−g−s, −g). The centre: d·(g + s/2) shifted so it
    // lands on the SAME file point both ways: fileCentre = d>0 ? g+s/2 :
    // −(g+s/2) with the s-offset baked into lo (build used lo=g0−pad for
    // both signs; for d<0 g = −file maps file c1→−c1 exactly, voxel q
    // covers file [−(g+s), −g] → centre −g−s/2):
    abs[a] = a === axis ? (d > 0 ? g + (t.voxel / CELL) / 2 : -g - (t.voxel / CELL) / 2) : g + (t.voxel / CELL) / 2;
  }
  // abs are absolute-cell CENTRES; world = (abs − 5.5)·CELL (raw == view, v0.180)
  const cellCentreToWorld = (v: number) => (v - 5.5) * CELL;
  return [cellCentreToWorld(abs[0]!), cellCentreToWorld(abs[1]!), cellCentreToWorld(abs[2]!)];
}

/** voxel position → FILE-space world metres (== rootPos since v0.180: the
 *  display frame IS the file frame) */
export function filePointOf(t: Tunnel, i: number, j: number, k: number): V3 {
  return rootPos(t, i, j, k);
}

// ------------------------------------------------------------- the solver
// v = κ(U + ∇φ), ∇·v = 0. Cell-centred FVM: face flux
//   F_f = κ_f·(U·n̂_f + (φ_b − φ_a))          (κ_f = min of the two cells)
// Domain boundary faces: INLET κ·(+1) uniform inflow, OUTLET zero-gradient
// (φ_ghost = φ_inner ⇒ flux κ·(+1 + 0) stays whatever the field carries…
// actually the outlet face then contributes κ·(1 + φ_ghost−φ) = κ·1:
// uniform-capable outflow), SIDES no-penetration (no U term, ghost mirror).
// Cell equation: Σ_f F_f = 0 → aw·φ_p = Σ w·φ_nbr + s with s the boundary
// U-terms folded to the RHS. Solid cells: κ=0 → aw=0 → φ pinned at 0.

const CxF = (l: Level, i: number, j: number, k: number) => (k * l.ny + j) * (l.nx - 1) + i;
const CyF = (l: Level, i: number, j: number, k: number) => (k * (l.ny - 1) + j) * l.nx + i;
const CzF = (l: Level, i: number, j: number, k: number) => ((k - 1) * l.ny + j) * l.nx + i;

export function createSolve(tun: Tunnel): Solve {
  const kap = new Float32Array(tun.nx * tun.ny * tun.nz);
  for (let p = 0; p < kap.length; p++) kap[p] = tun.solid[p] ? 0 : 1;
  const lv0 = makeLevel(tun.nx, tun.ny, tun.nz, kap, tun.axis);
  const levels: Level[] = [lv0];
  while (Math.max(levels[levels.length - 1]!.nx, levels[levels.length - 1]!.ny,
    levels[levels.length - 1]!.nz) > 8 && levels.length < 6) {
    const p = levels[levels.length - 1]!;
    // coarse κ = fluid fraction of the children (a half-solid coarse cell
    // half-transmits: the classic porous multigrid coarsening)
    const cnx = Math.max(2, Math.ceil(p.nx / 2)), cny = Math.max(2, Math.ceil(p.ny / 2)),
      cnz = Math.max(2, Math.ceil(p.nz / 2));
    const cc = new Float32Array(cnx * cny * cnz), cnt = new Float32Array(cnx * cny * cnz);
    for (let k = 0; k < p.nz; k++) for (let j = 0; j < p.ny; j++) for (let i = 0; i < p.nx; i++) {
      const q = Math.min(cnz - 1, k >> 1) * cny * cnx + Math.min(cny - 1, j >> 1) * cnx + Math.min(cnx - 1, i >> 1);
      cc[q] = cc[q]! + p.kap[(k * p.ny + j) * p.nx + i]!;
      cnt[q] = cnt[q]! + 1;
    }
    const ck = new Float32Array(cnx * cny * cnz);
    for (let q = 0; q < ck.length; q++) ck[q] = cc[q]! / (cnt[q] || 1);
    // coarse level = HOMOGENEOUS correction equation (the fine source enters
    // through the restricted residual — adding it twice would diverge)
    const cl = makeLevel(cnx, cny, cnz, ck, tun.axis);
    cl.src.fill(0);
    levels.push(cl);
  }
  return { tun, phi: lv0.u, levels, res: Infinity, res0: 1,
    iters: 0, converged: false, done: false };
}

function makeLevel(nx: number, ny: number, nz: number, kap: Float32Array, axis: number): Level {
  const l: Level = {
    nx, ny, nz, kap,
    cx: new Float32Array(Math.max(0, (nx - 1)) * ny * nz),
    cy: new Float32Array(Math.max(0, nx * (ny - 1)) * nz),
    cz: new Float32Array(Math.max(0, nx * ny * (nz - 1))),
    src: new Float32Array(nx * ny * nz),
    u: new Float32Array(nx * ny * nz),
    f: new Float32Array(nx * ny * nz),
    rb: new Uint8Array(nx * ny * nz),
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++)
    l.cx[CxF(l, i, j, k)] = Math.min(kap[(k * ny + j) * nx + i]!, kap[(k * ny + j) * nx + i + 1]!);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++)
    l.cy[CyF(l, i, j, k)] = Math.min(kap[(k * ny + j) * nx + i]!, kap[(k * ny + j + 1) * nx + i]!);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    l.cz[CzF(l, i, j, k + 1)] = Math.min(kap[(k * ny + j) * nx + i]!, kap[((k + 1) * ny + j) * nx + i]!);
  // RHS source of the porous potential equation. v = κ(U + ∇φ) at faces:
  // F_f = κ_f(δ_axis + φ_b − φ_a). The δ terms telescope over each cell's
  // flow-axis faces:  s_p = κ_loface − κ_hiface  (domain inlet/outlet faces
  // count with κ = the cell's own κ). Uniform air: every face appears once
  // + and once − ⇒ Σs = 0 cellwise, φ≡0, v≡U EXACTLY; the source appears
  // precisely where κ changes along the flow — the body pushing the air.
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const p = (k * ny + j) * nx + i;
        const kp = kap[p]!;
        if (kp === 0) continue;
        let lo = 0, hi = 0;
        if (axis === 0) {
          lo = i === 0 ? kp : l.cx[CxF(l, i - 1, j, k)]!;
          hi = i === nx - 1 ? kp : l.cx[CxF(l, i, j, k)]!;
        } else if (axis === 1) {
          lo = j === 0 ? kp : l.cy[CyF(l, i, j - 1, k)]!;
          hi = j === ny - 1 ? kp : l.cy[CyF(l, i, j, k)]!;
        } else {
          lo = k === 0 ? kp : l.cz[CzF(l, i, j, k)]!;
          hi = k === nz - 1 ? kp : l.cz[CzF(l, i, j, k + 1)]!;
        }
        l.src[p] = lo - hi;
      }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    l.rb[(k * ny + j) * nx + i] = (i + j + k) & 1;
  return l;
}

/** the shared operator: aw·φ_p = Σ w·φ_nbr + src_p (solid cells aw=0 ⇒ 0).
 *  Coarse levels run the SAME operator (no source: the correction equation
 *  with a cell-centred source restricted through the residual below keeps
 *  the FMV-cycle stable; src is restricted too via restrictSource). */
function gsweep(l: Level): void {
  const { nx, ny, nz, u, cx, cy, cz, rb, src, kap } = l;
  const nxy = nx * ny;
  for (let color = 0; color < 2; color++) {
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++) {
        let p = (k * ny + j) * nx;
        for (let i = 0; i < nx; i++, p++) {
          if (rb[p] !== color) continue;
          if (kap[p] === 0) { u[p] = 0; continue; }
          let aw = 0, rhs = src[p]!;
          // neighbour OR symmetry ghost (ghost = interior value ⇒ the face
          // contributes w·u[p] to rhs and w to aw ⇒ cancels = no-flux wall).
          // Implemented by SIMPLY SKIPPING boundary faces (equivalent).
          if (i > 0) { const w = cx[CxF(l, i - 1, j, k)]!; if (w) { aw += w; rhs += w * u[p - 1]!; } }
          if (i < nx - 1) { const w = cx[CxF(l, i, j, k)]!; if (w) { aw += w; rhs += w * u[p + 1]!; } }
          if (j > 0) { const w = cy[CyF(l, i, j - 1, k)]!; if (w) { aw += w; rhs += w * u[p - nx]!; } }
          if (j < ny - 1) { const w = cy[CyF(l, i, j, k)]!; if (w) { aw += w; rhs += w * u[p + nx]!; } }
          if (k > 0) { const w = cz[CzF(l, i, j, k)]!; if (w) { aw += w; rhs += w * u[p - nxy]!; } }
          if (k < nz - 1) { const w = cz[CzF(l, i, j, k + 1)]!; if (w) { aw += w; rhs += w * u[p + nxy]!; } }
          u[p] = aw > 1e-12 ? rhs / aw : 0;
        }
      }
  }
}

/** residual = Σ_faces κ_f(Δφ) + src over the SAME operator */
function residual(l: Level, r: Float32Array): void {
  r.fill(0);
  const { nx, ny, nz, u, cx, cy, cz, src, kap } = l;
  const nxy = nx * ny;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++) {
      let p = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++, p++) {
        if (kap[p] === 0) continue;
        let res = src[p]!;
        if (i > 0) res += cx[CxF(l, i - 1, j, k)]! * (u[p - 1]! - u[p]!);
        if (i < nx - 1) res += cx[CxF(l, i, j, k)]! * (u[p + 1]! - u[p]!);
        if (j > 0) res += cy[CyF(l, i, j - 1, k)]! * (u[p - nx]! - u[p]!);
        if (j < ny - 1) res += cy[CyF(l, i, j, k)]! * (u[p + nx]! - u[p]!);
        if (k > 0) res += cz[CzF(l, i, j, k)]! * (u[p - nxy]! - u[p]!);
        if (k < nz - 1) res += cz[CzF(l, i, j, k + 1)]! * (u[p + nxy]! - u[p]!);
        r[p] = res;
      }
    }
}

/** full weighting (the transpose of the trilinear prolong below — R = Pᵗ
 *  keeps the FMV-cycle contraction): fine residual spread onto the 8
 *  nearest coarse nodes with 1/8·1/4·1/2 weights */
function restrict(f: Level, c: Level): void {
  c.f.fill(0);
  for (let k = 0; k < f.nz; k++) {
    const ck0 = k >> 1, wK0 = k & 1 ? 0.5 : 1;
    const ck1 = Math.min(c.nz - 1, ck0 + (k & 1));
    const wK1 = 1 - wK0;
    for (let j = 0; j < f.ny; j++) {
      const cj0 = j >> 1, wJ0 = j & 1 ? 0.5 : 1;
      const cj1 = Math.min(c.ny - 1, cj0 + (j & 1));
      const wJ1 = 1 - wJ0;
      let pf = (k * f.ny + j) * f.nx;
      for (let i = 0; i < f.nx; i++, pf++) {
        const r = f.f[pf]!;
        if (r === 0) continue;
        const ci0 = i >> 1, wI0 = i & 1 ? 0.5 : 1;
        const ci1 = Math.min(c.nx - 1, ci0 + (i & 1));
        const wI1 = 1 - wI0;
        for (const [ck, wk] of [[ck0, wK0], [ck1, wK1]] as const)
          for (const [cj, wj] of [[cj0, wJ0], [cj1, wJ1]] as const)
            for (const [ci, wi] of [[ci0, wI0], [ci1, wI1]] as const)
              c.f[(ck * c.ny + cj) * c.nx + ci] = c.f[(ck * c.ny + cj) * c.nx + ci]! + r * wk * wj * wi / 8;
      }
    }
  }
}

/** correction interpolation: coarse node value → fine cell, bilinear
 *  (weights 1, ½, ¼ by child parity); coarse cell (ci,cj,ck) governs fine
 *  cells 2ci−1..2ci+1 */
function prolong(c: Level, f: Level): void {
  for (let ck = 0; ck < c.nz; ck++) {
    const k0 = Math.max(0, 2 * ck - 1), k1 = Math.min(f.nz - 1, 2 * ck + 1);
    for (let cj = 0; cj < c.ny; cj++) {
      const j0 = Math.max(0, 2 * cj - 1), j1 = Math.min(f.ny - 1, 2 * cj + 1);
      for (let ci = 0; ci < c.nx; ci++) {
        const i0 = Math.max(0, 2 * ci - 1), i1 = Math.min(f.nx - 1, 2 * ci + 1);
        const v = c.u[(ck * c.ny + cj) * c.nx + ci]!;
        if (v === 0) continue;
        for (let k = k0; k <= k1; k++) {
          const wk = k === 2 * ck ? 1 : 0.5;
          for (let j = j0; j <= j1; j++) {
            const wj = j === 2 * cj ? 1 : 0.5;
            for (let i = i0; i <= i1; i++) {
              const wi = i === 2 * ci ? 1 : 0.5;
              const p = (k * f.ny + j) * f.nx + i;
              f.u[p] = f.u[p]! + v * wk * wj * wi / 8;
            }
          }
        }
      }
    }
  }
}

function vcycle(s: Solve, li: number): void {
  const l = s.levels[li]!;
  gsweep(l); gsweep(l);
  if (li + 1 < s.levels.length) {
    const c = s.levels[li + 1]!;
    residual(l, l.f);
    restrict(l, c);
    c.u.fill(0);
    vcycle(s, li + 1);
    prolong(c, l);
  }
  gsweep(l);
}

/** advance by `batch` V-cycles; early solutions are already usable (the
 *  engine re-seeds streamlines while it converges) */
export function solveStep(s: Solve, batch = 4): SolveStatus {
  if (s.done) return { iters: s.iters, res: s.res, converged: s.converged, done: true };
  const l = s.levels[0]!;
  if (s.iters === 0) {
    residual(l, l.f);
    let m = 0;
    for (let p = 0; p < l.f.length; p++) m = Math.max(m, Math.abs(l.f[p]!));
    s.res0 = Math.max(m, 1e-12);
  }
  for (let b = 0; b < batch; b++) {
    vcycle(s, 0);
    s.iters++;
    residual(l, l.f);
    let m = 0;
    for (let p = 0; p < l.f.length; p++) m = Math.max(m, Math.abs(l.f[p]!));
    s.res = m;
    if (m < s.res0 * 0.02 || s.iters >= 450) { s.converged = true; break; }
  }
  s.done = s.converged;
  return { iters: s.iters, res: s.res, converged: s.converged, done: s.done };
}

/** velocity in units of U∞ at a voxel position (nearest cell):
 *  v = κ·(U·δ_axis + ∇φ central differences of the φ cell field) — then
 *  the WAKE fineness decay (axial component, wiki §Drag). |v| ≥ 1e8 ⇒
 *  outside the domain. */
export function sampleVel(s: Solve, i: number, j: number, k: number):
  [number, number, number, number] {
  const t = s.tun, { nx, ny, nz } = t, phi = s.phi;
  if (i < 0 || j < 0 || k < 0 || i > nx - 1 || j > ny - 1 || k > nz - 1)
    return [0, 0, 0, 1e9];
  const i0 = Math.round(i), j0 = Math.round(j), k0 = Math.round(k);
  const p = (k0 * ny + j0) * nx + i0;
  if (t.solid[p]) return [0, 0, 0, 0];
  const at = (a: number, b: number, c: number) =>
    phi[(Math.min(nz - 1, Math.max(0, c)) * ny + Math.min(ny - 1, Math.max(0, b))) * nx
      + Math.min(nx - 1, Math.max(0, a))]!;
  const gx = (at(i0 + 1, j0, k0) - at(i0 - 1, j0, k0)) * (i0 > 0 && i0 < nx - 1 ? 0.5 : 1);
  const gy = (at(i0, j0 + 1, k0) - at(i0, j0 - 1, k0)) * (j0 > 0 && j0 < ny - 1 ? 0.5 : 1);
  const gz = (at(i0, j0, k0 + 1) - at(i0, j0, k0 - 1)) * (k0 > 0 && k0 < nz - 1 ? 0.5 : 1);
  let u = gx, v = gy, w = gz;
  u += t.axis === 0 ? 1 : 0; v += t.axis === 1 ? 1 : 0; w += t.axis === 2 ? 1 : 0;
  const wk = t.wake[p]!;
  if (wk > 0) {
    if (t.axis === 0) u *= 1 - wk; else if (t.axis === 1) v *= 1 - wk; else w *= 1 - wk;
    const f = 1 - wk * 0.35;                        // slight transverse spread
    if (t.axis !== 0) u *= f; if (t.axis !== 1) v *= f; if (t.axis !== 2) w *= f;
  }
  return [u, v, w, Math.hypot(u, v, w)];
}

/** inside the opaque body? (a streamline dies there) */
export function sampleSolid(s: Solve, i: number, j: number, k: number): boolean {
  const t = s.tun, { nx, ny, nz } = t;
  const i0 = Math.round(i), j0 = Math.round(j), k0 = Math.round(k);
  if (i0 < 0 || j0 < 0 || k0 < 0 || i0 >= nx || j0 >= ny || k0 >= nz) return false;
  return t.solid[(k0 * ny + j0) * nx + i0] === 1;
}

// -------------------------------------------------------------- streamlines

/** FORWARD streamlines from a plane a few voxels UPSTREAM of the body plus
 *  a short BACKWARD leg (the upstream deflection is what sells the shape).
 *  Lines die in the body and at the domain faces; the wake deficit shows up
 *  as slow (deep-blue) segments behind bluff faces. */
export function streamlines(s: Solve, maxLines = 260): Streamlines {
  const t = s.tun;
  const az = t.axis;
  const [b0, b1, b2, b3, b4, b5] = t.body;
  const bMin = [b0, b1, b2], bMax = [b3, b4, b5];
  const nAx = [t.nx, t.ny, t.nz];
  const perp = [0, 1, 2].filter(a => a !== az);
  const pA = perp[0]!, pB = perp[1]!;
  const extA = bMax[pA]! - bMin[pA]! + 1, extB = bMax[pB]! - bMin[pB]! + 1;
  const margin = Math.max(3, Math.min(8, Math.round(0.08 * Math.max(extA, extB))));
  const nA = Math.max(2, Math.min(30, Math.round(Math.sqrt(maxLines * (extA + 2 * margin) / Math.max(extB + 2 * margin, 1)))));
  const nB = Math.max(2, Math.min(30, Math.round(maxLines / nA)));
  const loA = Math.max(1, bMin[pA]! - margin), hiA = Math.min(nAx[pA]! - 2, bMax[pA]! + margin);
  const loB = Math.max(1, bMin[pB]! - margin), hiB = Math.min(nAx[pB]! - 2, bMax[pB]! + margin);
  const seedPos = Math.max(1, bMin[az]! - Math.max(4, margin >> 1));

  const pos: number[] = [], col: number[] = [];
  let lines = 0, vMax = 0;
  const ds = 0.6;
  const capF = Math.round((nAx[0]! + nAx[1]! + nAx[2]!) * 3);

  const trace = (q: number[], sign: number, cap: number): number[][] => {
    const out: number[][] = [];
    const p = [...q];
    for (let it = 0; it < cap; it++) {
      const [u, v, w, mag] = sampleVel(s, p[0]!, p[1]!, p[2]!);
      if (mag >= 1e8) break;
      vMax = Math.max(vMax, mag);
      const h = Math.min(ds / Math.max(mag, 0.05), 4);
      const m2 = sampleVel(s, p[0]! + sign * u * h / 2, p[1]! + sign * v * h / 2, p[2]! + sign * w * h / 2);
      if (m2[3] >= 1e8) break;
      p[0] = p[0]! + sign * m2[0] * h; p[1] = p[1]! + sign * m2[1] * h; p[2] = p[2]! + sign * m2[2] * h;
      if (sampleSolid(s, p[0]!, p[1]!, p[2]!)) break;
      out.push([p[0]!, p[1]!, p[2]!, m2[3]]);
      if (sign > 0 && p[az]! > nAx[az]! - 1.05) break;
      if (sign < 0 && p[az]! < 0.05) break;
      if (mag < 0.015) break;                       // parked in a pocket
    }
    return out;
  };

  for (let ib = 0; ib < nB; ib++)
    for (let ia = 0; ia < nA; ia++) {
      const seed = [0, 0, 0];
      seed[az] = seedPos;
      seed[pA] = loA + (hiA - loA) * (ia + 0.5) / nA;
      seed[pB] = loB + (hiB - loB) * (ib + 0.5) / nB;
      if (sampleSolid(s, seed[0]!, seed[1]!, seed[2]!)) continue;
      const fwd = trace(seed, 1, capF);
      if (fwd.length < 8) continue;                 // died immediately: skip
      const bwd = trace(seed, -1, Math.round(capF / 3)).reverse();
      lines++;
      const pts = [...bwd, [seed[0]!, seed[1]!, seed[2]!, 1], ...fwd];
      for (let pI = 0; pI + 1 < pts.length; pI++) {
        const A = pts[pI]!, B = pts[pI + 1]!;
        const ra = rootPos(t, A[0]!, A[1]!, A[2]!), rb2 = rootPos(t, B[0]!, B[1]!, B[2]!);
        pos.push(ra[0], ra[1], ra[2], rb2[0], rb2[1], rb2[2]);
        const ca = speedColor(A[3] ?? 1), cb = speedColor(B[3] ?? 1);
        col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]);
      }
    }
  return { positions: new Float32Array(pos), colors: new Float32Array(col),
    segments: pos.length / 6, lines, vMax };
}

/** streamline colour map — DEVIATION from U∞ (drawn ADDITIVE, so the
 *  uniform freestream stays nearly BLACK and fades out while structure
 *  glows): slow (stagnation/wake) BLUE → freestream faint dark → fast warm
 *  ORANGE. Blue near-white only very slow (stagnation highlight). */
export function speedColor(r: number): V3 {
  const d = r - 1;
  if (Math.abs(d) < 0.06) return [0.02, 0.03, 0.05];      // dead band: invisible
  if (d < 0) {
    const t = Math.min(1, -d / 0.9), s = t * t;           // emphasise stagnation
    return [0.04 + 0.5 * s, 0.05 + 0.6 * s, 0.08 + 0.9 * s];
  }
  const t = Math.min(1, d / 0.5);                          // ≥1.5 U∞ full warm
  return [0.04 + 0.91 * t, 0.06 + 0.34 * t, 0.09 * (1 - t)];
}

// -------------------------------------------------------------- scan report

/** The wiki's thin-cross-section (wing) classification + fineness-weighted
 *  form drag per flow column. Lift needs ANGLE OF ATTACK — at 0° AoA this
 *  reports the POTENTIAL lift area of thin sections, not a force. */
export function scanAnalysis(t: Tunnel): ScanReport {
  const { nx, ny, nz, solid, blockage, axis } = t;
  const step = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  const lineLen = [nx, ny, nz][axis]!;
  const perp = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const nA = [nx, ny, nz][perp[0]!]!, nB = [nx, ny, nz][perp[1]!]!;
  const faceArea = t.voxel * t.voxel;
  let frontalArea = 0, dragW = 0, liftArea = 0, thinColumns = 0, columns = 0;
  for (let b = 0; b < nB; b++)
    for (let a = 0; a < nA; a++) {
      const c = [0, 0, 0];
      c[perp[0]!] = a; c[perp[1]!] = b;
      const base = (c[2]! * ny + c[1]!) * nx + c[0]!;
      // solid runs; single-cell air seams MERGE (the wiki's cavity rule)
      const runs: [number, number][] = [];
      let q = 0;
      while (q < lineLen) {
        if (!solid[base + q * step]) { q++; continue; }
        const s0 = q;
        while (q < lineLen && solid[base + q * step]) q++;
        if (q + 1 < lineLen && !solid[base + q * step] && solid[base + (q + 1) * step]) { q += 1; continue; }
        runs.push([s0, q - s0]);
      }
      if (!runs.length) continue;
      columns++;
      let frontCells = 0, thinFront = 0;
      for (const [s0, L] of runs) {
        for (let w = 0; w < L; w++) {
          if (w === 0) {
            frontCells++; if (L <= 2) thinFront++;
            // fineness-weighted form drag per unit frontal area: only the
            // FRONT cell of each run counts (the column as the air sees it)
            dragW += blockage[base + s0 * step]! * faceArea;
          }
        }
      }
      frontalArea += frontCells * faceArea;
      if (frontCells > 0 && thinFront >= 0.5 * frontCells) { thinColumns++; liftArea += thinFront * faceArea; }
    }
  return { frontalArea, dragW, dragCd: frontalArea > 0 ? dragW / frontalArea : 0,
    liftArea, thinColumns, columns };
}
