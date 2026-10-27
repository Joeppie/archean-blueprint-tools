// pinedit.test.ts — the v1.11 UNIFORM MIRROR RULE for PRISMS at the vitest
// tier (docs/TEST-PYRAMID.md Phase 1, v1.12.5). These are the laws the
// builddock e2e tests 'twin prism pair: the wholesale shift sends the TWIN
// the MIRRORED delta; the FLIP flips the pair (TODO D)' and 'twin-aware
// prism PAINT (TODO E)' pinned against a live browser + a 120 s budget; the
// laws are pure record math over (bp, doc), so the SAME values reproduce
// here (L5: the e2e legs retire in the same commit):
//   • self corners +2 x, twin corners −2 x (the MIRRORED delta);
//   • the pair SURVIVES the shift (the twin lookup runs on the PRE-mutation
//     corner sets — the v1.11.0 fix the e2e pin caught when the self shifted
//     first and silently de-paired);
//   • the FLIP is pair-wide (both winding normals EXACTLY negate, colours
//     relabel [c1,c0,c4,c3,c2]);
//   • PAINT maps face slots by IDENTITY — the twin wears the slot on the
//     SAME index;
//   • the twin's ROTATE rides the mirror CONJUGATE qM (mirror-axis spin
//     component kept, the others negated);
//   • every accepted write mirrors bp → doc (the doc is the save = the
//     undo history, v1.6.1) — one emitted text carries the whole pair.
// Fixture = the e2e fixture class: a freshly PLACED mirror pair (the pin
// commit's own generators: triangleFromCorners + mirroredTriangle) on the
// starter deck, hugging the x = 0 plane (|x| cells ≤ 2 of centre: the twin's
// x headroom ≥ 2 so a ±2 delta lands, exactly the e2e comment's law).
import { describe, expect, test } from 'vitest';
import { newCraftDoc } from '../newcraft';
import { emitDoc } from '../doc';
import { openFunnel } from '../edit';
import {
  cornerOf, mirroredTriangle, rotateCornersQ, triCorners, triTwinIndex,
  triangleFromCorners, type Corner,
} from '../tris';
import {
  applyPinEdit, applyPinRotate, applyPinShift, applyTriFlip, applyTriPaint,
  type TwinOf,
} from '../pinedit';
import type { Blueprint } from '../format';

type Tri = Record<string, number> & { colors?: number[] };
const trisOf = (bp: Blueprint) => (bp.data.triangles ?? []) as unknown as Tri[];
const corners = (t: Tri): [Corner, Corner, Corner] => triCorners(t as never);
const normal = (c: [Corner, Corner, Corner]) => {
  const u = [0, 1, 2].map(a => c[1]![a]! - c[0]![a]!);
  const w = [0, 1, 2].map(a => c[2]![a]! - c[0]![a]!);
  return [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!,
    u[0]! * w[1]! - u[1]! * w[0]!];
};

/** the pin commit's generators, run on the starter deck text (the SAME
 *  funnel the Editor opens files through) */
function pairFix(cols = [10, 20, 30, 40, 50]) {
  const deck = JSON.parse(emitDoc(newCraftDoc())) as {
    data: { triangles?: unknown[] };
  };
  // deck-centre corners (world x within ±0.5 m of the mirror plane: cell x
  // 5..7 ⇒ the twin lands at cell 7..5, both records keep ≥ 2 cells of
  // x-headroom for the ±2 delta — the e2e's 'centre-hugging pins' rule)
  const t = triangleFromCorners([5, 8, 4], [7, 8, 4], [6, 8, 7], cols)!;
  const twin = mirroredTriangle(t, 'x')!;
  expect(twin).not.toBeNull();
  deck.data.triangles = [t, twin];
  const { bp, ctx } = openFunnel(JSON.stringify(deck));
  const T = (): TwinOf => (ti: number) =>
    ({ tw: triTwinIndex(bp, ti, 'x'), a: 0 });
  return { bp, ctx, T };
}

const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x)) as X;

describe('pinedit — THE UNIFORM MIRROR RULE for prisms (was builddock TODO D/E)', () => {
  test('fixture: the pin-commit pair IDENTIFIES as a corner-SET twin', () => {
    const { bp, T } = pairFix();
    expect(trisOf(bp).length).toBe(2);
    expect(triTwinIndex(bp, 0, 'x')).toBe(1);
    expect(triTwinIndex(bp, 1, 'x')).toBe(0);
    expect(T()(0)).toEqual({ tw: 1, a: 0 });        // the Editor's triTwinOf seam
  });

  test('wholesale shift: self corners +2 x, twin corners −2 x; pair survives (TODO D)', () => {
    const { bp, ctx, T } = pairFix();
    const s0 = corners(trisOf(bp)[0]!);
    const t0 = corners(trisOf(bp)[1]!);
    expect(applyPinShift(ctx, T(), 0, [2, 0, 0])).toBe(true);
    const s1 = corners(trisOf(bp)[0]!);
    const t1 = corners(trisOf(bp)[1]!);
    // the e2e loop verbatim: self corner vi = s0[vi] + 2, twin = t0[vi] − 2
    for (const [vi, c] of s1.entries())
      expect(c, `self corner ${vi}`).toEqual([s0[vi]![0]! + 2, s0[vi]![1]!, s0[vi]![2]!]);
    for (const [vi, c] of t1.entries())
      expect(c, `twin corner ${vi}`).toEqual([t0[vi]![0]! - 2, t0[vi]![1]!, t0[vi]![2]!]);
    // THE v1.11.0 LAW: the twin lookup ran on the PRE-mutation records, so
    // the mirrored delta keeps the pair IDENTIFIED (the e2e de-pairing bug
    // — shifting the self first — breaks the corner-SET mirror relation)
    expect(triTwinIndex(bp, 0, 'x')).toBe(1);
    expect(triTwinIndex(bp, 1, 'x')).toBe(0);
    // the doc mirror (the save + the history): the emitted text carries
    // BOTH moved records — bp ≡ doc, no half-committed pair
    const saved = JSON.parse(emitDoc(ctx.doc));
    expect(saved.data.triangles.length).toBe(2);
    for (const i of [0, 1]) {
      const st = saved.data.triangles[i];
      expect(corners(st as Tri)).toEqual(i === 0 ? s1 : t1);
    }
  });

  test('no-op shift is accepted trivially (the e2e [0,0,0] leg)', () => {
    const { ctx, T } = pairFix();
    expect(applyPinShift(ctx, T(), 0, [0, 0, 0])).toBe(true);
  });

  test('mirror-off semantics: triTwinOf -1 touches ONLY the self record', () => {
    const { bp, ctx } = pairFix();
    const t1before = clone(corners(trisOf(bp)[1]!));
    const off = (): TwinOf => () => ({ tw: -1, a: 0 });
    expect(applyPinShift(ctx, off(), 0, [2, 0, 0])).toBe(true);
    expect(corners(trisOf(bp)[1]!)).toEqual(t1before);
    expect(corners(trisOf(bp)[0]!)[0]![0]).toBe(7);   // self alone moved
  });

  test('the FLIP is pair-wide: both normals EXACTLY negate, colours relabel (TODO D)', () => {
    const { bp, ctx, T } = pairFix();
    const sn0 = normal(corners(trisOf(bp)[0]!));
    const tn0 = normal(corners(trisOf(bp)[1]!));
    applyTriFlip(ctx, T(), 0);
    const sn1 = normal(corners(trisOf(bp)[0]!));
    const tn1 = normal(corners(trisOf(bp)[1]!));
    for (let k = 0; k < 3; k++) {
      expect(sn1[k]).toBeCloseTo(-sn0[k]!, 9);
      expect(tn1[k], 'the twin FLIPPED with its self').toBeCloseTo(-tn0[k]!, 9);
    }
    // face colours follow the edge relabelling [c1,c0,c4,c3,c2] on BOTH
    expect(trisOf(bp)[0]!.colors).toEqual([20, 10, 50, 40, 30]);
    // the twin's colours start mirrored ([c0,c1,c4,c3,c2] from construction
    // = [10,20,50,40,30]) and the flip relabels them the same way
    expect(trisOf(bp)[1]!.colors).toEqual([20, 10, 30, 40, 50]);
    // winding-agnostic pairing: the flip keeps the pair
    expect(triTwinIndex(bp, 0, 'x')).toBe(1);
    // and the emitted text (the ONE undo snapshot of the step) carries both
    const saved = JSON.parse(emitDoc(ctx.doc));
    expect(saved.data.triangles[0].colors).toEqual([20, 10, 50, 40, 30]);
    expect(saved.data.triangles[1].colors).toEqual([20, 10, 30, 40, 50]);
  });

  test('PAINT: the twin record wears the SAME face slot — identity mapping (TODO E)', () => {
    const { bp, ctx, T } = pairFix();
    applyTriPaint(ctx, T(), 0, 70, [0]);            // the e2e's num-front ▸ 70
    const ti = trisOf(bp)[0]!.colors!;
    const tw = trisOf(bp)[1]!.colors!;
    expect(ti[0]).toBe(70);
    expect(tw[0], 'the twin wears the slot on the SAME index').toBe(70);
    expect(tw[0]).toBe(ti[0]);
    // the other faces keep their paint (front-only fill), twin included
    expect(ti.slice(1)).toEqual([20, 30, 40, 50]);
    const saved = JSON.parse(emitDoc(ctx.doc));
    expect(saved.data.triangles[1].colors[0]).toBe(70);
  });

  test('paint ALL five faces (the paintTri brush path) colours the pair', () => {
    const { bp, ctx, T } = pairFix();
    applyTriPaint(ctx, T(), 0, 60, [0, 1, 2, 3, 4]);   // the e2e brush inherit
    expect(trisOf(bp)[0]!.colors).toEqual([60, 60, 60, 60, 60]);
    expect(trisOf(bp)[1]!.colors).toEqual([60, 60, 60, 60, 60]);
  });

  test('paint grows a colours-less record to 5 at slot 51', () => {
    const deck = JSON.parse(emitDoc(newCraftDoc())) as { data: { triangles?: unknown[] } };
    const t = triangleFromCorners([5, 8, 4], [7, 8, 4], [6, 8, 7], [51, 51, 51, 51, 51])!;
    delete (t as unknown as { colors?: number[] }).colors;
    deck.data.triangles = [t];
    const { bp, ctx } = openFunnel(JSON.stringify(deck));
    const off = (): TwinOf => () => ({ tw: -1, a: 0 });
    applyTriPaint(ctx, off(), 0, 70, [0]);
    expect(trisOf(bp)[0]!.colors).toEqual([70, 51, 51, 51, 51]);
  });

  test('pin DRAG: the SELF corner lands on g; a lone drag DE-PAIRS the pair', () => {
    // The shipped order (Editor v1.11, kept by the extraction): the pin
    // drag writes the SELF corner first, the twin lookup runs AFTER — a
    // single-corner move breaks the corner-SET mirror relation, so the
    // twin stops matching (faux-mirror semantics: a lone pin drag makes a
    // pair drifted, the twin is NOT dragged). The e2e pin-drag legs run
    // mirw-off; the twin writes here apply while the pair still matches
    // (e.g. a drag that lands the mirrored corner exactly).
    const { bp, ctx, T } = pairFix();
    const g: Corner = [6, 9, 4];
    expect(applyPinEdit(ctx, T(), 0, 1, g)).toBe(true);
    expect(corners(trisOf(bp)[0]!)[1]).toEqual(g);
    expect(corners(trisOf(bp)[1]!)[2], 'the twin record was NOT touched').toEqual([5, 8, 4]);
    expect(triTwinIndex(bp, 0, 'x'), 'a lone corner drag de-pairs the SET twin').toBe(-1);
  });

  test('pin DRAG refusal writes NOTHING (coincident corner — pins snap back)', () => {
    const { bp, ctx, T } = pairFix();
    const before = clone(trisOf(bp));
    const docBefore = emitDoc(ctx.doc);
    const c0 = corners(trisOf(bp)[0]!)[0]!;
    expect(applyPinEdit(ctx, T(), 0, 1, [...c0] as Corner)).toBe(false);
    expect(clone(trisOf(bp))).toEqual(before);        // bp byte-intact
    expect(emitDoc(ctx.doc)).toBe(docBefore);         // doc byte-intact
  });

  test('rotate: the twin rides the MIRROR CONJUGATE qM (90° y-turn mirrors to −90°)', () => {
    const { bp, ctx, T } = pairFix();
    const selfC = corners(trisOf(bp)[0]!);
    const twinC0 = corners(trisOf(bp)[1]!);
    const r2 = Math.SQRT1_2;
    const dq = { w: r2, x: 0, y: r2, z: 0 };          // +90° about ŷ
    // the engine pre-rotates the SELF corners; pinedit rotates the twin by
    // qM = the mirror CONJUGATE on the SESSION axis (a = 0 = x: the x spin
    // component KEPT, y/z NEGATED — a +90° y-turn mirrors to −90°) — assert
    // the twin's result equals the twin base rotated by qM DIRECTLY.
    const qM = { w: dq.w, x: dq.x, y: -dq.y, z: -dq.z };
    const want = rotateQ(twinC0, qM);
    const selfRot = rotateQ(selfC, dq);               // what the engine hands in
    expect(applyPinRotate(ctx, T(), 0, selfRot, dq)).toBe(true);
    expect(corners(trisOf(bp)[1]!)).toEqual(want);
    expect(corners(trisOf(bp)[0]!)).toEqual(selfRot);
    expect(triTwinIndex(bp, 0, 'x'), 'the paired quarter-turn keeps the pair').toBe(1);
  });  test('cornerOf + pair law round-trip: the x-REFLECTION g → 12 − g is involutive', () => {
    // the law the twin identity + every mirrored delta rest on (AGENTS
    // v1.11 (10)): the twin's corner SET is the x-reflection of the self's
    // (the winding swap permutes the per-index order — the identity is a
    // SET, which is why triTwinIndex keys a sorted corner set). Reflected
    // twice = the original record.
    const { bp, T } = pairFix();
    const sortSet = (cs: [Corner, Corner, Corner]) =>
      JSON.stringify([...cs].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!));
    expect(sortSet(corners(trisOf(bp)[1]!))).toEqual(
      sortSet([0, 1, 2].map(i => {
        const g = corners(trisOf(bp)[0]!)[i]!;
        return [12 - g[0]!, g[1]!, g[2]!] as Corner;
      }) as [Corner, Corner, Corner]));
    expect(T()(0)).toEqual({ tw: 1, a: 0 });
    expect(cornerOf([0.25, 0.5, -0.5])).toEqual([7, 8, 4]);  // world→g (lattice anchor)
  });
});

/** rotate a corner triple about its centroid by q and re-snap (the shipped
 *  rotateCornersQ — the SAME function applyPinRotate computes the twin's
 *  rotated corners with, called here on the twin base for the expectation) */
function rotateQ(base: [Corner, Corner, Corner],
  q: { w: number; x: number; y: number; z: number }): [Corner, Corner, Corner] {
  return rotateCornersQ(base, q);
}
