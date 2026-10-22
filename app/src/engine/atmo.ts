// ------------------------------------------------------------------- atmo
// REAL-WORLD atmosphere + gas buoyancy for the buoyant-craft planner
// (user 2026-10-22: "tell us what lift would be if vacuum at sea level,
// helium or hydrogen … performance/weight limit at altitudes/equilibrium.
// Archean uses real world data for this").
//
// The model is the U.S. Standard Atmosphere 1976 (ISA) table — geopotential
// base altitudes, base temperatures and lapse rates, pressure from the
// barometric formula per layer (power law where the lapse rate L ≠ 0, the
// isothermal exponential where L = 0), ideal gas ρ = p/(Rs·T) with
// Rs_air = 287.05287 J/(kg·K). Filling gases use the same p,T through
// ρ_gas = p·M/(R★·T) with molar masses M (R★ = 8.314462618 J/(mol·K)):
// vacuum M = 0 (the envelope holds no mass of its own), helium and
// hydrogen at their real molar masses. Net lift at altitude h for an
// envelope volume V:  L(h) = V·(ρ_air(h) − ρ_gas(h))  kg — Archimedes,
// exactly what a floating craft trades against its total mass.
//
// Envelope VOLUME comes from the craft's OWN hull triangles: the signed
// tetrahedron sum over the closed skin (divergence theorem) on the exact
// FORMAT lattice (world = (v + 12f)·CELL − 1.5, FORMAT §Triangles). A skin
// built by the Sphere skin tool is convex and closed, so the number is the
// true gas volume; several disjoint skins sum.
// ---------------------------------------------------------------------------
import type { Triangle } from './format';
import { hullVertex } from './hullfit';

// ------------------------------------------------------- ISA layer table
// base geopotential altitude m, base temperature K, lapse rate K/m, base
// pressure Pa (the 1976 table's own values to the printed precision).
const LAYERS: readonly { h: number; t: number; l: number; p: number }[] = [
  { h: 0,     t: 288.15, l: -0.0065, p: 101325.0 },
  { h: 11000, t: 216.65, l: 0,       p: 22632.1 },
  { h: 20000, t: 216.65, l: 0.001,   p: 5474.89 },
  { h: 32000, t: 228.65, l: 0.0028,  p: 868.019 },
  { h: 47000, t: 270.65, l: 0,       p: 110.909 },
  { h: 51000, t: 270.65, l: -0.0028, p: 66.9389 },
  { h: 71000, t: 214.65, l: -0.002,  p: 3.95642 },
];
export const ALT_CEILING = 84852;   // top of the 1976 table (m)

const G0 = 9.80665;        // standard gravity m/s²
const RS_AIR = 287.05287;  // J/(kg·K)
const R_STAR = 8.314462618; // J/(mol·K)

export interface IsaState { tK: number; pPa: number; rhoKg: number }

/** Standard-atmosphere temperature/pressure/density at altitude h (metres,
 *  clamped to [0, ALT_CEILING]). */
export function isaAt(h: number): IsaState {
  const alt = Math.max(0, Math.min(ALT_CEILING, h));
  let L = LAYERS[0]!;
  for (const l of LAYERS) { if (alt >= l.h) L = l; else break; }
  const dh = alt - L.h;
  const t = L.t + L.l * dh;
  const p = L.l === 0
    ? L.p * Math.exp(-G0 * dh / (RS_AIR * L.t))
    : L.p * Math.pow(t / L.t, -G0 / (L.l * RS_AIR));
  return { tK: t, pPa: p, rhoKg: p / (RS_AIR * t) };
}

// --------------------------------------------------------------- the gases
export interface LiftingGas { id: string; label: string; molarMass: number }

/** Vacuum = a hull holding NOTHING (the theoretical maximum; the game's
 *  skin has mass but no gas does). Helium/hydrogen at their real molar
 *  masses (kg/mol). */
export const GASES: readonly LiftingGas[] = [
  { id: 'vacuum',   label: 'Vacuum',   molarMass: 0 },
  { id: 'helium',   label: 'Helium',   molarMass: 0.004002602 },
  { id: 'hydrogen', label: 'Hydrogen', molarMass: 0.00201588 },
];

const gasOf = (id: string): LiftingGas => GASES.find(g => g.id === id) ?? GASES[0]!;

/** density (kg/m³) of the lifting gas at altitude h (ideal gas at the
 *  ambient ISA pressure/temperature — the envelope rides at 1× ambient). */
export function gasRho(gasId: string, h: number): number {
  const g = gasOf(gasId);
  if (g.molarMass === 0) return 0;
  const { tK, pPa } = isaAt(h);
  return pPa * g.molarMass / (R_STAR * tK);
}

/** net lift in KILOGRAMS for an envelope of volumeM3 filled with gasId at
 *  altitude h: V·(ρ_air − ρ_gas). Zero at the equilibrium altitude for the
 *  equal-mass craft. */
export function liftKg(gasId: string, volumeM3: number, h: number): number {
  return volumeM3 * (isaAt(h).rhoKg - gasRho(gasId, h));
}

export interface Equilibrium {
  /** the craft cannot even float at sea level — lift(0) < mass */
  sinks: boolean;
  /** equilibrium altitude m (buoyancy = total mass); 0 when sinks */
  m: number;
  /** true = it is still buoyant at the top of the atmosphere table */
  atCeiling: boolean;
}

/** The FLOATING altitude of a craft: V·(ρ_air − ρ_gas) = massKg. Both
 *  densities fall monotonically with h and air falls faster in absolute
 *  terms for every real fill, so the net lift is strictly decreasing and a
 *  60-step bisection nails the crossing to sub-metre. */
export function equilibrium(gasId: string, volumeM3: number, massKg: number): Equilibrium {
  if (volumeM3 <= 0) return { sinks: true, m: 0, atCeiling: false };
  if (liftKg(gasId, volumeM3, 0) < massKg) return { sinks: true, m: 0, atCeiling: false };
  if (liftKg(gasId, volumeM3, ALT_CEILING) >= massKg)
    return { sinks: false, m: ALT_CEILING, atCeiling: true };
  let lo = 0, hi = ALT_CEILING;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (liftKg(gasId, volumeM3, mid) > massKg) lo = mid; else hi = mid;
  }
  return { sinks: false, m: (lo + hi) / 2, atCeiling: false };
}

// ------------------------------------------------------------ envelope volume
export interface Envelope { m3: number; tris: number }

/** Interior volume (m³) of a CLOSED hull-triangle skin: the signed
 *  tetrahedron sum 6V = Σ v0·(v1 × v2) over every triangle, on the exact
 *  lattice (hullVertex = FORMAT world law). Winding-agnostic (absolute
 *  value): mixed winds still bound the same volume; disjoint skins sum.
 *  An OPEN skin under/overcounts by the missing faces — the widget labels
 *  the number as an estimate either way. */
export function envelopeVolume(tris: readonly Triangle[]): Envelope {
  let v6 = 0;
  for (const t of tris) {
    const a = hullVertex(t, 0), b = hullVertex(t, 1), c = hullVertex(t, 2);
    v6 += a.x * (b.y * c.z - b.z * c.y)
        - a.y * (b.x * c.z - b.z * c.x)
        + a.z * (b.x * c.y - b.y * c.x);
  }
  return { m3: Math.abs(v6) / 6, tris: tris.length };
}

/** altitude rows the weight-limit table walks (m) */
export const ALT_STEPS: readonly number[] = [0, 2000, 5000, 11000, 20000, 32000];

/** the LARGEST total craft mass (kg) that still floats at altitude h — the
 *  "weight limit" row: exactly the net lift at that altitude. */
export const maxFloatMassKg = (gasId: string, volumeM3: number, h: number) =>
  liftKg(gasId, volumeM3, h);
