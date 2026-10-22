// mass.ts pins: the GAME's server mass model — the TS twin of
// tools/game_data.py compute_mass. Every expected number below is THAT
// tool's output on the same input (python lines quoted in the comments);
// plus CoM behaviour and the no-atlas fallback table. The pre-v1.7.1
// calibration contract (total ≡ declared) is retired with the model it
// served: hull skin edits must MOVE the displayed weight (user report: a
// sphere skin over a tonne, "the weight did not change").
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { massModel, maximumLiquidDensity } from '../mass';
import { sphereSkinTris, shiftSkinTris } from '../latsphere';
import type { Blueprint, Triangle } from '../format';

const REPO = new URL('../../../../', import.meta.url).pathname;   // app/src/engine/__tests__ → repo root

const bpOf = (o: Partial<Blueprint>): Blueprint => ({
  box_min: { x: 0, y: 0, z: 0 }, box_max: { x: 1, y: 1, z: 1 }, mass: 100,
  data: { version: 2, blocks: [], components: [] }, ...o,
} as Blueprint);

describe('game mass model', () => {
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
    const mm = massModel(bp, null);
    expect(mm.cells).toBe(2);
    expect(mm.families.hull).toBeCloseTo(0.5, 9);            // 2 composite cells × 0.25
    expect(mm.com[0]).toBeCloseTo(0, 9);                     // cells 4&7, 6&5, 7&4 mirror about 5.5
    expect(mm.com[1]).toBeCloseTo(0, 9);
    expect(mm.com[2]).toBeCloseTo(0, 9);
  });

  test('blocks: rect × material density, ANY non-cube type costs HALF', () => {
    const bp = bpOf({
      data: {
        version: 2, mass: 0,
        blocks: [
          // 1-cell concrete cube: 1 cell × density 10 = 10 kg
          { type: 0, material: 1, pos_x: 5, pos_y: 5, pos_z: 5, frame_x: 0, frame_y: 0, frame_z: 0, size_x: 0, size_y: 0, size_z: 0 },
          // steel wedge 4 cells: 4 × 0.5 × density 1 = 2 kg
          { type: 1, material: 2, pos_x: 5, pos_y: 5, pos_z: 6, frame_x: 0, frame_y: 0, frame_z: 0, size_x: 3, size_y: 0, size_z: 0 },
          // occupancy reservations bill nothing
          { type: 255, pos_x: 5, pos_y: 5, pos_z: 7, frame_x: 0, frame_y: 0, frame_z: 0, size_x: 0, size_y: 0, size_z: 0 },
        ],
        components: [],
      },
    } as never);
    const mm = massModel(bp, null);
    expect(mm.families.hull).toBeCloseTo(12, 9);
    expect(mm.cells).toBe(5);                                // census counts the cells anyway
  });

  test('one hull triangle: area·0.05 m ÷ cell³ × density, CoM at its centroid', () => {
    // right triangle, legs 4×4 CELLS at frame (0,0,0): area = 0.5·1·1 = 0.5 m²
    // → 0.5·0.05/0.015625 = 1.6 cell-cubes × 0.25 (composite) = 0.4 kg
    const tri = {
      frame_x: 0, frame_y: 0, frame_z: 0, material: 0,
      v0_x: 6, v0_y: 0, v0_z: 6, v1_x: 10, v1_y: 0, v1_z: 6, v2_x: 6, v2_y: 0, v2_z: 10,
    } as unknown as Triangle;
    const mm = massModel(bpOf({ mass: 0, data: { version: 2, blocks: [], components: [], triangles: [tri] } } as never), null);
    expect(mm.families.skin).toBeCloseTo(0.4, 9);
    expect(mm.skinTris).toBe(1);
    expect(mm.skinAreaM2).toBeCloseTo(0.5, 9);
    // world = (v − 6)·0.25, centroid ((0+1+0)/3, −1.5, (0+0+1)/3)
    expect(mm.com[0]).toBeCloseTo(1 / 3, 6);
    expect(mm.com[1]).toBeCloseTo(-1.5, 9);
    expect(mm.com[2]).toBeCloseTo(1 / 3, 6);
  });

  test('the committed (8,8,16) sphere skin MOVES the weight — 1131 kg composite', () => {
    // game_data.py on the very file this probe builds:
    //   mass: computed 1185.0 | families {blocks: 54.0, triangles: 1131.0, …}
    // (the manifest rides along: the fixture's 8 Dashboards are 0-kg catalog
    //  parts in the game — the no-atlas fallback would add its own 2 kg each)
    const bp = JSON.parse(readFileSync(`${REPO}testdata/9000005001/blueprint.json`, 'utf8')) as Blueprint;
    const manifest = JSON.parse(readFileSync(`${REPO}viewer/models/manifest.json`, 'utf8'));
    const bare = massModel(bp, manifest);
    bp.data.triangles = [
      ...(bp.data.triangles ?? []),
      ...shiftSkinTris(sphereSkinTris({ rx: 8, ry: 8, rz: 16 }, { slot: 51, material: 0 }), [0, 80, 0]),
    ];
    const mm = massModel(bp, manifest);
    expect(bare.total).toBeCloseTo(54, 6);                   // the deck alone
    expect(mm.families.skin).toBeCloseTo(1131.0, 0);         // python: 1131.0
    expect(mm.total).toBeCloseTo(1185.0, 0);                 // python: 1185.0
    expect(mm.com[1], 'a skin committed ABOVE the craft lifts the CoM').toBeGreaterThan(bare.com[1]);
  });

  test('tank contents: fractions × capacity × the crude liquid density', () => {
    // python: maximum_liquid_density('H2O') = 1019.0349… kg/m³
    expect(maximumLiquidDensity('H2O')).toBeCloseTo(1019.0349, 3);
    expect(maximumLiquidDensity('(U235)F6')).toBeCloseTo(825.8524, 3);   // isotope suffix stripped
    const bp = bpOf({
      mass: 0,
      data: {
        version: 2, blocks: [],
        components: [{
          type: 'FluidTank', module: 'tank', position: { x: 0, y: 0, z: 0 },
          orientation: { w: 1, x: 0, y: 0, z: 0 },
          data: { contents: { H2O: 0.5 } },
        }],
      },
    } as never);
    const mm = massModel(bp, null);
    expect(mm.families.fluids).toBeCloseTo(0.5 * 1.5 * 1019.0349, 2);
  });

  test('struts: 1 kg/m at the midpoint (modern metre endpoints)', () => {
    // NB the legacy probe reads exact-integer v0_x < 32 as CELLS (FORMAT),
    // so a modern strut is written with a fractional endpoint here.
    const bp = bpOf({
      mass: 0,
      data: {
        version: 2, blocks: [], components: [],
        struts: [{ frame_x: 1, frame_y: 0, frame_z: 0, v0_x: 0.5, v0_y: 0, v0_z: 0, v1_x: 2.5, v1_y: 0, v1_z: 0 }],
      },
    } as never);
    const mm = massModel(bp, null);
    expect(mm.families.struts).toBeCloseTo(2, 9);
    expect(mm.com[0]).toBeCloseTo(3 - 1.5 + 1.5, 9);         // corner f·3−1.5 + half of the 2 m rod
  });

  test('frame beams: 10 kg per LIT beam flag', () => {
    const bp = bpOf({
      mass: 0,
      data: {
        version: 2, blocks: [], components: [],
        frames: [{ beams: [1, 1, 0, 1], pos_x: 6, pos_y: 6, pos_z: 6 }],
      },
    } as never);
    expect(massModel(bp, null).families.beams).toBeCloseTo(30, 9);
  });

  test('subgrid content counts RECURSIVELY (Build = ghost pose, nested data = built content)', () => {
    const bp = bpOf({
      mass: 0,
      data: {
        version: 2, blocks: [],
        components: [{
          type: 'Build', position: { x: 999, y: 999, z: 999 },
          orientation: { w: 1, x: 0, y: 0, z: 0 },
          data: {
            blocks: [
              { type: 0, pos_x: 5, pos_y: 5, pos_z: 5, frame_x: 0, frame_y: 0, frame_z: 0, size_x: 0, size_y: 0, size_z: 0 },
            ],
            components: [],
          },
        }],
      },
    } as never);
    const mm = massModel(bp, null);
    expect(mm.families.hull).toBeCloseTo(0.25, 9);           // the nested block counts
    expect(mm.families.parts).toBe(0);                        // the Build ghost carries no mass
    expect(Math.abs(mm.com[0]), 'no 999 m ghost pollutes the CoM').toBeLessThan(1);
  });

  test('no-atlas fallback: the built-in part table still applies', () => {
    const bp = bpOf({
      mass: 1,
      data: {
        version: 2, blocks: [],
        components: [{ type: 'PilotSeat', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } }],
      },
    } as never);
    const mm = massModel(bp, null);
    expect(mm.families.parts).toBe(40);                       // COMP_MASS fallback
    expect(mm.total).toBe(40);
  });

  // Corpus pins = tools/game_data.py compute_mass output on these committed
  // testdata files, masses from the committed atlas manifest (the same
  // [ENTITY] .ini values python reads from the game tree). The subgrid craft
  // prove the recursive scan closes the gap to the game-written mass.
  const corpusPin = (id: string, totalKg: number, manifest: unknown) => {
    const bp = JSON.parse(readFileSync(`${REPO}testdata/${id}/blueprint.json`, 'utf8')) as Blueprint;
    const mm = massModel(bp, manifest as never);
    expect(mm.total, id).toBeCloseTo(totalKg, 0);             // ± < 0.5 kg
    return mm;
  };
  test('corpus = the python game model (subgrid-aware)', () => {
    const manifest = JSON.parse(readFileSync(`${REPO}viewer/models/manifest.json`, 'utf8'));
    // 3812927875 ISW-241:   computed 329.0 kg | declared 329.0226 | {blocks 4.2, triangles 29.8, components 295}
    const isw = corpusPin('3812927875', 329.0, manifest);
    expect(isw.declared).toBeCloseTo(329.0, 0);
    expect(isw.skinTris).toBeGreaterThan(0);                  // its 21 hull tris DO weigh now
    // 3417786605 dolphin:   recursive computed 1619.9 kg | declared 1620.875 (top-level-only: 1305.5)
    const dol = corpusPin('3417786605', 1619.9, manifest);
    expect(Math.abs(dol.total - dol.declared) / dol.declared, 'subgrid-aware ≈ the game mass').toBeLessThan(0.01);
    // 3732302108 gantry:    recursive 1787.9 (incl. 152.9 kg fluids, 55.3 kg skin)
    const gan = corpusPin('3732302108', 1787.9, manifest);
    expect(gan.families.skin).toBeCloseTo(55.3, 0);
    expect(gan.families.fluids).toBeCloseTo(152.9, 0);
  });
});
