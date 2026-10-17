// compparts.ts pins: quaternion rotation, collider box → view AABB with the
// z-mirror + view-quat chain, Build ghosts and unknown types skipped, and the
// DISPLAY-POSE rules (wheel droop, builder-flat junction, toggle yaw-180).
import { describe, expect, test } from 'vitest';
import { buildPartBoxes, compPartBoxes, displayQuat, qMul, qRot, standInBox } from '../compparts';
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

describe('displayQuat', () => {
  const I = { w: 1, x: 0, y: 0, z: 0 };

  test('FluidJunction rides the builder-FLAT pose (file −x,−y,z,w), convention-free', () => {
    const qF = { w: 0.5, x: 0.5, y: 0.5, z: 0.5 };
    expect(displayQuat('FluidJunction', Y90, qF)).toEqual({ w: 0.5, x: -0.5, y: -0.5, z: 0.5 });
  });

  test('ToggleButton = view quat ∘ yaw-180 (plate flush, lever out of the mount)', () => {
    const got = displayQuat('ToggleButton', Y90, I);
    const want = qMul(Y90, { w: 0, x: 0, y: 1, z: 0 });
    expect(got.w).toBeCloseTo(want.w); expect(got.x).toBeCloseTo(want.x);
    expect(got.y).toBeCloseTo(want.y); expect(got.z).toBeCloseTo(want.z);
  });

  test('wheel droop: the horizontal suspension arm (local +y) swings DOWN (−y)', () => {
    const q = displayQuat('SmallWheel', I, I);
    const arm = qRot(q, [0, 0.447, 0]);                       // ISW arm length
    expect(arm[1]).toBeCloseTo(-0.447, 6);                    // hangs below the mount
    expect(Math.hypot(...arm)).toBeCloseTo(0.447, 6);         // a ROLL: length preserved
    const axle = qRot(q, [1, 0, 0]);                          // axle untouched (x̂ roll)
    axle.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0][i]!, 6));
  });

  test('a wheel already hanging keeps its pose (no flip past −y)', () => {
    const down = qMul({ w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 }, I);  // x̂ 180°: +y→−y… 
    const q = displayQuat('Wheel', down, I);
    const arm = qRot(q, [0, 0.447, 0]);
    expect(arm[1]).toBeLessThan(0);                           // stays down
  });

  test('plain parts ride the view quat untouched', () => {
    expect(displayQuat('LowVoltageBattery', Y90, I)).toEqual(Y90);
  });
});

describe('standInBox', () => {
  const comp = { type: 'X', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } };
  test('atlas collider wins; degenerate collider falls back to the footprint', () => {
    const b = standInBox(comp as never, man.Thing);
    b.center.forEach((v, i) => expect(v).toBeCloseTo([0.5, 0.25, 0.125][i]!, 6));
    const flat = standInBox({ ...comp, occupancies: { size_x: 2, size_y: 0, size_z: 1 } } as never,
      { colliders: [{ name: 'p', min: [0, 0, 0], max: [0, 0, 0] }] });
    expect(flat.size).toEqual([0.75, 0.25, 0.5]);             // inclusive cell rule
  });
});
