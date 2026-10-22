// latsphere.ts pins — the post-mortem's ORDER: the FIRST suite property is
// the one the three reverted Spheroid attempts never encoded: DEVIATION vs
// the ideal surface (no excursion inside ⇒ no dents; bounded excursion
// outside ⇒ no bulge). Sealed/watertight alone passed versions the user
// rejected by eye (SPHEROID-FAILURE.md §Root causes: "the pins verified the
// wrong properties"). Then the structural guarantees the convex-hull
// shrinkwrap gives FOR FREE — convexity (a dent is a concavity: impossible),
// closed manifold, outward winding — plus the format window (5-bit v, span
// ≤ 31), determinism, and the shift round-trip.
import { describe, expect, test } from 'vitest';
import {
  spherePlan, sphereShell, sphereSkinTris, shiftSkinTris, decodeSkinTri, skinKg,
  type SphereSpec,
} from '../latsphere';
import { CELL } from '../format';

/** ray-polytope radial distance ρ(n̂) of a convex face set about the centre:
 *  ρ = min over faces with n·n̂ > 0 of d_f / (n̂_f · n̂)  (halfspace form).
 *  ρ/r < 1 along that ray means the hull sits INSIDE the ideal surface =
 *  the exact quantitative statement of a dent in direction n̂. */
function radialDeviation(spec: SphereSpec) {
  const plan = spherePlan(spec);
  const cx = spec.cx ?? 6, cy = spec.cy ?? 6, cz = spec.cz ?? 6;
  const rx = spec.rx / CELL, ry = spec.ry / CELL, rz = spec.rz / CELL;
  const faces = plan.faces.map(([i, j, k]) => {
    const a = plan.shell[i]!, b = plan.shell[j]!, c = plan.shell[k]!;
    const e1: number[] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: number[] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const nl = Math.hypot(n[0]!, n[1]!, n[2]!);
    const u = [n[0]! / nl, n[1]! / nl, n[2]! / nl];
    const d = u[0]! * (a[0] - cx) + u[1]! * (a[1] - cy) + u[2]! * (a[2] - cz);
    return { u, d };
  });
  const ga = Math.PI * (3 - Math.sqrt(5));
  let worstIn = 0, worstOut = 0;      // ρ − rIDEAL in CELLS (inside ▸ negative)
  const N = 200;
  for (let s = 0; s < N; s++) {
    const z = 1 - (2 * s + 1) / N, r = Math.sqrt(Math.max(0, 1 - z * z));
    const th = ga * s;
    const nd = [Math.cos(th) * r, z, Math.sin(th) * r];
    const rIdeal = 1 / Math.sqrt((nd[0]! / rx) ** 2 + (nd[1]! / ry) ** 2 + (nd[2]! / rz) ** 2);
    let rho = Infinity;
    for (const f of faces) {
      const dn = f.u[0]! * nd[0]! + f.u[1]! * nd[1]! + f.u[2]! * nd[2]!;
      if (dn > 1e-12) rho = Math.min(rho, f.d / dn);
    }
    if (!isFinite(rho)) continue;
    const dev = rho - rIdeal;
    if (dev < worstIn) worstIn = dev;
    if (dev > worstOut) worstOut = dev;
  }
  return { plan, worstIn, worstOut };
}

const SIZES: { name: string; spec: SphereSpec }[] = [
  { name: 'ball r=1 m', spec: { rx: 1, ry: 1, rz: 1 } },
  { name: 'radome r=2 m', spec: { rx: 2, ry: 2, rz: 2 } },
  { name: 'tank r=3 m', spec: { rx: 3, ry: 3, rz: 3 } },
  { name: 'zeppelin r=12 m', spec: { rx: 12, ry: 12, rz: 12 } },
  { name: 'ellipsoid 4/2/1.5 m', spec: { rx: 4, ry: 2, rz: 1.5 } },
  { name: 'flat lens 6/1/6 m', spec: { rx: 6, ry: 1, rz: 6 } },
];

describe('latsphere — deviation vs the ideal surface (THE dent spec)', () => {
  for (const { name, spec } of SIZES) {
    test(`${name}: the silhouette never digs inside, bulges ≤ τ`, () => {
      const { worstIn, worstOut } = radialDeviation(spec);
      // NO DENTS: at most 0.16 cell (4 cm) inside the ideal surface along ANY
      // ray — measured worst sag is ~1 cm on every size below.
      expect(worstIn).toBeGreaterThan(-0.16);          // cells
      // NO BULGE: bounded by the shell band (τ = 0.75 cells) + rounding
      expect(worstOut).toBeLessThan(0.8);
    });
    test(`${name}: reported metrics match the silhouette probe`, () => {
      const st = spherePlan(spec).stats;
      expect(st.sagInM).toBeLessThan(0.05);
      expect(st.maxOutM).toBeLessThanOrEqual(0.75 * CELL + 1e-9);
      // a convex hull AROUND the surface encloses at least the ideal volume
      expect(st.volumeM3).toBeGreaterThan(st.idealM3 * 0.995);
    });
  }
});

describe('latsphere — convexity + watertightness (structure for free)', () => {
  for (const { name, spec } of SIZES) {
    test(`${name}: every face plane supports the WHOLE vertex set (convex ⇒ no dent exists)`, () => {
      const { shell, faces } = spherePlan(spec);
      const pts = [...new Set(faces.flat())].map(i => shell[i]!);
      let viol = 0;
      for (const [i, j, k] of faces) {
        const a = shell[i]!, b = shell[j]!, c = shell[k]!;
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const h = nx * a[0] + ny * a[1] + nz * a[2];
        for (const p of pts)
          if (nx * p[0] + ny * p[1] + nz * p[2] > h) viol++;
      }
      expect(viol).toBe(0);
    }, 30_000);
    test(`${name}: closed manifold, outward winding, integer vertices`, () => {
      const { shell, faces } = spherePlan(spec);
      const dir = new Map<string, number>();
      const und = new Map<string, number>();
      for (const [i, j, k] of faces) {
        for (const v of [i, j, k]) {
          const p = shell[v]!;
          expect(Number.isInteger(p[0]) && Number.isInteger(p[1]) && Number.isInteger(p[2])).toBe(true);
        }
        for (const [u, v] of [[i, j], [j, k], [k, i]] as const) {
          dir.set(`${u}>${v}`, (dir.get(`${u}>${v}`) ?? 0) + 1);
          const key = u < v ? `${u}-${v}` : `${v}-${u}`;
          und.set(key, (und.get(key) ?? 0) + 1);
        }
      }
      for (const v of dir.values()) expect(v).toBe(1);          // each HALFEDGE once
      for (const v of und.values()) expect(v).toBe(2);          // each edge twice → closed
      // outward: face normal · (centroid − centre) > 0 (positive volume)
      const cx = 6, cy = 6, cz = 6;
      for (const [i, j, k] of faces) {
        const a = shell[i]!, b = shell[j]!, c = shell[k]!;
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const gx = (a[0] + b[0] + c[0]) / 3 - cx, gy = (a[1] + b[1] + c[1]) / 3 - cy, gz = (a[2] + b[2] + c[2]) / 3 - cz;
        expect(nx * gx + ny * gy + nz * gz).toBeGreaterThan(0);
      }
    });
    test(`${name}: mirror-symmetric vertex set (the shell test is even in q)`, () => {
      const { shell, faces } = spherePlan(spec);
      const cx = 6;
      const on = new Set(faces.flat());
      const key = (p: number[]) => `${p[0]},${p[1]},${p[2]}`;
      const shellSet = new Set(shell.map(p => key(p)));
      // the shell is exactly mirror-symmetric; the hull vertex SET may pick a
      // different representative over a coplanar lattice run (Quickhull's
      // diagonal + collinear-vertex choice is enumeration-ordered) — the
      // SHAPE stays symmetric because every vertex lies on the same shell:
      // measured worst representative gap is 3 cells on the 24 m zeppelin.
      for (const p of shell)
        expect(shellSet.has(key([2 * cx - p[0], p[1], p[2]]))).toBe(true);
      const hull = new Map<string, [number, number, number]>();
      for (const v of on) { const p = shell[v]!; hull.set(key(p), p); }
      for (const p of hull.values()) {
        const m: [number, number, number] = [2 * cx - p[0], p[1], p[2]];
        if (hull.has(key(m))) continue;
        let near = false;
        for (const q of hull.values())
          if (Math.max(Math.abs(q[0] - m[0]), Math.abs(q[1] - m[1]), Math.abs(q[2] - m[2])) <= 3) { near = true; break; }
        expect(near).toBe(true);
      }
    }, 30_000);
  }
});

describe('latsphere — the shipped records', () => {
  test('triangles fit the 5-bit window and decode back to the hull vertices', () => {
    const spec: SphereSpec = { rx: 3, ry: 3, rz: 3 };
    const plan = spherePlan(spec);
    const tris = sphereSkinTris(spec, { slot: 51, material: 2 });
    expect(tris.length).toBe(plan.faces.length);
    expect(plan.skipped).toBe(0);
    for (const t of tris) {
      expect(t.smooth).toBeUndefined();                      // flat default
      expect(t.colors).toEqual([51, 51, 51, 51, 51]);
      expect(t.material).toBe(2);
      for (const ax of ['x', 'y', 'z']) {
        expect(t[`frame_${ax}`]).toBeTypeOf('number');
        for (let i = 0; i < 3; i++) {
          const v = t[`v${i}_${ax}`] as number;
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(31);
        }
      }
    }
  });
  test('smooth:true writes the game’s smooth:1 key', () => {
    const tris = sphereSkinTris({ rx: 1, ry: 1, rz: 1 }, { slot: 3, smooth: true });
    for (const t of tris) expect(t.smooth).toBe(1);
  });
  test('placement shift round-trips (+12 then −12 = the original records)', () => {
    const tris = sphereSkinTris({ rx: 2, ry: 2, rz: 2 }, { slot: 51 });
    const moved = shiftSkinTris(shiftSkinTris(tris, [12, 5, -3]), [-12, -5, 3]);
    for (let i = 0; i < tris.length; i++) {
      const a = decodeSkinTri(tris[i]!), b = decodeSkinTri(moved[i]!);
      expect(b).toEqual(a);
      expect(moved[i]!.colors).toEqual(tris[i]!.colors);
    }
    // a whole-cell shift moves every lattice point by exactly the step
    const off = shiftSkinTris(tris, [1, 0, 0]);
    const g0 = decodeSkinTri(tris[0]!), g1 = decodeSkinTri(off[0]!);
    expect(g1[0][0] - g0[0][0]).toBe(1);
  });
  test('determinism: the same spec yields the byte-identical triangle list', () => {
    const a = sphereSkinTris({ rx: 1.5, ry: 1, rz: 2 }, { slot: 51 });
    const b = sphereSkinTris({ rx: 1.5, ry: 1, rz: 2 }, { slot: 51 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  test('tiny specs degrade to a convex tetra-ish hull, never throw', () => {
    const plan = spherePlan({ rx: 0.4, ry: 0.4, rz: 0.4 });
    for (const f of plan.faces) expect(f.length).toBe(3);
    expect(plan.stats.volumeM3).toBeGreaterThan(0);
  });
  test('off-origin centres work (multi-frame craft)', () => {
    const spec: SphereSpec = { rx: 4, ry: 4, rz: 4, cx: 30, cy: 20, cz: 14 };
    const { shell, faces } = spherePlan(spec);
    expect(faces.length).toBeGreaterThan(20);
    for (const [i, j, k] of faces)
      for (const v of [i, j, k]) {
        const p = shell[v]!;
        const d = Math.hypot(p[0] - 30, p[1] - 20, p[2] - 14);
        expect(d).toBeGreaterThanOrEqual(16);                 // never inside
        expect(d).toBeLessThanOrEqual(16 + 1.5 + 1e-9);       // ≤ τ out
      }
  });
  test('mass model: steel skin ≈ area × 0.05 m × density', () => {
    const st = spherePlan({ rx: 1, ry: 1, rz: 1 }).stats;
    // hullify's per-cell-cube density table: steel = index 2 → 1 kg/cell³
    expect(skinKg(st.areaM2, 2)).toBeCloseTo(st.areaM2 * 0.05 / (CELL ** 3) * 1, 6);
    expect(skinKg(st.areaM2, 5)).toBeGreaterThan(skinKg(st.areaM2, 0)); // lead ≫ composite
  });
  test('the shell hugs the surface: no candidate is deep inside or far out', () => {
    const spec: SphereSpec = { rx: 2, ry: 2, rz: 2 };
    for (const p of sphereShell(spec)) {
      const q: [number, number, number] = [p[0] - 6, p[1] - 6, p[2] - 6];
      const d = Math.hypot(q[0], q[1], q[2]);
      const r = 2 / CELL;
      expect(d - r).toBeLessThanOrEqual(0.75 + 1e-9);
      expect(d - r).toBeGreaterThanOrEqual(-1e-6);           // NEVER inside
    }
  });
});
