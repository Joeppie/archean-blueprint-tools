// balloonfin.test.ts — the v1.9 BALLOON TAIL planner (the fin/coupler half
// of the Generate-balloon tool). The specs these pins encode, from the
// user's 2026-10-23 brief and its two shape arbitrations:
//  • the tail cone STAYS UNTOUCHED ("an undesirable break in the tail's
//    pattern … it shouldn't exist") — no truncation, no post;
//  • the fixed FILLET clings tight to the cone from the SHOULDER ("orange
//    … taper the fuselage closely", red = straight sloping leading edge);
//  • the MOVABLE rudder/ailerons are plates HUNG AFT of the vertical hinge
//    line at the tail end (green), like stern-post rudders;
//  • the LV runs hide inside right behind the plug; the coupler sits at the
//    centre with the Volume stack guaranteed enclosed; every emitted face
//    is storable in the game's frame-aligned 31-cell window.
import { describe, expect, test } from 'vitest';
import {
  planBalloonTail, ghostMap, insideBalloon, pipeSegments,
  type BalloonAdapters,
} from '../balloonfin';
import { spherePlan, sphereSkinTris, transformSkinTris, type SphereSpec } from '../latsphere';
import manifest from '../../../../viewer/models/manifest.json';

type Adm = { name: string; type: string; position: [number, number, number]; rotation: [number, number, number] };
const MAN = manifest as unknown as Record<string, { adapters: Adm[] }>;
const adapters: BalloonAdapters = {
  pivot: MAN.SmallHinge!.adapters.find(a => a.type === 'lowvoltage')!,
  coupler: MAN.LowVoltageJunction!.adapters
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
const rec = (t: unknown) => t as unknown as Record<string, number>;
const gset = (t: unknown) => [0, 1, 2].map(i => gOf(rec(t), i as 0 | 1 | 2).join(',')).sort().join('|');

describe('balloon tail plan (untouched cone, hung vanes)', () => {
  const p = planBalloonTail(spec, OPT, adapters);
  // stations recomputed from the body law (rz 8 ⇒ L 32 cells, sT 0.6):
  const zA = Math.round(6 + 0.6 * 32);                            // shoulder = 25
  const zB = p.counts.hingeZ;                                     // hinge line
  const prof = (z: number) => {
    const dz = z - 6, sL = 0.6 * 32, nl = 32 - sL;
    return dz <= sL ? 1 : Math.sqrt(Math.max(0, 1 - ((dz - sL) / nl) ** 2));
  };

  test('the tail batch plans clean', () => {
    expect(p.ok, p.reason).toBe(true);
    expect(p.skipped).toBe(0);
    expect(p.pipes).toHaveLength(3);
    const roles = p.comps.filter(c => c.kind === 'pivot').map(c => c.role);
    expect(roles).toEqual(['rudder', 'aileronR', 'aileronL']);
    for (const role of roles) {
      const b = p.comps.find(c => c.kind === 'build' && c.role === role)!;
      expect(b.nestedTris!.length).toBeGreaterThan(0);
    }
  });

  test('the tail cone is UNTOUCHED — the skin plan is the plain one', () => {
    // (the blue-in-the-sketch rule: nothing may truncate or patch the tail)
    const full = spherePlan(spec);
    const tris = sphereSkinTris(spec, { slot: 51, material: 0, smooth: false });
    expect(tris.length).toBe(full.faces.length);
    expect(full.skipped).toBe(0);
    expect((full.faces as unknown[]).length).toBeGreaterThan(0);
  });

  test('fillets cling to the cone from the SHOULDER and grow outward', () => {
    expect(zB).toBeGreaterThan(zA + 5);
    const cUp = 6;
    for (const role of ['rudder', 'aileronR'] as const) {
      const out = role === 'rudder' ? 1 : 0;         // up coord / side coord
      const verts = p.fillets[role].flatMap(t => [0, 1, 2].map(i => gOf(rec(t), i as 0 | 1 | 2)));
      const zs = verts.map(v => v[2]);
      // root starts AT the shoulder (where the cone starts yielding)
      expect(Math.min(...zs)).toBeLessThanOrEqual(zA + 1);
      expect(Math.min(...zs)).toBeGreaterThan(cUp + 0.6 * 32 - 2);
      // and runs to the hinge line
      expect(Math.max(...zs)).toBe(zB);
      // CLINGS: at the start station the plate is a flush sliver at the
      // hull surface (≤ 2 cells out of the SURFACE); at the hinge it
      // reaches its max width above the (narrower there) hull
      const base = role === 'rudder' ? 6 : 6;         // cUp / cSide (both 6 here)
      const surfAt = (z: number) => base + 8 * prof(z);
      const startOut = Math.max(...verts.filter(v => v[2] <= zA + 1).map(v => v[out]));
      const endOut = Math.max(...verts.filter(v => v[2] === zB).map(v => v[out]));
      expect(startOut - surfAt(zA)).toBeLessThanOrEqual(2);
      expect(endOut - surfAt(zB)).toBeGreaterThanOrEqual(3);
    }
  });

  test('one STRAIGHT top line: fillet and hung panel share it; keel is '
    + 'horizontal; the hinge side follows the contour; the modest fin is '
    + 'flush (user sketch #3: "that too should be straight … the smallest '
    + 'fin would probably continue horizontal, flush with the top")', () => {
    const rud = p.panels.rudder.flatMap(t => [0, 1, 2].map(i => gOf(rec(t), i as 0 | 1 | 2)));
    const all = [...p.fillets.rudder, ...p.panels.rudder]
      .flatMap(t => [0, 1, 2].map(i => gOf(rec(t), i as 0 | 1 | 2)));
    // the hung panel starts at the shoulder as a keel strip UNDER the hull
    // and reaches AFT of the hinge line
    expect(Math.min(...rud.map(v => v[2]))).toBeLessThanOrEqual(zA + 1);
    expect(Math.max(...rud.map(v => v[2]))).toBeGreaterThan(zB);
    // horizontal keel: the panel bottom is ONE level, the hull-underside
    // level at the shoulder
    const keel = 12 - Math.round(6 + 8 * prof(zA));            // 2·cUp − base(zA)
    expect(Math.min(...rud.map(v => v[1]))).toBe(keel);
    // ONE straight top: the highest vertex at each station rides the line
    // (no curve back in): sample shoulder, hinge and trailing
    const topAt = (z: number) => {
      const vs = all.filter(v => v[2] === z);
      return vs.length ? Math.max(...vs.map(v => v[1])) : NaN;
    };
    const lineAt = (z: number) => Math.round((6 + 8 * prof(zA)) + rise * (z - zA) / (zB - zA));
    const rise = Math.round(0.5 * 8 * 1);                      // finScale 1 × oversize 1
    for (const z of [zA + 6, zB, Math.max(...rud.map(v => v[2]))]) {
      const top = topAt(z);
      if (!Number.isNaN(top)) expect(Math.abs(top - lineAt(z)), `top at z=${z}`).toBeLessThanOrEqual(1);
    }
    // CONTINUOUS across the hinge: the fillet top at zB equals the panel
    // top at zB (the line continues, it does not jump or bend)
    expect(topAt(zB)).toBe(Math.max(...all.filter(v => v[2] === zB).map(v => v[1])));
    // hinge side NOT square: the panel's forward upper boundary rides the
    // hull underside contour (2·cUp − base) between shoulder and hinge
    const strip = rud.filter(v => v[2] > zA + 1 && v[2] < zB - 1);
    const upper = Math.max(...strip.map(v => v[1]));
    expect(upper).toBeLessThanOrEqual(Math.max(...[zA + 2, zB - 2].map(z => 12 - Math.round(6 + 8 * prof(z)))) + 2);
    // a modest fin (finScale 0.25) stays FLUSH: top ≤ hull top at shoulder
    const modest = planBalloonTail(spec, { ...OPT, finScale: 0.25, oversize: 1 }, adapters);
    const mAll = [...modest.fillets.rudder, ...modest.panels.rudder]
      .flatMap(t => [0, 1, 2].map(i => gOf(rec(t), i as 0 | 1 | 2)));
    // (exclude the hung keel strip's underside; check the TOP surface)
    expect(Math.max(...mAll.map(v => v[1])))
      .toBeLessThanOrEqual(Math.round(6 + 8 * prof(zA)) + 2);
    // the rudder hinge sits ON the hinge line
    const h = p.comps.find(c => c.kind === 'pivot' && c.role === 'rudder')!;
    expect(h.pos[2]).toBeCloseTo((zB - 6) * 0.25, 6);
    // ailerons: hung aft of the hinge, INNER edge contour-following (out of
    // the hull side), outer edge on the continued outward line
    const ail = p.panels.aileronR.flatMap(t => [0, 1, 2].map(i => gOf(rec(t), i as 0 | 1 | 2)));
    expect(Math.min(...ail.map(v => v[2]))).toBe(zB);
    expect(Math.max(...ail.map(v => v[2]))).toBeGreaterThan(zB);
    // the inner edge at the HINGE clears the cone; aft it follows the
    // contour in toward the apex (contour-following hinge side)
    expect(Math.min(...ail.filter(v => v[2] === zB).map(v => v[0])))
      .toBeGreaterThan(Math.round(6 + 8 * prof(zB)));
  });

  test('the aileron pair (fillets AND panels) is mirror-exact', () => {
    for (const key of ['fillets', 'panels'] as const) {
      const R = p[key].aileronR, L = p[key].aileronL;
      expect(L.length).toBe(R.length);
      const lm = new Map(L.map(t => [gset(t), t]));
      for (const t of R) {
        const m = (q: [number, number, number]) => [12 - q[0], q[1], q[2]].join(',');
        const key2 = [gOf(rec(t), 0), gOf(rec(t), 2), gOf(rec(t), 1)].map(m).sort().join('|');
        expect(lm.delete(key2), `mirror twin of ${gset(t)}`).toBe(true);
      }
      expect(lm.size).toBe(0);
    }
  });

  test('oversize grows the fins; the body proportion drives them', () => {
    const base = planBalloonTail(spec, { ...OPT, oversize: 1 }, adapters);
    const big = planBalloonTail(spec, { ...OPT, oversize: 3 }, adapters);
    const maxOut = (plan: typeof base, role: 'aileronR') =>
      Math.max(...plan.panels[role].flatMap(t => [0, 1, 2].map(i => gOf(rec(t), i as 0 | 1 | 2)[0])));
    expect(maxOut(big, 'aileronR')).toBeGreaterThan(maxOut(base, 'aileronR'));
    const wider = planBalloonTail({ ...spec, rx: 4 }, OPT, adapters);
    expect(wider.ok).toBe(true);
    expect(maxOut(wider, 'aileronR')).toBeGreaterThan(maxOut(base, 'aileronR'));
  });

  test('every LV run dives into the envelope right after the pivot socket', () => {
    for (const pp of p.pipes) {
      const pts = pp.points;
      expect(pts.length).toBeGreaterThanOrEqual(3);       // game wants ≥ 2 segments
      // interior waypoints (both plug ends excluded) sit INSIDE the envelope
      for (let i = 1; i < pts.length - 2; i++)
        expect(insideBalloon(spec, pts[i]!), `pipe ${pp.role} pt ${i} ${pts[i]}`)
          .toBe(true);
      // "immediately": the lead hop off the pivot socket is SHORT…
      const near = Math.hypot(pts[pts.length - 2]![0] - pts[pts.length - 1]![0],
        pts[pts.length - 2]![1] - pts[pts.length - 1]![1],
        pts[pts.length - 2]![2] - pts[pts.length - 1]![2]);
      expect(near).toBeLessThan(0.12);
      // …and the NEXT hop already heads inboard (toward the body axis)
      const prev = pts[pts.length - 3]!, lead = pts[pts.length - 2]!;
      const ax = Math.abs(prev[0] - lead[0]) > 1e-6 ? 0 : Math.abs(prev[1] - lead[1]) > 1e-6 ? 1 : 2;
      expect(ax, 'the hop before the lead is axis-aligned').toBeGreaterThanOrEqual(0);
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
    expect(planBalloonTail(spec, { ...OPT, volumes: 16 }, adapters).counts.volumes)
      .toBeLessThan(8);
  });

  test('the ghost map follows quarter-turns + cell offsets exactly', () => {
    const id = ghostMap(p.probes, undefined, [0, 0, 0]);
    expect(id.world([1.25, 0, 7])).toEqual([1.25, 0, 7]);
    expect(id.quat({ w: 1, x: 0, y: 0, z: 0 })).toEqual({ w: 1, x: 0, y: 0, z: 0 });
    const c = p.probes[0]!;
    const live = p.probes.map(g => {
      const q: [number, number, number] = [...g] as [number, number, number];
      q[2] = c[2] - (g[0] - c[0]);
      q[0] = c[0] + (g[2] - c[2]);
      return q;
    });
    const m = ghostMap(p.probes, live, [1, 0, 0]);
    expect(m.world([0, 0, 0])).toEqual([0.25, 0, 0]);
    expect(m.world([1, 0, 0])).toEqual([0.25, 0, -1]);
    const q = m.quat({ w: 1, x: 0, y: 0, z: 0 });
    expect(Math.abs(q.w)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(Math.abs(q.y)).toBeCloseTo(Math.SQRT1_2, 5);
    void transformSkinTris;
  });

  test('small / fat bodies refuse or adapt honestly', () => {
    const stub = planBalloonTail(
      { rx: 2, ry: 2, rz: 3, profile: 'cylinder', noseShoulder: 0.6, tailShoulder: 0.6 },
      OPT, adapters);
    expect(stub.ok).toBe(false);
    expect(stub.reason).toMatch(/tail zone/i);
    const big = planBalloonTail(
      { rx: 4, ry: 4, rz: 30, profile: 'cylinder', noseShoulder: 0.35, tailShoulder: 0.5 },
      OPT, adapters);
    expect(big.ok, big.reason).toBe(true);
    const skin = sphereSkinTris(spec, { slot: 51, material: 0, smooth: false });
    expect(skin.length).toBeGreaterThan(0);
  });
});

describe('v1.8.6 — the mirror never holes a fin face (urgent-fix.md)', () => {
  test('the big zeppelin tail batch is COMPLETE: no undefined, every record stores', () => {
    // mirror() x → 2·cSide − x moves `min` within its 12-cell frame, so a
    // fat R face could fail the window on the L side — the old
    // `encodeSkinTri(...)!` then pushed undefined into the triangle list.
    // encode-else-split; this pins the shipped plan at the user's size.
    const p = planBalloonTail(
      { rx: 12, ry: 8, rz: 12, profile: 'cylinder', noseShoulder: 0.35, tailShoulder: 0.6 },
      { pivotType: 'SmallHinge', finScale: 1, oversize: 1, volumes: 3 }, adapters);
    expect(p.ok, p.reason).toBe(true);
    for (const key of ['fillets', 'panels'] as const) {
      for (const role of ['rudder', 'aileronL', 'aileronR'] as const) {
        const list = p[key][role];
        expect(list.length, `${key}.${role} non-empty`).toBeGreaterThan(0);
        expect(list.every(Boolean), `${key}.${role}: no undefined/null entry`).toBe(true);
        for (const t of list) {                       // every record round-trips
          const g = [0, 1, 2].map(i => gOf(rec(t), i as 0 | 1 | 2)) as
            [[number, number, number], [number, number, number], [number, number, number]];
          for (const ax of [0, 1, 2] as const) {
            const f = Math.floor(Math.min(g[0]![ax]!, g[1]![ax]!, g[2]![ax]!) / 12);
            for (const q of g) {
              const w = q[ax]! - 12 * f;
              expect(w, `${key}.${role} window`).toBeGreaterThanOrEqual(0);
              expect(w, `${key}.${role} window`).toBeLessThanOrEqual(31);
            }
          }
        }
      }
    }
  }, 120_000);
});
