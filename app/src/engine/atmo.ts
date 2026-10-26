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
import type { Block, Triangle } from './format';
import { hullVertex } from './hullfit';
import { sealedEnvelopeWasm } from './sealwasm';

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
/** v1.11 SEALED envelope (we: "lift should calculate from a volume block.
 *  Note we only look at enclosed blocks/triangles. Implement that, then use
 *  it"): every block cell (occupancy mirrors included — a part's body walls
 *  the seal) and every hull triangle (voxel-sampled at half-cell steps in
 *  its dominant projection plane) become WALLS on the 0.25 m lattice; a
 *  6-connected flood fills OUTSIDE from the padded bounding-box rim; the
 *  ENVELOPE is every cell the flood cannot reach — the sealed interior plus
 *  its enclosing shell. Volume markers are never trusted: the enclosure IS
 *  the volume. The flood cannot squeeze through the 6-disconnected
 *  staircase walls the sampling lays down, so a closed skin seals. */
export function sealedEnvelopeVolume(
  tris: readonly Triangle[], blocks: readonly Block[]): { m3: number; cells: number } {
  // v1.11.2 WASM (wasm/seal.ts): the compiled flood answers when the module
  // is loaded; the JS twin below stays the reference (pinned equal over the
  // corpus, sealwasm.test.ts) and the fallback when it is not.
  const w = sealedEnvelopeWasm(tris, blocks);
  if (w) return w;
  return sealedEnvelopeJS(tris, blocks);
}

/** The pure-JS reference twin (see the WASM wrapper above). */
export function sealedEnvelopeJS(
  tris: readonly Triangle[], blocks: readonly Block[]): { m3: number; cells: number } {
  const P = 0.25;
  const toC = (v: number) => Math.floor(v / P + 6);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const acc = (cx: number, cy: number, cz: number) => {
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
    if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
  };
  const bc = blocks.map(b => {
    const bx = (b.frame_x ?? 0) * 12 + b.pos_x, by = (b.frame_y ?? 0) * 12 + b.pos_y,
      bz = (b.frame_z ?? 0) * 12 + b.pos_z;
    acc(bx - 1, by - 1, bz - 1);
    acc(bx + b.size_x + 1, by + b.size_y + 1, bz + b.size_z + 1);
    return { bx, by, bz, sx: b.size_x, sy: b.size_y, sz: b.size_z };
  });
  const tv = tris.map(t => {
    const a = hullVertex(t, 0), b = hullVertex(t, 1), c = hullVertex(t, 2);
    acc(toC(a.x), toC(a.y), toC(a.z));
    acc(toC(b.x), toC(b.y), toC(b.z));
    acc(toC(c.x), toC(c.y), toC(c.z));
    return { a, b, c };
  });
  if (!isFinite(x0)) return { m3: 0, cells: 0 };
  x0 -= 1; y0 -= 1; z0 -= 1; x1 += 1; y1 += 1; z1 += 1;      // padded flood rim
  const sx = x1 - x0 + 1, sy = y1 - y0 + 1, sz = z1 - z0 + 1;
  const n = sx * sy * sz;
  if (n > 24e6) return { m3: 0, cells: 0 };                  // honest give-up
  const wall = new Uint8Array(n);
  for (const b of bc)
    for (let cz = b.bz; cz <= b.bz + b.sz; cz++)
      for (let cy = b.by; cy <= b.by + b.sy; cy++)
        for (let cx = b.bx; cx <= b.bx + b.sx; cx++)
          wall[((cz - z0) * sy + (cy - y0)) * sx + (cx - x0)] = 1;
  // ── voxelize the triangles (dominant-plane half-cell sampling)
  const inTri = (px: number, py: number, ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number): boolean => {
    const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
    const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
    return (s1 >= -1e-9 && s2 >= -1e-9 && s3 >= -1e-9) || (s1 <= 1e-9 && s2 <= 1e-9 && s3 <= 1e-9);
  };
  for (const { a, b, c } of tv) {
    const A: [number, number, number] = [a.x, a.y, a.z];
    const B: [number, number, number] = [b.x, b.y, b.z];
    const C: [number, number, number] = [c.x, c.y, c.z];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const an: [number, number, number] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
    const wAxis: 0 | 1 | 2 = an[0] >= an[1] && an[0] >= an[2] ? 0 : an[1] >= an[2] ? 1 : 2;
    const uAxis: 0 | 1 | 2 = wAxis === 0 ? 1 : 0, vAxis: 0 | 1 | 2 = wAxis === 2 ? 1 : 2;
    const at = (q: [number, number, number], i: 0 | 1 | 2) =>
      i === 0 ? q[0] : i === 1 ? q[1] : q[2];
    const mnU = Math.min(at(A, uAxis), at(B, uAxis), at(C, uAxis));
    const mxU = Math.max(at(A, uAxis), at(B, uAxis), at(C, uAxis));
    const mnV = Math.min(at(A, vAxis), at(B, vAxis), at(C, vAxis));
    const mxV = Math.max(at(A, vAxis), at(B, vAxis), at(C, vAxis));
    const dX1 = at(B, uAxis) - at(A, uAxis), dY1 = at(B, vAxis) - at(A, vAxis);
    const dX2 = at(C, uAxis) - at(A, uAxis), dY2 = at(C, vAxis) - at(A, vAxis);
    const den = dX1 * dY2 - dY1 * dX2;
    if (Math.abs(den) < 1e-12) continue;                     // degenerate sliver
    // QUARTER-cell sampling: consecutive sample cells then differ by at
    // most one lattice step in one axis (for any slope ≤ 1 in the dominant
    // projection), so the wall chain is 6-CONNECTED — the exact pairing
    // the 6-connected outside flood cannot slip through
    for (let iu = Math.floor(mnU / P * 4); iu <= Math.ceil(mxU / P * 4); iu++) {
      const pu = (iu * P) / 4;
      for (let iv = Math.floor(mnV / P * 4); iv <= Math.ceil(mxV / P * 4); iv++) {
        const pv = (iv * P) / 4;
        if (!inTri(pu, pv, A[uAxis], A[vAxis], B[uAxis], B[vAxis], C[uAxis], C[vAxis])) continue;
        const px = pu - A[uAxis], py = pv - A[vAxis];
        const s = (px * dY2 - py * dX2) / den, t = (dX1 * py - dY1 * px) / den;
        const pw = at(A, wAxis) + s * (at(B, wAxis) - at(A, wAxis)) + t * (at(C, wAxis) - at(A, wAxis));
        const cc: [number, number, number] = [0, 0, 0];
        cc[uAxis] = toC(pu); cc[vAxis] = toC(pv); cc[wAxis] = toC(pw);
        // mark the cell AND its six face neighbours: sample chains can step
        // DIAGONALLY ((1,0,1)) when u and w cells flip together; the
        // thickening guarantees a 6-connected wall — the pairing the
        // 6-connected outside flood cannot cross
        const gx = cc[0] - x0, gy = cc[1] - y0, gz = cc[2] - z0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1) continue;
              const ax = gx + dx, ay = gy + dy, az = gz + dz;
              if (ax < 0 || ay < 0 || az < 0 || ax >= sx || ay >= sy || az >= sz) continue;
              wall[(az * sy + ay) * sx + ax] = 1;
            }
      }
    }
  }
  // ── flood the outside from the padded rim
  const seen = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  seen[0] = 1; q[qt++] = 0;
  const push = (i: number) => { if (!seen[i] && !wall[i]) { seen[i] = 1; q[qt++] = i; } };
  const sxy = sx * sy;
  while (qh < qt) {
    const i = q[qh++]!;
    const cx = i % sx, cy = ((i / sx) | 0) % sy, cz = (i / sxy) | 0;
    if (cx > 0) push(i - 1);
    if (cx < sx - 1) push(i + 1);
    if (cy > 0) push(i - sx);
    if (cy < sy - 1) push(i + sx);
    if (cz > 0) push(i - sxy);
    if (cz < sz - 1) push(i + sxy);
  }
  // ENVELOPE = the sealed interior + the shell that encloses it. An open
  // structure floods through (interior 0) and yields NOTHING — its walls
  // alone displace no lift.
  let insideFree = 0, wallc = 0;
  for (let i = 0; i < n; i++) {
    if (wall[i]) wallc++;
    else if (!seen[i]) insideFree++;
  }
  const env = insideFree > 0 ? insideFree + wallc : 0;
  return { m3: env * P ** 3, cells: env };
}

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
