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

/** compIdx → its twin pairs, from LOAD-TIME geometry (same type only). */
export function symTwinIndex(comps: readonly BlueprintComponent[]): Map<number, TwinPair[]> {
  const out = new Map<number, TwinPair[]>();
  const byType = new Map<string, number[]>();
  comps.forEach((c, i) => {
    const l = byType.get(c.type);
    if (l) l.push(i); else byType.set(c.type, [i]);
  });
  for (const idxs of byType.values())
    for (const i of idxs)
      for (const j of idxs)
        if (j !== i) {
          const m = symMaskAt(comps[i]!.position, comps[j]!.position, 0.011);
          if (m) {
            const l = out.get(i);
            if (l) l.push({ j, mask: m }); else out.set(i, [{ j, mask: m }]);
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
