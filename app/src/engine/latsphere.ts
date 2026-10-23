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
  /** v1.7.2 SIMPLIFIED BODY (user: "Geometry for sphere can be too complex…
   *  when making sphere pointy, I want it to be simplified, so a cylinder on
   *  the sides and slightly pointier nose"): 'cylinder' LOFTS integer lattice
   *  cross-section rings along the LONGEST axis — flat cylindrical flanks
   *  (few big facets, no length-dependent refinement, no window refusals at
   *  needle aspect ratios where the ellipsoid hull cannot store) — capped by
   *  ellipsoidal noses that taper to a lattice-vertex point. The body stays
   *  convex (flat flank + concave elliptic arc = concave profile ⇒ convex
   *  silhouette), so the dent-free property carries over. Default ellipsoid. */
  profile?: 'ellipsoid' | 'cylinder';
  /** cylinder profile: fraction of the half-length that stays cylindrical
   *  (default 0.6; the rest tapers to the tip — smaller = pointier nose).
   *  Sets BOTH ends unless noseShoulder/tailShoulder refine them. */
  shoulder?: number;
  /** v1.7.3 per-end taper (user: "nose and tail are two different things imo,
   *  the current value is good for tail"): shoulder fraction at the NOSE end
   *  (the −longest-axis end — the aircraft's −z nose for a z-longest
   *  zeppelin; the ghost's ⟲ turns aim it) and at the TAIL (+) end. Omitted
   *  side falls back to `shoulder`, so a v1.7.2 symmetric spec is unchanged. */
  noseShoulder?: number;
  tailShoulder?: number;
  /** cylinder profile: support directions per ring (0/undefined = 'fine'
   *  = 48, still sub-cell accurate at zeppelin radii; 12 = 'simple',
   *  8 = 'blocky'). Fewer directions = fewer, larger facets; vertices stay
   *  lattice points (each ring vertex is a lattice point of the ideal
   *  cross-section), so coarsening can never add a bulge. */
  facets?: number;
  /** v1.9 BALLOON TAIL (balloonfin.ts): truncate the loft at this LAU-axis
   *  lattice level — rings beyond the cut (including the tail apex) are NOT
   *  emitted, leaving an OPEN ring boundary there. The balloon tool closes
   *  it with the fin-sleeve + tail cap, which share the cut ring's exact
   *  vertices, so the outer surface stays continuous ("a contiguous area
   *  that connects where the tail can sit — flush with the end of the tail
   *  section of the cone"). Undefined = the full closed body, byte-identical
   *  to every pre-v1.9 plan. */
  tailCutG?: number;
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

// ------------------------------------------------ the SIMPLE body (v1.7.2)
/** cylinder flanks + ellipsoidal pointed noses about the LONGEST axis, the
 *  'cylinder' profile of the dialog (user: "a cylinder on the sides and
 *  slightly pointier nose"). All in CELLS about the centre. The body is the
 *  union of the cylinder (−sT·L ≤ axial ≤ +sN·L) and two full ellipsoids of
 *  semi-axes (r1, r2, (1−s_end)·L) centred at the shoulder planes — the
 *  union is convex (concave ρ(axial) profile on BOTH ends) and its back
 *  halves hide inside the cylinder. v1.7.3: the two ends taper
 *  INDEPENDENTLY (nose = the − axial end, tail = +; user: "nose and tail
 *  are two different things imo").
 *  v1.9: EXPORTED — balloonfin.ts reads the same body law to place the tail
 *  sleeve, the fins, the hinges and the "inside the envelope" cable checks. */
export interface SimpleBody { la: 0 | 1 | 2; r1: number; r2: number; L: number; sN: number; sT: number }

const clampShoulder = (v: number | undefined, fb: number | undefined): number =>
  Math.min(0.9, Math.max(0.1, v ?? fb ?? 0.6));

export function simpleBody(spec: SphereSpec): SimpleBody {
  const r = [spec.rx / CELL, spec.ry / CELL, spec.rz / CELL];
  const la: 0 | 1 | 2 = r[0]! >= r[1]! && r[0]! >= r[2]! ? 0 : r[1]! >= r[2]! ? 1 : 2;
  const per = ([0, 1, 2] as const).filter(a => a !== la);
  return {
    la, r1: r[per[0]!]!, r2: r[per[1]!]!, L: r[la]!,
    sN: clampShoulder(spec.noseShoulder, spec.shoulder),
    sT: clampShoulder(spec.tailShoulder, spec.noseShoulder ?? spec.shoulder),
  };
}

const perpAxes = (la: 0 | 1 | 2): [number, number] =>
  [0, 1, 2].filter(a => a !== la) as [number, number];

/** ray-exit distance of the simple body along the UNIT direction n, CELLS:
 *  min(flank exit, shoulder plane) with the nose-ellipsoid root splicing on
 *  whenever its near interval touches the cylinder's covered segment. */
function bodyRadius(b: SimpleBody, n: [number, number, number]): number {
  const [p1, p2] = perpAxes(b.la);
  const nA = n[b.la]!, n1 = n[p1]!, n2 = n[p2]!;
  const en2 = (n1 / b.r1) ** 2 + (n2 / b.r2) ** 2;
  // v1.7.3: the ray leaves through the shoulder/nose of ITS OWN side
  const sL = (nA >= 0 ? b.sT : b.sN) * b.L, nl = b.L - sL;
  const tFlank = en2 > 1e-18 ? 1 / Math.sqrt(en2) : Infinity;
  const tShoulder = Math.abs(nA) > 1e-12 ? sL / Math.abs(nA) : Infinity;
  let R = Math.min(tFlank, tShoulder);
  if (nl > 1e-9) {
    const A = en2 + (nA / nl) ** 2;
    const B = -2 * Math.abs(nA) * sL / (nl * nl);
    const C = (sL * sL) / (nl * nl) - 1;
    const disc = B * B - 4 * A * C;
    if (disc >= 0) {
      const t1 = (-B - Math.sqrt(disc)) / (2 * A);
      const t2 = (-B + Math.sqrt(disc)) / (2 * A);
      if (t2 > 0 && t1 <= R + 1e-9) R = Math.max(R, t2);
    }
  }
  return R;
}

/** ring radius scale f(dz) of the simple body at axial offset dz (cells):
 *  1 through the flanks, the ellipse arc through the tapered end, 0 at/beyond
 *  L. dz < 0 is the NOSE side, dz > 0 the TAIL side (v1.7.3). EXPORTED v1.9
 *  for balloonfin.ts (sleeve root radius + the inside-envelope test). */
export function profileScale(b: SimpleBody, dz: number): number {
  const a = Math.abs(dz), sL = (dz >= 0 ? b.sT : b.sN) * b.L, nl = b.L - sL;
  if (a <= sL) return 1;
  if (a >= b.L) return 0;
  const t = (a - sL) / nl;
  return Math.sqrt(Math.max(0, 1 - t * t));
}

/** exact enclosed volume of the simple body, CELLS³ (cylinder between the
 *  two shoulder planes + the two end semi-ellipsoids, per-side v1.7.3) */
function bodyVolume(b: SimpleBody): number {
  const nlN = b.L - b.sN * b.L, nlT = b.L - b.sT * b.L;
  return Math.PI * b.r1 * b.r2 * ((b.sN + b.sT) * b.L + (2 / 3) * (nlN + nlT));
}

/** convex hull of 2D integer points (Andrew's monotone chain), CCW, no
 *  collinear interior vertices — the cross-section ring of the loft. */
function hull2d(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const p = [...pts].sort((a, c) => a[0]! - c[0]! || a[1]! - c[1]!);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const half = (arr: [number, number][]) => {
    const h: [number, number][] = [];
    for (const q of arr) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    return h;
  };
  const up = half(p), down = half([...p].reverse());
  up.pop(); down.pop();
  return up.concat(down);
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
 *  store there, and the dialog refuses to place it (skipped > 0).
 *  The SIMPLIFIED body (profile 'cylinder', v1.7.2 — user: "a cylinder on
 *  the sides and slightly pointier nose") takes the LOFT path below: the
 *  flank is sliced DELIBERATELY, so the ladder's coplanarity problem never
 *  arises and needles store fine. */
const PLAN_CACHE = new Map<string, SpherePlan>();
export function spherePlan(spec: SphereSpec): SpherePlan {
  const key = JSON.stringify([spec.rx, spec.ry, spec.rz, spec.cx ?? 6, spec.cy ?? 6, spec.cz ?? 6,
    spec.tau ?? null, spec.profile ?? null, spec.shoulder ?? null,
    spec.noseShoulder ?? null, spec.tailShoulder ?? null, spec.facets ?? null]);
  const hit = PLAN_CACHE.get(key);
  if (hit) return hit;
  const best = spec.profile === 'cylinder' ? planLoft(spec) : planEllipsoid(spec);
  if (PLAN_CACHE.size > 24) PLAN_CACHE.clear();
  PLAN_CACHE.set(key, best);
  return best;
}

function planEllipsoid(spec: SphereSpec): SpherePlan {
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
  return best!;
}

// ------------------------------------------------- the LOFT (simple body)
/** The v1.7.2 simple-body surface: integer cross-section RINGS lofted along
 *  the long axis. Structure, not search: every ring is the convex hull of
 *  the lattice points inside the ideal cross-section at that level (scales
 *  grow toward the middle, and a bigger cross-section contains every lattice
 *  point of the smaller one, so the rings nest); the two END levels are
 *  forced to a single lattice apex on the axis (the "pointy nose"), and a
 *  slab's side surface is the convex hull of its two rings with the interior
 *  section caps dropped. A hull face never uses a DIAGONAL of its ring (a
 *  plane through one would cut the nested ring off its supporting side), so
 *  every side face meets a ring plane along a full RING EDGE — the strips
 *  stitch into a CLOSED manifold across the shared rings. Every triangle
 *  spans two consecutive levels, and with the level gap ≤ LOFT_GAP the
 *  31-cell window is held BY CONSTRUCTION: exactly the flank slicing the
 *  ellipsoid hull cannot do on a needle. Levels whose ring degenerates to
 *  < 3 points (a ≤ 1-cell-thin tip sliver) are dropped — the neighbours
 *  stitch across them within about one gap. */
const LOFT_GAP = 20;   // axial cells between rings: the worst 12-frame
                       // residue (11) + span 20 = 31 keeps EVERY strip
                       // face inside the frame-aligned 31-cell window
const LOFT_DIRS = 48;  // 'fine' support directions (spec.facets overrides)

interface LoftRing {
  z: number;
  slots: [number, number][];              // support point per direction k
  chains: [number, number][][];           // per direction pair k→k+1: the full
                                          // boundary chain, lattice-subdivided
                                          // so NO segment exceeds 9 cells
}

/** CYCLIC perpendicular axes: p1 × p2 = +ê_la — the ring plane's CCW sense
 *  the strip's outward winding derives from. */
const loftPerp = (la: 0 | 1 | 2): [number, number] => [(la + 1) % 3, (la + 2) % 3];

/** Ring-table cache key: identical cross-section ⇒ identical table (planLoft
 *  shares flank levels; balloonfin re-reads the cut ring). */
export type LoftRingCache = Map<string, { slots: [number, number][]; chains: [number, number][][] } | null>;

/** The loft cross-section ring at profile scale f — EXPORTED so balloonfin
 *  gets the EXACT ring table the loft itself uses at the tail cut (shared
 *  vertices are what make the sleeve contiguous with the cone). Same law as
 *  the pre-v1.9 planLoft closure, moved verbatim to module scope:
 *  N support directions; per direction the extreme lattice point of the
 *  ideal cross-section's lattice hull (mirror-equivariant ties, v1.7.4),
 *  then the chain subdivision so no chain segment exceeds 9 cells.
 *  null = the cross-section is a ≤ 1-cell-thin sliver (no ring). */
export function loftRingTable(
  body: SimpleBody, c1: number, c2: number, f: number, nd: number,
  cache?: LoftRingCache,
): { slots: [number, number][]; chains: [number, number][][] } | null {
  const key = `${body.r1.toFixed(6)},${body.r2.toFixed(6)},${c1},${c2},${f.toFixed(9)},${nd}`;
  const hit = cache?.get(key);
  if (hit !== undefined) return hit;
  const dirs: [number, number][] = [];
  for (let k = 0; k < nd; k++) {
    const th = 2 * Math.PI * k / nd;
    dirs.push([Math.cos(th), Math.sin(th)]);
  }
  const a1 = body.r1 * f, a2 = body.r2 * f;
  const scan: [number, number][] = [];
  for (let u = Math.floor(c1 - a1); u <= Math.ceil(c1 + a1); u++)
    for (let v = Math.floor(c2 - a2); v <= Math.ceil(c2 + a2); v++)
      if (((u - c1) / a1) ** 2 + ((v - c2) / a2) ** 2 <= 1) scan.push([u, v]);
  if (hull2d(scan).length < 3) { cache?.set(key, null); return null; }   // ≤ 1-cell-thin sliver
  // MIRROR-SYMMETRIC slot pick (v1.7.4, user: "the zeppelin… not fully
  // symmetrical"): the old monotone WALK advanced to the LAST maximizer on a
  // flat plateau edge — a walk-order-dependent tie-break the mirrored ring
  // resolved the OPPOSITE way, so port/starboard got different facet lines.
  // Per direction: argmax of the support score, ties broken by (1) distance
  // to the CONTINUOUS ideal-ellipse support point (mirror-equivariant), then
  // (2)(3) the mirror-INVARIANT |u|,|v| (picks the plateau MIDPOINT on
  // self-mirror directions). Slots remain cyclically monotone (support
  // maximizers of a convex set are).
  const slots: [number, number][] = [];
  for (let k = 0; k < nd; k++) {
    const [dx, dy] = dirs[k]!;
    let best = -Infinity;
    for (const q of scan) {
      const sc = q[0] * dx + q[1] * dy;
      if (sc > best) best = sc;
    }
    const den = Math.hypot(a1 * dx, a2 * dy) || 1;
    const sx = c1 + (a1 * a1 * dx) / den, sy = c2 + (a2 * a2 * dy) / den;
    let bi = -1, bd = 0, bu = 0, bv = 0;
    for (let i = 0; i < scan.length; i++) {
      const q = scan[i]!;
      if (q[0] * dx + q[1] * dy < best - 1e-9) continue;
      const du = q[0] - sx, dv = q[1] - sy;
      const d2 = du * du + dv * dv, au = Math.abs(q[0] - c1), av = Math.abs(q[1] - c2);
      if (bi < 0 || d2 < bd - 1e-9
        || (Math.abs(d2 - bd) <= 1e-9 && (au < bu - 1e-9
        || (Math.abs(au - bu) <= 1e-9 && av < bv - 1e-9)))) { bi = i; bd = d2; bu = au; bv = av; }
    }
    slots.push(scan[bi]!);
  }
  // Chains: the digital ellipse has AXIS-ALIGNED PLATEAU edges ~2√(2r) cells
  // wide — a 96 m cross-section runs 28-cell single edges, and any strip face
  // spanning one breaks the 31-cell window no axial slicing can fix (the
  // exact cause of the giant-zeppelin refusals). Subdivide every slot→slot
  // segment into ≤ 9-cell lattice steps: a merge-walked strip face then spans
  // ≤ 9+9 along the chain + the radial step perpendicular — the window holds
  // by construction, and the repair loop keeps shrinking the radial part.
  // Segments are lattice (rounded), chords are inside the convex
  // cross-section, so nothing bulges. v1.7.4: the rounding ties (exact .5)
  // fall AWAY from the chain midpoint — Math.round's .5 bias is NOT
  // odd-symmetric, and the old +0.5 tie made the mirrored ring's chains
  // differ from the port side by a cell (visible facet asymmetry).
  const rt = (x: number, mid: number): number => {
    const fl = Math.floor(x);
    if (Math.abs(x - fl - 0.5) < 1e-9) return x > mid ? fl + 1 : fl;   // tie: away from midpoint
    return Math.round(x);
  };
  const chains: [number, number][][] = [];
  for (let k = 0; k < slots.length; k++) {
    const s = slots[k]!, t = slots[(k + 1) % slots.length]!;
    const du = t[0]! - s[0]!, dv = t[1]! - s[1]!;
    const segs = Math.max(1, Math.ceil(Math.max(Math.abs(du), Math.abs(dv)) / 9));
    const ch: [number, number][] = [];
    if (segs === 1) { ch.push(s, t); chains.push(ch); continue; }
    const mx = s[0]! + du / 2, my = s[1]! + dv / 2;
    for (let i = 0; i < segs; i++)
      ch.push([rt(s[0]! + du * i / segs, mx), rt(s[1]! + dv * i / segs, my)]);
    ch.push(t);
    chains.push(ch);
  }
  const out = { slots, chains };
  cache?.set(key, out);
  return out;
}

/** The loft's sorted lattice LEVELS (lattice coords on the la axis) for a
 *  body centred at c — exported v1.9: balloonfin picks the tail cut FROM
 *  this list, so the cut is guaranteed to be a real loft level and the
 *  sleeve can share the cut ring vertex-for-vertex. Same split law the
 *  pre-v1.9 planLoft closure used, moved verbatim to module scope. */
export function loftZLevels(body: SimpleBody, c: GP3): number[] {
  const cA = c[body.la]!;
  const lo = Math.ceil(cA - body.L), hi = Math.floor(cA + body.L);
  const levels = new Set<number>();
  const addSplit = (a: number, b: number) => {
    const steps = Math.max(1, Math.ceil((b - a) / LOFT_GAP));
    for (let k = 0; k <= steps; k++) levels.add(Math.round(a + (b - a) * k / steps));
  };
  if (hi > lo) {
    const clamp = (z: number) => Math.min(hi - 1, Math.max(lo + 1, z));
    const loSh = clamp(Math.round(cA - body.sN * body.L)), hiSh = clamp(Math.round(cA + body.sT * body.L));
    if (hiSh > loSh) { addSplit(loSh, hiSh); addSplit(lo, loSh); addSplit(hiSh, hi); }
    else { const m = Math.round((lo + hi) / 2); addSplit(lo, m); addSplit(m, hi); }
  }
  return [...levels].sort((a, b) => a - b);
}

function planLoft(spec: SphereSpec): SpherePlan {
  const body = simpleBody(spec);
  const c: [number, number, number] = [spec.cx ?? 6, spec.cy ?? 6, spec.cz ?? 6];
  const [p1, p2] = loftPerp(body.la);
  const cA = c[body.la]!, c1 = c[p1]!, c2 = c[p2]!;
  const lo = Math.ceil(cA - body.L), hi = Math.floor(cA + body.L);
  const pts: GP3[] = [];
  const idxOf = new Map<string, number>();
  const gid = (z: number, u: number, v: number): [number, number, number] => {
    const g: [number, number, number] = [0, 0, 0];
    g[body.la] = z; g[p1] = u; g[p2] = v;
    return g;
  };
  const gpt = (g: [number, number, number]): number => {
    const k = `${g[0]},${g[1]},${g[2]}`;
    let i = idxOf.get(k);
    if (i === undefined) { i = pts.length; idxOf.set(k, i); pts.push(g); }
    return i;
  };
  // ---- levels: apexes at lo/hi, the SHOULDER rings kept as real levels,
  // the flanks and each tapered end split into ≤ LOFT_GAP slices (an axial
  // span no triangle may exceed). For an integral centre (the only centre
  // the placement flow uses) with EQUAL end tapers the split is mirror-
  // symmetric about the mid-plane; v1.7.3 asymmetric ends split each side
  // on its own geometry (still legal — the gap rule is per-slab).
  const zlevels = loftZLevels(body, c);
  // v1.9 BALLOON TAIL (balloonfin.ts): with tailCutG the loft STOPS at that
  // lattice level — the tail apex and every ring beyond it are not emitted,
  // the shell is left OPEN at the cut ring, and the balloon tool closes it
  // with the fin sleeve + tail cap built from the cut ring's EXACT vertices
  // (contiguity = shared vertices, not coincident ones). Undefined ⇒ the
  // full closed body, byte-identical to every pre-v1.9 plan.
  const cut = spec.tailCutG;
  const keptZ = (() => {
    if (cut == null) return zlevels;
    const kept = zlevels.filter(z => z <= cut);
    // the cut ring itself becomes a REAL level (the loft's split grid may
    // not have one inside a short tail taper — balloonfin picks the cut for
    // the sleeve root, and the root must sit on a ring the loft emits)
    if (kept.length && kept[kept.length - 1] !== cut && cut < zlevels[zlevels.length - 1]!) kept.push(cut);
    return kept;
  })();
  // ---- rings: N support directions, shared by EVERY level. Each ring
  // stores, per direction, its extreme lattice point of the ideal cross-
  // section's lattice hull in that direction (ties advance to the LAST
  // maximiser, so the slot sequence walks the hull cyclically and can
  // never jitter backwards). Two slots that repeat a point mark a flat
  // flank patch — the strip pass turns those into single triangles, so
  // coplanar degeneracy (what a strict convex hull drops into HOLES)
  // cannot occur. Consecutive ring edges therefore coincide EXACTLY at
  // the shared level: the strips stitch into a closed manifold.
  // Direction count: the user's knob ('fine' = 48, 'simple' = 12,
  // 'blocky' = 8) — legality does NOT depend on it (the chain subdivision
  // caps every strip segment at 9 cells), so a coarse body just trades
  // roundness for triangle count, honestly printed in the dev line.
  const nd = spec.facets && spec.facets >= 3 ? spec.facets : LOFT_DIRS;
  const ringCache: LoftRingCache = new Map();
  const ringsAt = (f: number) => loftRingTable(body, c1, c2, f, nd, ringCache);
  const rings: LoftRing[] = [];
  const apexRing = (z: number): LoftRing => {
    const apex: [number, number] = [Math.round(c1), Math.round(c2)];
    const slots = Array.from({ length: nd }, () => apex);
    return { z, slots, chains: slots.map(s => [s, s]) };   // lattice apex
  };
  const bodyRing = (z: number): LoftRing | null => {
    const f = profileScale(body, z - cA);
    if (f <= 0) return null;
    const built = ringsAt(f);
    if (!built) return null;
    return { z, slots: built.slots, chains: built.chains };
  };
  keptZ.forEach((z, k) => {
    // v1.9: the apex rings belong to the TRUE ends only — with tailCutG the
    // last kept level is the cut ring, a BODY ring (the pre-v1.9 "first/last
    // level is an apex" rule held because lo/hi were always the ends).
    if ((k === 0 && z === lo) || (k === keptZ.length - 1 && z === hi)) { rings.push(apexRing(z)); return; }
    const r = bodyRing(z);
    if (r) rings.push(r);
  });
  const isApexRing = (r: LoftRing) =>
    r.slots.every(q => q[0] === r.slots[0]![0] && q[1] === r.slots[0]![1]);
  // TIP RING: an apex triangle spans from the axis to the ring it reaches,
  // and a big nose tapers INSIDE the last axial slice — a 96 m zeppelin has
  // NO split-grid ring thinner than 95 cells, and the ring one cell off a
  // 12 m nose tip is still 39 wide. Grow a fitting one: the profile crosses
  // the 20-cell fit radius at dz = sL + nl·√(1−(20/r)²), and a ring there
  // (slot span ≤ 20) always shares one aligned window with the apex.
  // PRUNING fat rings instead is wrong — they stitch the body; only the
  // ring the apex cone touches must fit (the first cut pruned and ate the
  // whole nose to triangles=0). Anything strictly between apex and tip is
  // dropped; the fat rings beyond stitch on normally.
  for (const end of [0, 1] as const) {
    // v1.9: with tailCutG the TAIL end ring is a body ring, not an apex —
    // there is nothing to fit there (the sleeve + cap close the tail).
    if (!(end === 0 ? rings[0] : rings[rings.length - 1])
      || !isApexRing((end === 0 ? rings[0] : rings[rings.length - 1])!)) continue;
    const apexZ = end === 0 ? rings[0]!.z : rings[rings.length - 1]!.z;
    const rMax = Math.max(body.r1, body.r2);
    const sEnd = end === 0 ? body.sN : body.sT;   // v1.7.3: each end its own taper
    const nl = body.L - sEnd * body.L;
    const fit = 19;   // + lattice rounding stays inside the 31-cell window
    const dzFit = rMax <= fit ? sEnd * body.L
      : sEnd * body.L + nl * Math.sqrt(Math.max(0, 1 - (fit / rMax) ** 2));
    const sign = end === 0 ? -1 : 1;
    let zf = Math.round(cA + sign * Math.min(dzFit, body.L - 0.5));
    if ((zf - apexZ) * sign >= 0) zf = apexZ + sign;   // strictly inside
    const between = (q: LoftRing) => (q.z - apexZ) * sign > 0 && (q.z - zf) * sign < 0;
    for (let i = rings.length - 1; i >= 0; i--)
      if (between(rings[i]!)) rings.splice(i, 1);
    if (!rings.some(q => q.z === zf)) {
      const tip = bodyRing(zf);
      if (tip) rings.splice(end === 0 ? 1 : rings.length - 1, 0, tip);
    }
  }
  // ---- strip builder + window REPAIR: faces the frame-aligned 31-cell
  // window still refuses (a long tip cone, a steep nose step, a coarse
  // facet on a huge ring) SPLIT their slab — one extra ring at the mid
  // level — and the WHOLE surface re-stitches. Every round strictly halves
  // the offending axial spans; a slab that cannot split further keeps its
  // faces dropped and counts them as skipped (the dialog refuses honestly).
  // Winding: rings walk CCW in the (p1,p2)-plane with p1 × p2 = +ê_la and
  // B sits at +la from A, so (a0,a1,b1) and (a0,b1,b0) face OUTWARD
  // (e × ê_la = outward radial), and the cone triangles (a0,b1,b0) /
  // (a0,a1,b1) of a degenerated side likewise (verified on the circle).
  let faces: [number, number, number][] = [];
  let droppedSlabs = new Set<number>();
  let droppedFaces = 0;
  for (let round = 0; ; round++) {
    faces = [];
    droppedSlabs = new Set<number>();
    droppedFaces = 0;
    const push = (f: [number, number, number], slab: number) => {
      if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) return;   // collapsed
      if (encodeSkinTri([pts[f[0]!]!, pts[f[1]!]!, pts[f[2]!]!], { slot: 0 })) faces.push(f);
      else { droppedSlabs.add(slab); droppedFaces++; }
    };
    for (let k = 0; k + 1 < rings.length; k++) {
      const A = rings[k]!, B = rings[k + 1]!;
      for (let d = 0; d < nd; d++) {
        // merge-walk the two chains: advance whichever chain's next vertex
        // comes first along the pair direction (ties → A). Emission forms
        // (aᵢ, aᵢ₊₁, bⱼ) / (aᵢ, bⱼ₊₁, bⱼ) are outward for a CCW ring with B
        // at +la (verified against the prism AND taper quads), share the
        // walk diagonal pairwise, and leave every chain edge used exactly
        // once per side — the strips stitch into a closed manifold.
        const ca = A.chains[d]!, cb = B.chains[d]!;
        const ddx = (ca[ca.length - 1]![0]! - ca[0]![0]!) + (cb[cb.length - 1]![0]! - cb[0]![0]!);
        const ddy = (ca[ca.length - 1]![1]! - ca[0]![1]!) + (cb[cb.length - 1]![1]! - cb[0]![1]!);
        const dl = Math.hypot(ddx, ddy);
        const ux = dl > 1e-9 ? ddx / dl : 1, uy = dl > 1e-9 ? ddy / dl : 0;
        const ga = ca.map(q => gpt(gid(A.z, q[0]!, q[1]!)));
        const gb = cb.map(q => gpt(gid(B.z, q[0]!, q[1]!)));
        const pa = ca.map(q => q[0]! * ux + q[1]! * uy);
        const pb = cb.map(q => q[0]! * ux + q[1]! * uy);
        const P = ca.length - 1, Q = cb.length - 1;
        let i = 0, j = 0;
        while (i < P || j < Q) {
          if (j >= Q || (i < P && pa[i + 1]! <= pb[j + 1]! + 1e-9)) {
            push([ga[i]!, ga[i + 1]!, gb[j]!], k);
            i++;
          } else {
            push([ga[i]!, gb[j + 1]!, gb[j]!], k);
            j++;
          }
        }
      }
    }
    if (!droppedSlabs.size) break;
    // one mid ring per offending slab (only where the level is new)
    const fresh: { at: number; r: LoftRing }[] = [];
    for (const k of droppedSlabs) {
      const A = rings[k]!, B = rings[k + 1]!;
      if (isApexRing(A) || isApexRing(B)) continue;   // tips are PRUNED, not split
      const zm = Math.round((A.z + B.z) / 2);
      if (zm === A.z || zm === B.z) continue;         // gap 1 — cannot split
      const mid = bodyRing(zm);
      if (!mid) continue;
      fresh.push({ at: k + 1, r: mid });
    }
    if (!fresh.length) break;
    fresh.sort((x, y) => y.at - x.at);                // keep splice indices valid
    for (const f of fresh) rings.splice(f.at, 0, f.r);
    if (round > 20) break;                            // runaway guard
  }
  // faces the FINAL pass dropped with no split left possible (exotic
  // blends only — the pin corpus measures zero)
  const skipped = droppedFaces;
  const stats = metrics(pts, faces, spec, c[0], c[1], c[2]);
  stats.skipped = skipped;
  stats.idealM3 = bodyVolume(body) * CELL ** 3;
  return { shell: pts, verts: [...new Set(faces.flat())].sort((x, y) => x - y),
    faces, skipped, center: c, stats };
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
  // the IDEAL radial distance along a unit direction: the ellipsoid, or the
  // simple body (loft profile) — the deviation lines mean the same thing
  const body = spec.profile === 'cylinder' ? simpleBody(spec) : null;
  const rBody = (nx: number, ny: number, nz: number) =>
    body ? bodyRadius(body, [nx, ny, nz]) : radiusAlong(nx, ny, nz, rx, ry, rz);
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
        const excess = d - rBody(qx / d, qy / d, qz / d);
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
    const r = rBody(nx / nl, ny / nl, nz / nl);
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
    // <1e-9 cells = float noise on vertices sitting exactly ON the ideal
    // surface (the loft's ring hulls do) — report it as a clean zero
    maxOutM: Math.max(0, maxOut < 1e-9 ? 0 : maxOut) * CELL,
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

/** Lattice-vertex transform of already-encoded skin triangles: decode → map
 *  every g point through fn → re-encode (frames re-floor; colours/material/
 *  shading ride verbatim). fn must map integer g → integer g (whole-cell
 *  shifts and quarter-turns about an INTEGER pivot do); a triangle whose
 *  image no longer fits the 5-bit window drops out. */
export function transformSkinTris(tris: Triangle[], fn: (g: GP3) => GP3): Triangle[] {
  const out: Triangle[] = [];
  for (const t of tris) {
    const g = decodeSkinTri(t).map(fn) as [GP3, GP3, GP3];
    const o: Record<string, unknown> = { ...t };
    const AXES: (0 | 1 | 2)[] = [0, 1, 2];
    let ok = true;
    for (const ax of AXES) {
      const name = 'xyz'[ax]!;
      const s: [number, number, number] = [g[0]![ax], g[1]![ax], g[2]![ax]];
      const f = Math.floor(Math.min(s[0], s[1], s[2]) / CELLS_PER_FRAME);
      o[`frame_${name}`] = f;
      for (const i of [0, 1, 2] as const) {
        const v = s[i] - CELLS_PER_FRAME * f;
        if (v < 0 || v > 31) { ok = false; break; }
        o[`v${i}_${name}`] = v;
      }
      if (!ok) break;
    }
    if (ok) out.push(o as unknown as Triangle);
  }
  return out;
}

/** Whole-cell shift of already-encoded skin triangles (the placement drag).
 *  Offsets are integer lattice steps. */
export function shiftSkinTris(tris: Triangle[], step: GP3): Triangle[] {
  return transformSkinTris(tris, g => [g[0] + step[0], g[1] + step[1], g[2] + step[2]]);
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
