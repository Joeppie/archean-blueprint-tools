// flightlab.ts — THE FLIGHT LAB (v1.16.11, workpackages WP-C): the force
// coefficients on the SAME shape field the wind tunnel visualises. The
// named next step (REWRITE §Wind tunnel: "forces (lift curve + stall/AoA)
// are the next step on the SAME field") and the standing backlog ("Better
// flight-characteristics / stability analysis … so we can figure out if a
// craft will fly stable, and what its stall speed is, before we even fly
// it in game").
//
// EVERY law is the wiki's (wiki.archean.space §Aerodynamics, transcribed
// in FORMAT.md §Aerodynamics) — this module turns the shape field into the
// forces the game computes from the shape:
//   • LIFT: the wiki's wing criterion is GEOMETRIC — "a wing is thin
//     top-to-bottom but broad in span and chord, so it lifts; a fuselage
//     is deep in every direction, so it only drags". The planform census
//     therefore scans along the THICKNESS axes (vertical scan = horizontal
//     wings, side scan = fins) and keeps runs ≤ 2 voxels whose connected
//     component is BROAD. A realistic lift curve that STALLS ≈ 15° AoA
//     (flat-plate tail past the knee); lift is TWO-SIDED (a section with
//     one face buried against structure lifts at reduced strength).
//   • DRAG: form = fineness-weighted frontal area (the tunnel's own
//     blockage field: bluff→1, slender→0.1 — "a tenth of the form drag");
//     skin friction (turbulent flat plate, Re-based — the wiki's
//     Reynolds term); induced = Cl²/πeAR (the drag that comes WITH lift).
//   • STABILITY IS EMERGENT (wiki §Stability, no artificial weathervane):
//     the pitch static margin is the CG (the mass model — the game's own
//     materials table) against the neutral point from the lifting-surface
//     distribution; the fin census gives the yaw margin. CG at/ahead of
//     the lift centre = stable, aft = divergent.
//   • CONTROL (wiki §Control surfaces): authority = area × lever × ρv² —
//     which also QUANTIFIES the Chips Falcon catch: ailerons buried
//     mid-span with a short lever deliver millinewton-metres, i.e. the
//     new-physics "they don't do anything anymore".
// Stylised closed-form aerodynamics on the game's own shape census — the
// label keeps (AGENTS: "Aero model is stylized … not CFD").

import { bodyBoxes, buildTunnel, FLOWS, scanAnalysis, rootPos, type Tunnel } from './aero';
import { isaAt } from './atmo';
import { massModel } from './mass';
import type { Blueprint } from './format';
import type { ModelManifest } from './models';

const G = 9.81;
const DEG = Math.PI / 180;

/** wiki: "stalls past roughly 15°" — the lift-curve knee */
export const STALL_DEG = 15;
/** the wiki's buried-wing strength: a one-face section "still lifts, at
 *  reduced strength" — arbitrated at 0.6 (pinned) */
export const BURIED_F = 0.6;
/** Oswald span efficiency of the blocky corpus planforms (taper ≈ 1,
 *  untwisted: e ≈ 0.7) */
export const OSWALD = 0.7;

export interface Planform {
  /** wing reference area (thin sections), m² */
  S: number;
  /** spanwise extent (x-axis extent of the lifting cells), m */
  span: number;
  /** mean aerodynamic chord = S/span, m */
  chord: number;
  AR: number;
  /** lift centre (chordwise centroid of the thin cells), world z metres */
  zAc: number;
  /** tail: thin sections BEHIND the CG, m² + lever arm to the CG, m */
  tailArea: number;
  tailLever: number;
  tailAR: number;
  /** span of the tail group, m */
  tailSpan: number;
  /** fraction of lifting area buried on one face (wiki two-sided lift) */
  buriedFrac: number;
}

export interface AuthorityRow {
  ci: number; type: string;
  /** control-plate area from the part's occupancy box, m² */
  area: number;
  /** distance from the CG along the axis it acts on, m */
  lever: number;
  /** moment at the speed of the analysis, N·m, full ±45° deflection */
  nm: number;
  /** the actuator axis it serves (pitch = z-lever, roll = x-lever) */
  axis: 'pitch' | 'roll' | 'yaw';
  /** the control surface's own centre sits INSIDE the collider mass — the
   *  Chips Falcon catch: the old thin-plate model counted buried plates as
   *  lifting shape; the new field excludes Ailerons and computes their
   *  force from DEFLECTION × AREA × LEVER only — a buried, mid-span plate
   *  reads ≈ 0. */
  buried: boolean;
}

export interface FlightLabReport {
  speed: number; altitude: number; rho: number; q: number;
  mass: number; weight: number;
  planform: Planform;
  cg: [number, number, number];
  /** lift-curve slope, 1/rad (finite-wing, Diederich) */
  clAlpha: number;
  clMax: number;
  /** zero-lift drag (form·fineness + skin friction), on S */
  cd0: number;
  /** induced-drag factor K = 1/(π·e·AR) */
  kInd: number;
  /** lift-to-drag at the trim point, and max on the polar */
  ldTrim: number; ldMax: number;
  /** stall speed at the analysis altitude and at sea level, m/s */
  stallSpeed: number; stallSpeedSL: number;
  /** trim at the analysis speed: AoA (deg), elevator deflection (deg) */
  trimAlphaDeg: number;
  trimElevatorDeg: number | null;
  /** pitch stability (wiki §Stability — emergent, CG vs lift centre) */
  neutralZ: number;
  /** (z_np − z_cg)/c̄ as % MAC: > ~5% stable, 0..5% neutral, < 0 divergent */
  staticMarginPct: number;
  pitchVerdict: 'stable' | 'neutral' | 'unstable';
  /** yaw: fin area behind the CG (side-scan tunnel) */
  finArea: number; finLever: number;
  yawVerdict: 'stable' | 'unstable' | 'unknown';
  authority: { pitch: number; roll: number; yaw: number; rows: AuthorityRow[] };
  /** the lift curve, 0..25° at 1° (with drag + pitch-moment at q=1) */
  curve: { alphaDeg: number; cl: number; cd: number; cm: number }[];
  frontal: number;
  dragCd: number;
}

export interface FlightLabOpts { speed?: number; altitude?: number }

/** finite-wing lift-curve slope, 1/rad (Diederich's FMT approximation;
 *  AR → ∞ clamps to the 2π thin-airfoil limit — plain math, not ∞/∞) */
export const clAlphaOf = (AR: number): number =>
  Number.isFinite(AR) ? (2 * Math.PI * AR) / (AR + 2) : 2 * Math.PI;

/** the wiki's "realistic lift curve … stalls past roughly 15°": linear
 *  pre-stall, flat-plate tail (Cl = 2·sinα·cosα) past the knee with a
 *  body-lift residual. Symmetric planform (blocks have no camber), so the
 *  curve is odd in α. */
export function clOf(alphaRad: number, a: number, alphaL = STALL_DEG * DEG): number {
  const aAbs = Math.abs(alphaRad);
  const sign = Math.sign(alphaRad) || 1;
  if (aAbs <= alphaL) return sign * a * aAbs;
  const clMax = a * alphaL;
  const t = (aAbs - alphaL) / (Math.PI / 2 - alphaL);        // 0 at stall → 1 at 90°
  const knee = clMax * (1 - 0.75 * t);                        // linear shed to 25% residual
  const flat = 2 * Math.sin(aAbs) * Math.cos(aAbs)
    * Math.min(1, clMax / (2 * Math.sin(alphaL) * Math.cos(alphaL)));
  return sign * Math.max(knee, flat);
}

/** thin-plate census for a scan axis. THE WING CRITERION (wiki §Lift,
 *  verbatim): "A wing is thin top-to-bottom but broad in span and chord,
 *  so it lifts. A fuselage is deep in every direction, so it only drags."
 *  A HORIZONTAL wing is thin along Y ⇒ it appears in the VERTICAL scan
 *  (its scan-axis runs are short), broad in the perpendicular plane (x,z).
 *  A fin is thin along X ⇒ the SIDE scan. Runs ≤ 2 voxels are thin; a
 *  cell is KEPT only when its connected component (6-neighbourhood) spans
 *  ≥ 3 voxels on BOTH planform axes — the wiki's "broad planform", which
 *  rejects a fuselage's 2×2 corner. Burial (the two-sided law): solid
 *  immediately along the scan axis on one side = one face buried
 *  (BURIED_F strength); both sides buried = no lift. */
interface LiftCells {
  x: number[]; y: number[]; z: number[]; dA: number[]; buried: number[];
}
function thinPlateCells(t: Tunnel): LiftCells {
  const { nx, ny, nz, solid, axis } = t;
  const step = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  const lineLen = [nx, ny, nz][axis]!;
  const perp = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const nA = [nx, ny, nz][perp[0]!]!, nB = [nx, ny, nz][perp[1]!]!;
  const faceArea = t.voxel * t.voxel;
  const cells: { i: number; j: number; k: number; buried: number }[] = [];
  const solidAt = (i: number, j: number, k: number) =>
    i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz
      ? solid[(k * ny + j) * nx + i]! : 1;
  for (let b = 0; b < nB; b++)
    for (let a = 0; a < nA; a++) {
      const c = [0, 0, 0];
      c[perp[0]!] = a; c[perp[1]!] = b;
      const base = (c[2]! * ny + c[1]!) * nx + c[0]!;
      const runs: [number, number][] = [];
      let q = 0;
      while (q < lineLen) {
        if (!solid[base + q * step]) { q++; continue; }
        const s0 = q;
        while (q < lineLen && solid[base + q * step]) q++;
        // the wiki's cavity rule: single-cell air seams MERGE (sealed
        // cavity = solid body — "a hollow shape flies exactly like its
        // solid version")
        if (q + 1 < lineLen && !solid[base + q * step] && solid[base + (q + 1) * step]) { q += 1; continue; }
        runs.push([s0, q - s0]);
      }
      for (const [s0, L] of runs) {
        if (L > 2) continue;                                  // deep: drag only
        for (let w = 0; w < L; w++) {
          const k = s0 + w;
          const [i, j, kk] = (axis === 0 ? [k, c[1]!, c[2]!]
            : axis === 1 ? [c[0]!, k, c[2]!] : [c[0]!, c[1]!, k]) as
            [number, number, number];
          const lo = axis === 0 ? solidAt(i - 1, j, kk)
            : axis === 1 ? solidAt(i, j - 1, kk) : solidAt(i, j, kk - 1);
          const hi = axis === 0 ? solidAt(i + 1, j, kk)
            : axis === 1 ? solidAt(i, j + 1, kk) : solidAt(i, j, kk + 1);
          const faces = (lo ? 0 : 1) + (hi ? 0 : 1);          // EXPOSED faces
          cells.push({ i, j, k: kk, buried: faces >= 2 ? 0 : faces === 1 ? 1 : 2 });
        }
      }
    }
  // the "broad planform" filter: connected components must span ≥ 3
  // voxels on both planform axes (voxel units)
  const key = (i: number, j: number, k: number) => i + j * nx + k * nx * ny;
  const at = new Map<number, number>();
  cells.forEach((c, idx) => at.set(key(c.i, c.j, c.k), idx));
  const comp = new Int32Array(cells.length).fill(-1);
  let nComp = 0;
  const stack: number[] = [];
  for (let s = 0; s < cells.length; s++) {
    if (comp[s]! >= 0) continue;
    comp[s] = nComp; stack.push(s);
    while (stack.length) {
      const u = stack.pop()!;
      const c = cells[u]!;
      for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const v = at.get(key(c.i + d[0]!, c.j + d[1]!, c.k + d[2]!));
        if (v !== undefined && comp[v]! < 0) { comp[v] = nComp; stack.push(v); }
      }
    }
    nComp++;
  }
  // planform axes per scan axis: y-scan (wings) → x,z; x-scan (fins) → y,z
  const ext: { a0: number; a1: number; b0: number; b1: number }[] = [];
  const W = 1;                                               // voxel units
  cells.forEach((c, idx) => {
    const ci = comp[idx]!;
    while (ext.length <= ci) ext.push({ a0: 1e9, a1: -1e9, b0: 1e9, b1: -1e9 });
    const e = ext[ci]!;
    const a = axis === 0 ? c.j : c.i;                        // planform axis 1
    const b = c.k;                                           // along the craft
    e.a0 = Math.min(e.a0, a * W); e.a1 = Math.max(e.a1, (a + 1) * W);
    e.b0 = Math.min(e.b0, b * W); e.b1 = Math.max(e.b1, (b + 1) * W);
  });
  const keep = ext.map(e => e.a1 - e.a0 >= 3 && e.b1 - e.b0 >= 3);
  const out: LiftCells = { x: [], y: [], z: [], dA: [], buried: [] };
  cells.forEach((c, idx) => {
    if (!keep[comp[idx]!]) return;
    const pos = rootPos(t, c.i, c.j, c.k);
    out.x.push(pos[0]); out.y.push(pos[1]); out.z.push(pos[2]);
    out.dA.push(faceArea);
    out.buried.push(c.buried);
  });
  return out;
}

/** z-clusters of lifting cells (wing vs tail groups by chordwise gaps) */
function zClusters(zs: number[], gap: number): { i: number[]; z0: number; z1: number }[] {
  const idx = zs.map((_, i) => i).sort((a, b) => zs[a]! - zs[b]!);
  const out: { i: number[]; z0: number; z1: number }[] = [];
  for (const i of idx) {
    const last = out[out.length - 1];
    if (last && zs[i]! - last.z1 <= gap) { last.i.push(i); last.z1 = Math.max(last.z1, zs[i]!); }
    else out.push({ i: [i], z0: zs[i]!, z1: zs[i]! });
  }
  return out;
}

const extent = (a: number[]) => a.length ? Math.max(...a) - Math.min(...a) : 0;
const mean = (a: number[], w?: number[]) => {
  if (!a.length) return 0;
  if (!w) return a.reduce((s, v) => s + v, 0) / a.length;
  let m = 0, sw = 0;
  a.forEach((v, i) => { m += v * w[i]!; sw += w[i]!; });
  return sw > 0 ? m / sw : 0;
};

function planformOf(t: Tunnel, zCg: number): Planform {
  const cells = thinPlateCells(t);
  const clusters = zClusters(cells.z, t.voxel * 3);
  let tailArea = 0, tailLever = 0, tailSpan = 0, tailAR = 0;
  const wingCells: number[] = [], tailCells: number[] = [];
  const bySize = [...clusters].sort((a, b) =>
    b.i.reduce((s, i) => s + cells.dA[i]!, 0) - a.i.reduce((s, i) => s + cells.dA[i]!, 0));
  const main = bySize[0] ?? { i: [] };
  const zMain = mean(main.i.map(i => cells.z[i]!));
  for (const cl of bySize.slice(1)) {
    const zc = mean(cl.i.map(i => cells.z[i]!));
    const area = cl.i.reduce((s, i) => s + cells.dA[i]!, 0);
    if (zc > zMain + t.voxel * 4 && zc > zCg && area >= 0.05) tailCells.push(...cl.i);
    else wingCells.push(...cl.i);
  }
  wingCells.push(...main.i);
  const sum = (idx: number[]) => idx.reduce((s, i) =>
    s + cells.dA[i]! * (cells.buried[i]! >= 2 ? 0 : cells.buried[i]! === 1 ? BURIED_F : 1), 0);
  const rawSum = (idx: number[]) => idx.reduce((s, i) => s + cells.dA[i]!, 0);
  const S = sum(wingCells);
  const buriedArea = wingCells.filter(i => cells.buried[i] === 1).reduce((s, i) => s + cells.dA[i]!, 0);
  const buriedFrac = rawSum(wingCells) > 0 ? buriedArea / rawSum(wingCells) : 0;
  const span = extent(wingCells.map(i => cells.x[i]!));
  const zAc = mean(wingCells.map(i => cells.z[i]!), wingCells.map(i => cells.dA[i]!));
  tailArea = sum(tailCells);
  tailSpan = extent(tailCells.map(i => cells.x[i]!));
  const zT = mean(tailCells.map(i => cells.z[i]!), tailCells.map(i => cells.dA[i]!));
  tailLever = tailCells.length ? Math.max(0, zT - zCg) : 0;
  const chord = span > 0 ? S / span : 0;
  const AR = span > 0 && S > 0 ? (span * span) / S : 0;
  tailAR = tailSpan > 0 && tailArea > 0 ? (tailSpan * tailSpan) / tailArea : 0;
  return { S, span, chord, AR, zAc, tailArea, tailLever, tailAR, buriedFrac, tailSpan };
}

/** side-scan fin census: thin PLATES vertical in X (the side scan sees
 *  short runs), BEHIND the CG — the wiki's yaw-stabilising vertical fin */
function finCensus(t: Tunnel | null, zCg: number): { area: number; lever: number } {
  if (!t) return { area: 0, lever: 0 };
  const cells = thinPlateCells(t);
  let area = 0, zw = 0;
  for (let i = 0; i < cells.z.length; i++) {
    if (cells.z[i]! <= zCg) continue;                    // forward fins: not yaw-stabilising
    const w = cells.buried[i]! >= 2 ? 0 : cells.buried[i]! === 1 ? BURIED_F : 1;
    area += cells.dA[i]! * w;
    zw += cells.z[i]! * cells.dA[i]! * w;
  }
  const zFin = area > 0 ? zw / Math.max(area, 1e-9) : 0;
  return { area, lever: area > 0 ? Math.max(0, zFin - zCg) : 0 };
}

/** collider solidity probe (buried Aileron detection): a point inside any
 *  body box (absolute FILE cells). Ailerons ARE excluded from the shape
 *  field by the game — this is OUR census of "hidden inside the structure". */
export function buriedAt(boxes: { c: [number, number, number]; e: [number, number, number] }[],
  world: [number, number, number]): boolean {
  const cell = (v: number) => v / 0.25 + 5.5;
  const p: [number, number, number] = [cell(world[0]), cell(world[1]), cell(world[2])];
  return boxes.some(b =>
    p[0] >= b.c[0] && p[0] < b.c[0] + b.e[0] &&
    p[1] >= b.c[1] && p[1] < b.c[1] + b.e[1] &&
    p[2] >= b.c[2] && p[2] < b.c[2] + b.e[2]);
}

/** THE FLIGHT LAB: run the shape-field census and evaluate the forces. */
export function flightLab(bp: Blueprint, manifest: ModelManifest | null,
  opts: FlightLabOpts = {}): FlightLabReport | null {
  const speed = Math.max(1, opts.speed ?? 80);
  const altitude = Math.max(0, opts.altitude ?? 0);
  // the WING census scans along the thickness axis (wiki: a wing is thin
  // top-to-bottom); the FIN census scans along x; the nose tunnel is the
  // fineness-weighted form drag (scanAnalysis' frontal census)
  const vert = buildTunnel(bp, FLOWS.down, { budget: 180_000 });
  if (!vert) return null;
  const side = buildTunnel(bp, FLOWS.left, { budget: 120_000 });
  const nose = buildTunnel(bp, FLOWS.nose, { budget: 180_000 });
  const mass = massModel(bp, manifest);
  const [cx, , cz] = mass.com;
  const pf = planformOf(vert, cz);
  const scan = nose ? scanAnalysis(nose) : scanAnalysis(vert);
  if (!(pf.S > 0.01)) {
    // no thin BROAD sections: a flying brick — report the census honestly
    return brickReport(scan, mass, speed, altitude, cz);
  }
  const rho = isaAt(altitude).rhoKg;
  const q = 0.5 * rho * speed * speed;
  const a = clAlphaOf(pf.AR);
  const aT = pf.tailArea > 0.01 ? clAlphaOf(pf.tailAR) : 0;
  // wiki: tail surfaces behind the CoM restore — the classic downwash term
  const deda = pf.AR > 0 ? 2.19 / Math.sqrt(pf.AR + 1) : 0;
  const clMax = a * STALL_DEG * DEG;
  // form drag: fineness-weighted frontal area on S; skin friction:
  // turbulent flat-plate Cf on the wetted planform (both faces)
  const Re = Math.max(1e4, rho * speed * (pf.chord || 1) / 1.5e-5);
  const cf = 0.074 / Math.pow(Re, 0.2);
  const cd0 = pf.S > 0 ? (scan.dragW + 2 * pf.S * cf) / pf.S : 1;
  const kInd = pf.AR > 0 ? 1 / (Math.PI * OSWALD * pf.AR) : 1;
  const weight = mass.total * G;
  const stallSpeed = pf.S > 0 ? Math.sqrt(2 * weight / (rho * pf.S * clMax)) : Infinity;
  const rhoSL = isaAt(0).rhoKg;
  const stallSpeedSL = pf.S > 0 ? Math.sqrt(2 * weight / (rhoSL * pf.S * clMax)) : Infinity;
  // pitch static margin: CG vs the NEUTRAL POINT (wing AC + tail, the
  // wiki's "CoM at/ahead of the lift centre = stable")
  const liftW = a * pf.S;
  const liftT = aT * pf.tailArea * (1 - deda);
  const zNp = liftW + liftT > 0
    ? (liftW * pf.zAc + liftT * (cz + pf.tailLever)) / (liftW + liftT)
    : pf.zAc;
  const staticMarginPct = pf.chord > 0 ? ((zNp - cz) / pf.chord) * 100 : 0;
  const pitchVerdict = staticMarginPct > 5 ? 'stable' : staticMarginPct > 0 ? 'neutral' : 'unstable';
  const fin = finCensus(side, cz);
  const yawVerdict = fin.area < 0.02 ? 'unknown' : fin.lever > 0.3 ? 'stable' : 'unstable';
  // trim at the analysis speed (symmetric sections: Cm0 = 0 at α = 0)
  const clTrim = weight / (q * pf.S);
  const trimAlphaRad = clTrim / (a + liftT / pf.S);
  const trimAlphaDeg = trimAlphaRad / DEG;
  // Cm(α) = Lw·(z_cg − z_ac) + Lt·(z_cg − z_act) (arms in metres, moments
  // on q·S·c̄); the elevator answers it (authority = q·St·aT·lever/rad)
  const cmOf = (al: number): number => {
    const Lw = q * pf.S * clOf(al, a);
    const Lt = q * pf.tailArea * (aT * (al * (1 - deda)));
    return (Lw * (cz - pf.zAc) + Lt * (cz - (cz + pf.tailLever))) / Math.max(q * pf.S * pf.chord, 1e-9);
  };
  const cmTrim = cmOf(trimAlphaRad);
  const elAuth = q * pf.tailArea * aT * pf.tailLever;
  const trimElevatorDeg = elAuth > 1e-6
    ? -(cmTrim * q * pf.S * pf.chord) / elAuth / DEG
    : null;
  // control authority: Aileron parts (the game's own actuator) —
  // F = q·A·2·sin45·cos45 (flat-plate law at full 45° deflection), M = F·lever
  const boxes = bodyBoxes(bp);
  const rows: AuthorityRow[] = [];
  bp.data.components.forEach((c, ci) => {
    if (!/^(Small|Big)?Aileron$/.test(c.type)) return;
    const occ = (c.occupancies ?? []).filter(o => o && typeof o.size_x === 'number');
    let area = 0;
    for (const o of occ) {
      const s = [(o.size_x! + 1) * 0.25, (o.size_y! + 1) * 0.25, (o.size_z! + 1) * 0.25];
      s.sort((x, y) => x - y);
      area = Math.max(area, s[1]! * s[2]!);
    }
    if (area <= 0) area = 0.25 * 0.25;                  // bare part: one cell
    const p: [number, number, number] = [c.position.x, c.position.y, c.position.z];
    const lz = Math.abs(p[2] - cz), lx = Math.abs(p[0] - cx);
    const axis: AuthorityRow['axis'] = lz >= lx ? 'pitch' : 'roll';
    const lever = Math.max(lz, lx);
    const nm = q * area * (2 * Math.sin(45 * DEG) * Math.cos(45 * DEG)) * lever;
    rows.push({ ci, type: c.type, area, lever, nm, axis, buried: buriedAt(boxes, p) });
  });
  const sumAuth = (axis: AuthorityRow['axis']) =>
    rows.filter(r => r.axis === axis && !r.buried).reduce((s, r) => s + r.nm, 0);
  // lift polar + pitch-moment curve, 0..25°
  const curve: FlightLabReport['curve'] = [];
  let ldMax = 0, ldTrim = 0;
  for (let ad = 0; ad <= 25; ad++) {
    const al = ad * DEG;
    const cl = clOf(al, a) * (1 - pf.buriedFrac * (1 - BURIED_F) * 0.5);
    const cd = cd0 + kInd * cl * cl;
    const cm = cmOf(al);
    curve.push({ alphaDeg: ad, cl: +cl.toFixed(4), cd: +cd.toFixed(5), cm: +cm.toFixed(5) });
    if (cd > 0) ldMax = Math.max(ldMax, cl / cd);
    if (Math.abs(ad - trimAlphaDeg) < 1) ldTrim = cl / cd;
  }
  return {
    speed, altitude, rho, q,
    mass: mass.total, weight,
    planform: pf, cg: [cx, mass.com[1]!, cz],
    clAlpha: a, clMax, cd0, kInd, ldTrim, ldMax,
    stallSpeed, stallSpeedSL,
    trimAlphaDeg, trimElevatorDeg,
    neutralZ: zNp, staticMarginPct, pitchVerdict,
    finArea: fin.area, finLever: fin.lever, yawVerdict,
    authority: {
      pitch: sumAuth('pitch'), roll: sumAuth('roll'), yaw: sumAuth('yaw'), rows,
    },
    curve, frontal: scan.frontalArea, dragCd: scan.dragCd,
  };
}

/** a craft with NO thin BROAD sections: everything the field sees is
 *  drag — the "flying brick" census (RCS-solo hulls, boxy lifters)
 *  reports honestly. */
function brickReport(scan: ReturnType<typeof scanAnalysis>, mass: ReturnType<typeof massModel>,
  speed: number, altitude: number, cz: number): FlightLabReport {
  const rho = isaAt(altitude).rhoKg;
  const q = 0.5 * rho * speed * speed;
  return {
    speed, altitude, rho, q,
    mass: mass.total, weight: mass.total * G,
    planform: { S: 0, span: 0, chord: 0, AR: 0, zAc: cz, tailArea: 0, tailLever: 0, tailSpan: 0, tailAR: 0, buriedFrac: 0 },
    cg: mass.com,
    clAlpha: 0, clMax: 0, cd0: scan.dragCd > 0 ? scan.dragCd : 1, kInd: 1,
    ldTrim: 0, ldMax: 0, stallSpeed: Infinity, stallSpeedSL: Infinity,
    trimAlphaDeg: NaN, trimElevatorDeg: null,
    neutralZ: cz, staticMarginPct: 0, pitchVerdict: 'unstable',
    finArea: 0, finLever: 0, yawVerdict: 'unknown',
    authority: { pitch: 0, roll: 0, yaw: 0, rows: [] },
    curve: [], frontal: scan.frontalArea, dragCd: scan.dragCd,
  };
}
