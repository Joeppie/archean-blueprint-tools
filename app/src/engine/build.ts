// build.ts — pure geometry builders: blueprint → merged solid batches.
// NO THREE, NO DOM — unit-testable and the designated future-WASM seam
// (REWRITE.md § WASM candidates, item 1: face culling + stitching).
//
// View-space convention (AGENTS "Format facts", de-mirrored v0.180): the
// display space IS the file world (FORMAT §Chirality vs in-game truth — the
// game projects raw file coordinates with standard RH camera math), so
// triangles here keep their RAW winding and normals stay outward as
// authored. Design carried from the legacy viewer (PERF.md): one merged mesh
// per distinct palette colour; wire edges in ONE buffer.

import { getBlockFaceDirections } from './blockshapes';
import type { Block, Blueprint, Vec3D } from './format';
import { CELL, isLegacyFile, worldCoord } from './format';
import { culledBlocksSolids } from './cull';
import { buildHullSkin } from './hull';
import { resolveColor, type FilePalette, type ResolvedColor } from './palette';

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

/** file world → view space: IDENTITY since the v0.180 de-mirror (kept seam) */
export const toView = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

function faceNormal(a: number[], b: number[], c: number[]): number[] {
  const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/**
 * Merge a block list into per-colour buckets (view space, flipped winding),
 * applying the game's INTERIOR-WALL rules via cull.ts (cell-cut full faces
 * stitched into rectangles, covered partials + duplicate footprints dropped,
 * translucent neighbours never cull opaque faces). The surviving edges are
 * exactly the stitched face outlines — the wire overlay draws blocks and
 * hull uniformly. Shared by the main build AND subgrid nested blocks
 * (subgrid.ts supplies the PARENT palette).
 */
export function buildBlocksSolids(
  blocks: Block[], palette: FilePalette | null, legacy: boolean,
): { buckets: Map<string, GeomBucket>; wire: number[]; blocks: number; tris: number } {
  const buckets = new Map<string, GeomBucket>();
  const wire: number[] = [];
  let tris = 0;

  const bucketFor = (slot: number): GeomBucket => {
    const color = resolveColor(palette, slot, legacy);
    const key = colorKey(color);
    let b = buckets.get(key);
    if (!b) buckets.set(key, b = { color, positions: [], normals: [], indices: [] });
    return b;
  };

  const culled = culledBlocksSolids(blocks, palette, legacy);
  for (const f of culled.tris) {
    const b = bucketFor(f.slot);
    // raw frame == view frame (v0.180): cull's authored winding is kept
    const A = toView(f.tri[0][0], f.tri[0][1], f.tri[0][2]);
    const Bv = toView(f.tri[1][0], f.tri[1][1], f.tri[1][2]);
    const C = toView(f.tri[2][0], f.tri[2][1], f.tri[2][2]);
    const nrm = faceNormal(A, Bv, C);
    const base = b.positions.length / 3;
    for (const v of [A, Bv, C]) b.positions.push(v[0], v[1], v[2]), b.normals.push(nrm[0]!, nrm[1]!, nrm[2]!);
    b.indices.push(base, base + 1, base + 2);
    tris++;
  }
  for (const [a, c] of culled.edges)
    wire.push(a[0], a[1], a[2], c[0], c[1], c[2]);

  return { buckets, wire, blocks: countBlocks(blocks), tris };
}
const countBlocks = (blocks: Block[]) => blocks.filter(b => b.type !== 255).length;

/**
 * Merge every block solid + hull triangle skin into colour buckets.
 * Interior-wall culling (legacy face-grid cut + rectangle stitch) lands in
 * the next commit — the scene is CORRECT without it, only batch-heavier.
 */
export function buildSolids(bp: Blueprint): SolidBatch {
  const legacy = isLegacyFile(bp);
  const palette = bp.data.colors ?? null;
  const { buckets, wire, blocks, tris: blockTris } = buildBlocksSolids(bp.data.blocks, palette, legacy);
  let tris = blockTris, hullTris = 0;

  // hull triangle skin: the game's closed 0.05 m prisms — colours[0] front,
  // [1] back, [2..4] side walls (hull.ts carries the exact winding).
  const skin = buildHullSkin(bp.data.triangles ?? []);
  const tri3 = (b: GeomBucket, A: readonly number[], C: readonly number[], E: readonly number[]) => {
    const nrm = faceNormal(A as number[], C as number[], E as number[]);
    const base = b.positions.length / 3;
    for (const v of [A, C, E]) b.positions.push(v[0]!, v[1]!, v[2]!), b.normals.push(nrm[0]!, nrm[1]!, nrm[2]!);
    b.indices.push(base, base + 1, base + 2);
    tris++;
  };
  for (const f of skin.faces) {
    const b = bucketForIn(buckets, f.slot, legacy, palette);
    tri3(b, f.tri[0], f.tri[1], f.tri[2]);
  }
  // NO spread: skin.wire is 18 numbers per hull triangle, and a hullified
  // giant (United airliner: 53k tris = 958k numbers) blows the engine's
  // actual-argument limit through push(...arr) — RangeError "too many
  // arguments / maximum call stack". Loop-append: identical sequence, no
  // arity ceiling (v1.5.8 fix).
  for (let i = 0; i < skin.wire.length; i++) wire.push(skin.wire[i]!);
  hullTris = skin.tris;

  return { buckets, wire, stats: { blocks, tris, hullTris } };
}

function bucketForIn(buckets: Map<string, GeomBucket>, slot: number, legacy: boolean,
  palette: FilePalette | null): GeomBucket {
  const color = resolveColor(palette, slot, legacy);
  const key = colorKey(color);
  let b = buckets.get(key);
  if (!b) buckets.set(key, b = { color, positions: [], normals: [], indices: [] });
  return b;
}

/** Component occupancy proxy boxes (file world → view boxes). */
export interface ProxyBox { min: Vec3D; size: Vec3D; ci: number }
export function buildCompProxies(bp: Blueprint): ProxyBox[] {
  const out: ProxyBox[] = [];
  bp.data.components.forEach((c, ci) => {
    if (c.type === 'Build') return;                      // construction-site ghost
    const occ = c.occupancies?.[0];
    if (!occ || occ.size_x == null) {                    // no occupancy: origin marker size
      out.push({ min: { x: c.position.x - 0.15, y: c.position.y - 0.15, z: c.position.z - 0.15 },
                 size: { x: 0.3, y: 0.3, z: 0.3 }, ci });
      return;
    }
    const min: Vec3D = {
      x: worldCoord(occ, 'x') - CELL / 2,
      y: worldCoord(occ, 'y') - CELL / 2,
      // raw frame == view frame (v0.180): z span [W − CELL/2, … + (sz+1)·CELL]
      z: worldCoord(occ, 'z') - CELL / 2,
    };
    out.push({ min, size: { x: ((occ.size_x ?? 0) + 1) * CELL, y: ((occ.size_y ?? 0) + 1) * CELL, z: ((occ.size_z ?? 0) + 1) * CELL }, ci });
  });
  return out;
}

/** sanity: face directions of a rotated block stay unit-axis (used by tests) */
export const dirsFor = (type: number) => getBlockFaceDirections(type);
