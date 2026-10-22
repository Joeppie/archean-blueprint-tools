// mass.ts — mass & center of mass: THE GAME'S OWN SERVER MODEL, the TS twin
// of tools/game_data.py `compute_mass` (the two MUST agree — the corpus pins
// below are that tool's output on the same inputs). FORMAT §Mass model
// (game MaterialProperties.hh + server collider update + Chemistry.cpp):
//   * densities are per 0.25 m CELL CUBE: composite 0.25, concrete 10, steel
//     1, aluminium 0.5, glass 1, lead 150, titanium 0.6;
//   * blocks: rect × density, ANY non-cube type costs HALF its rect;
//   * triangles (hull skin): area·0.05 m ÷ cell³ × density;
//   * struts 1 kg/m; frame beams 10 kg each;
//   * components the .ini [ENTITY] mass (the atlas manifest), tank CONTENTS
//     fractions of capacity × the game's "very crude" liquid density;
//   * subgrid (Build) content is counted RECURSIVELY — nested data sits at
//     its PARENT-frame absolute coords (FORMAT §Subgrids), which is what
//     closes the gap to the game-written mass on subgrid craft (measured:
//     the giant 151 189 vs declared 151 195 kg, the dolphin 1 620 vs 1 621).
// CoM = mass-weighted cell/part/skin centroids in RAW file space (the view
// layer mirrors; physics itself is file-space).
//
// The pre-v1.7.1 CALIBRATED display (cellMass := (declared − parts)/cells so
// total ≡ declared) is RETIRED: it absorbed every edit into a recalibrated
// hull, so a committed hull skin could NEVER move the displayed weight (user
// report: a large sphere skin over 1.1 t, "the weight did not change"). The
// computed total is now the ABSOLUTE model — skin, struts, beams, fluids and
// subgrid content all move weight AND the CoM the moment they are built; the
// game's saved `declared` field stays as the cross-check row.

import type { Blueprint, BlueprintData, LatticeObj } from './format';
import { CELL, CELLS_PER_FRAME, FRAME, worldCoord } from './format';
import type { ModelManifest } from './models';

/** kg per 0.25 m CELL CUBE per material 0..6 (game MaterialProperties.hh;
 *  the home of the table — engine/tools.ts re-exports it for the UI). */
export const MATERIAL_DENSITY = [0.25, 10, 1, 0.5, 1, 150, 0.6] as const;

const matDens = (m: unknown): number => {
  const i = typeof m === 'number' ? m : 0;
  return i >= 0 && i < MATERIAL_DENSITY.length ? MATERIAL_DENSITY[i]! : 1;
};

const OCCUPANCY_TYPE = 255;
/** hull prism thickness, m (the game draws/scales triangles at 0.05 m) */
const TRIANGLE_THICKNESS = 0.05;
const CELL_VOLUME = CELL ** 3;
const BEAM_MASS = 10;             // kg per frame beam
const STRUT_KG_PER_M = 1;         // steel rod: 10 g each, 100 per metre

/** component masses for the NO-ATLAS fallback (the atlas manifest carries
 *  the real .ini [ENTITY] masses; a catalog part missing from a PRESENT
 *  manifest contributes 0 — the dev/python semantics). */
const COMP_MASS: Readonly<Record<string, number>> = {
  PilotSeat: 40, MiniComputer: 2, HudController: 1, Beacon: 1,
  Aileron: 5, SmallWheel: 4, SmallTurboPump: 6, PowerConverter: 2, LowVoltageBattery: 8,
  SolarPanel: 6, FluidJunction: 1, FluidPort: 0.5, RCS: 2, TiltSensor: 0.5, OwnerPad: 1,
};

// ---------- tank contents: the game's "very crude" liquid density ----------
// game Chemistry.cpp via tools/game_data.py (same table, same formula):
// ρ = Σ atomic_mass·n · 1.6605402e-27 ÷ Σ (4/3)π(0.92e-10·n)³  [kg/m³]
const TANK_CAPACITY: Readonly<Record<string, number>> = {   // m³, ARCHEAN_tank_server.cpp
  FluidTank: 1.5, SmallFluidTank: 0.2, BigFluidTank: 14,
};
const ATOMIC_MASS: Readonly<Record<string, number>> = {
  H: 1.008, He: 4.003, Li: 6.941, Be: 9.012, B: 10.811, C: 12.011,
  N: 14.007, O: 15.999, F: 18.998, Ne: 20.180, Na: 22.990,
  Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06,
  Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078, Ti: 47.867,
  Fe: 55.845, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ag: 107.87,
  Sn: 118.71, Pt: 195.08, Au: 196.97, Hg: 200.59, Pb: 207.2,
  U: 238.03,
};
const ATOMIC_MASS_TO_KG = 1.6605402e-27;

/** strip isotope suffixes: '(U235)F6' → 'UF6', then element+count tokens */
function parseFormula(formula: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const cleaned = formula.replace(/\((\w+?)\d+\)/g, '$1');
  for (const m of cleaned.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (!m[1]) continue;
    counts[m[1]] = (counts[m[1]] ?? 0) + (m[2] ? parseInt(m[2], 10) : 1);
  }
  return counts;
}

/** the game's MAXIMUM liquid density for a molecule (kg/m³); null = an
 *  element the game's Chemistry table does not know */
export function maximumLiquidDensity(formula: string): number | null {
  let mass = 0, volume = 0;
  for (const [el, n] of Object.entries(parseFormula(formula))) {
    const atomic = ATOMIC_MASS[el];
    if (atomic === undefined) return null;
    mass += atomic * n;
    volume += (4 / 3) * Math.PI * (0.92e-10 * n) ** 3;
  }
  return volume > 0 ? mass * ATOMIC_MASS_TO_KG / volume : null;
}

// ---------- the lattice decodes the families need ----------

const world = (o: LatticeObj, ax: 'x' | 'y' | 'z') => worldCoord(o, ax);

/** a hull triangle's three WORLD vertices on the exact FORMAT lattice:
 *  w = (v + 12·f − 6)·CELL  (FORMAT §Triangles — the same g-lattice as the
 *  blocks' cell corners; the legacy nested `v` array is accepted too) */
function triWorldVerts(t: Record<string, unknown>): [[number, number, number], [number, number, number], [number, number, number]] {
  const legacy = Array.isArray(t.v) ? (t.v as number[][]) : null;
  const out = [] as unknown as [[number, number, number], [number, number, number], [number, number, number]];
  for (let i = 0; i < 3; i++) {
    const g = legacy
      ? [legacy[i]?.[0] ?? 0, legacy[i]?.[1] ?? 0, legacy[i]?.[2] ?? 0]
      : (['x', 'y', 'z'] as const).map(ax => {
          const v = Number(t[`v${i}_${ax}`]) || 0;
          return v + CELLS_PER_FRAME * (Number(t[`frame_${ax}`]) || 0);
        });
    out[i] = g.map(q => (q - 6) * CELL) as [number, number, number];
  }
  return out;
}

/** STRUT endpoints in world metres. MODERN files store the `v0`/`v1`
 *  endpoints in METRES from the frame corner (f·3 m − 1.5 m); LEGACY files
 *  wrote lattice CELLS — the dev viewer's own probe recognises them
 *  (FORMAT §Strut endpoints). */
function strutEnds(s: Record<string, number | undefined>): [[number, number, number], [number, number, number]] {
  const legacy = Number.isInteger(s.v0_x) && Math.abs(s.v0_x ?? 0) < 32;
  const k = legacy ? CELL : 1;
  const corner = (ax: 'x' | 'y' | 'z') => (s[`frame_${ax}`] ?? 0) * FRAME - 1.5;
  const p = ((ax: 'x' | 'y' | 'z', v: number | undefined) => corner(ax) + (v ?? 0) * k);
  return [
    (['x', 'y', 'z'] as const).map(ax => p(ax, s[`v0_${ax}`])) as [number, number, number],
    (['x', 'y', 'z'] as const).map(ax => p(ax, s[`v1_${ax}`])) as [number, number, number],
  ];
}

// ---------- the model ----------

export interface MassFamilies {
  /** build blocks (rect × material density, non-cube halved) */
  hull: number;
  /** hull-triangle skin (area·0.05 m ÷ cell³ × material density) */
  skin: number;
  struts: number;
  /** frame beams, 10 kg each */
  beams: number;
  /** parts + subgrid parts (atlas .ini mass) */
  parts: number;
  /** tank contents (fractions × capacity × crude liquid density) */
  fluids: number;
}

export interface MassModel {
  families: MassFamilies;
  /** Σ families — the game's model of what the craft weighs, LIVE */
  total: number;
  com: [number, number, number];            // RAW file space
  declared: number;                         // blueprint.mass (the game's cache)
  cells: number;                            // hull cell count (census)
  skinTris: number;
  skinAreaM2: number;
}

export function massModel(bp: Blueprint, manifest: ModelManifest | null): MassModel {
  const fam: MassFamilies = { hull: 0, skin: 0, struts: 0, beams: 0, parts: 0, fluids: 0 };
  let cells = 0, skinTris = 0, skinAreaM2 = 0;
  let mx = 0, my = 0, mz = 0;
  const place = (m: number, x: number, y: number, z: number) => {
    mx += m * x; my += m * y; mz += m * z;
  };

  const walk = (d: Partial<BlueprintData>) => {
    for (const b of d.blocks ?? []) {
      if (b.type === OCCUPANCY_TYPE) continue;
      const rect = (b.size_x + 1) * (b.size_y + 1) * (b.size_z + 1);
      cells += rect;
      const m = rect * (b.type === 0 ? 1 : 0.5) * matDens(b.material);
      fam.hull += m;
      place(m, world(b, 'x') + b.size_x * CELL / 2,
        world(b, 'y') + b.size_y * CELL / 2, world(b, 'z') + b.size_z * CELL / 2);
    }
    for (const tri of d.triangles ?? []) {
      const t = tri as unknown as Record<string, unknown>;
      const [p0, p1, p2] = triWorldVerts(t);
      const ax = p1[0]! - p0[0]!, ay = p1[1]! - p0[1]!, az = p1[2]! - p0[2]!;
      const bx = p2[0]! - p0[0]!, by = p2[1]! - p0[1]!, bz = p2[2]! - p0[2]!;
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
      skinTris++; skinAreaM2 += area;
      const m = area * TRIANGLE_THICKNESS / CELL_VOLUME * matDens(t['material']);
      fam.skin += m;
      place(m, (p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3);
    }
    for (const s of (d.struts ?? []) as Record<string, number | undefined>[]) {
      const [a, b] = strutEnds(s);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const m = STRUT_KG_PER_M * len;
      fam.struts += m;
      place(m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    }
    for (const f of (d.frames ?? []) as { beams?: unknown[] }[]) {
      const beams = Array.isArray(f.beams) ? f.beams.filter(Boolean).length : 0;
      if (!beams) continue;
      const m = BEAM_MASS * beams;
      fam.beams += m;
      // the corpus carries no frame sample to pin a lattice position: the
      // beams' mass counts toward the total, but it is deliberately NOT
      // CoM-weighted rather than placed on a guessed point.
    }
    for (const c of d.components ?? []) {
      // A Build component is the editor bench GHOST — its own pose carries no
      // mass; its NESTED data is the built subgrid content at parent-frame
      // absolute coordinates (FORMAT §Subgrids) and is counted recursively.
      if (c.type === 'Build') {
        const nested = c.data as Partial<BlueprintData> | undefined;
        if (nested && (Array.isArray(nested.blocks) || Array.isArray(nested.components)
          || Array.isArray(nested.triangles))) walk(nested);
        continue;
      }
      const entry = manifest?.[c.type];
      const m = entry ? (entry.mass || 0) : COMP_MASS[c.type] ?? 2;
      fam.parts += m;
      place(m, c.position.x, c.position.y, c.position.z);
      const cap = TANK_CAPACITY[c.type];
      const contents = c.data?.['contents'];
      if (cap && contents && typeof contents === 'object') {
        for (const [mol, frac] of Object.entries(contents as Record<string, unknown>)) {
          const dens = maximumLiquidDensity(mol);
          const f = typeof frac === 'number' ? frac : NaN;
          if (dens === null || !isFinite(f)) continue;   // unknown molecule: skip
          const m2 = f * cap * dens;
          fam.fluids += m2;
          place(m2, c.position.x, c.position.y, c.position.z);
        }
      }
    }
  };
  walk(bp.data);

  const total = fam.hull + fam.skin + fam.struts + fam.beams + fam.parts + fam.fluids;
  return {
    families: fam, total,
    com: total > 0 ? [mx / total, my / total, mz / total] : [0, 0, 0],
    declared: typeof bp.mass === 'number' ? bp.mass : 0,
    cells, skinTris, skinAreaM2,
  };
}
