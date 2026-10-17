// mass.ts — mass & center of mass (legacy §mass & CoM): component masses are
// the atlas manifest estimates (kg) with a built-in fallback table; the
// structural hull = cellMass per 0.25 m cell, CALIBRATED so the total
// matches the craft's declared blueprint.mass — the implied density is then
// a plausibility readout, and the CoM is a live physics check of the whole
// bookkeeping (RAW file coordinates; the view layer mirrors z).
//
// Volume-block masses are not in the blueprint — never display them.

import type { Blueprint, LatticeObj } from './format';
import { CELL, worldCoord } from './format';
import type { ModelManifest } from './models';

const COMP_MASS: Readonly<Record<string, number>> = {
  PilotSeat: 40, MiniComputer: 2, HudController: 1, Beacon: 1,
  Aileron: 5, SmallWheel: 4, SmallTurboPump: 6, PowerConverter: 2, LowVoltageBattery: 8,
  SolarPanel: 6, FluidJunction: 1, FluidPort: 0.5, RCS: 2, TiltSensor: 0.5, OwnerPad: 1,
};

export interface MassModel {
  compSum: number; cells: number; total: number;
  com: [number, number, number];            // RAW file space
  declared: number;                         // blueprint.mass (may be 0)
  density: number;                          // kg/m³ implied by cellMass
  cellMass: number;
}

const world = (o: LatticeObj, ax: 'x' | 'y' | 'z') => worldCoord(o, ax);

export function massModel(bp: Blueprint, manifest: ModelManifest | null, cellMass: number): MassModel {
  let compSum = 0, cells = 0, mx = 0, my = 0, mz = 0, tot = 0;
  for (const c of bp.data.components) {
    const m = manifest?.[c.type]?.mass ?? COMP_MASS[c.type] ?? 2;
    compSum += m;
    mx += m * c.position.x; my += m * c.position.y; mz += m * c.position.z; tot += m;
  }
  for (const b of bp.data.blocks) {
    if (b.type === 255) continue;
    const n = (b.size_x + 1) * (b.size_y + 1) * (b.size_z + 1);
    cells += n;
    const m = n * cellMass;
    mx += m * (world(b, 'x') + b.size_x * CELL / 2);
    my += m * (world(b, 'y') + b.size_y * CELL / 2);
    mz += m * (world(b, 'z') + b.size_z * CELL / 2);
    tot += m;
  }
  return {
    compSum, cells, total: tot,
    com: tot > 0 ? [mx / tot, my / tot, mz / tot] : [0, 0, 0],
    declared: typeof bp.mass === 'number' ? bp.mass : 0,
    density: cellMass / (CELL ** 3), cellMass,
  };
}

/** Calibrate cellMass so total = declared (legacy guard: floor 0.01 kg). */
export function calibrateCellMass(bp: Blueprint, manifest: ModelManifest | null): number {
  let compSum = 0, cells = 0;
  for (const c of bp.data.components) compSum += manifest?.[c.type]?.mass ?? COMP_MASS[c.type] ?? 2;
  for (const b of bp.data.blocks)
    if (b.type !== 255) cells += (b.size_x + 1) * (b.size_y + 1) * (b.size_z + 1);
  const declared = typeof bp.mass === 'number' ? bp.mass : 0;
  if (!cells) return 1.5;
  return Math.max(0.01, (declared - compSum) / cells);
}
