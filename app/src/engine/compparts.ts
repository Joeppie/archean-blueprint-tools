// compparts.ts — component placement maths: the file→view quaternion chain
// and the DISPLAY-POSE rules (pure, no THREE — pinned by vitest, applied by
// scene.ts to stand-in boxes AND real game models alike).
//
// Display poses are display-only conventions (saved quaternions stay
// file-exact — every writeback path strips them again, rotUndo):
//  • WHEEL DROOP (2026-10-19, palette-bearing files only): the blueprint stores the
//    BUILD pose; in-game a loaded wheel hangs BELOW its mount. The display
//    rolls the suspension arm to −y about the world axle (legacy viewer's
//    applyDisplayPose; vertical-axle casters can't droop and keep the pose).
//    The same-day RETIREMENT was arbitrated on the semi truck 3481322297 —
//    a palette-less legacy-generation file, where the rule stays OFF and
//    the app keeps
//    the wheelpair-verified dev-matching build pose. On modern files dev's
//    raw-quat roots are its own known bug and cannot arbitrate; the app
//    showing ISW's crawler casters sticking UP (user, 2026-10-19) settled it.
//    Pure display: saved quaternions stay file-exact (rotUndo strips).
//  • FluidJunction lies FLAT: builder cables are cached in the builder's
//    flat frame, so the comb's display pose is the RAW file quaternion
//    R(q) for BOTH generations (de-mirror v0.180: this is what the old
//    chain's (−x,−y,z,w)-in-its-mirrored-view display equated to in raw
//    terms; the byte-identical ISW modern and RCS-infinity legacy
//    junctions still render byte-identically flat).
//  • ToggleButton mounts plate-FLUSH: a local yaw-180 under the view quat.

import type { Blueprint, BlueprintComponent, FileQuat } from './format';
import { toViewQuat } from './format';
import type { ColliderRec, ModelManifest } from './models';

export type { ModelManifest };
export type V3 = readonly [number, number, number];

/** The slice of the atlas the placement maths actually consumes: colliders
 *  by type. Full ModelManifests satisfy this; tests can hand in fixtures. */
export interface CollidersEntry { colliders?: ColliderRec[] }
export type CollidersManifest = Readonly<Record<string, CollidersEntry>>;

export interface PartBox {
  ci: number;
  center: V3;   // view space
  size: V3;
}

/** one component's stand-in collider box (raw LOCAL / baked-FILE space,
 *  first collider; scene.ts hangs it under the group's content basis C —
 *  the mirrored scale.z=-1 chain was removed in v0.180 — growing a world
 *  AABB after rotation would inflate rotated parts). Footprint box when the
 *  atlas has no collider. */
export interface StandInBox { center: V3; size: V3 }

export function standInBox(c: BlueprintComponent, info: CollidersEntry | undefined): StandInBox {
  const col: ColliderRec | undefined = info?.colliders?.[0];
  if (col && col.max[0] - col.min[0] > 1e-6)
    return {
      center: [(col.min[0] + col.max[0]) / 2, (col.min[1] + col.max[1]) / 2, (col.min[2] + col.max[2]) / 2],
      size: [col.max[0] - col.min[0], col.max[1] - col.min[1], col.max[2] - col.min[2]],
    };
  const o = c.occupancies?.[0] ?? ({} as NonNullable<NonNullable<BlueprintComponent['occupancies']>[number]>);
  const cell = (n: number | undefined): number => ((n ?? 0) + 1) * 0.25;   // inclusive rule
  return { center: [0, 0, 0], size: [cell(o.size_x), cell(o.size_y), cell(o.size_z)] };
}

/** rotate v by unit quaternion (w,x,y,z) */
export function qRot(q: FileQuat, v: V3): V3 {
  // t = 2·(q.xyz × v); v' = v + w·t + q.xyz × t
  const [x, y, z] = [q.x, q.y, q.z];
  const tx = 2 * (y * v[2]! - z * v[1]!);
  const ty = 2 * (z * v[0]! - x * v[2]!);
  const tz = 2 * (x * v[1]! - y * v[0]!);
  return [
    v[0]! + q.w * tx + (y * tz - z * ty),
    v[1]! + q.w * ty + (z * tx - x * tz),
    v[2]! + q.w * tz + (x * ty - y * tx),
  ];
}

/** Hamilton product a∘b ("apply b first, then a") */
export function qMul(a: FileQuat, b: FileQuat): FileQuat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** unit-axis angle → quaternion (axis need not be normalised) */
export function qAxisAngle(axis: V3, angle: number): FileQuat {
  const l = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const h = angle / 2, s = Math.sin(h);
  return { w: Math.cos(h), x: (axis[0]! / l) * s, y: (axis[1]! / l) * s, z: (axis[2]! / l) * s };
}

/** The file→view placement map: raw AS-IS (v1.5.11 ONE raw law — the file
 *  quaternion IS the placement quaternion for BOTH generations). Kept as a
 *  named seam; see format.ts toViewQuat. */
export const fileToViewQuat = toViewQuat;

const JUNCTION_TYPES: ReadonlySet<string> = new Set(['FluidJunction']);

/**
 * The DISPLAY quaternion (view space) for a component whose file quaternion
 * is qFile and mapped view quaternion is qView. Everything except the special
 * types rides qView unchanged.
 *
 * WHEEL DROOP RE-LANDED 2026-10-19 for palette-bearing (2026-generation)
 * files, palette-less legacy-generation files excluded (user: the ISW
 * crawler's casters rendered
 * "sticking UP" in the app while the legacy JS viewer — and in-game — hang
 * them BELOW the mount). The blueprint stores the BUILD pose; the physical
 * wheel hangs, so the display rolls the suspension arm to −y about the world
 * axle (axle + tire plane untouched, rolling geometry stays exact; the
 * vertical-axle case can't droop and keeps the file pose — the legacy
 * viewer's applyDisplayPose rule, same formula). The 2026-10-19 retirement
 * (a99d801) was arbitrated on the SEMI TRUCK — a LEGACY-generation file,
 * where app == dev build pose and this rule is NOT applied; on the modern
 * ISW file dev's raw roots are its documented own bug and cannot arbitrate.
 * Pure display: rotUndo strips qDisp→qView, saved quaternions stay file-exact.
 */
export function displayQuat(type: string, qView: FileQuat, qFile: FileQuat,
  legacy = false): FileQuat {
  if (JUNCTION_TYPES.has(type))
    return { w: qFile.w, x: qFile.x, y: qFile.y, z: qFile.z };    // builder-flat comb:
    // the flat frame IS the builder's RAW pose (de-mirror v0.180: the old
    // chain's flat comb (−x,−y,z,w) in its mirrored view equals R(q) in raw
    // terms — for BOTH generations, so the RCS-infinity legacy fixture and
    // the byte-identical ISW modern junction still render identically flat)
  if (type === 'ToggleButton')
    return qMul(qView, { w: 0, x: 0, y: 1, z: 0 });                 // yaw-180 flush mount
  if (type === 'SmallWheel' && !legacy) {
    // CASTER droop roll — validated in-game for the SmallWheel casters ONLY
    // (ISW front casters, v0.134/v0.139; v1.11.5 kept the roll for that
    // case). v1.11.8 (we: "the front-wheel of the F18 seems to be rotated
    // wrong"): the F/A-18F nose gear 'Wheel' pair passed this gate and the
    // arm→down roll spun the wheel ±90° about its axle — the big gear
    // wheels are not drooping casters, they ride the plain view law
    // (v1.11.5: "compparts.ts places wheels by the plain view law").
    // The suspension arm is file +ŷ → C → −ẑ; the axle file x̂ is C-invariant.
    const A = qRot(qView, [1, 0, 0]);               // world axle direction
    const U = qRot(qView, [0, 0, -1]);              // world suspension-arm direction
    const c = -U[1]!;                               // cos/sin of the arm→down roll
    const s = -(A[2]! * U[0]! - A[0]! * U[2]!);     //   = −(A×U)·ŷ
    const L = Math.hypot(c, s);
    if (L > 0.9 && c <= 0.02 && Math.abs(A[1]!) < 0.95)   // horizontal axle, arm reachable
      return qMul(qAxisAngle(A, Math.atan2(s, c)), qView);
  }
  return qView;
}

/** The local transform that lands a WORLD-axis-aligned box (e.g. an occu-
 *  pancy cell box from buildCompProxies) under a part group sitting at
 *  `origin` with display quaternion `qDisp`:
 *  pos = qDisp⁻¹·(center − origin), quat = conjugate(qDisp) (unit quat).
 *  The box then covers exactly that world cell volume — the same box the
 *  translucent type-255 occupancy overlay draws — while still riding the
 *  group's live move/rotate edits. */
export function occStandLocal(center: V3, origin: V3, qDisp: FileQuat): { pos: V3; quat: FileQuat } {
  const inv: FileQuat = { w: qDisp.w, x: -qDisp.x, y: -qDisp.y, z: -qDisp.z };
  return {
    pos: qRot(inv, [center[0]! - origin[0]!, center[1]! - origin[1]!, center[2]! - origin[2]!]),
    quat: inv,
  };
}

/** one component → its collider boxes in view space (empty when unknown type) */
export function compPartBoxes(c: BlueprintComponent, manifest: CollidersManifest, ci: number): PartBox[] {
  const entry = manifest[c.type];
  if (!entry?.colliders?.length) return [];
  const qv = fileToViewQuat(c.orientation ?? { w: 1, x: 0, y: 0, z: 0 });
  const origin: V3 = [c.position.x, c.position.y, c.position.z];
  return entry.colliders.map(col => {
    // eight corners of the local box, spun by the placement law, grown to
    // AABB (de-mirror v0.180: local z is no longer negated for a root mirror).
    // NB: framing/ground law ONLY — the VISIBLE stand-in boxes ride the
    // content basis C explicitly in scene.ts buildComponents (v0.182); these
    // AABBs feed fit()/addGround, whose camera tuning predates the C audit.
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const lx of [col.min[0], col.max[0]])
      for (const ly of [col.min[1], col.max[1]])
        for (const lz of [col.min[2], col.max[2]]) {
          const r = qRot(qv, [lx, ly, lz]);
          for (let i = 0; i < 3; i++) {
            mn[i] = Math.min(mn[i]!, origin[i]! + r[i]!);
            mx[i] = Math.max(mx[i]!, origin[i]! + r[i]!);
          }
        }
    return {
      ci,
      center: [(mn[0]! + mx[0]!) / 2, (mn[1]! + mx[1]!) / 2, (mn[2]! + mx[2]!) / 2],
      size: [mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!],
    };
  });
}

export function buildPartBoxes(bp: Blueprint, manifest: CollidersManifest | null): PartBox[] {
  if (!manifest) return [];
  const out: PartBox[] = [];
  bp.data.components.forEach((c, ci) => {
    if (c.type === 'Build') return;              // construction-site ghost
    out.push(...compPartBoxes(c, manifest, ci));
  });
  return out;
}
