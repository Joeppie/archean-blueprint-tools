// engine/import.ts — the EXTERNAL MODEL QUANTISER (docs/IMPORT-3D.md).
//
// The one quantiser the PREVIEW LAW demands: the preview layer and the import
// commit run THIS module — the preview never lies about what will be written.
//   normalise (axis map + span fit + centre) → decimate (meshoptimizer QEM,
//   weld + lock border) → snap to the g lattice (+ degen cull) →
//   mode `blocks`: SDF flood voxels (yz-bucket +x-ray parity) → shell →
//   greedy box merge → blockFromCell records | mode `skin`: the
//   encodeSkinTri → splitFace chain (the pinned window law, as in
//   balloonfin's emit helper).
// Honest counts, never silent: skipped faces, rescued (split) faces,
// non-manifold edges, degenerate faces all ship in the stats.
//
// Units: `g` cell-lattice ints (world = (g − 6)·CELL, the latsphere.ts law).

import { CELL } from './format';
import type { Block, Triangle } from './format';
import { blockFromCell } from './blocks';
import { encodeSkinTri, splitFace } from './latsphere';
import type { GP3, SkinOptions } from './latsphere';
import { DEFAULT_PALETTE } from './palette';
import { MATERIAL_DENSITY } from './mass';
import { TRIANGLE_THICKNESS } from './economy';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

type Cell3 = [number, number, number];

/** A source triangle soup in METRES (source frame, Y-up or Z-up — see
 *  ImportOptions.up). pos = xyz×3 per triangle; col = rgb 0..1 LINEAR per
 *  vertex (optional). */
export interface SrcMesh {
  pos: Float32Array;
  col?: Float32Array;
}

export interface ImportOptions {
  span: number;                    // target cell count of the LONGEST axis
  up: 'y' | 'z';                   // the source's up axis
  yaw: 0 | 90 | 180 | 270;         // extra turn about world y after mapping
  offset: Cell3;                   // integer-cell shift of the centred model
  mode: 'blocks' | 'skin';
  decimate: boolean;               // THE default: found models are too dense
  budget: number;                  // triangle budget for the QEM pass
  shell: boolean;                  // blocks: keep the boundary shell only
  slot: number;                    // single-colour mode's palette slot
  perTriColor: boolean;            // quantise source colours to slots
  material: number;                // gameplay material 0..6
  gridCap: number;                 // voxels per axis ceiling
}

export const IMPORT_DEFAULTS: ImportOptions = {
  span: 48, up: 'y', yaw: 0, offset: [0, 0, 0], mode: 'blocks',
  decimate: true, budget: 3000, shell: true, slot: 4, perTriColor: true,
  material: 0, gridCap: 128,
};

export interface ImportStats {
  srcTris: number; decTris: number; degenerate: number;
  cells: number; blocks: number; skinTris: number;
  skipped: number; rescued: number; nonManifold: number; massKg: number;
}

export interface ImportResult {
  ok: boolean; reason?: string;
  blocks: Block[]; triangles: Triangle[];
  ghost: Float32Array;   // the decimated pre-snap mesh in METRES (world)
  nmEdges: Float32Array; // non-manifold edge SEGMENTS (xyz xyz …) in metres
  stats: ImportStats;
}

const dens = (m: number): number =>
  m >= 0 && m < MATERIAL_DENSITY.length ? MATERIAL_DENSITY[m]! : 1;

// ---------- palette quantiser ----------

/** Nearest built-in slot to a LINEAR rgb (0..1), scanning the real 256-slot
 *  table (slots 0..10 are engine-reserved). Squared distance in the
 *  palette's native LINEAR space. */
export function slotForLinear(r: number, g: number, b: number): number {
  let best = IMPORT_DEFAULTS.slot, bd = Infinity;
  for (let s = 11; s < DEFAULT_PALETTE.length; s++) {
    const e = DEFAULT_PALETTE[s];
    if (!e) continue;
    const dr = e.r / 255 - r, dg = e.g / 255 - g, db = e.b / 255 - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// ---------- normalise ----------

/** Merge soups to one soup; map a z-up source to y-up (mirrors the space →
 *  swap v1,v2 to keep winding outward); centre on the world origin; scale so
 *  the longest axis spans `span` cells; yaw by exact 90° turns about +y;
 *  convert to g lattice units (float). */
export function normalise(srcs: SrcMesh[], o: ImportOptions):
  { gpos: Float32Array; gcol: Float32Array | null; tris: number } {
  const total = srcs.reduce((n, m) => n + m.pos.length / 3, 0);
  const w = new Float32Array(total * 3);
  const c = srcs.some(m => m.col) ? new Float32Array(total * 3) : null;
  let p = 0, cp = 0;
  for (const m of srcs) {
    for (let i = 0; i < m.pos.length; i += 3) {
      if (o.up === 'y') {
        w[p] = m.pos[i]!; w[p + 1] = m.pos[i + 1]!; w[p + 2] = m.pos[i + 2]!;
      } else {  // z-up → y-up: (x, y, z) → (x, z, y)
        w[p] = m.pos[i]!; w[p + 1] = m.pos[i + 2]!; w[p + 2] = m.pos[i + 1]!;
      }
      p += 3;
      if (c) {
        const mc = m.col;
        if (mc) { c[cp] = mc[i]!; c[cp + 1] = mc[i + 1]!; c[cp + 2] = mc[i + 2]!; }
        else { c[cp] = .5; c[cp + 1] = .5; c[cp + 2] = .5; }
        cp += 3;
      }
    }
  }
  if (o.up === 'z')
    for (let t = 0; t < total; t += 3)
      for (let k = 0; k < 3; k++) {
        const A = (t + 1) * 3 + k, B = (t + 2) * 3 + k;
        const s = w[A]!; w[A] = w[B]!; w[B] = s;
        if (c) { const s2 = c[A]!; c[A] = c[B]!; c[B] = s2; }
      }
  // centre + span-fit
  let mnX = Infinity, mnY = Infinity, mnZ = Infinity,
    mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
  for (let i = 0; i < w.length; i += 3) {
    if (w[i]! < mnX) mnX = w[i]!; if (w[i]! > mxX) mxX = w[i]!;
    if (w[i + 1]! < mnY) mnY = w[i + 1]!; if (w[i + 1]! > mxY) mxY = w[i + 1]!;
    if (w[i + 2]! < mnZ) mnZ = w[i + 2]!; if (w[i + 2]! > mxZ) mxZ = w[i + 2]!;
  }
  const ctrX = (mnX + mxX) / 2, ctrY = (mnY + mxY) / 2, ctrZ = (mnZ + mxZ) / 2;
  const maxExt = Math.max(mxX - mnX, mxY - mnY, mxZ - mnZ) || 1;
  const k = (o.span * CELL) / maxExt;
  const sn = ((Math.round(o.yaw / 90) % 4) + 4) % 4;
  const cos = [1, 0, -1, 0][sn]!, sin = [0, 1, 0, -1][sn]!;
  const gpos = new Float32Array(w.length);
  for (let i = 0; i < w.length; i += 3) {
    const x = (w[i]! - ctrX) * k, y = (w[i + 1]! - ctrY) * k,
      z = (w[i + 2]! - ctrZ) * k;
    const rx = x * cos + z * sin, rz = -x * sin + z * cos;
    gpos[i] = rx / CELL + 6 + o.offset[0];
    gpos[i + 1] = y / CELL + 6 + o.offset[1];
    gpos[i + 2] = rz / CELL + 6 + o.offset[2];
  }
  return { gpos, gcol: c, tris: w.length / 9 };
}

// ---------- decimate (meshoptimizer QEM) ----------

/** Weld by g-position (1e-4), lock border vertices (directed edges without
 *  their reverse twin), simplifyWithAttributes with LockBorder, expand back
 *  to a soup. Colours ride as vertex attributes (weight < position). */
export async function decimate(
  gpos: Float32Array, gcol: Float32Array | null, budget: number,
): Promise<{ gpos: Float32Array; gcol: Float32Array | null; tris: number }> {
  const n = gpos.length / 3;
  if (n <= budget * 3) return { gpos, gcol, tris: n / 3 };
  await MeshoptSimplifier.ready;
  const key = new Map<string, number>();
  const map = new Uint32Array(n);
  const wpos = new Float32Array(n * 3);
  const wcol = gcol ? new Float32Array(n * 3) : null;
  let wc = 0;
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(gpos[i * 3]! * 1e4)},` +
      `${Math.round(gpos[i * 3 + 1]! * 1e4)},${Math.round(gpos[i * 3 + 2]! * 1e4)}`;
    let j = key.get(k);
    if (j === undefined) {
      j = wc++;
      key.set(k, j);
      wpos[j * 3] = gpos[i * 3]!; wpos[j * 3 + 1] = gpos[i * 3 + 1]!;
      wpos[j * 3 + 2] = gpos[i * 3 + 2]!;
      if (wcol && gcol) {
        wcol[j * 3] = gcol[i * 3]!; wcol[j * 3 + 1] = gcol[i * 3 + 1]!;
        wcol[j * 3 + 2] = gcol[i * 3 + 2]!;
      }
    }
    map[i] = j;
  }
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = map[i]!;
  // meshopt forbids duplicate vertices: hand it the used weld prefix only
  const wposU = wpos.subarray(0, wc * 3);
  const wcolU = wcol ? wcol.subarray(0, wc * 3) : null;
  const ek = (a: number, b: number) => a * 1e7 + b;
  const directed = new Set<number>();
  for (let t = 0; t < idx.length; t += 3) {
    directed.add(ek(idx[t]!, idx[t + 1]!));
    directed.add(ek(idx[t + 1]!, idx[t + 2]!));
    directed.add(ek(idx[t + 2]!, idx[t]!));
  }
  const border = new Uint8Array(wc);
  for (const d of directed) {
    const a = Math.floor(d / 1e7), b = d % 1e7;
    if (!directed.has(ek(b, a))) { border[a] = 1; border[b] = 1; }
  }
  const target = Math.min(
    Math.max(3, Math.floor(budget / 3) * 3) * 3, idx.length - (idx.length % 3));
  const attrs = wcolU ?? wposU;
  // meshopt is all-or-nothing on its RELATIVE target_error: try the budget
  // at a tight tolerance, escalate (the lattice quantiser downstream is far
  // coarser than a few % of the bbox diagonal).
  let res: Uint32Array = idx, cnt = idx.length;
  for (const tol of [0.01, 0.1, 0.3]) {
    const [r] = MeshoptSimplifier.simplifyWithAttributes(
      idx, wposU, 3, attrs, 3, wcolU ? [0.5, 0.5, 0.5] : [0, 0, 0],
      border, target, tol, ['LockBorder'],
    );
    res = r; cnt = r.length;               // v1.1 wrapper: [indices, error]
    if (cnt < idx.length) break;
  }
  const out = new Float32Array(cnt * 9);
  const ocol = wcol ? new Float32Array(cnt * 9) : null;
  for (let i = 0; i < cnt; i++) {
    const v = res[i]!;
    out[i * 9] = wpos[v * 3]!; out[i * 9 + 1] = wpos[v * 3 + 1]!;
    out[i * 9 + 2] = wpos[v * 3 + 2]!; out[i * 9 + 3] = wpos[v * 3 + 3]!;
    out[i * 9 + 4] = wpos[v * 3 + 4]!; out[i * 9 + 5] = wpos[v * 3 + 5]!;
    out[i * 9 + 6] = wpos[v * 3 + 6]!; out[i * 9 + 7] = wpos[v * 3 + 7]!;
    out[i * 9 + 8] = wpos[v * 3 + 8]!;
    if (ocol && wcol) {
      ocol[i * 9] = wcol[v * 3]!; ocol[i * 9 + 1] = wcol[v * 3 + 1]!;
      ocol[i * 9 + 2] = wcol[v * 3 + 2]!; ocol[i * 9 + 3] = wcol[v * 3 + 3]!;
      ocol[i * 9 + 4] = wcol[v * 3 + 4]!; ocol[i * 9 + 5] = wcol[v * 3 + 5]!;
      ocol[i * 9 + 6] = wcol[v * 3 + 6]!; ocol[i * 9 + 7] = wcol[v * 3 + 7]!;
      ocol[i * 9 + 8] = wcol[v * 3 + 8]!;
    }
  }
  return { gpos: out, gcol: ocol, tris: cnt / 3 };
}

// ---------- lattice snap ----------

/** Snap g floats to ints; drop faces sharing a lattice corner (degenerate);
 *  carry per-triangle mean colour. */
export function snap(gpos: Float32Array, gcol: Float32Array | null): {
  tris: Int32Array; cols: Float32Array; n: number; degenerate: number;
} {
  const nt = gpos.length / 9;
  const out = new Int32Array(nt * 9);
  const cols = new Float32Array(nt * 3);
  let n = 0, degenerate = 0;
  for (let t = 0; t < nt; t++) {
    const a: Cell3 = [Math.round(gpos[t * 9]!), Math.round(gpos[t * 9 + 1]!),
      Math.round(gpos[t * 9 + 2]!)];
    const b: Cell3 = [Math.round(gpos[t * 9 + 3]!), Math.round(gpos[t * 9 + 4]!),
      Math.round(gpos[t * 9 + 5]!)];
    const c: Cell3 = [Math.round(gpos[t * 9 + 6]!), Math.round(gpos[t * 9 + 7]!),
      Math.round(gpos[t * 9 + 8]!)];
    const eq = (u: Cell3, v: Cell3) =>
      u[0] === v[0] && u[1] === v[1] && u[2] === v[2];
    if (eq(a, b) || eq(b, c) || eq(a, c)) { degenerate++; continue; }
    out.set([...a, ...b, ...c], n * 9);
    if (gcol)
      for (let ax = 0; ax < 3; ax++)
        cols[n * 3 + ax] = (gcol[t * 9 + ax]! + gcol[t * 9 + 3 + ax]! +
          gcol[t * 9 + 6 + ax]!) / 3;
    n++;
  }
  return { tris: out.subarray(0, n * 9), cols, n, degenerate };
}

// ---------- voxels: SDF flood (yz-bucket +x-ray parity) ----------

export interface Vox {
  vox: Uint8Array; nx: number; ny: number; nz: number;
  bx: number; by: number; bz: number; cells: number;
}

/** Classify every grid cell by the parity of +x-ray crossings. Triangles are
 *  bucketed by their yz bbox (grid rows); a row with no bucket is all-outside.
 *  Input: snapped (integer) g triangles. Grid covers the bbox padded 1 cell. */
export function voxelize(tris: Int32Array, n: number, gridCap: number):
  { ok: true; v: Vox } | { ok: false; reason: string } {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 9; i += 3)
    for (let a = 0; a < 3; a++) {
      const v = tris[i + a]!;
      if (v < lo[a]!) lo[a] = v;
      if (v > hi[a]!) hi[a] = v;
    }
  const bx = lo[0]! - 1, by = lo[1]! - 1, bz = lo[2]! - 1;
  const nx = hi[0]! - bx + 1, ny = hi[1]! - by + 1, nz = hi[2]! - bz + 1;
  if (nx > gridCap || ny > gridCap || nz > gridCap)
    return {
      ok: false,
      reason: `model too large: ${nx}×${ny}×${nz} cells (cap ${gridCap}) — lower the span`,
    };
  const vox = new Uint8Array(nx * ny * nz);
  // yz buckets (row = grid (y, z)). Range widened ±1: the ray sample uses
  // irrational offsets below, so rows within 1 cell can carry hits.
  const rowRange = (t: number): [number, number, number, number] => {
    const yA = Math.min(tris[t * 9 + 1]!, tris[t * 9 + 4]!, tris[t * 9 + 7]!),
      yB = Math.max(tris[t * 9 + 1]!, tris[t * 9 + 4]!, tris[t * 9 + 7]!),
      zA = Math.min(tris[t * 9 + 2]!, tris[t * 9 + 5]!, tris[t * 9 + 8]!),
      zB = Math.max(tris[t * 9 + 2]!, tris[t * 9 + 5]!, tris[t * 9 + 8]!);
    return [
      Math.max(0, Math.floor(yA - by) - 1), Math.min(ny, Math.floor(yB - by) + 2),
      Math.max(0, Math.floor(zA - bz) - 1), Math.min(nz, Math.floor(zB - bz) + 2),
    ];
  };
  const counts = new Int32Array(ny * nz);
  for (let t = 0; t < n; t++) {
    const [y0, y1, z0, z1] = rowRange(t);
    for (let z = z0; z < z1; z++)
      for (let y = y0; y < y1; y++) counts[y + z * ny]!++;
  }
  const offs = new Int32Array(ny * nz + 1);
  for (let i = 0; i < ny * nz; i++) offs[i + 1] = offs[i]! + counts[i]!;
  const fill = offs.slice(0, ny * nz);
  const list = new Int32Array(offs[ny * nz]!);
  for (let t = 0; t < n; t++) {
    const [y0, y1, z0, z1] = rowRange(t);
    for (let z = z0; z < z1; z++)
      for (let y = y0; y < y1; y++) list[fill[y + z * ny]!++] = t;
  }
  const hits = new Float32Array(n + 1);
  let cells = 0;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const s = offs[y + z * ny]!, e = offs[y + z * ny + 1]!;
      if (e === s) continue;
      const oy = y + 0.5 + 0.137, oz = z + 0.5 + 0.373;  // GRID coords,
      //   irrational-style offsets: no ray ever grazes a lattice diagonal
      let nh = 0;
      for (let k = s; k < e; k++) {
        const o = list[k]! * 9;
        const x0 = tris[o]! - bx, y0 = tris[o + 1]! - by, z0 = tris[o + 2]! - bz,
          x1 = tris[o + 3]! - bx, y1 = tris[o + 4]! - by, z1 = tris[o + 5]! - bz,
          x2 = tris[o + 6]! - bx, y2 = tris[o + 7]! - by, z2 = tris[o + 8]! - bz;
        const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0,
          e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
        // Möller–Trumbore, canonical form with p = d×e2, d = (1,0,0), ray
        // origin x = −0.5 (before the grid); all coords GRID space.
        const det = e1z * e2y - e1y * e2z;      // e1·(d×e2), p = (0,−e2z, e2y)
        if (Math.abs(det) < 1e-9) continue;     // ray parallel to the face plane
        const inv = 1 / det;
        const Tx = -0.5 - x0, Ty = oy - y0, Tz = oz - z0;
        const u = (-Ty * e2z + Tz * e2y) * inv;
        if (u < 0 || u > 1) continue;
        const Qx = Ty * e1z - Tz * e1y;
        const v = Qx * inv;                     // d·Q = Qx
        if (v < 0 || u + v > 1) continue;
        const Qy = Tz * e1x - Tx * e1z, Qz = Tx * e1y - Ty * e1x;
        const t = (e2x * Qx + e2y * Qy + e2z * Qz) * inv;
        if (t > 0) hits[nh++] = -0.5 + t;
      }
      if (nh === 0) continue;
      const hs = hits.subarray(0, nh);
      hs.sort();               // TypedArray sort = numeric ascending
      let parity = 0, hx = 0;
      for (let x = 0; x < nx; x++) {
        const cx = x + 0.5;
        while (hx < nh && hs[hx]! < cx) { parity++; hx++; }
        if (parity & 1) { vox[x + y * nx + z * nx * ny] = 1; cells++; }
      }
    }
  }
  return { ok: true, v: { vox, nx, ny, nz, bx, by, bz, cells } };
}

export function shellOf(v: Vox): Vox {
  const { vox, nx, ny, nz, bx, by, bz } = v;
  const out = new Uint8Array(vox.length);
  let cells = 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = x + y * nx + z * nx * ny;
        if (!vox[i]) continue;
        const open = x === 0 || y === 0 || z === 0 || x === nx - 1 ||
          y === ny - 1 || z === nz - 1 ||
          !vox[i - 1] || !vox[i + 1] || !vox[i - nx] || !vox[i + nx] ||
          !vox[i - nx * ny] || !vox[i + nx * ny];
        if (open) { out[i] = 1; cells++; }
      }
  return { vox: out, nx, ny, nz, bx, by, bz, cells };
}

// ---------- greedy box merge ----------

export interface Box { c: Cell3; s: Cell3 }   // start cell + size FIELDS (cells−1)

const MAXD = 25; // 24 size field + 1 cell

export function greedyBoxes(v: Vox): Box[] {
  const { vox, nx, ny, nz, bx, by, bz } = v;
  const boxes: Box[] = [];
  const covered = new Uint8Array(vox.length);
  const free = (x: number, y: number, z: number): boolean => {
    const j = x + y * nx + z * nx * ny;
    return !!vox[j] && !covered[j];
  };
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        if (!free(x, y, z)) continue;
        let w = 1;
        while (w < MAXD && x + w < nx && free(x + w, y, z)) w++;
        let h = 1;
        growY: while (h < MAXD && y + h < ny) {
          for (let xx = x; xx < x + w; xx++)
            if (!free(xx, y + h, z)) break growY;
          h++;
        }
        let d = 1;
        growZ: while (d < MAXD && z + d < nz) {
          for (let yy = y; yy < y + h; yy++)
            for (let xx = x; xx < x + w; xx++)
              if (!free(xx, yy, z + d)) break growZ;
          d++;
        }
        for (let zz = z; zz < z + d; zz++)
          for (let yy = y; yy < y + h; yy++)
            for (let xx = x; xx < x + w; xx++)
              covered[xx + yy * nx + zz * nx * ny] = 1;
        boxes.push({
          c: [x + bx, y + by, z + bz],
          s: [w - 1, h - 1, d - 1],
        });
      }
  return boxes;
}

// ---------- emitters ----------

export function emitBlocks(boxes: Box[], slot: number, material: number): Block[] {
  return boxes.map(b => blockFromCell(b.c, b.s, 0, slot, material));
}

/** The pinned chain (balloonfin's emit helper): encodeSkinTri, on null
 *  splitFace, on null skipped. Non-manifold census over the snapped soup. */
export function emitSkin(g: { tris: Int32Array; cols: Float32Array; n: number },
  opts: ImportOptions): {
    triangles: Triangle[]; nmEdges: Float32Array; skipped: number; rescued: number;
  } {
  const triangles: Triangle[] = [];
  let skipped = 0, rescued = 0;
  for (let t = 0; t < g.n; t++) {
    const v0: GP3 = [g.tris[t * 9]!, g.tris[t * 9 + 1]!, g.tris[t * 9 + 2]!];
    const v1: GP3 = [g.tris[t * 9 + 3]!, g.tris[t * 9 + 4]!, g.tris[t * 9 + 5]!];
    const v2: GP3 = [g.tris[t * 9 + 6]!, g.tris[t * 9 + 7]!, g.tris[t * 9 + 8]!];
    const slot = opts.perTriColor
      ? slotForLinear(g.cols[t * 3]!, g.cols[t * 3 + 1]!, g.cols[t * 3 + 2]!)
      : opts.slot;
    const o: SkinOptions = { slot, material: opts.material };
    const rec = encodeSkinTri([v0, v1, v2], o);
    if (rec) { triangles.push(rec); continue; }
    const parts = splitFace([v0, v1, v2], o);
    if (parts && parts.length) { triangles.push(...parts); rescued++; }
    else skipped++;
  }
  // non-manifold census: undirected lattice edges with count ≠ 2
  const vid = new Map<string, number>();
  const verts: GP3[] = [];
  const id = (v: GP3): number => {
    const k = `${v[0]},${v[1]},${v[2]}`;
    let i = vid.get(k);
    if (i === undefined) { i = verts.length; vid.set(k, i); verts.push(v); }
    return i;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < g.n; t++) {
    const vs = [
      [g.tris[t * 9]!, g.tris[t * 9 + 1]!, g.tris[t * 9 + 2]!] as GP3,
      [g.tris[t * 9 + 3]!, g.tris[t * 9 + 4]!, g.tris[t * 9 + 5]!] as GP3,
      [g.tris[t * 9 + 6]!, g.tris[t * 9 + 7]!, g.tris[t * 9 + 8]!] as GP3,
    ];
    const ids = vs.map(id);
    for (let e = 0; e < 3; e++) {
      const a = ids[e]!, b = ids[(e + 1) % 3]!;
      const k = Math.min(a, b) + ':' + Math.max(a, b);
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  const seg: number[] = [];
  for (const [k, c] of edges) {
    if (c === 2) continue;
    const [a, b] = k.split(':').map(Number) as [number, number];
    const va = verts[a]!, vb = verts[b]!;
    seg.push((va[0]! - 6) * CELL, (va[1]! - 6) * CELL, (va[2]! - 6) * CELL,
      (vb[0]! - 6) * CELL, (vb[1]! - 6) * CELL, (vb[2]! - 6) * CELL);
  }
  return { triangles, nmEdges: new Float32Array(seg), skipped, rescued };
}

// ---------- mass ----------

function blockKg(b: Block): number {
  const cells = (b.size_x + 1) * (b.size_y + 1) * (b.size_z + 1);
  return cells * (b.type === 0 ? 1 : 0.5) * dens(b.material ?? 0);
}

function triKg(t: Triangle): number {
  const P: number[][] = [0, 1, 2].map(i => (['x', 'y', 'z'] as const).map(ax =>
    ((t[`v${i}_${ax}`] as number) + 12 * (t[`frame_${ax}`] as number)) * CELL - 1.5));
  const ab = [0, 1, 2].map(i => P[1]![i]! - P[0]![i]!);
  const ac = [0, 1, 2].map(i => P[2]![i]! - P[0]![i]!);
  const cr = [
    ab[1]! * ac[2]! - ab[2]! * ac[1]!,
    ab[2]! * ac[0]! - ab[0]! * ac[2]!,
    ab[0]! * ac[1]! - ab[1]! * ac[0]!,
  ];
  const area = Math.hypot(cr[0]!, cr[1]!, cr[2]!) / 2;
  return area * TRIANGLE_THICKNESS / (CELL ** 3) * dens((t.material as number) ?? 0);
}

// ---------- top level ----------

export async function runImport(srcs: SrcMesh[], o: ImportOptions):
  Promise<ImportResult> {
  const stats: ImportStats = {
    srcTris: 0, decTris: 0, degenerate: 0, cells: 0, blocks: 0, skinTris: 0,
    skipped: 0, rescued: 0, nonManifold: 0, massKg: 0,
  };
  const empty: ImportResult = {
    ok: false, blocks: [], triangles: [], ghost: new Float32Array(0),
    nmEdges: new Float32Array(0), stats,
  };
  const nm = normalise(srcs, o);
  stats.srcTris = nm.tris;
  if (nm.tris === 0) return { ...empty, reason: 'no triangles' };
  const dec = o.decimate ? await decimate(nm.gpos, nm.gcol, o.budget) : nm;
  stats.decTris = dec.tris;
  const g = snap(dec.gpos, dec.gcol);
  stats.degenerate = g.degenerate;
  if (g.n === 0)
    return { ...empty, reason: 'everything collapsed at the lattice — raise the span' };
  const ghost = new Float32Array(dec.gpos.length);
  for (let i = 0; i < ghost.length; i++) ghost[i] = (dec.gpos[i]! - 6) * CELL;
  if (o.mode === 'blocks') {
    const v = voxelize(g.tris, g.n, o.gridCap);
    if (!v.ok) return { ...empty, reason: v.reason, ghost };
    const sh = o.shell ? shellOf(v.v) : v.v;
    const boxes = greedyBoxes(sh);
    const blocks = emitBlocks(boxes, o.slot, o.material);
    stats.cells = sh.cells;
    stats.blocks = blocks.length;
    stats.massKg = blocks.reduce((s, b) => s + blockKg(b), 0);
    return {
      ok: true, blocks, triangles: [], ghost,
      nmEdges: new Float32Array(0), stats,
    };
  }
  const skin = emitSkin(g, o);
  stats.skinTris = skin.triangles.length;
  stats.skipped = skin.skipped;
  stats.rescued = skin.rescued;
  stats.nonManifold = skin.nmEdges.length / 6;
  stats.massKg = skin.triangles.reduce((s, t) => s + triKg(t), 0);
  return {
    ok: true, blocks: [], triangles: skin.triangles, ghost,
    nmEdges: skin.nmEdges, stats,
  };
}
