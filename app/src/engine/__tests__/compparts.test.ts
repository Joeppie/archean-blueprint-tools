// compparts.ts pins: quaternion rotation, collider box → view AABB with the
// z-mirror + view-quat chain, Build ghosts and unknown types skipped.
import { describe, expect, test } from 'vitest';
import { buildPartBoxes, compPartBoxes, qRot } from '../compparts';
import type { Blueprint } from '../format';

const Y90 = { w: Math.SQRT1_2, x: 0, y: Math.SQRT1_2, z: 0 };   // +90° about y
const man = { Thing: { colliders: [{ name: 'c', min: [0, 0, 0] as [number, number, number], max: [1, 0.5, 0.25] as [number, number, number] }] } };

describe('qRot', () => {
  test('identity keeps vectors; right-handed +90° about y maps x→−z, z→x', () => {
    expect(qRot({ w: 1, x: 0, y: 0, z: 0 }, [1, 2, 3])).toEqual([1, 2, 3]);
    const px = qRot(Y90, [1, 0, 0]);
    expect(px[0]).toBeCloseTo(0); expect(px[2]).toBeCloseTo(-1);
    const pz = qRot(Y90, [0, 0, 1]);
    expect(pz[0]).toBeCloseTo(1); expect(pz[2]).toBeCloseTo(0);
    expect(qRot(Y90, [0, 1, 0])).toEqual([0, 1, 0]);
  });
});

describe('compPartBoxes', () => {
  const comp = (orientation = { w: 1, x: 0, y: 0, z: 0 }) => ({
    type: 'Thing', position: { x: 1, y: 2, z: -3 }, orientation,
  });

  test('identity quat: LH local box z-mirrors into the view AABB', () => {
    const [box] = compPartBoxes(comp() as never, man, false, 7);
    expect(box!.ci).toBe(7);
    box!.center.forEach((v, i) => expect(v).toBeCloseTo([1.5, 2.25, 2.875][i]!, 6));
    box!.size.forEach((v, i) => expect(v).toBeCloseTo([1, 0.5, 0.25][i]!, 6));
  });

  test('yawed box grows to the rotated AABB (x↔z swap under 90°)', () => {
    const [box] = compPartBoxes(comp(Y90) as never, man, false, 0);
    box!.size.forEach((v, i) => expect(v).toBeCloseTo([0.25, 0.5, 1][i]!, 6));
    box!.center.forEach((v, i) => expect(v).toBeCloseTo([0.875, 2.25, 2.5][i]!, 6));
  });

  test('unknown component type yields no boxes', () => {
    expect(compPartBoxes({ type: 'Nope', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } } as never, man, false, 0)).toEqual([]);
  });
});

describe('buildPartBoxes', () => {
  test('Build ghosts are skipped', () => {
    const bp = { box_min: { x: 0, y: 0, z: 0 }, box_max: { x: 1, y: 1, z: 1 },
      data: { version: 2, blocks: [], components: [
        { type: 'Build', position: { x: 900, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
        { type: 'Thing', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
      ] } } as unknown as Blueprint;
    const boxes = buildPartBoxes(bp, man);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every(b => b.ci === 1)).toBe(true);
    expect(buildPartBoxes(bp, null)).toEqual([]);
  });
});
