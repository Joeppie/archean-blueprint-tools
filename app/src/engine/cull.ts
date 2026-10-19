// cull.ts — the game's INTERIOR-WALL rules (XenonViewer port, legacy
// buildFaceGrid/buildBlockGeometry): merge-safe block solids with
//  * FULL faces cut cell-by-cell against a face grid in ABSOLUTE cell
//    coords (cross-block seams match), surviving cells stitched back into
//    rectangles (a 3 m deck = 2 quads, not 144),
//  * PARTIAL faces (slope sides, corner slants) die when fully cell-covered,
//  * two blocks presenting the SAME partial-face footprint (a slope glued to
//    a slope) form an interior partition — both copies drop, else they
//    z-fight,
//  * transparency: an opaque face survives behind a TRANSLUCENT neighbour
//    (only opaque entries cull opaque faces).
// PURE: raw file-space triangles (wound per the raw convention — since the
// v0.180 de-mirror the view builder keeps that winding as-is) + deduped
// surviving edges. This is the designated WASM seam (REWRITE.md candidate 1).

import {
  getBlockFaceDirections, getBlockFaces, getBlockPoints, isFullFace, OCCUPANCY_TYPE,
} from './blockshapes';
import type { Block } from './format';
import { CELL, CELLS_PER_FRAME, FRAME } from './format';
import { resolveColor, type FilePalette } from './palette';

type V3 = [number, number, number];

const blkCell = (b: Block): [number, number, number] => [
  (b.frame_x ?? 0) * CELLS_PER_FRAME + b.pos_x,
  (b.frame_y ?? 0) * CELLS_PER_FRAME + b.pos_y,
  (b.frame_z ?? 0) * CELLS_PER_FRAME + b.pos_z,
];
const blkSpan = (b: Block): [number, number, number] => [b.size_x + 1, b.size_y + 1, b.size_z + 1];
const cellM = (c: number) => c * CELL - FRAME / 2;          // cell boundary in world
/** absolute-cell face key (axis-tagged); ±8192 cells = frame ±682, safe int */
const faceKey = (x: number, y: number, z: number, axis: number) =>
  ((x + 8192) * 16384 + (y + 8192)) * 262144 + (z + 8192) * 3 + axis;

interface FaceEntry { block: number; opaque: boolean }

/** Every FULL face cell of every block, keyed by absolute cell + axis. */
function buildFaceGrid(blocks: Block[], palette: FilePalette | null, legacy: boolean): Map<number, FaceEntry[]> {
  const faces = new Map<number, FaceEntry[]>();
  blocks.forEach((b, index) => {
    if (b.type === OCCUPANCY_TYPE) return;
    const dirs = getBlockFaceDirections(b.type);
    for (let f = 0; f < dirs.length; f++) {
      const dir = dirs[f];
      if (!dir || !isFullFace(b.type, f)) continue;
      const slot = b.colors?.[f] ?? b.colors?.[0] ?? 0;
      const opaque = resolveColor(palette, slot, legacy).opacity >= 15;
      forEachFaceCell(b, dir, (cell, axis) => {
        const key = faceKey(cell[0]!, cell[1]!, cell[2]!, axis);
        const e = faces.get(key);
        if (!e) faces.set(key, [{ block: index, opaque }]);
        else if (!e.some(x => x.block === index)) e!.push({ block: index, opaque });
      });
    }
  });
  return faces;
}

function forEachFaceCell(b: Block, dir: readonly number[],
  visit: (cell: [number, number, number], axis: number) => void): void {
  const axis = dir[0] ? 0 : dir[1] ? 1 : 2;
  const min = blkCell(b), size = blkSpan(b);
  const plane = dir[axis]! > 0 ? min[axis]! + size[axis]! - 1 : min[axis]! - 1;
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const cell: [number, number, number] = [0, 0, 0];
  cell[axis] = plane;
  for (let i = 0; i < size[u]!; i++)
    for (let j = 0; j < size[v]!; j++) {
      cell[u] = min[u]! + i; cell[v] = min[v]! + j;
      visit(cell, axis);
    }
}

function faceCovered(faces: Map<number, FaceEntry[]>, b: Block, index: number,
  dir: readonly number[] | null | undefined, opaque: boolean): boolean {
  if (!dir || Math.abs(dir[0]!) + Math.abs(dir[1]!) + Math.abs(dir[2]!) !== 1) return false;
  const axis = dir[0] ? 0 : dir[1] ? 1 : 2;
  let covered = true;
  forEachFaceCell(b, dir, (cell) => {
    if (!covered) return;
    const entry = faces.get(faceKey(cell[0]!, cell[1]!, cell[2]!, axis)) ?? [];
    if (!entry.some(e => e.block !== index && (!opaque || e.opaque))) covered = false;
  });
  return covered;
}

const faceFootprint = (points: V3[], indices: readonly number[]): string => {
  const uniq = new Set<string>();
  for (const i of indices) { const p = points[i]!; uniq.add(`${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`); }
  return [...uniq].sort().join('|');
};

/** Quad covering spanU×spanV cells from `cell`, wound so its normal follows dir. */
function cellQuad(cell: readonly number[], axis: number, dir: readonly number[],
  spanU = 1, spanV = 1): V3[] {
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const plane = cellM(cell[axis]! + 1);           // a face lives BETWEEN cells
  const corner = (du: number, dv: number): V3 => {
    const p: V3 = [0, 0, 0];
    p[axis] = plane; p[u] = cellM(cell[u]! + du); p[v] = cellM(cell[v]! + dv);
    return p;
  };
  const quad = [corner(0, 0), corner(spanU, 0), corner(spanU, spanV), corner(0, spanV)];
  const e1 = quad[1]!.map((x, i) => x - quad[0]![i]!), e2 = quad[2]!.map((x, i) => x - quad[0]![i]!);
  const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  return n[0]! * dir[0]! + n[1]! * dir[1]! + n[2]! * dir[2]! >= 0
    ? quad : [quad[3]!, quad[2]!, quad[1]!, quad[0]!];
}

export interface CulledFace { slot: number; tri: [V3, V3, V3] }
export interface CulledBlocks { tris: CulledFace[]; edges: [V3, V3][] }

/** Cull + stitch a block list into RAW file-space triangles (wound per the
 *  raw convention) + deduped surviving edges. Slot = the face's palette slot
 *  (the colours[f] ?? colours[0] ?? 0 rule). */
export function culledBlocksSolids(blocks: Block[], palette: FilePalette | null, legacy: boolean): CulledBlocks {
  const faces = buildFaceGrid(blocks, palette, legacy);
  const tris: CulledFace[] = [];
  const edges: [V3, V3][] = [];
  const eseen = new Set<string>();
  const ek = (p: V3) => `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)},${Math.round(p[2] * 1e3)}`;
  const addEdge = (a: V3, b: V3) => {
    const ka = ek(a), kb = ek(b), k = ka < kb ? ka + ';' + kb : kb + ';' + ka;
    if (eseen.has(k)) return;
    eseen.add(k);
    edges.push([a, b]);
  };
  const kept: { pts: V3[]; idx: readonly number[]; slot: number; fp: string }[] = [];
  const footprints = new Map<string, number>();

  blocks.forEach((b, index) => {
    if (b.type === OCCUPANCY_TYPE) return;
    const origin: V3 = [
      ((b.pos_x + (b.frame_x ?? 0) * CELLS_PER_FRAME) - 5.5) * CELL - CELL / 2,
      ((b.pos_y + (b.frame_y ?? 0) * CELLS_PER_FRAME) - 5.5) * CELL - CELL / 2,
      ((b.pos_z + (b.frame_z ?? 0) * CELLS_PER_FRAME) - 5.5) * CELL - CELL / 2,
    ];
    // origin = cellM(blkCell): the cell BOUNDARY below the block's first cell
    const size: V3 = [(b.size_x + 1) * CELL, (b.size_y + 1) * CELL, (b.size_z + 1) * CELL];
    const pts = getBlockPoints(b.type, origin, size) as V3[];
    const trisOf = getBlockFaces(b.type);
    const dirs = getBlockFaceDirections(b.type);
    for (let f = 0; f < trisOf.length; f++) {
      const slot = b.colors?.[f] ?? b.colors?.[0] ?? 0;
      const opaque = resolveColor(palette, slot, legacy).opacity >= 15;
      const dir = dirs[f];
      if (dir && isFullFace(b.type, f)) {          // full face: per-cell cut + rect stitch
        const axis = dir[0] ? 0 : dir[1] ? 1 : 2, u = (axis + 1) % 3, v = (axis + 2) % 3;
        const min = blkCell(b), sz = blkSpan(b);
        const free = new Uint8Array(sz[u]! * sz[v]!);
        let freeCount = 0;
        forEachFaceCell(b, dir, (cell) => {
          const entry = faces.get(faceKey(cell[0]!, cell[1]!, cell[2]!, axis));
          if (entry?.some(e => e.block !== index && (!opaque || e.opaque))) return;
          free[(cell[u]! - min[u]!) * sz[v]! + (cell[v]! - min[v]!)] = 1;
          freeCount++;
        });
        if (!freeCount) continue;
        const emit = (i: number, j: number, w: number, h: number) => {
          const cell: [number, number, number] = [0, 0, 0];
          cell[axis] = dir[axis]! > 0 ? min[axis]! + sz[axis]! - 1 : min[axis]! - 1;
          cell[u] = min[u]! + i; cell[v] = min[v]! + j;
          const q = cellQuad(cell, axis, dir, w, h);
          tris.push({ slot, tri: [q[0]!, q[1]!, q[2]!] }, { slot, tri: [q[2]!, q[3]!, q[0]!] });
          addEdge(q[0]!, q[1]!); addEdge(q[1]!, q[2]!); addEdge(q[2]!, q[3]!); addEdge(q[3]!, q[0]!);
        };
        for (let i = 0; i < sz[u]!; i++)
          for (let j = 0; j < sz[v]!; j++) {
            if (!free[i * sz[v]! + j]) continue;
            let h = 1; while (j + h < sz[v]! && free[i * sz[v]! + j + h] === 1) h++;
            let w = 1;
            grow: while (i + w < sz[u]!) { for (let k = 0; k < h; k++) if (free[(i + w) * sz[v]! + j + k] !== 1) break grow; w++; }
            emit(i, j, w, h);
            for (let di = 0; di < w; di++) for (let dj = 0; dj < h; dj++) free[(i + di) * sz[v]! + j + dj] = 0;
          }
        continue;
      }
      if (faceCovered(faces, b, index, dir, opaque)) continue;   // interior wall
      const fp = faceFootprint(pts, trisOf[f]!);
      footprints.set(fp, (footprints.get(fp) ?? 0) + 1);
      kept.push({ pts, idx: trisOf[f]!, slot, fp });
    }
  });

  for (const face of kept) {
    if ((footprints.get(face.fp) ?? 0) > 1) continue;            // interior partition
    const P = face.idx.map(i => face.pts[i]!);
    for (let t = 0; t + 2 < P.length; t += 3) {
      tris.push({ slot: face.slot, tri: [P[t]!, P[t + 1]!, P[t + 2]!] });
      for (const [a, b] of [[P[t]!, P[t + 1]!], [P[t + 1]!, P[t + 2]!], [P[t + 2]!, P[t]!]] as [V3, V3][])
        addEdge(a, b);
    }
  }
  // Legacy kept exactly the surviving face outlines as the wire geometry.
  return { tris, edges };
}
