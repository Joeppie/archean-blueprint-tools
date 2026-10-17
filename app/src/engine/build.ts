// build.ts — pure geometry builders: blueprint → merged solid batches.
// NO THREE, NO DOM — unit-testable and the designated future-WASM seam
// (REWRITE.md § WASM candidates, item 1: face culling + stitching).
//
// View-space convention (AGENTS "Format facts"): display space z-mirrors the
// file world (view = x, y, −z), which FLIPS triangle handedness — every
// triangle here is emitted with REVERSED winding so normals stay outward.
// Design carried from the legacy viewer (PERF.md): one merged mesh per
// distinct palette colour; wire edges in ONE buffer.

import { getBlockEdges, getBlockFaceDirections, getBlockFaces, getBlockPoints, OCCUPANCY_TYPE } from './blockshapes';
import type { Blueprint, Vec3D } from './format';
import { CELL, isLegacyFile, worldCoord } from './format';
import { buildHullSkin } from './hull';
import { resolveColor, type ResolvedColor } from './palette';

export interface GeomBucket {
  color: ResolvedColor;
  positions: number[];
  normals: number[];
  indices: number[];
}

export interface SolidBatch {
  /** merged solid geometry keyed by resolved-colour signature */
  buckets: Map<string, GeomBucket>;
  /** wireframe edge segments (view space), 2 vertices per edge: block edges
   *  + the hull surface edges (legacy hullWire covers both uniformly) */
  wire: number[];
  stats: { blocks: number; tris: number; hullTris: number };
}

export function colorKey(c: ResolvedColor): string {
  return `${c.r}|${c.g}|${c.b}|${c.opacity}|${c.roughness}|${c.metallic}`;
}

/** file world → view space (z-mirror) */
export const toView = (x: number, y: number, z: number): [number, number, number] => [x, y, -z];

function faceNormal(a: number[], b: number[], c: number[]): number[] {
  const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/**
 * Merge every block solid + hull triangle skin into colour buckets.
 * Interior-wall culling (legacy face-grid cut + rectangle stitch) lands in
 * the next commit — the scene is CORRECT without it, only batch-heavier.
 */
export function buildSolids(bp: Blueprint): SolidBatch {
  const legacy = isLegacyFile(bp);
  const palette = bp.data.colors ?? null;
  const buckets = new Map<string, GeomBucket>();
  const wire: number[] = [];
  let blocks = 0, tris = 0, hullTris = 0;

  const bucketFor = (slot: number): GeomBucket => {
    const color = resolveColor(palette, slot, legacy);
    const key = colorKey(color);
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { color, positions: [], normals: [], indices: [] });
    return b;
  };

  // emit one outward-wound triangle (the caller hands final winding)
  const tri3 = (b: GeomBucket, A: [number, number, number], C: [number, number, number], E: [number, number, number]) => {
    const n = faceNormal(A, C, E);
    const base = b.positions.length / 3;
    for (const v of [A, C, E]) b.positions.push(v[0], v[1], v[2]), b.normals.push(n[0]!, n[1]!, n[2]!);
    b.indices.push(base, base + 1, base + 2);
    tris++;
  };

  for (const blk of bp.data.blocks) {
    if (blk.type === OCCUPANCY_TYPE) continue;
    blocks++;
    const origin: [number, number, number] = [
      worldCoord(blk, 'x') - CELL / 2,
      worldCoord(blk, 'y') - CELL / 2,
      worldCoord(blk, 'z') - CELL / 2,
    ];
    // block size is INCLUSIVE cell count: span = (size+1)·CELL (legacy blkSpan)
    const size: [number, number, number] = [(blk.size_x + 1) * CELL, (blk.size_y + 1) * CELL, (blk.size_z + 1) * CELL];
    const pts = getBlockPoints(blk.type, origin, size).map(p => toView(p[0], p[1], p[2]));

    const faces = getBlockFaces(blk.type);
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi]!;
      const slot = blk.colors?.[fi] ?? 0;
      const b = bucketFor(slot);
      if (f.length === 6) { tri3(b, pts[f[0]!]!, pts[f[2]!]!, pts[f[1]!]!); tri3(b, pts[f[3]!]!, pts[f[5]!]!, pts[f[4]!]!); }
      else tri3(b, pts[f[0]!]!, pts[f[2]!]!, pts[f[1]!]!);
    }
    for (const [a, c] of getBlockEdges(blk.type)) {
      const A = pts[a]!, C = pts[c]!;
      wire.push(A[0]!, A[1]!, A[2]!, C[0]!, C[1]!, C[2]!);
    }
  }

  // hull triangle skin: the game's closed 0.05 m prisms — colours[0] front,
  // [1] back, [2..4] side walls (hull.ts carries the exact winding).
  const skin = buildHullSkin(bp.data.triangles);
  for (const f of skin.faces) {
    const b = bucketFor(f.slot);
    tri3(b, f.tri[0] as [number, number, number], f.tri[1] as [number, number, number], f.tri[2] as [number, number, number]);
  }
  wire.push(...skin.wire);
  hullTris = skin.tris;

  return { buckets, wire, stats: { blocks, tris, hullTris } };
}

/** Component occupancy proxy boxes (file world → view boxes). */
export interface ProxyBox { min: Vec3D; size: Vec3D; ci: number }
export function buildCompProxies(bp: Blueprint): ProxyBox[] {
  const out: ProxyBox[] = [];
  bp.data.components.forEach((c, ci) => {
    if (c.type === 'Build') return;                      // construction-site ghost
    const occ = c.occupancies;
    if (!occ || occ.size_x == null) {                    // no occupancy: origin marker size
      out.push({ min: { x: c.position.x - 0.15, y: c.position.y - 0.15, z: -c.position.z - 0.15 },
                 size: { x: 0.3, y: 0.3, z: 0.3 }, ci });
      return;
    }
    const min: Vec3D = {
      x: worldCoord(occ, 'x') - CELL / 2,
      y: worldCoord(occ, 'y') - CELL / 2,
      // view z spans [−(W + sz·CELL + CELL/2), −(W − CELL/2)] (legacy view3d
      // occupancy box; with the inclusive rule the span is (sz+1)·CELL)
      z: -(worldCoord(occ, 'z') + (occ.size_z ?? 0) * CELL + CELL / 2),
    };
    out.push({ min, size: { x: ((occ.size_x ?? 0) + 1) * CELL, y: ((occ.size_y ?? 0) + 1) * CELL, z: ((occ.size_z ?? 0) + 1) * CELL }, ci });
  });
  return out;
}

/** sanity: face directions of a rotated block stay unit-axis (used by tests) */
export const dirsFor = (type: number) => getBlockFaceDirections(type);
