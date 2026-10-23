// ---------------------------------------------------------------- balloonfin
// BALLOON TAIL — the fin/coupler/volume half of the Generate-balloon tool
// (v1.9, user 2026-10-23: "add a section to its tool to generate a tail
// rudder and two ailerons … based on a symmetrically placed (mirrored) fins,
// which help stabilize the balloon … firstly so that there is a contiguous
// area that connects where the tail can sit — flush with the end of the
// 'tail' section of the cone … wired in to a low power coupler that sits
// near the center … on top of that power coupler, a volume block facing up,
// so it is guaranteed to be enclosed in the blimp … the LV cables hook into
// the pivots that do the rotating … the wire after connecting to the pivot
// must immediately run into the zeppelin's body, so they are hidden").
//
// SHAPE OF THE RESULT (cylinder profile only):
//  • the tail cone is TRUNCATED at tailCutG (SphereSpec.tailCutG) and the
//    loft's open cut ring is closed here by a straight-sided SLEEVE + a
//    shrinking tail CAP + tip cone: the sleeve re-uses the cut ring's EXACT
//    slot table (loftRingTable — the same law the loft itself applies at
//    that level), so sleeve and cone share vertices: the contiguous flush
//    tail-post the user asked for, classical-zeppelin style;
//  • THREE fins (a top rudder yawing about the vertical + port/starboard
//    ailerons rolling about the longitudinal axis — cruciform): every panel
//    is a flat lattice plate of hull TRIANGLES (the surfaces are never
//    components), riding a SmallHinge/SmallPivot part. The panel lives in
//    a Build SUBGRID joined to that pivot through composite_builds, so
//    turning the pivot turns the panel (the repo's decoded subgrid
//    mechanics; the dev viewer's readBuild reads nested `triangles`
//    recursively — the schema carries them, FORMAT §Subgrids). The aileron
//    pair is the EXACT side-plane mirror of itself, the rudder sits on the
//    mirror plane (self-mirror);
//  • a LowVoltageJunction (the "low power coupler") sits at the envelope
//    centre with N Volume blocks stacked straight UP out of it (facing up;
//    the count CLAMPS so the stack is guaranteed enclosed), and one LV
//    cable per pivot: lead off the socket → dive through the skin →
//    a long run INSIDE the envelope → the coupler port (hidden as the user
//    demanded, FORMAT §pipes style + v1.8.2 direction rule honoured at both
//    plugs; the game writer expects ≥ 2 segments per pipe).
//
// Pure lattice math in g coordinates (world = (g−6)·CELL) and raw-file
// world metres; every emitted face passes encodeSkinTri, so it is storable
// in the game's frame-aligned 31-cell window (refused faces count toward
// `skipped` and the dialog refuses the build).

import {
  simpleBody, loftZLevels, loftRingTable, profileScale, encodeSkinTri, decodeSkinTri,
  type GP3, type LoftRingCache, type SimpleBody, type SphereSpec,
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
  /** pass into SphereSpec.tailCutG when ok (re-plan the skin WITH it) */
  tailCutG?: number;
  /** sleeve + tail-cap faces (stage frame, encoded) — join the main skin */
  sleeveTris: Triangle[];
  /** per-fin panel triangles (stage frame, encoded) — nested into Builds */
  finTris: Record<FinRole, Triangle[]>;
  comps: PlannedComp[];
  pipes: PlannedPipe[];
  /** lattice tetrahedron [centre, +x̂, +ŷ, +ẑ] the placement ghost rides:
   *  the commit recovers the quarter-turn matrix + cell offset from it */
  probes: GP3[];
  /** faces exceeding the 31-cell window (must be 0 to build) */
  skipped: number;
  counts: { volumes: number; sleeveTris: number; finTris: number; tailPostM: number };
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
  /** the junction's FREE lowvoltage ports (the input port excluded) */
  coupler: AdapterLike[];
}

const SKIN0 = { slot: 51, material: 0, smooth: false };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** the window is FRAME-ALIGNED: worst case 11 window cells sit BELOW the
 *  face's minimum (min − 12·floor(min/12) ≤ 11), so a span may not exceed
 *  31 − 11 = 20 cells */
const MAX_SPAN = 20;
const LOFT_GAP = 20;   // the loft's own max axial ring gap (latsphere)

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
  const tr = m00! + m11! + m22!;
  let w: number, x: number, y: number, z: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21! - m12!) / s; y = (m02! - m20!) / s; z = (m10! - m01!) / s;
  } else if (m00! > m11! && m00! > m22!) {
    const s = Math.sqrt(1 + m00! - m11! - m22!) * 2;
    w = (m21! - m12!) / s; x = 0.25 * s; y = (m01! + m10!) / s; z = (m02! + m20!) / s;
  } else if (m11! > m22!) {
    const s = Math.sqrt(1 + m11! - m00! - m22!) * 2;
    w = (m02! - m20!) / s; x = (m01! + m10!) / s; y = 0.25 * s; z = (m12! + m21!) / s;
  } else {
    const s = Math.sqrt(1 + m22! - m00! - m11!) * 2;
    w = (m10! - m01!) / s; x = (m02! + m20!) / s; y = (m12! + m21!) / s; z = 0.25 * s;
  }
  const n = Math.hypot(w, x, y, z) || 1;
  const r6 = (v: number) => +v.toFixed(6);
  return { w: r6(w / n), x: r6(x / n), y: r6(y / n), z: r6(z / n) };
}
const frameQuat = (f: Frame): { w: number; x: number; y: number; z: number } => quatFromFrame(
  [0, 1, 2].map(row => [f.ax[row]!, f.ay[row]!, f.az[row]!] as [number, number, number]));

/** ring coords (z along la, u along p1, v along p2) → lattice point */
const ringG = (la: number, z: number, u: number, v: number): GP3 => {
  const g: GP3 = [0, 0, 0];
  g[la] = z; g[(la + 1) % 3] = u; g[(la + 2) % 3] = v;
  return g;
};
const wv = (g: readonly number[]): [number, number, number] =>
  [(g[0]! - 6) * CELL, (g[1]! - 6) * CELL, (g[2]! - 6) * CELL];

/** Where the fin post lives on a body: cut at 80 % of the tail taper (the
 *  cone stays clearly visible — the post + cap only replace its last
 *  fifth), end at 95 % of the tail zone. Shared by the planner and the
 *  inside-envelope pin so both see the SAME post. */
function tailPostGeom(body: SimpleBody, c: GP3): {
  zT: number; zE: number; fT: number; hiZ: number; shZ: number;
} {
  const cA = c[body.la]!;
  const nT = body.L - body.sT * body.L;
  const hiZ = Math.round(cA + body.L);
  const shZ = clamp(Math.round(cA + body.sT * body.L), Math.round(cA - body.L) + 1, hiZ - 1);
  const zE = Math.min(Math.round(cA + body.sT * body.L + 0.95 * nT), hiZ - 3);
  const zT = clamp(Math.round(cA + body.sT * body.L + 0.8 * nT), shZ + 1, zE - 2);
  return { zT, zE, fT: profileScale(body, zT - cA), hiZ, shZ };
}

/**
 * Plan the whole tail batch. `spec` must be the CYLINDER-profile spec (the
 * dialog hides the section otherwise; the planner still re-checks). The
 * returned tailCutG must be re-applied to the spec BEFORE the skin is
 * planned (the tail apex is gone — the skin's face count comes from that
 * truncated plan).
 */
export function planBalloonTail(
  spec: SphereSpec, opt: BalloonOptions, adapters: BalloonAdapters,
): BalloonPlan {
  const empty: BalloonPlan = {
    ok: false, tailCutG: undefined, sleeveTris: [], skipped: 0,
    finTris: { rudder: [], aileronL: [], aileronR: [] },
    comps: [], pipes: [], probes: [],
    counts: { volumes: 0, sleeveTris: 0, finTris: 0, tailPostM: 0 },
  };
  const fail = (reason: string): BalloonPlan => ({ ...empty, reason });
  const body = simpleBody(spec);
  const c: GP3 = [spec.cx ?? 6, spec.cy ?? 6, spec.cz ?? 6];
  const la = body.la;
  const p1 = (la + 1) % 3, p2 = (la + 2) % 3;
  const cA = c[la]!, c1 = c[p1]!, c2 = c[p2]!;
  const nd = spec.facets && spec.facets >= 3 ? spec.facets : 48;

  // ---- body axes: tail = +ê_la (nose = the − end), up = file ŷ (a
  // vertical balloon stands on +ẑ), side = the third axis. The RING coords
  // are (u along p1, v along p2); up/side live on whichever of the two.
  const upIdx: 0 | 1 | 2 = la === 1 ? 2 : 1;
  const tHat = unit(la), uHat = unit(upIdx);
  const upIsP1 = p1 === upIdx;
  const gSide = (upIsP1 ? p2 : p1) as 0 | 1 | 2;   // file axis carrying the ring's side coord
  const sHat = unit(gSide);
  const rUp = upIsP1 ? body.r1 : body.r2;

  // ---- tail cut + tail post --------------------------------------------
  const nT = body.L - body.sT * body.L;             // tail zone, cells
  if (nT < 12) return fail('the tail zone is shorter than 3 m — lower the '
    + 'tail % or lengthen the balloon before adding fins');
  const post0 = tailPostGeom(body, c);
  const { zT, zE, fT, hiZ, shZ } = post0;
  const fT0 = fT;
  if (fT0 <= 0.05) return fail('the tail taper is too thin at the fin-post root');
  if (zE <= zT + 1) return fail('the tail post would be shorter than 2 cells');

  const cache: LoftRingCache = new Map();
  const root = loftRingTable(body, c1, c2, fT, nd, cache);
  if (!root) return fail('the tail cross-section is a sliver too thin for a post');

  // The post's envelope = the ring's own extents (the sleeve shares them).
  let upMax = -Infinity, sideMax = -Infinity, sideMin = Infinity;
  for (const [u, v] of root.slots) {
    const up = upIsP1 ? u : v, side = upIsP1 ? v : u;
    upMax = Math.max(upMax, up);
    sideMax = Math.max(sideMax, side); sideMin = Math.min(sideMin, side);
  }
  const cSide = Math.round((sideMax + sideMin) / 2);
  const cUp = Math.round(c2 * (upIsP1 ? 0 : 1) + c1 * (upIsP1 ? 1 : 0));  // ring centre on the up coord
  const hw = Math.max(1, Math.round(Math.max(sideMax - cSide, cSide - sideMin)));

  // ---- fin sizes: SWEPT TRIANGULAR fins (user sketch, 2026-10-23) --------
  // The root starts at the MIDDLE of the tail taper ("start further
  // forward, about halfway in the tapering of the tail-cone") and runs to
  // the post end; the outboard height/span grows LINEARLY along it — a
  // right-triangle fin with the vertical trailing edge at the post and a
  // long sloping leading edge coming down towards where the cone starts
  // yielding (the red outline in the sketch). The pivots sit on the root
  // chord NEAR the aft end, so the MOVABLE vane sweeps out of the cone
  // region past the tail ("so that the movable part comes out there").
  const rSide = upIsP1 ? body.r2 : body.r1;
  const k = clamp(opt.finScale, 0.25, 3) * clamp(opt.oversize, 1, 4);
  const finH = clamp(Math.round(Math.max(4, 0.45 * rUp * k)), 4, MAX_SPAN);
  const finSpan = clamp(Math.round(Math.max(4, 0.45 * rSide * k)), 4, MAX_SPAN);
  const zA = clamp(Math.round(cA + body.sT * body.L + 0.5 * nT), shZ + 1, zE - 3);
  const zB = zE;
  if (zB - zA < 3) return fail('the fin chord does not fit the tail — lengthen the balloon');
  const zh = zB - 1;                         // pivot line (aft root, at the post)
  // the hull's own surface at a station (the ring envelope: the ideal scale
  // through the taper, the post's root extent beyond it) — the fin root
  // CLINGS to this, so the triangle literally grows out of the hull
  const surfUp = (z: number) => z <= zT
    ? Math.round(cUp + rUp * profileScale(body, z - cA))
    : upMax;
  const surfSide = (z: number) => z <= zT
    ? Math.round(cSide + rSide * profileScale(body, z - cA))
    : sideMax;

  // ---- triangles --------------------------------------------------------
  let skipped = 0;
  const sleeveTris: Triangle[] = [];
  const emit = (t0: GP3, t1: GP3, t2: GP3, sink: Triangle[]) => {
    if (t0[0] === t1[0] && t0[1] === t1[1] && t0[2] === t1[2]
      || t1[0] === t2[0] && t1[1] === t2[1] && t1[2] === t2[2]
      || t0[0] === t2[0] && t0[1] === t2[1] && t0[2] === t2[2]) return;
    const t = encodeSkinTri([t0, t1, t2], SKIN0);
    if (t) sink.push(t); else skipped++;
  };
  /** strip between two ring tables — the loft's OWN merge-walk law (B at
   *  +la from A faces outward; identical chains = the straight sleeve,
   *  smaller upper chains = the cap cone) */
  const band = (zA0: number, chA: [number, number][][], zB0: number, chB: [number, number][][]) => {
    for (let d = 0; d < chA.length; d++) {
      const ca = chA[d]!, cb = chB[d]!;
      const ga = ca.map(q => ringG(la, zA0, q[0]!, q[1]!));
      const gb = cb.map(q => ringG(la, zB0, q[0]!, q[1]!));
      const ddx = (ca[ca.length - 1]![0]! - ca[0]![0]!) + (cb[cb.length - 1]![0]! - cb[0]![0]!);
      const ddy = (ca[ca.length - 1]![1]! - ca[0]![1]!) + (cb[cb.length - 1]![1]! - cb[0]![1]!);
      const dl = Math.hypot(ddx, ddy);
      const ux = dl > 1e-9 ? ddx / dl : 1, uy = dl > 1e-9 ? ddy / dl : 0;
      const pa = ca.map(q => q[0]! * ux + q[1]! * uy);
      const pb = cb.map(q => q[0]! * ux + q[1]! * uy);
      const P = ca.length - 1, Q = cb.length - 1;
      let i = 0, j = 0;
      while (i < P || j < Q) {
        if (j >= Q || (i < P && pa[i + 1]! <= pb[j + 1]! + 1e-9)) {
          emit(ga[i]!, ga[i + 1]!, gb[j]!, sleeveTris); i++;
        } else {
          emit(ga[i]!, gb[j + 1]!, gb[j]!, sleeveTris); j++;
        }
      }
    }
  };
  // sleeve levels: the loft's own level grid beyond the cut, + the post end
  const levels = loftZLevels(body, c);
  const grid: number[] = [zT, ...levels.filter(z => z > zT && z < zE), zE];
  for (let i = 0; i + 1 < grid.length;) {
    if (grid[i + 1]! - grid[i]! > LOFT_GAP) {
      grid.splice(i + 1, 0, grid[i]! + LOFT_GAP);
      continue;
    }
    band(grid[i]!, root.chains, grid[i + 1]!, root.chains);
    i++;
  }
  // tail cap: inward-shrinking rings (lattice-rounded scales, chains
  // resubdivided so every segment stays ≤ 9 cells) down to a ≤ 2-cell ring
  const scaleChains = (alpha: number): [number, number][][] => {
    const pts = root.slots.map(([u, v]) =>
      [c1 + Math.round((u - c1) * alpha), c2 + Math.round((v - c2) * alpha)] as [number, number]);
    const out: [number, number][][] = [];
    for (let kIdx = 0; kIdx < pts.length; kIdx++) {
      const s = pts[kIdx]!, t = pts[(kIdx + 1) % pts.length]!;
      const du = t[0]! - s[0]!, dv = t[1]! - s[1]!;
      const segs = Math.max(1, Math.ceil(Math.max(Math.abs(du), Math.abs(dv)) / 9));
      const ch: [number, number][] = [];
      for (let i = 0; i < segs; i++)
        ch.push([Math.round(s[0]! + du * i / segs), Math.round(s[1]! + dv * i / segs)]);
      ch.push(t);
      out.push(ch);
    }
    return out;
  };
  let spanRings = 0;
  for (const [u, v] of root.slots)
    spanRings = Math.max(spanRings, Math.abs(u - c1), Math.abs(v - c2));
  spanRings = Math.max(1, spanRings * 2);
  // how many shrink rings until the cap mouth is a ≤ 2-cell ring — then the
  // cap is UNIFORM-length so its apex stays at/before the original body end
  // (the fin option must not stretch the balloon beyond its own nose-tail
  // length by more than a cell)
  const rings: number[] = [];
  {
    let sp = spanRings;
    for (let j = 0; j < 8 && sp > 2; j++) {
      sp = Math.max(1, sp * Math.min(0.5, 19 / Math.max(sp, 19)));
      rings.push(sp);
    }
  }
  const delta = Math.max(1, Math.floor(Math.max(2, hiZ - zE) / (rings.length + 1)));
  let chPrev = root.chains, zPrev = zE;
  let alphaCum = 1, sp = spanRings;
  for (const spNext of rings) {
    alphaCum *= Math.min(0.5, 19 / Math.max(sp, 19));
    sp = spNext;
    const chN = scaleChains(alphaCum);
    band(zPrev, chPrev, zPrev + delta, chN);
    chPrev = chN; zPrev += delta;
  }
  // tip cone: the last ring onto the axis apex (ring ≤ ~2 cells ⇒ storable)
  const apexZ = zPrev + delta;
  const apex = ringG(la, apexZ, c1, c2);
  for (const ch of chPrev)
    for (let i = 0; i + 1 < ch.length; i++)
      emit(ringG(la, zPrev, ch[i]![0]!, ch[i]![1]!), ringG(la, zPrev, ch[i + 1]![0]!, ch[i + 1]![1]!), apex, sleeveTris);

  // ---- fin plates: SWEPT triangles --------------------------------------
  // One plate lives in the plane of the `w` axis at wVal; the chord walks
  // the la axis from aStart (mid taper) to aEnd (the post); the outboard
  // extent at station z runs from the hull surface `base(z)` (+1 cell of
  // clearance the hinge barrel fills) up to base(z) + h·(z−aStart)/(aEnd−
  // aStart) — ZERO at the start, FULL height at the trailing edge: the
  // right triangle of the sketch, root clinging to the cone, vertical
  // trailing edge, long sloping leading edge. Triangulated in ≤ 9-cell
  // chord strips; the winding faces `front`.
  const sweptFin = (
    wAxis: 0 | 1 | 2, wVal: number, aStart: number, aEnd: number, h: number,
    base: (a: number) => number, front: G3, sink: Triangle[],
  ) => {
    const bAxis = ([0, 1, 2] as const).find(a => a !== la && a !== wAxis)!;
    const at = (a: number, b: number): GP3 => {
      const g: GP3 = [0, 0, 0];
      g[la] = a; g[bAxis] = Math.round(b); g[wAxis] = wVal;
      return g;
    };
    const flip = cross(unit(la), unit(bAxis));
    const rev = flip[0] * front[0] + flip[1] * front[1] + flip[2] * front[2] < 0;
    const n = Math.max(1, Math.ceil((aEnd - aStart) / 9));
    const zs: number[] = [];
    for (let i = 0; i <= n; i++) zs.push(Math.round(aStart + (aEnd - aStart) * i / n));
    const ext = (z: number) => base(z) + 1 + Math.round(h * (z - aStart) / (aEnd - aStart));
    for (let i = 0; i + 1 < zs.length; i++) {
      const z0 = zs[i]!, z1 = zs[i + 1]!;
      if (z1 === z0) continue;
      const p00 = at(z0, base(z0)), p10 = at(z1, base(z1));
      const p11 = at(z1, ext(z1)), p01 = at(z0, ext(z0));
      if (!rev) { emit(p00, p10, p11, sink); emit(p00, p11, p01, sink); }
      else { emit(p00, p11, p10, sink); emit(p00, p01, p11, sink); }
    }
  };
  const finTris: Record<FinRole, Triangle[]> = { rudder: [], aileronL: [], aileronR: [] };
  // Rudder: VERTICAL swept triangle in the mirror plane (side = cSide),
  // rooted on the cone's TOP from mid-taper to the post, yawing about the
  // vertical pivot at z = zh (aft root) — the vane sweeps out past the tail.
  sweptFin(gSide, cSide, zA, zB, finH, surfUp, sHat, finTris.rudder);
  // Ailerons: HORIZONTAL swept triangles at mid height, rooted on the ±side
  // faces from mid-taper out to the post, rolling about the longitudinal
  // pivot line. L is R's EXACT mirror: the mirrored triangles are literally
  // derived from R's records (side coord reflected about the mirror plane,
  // two vertices swapped = the flipped normal), so the pair is triangle-
  // for-triangle symmetric — the plate itself is flat, so the fan diagonals
  // carry no crease either way.
  sweptFin(upIdx, cUp, zA, zB, finSpan, surfSide, uHat, finTris.aileronR);
  finTris.aileronL = finTris.aileronR.map(t => {
    const [a, b, cc] = decodeSkinTri(t);
    const m = (g: GP3): GP3 => {
      const q: GP3 = [g[0]!, g[1]!, g[2]!];
      q[gSide] = 2 * cSide - q[gSide]!;
      return q;
    };
    const mirrored = encodeSkinTri([m(a), m(cc), m(b)], SKIN0);
    return mirrored!;   // a mirrored face of a storable face is storable
  });

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
  // the three pivots + their subgrid Builds
  const pivotDefs: { role: FinRole; pos: GP3; frame: Frame }[] = [];
  {
    // rudder: joint axis = up (its ŷ), slave (+ẑ) faces the tail — the
    // parts-only subgrid rule (subgrid.ts) animates the panel about R(q)·ŷ
    const p: GP3 = [c[0]!, c[1]!, c[2]!];
    p[la] = zh; p[upIdx] = upMax + 0.5; p[gSide] = cSide;
    pivotDefs.push({ role: 'rudder', pos: p, frame: { ax: cross(uHat, tHat), ay: uHat, az: tHat } });
  }
  for (const sgn of [1, -1] as const) {
    // ailerons: joint axis = longitudinal, slave faces OUT to its side; the
    // pair is the exact mirror of itself (out and ax flip together)
    const out: G3 = sgn > 0 ? sHat : neg(sHat);
    const p: GP3 = [c[0]!, c[1]!, c[2]!];
    p[la] = zh; p[upIdx] = cUp; p[gSide] = cSide + sgn * (hw + 0.5);
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
      nestedTris: finTris[pd.role].map(t => ({ ...t })),
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
    // DIVE one cell further along the pivot's own stub axis (through the
    // skin, immediately after the lead — the user's "immediately run into
    // the body"); the long run then walks the LONGITUDINAL axis inside the
    // envelope to the coupler's station, and (up → side → la) lands the la
    // hop LAST on the coupler's port lead.
    const dive: G3 = Blead.map((x, k2) => x + bAx[k2]! * CELL) as G3;
    const run: G3 = [...dive] as G3; run[la] = Alead[la];
    const s1: G3 = [...run] as G3; s1[upIdx] = Alead[upIdx];
    const s2: G3 = [...s1] as G3; s2[gSide] = Alead[gSide];
    const fwd: G3[] = [Bat, Blead, dive, run, s1, s2, Alead, Aat];
    const pts: G3[] = [];
    for (const p of fwd.reverse())
      if (!pts.length || Math.hypot(pts[pts.length - 1]![0] - p[0],
        pts[pts.length - 1]![1] - p[1], pts[pts.length - 1]![2] - p[2]) > 1e-9) pts.push(p);
    if (pts.length < 3) pts.splice(1, 0, [Aat[0], Alead[1], Alead[2]]);   // ≥ 2 segments
    pipes.push({ portA: port.name, role: pd.role, portB: adapters.pivot.name, points: pts });
  });

  const finTriCount = finTris.rudder.length + finTris.aileronL.length + finTris.aileronR.length;
  const ok = skipped === 0 && sleeveTris.length > 0 && finTriCount > 0 && pipes.length === pivotDefs.length;
  return {
    ok,
    reason: ok ? undefined
      : `${skipped} tail faces exceed the game's 31-cell window — shrink the fins or the oversize`,
    tailCutG: zT,
    sleeveTris, finTris, comps, pipes,
    probes: [[c[0]!, c[1]!, c[2]!], [c[0]! + 1, c[1]!, c[2]!],
      [c[0]!, c[1]! + 1, c[2]!], [c[0]!, c[1]!, c[2]! + 1]],
    skipped,
    counts: {
      volumes: nVol, sleeveTris: sleeveTris.length, finTris: finTriCount,
      tailPostM: (apexZ - zT) * CELL,
    },
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

/** Inside-envelope test in the STAGE frame (a pin helper): the ideal
 *  profile up to the fin-post cut, the post's STRAIGHT envelope to its end
 *  (the contiguous sleeve keeps the root radius), the cap's linear shrink
 *  to the tip. */
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
    const { zT, zE, fT, hiZ } = tailPostGeom(body, c);
    const dzT = zT - c[la]!, dzE = zE - c[la]!;
    if (dz <= dzT) f = profileScale(body, dz);
    else if (dz <= dzE) f = fT;
    else f = fT * Math.max(0, 1 - (dz - dzE) / Math.max(1e-9, hiZ + 2 - zE));
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
