// edit.ts — the EDITING layer: every write to the blueprint funnels through
// here so the live view object and the raw-literal DOC stay in lockstep
// (the byte-identical-save contract, doc.ts). PURE — no THREE, no DOM; the
// engine receives the new values through its own setters, the App owns the
// EditCtx and calls serializeSave() on save.
//
// Save-time mirror sync (legacy serialize() v0.155 semantics, ported):
//   occ cells = occ0 + round((position − pos0)/CELL), and the type-255
//   mirror blocks in data.blocks follow the SAME cell shift — keyed on the
//   CURRENT cell+size+frame signature and CONSUMED as they move (live
//   re-indexing reproduces the old full-scan sequential semantics exactly).
//   An applied-cells tracker makes repeated saves incremental: the doc (the
//   save source) accumulates the shift once, never re-applied.

import type { DocNode } from './doc';
import { docSet, docSetNumber, emitDoc } from './doc';
import type { Blueprint, FileQuat, LatticeObj, Vec3D } from './format';
import { CELL } from './format';

export type Occ = LatticeObj & { size_x?: number; size_y?: number; size_z?: number };

export interface OrigSnap {
  pos0: Vec3D;
  q0: FileQuat;                                   // file quaternion at load (reset)
  occ0: Occ[];                                    // pristine occupancy cells
}

export interface EditCtx {
  doc: DocNode;
  bp: Blueprint;
  orig: OrigSnap[];
  /** per component: the cell shift already applied into doc+bp at saves */
  applied: Vec3D[];
}

export function makeCtx(doc: DocNode, bp: Blueprint): EditCtx {
  return {
    doc,
    bp,
    orig: bp.data.components.map(c => ({
      pos0: { ...c.position },
      q0: { ...(c.orientation ?? { w: 1, x: 0, y: 0, z: 0 }) },
      occ0: (c.occupancies ?? []).map(o => ({ ...o })),
    })),
    applied: bp.data.components.map(() => ({ x: 0, y: 0, z: 0 })),
  };
}

const AXES = ['x', 'y', 'z'] as const;

/** Write a component position axis (raw file space) into bp + doc. */
export function setPos(ctx: EditCtx, ci: number, ax: 'x' | 'y' | 'z', v: number): void {
  const c = ctx.bp.data.components[ci];
  if (!c) return;
  c.position[ax] = v;
  docSetNumber(ctx.doc, ['data', 'components', ci, 'position', ax], v);
}

/** Write a whole file quaternion (PLAIN fields — never a THREE object's
 *  accessor backing, the v0.152 NaN-quat lesson). */
export function setOrientation(ctx: EditCtx, ci: number, q: FileQuat): void {
  const c = ctx.bp.data.components[ci];
  if (!c) return;
  const plain = { w: q.w, x: q.x, y: q.y, z: q.z };
  c.orientation = plain;
  for (const k of AXES) docSetNumber(ctx.doc, ['data', 'components', ci, 'orientation', k], plain[k] as number);
  docSetNumber(ctx.doc, ['data', 'components', ci, 'orientation', 'w'], plain.w);
}

/** Write one comp.data field at a flattened component doc path. */
export function setDataField(
  ctx: EditCtx, compPath: (string | number)[], key: string, v: number | string | boolean,
): boolean {
  if (!docSet(ctx.doc, [...compPath, 'data', key], v)) return false;
  // live-view side: walk the same path on bp
  let n: Record<string, unknown> = ctx.bp as unknown as Record<string, unknown>;
  for (const p of compPath) { n = n[p as string] as Record<string, unknown>; if (!n) return true; }
  const d = (n['data'] ?? {}) as Record<string, unknown>;
  d[key] = v;
  n['data'] = d;
  return true;
}

/** Restore a component to its as-loaded pose in bp + doc (occupancy mirrors
 *  ride back at the next serializeSave: cells fall to 0). */
export function resetComponent(ctx: EditCtx, ci: number): void {
  const c = ctx.bp.data.components[ci], o = ctx.orig[ci];
  if (!c || !o) return;
  for (const ax of AXES) setPos(ctx, ci, ax, o.pos0[ax]!);
  setOrientation(ctx, ci, { w: o.q0.w, x: o.q0.x, y: o.q0.y, z: o.q0.z });
}

// ------------------------------------------------------------------- save

const mkey = (p: Record<string, unknown>): string =>
  `${p['pos_x']},${p['pos_y']},${p['pos_z']}|${p['size_x']},${p['size_y']},${p['size_z']}|` +
  `${p['frame_x']},${p['frame_y']},${p['frame_z']}`;

/** Sync occupancy + type-255 mirrors with the moved components, write every
 *  changed cell into the doc, and emit. The live bp keeps the synced cells
 *  too, so repeated saves are exact (applied-cells deltas). */
export function serializeSave(ctx: EditCtx): string {
  const { doc, bp, orig, applied } = ctx;
  const blocks = bp.data.blocks;
  const mirrors = new Map<string, number[]>();          // signature → block indices
  blocks.forEach((bl, i) => {
    if (bl.type !== 255) return;
    const k = mkey(bl as unknown as Record<string, unknown>);
    const lst = mirrors.get(k);
    if (lst) lst.push(i); else mirrors.set(k, [i]);
  });
  bp.data.components.forEach((c, ci) => {
    const o = orig[ci];
    if (!o || !c.occupancies?.length) return;
    const cells: Vec3D = {
      x: Math.round((c.position.x - o.pos0.x) / CELL),
      y: Math.round((c.position.y - o.pos0.y) / CELL),
      z: Math.round((c.position.z - o.pos0.z) / CELL),
    };
    const dlt = { x: cells.x - applied[ci]!.x, y: cells.y - applied[ci]!.y, z: cells.z - applied[ci]!.z };
    c.occupancies.forEach((occ, k) => {
      const b0 = o.occ0[k];
      if (!b0) return;
      // the mirror sitting at this occ's CURRENT signature moves with it
      const lst = mirrors.get(mkey(occ as unknown as Record<string, unknown>));
      if (dlt.x || dlt.y || dlt.z) {
        for (const bi of lst?.splice(0) ?? []) {
          const bl = blocks[bi]!;
          bl.pos_x += dlt.x; bl.pos_y += dlt.y; bl.pos_z += dlt.z;
          docSetNumber(doc, ['data', 'blocks', bi, 'pos_x'], bl.pos_x);
          docSetNumber(doc, ['data', 'blocks', bi, 'pos_y'], bl.pos_y);
          docSetNumber(doc, ['data', 'blocks', bi, 'pos_z'], bl.pos_z);
          const nk = mkey(bl as unknown as Record<string, unknown>);
          const nl = mirrors.get(nk);
          if (nl) nl.push(bi); else mirrors.set(nk, [bi]);
        }
      }
      occ.pos_x = b0.pos_x + cells.x; occ.pos_y = b0.pos_y + cells.y; occ.pos_z = b0.pos_z + cells.z;
      docSetNumber(doc, ['data', 'components', ci, 'occupancies', k, 'pos_x'], occ.pos_x);
      docSetNumber(doc, ['data', 'components', ci, 'occupancies', k, 'pos_y'], occ.pos_y);
      docSetNumber(doc, ['data', 'components', ci, 'occupancies', k, 'pos_z'], occ.pos_z);
    });
    applied[ci] = cells;
  });
  return emitDoc(doc);
}

/** Editable component META (the non-pose scalars every comp carries). */
export type CompMetaKey = 'alias' | 'module' | 'mirrorAxis';
export function setCompField(ctx: EditCtx, ci: number, key: CompMetaKey,
  v: string | number): boolean {
  const c = ctx.bp.data.components[ci];
  if (!c) return false;
  (c as unknown as Record<string, unknown>)[key] = v;
  return docSet(ctx.doc, ['data', 'components', ci, key], v as number | string);
}

/** One field of one player-paint colour entry (color1/color2 dict shape —
 *  convert-on-open guarantees dicts at top level). */
export function setCompColor(ctx: EditCtx, ci: number, which: 'color1' | 'color2',
  field: 'r' | 'g' | 'b' | 'opacity' | 'roughness' | 'metallic', v: number): boolean {
  const c = ctx.bp.data.components[ci];
  if (!c || typeof c.colors === 'string') return false;
  const cols = c.colors as Record<string, Record<string, number>> | undefined;
  const ent = cols?.[which];
  if (!ent) return false;
  ent[field] = v;
  return docSetNumber(ctx.doc, ['data', 'components', ci, 'colors', which, field], v);
}
