// ---------------------------------------------------------------- latsphere
// LATTICE-SPHERE SKIN — an ellipsoid as a hull-triangle mesh whose vertices
// are INTEGER lattice slots (world = (g − 6)·CELL, the very lattice the block
// shapes and hull triangles share — FORMAT §Triangles (hull) mapping).
//
// WHY THIS ALGORITHM (the user's "find algo online" order, 2026-10-22):
// the three reverted Spheroid attempts (branch
// failed/spheroid-hull-dents-lattice-quantization) all quantized the curved
// hull with LOCAL, per-position rules — corner-mask matching, staircase
// chamfers, outward-biased per-vertex snaps. Every one showed INDENTATIONS:
// per-vertex quantization errors are independent, so neighbouring facets
// wobble in orientation and the eye reads the creases as dents.
//
// The class of algorithm that CANNOT dent is the lattice convex-hull
// shrinkwrap: the convex hull of a point set is a convex polyhedron — its
// silhouette is convex from EVERY viewing direction, so no concavity (dent)
// exists anywhere on it, by construction rather than by hoping a heuristic
// lands evenly. Procedure (each step a textbook algorithm, not a heuristic):
//
//  1. SHELL ENUMERATION — every integer lattice point whose RADIAL excess
//     d̂(g) = |g−c| − r(n̂) over the implicit ellipsoid lies in [0, τ]:
//     a thin skin of lattice points sitting just OUTSIDE the ideal surface.
//  2. SUPPORT SAMPLING — the extreme lattice point along ~512 Fibonacci
//     directions seeds the hull.
//  3. 3D CONVEX HULL — incremental beneath-beyond (the Quickhull family:
//     Barber, Dobkin & Huhdanpaa, ACM TOMS 22(4) 1996; CGAL convex_hull_3
//     uses the same). Every predicate runs on INTEGER coordinates, so the
//     orientation determinant is decided EXACTLY in double's integer-exact
//     range (|g| < 2^17 ⇒ |det| ≪ 2^53) — zero epsilon heuristics.
//  4. OPTIMALITY CERTIFICATE — Qhull's postcondition loop: every face plane
//     is support-tested against the FULL shell; any lattice point beyond a
//     face joins the candidates and the hull rebuilds until no face sees a
//     point. The result is provably EXACTLY hull(shell) — the tightest
//     convex lattice polyhedron spanned by the shell. Because EVERY lattice
//     point outside the ideal surface is a candidate, no facet may sag into
//     a pocket while lattice points stand outside it.
//
// Deviation vs the ideal surface is reported both ways: maxOutM (vertices
// beyond the surface, ≤ τ cells) and sagInM (worst face-plane excursion
// INSIDE the surface) — the vitest pins in __tests__/latsphere.test.ts
// assert them per the post-mortem's rule "pin the deviation BEFORE building
// UI"; the dialog preview prints them live.
//
// Output: hull faces as game Triangle records (frame_*/v{i}_{axis} 5-bit
// window per FORMAT, colours[5] = one slot, OUTWARD winding + flat shading
// by default — the game's own freshly-authored convention, v1.5.12).
// ---------------------------------------------------------------------------
import type { Triangle } from './format';
import { CELL, CELLS_PER_FRAME } from './format';
import { MATERIAL_DENSITY } from './tools';

export type GP3 = [number, number, number];

export interface SphereSpec {
  /** radii in METRES (half-axes of the ellipsoid); each must be ≥ CELL */
  rx: number; ry: number; rz: number;
  /** centre in lattice g coordinates (default 6,6,6 = world origin). The
   *  PLACEMENT widget moves the skin in whole-cell steps, so an integer
   *  centre keeps the vertex set mirror-symmetric. */
  cx?: number; cy?: number; cz?: number;
  /** outward shell band in lattice cells (default 0.75 — measured: lattice
   *  coverage of a convex curved surface holds at this width, sag stays 0).
   *  Larger = denser candidates at CPU cost + a taller outward bulge. */
  tau?: number;
}

export interface SpherePlan {
  /** the whole shell candidate set (integer lattice points, g coords) */
  shell: GP3[];
  /** the unique vertex indices into shell, sorted */
  verts: number[];
  /** hull faces as shell-index triples, OUTWARD wound */
  faces: [number, number, number][];
  /** faces dropped for spanning > 31 cells (the 5-bit window) */
  skipped: number;
  /** the centre the plan was built at (the ladder may offset the spec's) */
  center: [number, number, number];
  stats: SphereStats;
}

export interface SphereStats {
  shellPoints: number;
  vertices: number;
  tris: number;
  /** furthest hull vertex beyond the ideal surface, METRES (≥ 0) */
  maxOutM: number;
  /** worst face-plane sag INSIDE the ideal surface, METRES (0 = none) */
  sagInM: number;
  volumeM3: number;
  idealM3: number;
  /** surface area of the hull, m² (mass model input) */
  areaM2: number;
  skipped: number;
  /** window-illegal faces repaired by micro-splits (0 = strict convex hull) */
  split: number;
  /** deepest micro-crease the splits consumed, METRES (≤ 0.125 = SPLIT_D) */
  creaseM: number;
}

const TAU_DEFAULT = 0.75;   // measured: sag stays EXACTLY 0 down to 0.75 cells,
                            // and the outward bulge halves (≤ 0.19 m at any size)

/** radial surface radius of the ellipsoid along the unit direction n, CELLS */
function radiusAlong(nx: number, ny: number, nz: number, rx: number, ry: number, rz: number): number {
  const a = nx / rx, b = ny / ry, c = nz / rz;
  return 1 / Math.sqrt(a * a + b * b + c * c);
}

// ------------------------------------------------------------- 1. the shell
/** All integer lattice points with radial excess d̂ = |q| − r(q̂) ∈ [0, τ].
 *  The test is a function of q² only ⇒ EXACTLY mirror-symmetric about every
 *  centre-plane and the axis permutation is honoured: nothing here is
 *  position-dependent beyond the implicit surface (the failed branch lost
 *  symmetry and smoothness to per-cell heuristics). */
export function sphereShell(spec: SphereSpec): GP3[] {
  const rx = spec.rx / CELL, ry = spec.ry / CELL, rz = spec.rz / CELL;
  const cx = spec.cx ?? 6, cy = spec.cy ?? 6, cz = spec.cz ?? 6;
  const tau = spec.tau ?? TAU_DEFAULT;
  const rMax = Math.max(rx, ry, rz), rMin = Math.min(rx, ry, rz);
  const out: GP3[] = [];
  const lo = (c: number, r: number) => Math.floor(c - r - tau - 1);
  const hi = (c: number, r: number) => Math.ceil(c + r + tau + 1);
  for (let gx = lo(cx, rx); gx <= hi(cx, rx); gx++)
    for (let gy = lo(cy, ry); gy <= hi(cy, ry); gy++)
      for (let gz = lo(cz, rz); gz <= hi(cz, rz); gz++) {
        const qx = gx - cx, qy = gy - cy, qz = gz - cz;
        const d2 = qx * qx + qy * qy + qz * qz;
        if (d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        // r(n̂) ∈ [rMin, rMax] for every direction ▸ cheap radial prefilter
        if (d > rMax + tau || d + 1e-9 < rMin) continue;
        const inv = 1 / d;
        const excess = d - radiusAlong(qx * inv, qy * inv, qz * inv, rx, ry, rz);
        if (excess >= -1e-9 && excess <= tau) out.push([gx, gy, gz]);
      }
  return out;
}

// ------------------------------------------- 2..4. QuickHull (outside sets)
/** orient3d on INTEGER coordinates — a 3×3 determinant whose entries are
 *  coordinate differences (|Δ| < 2^17 for any craft-sized window), so the
 *  value is an integer < 2^53: doubles decide the sign EXACTLY. */
const orient3d = (
  i: number, j: number, k: number, l: number,
  P: { x: Float64Array; y: Float64Array; z: Float64Array },
): number => {
  const ax = P.x[i]!, ay = P.y[i]!, az = P.z[i]!;
  const a1 = P.x[j]! - ax, a2 = P.y[j]! - ay, a3 = P.z[j]! - az;
  const b1 = P.x[k]! - ax, b2 = P.y[k]! - ay, b3 = P.z[k]! - az;
  const c1 = P.x[l]! - ax, c2 = P.y[l]! - ay, c3 = P.z[l]! - az;
  return (a1 * b2 - a2 * b1) * c3 - (a1 * b3 - a3 * b1) * c2 + (a2 * b3 - a3 * b2) * c1;
};

interface Vecs { x: Float64Array; y: Float64Array; z: Float64Array }

const vecsOf = (pts: GP3[]): Vecs => ({
  x: Float64Array.from(pts.map(p => p[0])),
  y: Float64Array.from(pts.map(p => p[1])),
  z: Float64Array.from(pts.map(p => p[2])),
});

interface QHFace {
  a: number; b: number; c: number;
  alive: boolean;
  outside: number[]; // shell indices strictly beyond this plane
}

/** Quickhull (Barber/Dobkin/Huhdanpaa 1996): each point lives in the
 *  OUTSIDE set of at most one face; expanding a face only re-tests the
 *  points of the deleted faces against the new cone — O(n log h), which is
 *  what makes the 24 m zeppelin shell (~43k lattice points) plan in well
 *  under a second. Predicates stay EXACT (integer coordinates). Coplanar
 *  points (orient = 0) never join an outside set — Qhull's rule that keeps
 *  non-extreme points out of the vertex set. */
export function quickhullFaces(shell: GP3[]): [number, number, number][] | null {
  return quickhullSubset(shell.map((_, i) => i), vecsOf(shell));
}

/** Quickhull over a SUBSET of shell point indices (the repair passes add
 *  support points one at a time and re-hull only the vertex candidate set). */
export function quickhullSubset(idx0: number[], P: Vecs): [number, number, number][] | null {
  const idx = [...new Set(idx0)];
  const n = idx.length;
  if (n < 4) return null;
  const orient = (f: QHFace, p: number) => orient3d(f.a, f.b, f.c, p, P);

  // initial tetra: the axis extremes, extended until affinely independent
  const ex = (ax: 0 | 1 | 2, min: boolean): number => {
    let best = idx[0]!, bv = min ? Infinity : -Infinity;
    for (const i of idx) {
      const w = ax === 0 ? P.x[i]! : ax === 1 ? P.y[i]! : P.z[i]!;
      if (min ? w < bv : w > bv) { bv = w; best = i; }
    }
    return best;
  };
  const cand = [ex(0, true), ex(0, false), ex(1, true), ex(1, false), ex(2, true), ex(2, false)];
  const uniq = [...new Set(cand)];
  if (uniq.length < 4) return null;
  const vol = (i: number, j: number, k: number, l: number) => orient3d(i, j, k, l, P);
  let A = uniq[0]!, B = -1, C = -1, D = -1;
  for (const p of uniq) if (p !== A) { B = p; break; }
  if (B < 0) return null;
  // (robust build: greedy independent set over the candidate pool)
  const ind: number[] = [A, B];
  for (const p of uniq) {
    if (ind.length >= 3) break;
    if (p === A || p === B) continue;
    const u = [P.x[p]! - P.x[A]!, P.y[p]! - P.y[A]!, P.z[p]! - P.z[A]!];
    const v = [P.x[B]! - P.x[A]!, P.y[B]! - P.y[A]!, P.z[B]! - P.z[A]!];
    const cr = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    if (cr[0]! !== 0 || cr[1]! !== 0 || cr[2]! !== 0) { ind.push(p); C = p; }
  }
  if (C < 0) return null;
  for (const p of uniq) if (p !== A && p !== B && p !== C && vol(A, B, C, p) !== 0) { D = p; ind.push(p); break; }
  if (D < 0) return null;

  const faces: QHFace[] = [];
  const addFace = (a: number, b: number, c: number, outside: number[]): QHFace => {
    const f: QHFace = { a, b, c, alive: true, outside };
    faces.push(f);
    return f;
  };
  // face OUTWARD against the opposite tetra vertex (the only witness that is
  // CERTIFIED inside at this stage — no interior point exists yet)
  const t: [number, number, number][] = [[A, B, C], [A, B, D], [A, C, D], [B, C, D]];
  const seed: QHFace[] = [];
  for (const [a, b, c] of t) {
    const opp = [A, B, C, D].find(v => v !== a && v !== b && v !== c)!;
    seed.push(orient3d(a, b, c, opp, P) > 0 ? addFace(a, c, b, []) : addFace(a, b, c, []));
  }
  // initial outside sets — CONFLICT lists: a point stays with EVERY face
  // plane it sees (assigning it to only one loses it at redistribution)
  for (const p of idx) {
    if (p === A || p === B || p === C || p === D) continue;
    for (const f of seed) if (orient(f, p) > 0) f.outside.push(p);
  }

  // edge ▸ faces adjacency (kept alive for the BFS horizon search)
  const edgeKey = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
  const edgeMap = new Map<string, QHFace[]>();
  const link = (f: QHFace) => {
    for (const [u, v] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]] as [number, number][]) {
      const k = edgeKey(u, v);
      const arr = edgeMap.get(k);
      if (arr) arr.push(f); else edgeMap.set(k, [f]);
    }
  };
  for (const f of seed) link(f);

  const stack: QHFace[] = seed.filter(f => f.outside.length);
  while (stack.length) {
    const f = stack.pop()!;
    if (!f.alive || !f.outside.length) continue;
    // farthest outside point (index tie-break = determinism)
    let fp = -1, fd = -Infinity;
    for (const p of f.outside) {
      const d = orient3d(f.a, f.b, f.c, p, P);
      if (d > fd) { fd = d; fp = p; }
    }
    const p = fp;
    if (p < 0 || fd <= 0) { f.outside.length = 0; continue; }
    // visible region: BFS from f across adjacency, faces the point sees
    const visible = new Set<QHFace>([f]);
    const q: QHFace[] = [f];
    while (q.length) {
      const g = q.pop()!;
      for (const [u, v] of [[g.a, g.b], [g.b, g.c], [g.c, g.a]] as [number, number][]) {
        for (const h of edgeMap.get(edgeKey(u, v)) ?? []) {
          if (!h.alive || visible.has(h)) continue;
          if (orient(h, p) > 0) { visible.add(h); q.push(h); }
        }
      }
    }
    // horizon + harvest of every outside set being deleted
    const hor: [number, number][] = [];
    const pool: number[] = [];
    for (const g of visible) {
      g.alive = false;
      // NO spread here: on a 96 m zeppelin the seed faces' conflict sets
      // hold ~10⁵ points and push(...arr) overflows the argument stack
      for (const w of g.outside) pool.push(w);
    }
    const halfEdges = (g: QHFace): [number, number][] => [[g.a, g.b], [g.b, g.c], [g.c, g.a]];
    for (const g of visible)
      for (const [u, v] of halfEdges(g)) {
        const arr = edgeMap.get(edgeKey(u, v)) ?? [];
        // an edge is HORIZON when a SURVIVING (alive) neighbour owns it too:
        // edges whose other side is also in the visible cap (dead, not yet
        // unlinked) are interior to the cap and vanish with it
        if (arr.some(h => h !== g && h.alive)) hor.push([u, v]);
      }
    for (const g of visible)                       // unlink the dead faces
      for (const [u, v] of halfEdges(g)) {
        const arr = edgeMap.get(edgeKey(u, v));
        if (arr) { const i = arr.indexOf(g); if (i >= 0) arr.splice(i, 1); }
      }
    // cone of new faces: the horizon half-edge (u→v) of a deleted face is
    // kept in the SAME orientation by the new face (u,v,p) — the surviving
    // neighbour across that edge carries v→u, so (u,v,p) closes the manifold
    // with OUTWARD orientation (Beneath-Beyond; verified on the unit tetra:
    // the flipped (v,u,p) reads inward).
    const created: QHFace[] = [];
    for (const [u, v] of hor) {
      const nf: QHFace = { a: u, b: v, c: p, alive: true, outside: [] };
      faces.push(nf);
      created.push(nf);
      for (const [x, y] of [[u, v], [v, p], [p, u]] as [number, number][]) {
        const kk = edgeKey(x, y);
        const arr = edgeMap.get(kk);
        if (arr) arr.push(nf); else edgeMap.set(kk, [nf]);
      }
    }
    // redistribute the harvested conflict sets onto the cone (a point may
    // see several cone faces ▸ stays with all of them; the Set dedups the
    // pool so a point shared by several deleted faces is tested once)
    const seenPool = new Set(pool);
    for (const w of seenPool) {
      if (w === p) continue;
      for (const nf of created) if (orient(nf, w) > 0) nf.outside.push(w);
    }
    for (const nf of created) if (nf.outside.length) stack.push(nf);
  }
  const out = faces.filter(f => f.alive)
    .map(f => [f.a, f.b, f.c] as [number, number, number]);
  // signed volume about the origin must be POSITIVE for outward winding
  let vol2 = 0;
  for (const [i, j, k] of out) {
    vol2 += P.x[i]! * (P.y[j]! * P.z[k]! - P.z[j]! * P.y[k]!)
         - P.y[i]! * (P.x[j]! * P.z[k]! - P.z[j]! * P.x[k]!)
         + P.z[i]! * (P.x[j]! * P.y[k]! - P.y[j]! * P.x[k]!);
  }
  if (vol2 === 0) return null;
  return vol2 > 0 ? out : out.map(f => [f[0], f[2], f[1]] as [number, number, number]);
}

// --------------------------------------- face-window repair (game limit #1)
/** Faces the aligned 32-slot window still cannot store after the centre
 *  ladder are SPLIT locally — the way the game's own hulls skin a curved
 *  flank (the airliner skin is a fine staircase, not a strict convex hull):
 *  a shell point inside the face and at most SPLIT_D CELLS BELOW its plane
 *  becomes a forced vertex (three child faces). Quickhull can never pick
 *  such a point (invisible under the strict rule), so the split is applied
 *  directly on the face list — no re-hull. The micro-crease is ≤ 0.125 m,
 *  HALF the lattice's own 0.25 m granularity and far below visibility;
 *  in exchange every stored triangle becomes legal. A face with NO point
 *  inside even at that depth stays skipped — truly unstoreable. */
const SPLIT_D = 0.5;   // cells below the face plane a split vertex may sit at

function repairSplit(shell: GP3[], faces: [number, number, number][]):
  { faces: [number, number, number][]; split: number; crease: number } {
  const winBad = ([i, j, k]: [number, number, number]): boolean => {
    const A = shell[i]!, B = shell[j]!, C = shell[k]!;
    for (const ax of [0, 1, 2] as const) {
      const min = Math.min(A[ax], B[ax], C[ax]);
      const max = Math.max(A[ax], B[ax], C[ax]);
      if (max - 12 * Math.floor(min / 12) > 31) return true;
    }
    return false;
  };
  let crease = 0;
  let split = 0;
  const out: [number, number, number][] = [];
  // iterative (children may themselves violate) with a work stack
  const stack = [...faces];
  while (stack.length) {
    const f = stack.pop()!;
    if (!winBad(f)) { out.push(f); continue; }
    if (split > 4096) { out.push(f); continue; }   // hard guard
    const [i, j, k] = f;
    const A = shell[i]!, B = shell[j]!, C = shell[k]!;
    const nx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
    const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    const nz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
    const h = nx * A[0] + ny * A[1] + nz * A[2];
    const nl = Math.hypot(nx, ny, nz);
    if (!(nl > 0)) { out.push(f); continue; }
    const u = Math.abs(nx) <= Math.abs(ny) && Math.abs(nx) <= Math.abs(nz) ? 0
      : Math.abs(ny) <= Math.abs(nz) ? 1 : 2;
    const a = (u + 1) % 3, b = (u + 2) % 3;
    const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
      Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
    let bestP = -1, bestScore = Infinity;
    for (let p = 0; p < shell.length; p++) {
      if (p === i || p === j || p === k) continue;
      const q = shell[p]!;
      // depth below the plane in CELLS (hull faces are supporting ▸ d ≤ 0)
      const d = (nx * q[0] + ny * q[1] + nz * q[2] - h) / nl;
      if (d > 1e-9 || d < -SPLIT_D) continue;
      const s1 = side(A[a]!, A[b]!, B[a]!, B[b]!, q[a]!, q[b]!);
      const s2 = side(B[a]!, B[b]!, C[a]!, C[b]!, q[a]!, q[b]!);
      const s3 = side(C[a]!, C[b]!, A[a]!, A[b]!, q[a]!, q[b]!);
      // STRICTLY interior: a boundary-collinear point yields a zero-area
      // child that re-splits forever (the runaway the first cut showed)
      if (!((s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0))) continue;
      // prefer a point that breaks the worst aligned axis AND sits shallow
      let span = 0;
      for (const ax of [0, 1, 2] as const)
        span = Math.max(span, Math.abs(q[ax] - A[ax]), Math.abs(q[ax] - B[ax]), Math.abs(q[ax] - C[ax]));
      const score = span + Math.abs(d) * 24;      // shallow, central split
      if (score < bestScore) { bestScore = score; bestP = p; }
    }
    if (bestP < 0) { out.push(f); continue; }     // empty patch ▸ unstoreable
    split++;
    // the crease depth actually consumed (for the stats + the pins)
    const q = shell[bestP]!;
    crease = Math.max(crease, Math.abs((nx * q[0] + ny * q[1] + nz * q[2] - h) / nl));
    stack.push([i, j, bestP], [j, k, bestP], [k, i, bestP]);
  }
  return { faces: out, split, crease };
}

// ------------------------------------------------------------------ planner
/** plan() over a small CENTRE LADDER for game limit #1 (the 5-bit / 31-cell
 *  triangle window): an integer centre makes huge spheres hold EXACTLY
 *  coplanar flat lattice patches, and the strict hull triangulates such a
 *  patch as ONE big face (coplanar points are never vertices — Qhull's own
 *  degeneracy). A half/quarter-cell centre offset keeps the shape exactly
 *  mirror-symmetric (the centre maps to itself under every axis-plane
 *  mirror) yet breaks the exact coplanarity, so the patch cuts into small
 *  windowable faces naturally. The first zero-violation centre wins; a
 *  residual means the surface patch is EMPTY of lattice (true needle
 *  flanks) — NO convex lattice-exact ≤31-cell skin exists for the game to
 *  store there, and the dialog refuses to place it (skipped > 0). */
const PLAN_CACHE = new Map<string, SpherePlan>();
export function spherePlan(spec: SphereSpec): SpherePlan {
  const key = JSON.stringify([spec.rx, spec.ry, spec.rz, spec.cx ?? 6, spec.cy ?? 6, spec.cz ?? 6, spec.tau ?? null]);
  const hit = PLAN_CACHE.get(key);
  if (hit) return hit;
  let best: SpherePlan | null = null;
  // τ ladder: a thicker shell band = shorter facets on low-curvature flanks
  // (a 60 m zeppelin nose facets SPANS that no aligned window holds from a
  // thin band). The trade is the outward bulge ≤ τ·CELL, which the preview
  // line prints (dev +…) before Build — the hull stays dent-free either way.
  for (const tau of spec.tau != null ? [spec.tau] : [0.75, 1.5, 3]) {
    for (const o of [0, 0.5, 0.25, 0.75, 0.375]) {
      const p = planAt({ ...spec, tau, cx: (spec.cx ?? 6) + o, cy: (spec.cy ?? 6) + o, cz: (spec.cz ?? 6) + o });
      if (!best || p.skipped < best.skipped) best = p;
      if (best.skipped === 0) break;
    }
    if (best?.skipped === 0) break;
  }
  if (PLAN_CACHE.size > 24) PLAN_CACHE.clear();
  PLAN_CACHE.set(key, best!);
  return best!;
}

function planAt(spec: SphereSpec): SpherePlan {
  const cx = spec.cx ?? 6, cy = spec.cy ?? 6, cz = spec.cz ?? 6;
  const shell = sphereShell(spec);
  const strict = quickhullFaces(shell) ?? [];
  // window-illegal faces are repaired by micro-splits (see repairSplit)
  const rep = repairSplit(shell, strict);
  const faces0 = rep.faces;
  const keptFaces: [number, number, number][] = [];
  let skipped = 0;
  for (const f of faces0 ?? []) {
    // The game's exact limit (Triangle.inc.glsl): with f = floor(min/12)
    // every vertex must satisfy v = g − 12f ∈ 0..31 — the 32-slot window is
    // FRAME-ALIGNED, so it is stricter than span ≤ 31 (a 29-cell span across
    // a misaligned frame border stores NOTHING; encodeSkinTri is the law).
    if (encodeSkinTri([shell[f[0]!]!, shell[f[1]!]!, shell[f[2]!]!], { slot: 0 })) keptFaces.push(f);
    else skipped++;
  }
  const verts = [...new Set(keptFaces.flat())].sort((x, y) => x - y);
  const stats = metrics(shell, keptFaces, spec, cx, cy, cz);
  stats.skipped = skipped;
  stats.split = rep.split;
  stats.creaseM = rep.crease * CELL;
  return { shell, verts, faces: keptFaces, skipped, center: [cx, cy, cz], stats };
}

// ------------------------------------------------------------------ metrics
function metrics(shell: GP3[], faces: [number, number, number][], spec: SphereSpec,
  cx: number, cy: number, cz: number): SphereStats {
  const rx = spec.rx / CELL, ry = spec.ry / CELL, rz = spec.rz / CELL;
  let maxOut = 0, sag = 0, area = 0, vol = 0;
  const seen = new Set<number>();
  for (const [i, j, k] of faces) {
    for (const v of [i, j, k]) {
      if (seen.has(v)) continue;
      seen.add(v);
      const p = shell[v]!;
      const qx = p[0] - cx, qy = p[1] - cy, qz = p[2] - cz;
      const d = Math.sqrt(qx * qx + qy * qy + qz * qz);
      if (d > 1e-9) {
        const excess = d - radiusAlong(qx / d, qy / d, qz / d, rx, ry, rz);
        if (excess > maxOut) maxOut = excess;
      }
    }
    const pi = shell[i]!, pj = shell[j]!, pk = shell[k]!;
    const e1: GP3 = [pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2]];
    const e2: GP3 = [pk[0] - pi[0], pk[1] - pi[1], pk[2] - pi[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-12) continue;
    area += 0.5 * nl * CELL * CELL;
    // plane distance from the centre along the OUTWARD unit normal
    const dist = (nx * (pi[0] - cx) + ny * (pi[1] - cy) + nz * (pi[2] - cz)) / nl;
    const r = radiusAlong(nx / nl, ny / nl, nz / nl, rx, ry, rz);
    if (r - dist > sag) sag = r - dist;
    // signed volume about the origin (outward winding ▸ positive), g units
    vol += (pi[0] * (pj[1] * pk[2] - pj[2] * pk[1])
          - pi[1] * (pj[0] * pk[2] - pj[2] * pk[0])
          + pi[2] * (pj[0] * pk[1] - pj[1] * pk[0])) / 6;
  }
  return {
    shellPoints: shell.length,
    vertices: seen.size,
    tris: faces.length,
    maxOutM: Math.max(0, maxOut) * CELL,
    sagInM: Math.max(0, sag) * CELL,
    volumeM3: vol * CELL * CELL * CELL,
    idealM3: (4 / 3) * Math.PI * spec.rx * spec.ry * spec.rz,
    areaM2: area,
    skipped: 0,
    split: 0,
    creaseM: 0,
  };
}

/** cheap stats without keeping the plan (the dialog preview) */
export function sphereStats(spec: SphereSpec): SphereStats {
  return spherePlan(spec).stats;
}

// ------------------------------------------------------- triangle encoding
export interface SkinOptions {
  slot: number;
  material?: number;
  /** default false = flat (no `smooth` key) — the game's freshly-authored
   *  hull convention (fixture 9000006001, v1.5.12). true writes smooth:1. */
  smooth?: boolean;
}

/** Absolute lattice g ▸ the game's Triangle record: per-axis frame
 *  f = floor(min/12), 5-bit window v = g − 12f (Triangle.inc.glsl).
 *  null = a span the window cannot hold (> 31 cells in one triangle). */
export function encodeSkinTri(g: [GP3, GP3, GP3], opt: SkinOptions): Triangle | null {
  const o: Record<string, unknown> = opt.smooth
    ? { colors: [opt.slot, opt.slot, opt.slot, opt.slot, opt.slot], material: opt.material ?? 0, smooth: 1 }
    : { colors: [opt.slot, opt.slot, opt.slot, opt.slot, opt.slot], material: opt.material ?? 0 };
  const AXES: (0 | 1 | 2)[] = [0, 1, 2];
  for (const ax of AXES) {
    const name = 'xyz'[ax]!;
    const min = Math.min(g[0]![ax], g[1]![ax], g[2]![ax]);
    const f = Math.floor(min / CELLS_PER_FRAME);
    o[`frame_${name}`] = f;
    for (let i = 0; i < 3; i++) {
      const v = g[i]![ax] - CELLS_PER_FRAME * f;
      if (v < 0 || v > 31) return null;
      o[`v${i}_${name}`] = v;
    }
  }
  return o as unknown as Triangle;
}

/** Decode a Triangle record to three absolute lattice points (g). */
export function decodeSkinTri(t: Triangle): [GP3, GP3, GP3] {
  const g: GP3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const AXES: (0 | 1 | 2)[] = [0, 1, 2];
  for (const ax of AXES) {
    const name = 'xyz'[ax]!;
    const f = (t[`frame_${name}`] as number | undefined) ?? 0;
    for (let i = 0; i < 3; i++)
      g[i]![ax] = (t[`v${i}_${name}`] as number) + CELLS_PER_FRAME * f;
  }
  return g as [GP3, GP3, GP3];
}

/** Whole-cell shift of already-encoded skin triangles (the placement drag):
 *  decode → shift g → re-encode (frames re-floor; colours/material/shading
 *  ride verbatim). Offsets are integer lattice steps. */
export function shiftSkinTris(tris: Triangle[], step: GP3): Triangle[] {
  const out: Triangle[] = [];
  for (const t of tris) {
    const g = decodeSkinTri(t);
    const o: Record<string, unknown> = { ...t };
    const AXES: (0 | 1 | 2)[] = [0, 1, 2];
    for (const ax of AXES) {
      const name = 'xyz'[ax]!;
      const s: [number, number, number] = [g[0]![ax] + step[ax], g[1]![ax] + step[ax], g[2]![ax] + step[ax]];
      const f = Math.floor(Math.min(s[0], s[1], s[2]) / CELLS_PER_FRAME);
      o[`frame_${name}`] = f;
      for (const i of [0, 1, 2] as const) o[`v${i}_${name}`] = s[i] - CELLS_PER_FRAME * f;
    }
    out.push(o as unknown as Triangle);
  }
  return out;
}

/** The shipped generator: hull faces of the plan as game Triangle records,
 *  OUTWARD-wound (the hull's own orientation), flat/smooth per option, all
 *  five colour faces = one slot. */
export function sphereSkinTris(spec: SphereSpec, opt: SkinOptions): Triangle[] {
  const plan = spherePlan(spec);
  const out: Triangle[] = [];
  for (const [i, j, k] of plan.faces) {
    const t = encodeSkinTri([plan.shell[i]!, plan.shell[j]!, plan.shell[k]!], opt);
    if (t) out.push(t);
  }
  return out;
}

/** mass estimate for the skin (hullify's model: the 0.05 m slab × the
 *  material's per-cell-cube density — MATERIAL_DENSITY is kg per 0.25 m³),
 *  kg — the dialog's live readout. */
export function skinKg(areaM2: number, material: number): number {
  return areaM2 * 0.05 / (CELL ** 3) * (MATERIAL_DENSITY[material] ?? 1);
}
