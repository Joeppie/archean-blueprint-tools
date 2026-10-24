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
import { docArrayInsert, docArrayRemoveAt, docEnsureArray, docFromValue, docGet, docSet, docSetArrayItem, docSetNumber, docValue, emitDoc, parseDoc } from './doc';
import type { Blueprint, BlueprintComponent, FileQuat, LatticeObj, Triangle, Vec3D } from './format';
import { CELL } from './format';
import { docLegacyGeneration, normalizeDoc } from './normalize';
import type { PaletteEntry } from './palette';

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

/** Mirror a LIVE bp block's geometry into the doc (pos/frame/size/type/
 *  material + the 7 face slots) — the block sibling of every setter here (the
 *  v1.4 lesson: cell edits must reach the doc or they vanish on save). Used
 *  by the panel editors AND the engine's BLOCK gizmo via Editor's
 *  onBlockEdit. material is v1.7 (the MATERIALS editor); a doc block that
 *  predates the field is left alone (writeBlockMaterial adds it). */
export function writeBlockDoc(ctx: EditCtx, bi: number): void {
  const b = ctx.bp.data.blocks[bi];
  if (!b) return;
  const d = ctx.doc, path = ['data', 'blocks', bi];
  for (const k of ['pos_x', 'pos_y', 'pos_z', 'frame_x', 'frame_y', 'frame_z',
    'size_x', 'size_y', 'size_z', 'type'] as const)
    docSetNumber(d, [...path, k], (b as unknown as Record<string, number>)[k] ?? 0);
  for (let i = 0; i < 7; i++) docSetNumber(d, [...path, 'colors', i], b.colors?.[i] ?? 0);
  if (typeof b.material === 'number') writeBlockMaterial(ctx, bi, b.material);
}

/** Write a block's `material` into bp + doc. Files from before the field
 *  exists carry no `material` key (docSet refuses a missing path), so the
 *  entry is APPENDED to the block object when absent — the game's reader
 *  defaults it to 0 anyway, key order only matters for byte-identity of an
 *  UNTOUCHED file. */
export function writeBlockMaterial(ctx: EditCtx, bi: number, v: number): boolean {
  const b = ctx.bp.data.blocks[bi];
  if (!b) return false;
  b.material = v;
  const path = ['data', 'blocks', bi];
  if (docSetNumber(ctx.doc, [...path, 'material'], v)) return true;
  const node = docGet(ctx.doc, path);
  if (!node || node.kind !== 'obj') return false;
  node.entries.push(['material', { kind: 'num', value: v, raw: String(v) }]);
  return true;
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

/** THE open funnel: parse → read the file's GENERATION (BEFORE normalize
 *  embeds data.colors) → v1→v2 migration → docValue → EditCtx, with the
 *  generation stamped on the live bp (isLegacyFile). Editor.openText and the
 *  save-fidelity pins share this one implementation, so the pins can never
 *  drift from the shipped path. */
export function openFunnel(text: string): { doc: DocNode; bp: Blueprint; ctx: EditCtx; legacy: boolean } {
  const doc = parseDoc(text);
  const legacy = docLegacyGeneration(doc);
  normalizeDoc(doc);
  const bp = docValue(doc) as Blueprint;
  bp.__legacyQ = legacy;
  return { doc, bp, ctx: makeCtx(doc, bp), legacy };
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

// ------------------------------------------------- component-index surgery
// data.pipes (a_component/b_component) and data.composite_builds
// (component/slaveBuildId) reference FLATTENED component indices (readBuild
// order — nested Build content numbered BEFORE its Build, AGENTS §Subgrids,
// same walk as subgrid.flattenComponents). Splicing a component out of
// data.components therefore INVALIDATES every later flat reference: leaving
// them stale silently re-points cables and subgrid joins at the neighbour
// component (the Jimmy incident 2026-10-20: two dashboards deleted, the app
// then reported a computer's power cable as wired to an AILERON — the cable
// physically sits elsewhere, only the index moved; and the game does NOT
// prune such references on load, it re-saves them mangled).

/** Renumber (and where the endpoint itself dies, prune) every FLATTENED
 *  component reference in bp AND doc for a set of TOP-LEVEL indices about
 *  to be spliced out of data.components. Run BEFORE the splice (the removed
 *  set is keyed on pre-splice top indices; a deleted Build takes its whole
 *  nested subtree with it, exactly like flattenComponents numbers it). */
export function pruneCompRefs(ctx: EditCtx, removedTop: ReadonlySet<number>): void {
  // mirror flattenComponents' ORDER (children before parent) tagging dead;
  // removedTop keys TOP-LEVEL indices only (nested indices mean nothing there)
  const dead: boolean[] = [];
  const walk = (list: BlueprintComponent[], deadAbove: boolean, top: boolean): void => {
    list.forEach((c, i) => {
      const d = deadAbove || (top && removedTop.has(i));
      const sub = c.data?.['components'] as BlueprintComponent[] | undefined;
      if (c.type === 'Build' && sub?.length) walk(sub, d, false);
      dead.push(d);
    });
  };
  walk(ctx.bp.data.components, false, true);
  const remap = new Map<number, number>();
  let n = 0;
  dead.forEach((d, i) => { if (!d) remap.set(i, n++); });
  const last = dead.length;                        // refs >= last predate nothing: leave

  /** one reference list: entries touching a dead flat index DROP, the rest
   *  take their remapped index (bp + doc, int style). */
  const fixList = (arr: Record<string, unknown>[] | undefined, keys: string[],
    docPath: string[]): void => {
    if (!arr) return;
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i]!;
      let drop = false;
      for (const k of keys) {
        const v = e[k];
        if (typeof v !== 'number') continue;
        if (v < last && !remap.has(v)) { drop = true; break; }
      }
      if (drop) { arr.splice(i, 1); docArrayRemoveAt(ctx.doc, docPath, i); continue; }
      for (const k of keys) {
        const v = e[k];
        const m = typeof v === 'number' ? remap.get(v) : undefined;
        if (m != null && m !== v) { e[k] = m; docSet(ctx.doc, [...docPath, i, k], m); }
      }
    }
  };
  fixList(ctx.bp.data.pipes as unknown as Record<string, unknown>[] | undefined,
    ['a_component', 'b_component'], ['data', 'pipes']);
  const cb = (ctx.bp.data as unknown as { composite_builds?: Record<string, unknown>[] }).composite_builds;
  fixList(cb, ['component', 'slaveBuildId'], ['data', 'composite_builds']);
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

/** Write one slot of the file's OWN palette (bp + doc together) — the
 *  custom-RGB picker's "new slot" path. Palette entries are int-scaled
 *  (0..255 / 0..15 / 0..7), so the doc node forces int literals. The array
 *  is created when the file never carried one (normalize normally embeds it
 *  at open, but a New craft may not have used a slot yet). */
export function setPaletteSlot(ctx: EditCtx, slot: number, e: PaletteEntry): boolean {
  if (slot < 11 || slot > 255) return false;          // 0..10 are engine-reserved
  const arr = (ctx.bp.data.colors ??= []);
  arr[slot] = { ...e };
  if (!docEnsureArray(ctx.doc, ['data', 'colors'])) return false;
  return docSetArrayItem(ctx.doc, ['data', 'colors'], slot, docFromValue({
    r: Math.round(e.r), g: Math.round(e.g), b: Math.round(e.b),
    opacity: Math.round(e.opacity), roughness: Math.round(e.roughness), metallic: Math.round(e.metallic),
  }));
}

/** Mirror the bp triangles from index startLen ON into the doc (records the
 *  bp ALREADY carries — hullify's own append). Guarantees the doc array
 *  first (v1.6.1: silent-fail class). */
export function mirrorTrisDoc(ctx: EditCtx, startLen: number): void {
  const all = ctx.bp.data.triangles ?? [];
  if (all.length <= startLen) return;
  if (!docEnsureArray(ctx.doc, ['data', 'triangles'])) return;
  for (let k = startLen; k < all.length; k++)
    docArrayInsert(ctx.doc, ['data', 'triangles'], k, docFromValue(all[k]!, false));
}

/** Append FRESHLY GENERATED triangles to bp AND doc TOGETHER (the triangle
 *  sibling of writeBlockDoc). The doc array is CREATED when the file never
 *  carried a triangle list — docArrayInsert fails SILENTLY on a missing
 *  path, and v1.6.0 shipped the sphere-skin commit without this guarantee:
 *  on a block-only craft the skin lived only in bp (visible in the session),
 *  the saved file never held it (gone after reload + in game) and the doc-text
 *  undo snapshots could not see it (undo/redo had nothing to restore).
 *  Records the bp already holds (hullify) mirror through mirrorTrisDoc —
 *  pushing here too would DOUBLE them (the e2e undo pin caught exactly that).
 *  Numbers keep the game's INT writer style (v1.5.12 pin). */
export function appendTrianglesDoc(ctx: EditCtx, tris: Triangle[]): void {
  if (!tris.length) return;
  const at = (ctx.bp.data.triangles ??= []).length;
  for (const t of tris) ctx.bp.data.triangles.push(t);
  mirrorTrisDoc(ctx, at);
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
