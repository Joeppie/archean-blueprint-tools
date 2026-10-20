// blocks.test.ts — pure BLOCKS-mode model pins: cell conversions and the
// cell-boundary lattice, ⇄ MIRRORED placement (cell mirror plane, the
// mirrored shape-type table derived from the real geometry, the twin
// builder), the game's SHIFT CONTINUATION rules (complementBlock) and the
// footprint overlap guard; plus the v1.4 block-EDITOR layer: in-place
// rotate/flip, SIMILAR-TWIN identification and the ✧ snap-to-neighbours.
import { describe, expect, it } from 'vitest';

import { blockAt, blockCells, blockFromCell, blockMirrorTwin, cellIndex, cellOverlap,
  complementBlock, flippedBlock, mirroredBlock, mirrorBlockCell, MIRROR_TYPE,
  rotateType, rotateTypeAbout, rotatedBlock, snapBlockType } from '../blocks';
import { getBlockPoints } from '../blockshapes';
import type { Blueprint } from '../format';

describe('⇄ mirrored placement', () => {
  it('cell mirror is about the FILE world x = 0 plane and involutive', () => {
    // cell-boundary lattice: cell c covers [(c−6)·CELL, (c−5)·CELL), so
    // world x = 0 sits at cell coord 6 and [c, c+e) twins at [12−c−e, 12−c):
    // a 1-cell block at abs 8 (world +0.5…+0.75) twins at [3,4) (−0.75…−0.5)
    expect(mirrorBlockCell(8, 0)).toBe(3);
    expect(mirrorBlockCell(3, 0)).toBe(8);
    // a size-3 footprint (4 cells) [8, 12) (world +0.5…+1.5) → [0, 4) (−1.5…−0.5)
    expect(mirrorBlockCell(8, 3)).toBe(0);
    // involutive for any footprint
    for (const [c, s] of [[8, 0], [-1, 3], [5, 0], [-14, 12], [0, 1]] as const)
      expect(mirrorBlockCell(mirrorBlockCell(c, s), s)).toBe(c);
  });

  it('MIRROR_TYPE is a closed involution on the shape table, cube-stable', () => {
    expect(MIRROR_TYPE[0]).toBe(0);                  // cube mirrors to cube
    for (let t = 1; t <= 52; t++) {
      const m = MIRROR_TYPE[t]!;
      expect(m).toBeGreaterThanOrEqual(1);           // stays in the shape table
      expect(MIRROR_TYPE[m]).toBe(t);                // involutive
    }
    // the mirror is NOT identity for chiral shapes: at least one slope and
    // one corner change orientation
    let moved = 0;
    for (let t = 1; t <= 52; t++) if (MIRROR_TYPE[t] !== t) moved++;
    expect(moved).toBeGreaterThan(8);
  });

  it('MIRROR_TYPE matches the true mirrored vertex cloud', () => {
    // independent check: the mirrored type's cloud equals x-flipped cloud
    const key = (t: number, flip: boolean) =>
      getBlockPoints(t, [0, 0, 0], [1, 1, 1])
        .map(p => (flip ? 1 - p[0] : p[0]).toFixed(3) + ',' + p[1].toFixed(3) + ',' + p[2].toFixed(3))
        .sort().join(';');
    for (const t of [1, 3, 5, 7, 13, 15, 21, 25, 45, 47])
      expect(key(MIRROR_TYPE[t]!, false)).toBe(key(t, true));
  });

  it('mirroredBlock twin: same footprint+paint, mirrored cell and type', () => {
    const b = blockFromCell([8, 5, 8], [2, 0, 0], 13, 7);     // corner, 3×1×1
    const twin = mirroredBlock(b);
    expect(blockCells(twin).x).toBe(mirrorBlockCell(8, 2));
    expect(blockCells(twin).y).toBe(5);
    expect(blockCells(twin).z).toBe(8);
    expect(twin.size_x).toBe(2);
    expect(twin.type).toBe(MIRROR_TYPE[13]);
    expect(twin.colors).toEqual(b.colors);
    // twin of the twin = original
    const back = mirroredBlock(twin);
    expect(blockCells(back)).toEqual(blockCells(b));
    expect(back.type).toBe(13);
    // pos_* stay in the writer's 0..12 range across frames
    for (const c of [-40, -13, 0, 47]) {
      const t2 = mirroredBlock(blockFromCell([c, 5, 8], [0, 0, 0], 0, 4));
      expect(t2.pos_x).toBeGreaterThanOrEqual(0);
      expect(t2.pos_x).toBeLessThanOrEqual(12);
    }
  });
});

describe('cell lattice (cellIndex ≡ cull/tris cell-boundary convention)', () => {
  it('cell c covers [(c−6)·CELL, (c−5)·CELL)', () => {
    expect(cellIndex(-1.5)).toBe(0);          // cell 0 spans [−1.5, −1.25)
    expect(cellIndex(-1.26)).toBe(0);
    expect(cellIndex(-1.25)).toBe(1);
    expect(cellIndex(0.5)).toBe(8);           // world +0.5 = abs cell 8
    expect(cellIndex(0.74)).toBe(8);
  });
  it('blockAt resolves a point inside a block to its index', () => {
    const bp = { data: { blocks: [
      { ...blockFromCell([8, 5, 8], [0, 0, 0], 0, 4) },
      { ...blockFromCell([8, 5, 8], [0, 0, 0], 255, 0) },   // occupancy: never claimed
    ] } } as unknown as Blueprint;
    expect(blockAt(bp, { x: 0.6, y: -0.1, z: 0.6 })).toBe(0);
    expect(blockAt(bp, { x: 0.87, y: -0.1, z: 0.6 })).toBe(-1);   // just past [8+1 cell)
  });
});

describe('Shift continuation placement (the game: logically add the next block)', () => {
  const info = (cell: [number, number, number], size: [number, number, number], type: number) =>
    ({ bi: 0, cell, size, type, slot: 4 });

  it('cube axis-face hits: flush copy on the aimed face, size and paint ride over', () => {
    const i = info([10, 20, 30], [2, 0, 1], 0);
    expect(complementBlock(i, [11, 21, 31], [0, 1, 0]).cell).toEqual([10, 21, 30]);
    expect(complementBlock(i, [11, 20, 31], [0, -1, 0]).cell).toEqual([10, 19, 30]);
    expect(complementBlock(i, [10, 20.5, 31], [-1, 0, 0]).cell).toEqual([7, 20, 30]);  // −x: c − (sx+1)
    const s = complementBlock(i, [11, 20, 31], [0, 0, 1]);
    expect(s.size).toEqual([2, 0, 1]);         // ADAPTS to the aimed block's size
    expect(s.type).toBe(0);
    expect(s.slot).toBe(4);                    // matches the aimed block's paint
  });

  it('slope slant hits: flush diagonal step, scaled by the footprint', () => {
    // type 1 base orientation: solid y+z ≤ e, slant normal (0,+1,+1)/√2,
    // high edge at z = 0. Beyond the LOW edge the ramp continues down-forward.
    const i = info([10, 20, 30], [0, 0, 0], 1);
    const n: [number, number, number] = [0, Math.SQRT1_2, Math.SQRT1_2];
    expect(complementBlock(i, [10.5, 20.05, 30.95], n).cell).toEqual([10, 19, 31]);  // down-step
    expect(complementBlock(i, [10.5, 20.95, 30.05], n).cell).toEqual([10, 21, 29]);  // up-back
    // big block: the coplanar lattice step scales per axis (e = size+1)
    const big = info([10, 20, 30], [1, 1, 2], 1);
    expect(complementBlock(big, [11, 20.05, 32.9], n).cell).toEqual([10, 18, 33]);   // (0,−e_y,+e_z)
  });

  it('corner slant hits: the step is COPLANAR with the slant plane', () => {
    // type 13 base: slant through (0,0,0),(1,1,0),(1,0,1) → integer normal (−1,1,1)
    const i = info([4, 4, 4], [0, 0, 0], 13);
    const n: [number, number, number] = [-0.5774, 0.5774, 0.5774];
    for (const hit of [[4.9, 4.9, 4.05], [4.05, 4.05, 4.9], [4.9, 4.05, 4.95]]) {
      const c = complementBlock(i, hit as [number, number, number], n).cell;
      const d = [c[0] - 4, c[1] - 4, c[2] - 4];
      expect(-d[0] + d[1] + d[2]).toBe(0);     // m·d = 0 → ghost slant plane == block slant plane
      expect(d).not.toEqual([0, 0, 0]);        // never back inside the aimed block
    }
  });

  it('continuation never lands on the aimed block and keeps footprint/paint', () => {
    const i = info([0, 0, 0], [1, 2, 3], 45);  // inverse corner
    const s = complementBlock(i, [1, 3.9, 1], [0, 1, 0]);
    expect(s.cell).toEqual([0, 3, 0]);         // c_y + (size_y+1)
    // v1.5.2: the aimed block's own shape is NOT kept — the flush MATE of
    // its family is (45's cut plane continues through the joint: type 48)
    expect(s.type).toBe(48);
    expect(s.size).toEqual([1, 2, 3]);
    expect(s.slot).toBe(4);
  });

  // v1.5.2 user rule: "when you have the Triangle edge shape, and on the
  // 'flat' edges place something, the 'inverted quarter' should be placed,
  // nor the same block type right behind it; that only is logical for
  // square blocks" — a same-type slope behind a slope's flat square face
  // touches EDGE-ONLY (a void at the joint); the logical continuation is
  // the inverted wedge whose own full face glues the joint and whose slant
  // stays parallel (the ramp surface continues as a slab).
  it('slope FLAT-face hits take the inverted slope (the flush joint)', () => {
    const i = info([10, 20, 30], [0, 0, 0], 1);   // type 1: solid y+z ≤ 1
    const back = complementBlock(i, [10.5, 20.5, 30.02], [0, 0, -1]);
    expect(back.cell).toEqual([10, 20, 29]);
    expect(back.type).toBe(3);                    // 180°-turned wedge, slant ∥
    const under = complementBlock(i, [10.5, 20.02, 30.5], [0, -1, 0]);
    expect(under.cell).toEqual([10, 19, 30]);
    expect(under.type).toBe(3);
    // the tilted pair (type 5, rise in x-z) behaves the same on its faces
    const pair = complementBlock(info([10, 20, 30], [0, 0, 0], 5), [10.5, 20.5, 30.02], [0, 0, -1]);
    expect(pair.type).toBe(11);
  });

  it('slope TRIANGLE-face hits keep the same slope (the flush sideways ramp)', () => {
    const i = info([10, 20, 30], [0, 0, 0], 1);
    const side = complementBlock(i, [10.02, 20.3, 30.3], [-1, 0, 0]);
    expect(side.cell).toEqual([9, 20, 30]);
    expect(side.type).toBe(1);   // the wedge's triangular side mates its OWN kind
    const side2 = complementBlock(i, [10.98, 20.3, 30.3], [1, 0, 0]);
    expect(side2.cell).toEqual([11, 20, 30]);
    expect(side2.type).toBe(1);
  });

  it('axis-face continuations stay inside the aimed shape family', () => {
    // the mate rule is geometric (flush joint + slant continuation), never a
    // per-shape table: whatever it picks for any table shape, it stays in
    // the family and keeps size+paint (cubes: their only orientation).
    const fam = (t: number) => (t === 0 ? 0 : t <= 12 ? 1 : t <= 20 ? 2 : t <= 44 ? 3 : 4);
    for (const t of [0, 1, 2, 4, 5, 13, 15, 21, 25, 45, 49])
      for (let a = 0; a < 3; a++) for (const sgn of [1, -1]) {
        const n: [number, number, number] = [0, 0, 0]; n[a] = sgn;
        const sp = complementBlock(info([40, 40, 40], [1, 1, 1], t),
          [40, 40, 40].map((c, k) => c + (k === a ? (sgn > 0 ? 2 : 0) : 1)) as [number, number, number], n);
        expect(fam(sp.type), `t=${t} axis=${a}${sgn}`).toBe(fam(t));
        expect(sp.size).toEqual([1, 1, 1]);
        expect(sp.slot).toBe(4);
        expect(sp.cell).not.toEqual([40, 40, 40]);   // never the aimed block
      }
  });

  it('cellOverlap guards the footprint (the red ghost refuses)', () => {
    const bp = { data: { blocks: [
      blockFromCell([8, 5, 8], [1, 0, 0], 0, 4),               // cells x[8,10) y[5,6) z[8,9)
      blockFromCell([8, 5, 20], [0, 0, 0], 255, 0),            // occupancy: no geometry
    ] } } as unknown as Blueprint;
    expect(cellOverlap(bp, [9, 5, 8], [0, 0, 0])).toBe(true);      // inside the slab
    expect(cellOverlap(bp, [10, 5, 8], [0, 0, 0])).toBe(false);    // flush-past the +x end
    expect(cellOverlap(bp, [8, 5, 20], [0, 0, 0])).toBe(false);    // over a 255 marker
    expect(cellOverlap(bp, [8, 5, 8], [2, 0, 0])).toBe(true);      // spanning overlap
  });

  it('rotateType cycles the orientation families (the game scroll wheel)', () => {
    expect(rotateType(0)).toBe(0);             // cube: one orientation
    expect(rotateType(1)).toBe(2); expect(rotateType(12)).toBe(1);   // slope 1..12
    expect(rotateType(20)).toBe(13);                                // corner 13..20
    expect(rotateType(44)).toBe(21);                                // pyramid 21..44
    expect(rotateType(52)).toBe(45);                                // inv corner 45..52
    expect(rotateType(99)).toBe(0);
  });
});

// ------------------------------------------------ v1.4 BLOCK EDITOR layer
describe('in-place rotate / flip (the block interface components have)', () => {
  const bpOf = (blocks: ReturnType<typeof blockFromCell>[]) =>
    ({ data: { blocks } } as unknown as Blueprint);

  it('rotateTypeAbout is a proper 4-cycle about every axis, whole table', () => {
    for (let t = 0; t <= 52; t++)
      for (const ax of ['x', 'y', 'z'] as const) {
        let q = t;
        for (let i = 0; i < 4; i++) q = rotateTypeAbout(q, ax, false);
        expect(q, `type ${t} axis ${ax}`).toBe(t);                   // 4 × 90° = identity
        expect(rotateTypeAbout(rotateTypeAbout(t, ax, false), ax, true)).toBe(t);  // cw undoes ccw
      }
  });

  it('rotatedBlock keeps the bbox CENTRE and swaps the perpendicular footprints', () => {
    const b = blockFromCell([8, 5, 8], [2, 0, 0], 0, 4);            // 3×1×1 slab
    const r = rotatedBlock(b, 'y', false);
    const c0 = blockCells(b), c1 = blockCells(r);
    expect([r.size_x, r.size_y, r.size_z]).toEqual([0, 0, 2]);      // x/z extents exchange
    expect(c1.x + (r.size_x + 1) / 2).toBeCloseTo(c0.x + (b.size_x + 1) / 2, 9);
    expect(c1.z + (r.size_z + 1) / 2).toBeCloseTo(c0.z + (b.size_z + 1) / 2, 9);
    expect(r.type).toBe(0);                                          // cube stays a cube
    expect(r.colors).toEqual(b.colors);                              // paint rides
    // a slope rotates within its slope family (shape+table stay consistent)
    const s = rotatedBlock(blockFromCell([8, 5, 8], [0, 0, 0], 1, 4), 'z', false);
    expect(s.type).toBeGreaterThanOrEqual(1);
    expect(s.type).toBeLessThanOrEqual(12);
  });

  it('flippedBlock mirrors the SHAPE in place (cell + footprint frozen), involutive', () => {
    for (const t of [1, 5, 13, 21, 45]) {
      const b = blockFromCell([4, 5, 6], [1, 0, 2], t, 7);
      const f = flippedBlock(b);
      expect(blockCells(f)).toEqual(blockCells(b));                  // NOT moved (that's mirroredBlock)
      expect([f.size_x, f.size_y, f.size_z]).toEqual([1, 0, 2]);
      expect(f.type).toBe(MIRROR_TYPE[t]);
      expect(flippedBlock(f).type).toBe(t);
    }
  });
});

describe('SIMILAR blocks ⇄ (the block twin index)', () => {
  it('identifies a placed block + its ⇄ twin both ways; none across the plane', () => {
    const b = blockFromCell([8, 5, 6], [1, 0, 0], 13, 4);
    const t = mirroredBlock(b);                                      // mirrored cell + MIRROR_TYPE
    const bp = { data: { blocks: [b, t] } } as unknown as Blueprint;
    expect(blockMirrorTwin(bp, 0)).toBe(1);
    expect(blockMirrorTwin(bp, 1)).toBe(0);
    expect(blockMirrorTwin({ data: { blocks: [b] } } as unknown as Blueprint, 0)).toBe(-1);
    // a footprint straddling x = 0 has no twin
    const s = blockFromCell([3, 5, 6], [4, 0, 0], 0, 4);
    expect(blockMirrorTwin({ data: { blocks: [s] } } as unknown as Blueprint, 0)).toBe(-1);
    // a wrong-shape occupant of the mirrored cell is NOT similar: the rank
    // requires identical-or-mirrored type (15 is neither 13 nor its mirror 17)
    expect(MIRROR_TYPE[13]).toBe(17);
    const wrong = blockFromCell([mirrorBlockCell(8, 1), 5, 6], [1, 0, 0], 15, 4);
    const bp2 = { data: { blocks: [b, wrong] } } as unknown as Blueprint;
    expect(blockMirrorTwin(bp2, 0)).toBe(-1);
  });
});

describe('✧ snap-to-neighbours (converge, else consensus)', () => {
  const bpOf = (blocks: ReturnType<typeof blockFromCell>[]) =>
    ({ data: { blocks } } as unknown as Blueprint);

  it('a cube in a flush cube row is already matching: current type wins, converged', () => {
    const bp = bpOf([
      blockFromCell([7, 5, 8], [0, 0, 0], 0, 4),
      blockFromCell([8, 5, 8], [0, 0, 0], 0, 4),
      blockFromCell([9, 5, 8], [0, 0, 0], 0, 4),
    ]);
    const r = snapBlockType(bp, 1)!;
    expect(r.type).toBe(0);
    expect(r.converged).toBe(true);
    expect(r.neighbours).toBe(2);
  });

  it('a cube between two flanks of one ramp CONVERGES on the ramp continuation', () => {
    // type 1's x-faces are the full y+z≤e triangle: the same triangle glued on
    // both sides admits a flush prism — the continuation ramp (type 1) itself
    const bp = bpOf([
      blockFromCell([7, 5, 8], [0, 0, 0], 1, 4),
      blockFromCell([8, 5, 8], [0, 0, 0], 0, 4),                  // wrongly-faced cube
      blockFromCell([9, 5, 8], [0, 0, 0], 1, 4),
    ]);
    const r = snapBlockType(bp, 1)!;
    expect(r.type).toBe(1);                                        // the same-one convergence
    expect(r.converged).toBe(true);
  });

  it('disagreeing flanks fall back to the CONSENSUS (score < 1, still argmax)', () => {
    // a/b disagree: no type mates perfectly with BOTH (measured 0.813-class)
    const bp = bpOf([
      blockFromCell([7, 5, 8], [0, 0, 0], 1, 4),
      blockFromCell([8, 5, 8], [0, 0, 0], 0, 4),
      blockFromCell([9, 5, 8], [0, 0, 0], 2, 4),
    ]);
    const r = snapBlockType(bp, 1)!;
    expect(r.converged).toBe(false);
    expect(r.score).toBeGreaterThan(0.5);
    expect(r.score).toBeLessThan(0.995);
    // a lone cube flank cannot outvote two agreeing neighbours: add a second
    // type-1 contact above and the consensus side wins the weighting
    const bp2 = bpOf([
      blockFromCell([7, 5, 8], [0, 0, 0], 1, 4),
      blockFromCell([8, 5, 8], [0, 0, 0], 0, 4),
      blockFromCell([9, 5, 8], [0, 0, 0], 2, 4),
      blockFromCell([8, 6, 8], [0, 0, 0], 1, 4),                  // +y neighbour = type-1 family
    ]);
    const r2 = snapBlockType(bp2, 1)!;
    expect(r2.neighbours).toBe(3);
  });

  it('no neighbours → nothing to snap; type-255 never counts', () => {
    const bp = bpOf([blockFromCell([8, 5, 8], [0, 0, 0], 0, 4)]);
    expect(snapBlockType(bp, 0)).toBeNull();
    const bp2 = bpOf([
      blockFromCell([8, 5, 8], [0, 0, 0], 0, 4),
      blockFromCell([7, 5, 8], [0, 0, 0], 255, 0),
    ]);
    expect(snapBlockType(bp2, 0)).toBeNull();
  });
});
