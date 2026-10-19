// compparts.ts — component placement maths: the file→view quaternion chain
// and the DISPLAY-POSE rules (pure, no THREE — pinned by vitest, applied by
// scene.ts to stand-in boxes AND real game models alike).
//
// Display poses are LEGACY display-only conventions (saved quaternions stay
// file-exact — the app is currently read-only, so no writeback path exists):
//  • WHEEL_TYPES droop: the file stores the BUILD pose (suspension arm
//    horizontal); an in-game loaded wheel hangs BELOW its mount. Droop = the
//    smallest world rotation about the (horizontal) axle bringing the arm to
//    −y — a physical wheel-roll; a vertical-axle caster cannot droop.
//  • FluidJunction lies FLAT: builder cables are cached in the builder's
//    flat frame, so the comb's display pose is the RAW file quaternion
//    R(q) for BOTH generations (de-mirror v0.180: this is what the old
//    chain's (−x,−y,z,w)-in-its-mirrored-view display equated to in raw
//    terms; the byte-identical ISW modern and RCS-infinity legacy
//    junctions still render byte-identically flat).
//  • ToggleButton mounts plate-FLUSH: a local yaw-180 under the view quat.

import type { Blueprint, BlueprintComponent, FileQuat } from './format';
import { isLegacyFile, toViewQuatLegacy, toViewQuatModern } from './format';
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

/** one component's stand-in collider box (raw LOCAL space, first collider;
 *  scene.ts mirrors it through the group's scale.z=-1 like the legacy
 *  colliderProxy — growing a world AABB after rotation would inflate
 *  rotated parts). Footprint box when the atlas has no collider. */
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

export const fileToViewQuat = (q: FileQuat, legacy: boolean): FileQuat =>
  legacy ? toViewQuatLegacy(q) : toViewQuatModern(q);

const WHEEL_TYPES: ReadonlySet<string> = new Set(['SmallWheel', 'Wheel', 'BigWheel']);
const JUNCTION_TYPES: ReadonlySet<string> = new Set(['FluidJunction']);

/**
 * The DISPLAY quaternion (view space) for a component whose file quaternion
 * is qFile and mapped view quaternion is qView. Everything except the three
 * special types rides qView unchanged.
 */
export function displayQuat(type: string, qView: FileQuat, qFile: FileQuat): FileQuat {
  if (JUNCTION_TYPES.has(type))
    return { w: qFile.w, x: qFile.x, y: qFile.y, z: qFile.z };    // builder-flat comb:
    // the flat frame IS the builder's RAW pose (de-mirror v0.180: the old
    // chain's flat comb (−x,−y,z,w) in its mirrored view equals R(q) in raw
    // terms — for BOTH generations, so the RCS-infinity legacy fixture and
    // the byte-identical ISW modern junction still render identically flat)
  if (type === 'ToggleButton')
    return qMul(qView, { w: 0, x: 0, y: 1, z: 0 });                 // yaw-180 flush mount
  if (!WHEEL_TYPES.has(type)) return qView;

  // suspension droop: roll about the axle until the arm (local +y) points down
  const a = qRot(qView, [1, 0, 0]);   // axle
  const u = qRot(qView, [0, 1, 0]);   // suspension arm
  const c = -u[1]!;                                       // cos of arm→down
  const s = -(a[2]! * u[0]! - a[0]! * u[2]!);             // −(a × u)·ŷ = sin
  const L = Math.hypot(c, s);
  if (L > 0.9 && c <= 0.02)                               // roll reachable
    return qMul(qAxisAngle(a, Math.atan2(s, c)), qView);
  return qView;                                           // vertical caster: keep file pose
}

/** one component → its collider boxes in view space (empty when unknown type) */
export function compPartBoxes(c: BlueprintComponent, manifest: CollidersManifest, legacy: boolean, ci: number): PartBox[] {
  const entry = manifest[c.type];
  if (!entry?.colliders?.length) return [];
  const qv = fileToViewQuat(c.orientation ?? { w: 1, x: 0, y: 0, z: 0 }, legacy);
  const origin: V3 = [c.position.x, c.position.y, c.position.z];
  return entry.colliders.map(col => {
    // eight corners of the local box, spun by the placement law, grown to
    // AABB (de-mirror v0.180: local z is no longer negated for a root mirror)
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
  const legacy = isLegacyFile(bp);
  const out: PartBox[] = [];
  bp.data.components.forEach((c, ci) => {
    if (c.type === 'Build') return;              // construction-site ghost
    out.push(...compPartBoxes(c, manifest, legacy, ci));
  });
  return out;
}
