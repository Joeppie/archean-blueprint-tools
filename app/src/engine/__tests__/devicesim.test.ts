// devicesim.test.ts — the actuator laws of "the craft comes alive"
// (v1.15.6): the io bus channels MEAN what the game's own wiki says
// (wiki/en/components/joints/*.md, lights/Lamp.md), the SIM IS A VIEW
// (no blueprint writes), and a moving master IS a moving panel (the pose
// the scene feeds to syncSubJoints is the one the subgrid rides).
import { describe, expect, test } from 'vitest';
import { DeviceSim, dataNeighbours, servoLimits, trackTarget } from '../devicesim';
import type { Blueprint } from '../format';

const comp = (type: string, data: Record<string, unknown> = {}) => ({
  type, alias: '', position: { x: 0, y: 0, z: 0 },
  orientation: { w: 1, x: 0, y: 0, z: 0 }, colors: {}, data,
});
const bp = (components: ReturnType<typeof comp>[]): Blueprint =>
  ({ data: { version: 1, blocks: [], components } } as unknown as Blueprint);

const JOINTS: Record<string, { name: string; limits: [number, number, number] | undefined }[]> = {
  SmallHinge: [{ name: 'axle', limits: [-90, 0, 90] }],
  SmallPivot: [{ name: 'axle', limits: [-360, 10, 360] }],
  LinearTrack: [{ name: 'axle', limits: undefined }],
  Lamp: [],
  SpotLight: [],
  Propeller: [{ name: 'axle', limits: [0, -33.45, 360] }],
  Aileron: [{ name: 'joint', limits: [-45, 0, 45] }],
  Wheel: [{ name: 'suspension', limits: undefined }, { name: 'steering', limits: [30, 0, -30] },
    { name: 'axle', limits: [0, 0, 360] }],
};
const jointNames = (type: string) => JOINTS[type] ?? [];

const settle = (sim: DeviceSim) => { for (let i = 0; i < 200; i++) sim.step(0.25); };

describe('servo laws (wiki SmallHinge/SmallPivot/LinearTrack)', () => {
  test('SmallHinge: ch0 −1..+1 → ∓90°', () => {
    expect(servoLimits('SmallHinge', [-90, 0, 90], 1)).toBe(90);
    expect(servoLimits('SmallHinge', [-90, 0, 90], -1)).toBe(-90);
    expect(servoLimits('SmallHinge', [-90, 0, 90], 0.5)).toBe(45);
  });
  test('SmallPivot: ch0 −1..+1 → ∓360° (0 lands on the same pose)', () => {
    expect(servoLimits('SmallPivot', [-360, 10, 360], 1)).toBe(360);
    expect(servoLimits('SmallPivot', [-360, 10, 360], 0)).toBe(0);
  });
  test('LinearTrack: absolute metres, clamped to the limits', () => {
    expect(trackTarget({ minPos: -1, maxPos: 2 }, 1.5)).toBe(1.5);
    expect(trackTarget({ minPos: -1, maxPos: 2 }, 9)).toBe(2);
    expect(trackTarget({ minPos: -1, maxPos: 2 }, -9)).toBe(-1);
    expect(trackTarget({ overrideLimits: true, manualMinPos: -0.75, manualMaxPos: 0.5 }, 1))
      .toBe(0.5);
  });
});

describe('DeviceSim — channel → pose', () => {
  test('hinge at ch0 = 1 slews to +90° on the axle node', () => {
    const sim = new DeviceSim();
    sim.load(bp([comp('SmallHinge', { angle: 0, maxSpeed: 2 })]), jointNames);
    sim.write(0, 0, 1);
    settle(sim);
    expect(sim.snapshot().get(0)!.joints!.axle!.angle).toBeCloseTo(90);
  });
  test('the slew is rate-limited by maxSpeed (rot/s)', () => {
    const sim = new DeviceSim();
    sim.load(bp([comp('SmallHinge', { angle: 0, maxSpeed: 1 })]), jointNames);
    sim.write(0, 0, 1);
    sim.step(0.04);                              // one 25 Hz cycle
    expect(sim.snapshot().get(0)!.joints!.axle!.angle!).toBeLessThanOrEqual(360 * 0.04 + 1e-6);
    expect(sim.snapshot().get(0)!.joints!.axle!.angle!).toBeGreaterThan(0);
  });
  test('pivot VELOCITY mode integrates v·maxSpeed (no target)', () => {
    const sim = new DeviceSim();
    sim.load(bp([comp('SmallPivot', { angle: 0, maxSpeed: 1, servoMode: false })]), jointNames);
    sim.write(0, 0, 0.5);
    for (let i = 0; i < 10; i++) sim.step(0.1);  // 1 s at half speed
    expect(sim.snapshot().get(0)!.joints!.axle!.angle).toBeCloseTo(180);
  });
  test('track ch0 is metres: slides the axle node', () => {
    const sim = new DeviceSim();
    sim.load(bp([comp('LinearTrack', { pos: 0, minPos: -1, maxPos: 1, maxSpeed: 0.5 })]), jointNames);
    sim.write(0, 0, 0.5);
    settle(sim);
    expect(sim.snapshot().get(0)!.joints!.axle!.slide).toBeCloseTo(0.5);
  });
  test('lamp ch0+RGB → glow; ch0 = 0 → black', () => {
    const sim = new DeviceSim();
    sim.load(bp([comp('Lamp')]), jointNames);
    sim.write(0, 0, 1); sim.write(0, 1, 255); sim.write(0, 2, 128); sim.write(0, 3, 0);
    let p = sim.snapshot().get(0)!;
    expect(p.glow).toEqual({ r: 1, g: 0.5019607843137255, b: 0 });
    sim.write(0, 0, 0);
    p = sim.snapshot().get(0)!;
    expect(p.glow).toEqual({ r: 0, g: 0, b: 0 });
  });
  test('aileron rides the PILOT roll channel · ±45°', () => {
    const sim = new DeviceSim();
    sim.load(bp([comp('Aileron', { angle: 0 })]), jointNames);
    sim.writePilot('Roll', -1);
    expect(sim.snapshot().get(0)!.joints!.joint!.angle).toBeCloseTo(-45);
  });
  test('wheel: ch1 steers ±30°, ch0 spins the axle', () => {
    const sim = new DeviceSim();
    sim.load(bp([comp('Wheel')]), jointNames);
    sim.write(0, 1, 1);
    sim.write(0, 0, 1);
    sim.step(0.1);
    const j = sim.snapshot().get(0)!.joints!;
    expect(j.steering!.angle).toBeCloseTo(30);
    expect(j.axle!.angle).toBeGreaterThan(0);
  });
  test('an undriven type is not in the snapshot', () => {
    const sim = new DeviceSim();
    sim.load(bp([comp('PilotSeat')]), jointNames);
    sim.write(0, 0, 1);
    settle(sim);
    expect(sim.snapshot().size).toBe(0);
  });
});

describe('THE SPARE-BUTTON LAW (we: the dolphin — door toggles, no computer)', () => {
  const wire = (a: number, b: number, type = 'data') =>
    ({ type, a_component: a, b_component: b, a_port: 'data', b_port: 'data' });
  test('dataNeighbours finds the top-level driven part across a data cable', () => {
    const b = { data: { components: [
      comp('ToggleButton', {}), comp('SmallHinge', {}), comp('Lamp', {}),
    ], pipes: [wire(0, 1), { type: 'lowvoltage', a_component: 0, b_component: 2 }] } } as never;
    expect(dataNeighbours(b, 0)).toEqual([{ ci: 1, type: 'SmallHinge', alias: '' }]);
  });
  test('FLATTENED nested endpoints (index past the top-level array) skip', () => {
    const b = { data: { components: [comp('ToggleButton', {}), comp('SmallHinge', {})],
      pipes: [wire(0, 62)] } } as never;                        // the dolphin: [8]→[62] nested
    expect(dataNeighbours(b, 0)).toEqual([]);
  });
  test('actuators() lists the servo parts the broadcast drives', () => {
    const sim = new DeviceSim();
    sim.load(bp([comp('SmallHinge', {}), comp('Lamp', {}), comp('SmallPivot', { servoMode: true }),
      comp('LinearTrack', {})]), jointNames);
    expect(sim.actuators().map(a => a.type)).toEqual(['SmallHinge', 'SmallPivot', 'LinearTrack']);
  });
});
