// hullfit.ts — world mapping for hull triangles of an Archean blueprint.
// TS port of viewer/hullfit.js. The lattice is EXACT and generic (AGENTS
// invariant 3: zero per-craft constants): vertices live on the SAME lattice
// as blocks and
//     world_ax = frame_ax · 3.0 − 1.5 + v_ax · 0.25
// i.e. pitch = CELL (0.25 m), C = −FRAME/2 (−1.5 m), W = 12 in the
// (v + W·frame)·pitch + C form. Shared slots = welded points; cross-frame
// weld pairs sit Δv = 12. (The old per-file pitch fit was an approximation —
// do not reintroduce it.)

import { CELL, CELLS_PER_FRAME, FRAME, type Blueprint, type Triangle } from './format';

export interface HullFit {
  d: number;                       // info: mean anchor distance to the aileron layer
  W: number; px: number; py: number; pz: number;
  Cx: number; Cy: number; Cz: number;
}

/** world_ax = (v_ax + W·f_ax)·p_ax + C_ax */
export const HULL_W = CELLS_PER_FRAME;             // 12
export const HULL_PITCH = CELL;                    // 0.25
export const HULL_C = -FRAME / 2;                  // -1.5

export function hullVertex(t: Triangle, i: 0 | 1 | 2): { x: number; y: number; z: number } {
  const v = (ax: 'x' | 'y' | 'z') => (t[`v${i}_${ax}`] ?? 0) as number;
  // frames are ALWAYS stored in real files; the ?? 0 only guards synthetic
  // records (without it a missing frame_* key poisons every coord with NaN)
  const f = (ax: 'x' | 'y' | 'z') => (t[`frame_${ax}`] ?? 0) as number;
  return {
    x: (v('x') + HULL_W * f('x')) * HULL_PITCH + HULL_C,
    y: (v('y') + HULL_W * f('y')) * HULL_PITCH + HULL_C,
    z: (v('z') + HULL_W * f('z')) * HULL_PITCH + HULL_C,
  };
}

export function fitHull(bp: Blueprint): HullFit | null {
  const T = bp.data.triangles;
  if (!T || !T.length) return null;
  const anchors = bp.data.components.filter(c => c.type === 'Aileron').map(c => c.position);
  let d = 0;
  for (const t of T) for (const i of [0, 1, 2] as const) {
    const p = hullVertex(t, i);
    for (const a of anchors) d += Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
  }
  return { d, W: HULL_W, px: HULL_PITCH, py: HULL_PITCH, pz: HULL_PITCH, Cx: HULL_C, Cy: HULL_C, Cz: HULL_C };
}
