// compparts.ts pins: quaternion rotation, collider box → world AABB under
// the placement law (view == file frame since the v0.180 de-mirror, no local
// z-flip), Build ghosts and unknown types skipped, and the DISPLAY-POSE
// rules (wheel droop, builder-flat junction, toggle yaw-180).
import { describe, expect, test } from 'vitest';
import { buildPartBoxes, compPartBoxes, displayQuat, occStandLocal, qMul, qRot, standInBox } from '../compparts';
import type { Blueprint } from '../format';

const I = { w: 1, x: 0, y: 0, z: 0 };                       // identity quat
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

  test('identity quat: local box lands RAW at the component position (v0.180)', () => {
    const [box] = compPartBoxes(comp() as never, man, 7);
    expect(box!.ci).toBe(7);
    box!.center.forEach((v, i) => expect(v).toBeCloseTo([1.5, 2.25, -2.875][i]!, 6));
    box!.size.forEach((v, i) => expect(v).toBeCloseTo([1, 0.5, 0.25][i]!, 6));
  });

  test('yawed box grows to the rotated AABB (x↔z swap under 90°; one raw law = R(q))', () => {
    const [box] = compPartBoxes(comp(Y90) as never, man, 0);
    box!.size.forEach((v, i) => expect(v).toBeCloseTo([0.25, 0.5, 1][i]!, 6));
    // v1.5.11 ONE raw law: R(Y90) maps x̂→−ẑ (RH +90 about y), so the local
    // box x∈[0,1], z∈[0,0.25] lands at world x∈[0,0.25], z∈[−1,0] + pos.
    box!.center.forEach((v, i) => expect(v).toBeCloseTo([1.125, 2.25, -3.5][i]!, 6));
  });

  test('unknown component type yields no boxes', () => {
    expect(compPartBoxes({ type: 'Nope', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } } as never, man, 0)).toEqual([]);
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

  test('FluidJunction rides the builder-FLAT pose = the RAW file quat R(q), both generations (v0.180)', () => {
    const qF = { w: 0.5, x: 0.5, y: 0.5, z: 0.5 };
    expect(displayQuat('FluidJunction', Y90, qF)).toEqual(qF);
  });

  test('ToggleButton = view quat ∘ yaw-180 (plate flush, lever out of the mount)', () => {
    const got = displayQuat('ToggleButton', Y90, I);
    const want = qMul(Y90, { w: 0, x: 0, y: 1, z: 0 });
    expect(got.w).toBeCloseTo(want.w); expect(got.x).toBeCloseTo(want.x);
    expect(got.y).toBeCloseTo(want.y); expect(got.z).toBeCloseTo(want.z);
  });

  test('WHEELS: one raw law — legacy rides qView as-is; modern droops the arm to −y', () => {
    // 2026-10-19 (user: ISW casters "sticking up" in the app vs the legacy
    // viewer/in-game): the semi-truck evidence that retired the droop was
    // collected on a RAW-quat legacy file — there the rule stays OFF (app ==
    // dev build pose, wheelpair-verified). On modern files the display rolls
    // the suspension arm to −y about the world axle, the legacy viewer's
    // applyDisplayPose rule. v1.5.11: the droop INPUT is the RAW quat now
    // (fileToViewQuat = identity) — the ISW caster quat already hangs the
    // arm below the mount, and the roll rule leaves a hanging arm untouched.
    const x90 = { w: Math.SQRT1_2, x: -Math.SQRT1_2, y: 0, z: 0 };   // ISW caster file quat
    const rawX = x90;                                                // fileToViewQuat(x90) = AS-IS
    for (const t of ['SmallWheel', 'Wheel', 'BigWheel']) {
      expect(displayQuat(t, x90, x90, true)).toEqual(x90);           // legacy: qView as-is
      const d = displayQuat(t, rawX, x90, false);                    // modern: hangs/droops
      const arm = qRot(d, [0, 0, -1]);        // world arm (content C maps file ŷ → −ẑ)
      expect(arm[1]).toBeCloseTo(-1, 6);                             //   hangs BELOW the mount
      const axle = qRot(d, [1, 0, 0]);
      expect(axle[1]).toBeCloseTo(0, 6);                             // axle stays horizontal
    }
    expect(displayQuat('SmallWheel', I, I, true)).toEqual(I);        // legacy identity: untouched
    const dId = displayQuat('SmallWheel', I, I, false);              // modern identity: hangs
    expect(qRot(dId, [0, 0, -1])[1]).toBeCloseTo(-1, 6);
    // vertical-axle mount (axle qView-rotated to +ŷ): cannot droop → file pose kept
    const z90 = { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 };
    expect(displayQuat('SmallWheel', z90, z90, false)).toEqual(z90);
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
    const flat = standInBox({ ...comp, occupancies: [{ size_x: 2, size_y: 0, size_z: 1 }] } as never,
      { colliders: [{ name: 'p', min: [0, 0, 0], max: [0, 0, 0] }] });
    expect(flat.size).toEqual([0.75, 0.25, 0.5]);             // inclusive cell rule
  });
});

describe('displayQuat wheel gate (v1.11.8 — the F/A-18F nose gear, we: "the front-wheel of the F18 seems to be rotated wrong")', () => {
  // the caster droop roll (arm→down) rides SmallWheel ONLY — the roll was
  // validated in-game for the ISW/truck SmallWheel casters (v0.134/v0.139).
  // The F/A-18F nose gear 'Wheel' pair [x=0, y=±.707, z=0, w=∓.707]
  // (±90°ŷ steering-yaw mounts, axle file ẑ → world x̂) passed the old
  // WHEEL_TYPES gate and the roll spun each wheel 90° about its rolling
  // axis — a blade-edge-forward wheel in the editor. Big gear wheels ride
  // the plain view law (v1.11.5).
  const N90 = { w: -0.7071067811865476, x: 0, y: 0.7071067811865476, z: 0 };
  test("'Wheel' (big gear) returns the plain view quaternion", () => {
    const q = displayQuat('Wheel', N90, N90, false);
    expect(q).toEqual(N90);
  });
  test("'BigWheel' returns the plain view quaternion", () => {
    const q = displayQuat('BigWheel', N90, N90, false);
    expect(q).toEqual(N90);
  });
  test("'SmallWheel' casters keep the droop roll (roll fires on a passing gate)", () => {
    // a caster mount pair: arm file +ŷ ends up horizontal → the arm→down
    // roll composes; the returned quat must DIFFER from the plain view quat
    const q = displayQuat('SmallWheel', N90, N90, false);
    const differs = Math.abs(q.w - N90.w) + Math.abs(q.x - N90.x)
      + Math.abs(q.y - N90.y) + Math.abs(q.z - N90.z) > 1e-6;
    expect(differs, 'the caster roll composes for SmallWheel').toBe(true);
    // and the axle A = qView·x̂ survives the roll (rotation about the axle)
    const A = qRot(N90, [1, 0, 0]);
    const A2 = qRot(q, [1, 0, 0]);
    A2.forEach((v, i) => expect(v).toBeCloseTo(A[i]!, 6));
  });
});

describe('occStandLocal (initial box == menu occupancy box)', () => {
  // the painted per-part stand-in IS the translucent type-255 overlay box
  // (buildCompProxies), placed under the rotated part group: spinning the
  // local point back by qDisp must land exactly on the cell centre.
  const center = [0.125, 0.875, 0.125] as const;            // ISW FluidPort cell
  const origin = [0, 0.875, 0.125] as const;                // its part position
  test('identity pose: offset along x', () => {
    const { pos, quat } = occStandLocal(center, origin, I);
    expect(pos.map(v => +v.toFixed(6))).toEqual([0.125, 0, 0]);
    expect([quat.w, quat.x, quat.y, quat.z].map(v => v + 0)).toEqual([1, 0, 0, 0]);  // +0 strips -0
  });
  test('90° yaw mount: box still covers the cell (world round-trip)', () => {
    const { pos, quat } = occStandLocal(center, origin, Y90);
    const back = qRot(Y90, pos);                            // back into world
    expect(back[0]! + origin[0]!).toBeCloseTo(center[0], 9);
    expect(back[1]! + origin[1]!).toBeCloseTo(center[1], 9);
    expect(back[2]! + origin[2]!).toBeCloseTo(center[2], 9);
    expect(quat).toEqual({ w: Y90.w, x: -Y90.x, y: -Y90.y, z: -Y90.z });
  });
});
