// mass.ts pins: the calibration contract (total = declared) and a symmetric
// CoM. The density readout is a plausibility check, not a spec — pinned only
// to a generous bound so a unit slip (kg↔g, cell volume) still fails.
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { calibrateCellMass, massModel } from '../mass';
import type { Blueprint } from '../format';
import { corpusDir } from '../../../tools/vite-corpus.ts';

const bpOf = (o: Partial<Blueprint>): Blueprint => ({
  box_min: { x: 0, y: 0, z: 0 }, box_max: { x: 1, y: 1, z: 1 }, mass: 100,
  data: { version: 2, blocks: [], components: [] }, ...o,
} as Blueprint);

describe('mass & CoM', () => {
  test('symmetric hull → CoM on the symmetry point', () => {
    const bp = bpOf({
      data: {
        version: 2, mass: 100,
        blocks: [
          { type: 0, pos_x: 4, pos_y: 6, pos_z: 7, frame_x: 0, frame_y: 0, frame_z: 0, size_x: 0, size_y: 0, size_z: 0 },
          { type: 0, pos_x: 7, pos_y: 5, pos_z: 4, frame_x: 0, frame_y: 0, frame_z: 0, size_x: 0, size_y: 0, size_z: 0 },
        ],
        components: [],
      },
    } as never);
    const mm = massModel(bp, null, 1);
    expect(mm.cells).toBe(2);
    expect(mm.com[0]).toBeCloseTo(0, 9);                   // cells 4&7, 6&5, 7&4 mirror about 5.5
    expect(mm.com[1]).toBeCloseTo(0, 9);
    expect(mm.com[2]).toBeCloseTo(0, 9);
  });

  test('calibration: total lands on the declared mass', () => {
    const bp = bpOf({
      mass: 100,
      data: {
        version: 2, mass: 100,
        blocks: Array.from({ length: 10 }, (_, i) => ({
          type: 0, pos_x: i % 13, pos_y: 5, pos_z: 5, frame_x: 0, frame_y: 0, frame_z: 0,
          size_x: 0, size_y: 0, size_z: 0,
        })),
        components: [],
      },
    } as never);
    const cm = calibrateCellMass(bp, null);
    expect(cm).toBeCloseTo(10, 9);                         // (100 − 0 parts) / 10 cells
    expect(massModel(bp, null, cm).total).toBeCloseTo(100, 9);
  });

  test('calibration floor: a craft declaring LESS than its parts keeps 0.01 kg/cell', () => {
    const bp = bpOf({
      mass: 1,
      data: {
        version: 2, mass: 1, blocks: [{ type: 0, pos_x: 5, pos_y: 5, pos_z: 5, frame_x: 0, frame_y: 0, frame_z: 0, size_x: 0, size_y: 0, size_z: 0 }],
        components: [{ type: 'PilotSeat', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } }],
      },
    } as never);
    expect(calibrateCellMass(bp, null)).toBe(0.01);        // 40 kg seat > 1 kg declared
  });

  test.skipIf(!existsSync(corpusDir()))('ISW: calibrated total = declared, density stays plausible', () => {
    const bp = JSON.parse(readFileSync(`${corpusDir()}/3812927875/blueprint.json`, 'utf8')) as Blueprint;
    const cm = calibrateCellMass(bp, null);                // no atlas: the fallback table
    const mm = massModel(bp, null, cm);
    expect(mm.total).toBeCloseTo(mm.declared, 6);
    expect(mm.declared).toBeGreaterThan(100);
    expect(mm.density).toBeGreaterThan(1);
    expect(mm.density).toBeLessThan(1e6);                  // kg/m³ sanity, not physics
  });
});
