// compparts.ts — component low-poly proxy parts from the model manifest.
// Pure (no THREE, no fetch): the legacy viewer's default look is boxes
// (colliders) per component node — the manifest's per-type collider AABBs
// are exactly that. Transformed into view space with the same z-mirror +
// quaternion chain as everything else, grown to AABBs after rotation.

import type { Blueprint, BlueprintComponent, FileQuat } from './format';
import { isLegacyFile, toViewQuatLegacy, toViewQuatModern } from './format';

export interface ManifestEntry {
  colliders?: { min: [number, number, number]; max: [number, number, number] }[];
}
export type Manifest = Record<string, ManifestEntry>;

export interface PartBox {
  ci: number;
  center: [number, number, number];   // view space
  size: [number, number, number];
}

/** rotate v by unit quaternion (w,x,y,z) */
export function qRot(q: FileQuat, v: [number, number, number]): [number, number, number] {
  // t = 2·(q.xyz × v); v' = v + w·t + q.xyz × t
  const [x, y, z] = [q.x, q.y, q.z];
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + q.w * tx + (y * tz - z * ty),
    v[1] + q.w * ty + (z * tx - x * tz),
    v[2] + q.w * tz + (x * ty - y * tx),
  ];
}

function fileToViewQuat(q: FileQuat, legacy: boolean): FileQuat {
  return legacy ? toViewQuatLegacy(q) : toViewQuatModern(q);
}

/** one component → its collider boxes in view space (empty when unknown type) */
export function compPartBoxes(c: BlueprintComponent, manifest: Manifest, legacy: boolean, ci: number): PartBox[] {
  const entry = manifest[c.type];
  if (!entry?.colliders?.length) return [];
  const qv = fileToViewQuat(c.orientation ?? { w: 1, x: 0, y: 0, z: 0 }, legacy);
  const origin: [number, number, number] = [c.position.x, c.position.y, -c.position.z];
  return entry.colliders.map(col => {
    // eight corners of the local LH box, each z-mirrored then spun, grown to AABB
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const lx of [col.min[0], col.max[0]])
      for (const ly of [col.min[1], col.max[1]])
        for (const lz of [col.min[2], col.max[2]]) {
          const r = qRot(qv, [lx, ly, -lz]);
          for (let i = 0; i < 3; i++) {
            mn[i] = Math.min(mn[i]!, origin[i] + r[i]);
            mx[i] = Math.max(mx[i]!, origin[i] + r[i]);
          }
        }
    return {
      ci,
      center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2],
      size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]],
    };
  });
}

export function buildPartBoxes(bp: Blueprint, manifest: Manifest | null): PartBox[] {
  if (!manifest) return [];
  const legacy = isLegacyFile(bp);
  const out: PartBox[] = [];
  bp.data.components.forEach((c, ci) => {
    if (c.type === 'Build') return;              // construction-site ghost
    out.push(...compPartBoxes(c, manifest, legacy, ci));
  });
  return out;
}
