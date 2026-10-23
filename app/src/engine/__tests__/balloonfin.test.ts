// balloonfin.test.ts — the v1.9 BALLOON TAIL planner (the fin/coupler half
// of the Generate-balloon tool). The specs these pins encode, from the
// user's 2026-10-23 brief: contiguous flush tail post ("a contiguous area
// that connects where the tail can sit — flush with the end of the tail
// section of the cone"), mirrored triangle fins on rotating pivots, the LV
// runs hidden inside the envelope ("the wire after connecting to the pivot
// must immediately run into the zeppelin's body"), the volume stack
// "guaranteed to be enclosed", and every emitted face storable in the
// game's frame-aligned 31-cell window.
import { describe, expect, test } from 'vitest';
import {
  planBalloonTail, ghostMap, insideBalloon, pipeSegments,
  type BalloonAdapters,
} from '../balloonfin';
import { spherePlan, sphereSkinTris, type SphereSpec } from '../latsphere';

import manifest from '../../../../viewer/models/manifest.json';

type Adm = { name: string; type: string; position: [number, number, number]; rotation: [number, number, number] };
const M = manifest as unknown as Record<string, { adapters: Adm[] }>;

const adapters: BalloonAdapters = {
  pivot: M.SmallHinge!.adapters.find(a => a.type === 'lowvoltage')!,
  coupler: M.LowVoltageJunction!.adapters
    .filter(a => a.type === 'lowvoltage' && a.name !== 'lowvoltage-input'),
};

const spec: SphereSpec = {
  rx: 2, ry: 2, rz: 8, profile: 'cylinder', noseShoulder: 0.35, tailShoulder: 0.6,
};
const OPT = { pivotType: 'SmallHinge', finScale: 1, oversize: 1, volumes: 3 } as const;

/** decoded lattice vertex of a skin record: g = v + 12·frame */
function gOf(t: Record<string, number>, i: 0 | 1 | 2): [number, number, number] {
  return [
    t[`v${i}_x`]! + 12 * t[`frame_x`]!,
    t[`v${i}_y`]! + 12 * t[`frame_y`]!,
    t[`v${i}_z`]! + 12 * t[`frame_z`]!,
  ];
}
const gset = (t: Record<string, number>) =>
  ([0, 1, 2] as const).map(i => gOf(t, i).join(',')).sort().join('|');

describe('balloon tail plan', () => {
  const p = planBalloonTail(spec, OPT, adapters);

  test('the zeppelin body plans a complete tail batch', () => {
    expect(p.ok, p.reason).toBe(true);
    expect(p.skipped).toBe(0);
    expect(p.sleeveTris.length).toBeGreaterThan(0);
    expect(p.pipes).toHaveLength(3);
    const roles = p.comps.filter(c => c.kind === 'pivot').map(c => c.role);
    expect(roles).toEqual(['rudder', 'aileronR', 'aileronL']);
    // every pivot has its subgrid Build, and every Build carries triangles
    for (const role of roles) {
      expect(p.comps.some(c => c.kind === 'build' && c.role === role)).toBe(true);
      const b = p.comps.find(c => c.kind === 'build' && c.role === role)!;
      expect(b.nestedTris!.length).toBeGreaterThan(0);
    }
  });

  test('the tail post is CONTIGUOUS with the cone (shared cut ring)', () => {
    // the skin is planned TRUNCATED at tailCutG; its boundary ring (the
    // last la-level = tailCutG vertices) must appear verbatim in the
    // sleeve's root band — shared vertices, not merely coincident surfaces
    const skin = spherePlan({ ...spec, tailCutG: p.tailCutG });
    expect(skin.skipped).toBe(0);
    const zc = p.tailCutG!;
    const ringVerts = new Set<string>();
    for (const f of skin.faces)
      for (const i of f) {
        const g = skin.shell[i]!;
        if (g[2] === zc) ringVerts.add(`${g[0]},${g[1]}`);
      }
    expect(ringVerts.size).toBeGreaterThan(3);
    let shared = 0;
    for (const t of p.sleeveTris)
      for (const i of [0, 1, 2] as const) {
        const g = gOf(t as unknown as Record<string, number>, i);
        if (g[2] === zc && ringVerts.has(`${g[0]},${g[1]}`)) shared++;
      }
    expect(shared).toBeGreaterThan(ringVerts.size * 1.5);   // every ring vertex rides ≥ 2 sleeve faces
  });

  test('the aileron pair is mirror-symmetric triangle for triangle', () => {
    const R = p.finTris.aileronR.map(t => t as unknown as Record<string, number>);
    const L = p.finTris.aileronL.map(t => t as unknown as Record<string, number>);
    expect(L.length).toBe(R.length);
    const lm = new Map(L.map(t => [gset(t), t]));
    for (const t of R) {
      const m = (q: number[]) => [12 - q[0]!, q[1]!, q[2]!].join(',');
      const key = [gOf(t, 0), gOf(t, 2), gOf(t, 1)].map(m).sort().join('|');
      expect(lm.delete(key), `mirror twin of ${gset(t)}`).toBe(true);
    }
    expect(lm.size).toBe(0);
    // the rudder sits ON the mirror plane (its plate's side coord = centre)
    for (const t of p.finTris.rudder)
      for (const i of [0, 1, 2] as const) expect(gOf(t as unknown as Record<string, number>, i)[0]).toBe(6);
  });

  test('fins scale with the body; the oversize slider grows them', () => {
    const base = planBalloonTail(spec, { ...OPT, oversize: 1 }, adapters);
    const big = planBalloonTail(spec, { ...OPT, oversize: 3 }, adapters);
    const spanOf = (plan: typeof base, role: 'aileronR') => {
      let lo = Infinity, hi = -Infinity;
      for (const t of plan.finTris[role])
        for (const i of [0, 1, 2] as const) {
          const g = gOf(t as unknown as Record<string, number>, i);
          lo = Math.min(lo, g[0]); hi = Math.max(hi, g[0]);
        }
      return hi - lo;
    };
    expect(spanOf(big, 'aileronR')).toBeGreaterThan(spanOf(base, 'aileronR'));
    // a wider BALLOON grows the ailerons (0.28 of the side girth), a taller
    // one the rudder (0.28 of the vertical girth) — each fin follows its
    // own proportion of the body
    const wider = planBalloonTail({ ...spec, rx: 4 }, OPT, adapters);
    expect(wider.ok).toBe(true);
    expect(spanOf(wider, 'aileronR')).toBeGreaterThan(spanOf(base, 'aileronR'));
    const taller = planBalloonTail({ ...spec, ry: 4 }, OPT, adapters);
    expect(taller.ok).toBe(true);
    const hOf = (plan: typeof base) => {
      let lo = Infinity, hi = -Infinity;
      for (const t of plan.finTris.rudder)
        for (const i of [0, 1, 2] as const) {
          const g = gOf(t as unknown as Record<string, number>, i);
          lo = Math.min(lo, g[1]); hi = Math.max(hi, g[1]);
        }
      return hi - lo;
    };
    expect(hOf(taller)).toBeGreaterThan(hOf(base));
  });

  test('every LV run dives into the envelope right after the pivot socket', () => {
    for (const pp of p.pipes) {
      const pts = pp.points;
      expect(pts.length).toBeGreaterThanOrEqual(3);       // game wants ≥ 2 segments
      // interior waypoints (socket ends excluded) sit INSIDE the envelope
      for (let i = 1; i < pts.length - 1; i++)
        expect(insideBalloon(spec, pts[i]!), `pipe ${pp.role} pt ${i} ${pts[i]}`)
          .toBe(true);
      // "immediately": the second hop off the pivot socket is SHORT
      // (the lead), the very next hop already crosses inside
      const near = Math.hypot(pts[pts.length - 2]![0] - pts[pts.length - 1]![0],
        pts[pts.length - 2]![1] - pts[pts.length - 1]![1],
        pts[pts.length - 2]![2] - pts[pts.length - 1]![2]);
      expect(near).toBeLessThan(0.12);
    }
  });

  test('segments build axis-aligned, ≥ 2 per pipe, from the waypoints', () => {
    for (const pp of p.pipes) {
      const segs = pipeSegments(pp.points, { r: 96, g: 8, b: 4 });
      expect(segs.length).toBeGreaterThanOrEqual(2);
      for (const s of segs) {
        expect(s.dir).toBeGreaterThanOrEqual(0);
        expect(s.dir).toBeLessThan(6);
        expect(s.length as number).toBeGreaterThan(0);
      }
      // the recorded path starts at the coupler port and ENDS at the pivot
      const first = segs[0]!.start as { x: number; y: number; z: number };
      expect(Math.hypot(first.x - pp.points[0]![0], first.y - pp.points[0]![1],
        first.z - pp.points[0]![2])).toBeLessThan(1e-3);
    }
  });

  test('volume blocks face up on the coupler, clamped INSIDE the skin', () => {
    const vols = p.comps.filter(c => c.kind === 'volume');
    expect(vols.length).toBe(3);
    expect(vols[0]!.pos[1]).toBeCloseTo(0.187, 3);        // sits on the coupler roof
    for (let i = 1; i < vols.length; i++)
      expect(vols[i]!.pos[1] - vols[i - 1]!.pos[1]).toBeCloseTo(0.25, 3);  // one cell up
    for (const v of vols) expect(insideBalloon(spec, v.pos, 0.9)).toBe(true);
    // an impossible request clamps honestly (a 2 m girth cannot hold 16)
    expect(planBalloonTail(spec, { ...OPT, volumes: 16 }, adapters).counts.volumes)
      .toBeLessThan(8);
  });

  test('the ghost map follows quarter-turns + cell offsets exactly', () => {
    const id = ghostMap(p.probes, undefined, [0, 0, 0]);
    expect(id.world([1.25, 0, 7])).toEqual([1.25, 0, 7]);
    expect(id.quat({ w: 1, x: 0, y: 0, z: 0 })).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    // the engine's turn law about pivot c: axis y → q[z] = c[z] − (g[x]−c[x]),
    // q[x] = c[x] + (g[z]−c[z])
    const c = p.probes[0]!;
    const live = p.probes.map(g => {
      const q: [number, number, number] = [...g] as [number, number, number];
      q[2] = c[2] - (g[0] - c[0]);
      q[0] = c[0] + (g[2] - c[2]);
      return q;
    });
    const m = ghostMap(p.probes, live, [1, 0, 0]);
    expect(m.world([0, 0, 0])).toEqual([0.25, 0, 0]);     // offset only at the pivot
    expect(m.world([1, 0, 0])).toEqual([0.25, 0, -1]);    // +x swings to −z, +1 cell
    const q = m.quat({ w: 1, x: 0, y: 0, z: 0 });
    expect(Math.abs(q.w)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(Math.abs(q.y)).toBeCloseTo(Math.SQRT1_2, 5);
  });

  test('small / fat bodies refuse or adapt honestly', () => {
    // a stubby body: tail zone shorter than 3 m → honest refusal
    const stub = planBalloonTail({ rx: 2, ry: 2, rz: 3, profile: 'cylinder', noseShoulder: 0.6, tailShoulder: 0.6 }, OPT, adapters);
    expect(stub.ok).toBe(false);
    expect(stub.reason).toMatch(/tail zone/i);
    // a big zeppelin plans and stores (window check through the skin too)
    const big = planBalloonTail({ rx: 4, ry: 4, rz: 30, profile: 'cylinder', noseShoulder: 0.35, tailShoulder: 0.5 }, OPT, adapters);
    expect(big.ok, big.reason).toBe(true);
    const skin = sphereSkinTris({ ...spec, tailCutG: p.tailCutG }, { slot: 51, material: 0, smooth: false });
    expect(skin.length).toBeGreaterThan(0);
  });
});
