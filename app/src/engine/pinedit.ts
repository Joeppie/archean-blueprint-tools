// pinedit.ts — the v1.11 UNIFORM MIRROR RULE for PRISMS, as a pure module
// (docs/TEST-PYRAMID.md Phase 1, v1.12.5): every edit the pin editor / the
// centroid widget / the THIS-TRIANGLE rows make on a triangle drives its
// corner-SET twin (triTwinIndex) in mirrored unison. These five functions are
// EXACTLY what Editor.tsx's e.onPinEdit / onPinShift / onPinRotate /
// paintTriFaces / triFlip callbacks ran (v1.11.0's twin-lookup-before-mutation
// and ATOMIC-clone fixes included); the Editor keeps only the sceneChanged
// repaint. Extracted so the pair laws (builddock TODO D/E, retired from e2e
// at this landing) pin at the vitest tier with the same numbers.
//
// Laws (AGENTS v1.11 (9b), NORMATIVE):
//  • for the WHOLESALE edits (shift/rotate) THE TWIN LOOKUP RUNS BEFORE THE
//    SELF MUTATION — the pair is identified as a corner-SET mirror, and
//    shifting the self first breaks the mirror relation, de-pairing the
//    twin (the v1.11.0 bug the builddock pin caught). A LONE pin drag is
//    the shipped exception (lookup after the self write): a single-corner
//    move de-pairs the pair by design (faux-mirror semantics).
//  • ATOMIC: the twin write is precomputed on a CLONE — a 32-slot-window
//    refusal on EITHER record refuses the WHOLE gesture (no half-moved pair).
//  • THE MIRRORED DELTA: the twin's delta negates the mirror-axis component
//    (a +x self shift sends the twin −x); rotations ride the mirror conjugate
//    qM (mirror-axis spin component kept, the other two negated).
//  • THE FLIP is pair-wide: winding reverses on BOTH records (both normals
//    negate) and the colours follow the edge relabelling [c1,c0,c4,c3,c2].
//  • PAINT maps face slots by IDENTITY: a mirrored prism's face f is its own
//    front/back/wall (the construction colour swap built it so).
import { docSetNumber } from './doc';
import type { EditCtx } from './edit';
import type { Triangle } from './format';
import {
  rotateCornersQ, setTriCornerAll, setTriCornersAll, shiftTriCells,
  triCorners, type Corner,
} from './tris';

/** the identified twin of a triangle: its index (−1 = none) and the mirror
 *  axis INDEX (0=x,1=y,2=z) — Editor's triTwinOf (mirAx + triTwinIndex). */
export type TwinOf = (ti: number) => { tw: number; a: number };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Pin DRAG: corner i of the triangle ti lands on lattice corner g (the
 *  engine owns the drag; this writes bp + the changed doc fields, and —
 *  while the pair is still corner-SET IDENTIFIED — the TWIN's corner σ(i),
 *  σ = [0,2,1] (mirroredTriangle's winding swap), gets the MIRRORED corner;
 *  a lone asymmetric drag de-pairs the set and the twin is not touched
 *  (the shipped lookup-after-self-write order of the v1.11 callback).
 *  Returns true when the record changed. A refused move (window /
 *  coincident) writes NOTHING (the pin snaps back). */
export function applyPinEdit(ctx: EditCtx, triTwinOf: TwinOf,
  ti: number, i: number, g: Corner): boolean {
  const t = ctx.bp.data.triangles?.[ti];
  if (!t) return false;
  const changed = setTriCornerAll(t, i, g as Corner);
  if (!changed) return false;
  for (const [k, v] of Object.entries(changed))
    docSetNumber(ctx.doc, ['data', 'triangles', ti, k], v);
  const { tw, a } = triTwinOf(ti);
  if (tw >= 0) {
    const tt = ctx.bp.data.triangles?.[tw];
    if (tt) {
      const gT: Corner = [g[0]!, g[1]!, g[2]!];
      gT[a] = 12 - gT[a]!;
      const chT = setTriCornerAll(tt, [0, 2, 1][i]!, gT);
      if (chT)
        for (const [k, v] of Object.entries(chT))
          docSetNumber(ctx.doc, ['data', 'triangles', tw, k], v);
    }
  }
  return true;
}

/** ✥ WHOLESALE MOVE: all three corners ride the whole-cell delta d; the twin
 *  gets the MIRRORED delta (td[a] = −d[a]). Returns success for the engine's
 *  snap-back. */
export function applyPinShift(ctx: EditCtx, triTwinOf: TwinOf,
  ti: number, d: [number, number, number]): boolean {
  const t = ctx.bp.data.triangles?.[ti];
  if (!t) return false;
  // THE TWIN LOOKUP MUST RUN BEFORE THE SELF MUTATION (see the header)
  const { tw, a } = triTwinOf(ti);
  const tt = tw >= 0 ? ctx.bp.data.triangles?.[tw] : undefined;
  const td: [number, number, number] = [d[0], d[1], d[2]];
  td[a] = -td[a]!;
  if (tt && !shiftTriCells(clone(tt), td)) return false;   // twin refuses ALL
  const changed = shiftTriCells(t, d);
  if (!changed) return false;
  for (const [k, v] of Object.entries(changed))
    docSetNumber(ctx.doc, ['data', 'triangles', ti, k], v);
  if (tt) {
    const chT = shiftTriCells(tt, td);
    if (chT)
      for (const [k, v] of Object.entries(chT))
        docSetNumber(ctx.doc, ['data', 'triangles', tw, k], v);
  }
  return true;
}

/** ⟳ ROTATE: the engine's lattice-quantised rotated corners c write
 *  atomically; the twin rides the MIRRORED rotation qM = the mirror
 *  conjugate (the mirror-axis spin component kept, the other two NEGATED —
 *  a +90° y-turn mirrors to −90°), rotated about its OWN centroid.
 *  dq = the rotation quaternion (null = the engine pre-rotated only). */
export function applyPinRotate(ctx: EditCtx, triTwinOf: TwinOf,
  ti: number, c: [Corner, Corner, Corner],
  dq: { w: number; x: number; y: number; z: number } | null | undefined): boolean {
  const t = ctx.bp.data.triangles?.[ti];
  if (!t) return false;
  // twin lookup BEFORE the self mutation (see onPinShift, v1.11.0)
  const { tw, a } = triTwinOf(ti);
  const tt = tw >= 0 ? ctx.bp.data.triangles?.[tw] : undefined;
  let cT: ReturnType<typeof rotateCornersQ> | null = null;
  if (tt && dq) {
    const qM = { w: dq.w,
      x: a === 0 ? dq.x : -dq.x, y: a === 1 ? dq.y : -dq.y, z: a === 2 ? dq.z : -dq.z };
    cT = rotateCornersQ(triCorners(tt), qM);
    if (!setTriCornersAll(clone(tt), cT)) return false;    // twin refuses ALL
  }
  const changed = setTriCornersAll(t, c as [Corner, Corner, Corner]);
  if (!changed) return false;
  for (const [k, v] of Object.entries(changed))
    docSetNumber(ctx.doc, ['data', 'triangles', ti, k], v);
  if (tt && cT) {
    const chT = setTriCornersAll(tt, cT);
    if (chT)
      for (const [k, v] of Object.entries(chT))
        docSetNumber(ctx.doc, ['data', 'triangles', tw, k], v);
  }
  return true;
}

/** PAINT (v1.8.0 uniform rule): the identified twin paints the SAME face
 *  slots — the mapping is the IDENTITY (a mirrored prism's face f is its own
 *  front/back/wall; the construction colour swap built it so). A missing
 *  colours array grows to 5 at slot 51 (the shipped default paint). */
export function applyTriPaint(ctx: EditCtx, triTwinOf: TwinOf,
  ti: number, slot: number, faces: number[]): void {
  const t = ctx.bp.data.triangles?.[ti];
  if (!t) return;
  const paintOne = (rec: Triangle, idx: number) => {
    const o = rec as unknown as { colors?: number[] };
    const arr = [...(o.colors ?? [51, 51, 51, 51, 51])];
    while (arr.length < 5) arr.push(51);
    for (const f of faces) {
      arr[f] = slot;
      docSetNumber(ctx.doc, ['data', 'triangles', idx, 'colors', f], slot);
    }
    o.colors = arr;
  };
  paintOne(t, ti);
  const { tw } = triTwinOf(ti);
  if (tw >= 0) {
    const tt = ctx.bp.data.triangles?.[tw];
    if (tt) paintOne(tt, tw);
  }
}

/** ⇄ FLIP (v1.11, we: "it should be possible to flip it just like the in
 *  game triangles, determining whether it goes outside or inside"): the
 *  winding reverses (v1↔v2) so the FRONT (colours[0]) normal points the
 *  other way; the geometry stays. The face colours follow the edge
 *  relabelling [c1,c0,c4,c3,c2] (front↔back, the v0-v1 ↔ v2-v0 walls).
 *  THE FLIP IS PAIR-WIDE: the twin flips with its self (mirror keeps the
 *  pair's facing relation — both skins then face inward/outward together). */
export function applyTriFlip(ctx: EditCtx, triTwinOf: TwinOf, ti: number): void {
  const t = ctx.bp.data.triangles?.[ti];
  if (!t) return;
  const flipOne = (rec: Triangle, idx: number) => {
    const c = triCorners(rec);
    const changed = setTriCornersAll(rec, [c[0]!, c[2]!, c[1]!]);
    if (changed)
      for (const [k, v] of Object.entries(changed))
        docSetNumber(ctx.doc, ['data', 'triangles', idx, k], v);
    const o = rec as unknown as { colors?: number[] };
    const col = o.colors ?? [51, 51, 51, 51, 51];
    o.colors = [col[1]!, col[0]!, col[4]!, col[3]!, col[2]!];
    for (let i = 0; i < 5; i++)
      docSetNumber(ctx.doc, ['data', 'triangles', idx, 'colors', i], o.colors![i]!);
  };
  flipOne(t, ti);
  const { tw } = triTwinOf(ti);
  if (tw >= 0) {
    const tt = ctx.bp.data.triangles?.[tw];
    if (tt) flipOne(tt, tw);
  }
}
