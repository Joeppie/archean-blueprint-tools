// ---------------------------------------------------------------- balloonfin
// BALLOON TAIL — the fin/coupler/volume half of the Generate-balloon tool
// (v1.9, user 2026-10-23 brief + two shape arbitrations the same day).
//
// FINAL SHAPE LAW (user sketch #2 — colours are the spec):
//  • the TAIL CONE STAYS UNTOUCHED — no truncation, no sleeve, no cap.
//    The first build post-sleeve read as "an undesirable break in the
//    tail's pattern … visually jarring and breaks the design" (blue in the
//    sketch), so the fin geometry rides the NATURAL cone instead;
//  • RED/ORANGE: a FIXED FILLET per fin plane — the root clings tightly to
//    the hull ("orange … taper the fuselage closely") from the SHOULDERS,
//    where the cone starts yielding, to just before the apex; the outboard
//    extent grows LINEARLY outwards, so the plate is a right triangle with
//    a vertical trailing edge at the hinge line and a long sloping leading
//    edge (red) running down to the shoulder;
//  • GREEN: the MOVABLE rudder/aileron is a plate HUNG AFT of that vertical
//    hinge line at the tail end — the rudder a tall vertical vane (yaw
//    about the vertical axis), the ailerons its cruciform twin planes
//    rolling about the longitudinal axis — like a classical stern-post
//    rudder ("the movable part comes out there");
//  • the aileron pair is mirror-symmetric about the up-longitudinal plane
//    BY CONSTRUCTION (every L record is derived from its R twin);
//  • a LowVoltageJunction (the "low power coupler") sits at the envelope
//    centre with N Volume blocks stacked straight UP out of it (count
//    CLAMPS so the stack is guaranteed enclosed), and one LV cable per
//    pivot: lead off the socket → dive through the skin IMMEDIATELY behind
//    the plug → a long run INSIDE the envelope → the coupler port (hidden
//    as the user demanded; FORMAT §pipes style + the v1.8.2 direction rule
//    honoured at both plugs; the game writer expects ≥ 2 segments).
//
// Pure lattice math in g coordinates (world = (g−6)·CELL) and raw-file
// world metres; every emitted face passes encodeSkinTri, so it is storable
// in the game's frame-aligned 31-cell window (refused faces count toward
// `skipped` and the dialog refuses the build).

import {
  simpleBody, profileScale, encodeSkinTri, decodeSkinTri,
  type GP3, type SphereSpec,
} from './latsphere';
import { adapterSocket } from './sockets';
import { CELL } from './format';
import type { Triangle } from './format';

export type FinRole = 'rudder' | 'aileronL' | 'aileronR';

export interface BalloonOptions {
  pivotType: 'SmallHinge' | 'SmallPivot';
  /** normal proportion of the balloon (form % / 100) */
  finScale: number;
  /** extra oversize on top of the normal scale (form % / 100) */
  oversize: number;
  /** Volume blocks stacked on the coupler (clamped to the envelope) */
  volumes: number;
}

/** A component the commit must place (stage frame = ghost offset 0, no
 *  turns); the commit maps pos/quat with the ghost's own transform. */
export interface PlannedComp {
  kind: 'coupler' | 'pivot' | 'volume' | 'build';
  type: string;
  module: string;
  pos: [number, number, number];
  quat: { w: number; x: number; y: number; z: number };
  /** 'pivot'/'build': the fin this pair serves (pivot ⇄ its subgrid Build
   *  join through composite_builds, flattened indices — FORMAT §Subgrids) */
  role?: FinRole;
  /** 'build': the panel's triangles in the STAGE frame (encoded records);
   *  the commit transforms + repaints them into the nested blueprint,
   *  parent-frame ABSOLUTE (v0.168 rule) */
  nestedTris?: Triangle[];
}

/** An LV cable (stage frame): polyline through the waypoints, coupler port
 *  socket → pivot socket, every hop axis-aligned; the pins audit the
 *  inside-envelope rule on these points before the file records exist. */
export interface PlannedPipe {
  portA: string;
  role: FinRole;
  portB: string;
  points: [number, number, number][];
}

export interface BalloonPlan {
  ok: boolean;
  reason?: string;
  /** FIXED fillets (stage frame, encoded) — join the main skin */
  fillets: Record<FinRole, Triangle[]>;
  /** MOVABLE panels (stage frame, encoded) — nested into the Builds */
  panels: Record<FinRole, Triangle[]>;
  comps: PlannedComp[];
  pipes: PlannedPipe[];
  /** lattice tetrahedron [centre, +x̂, +ŷ, +ẑ] the placement ghost rides:
   *  the commit recovers the quarter-turn matrix + cell offset from it */
  probes: GP3[];
  /** faces exceeding the 31-cell window (must be 0 to build) */
  skipped: number;
  counts: { volumes: number; fillets: number; panels: number; hingeZ: number };
}

/** Adapter entries balloonfin needs (subset of the manifest records — the
 *  module stays free of the model loader; the caller reads them from
 *  manifest.SmallHinge.adapters etc). */
export interface AdapterLike {
  name: string;
  type: string;
  position: [number, number, number];
  rotation: [number, number, number];
}
export interface BalloonAdapters {
  /** the pivot type's 'lowvoltage' adapter (its socket = the cable anchor) */
  pivot: AdapterLike;
  /** the junction's FREE lowvoltage ports (the input port stays free for a battery later) */
  coupler: AdapterLike[];
}

const SKIN0 = { slot: 51, material: 0, smooth: false };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const oversizeK = (opt: BalloonOptions) => clamp(opt.oversize, 1, 4);
/** the window is FRAME-ALIGNED: worst case 11 window cells sit BELOW the
 *  face's minimum (min − 12·floor(min/12) ≤ 11), so a single-face span may
 *  not exceed 31 − 11 = 20 cells */
const MAX_SPAN = 20;

type G3 = [number, number, number];

/** integer frame matrix as three signed unit columns */
interface Frame { ax: G3; ay: G3; az: G3 }
const cross = (a: G3, b: G3): G3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a: G3): G3 => [-a[0], -a[1], -a[2]];
const unit = (i: number): G3 => [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];

/** rotation matrix (columns x̂ ŷ ẑ) → file quaternion (w,x,y,z), 6dp like
 *  the catalog's newComponent writer style. m = rows [m0 m1 m2]. */
function quatFromFrame(m: readonly (readonly [number, number, number])[]): {
  w: number; x: number; y: number; z: number;
} {
  const r0 = m[0]!, r1 = m[1]!, r2 = m[2]!;
  const [m00, m01, m02] = r0, [m10, m11, m12] = r1, [m20, m21, m22] = r2;
  const tr = m00 + m11 + m22;
  let w: number, x: number, y: number, z: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const n = Math.hypot(w, x, y, z) || 1;
  const r6 = (v: number) => +v.toFixed(6);
  return { w: r6(w / n), x: r6(x / n), y: r6(y / n), z: r6(z / n) };
}
const frameQuat = (f: Frame): { w: number; x: number; y: number; z: number } => quatFromFrame(
  [0, 1, 2].map(row => [f.ax[row]!, f.ay[row]!, f.az[row]!] as [number, number, number]));

const wv = (g: readonly number[]): [number, number, number] =>
  [(g[0]! - 6) * CELL, (g[1]! - 6) * CELL, (g[2]! - 6) * CELL];

/**
 * Plan the whole tail batch. `spec` must be the CYLINDER-profile spec (the
 * dialog hides the section otherwise). The SKIN is planned unchanged — the
 * fillets and panels are added next to it; nothing truncates the tail.
 */
export function planBalloonTail(
  spec: SphereSpec, opt: BalloonOptions, adapters: BalloonAdapters,
): BalloonPlan {
  const empty: BalloonPlan = {
    ok: false, fillets: { rudder: [], aileronL: [], aileronR: [] },
    panels: { rudder: [], aileronL: [], aileronR: [] },
    comps: [], pipes: [], probes: [], skipped: 0,
    counts: { volumes: 0, fillets: 0, panels: 0, hingeZ: 0 },
  };
  const fail = (reason: string): BalloonPlan => ({ ...empty, reason });
  const body = simpleBody(spec);
  const c: GP3 = [spec.cx ?? 6, spec.cy ?? 6, spec.cz ?? 6];
  const la = body.la;
  const p1 = (la + 1) % 3, p2 = (la + 2) % 3;
  const cA = c[la]!, c1 = c[p1]!, c2 = c[p2]!;

  // ---- body axes: tail = +ê_la (nose = the − end), up = file ŷ (a
  // vertical balloon stands on +ẑ instead), side = the third axis. The
  // RING coords are (u along p1, v along p2); up/side live on whichever.
  const upIdx: 0 | 1 | 2 = la === 1 ? 2 : 1;
  const tHat = unit(la), uHat = unit(upIdx);
  const upIsP1 = p1 === upIdx;
  const gSide = (upIsP1 ? p2 : p1) as 0 | 1 | 2;   // file axis carrying the ring's side coord
  const sHat = unit(gSide);
  const rUp = upIsP1 ? body.r1 : body.r2;
  const rSide = upIsP1 ? body.r2 : body.r1;
  const cUp = (upIsP1 ? c1 : c2)!;                 // ring centre on the up coord
  const cSide = (upIsP1 ? c2 : c1)!;               // ring centre on the side coord

  // ---- stations along the (UNTOUCHED) tail cone -------------------------
  const nT = body.L - body.sT * body.L;             // tail zone, cells
  if (nT < 12) return fail('the tail zone is shorter than 3 m — lower the '
    + 'tail % or lengthen the balloon before adding fins');
  const hiZ = Math.round(cA + body.L);
  const zA = Math.round(cA + body.sT * body.L);     // shoulder: where the cone starts
  // hinge line AT the apex (user sketch #4 blue: the rudder's full-height
  // part must start BEHIND the cone; the keel strip follows the last
  // section's contour onto the tail end — the hinge was "a bit too far
  // inward (barely so)")
  const zB = hiZ;
  if (zB - zA < 6) return fail('the tail cone is too short to hang fins on');
  // the hull surface at a station — the fin root CLINGS to this (the orange
  // line: "taper the fuselage closely"); +1 cell of clearance only where a
  // hinge barrel fills the gap
  const surfUp = (z: number) => Math.round(cUp + rUp * profileScale(body, z - cA));
  const surfSide = (z: number) => Math.round(cSide + rSide * profileScale(body, z - cA));

  // ---- fin sizes: ONE STRAIGHT top line (user sketch #3) ----------------
  // The top edge is a single straight line from the shoulder POINT on the
  // hull (zA, base(zA)) rising aft through the hinge line and CONTINUING
  // over the hung fin — no curvature anywhere ("that too should be
  // straight"; the old width rode the cone and curved back IN). FIN SIZE
  // IS THE SLOPE: at the modest end the line stays near-horizontal, flush
  // with the top of the ship; more size steepens the taper. The hung fin
  // closes on a horizontal KEEL line below; its hinge side follows the
  // hull contour (not square).
  const k = clamp(opt.finScale, 0.25, 3) * clamp(oversizeK(opt), 1, 4);
  const riseUp = clamp(Math.round(0.5 * rUp * k), 0, MAX_SPAN);
  const riseS = clamp(Math.round(0.5 * rSide * k), 0, MAX_SPAN);
  const rudderC = clamp(Math.round(Math.max(3, 0.35 * rUp * k)), 3, MAX_SPAN);
  const ailChord = clamp(Math.round(Math.max(3, 0.35 * rSide * k)), 3, MAX_SPAN);
  // the single line: TOP(z) = base(zA) + rise·(z − zA)/(zB − zA), z up to
  // the fin's trailing edge (the same function serves forward AND aft —
  // the continuation IS the rule)
  const lineUp = (z: number) => Math.round(surfUp(zA) + riseUp * (z - zA) / (zB - zA));
  const lineS = (z: number) => Math.round(surfSide(zA) + riseS * (z - zA) / (zB - zA));
  // horizontal keel: the hull UNDERSIDE level at the shoulder (the modest
  // fin's flush bottom line); the rudder hangs to it, its forward strip
  // clings to the rising underside contour
  const keelU = 2 * cUp - surfUp(zA);

  // ---- triangles --------------------------------------------------------
  let skipped = 0;
  const emit = (t0: GP3, t1: GP3, t2: GP3, sink: Triangle[]) => {
    if (t0[0] === t1[0] && t0[1] === t1[1] && t0[2] === t1[2]
      || t1[0] === t2[0] && t1[1] === t2[1] && t1[2] === t2[2]
      || t0[0] === t2[0] && t0[1] === t2[1] && t0[2] === t2[2]) return;
    const t = encodeSkinTri([t0, t1, t2], SKIN0);
    if (t) sink.push(t); else skipped++;
  };
  /** A fin region in the plane of `wAxis` at wVal: for z ∈ [zFrom, zTo] the
   *  plate spans outboard from lo(z) to hi(z), built in ≤ 9-cell strips so
   *  every quad stores; the winding faces `front`. lo/hi may follow the
   *  hull CONTOUR (cling/hinge side) or the straight TOP line. */
  const region = (
    wAxis: 0 | 1 | 2, wVal: number, zFrom: number, zTo: number,
    lo: (z: number) => number, hi: (z: number) => number,
    front: G3, sink: Triangle[],
  ) => {
    const bAxis = ([0, 1, 2] as const).find(a => a !== la && a !== wAxis)!;
    const at = (a: number, b: number): GP3 => {
      const g: GP3 = [0, 0, 0];
      g[la] = Math.round(a); g[bAxis] = Math.round(b); g[wAxis] = wVal;
      return g;
    };
    const flip = cross(unit(la), unit(bAxis));
    const rev = flip[0] * front[0] + flip[1] * front[1] + flip[2] * front[2] < 0;
    const n = Math.max(1, Math.ceil(Math.abs(zTo - zFrom) / 9));
    const zs: number[] = [];
    for (let i = 0; i <= n; i++) zs.push(Math.round(zFrom + (zTo - zFrom) * i / n));
    const band = (z: number, t: number) => lo(z) + t * (hi(z) - lo(z));
    for (let i = 0; i + 1 < zs.length; i++) {
      const z0 = zs[i]!, z1 = zs[i + 1]!;
      if (z1 === z0) continue;
      // subdivide WISE too: the window caps a single face at ~20 cells and
      // an oversized fin's chord band can outgrow it
      const w = Math.max(Math.abs(hi(z0) - lo(z0)), Math.abs(hi(z1) - lo(z1)));
      const m = Math.max(1, Math.ceil(w / 9));
      for (let j = 0; j < m; j++) {
        const t0 = j / m, t1 = (j + 1) / m;
        const p00 = at(z0, band(z0, t0)), p10 = at(z1, band(z1, t0));
        const p11 = at(z1, band(z1, t1)), p01 = at(z0, band(z0, t1));
        if (p00[0] === p01[0] && p00[1] === p01[1] && p00[2] === p01[2]
          && p10[0] === p11[0] && p10[1] === p11[1] && p10[2] === p11[2]) continue;
        if (!rev) { emit(p00, p10, p11, sink); emit(p00, p11, p01, sink); }
        else { emit(p00, p11, p10, sink); emit(p00, p01, p11, sink); }
      }
    }
  };
  const underside = (z: number) => 2 * cUp - surfUp(z);   // the hull's OTHER face at z
  const fillets: Record<FinRole, Triangle[]> = { rudder: [], aileronL: [], aileronR: [] };
  const panels: Record<FinRole, Triangle[]> = { rudder: [], aileronL: [], aileronR: [] };
  // the R-side generator (the L twin is mirror-derived from R's records)
  // Rudder: fillet in the mirror plane clinging to the TOP of the cone from
  // the shoulder to the hinge line; the rudder panel a tall vertical vane
  // HUNG AFT of the hinge line (green), spanning from around the hull's
  // middle height up past the fillet's top.
  // Rudder: the fillet fills between the cone top and the straight TOP
  // line (shoulder → hinge); the hung panel spans from the horizontal KEEL
  // line up to the hull UNDERSIDE contour forward (so its hinge side is
  // contour-following, not square) and up to the CONTINUED top line aft —
  // one straight edge across the whole assembly.
  region(gSide, cSide, zA, zB, surfUp, lineUp, sHat, fillets.rudder);
  region(gSide, cSide, zA, zB, () => keelU, underside, sHat, panels.rudder);
  region(gSide, cSide, zB, zB + rudderC, () => keelU, lineUp, sHat, panels.rudder);
  // Ailerons: the fillet fills between the side contour and the outward
  // top line; the hung panel continues aft of the hinge line between the
  // (contour-following) inner edge and the continued line.
  region(upIdx, cUp, zA, zB, surfSide, lineS, uHat, fillets.aileronR);
  // the hung aileron does NOT reach in toward the tail (red/green sketch
  // #4: "the movable part strike the tail … the radius where the tail goes
  // should not strike the rudders"): its inner edge is a FLAT plane two
  // cells out from the root, constant aft — stepped (jagged) against the
  // fillet, never touching the cone's radius.
  region(upIdx, cUp, zB, zB + ailChord, () => surfSide(zB) + 2, lineS, uHat, panels.aileronR);
  // L twins: mirror EVERYTHING (side coord reflected about the mirror
  // plane, two vertices swapped = the flipped normal) — the pair is
  // triangle-for-triangle symmetric BY CONSTRUCTION.
  const mirror = (src: Triangle[]): Triangle[] => src.map(t => {
    const [a, b, cc] = decodeSkinTri(t);
    const m = (g: GP3): GP3 => {
      const q: GP3 = [g[0]!, g[1]!, g[2]!];
      q[gSide] = 2 * cSide - q[gSide]!;
      return q;
    };
    return encodeSkinTri([m(a), m(cc), m(b)], SKIN0)!;
  });
  fillets.aileronL = mirror(fillets.aileronR);
  panels.aileronL = mirror(panels.aileronR);

  // ---- components (stage frame) ------------------------------------------
  const coupler: PlannedComp = {
    kind: 'coupler', type: 'LowVoltageJunction', module: 'ARCHEAN_junction',
    pos: wv(c), quat: { w: 1, x: 0, y: 0, z: 0 },
  };
  // Volume stack facing UP out of the coupler: junction collider roof is
  // +0.062 m, a Volume spans ±0.125 m → first centre at +0.187 m (0.748
  // cells), one cell of pitch; the count CLAMPS so the top keeps a 1-cell
  // margin under the skin — "guaranteed to be enclosed in the blimp".
  const volFit = clamp(Math.floor(rUp - 2.25), 0, 16);
  const nVol = clamp(Math.round(opt.volumes), 0, Math.min(16, volFit));
  const volumes: PlannedComp[] = [];
  for (let i = 0; i < nVol; i++) {
    const p: G3 = [c[0]!, c[1]!, c[2]!];
    p[upIdx] = c[upIdx]! + 0.748 + i;
    volumes.push({
      kind: 'volume', type: 'Volume', module: 'ARCHEAN_build',
      pos: wv(p), quat: { w: 1, x: 0, y: 0, z: 0 },
    });
  }
  // the three pivots ON the hinge line (zB) + their subgrid panels
  const pivotDefs: { role: FinRole; pos: GP3; frame: Frame }[] = [];
  {
    // rudder: joint axis = up (its ŷ), slave (+ẑ) faces the tail — the
    // parts-only subgrid rule (subgrid.ts) animates the panel about R(q)·ŷ
    const p: GP3 = [c[0]!, c[1]!, c[2]!];
    p[la] = zB; p[upIdx] = Math.round((keelU + lineUp(zB)) / 2); p[gSide] = cSide;
    pivotDefs.push({ role: 'rudder', pos: p, frame: { ax: cross(uHat, tHat), ay: uHat, az: tHat } });
  }
  for (const sgn of [1, -1] as const) {
    // ailerons: joint axis = longitudinal, the hung panel rolls about it;
    // the pair is the exact mirror of itself (out and ax flip together)
    const out: G3 = sgn > 0 ? sHat : neg(sHat);
    const p: GP3 = [c[0]!, c[1]!, c[2]!];
    p[la] = zB; p[upIdx] = cUp; p[gSide] = cSide + sgn * (surfSide(zB) + 1.5 - cSide);
    pivotDefs.push({
      role: sgn > 0 ? 'aileronR' : 'aileronL', pos: p,
      frame: { ax: cross(tHat, out), ay: tHat, az: out },
    });
  }
  const comps: PlannedComp[] = [coupler];
  for (const pd of pivotDefs) {
    comps.push({
      kind: 'pivot', type: opt.pivotType, module: 'ARCHEAN_build',
      pos: wv(pd.pos), quat: frameQuat(pd.frame), role: pd.role,
    });
    comps.push({
      kind: 'build', type: 'Build', module: 'ARCHEAN_build',
      pos: [0, 0, 0], quat: { w: 1, x: 0, y: 0, z: 0 }, role: pd.role,
      nestedTris: panels[pd.role].map(t => ({ ...t })),
    });
  }
  comps.push(...volumes);

  // ---- LV cables: coupler port → pivot socket, hidden through the skin ---
  const pipes: PlannedPipe[] = [];
  const couplerPorts = adapters.coupler.slice(0, 3);
  const lead = 0.05;   // 2× the LV radius (v1.8.2 lead rule), rounded
  pivotDefs.forEach((pd, i) => {
    const port = couplerPorts[i % Math.max(1, couplerPorts.length)];
    if (!port) return;
    const A = adapterSocket(
      { x: coupler.pos[0], y: coupler.pos[1], z: coupler.pos[2] }, coupler.quat, port);
    const q = frameQuat(pd.frame);
    const bp0 = wv(pd.pos);
    const B = adapterSocket({ x: bp0[0], y: bp0[1], z: bp0[2] }, q, adapters.pivot);
    const snap = (a: readonly number[]): G3 => {
      const ax = Math.abs(a[0]!) >= Math.abs(a[1]!) && Math.abs(a[0]!) >= Math.abs(a[2]!) ? 0
        : Math.abs(a[1]!) >= Math.abs(a[2]!) ? 1 : 2;
      const v = unit(ax); v[ax] = a[ax]! >= 0 ? 1 : -1;
      return v;
    };
    const aAx = snap(A.axis), bAx = snap(B.axis);
    const Aat: G3 = [A.at[0], A.at[1], A.at[2]];
    const Bat: G3 = [B.at[0], B.at[1], B.at[2]];
    const Alead: G3 = Aat.map((x, k2) => x + aAx[k2]! * lead) as G3;
    const Blead: G3 = Bat.map((x, k2) => x + bAx[k2]! * lead) as G3;
    // The hinge-side approach: lead off the plug, then reach the INSIDE of
    // the cone by the shortest inward march (radial toward the body axis —
    // the "immediately run into the body" rule), the long run then walks
    // the LONGITUDINAL axis inside the envelope to the coupler's station,
    // and (side → up → la) lands the final lead on the coupler's port
    // axis. The march keeps the LAST hop at each plug collinear with that
    // plug's stub (v1.8.2 direction rule) and is capped so it terminates.
    const axisPt: G3 = [Bat[0], Bat[1], Bat[2]];
    axisPt[upIdx] = (cUp - 6) * CELL; axisPt[gSide] = (cSide - 6) * CELL;
    const inward = snap([axisPt[0] - Blead[0], axisPt[1] - Blead[1], axisPt[2] - Blead[2]]);
    // from a plug at/behind the apex the CONE has already closed: hop two
    // cells up the tail (along la) first, only then march inboard — still
    // the "immediately run into the body" rule (at most two hops)
    const D1: G3 = [...Blead] as G3;
    if (!insideBalloon(spec, D1)) D1[la] = Blead[la] - 2 * CELL;
    let Din: G3 = [...D1] as G3;
    if (!insideBalloon(spec, Din)) {
      let found = false;
      for (let step = 1; step <= 40; step++) {
        Din = D1.map((x, k2) => x + inward[k2]! * CELL * step) as G3;
        if (insideBalloon(spec, Din)) { found = true; break; }
      }
      if (!found) Din = [...D1] as G3;
    }
    // the long-run far end: same lateral/height as the dive point
    const runEnd: G3 = [Bat[0], Bat[1], Bat[2]];
    runEnd[upIdx] = Din[upIdx]; runEnd[gSide] = Din[gSide];
    runEnd[la] = Alead[la];
    const s1: G3 = [...runEnd] as G3; s1[gSide] = Alead[gSide];
    const s2: G3 = [...s1] as G3; s2[upIdx] = Alead[upIdx];
    const fwd: G3[] = [Bat, Blead, D1, Din, runEnd, s1, s2, Alead, Aat];
    const pts: G3[] = [];
    for (const p of fwd.reverse())
      if (!pts.length || Math.hypot(pts[pts.length - 1]![0] - p[0],
        pts[pts.length - 1]![1] - p[1], pts[pts.length - 1]![2] - p[2]) > 1e-9) pts.push(p);
    if (pts.length < 3) pts.splice(1, 0, [Aat[0], Alead[1], Alead[2]]);   // ≥ 2 segments
    pipes.push({ portA: port.name, role: pd.role, portB: adapters.pivot.name, points: pts });
  });

  const nFillets = fillets.rudder.length + fillets.aileronL.length + fillets.aileronR.length;
  const nPanels = panels.rudder.length + panels.aileronL.length + panels.aileronR.length;
  const ok = skipped === 0 && nFillets > 0 && nPanels > 0 && pipes.length === pivotDefs.length;
  return {
    ok,
    reason: ok ? undefined
      : `${skipped} tail faces exceed the game's 31-cell window — shrink the fins or the oversize`,
    fillets, panels, comps, pipes,
    probes: [[c[0]!, c[1]!, c[2]!], [c[0]! + 1, c[1]!, c[2]!],
      [c[0]!, c[1]! + 1, c[2]!], [c[0]!, c[1]!, c[2]! + 1]],
    skipped,
    counts: { volumes: nVol, fillets: nFillets, panels: nPanels, hingeZ: zB },
  };
}

// ------------------------------------------------------------- commit maps
/** The ghost's transform, recovered from the probe tetrahedron the engine
 *  quarter-turned with the skin: A = the signed-permutation rotation, the
 *  cell offset added last (exactly the order the triangles took). */
export function ghostMap(
  planProbes: GP3[], liveProbes: GP3[] | undefined, offset: [number, number, number],
): {
  g: (p: GP3) => GP3;
  world: (p: [number, number, number]) => [number, number, number];
  quat: (q: { w: number; x: number; y: number; z: number }) => { w: number; x: number; y: number; z: number };
} {
  const P = planProbes, L = liveProbes && liveProbes.length >= 4 ? liveProbes : planProbes;
  const P0 = P[0]!, L0 = L[0]!;
  const col = (i: number): G3 => {
    const d: G3 = [L[i + 1]![0] - L0[0], L[i + 1]![1] - L0[1], L[i + 1]![2] - L0[2]];
    const ax = Math.abs(d[0]) >= 0.5 ? 0 : Math.abs(d[1]) >= 0.5 ? 1 : 2;
    const v = unit(ax); v[ax] = d[ax] >= 0 ? 1 : -1;
    return v;
  };
  const c0 = col(0), c1 = col(1), c2 = col(2);
  const av = (p: readonly number[]): G3 => [
    c0[0] * p[0]! + c1[0] * p[1]! + c2[0] * p[2]!,
    c0[1] * p[0]! + c1[1] * p[1]! + c2[1] * p[2]!,
    c0[2] * p[0]! + c1[2] * p[1]! + c2[2] * p[2]!,
  ];
  const g = (p: GP3): GP3 => {
    const r = av([p[0]! - P0[0], p[1]! - P0[1], p[2]! - P0[2]]);
    return [r[0] + L0[0] + Math.round(offset[0]),
      r[1] + L0[1] + Math.round(offset[1]),
      r[2] + L0[2] + Math.round(offset[2])];
  };
  const world = (p: [number, number, number]): [number, number, number] => {
    const m = g([p[0] / CELL + 6, p[1] / CELL + 6, p[2] / CELL + 6]);
    const r3 = (v: number) => +v.toFixed(4);
    return [r3((m[0] - 6) * CELL), r3((m[1] - 6) * CELL), r3((m[2] - 6) * CELL)];
  };
  // A composed from the LEFT (world-space turn), matching how TGC's
  // quarter-turn rotated every vertex: q' = qA ⊗ q.
  const qA = quatFromFrame([
    [c0[0], c1[0], c2[0]], [c0[1], c1[1], c2[1]], [c0[2], c1[2], c2[2]],
  ] as [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]);
  const quat = (q: { w: number; x: number; y: number; z: number }) => {
    const r6 = (v: number) => +v.toFixed(6);
    return {
      w: r6(qA.w * q.w - qA.x * q.x - qA.y * q.y - qA.z * q.z),
      x: r6(qA.w * q.x + qA.x * q.w + qA.y * q.z - qA.z * q.y),
      y: r6(qA.w * q.y - qA.x * q.z + qA.y * q.w + qA.z * q.x),
      z: r6(qA.w * q.z + qA.x * q.y - qA.y * q.x + qA.z * q.w),
    };
  };
  return { g, world, quat };
}

/** Inside-envelope test in the STAGE frame (a pin helper): the simple
 *  body's own ellipse law on the tail side (the cone is UNTOUCHED). */
export function insideBalloon(
  spec: SphereSpec, p: [number, number, number], margin = 0.98,
): boolean {
  const body = simpleBody(spec);
  const la = body.la, p1 = (la + 1) % 3, p2 = (la + 2) % 3;
  const c: GP3 = [spec.cx ?? 6, spec.cy ?? 6, spec.cz ?? 6];
  const gp: GP3 = [p[0] / CELL + 6, p[1] / CELL + 6, p[2] / CELL + 6];
  const dz = gp[la]! - c[la]!;
  let f = 1;
  if (dz > 0) {
    f = profileScale(body, dz);
    if (f <= 0.01) return false;
  }
  const q1 = (gp[p1]! - c[p1]!) / (body.r1 * f), q2 = (gp[p2]! - c[p2]!) / (body.r2 * f);
  return q1 * q1 + q2 * q2 <= margin;
}

/** Build one pipe's cached segments from its waypoints (the game writer
 *  expects ≥ 2 segments, dev blueprint.js warns below that; every hop is
 *  axis-aligned BY CONSTRUCTION — a hop that is not means the route is
 *  broken, and it is dropped rather than silently patched). `style` is the
 *  lowvoltage segment table (wireops KIND_STYLE); `map` is the ghost
 *  transform (identity for the stage frame). */
export function pipeSegments(
  points: [number, number, number][],
  style: Record<string, unknown>,
  map?: (p: [number, number, number]) => [number, number, number],
): Record<string, unknown>[] {
  const segs: Record<string, unknown>[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = map ? map(points[i]!) : points[i]!;
    const b = map ? map(points[i + 1]!) : points[i + 1]!;
    const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ax = Math.abs(d[0]) >= Math.abs(d[1]) && Math.abs(d[0]) >= Math.abs(d[2]) ? 0
      : Math.abs(d[1]) >= Math.abs(d[2]) ? 1 : 2;
    const len = Math.abs(d[ax]!);
    if (len < 1e-6) continue;
    const off = ([0, 1, 2] as const).filter(k => k !== ax);
    if (Math.abs(d[off[0]!]!) > 1e-6 || Math.abs(d[off[1]!]!) > 1e-6) continue;
    segs.push({
      ...style, dir: ax + (d[ax]! < 0 ? 3 : 0), length: +len.toFixed(4),
      start: { x: +a[0].toFixed(4), y: +a[1].toFixed(4), z: +a[2].toFixed(4) },
    });
  }
  return segs;
}
