// sym.ts — the SYMMETRY TWIN index (legacy v0.160/v0.166): the game's
// left-right symmetry is GEOMETRIC in the file — the editor's mirror tool
// places the twin as a SEPARATE component of the same type at a mirrored
// position. Twins are NOT pose-mirrored, so a move propagates the
// mirror-flipped delta and a rotation propagates the MIRROR-TWIN MOTION.
// Pure + testable; the Engine owns the live index (rebuild per load).
//
// v0.166 MASK GENERALISATION: every pair carries a MIRROR MASK — the axes
// it is placed mirrored on (|a+b| ≈ 0 AND off-plane); every remaining axis
// must be EQUAL (|a−b| ≈ 0) else NO pair at all (drift ⇒ mask changes ⇒
// the alignment re-check auto-disables). x→1, y→2, z→4; two mirrored axes
// = a 180° twist, three = point symmetry. An axis where both positions are
// ≈ 0 (on-plane) classifies as EQUAL (a centreline part is its own twin
// there).

import type { BlueprintComponent, FileQuat, Vec3D } from './format';

export interface TwinPair { j: number; mask: number }

const AX_BITS = [1, 2, 4] as const;

/** Mirror mask of the (a, b) position pair, 0 = not a mirror pair. */
export function symMaskAt(a: Vec3D, b: Vec3D, eps: number): number {
  if (!a || !b) return 0;
  let m = 0;
  const av = [a.x, a.y, a.z], bv = [b.x, b.y, b.z];
  for (let k = 0; k < 3; k++) {
    const bit = AX_BITS[k]!;
    if (Math.abs(av[k]! + bv[k]!) < eps && Math.abs(av[k]!) > eps) m |= bit;      // mirrored AND off-plane
    else if (Math.abs(av[k]! - bv[k]!) > eps) return 0;                            // neither equal nor mirrored
  }
  return m;
}

/** compIdx → its twin pairs, from LOAD-TIME geometry (same type only).
 *  v1.12.2 BOOT COST: the per-type pair scan is the giant craft's load hot
 *  spot (~1 800 same-type structural parts = 3.2 M mask tests, 28 ms of the
 *  load 'anchor' phase). The body is ARITHMETICALLY the old
 *  symMaskAt(comps[i].position, comps[j].position, 0.011) call — inlined on
 *  flat Float64 arrays (the old code allocated a 3-element array PAIR per
 *  call = ~6 M allocations on the giant, which is most of the cost).
 *  Directed pairs preserved exactly: the off-plane test reads |a| = the
 *  FIRST position, so (i→j) and (j→i) can differ, and both directions are
 *  emitted (the old double loop visited every ordered pair).
 *  symMaskAt itself stays exported and untouched — the fuzz pin below runs
 *  this scan against it per component pair. */
export function symTwinIndex(comps: readonly BlueprintComponent[]): Map<number, TwinPair[]> {
  const out = new Map<number, TwinPair[]>();
  const byType = new Map<string, number[]>();
  comps.forEach((c, i) => {
    const l = byType.get(c.type);
    if (l) l.push(i); else byType.set(c.type, [i]);
  });
  const EPS = 0.011;
  for (const idxs of byType.values()) {
    const n = idxs.length;
    if (n < 2) continue;
    const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const p = comps[idxs[k]!]!.position;
      px[k] = p.x; py[k] = p.y; pz[k] = p.z;
    }
    for (let i = 0; i < n; i++) {
      const ax = px[i]!, ay = py[i]!, az = pz[i]!;
      let l: TwinPair[] | undefined;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        let m = 0, s: number, d: number;
        s = ax + px[k]!; if (s < 0) s = -s;
        d = ax - px[k]!; if (d < 0) d = -d;
        if (s < EPS && (ax > EPS || ax < -EPS)) m = 1;             // mirrored AND off-plane
        else if (d > EPS) continue;                                // neither equal nor mirrored
        s = ay + py[k]!; if (s < 0) s = -s;
        d = ay - py[k]!; if (d < 0) d = -d;
        if (s < EPS && (ay > EPS || ay < -EPS)) m |= 2;
        else if (d > EPS) continue;
        s = az + pz[k]!; if (s < 0) s = -s;
        d = az - pz[k]!; if (d < 0) d = -d;
        if (s < EPS && (az > EPS || az < -EPS)) m |= 4;
        else if (d > EPS) continue;
        if (!m) continue;
        const ci = idxs[i]!;
        if (l) l.push({ j: idxs[k]!, mask: m });
        else {
          const ex = out.get(ci);
          if (ex) ex.push({ j: idxs[k]!, mask: m });
          else out.set(ci, [{ j: idxs[k]!, mask: m }]);
        }
      }
    }
  }
  return out;
}

/** A pair PROPAGATES while it is still aligned (drift > 5 cm auto-disables
 *  — dragging one half of a broken pair must not chase a lost twin). */
export function symAllowed(index: Map<number, TwinPair[]>, symOn: boolean,
  comps: readonly BlueprintComponent[], i: number): TwinPair[] {
  if (!symOn) return [];
  return (index.get(i) ?? []).filter(p => symMaskAt(comps[i]!.position, comps[p.j]!.position, 0.05) === p.mask);
}

/** File-space move delta mirrored on the pair's mask axes. */
export function mirrorDelta(d: Vec3D, mask: number): Vec3D {
  return {
    x: mask & 1 ? -d.x : d.x,
    y: mask & 2 ? -d.y : d.y,
    z: mask & 4 ? -d.z : d.z,
  };
}

/** MIRROR-TWIN MOTION: conjugate the spin delta by R180° about every mirror
 *  NORMAL — md = det(S)·S·dq with S = diag(−1 on mask axes). The spin along
 *  a mirror NORMAL is PRESERVED (both wheels roll backwards together);
 *  tangential spins FLIP (a steered pair yaws mirror-symmetrically). One
 *  axis ⇒ (w, dx, −dy, −dz); two compose to the twist conjugation; three
 *  (point symmetry) give the plain delta. */
export function mirrorQuat(dq: FileQuat, mask: number): FileQuat {
  const sx = mask & 1 ? -1 : 1, sy = mask & 2 ? -1 : 1, sz = mask & 4 ? -1 : 1;
  const det = sx * sy * sz;
  return { w: dq.w, x: det * sx * dq.x, y: det * sy * dq.y, z: det * sz * dq.z };
}

/** Does the craft carry ANY x-mirror pair? (drives the mirror-plane option) */
export function hasMirrorX(index: Map<number, TwinPair[]>): boolean {
  for (const [, pairs] of index) if (pairs.some(p => p.mask & 1)) return true;
  return false;
}

/** v1.5.21 SETTABLE MIRROR AXIS (user: "mirror axes should be settable.
 *  Game is not hardcoded x"): every axis the craft mirrors on — the union
 *  of the geometric twin-pair masks AND the per-component `mirrorAxis`
 *  field the game itself stores (0 = none; axis indices 1=x, 2=y, 3=z, see
 *  FORMAT §components and the dev viewer's scale[mirrorAxis−1] = −1).
 *  The Engine draws one overlay sheet per bit (the legacy viewer's
 *  mask ∪ mirrorAxis precedent) and the ⚙ row adds the SESSION axis. */
export function craftMirrorMask(comps: readonly BlueprintComponent[],
  index: Map<number, TwinPair[]>): number {
  let m = 0;
  for (const [, pairs] of index) for (const p of pairs) m |= p.mask;
  for (const c of comps) {
    const a = Number((c as { mirrorAxis?: number | string }).mirrorAxis ?? 0);
    if (a >= 1 && a <= 3) m |= 1 << (Math.round(a) - 1);
  }
  return m;
}

/** v1.8.0 UNIFORM MIRROR RULE diagnostics: appearance of a component pair.
 *  A twin pair whose PAINT differs (v2 color1/color2 spec dicts or v1
 *  [slot,slot] index pairs) is a mirror-conflicting FAUX-MIRROR: it must be
 *  flagged, not silently half-painted. Returns human-readable issue strings
 *  ([] = consistent). Pure — the Engine formats the red ⚠ popup from it. */
export function compPaintDiff(
  a: BlueprintComponent['colors'], b: BlueprintComponent['colors']): string[] {
  type Norm = null | number[] | [number, number] | { c1: number[] | null; c2: number[] | null };
  const spec = (s: { r?: number; g?: number; b?: number; opacity?: number;
    roughness?: number; metallic?: number } | undefined | null) =>
    s ? [s.r ?? 0, s.g ?? 0, s.b ?? 0, s.opacity ?? 0, s.roughness ?? 0, s.metallic ?? 0] : null;
  const norm = (x: unknown): Norm => {
    if (x == null) return null;
    if (Array.isArray(x)) return x.map(Number) as [number, number];
    const d = x as { color1?: never; color2?: never };
    return { c1: spec(d.color1), c2: spec(d.color2) };
  };
  const na = norm(a), nb = norm(b);
  if (JSON.stringify(na) === JSON.stringify(nb)) return [];
  if (na === null || nb === null || Array.isArray(na) || Array.isArray(nb)) return ['paint differs'];
  const out: string[] = [];
  if (JSON.stringify(na.c1) !== JSON.stringify(nb.c1)) out.push('colour1 differs');
  if (JSON.stringify(na.c2) !== JSON.stringify(nb.c2)) out.push('colour2 differs');
  return out.length ? out : ['paint differs'];
}

export const symKeyOf = (bp: BlueprintComponent[]) => bp.length;   // cheap invalidation guard
