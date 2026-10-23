// splitface.test.ts — v1.9 THE FACE SPLITTER (user 2026-10-23: "segment
// whatever is breaking"). The refuse-on-window-violation rule (encodeSkinTri
// null → skipped++ → the dialog says "nothing to place") is REPLACED by a
// split: a face that outgrows the game's frame-aligned 31-cell window is
// subdivided by edge midpoints until every piece stores. The pins below are
// the contract: already-valid faces NEVER move, degenerate input emits
// nothing, every piece encodes and stays within a cell of the parent, the
// total signed area is preserved, the output is deterministic, the midpoint
// TIE rule is mirror-symmetric (the v1.7.4 chain-rule precedent — a mirrored
// triangle pair must split into mirrored pieces), the depth cap terminates
// absurd input with an honest null — and the sizes that used to be REFUSED
// (ellipsoid + tail) now store with skipped === 0.
import { describe, expect, test } from 'vitest';
import {
  splitFace, encodeSkinTri, decodeSkinTri, spherePlan, sphereSkinTris,
  transformSkinTris, shiftSkinTris, type GP3, type SkinOptions, type SphereSpec,
} from '../latsphere';
import type { Triangle } from '../format';
import { planBalloonTail, type BalloonAdapters } from '../balloonfin';
import manifest from '../../../../viewer/models/manifest.json';

type Adm = { name: string; type: string; position: [number, number, number]; rotation: [number, number, number] };
const MAN = manifest as unknown as Record<string, { adapters: Adm[] }>;
const adapters: BalloonAdapters = {
  pivot: MAN.SmallHinge!.adapters.find(a => a.type === 'lowvoltage')!,
  coupler: MAN.LowVoltageJunction!.adapters
    .filter(a => a.type === 'lowvoltage' && a.name !== 'lowvoltage-input'),
};

const OPT: SkinOptions = { slot: 7, material: 2, smooth: true };
const sub = (p: GP3, q: GP3): GP3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (p: GP3, q: GP3): GP3 =>
  [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];

/** summed signed area VECTORS of the decoded pieces (the sum stays a plane
 *  multiple: ½ Σ (b−a)×(c−a) over the decoded lattice vertices) */
function signedAreaSum(faces: Triangle[]): GP3 {
  const s: GP3 = [0, 0, 0];
  for (const f of faces) {
    const [a, b, c] = decodeSkinTri(f);
    const n = cross(sub(b, a), sub(c, a));
    s[0] += n[0] / 2; s[1] += n[1] / 2; s[2] += n[2] / 2;
  }
  return s;
}

describe('splitFace — the contract', () => {
  test('an already-encodable face is returned UNTOUCHED (one record)', () => {
    const T: [GP3, GP3, GP3] = [[0, 0, 0], [8, 2, 0], [3, 9, 0]];
    const out = splitFace(T, OPT);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(out![0]).toEqual(encodeSkinTri(T, OPT));    // byte-identical record
  });

  test('degenerate input (two vertices equal) emits NOTHING', () => {
    expect(splitFace([[0, 0, 0], [0, 0, 0], [5, 5, 0]], OPT)).toEqual([]);
    expect(splitFace([[1, 2, 3], [9, 0, 4], [1, 2, 3]], OPT)).toEqual([]);
  });

  test('a 40-cell window violation splits: every piece stores, area holds', () => {
    const T: [GP3, GP3, GP3] = [[-20, -20, 0], [20, -20, 0], [0, 20, 0]];
    expect(encodeSkinTri(T, OPT)).toBeNull();          // premise: un-storable
    const out = splitFace(T, OPT);
    expect(out).not.toBeNull();
    expect(out!.length).toBeGreaterThanOrEqual(4);     // ≥ one 1→4 subdivision
    const lo: GP3 = [...T[0]], hi: GP3 = [...T[0]];
    for (const p of T) for (const ax of [0, 1, 2] as const) {
      lo[ax] = Math.min(lo[ax], p[ax]); hi[ax] = Math.max(hi[ax], p[ax]);
    }
    for (const f of out!) {
      const g = decodeSkinTri(f);
      expect(encodeSkinTri(g, OPT), 'every piece passes the law alone').not.toBeNull();
      for (const p of g) for (const ax of [0, 1, 2] as const) {
        expect(Number.isInteger(p[ax])).toBe(true);    // integer lattice points
        // midpoint rounding moves ≤ 0.5 cell per level — one cell of bbox slack
        expect(p[ax]).toBeGreaterThanOrEqual(lo[ax] - 1);
        expect(p[ax]).toBeLessThanOrEqual(hi[ax] + 1);
      }
      // every piece carries the same option (colours/material/shading)
      expect(f.colors).toEqual([7, 7, 7, 7, 7]);
      expect(f.material).toBe(2);
      expect(f.smooth).toBe(1);
    }
    // the signed areas SUM to the parent's (exact midpoints here ⇒ exact)
    const tot = signedAreaSum(out!);
    const want = cross(sub(T[1], T[0]), sub(T[2], T[0]));
    const wl = Math.hypot(want[0], want[1], want[2]) / 2;
    expect(Math.abs(Math.hypot(tot[0], tot[1], tot[2]) - wl)).toBeLessThan(1.5);
  });

  test('determinism: the same input yields a deep-equal face list', () => {
    const mk = (): [GP3, GP3, GP3] => [[-17, -25, 4], [23, -9, -3], [1, 31, 28]];
    const a = splitFace(mk(), OPT);
    const b = splitFace(mk(), OPT);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a).toEqual(b);
  });

  test('MIRROR SYMMETRY: split(T) mirrored ≡ split(T mirrored) as face sets', () => {
    // x → 12−x (mirror about x = 6). Canonicalisation: faces are compared as
    // SORTED VERTEX-SETS, not ordered records — the split's sub order is
    // fixed by the LABELS (a,b,c), and a mirrored triangle walks those
    // labels mirrored, so the two lists agree in SET and count while the
    // per-face vertex order depends on the label-order convention. The
    // mid-point tie rule (round away from the componentwise centroid, exact
    // integer comparison) is what makes even the tie-picks mirror exactly.
    const T: [GP3, GP3, GP3] = [[8, 14, 30], [4, 14, 40], [6, -20, 30]];
    const mir = (p: GP3): GP3 => [12 - p[0], p[1], p[2]];
    expect(encodeSkinTri(T, OPT)).toBeNull();          // premise: violates
    const Tm: [GP3, GP3, GP3] = [mir(T[0]), mir(T[1]), mir(T[2])];
    expect(encodeSkinTri(Tm, OPT)).toBeNull();         // …and so does the twin
    const A = splitFace(T, OPT), B = splitFace(Tm, OPT);
    expect(A).not.toBeNull();
    expect(B).not.toBeNull();
    expect(A!.length).toBe(B!.length);
    const canon = (faces: Triangle[]) => faces
      .map(f => decodeSkinTri(f).map(p => p.join(',')).sort().join('|'))
      .sort();
    // the mirrored A with the per-face vertex order mirrored (swap 2nd/3rd)
    const Am: Triangle[] = (A!).map(f => {
      const [a, b, c] = decodeSkinTri(f);
      return encodeSkinTri([mir(a), mir(c), mir(b)], OPT)!;
    });
    expect(canon(Am)).toEqual(canon(B!));
  });

  test('absurd input terminates: a rescued set or an honest null', () => {
    const t0 = Date.now();
    const out = splitFace([[0, 0, 0], [400, 200, 0], [100, 390, 0]], OPT);
    expect(Date.now() - t0).toBeLessThan(10_000);      // terminates, fast
    if (out) {
      expect(out.length).toBeGreaterThan(4);
      for (const f of out) expect(encodeSkinTri(decodeSkinTri(f), OPT)).not.toBeNull();
    }
    // PAST the depth cap (span 10000 cells needs 9 halvings) the splitter
    // answers null honestly rather than splitting forever
    expect(splitFace([[0, 0, 0], [10000, 0, 0], [0, 10000, 0]], OPT)).toBeNull();
  });
});

describe('the sizes that used to REFUSE now store (integration)', () => {
  test('the wide flat ellipsoid (48×48×1 m): 688 refused faces → 0', () => {
    // probe record on the pre-splitFace tree (2026-10-23): skipped = 688,
    // 908 faces, the dialog said "nothing to place — 688 faces exceed the
    // game's 31-cell window". The ladder keeps planning its natural rungs
    // byte-identically — only the REFUSED fallback splits (v1.9 rule).
    const spec: SphereSpec = { rx: 48, ry: 48, rz: 1 };
    const plan = spherePlan(spec);
    expect(plan.skipped).toBe(0);
    expect(plan.faces.length).toBeGreaterThan(0);
    expect(sphereSkinTris(spec, { slot: 51 }).length).toBe(plan.faces.length);
  }, 120_000);

  test('the ellipsoid needle (0.5×0.5×12 m): 16 refused faces → 0', () => {
    const spec: SphereSpec = { rx: 0.5, ry: 0.5, rz: 12 };
    const plan = spherePlan(spec);
    expect(plan.skipped).toBe(0);
    expect(sphereSkinTris(spec, { slot: 51 }).length).toBe(plan.faces.length);
  }, 120_000);

  test('the tail batch stays clean at the maxed fin settings', () => {
    // HONEST note (probe sweep 2026-10-23): no planBalloonTail spec through
    // the public API currently reaches emit() with a window-violating face
    // — region() subdivides every band into ≤ 9-cell strips, and the
    // frame-aligned law needs ≥ 21 cells to break. The emit() wiring is the
    // never-refuse GUARANTEE for any future region growth; this pin holds
    // the plan clean at the largest knobs the dialog offers.
    const spec: SphereSpec = {
      rx: 2, ry: 2, rz: 30, profile: 'cylinder', noseShoulder: 0.35, tailShoulder: 0.5,
    };
    const p = planBalloonTail(spec, { pivotType: 'SmallHinge', finScale: 3, oversize: 4, volumes: 3 }, adapters);
    expect(p.ok, p.reason).toBe(true);
    expect(p.skipped).toBe(0);
    expect(p.counts.fillets).toBeGreaterThan(0);
    expect(p.counts.panels).toBeGreaterThan(0);
  }, 120_000);
});

// --------------------------------------------------- v1.8.6 urgent-fix
// transformSkinTris (the ⟲ ghost quarter-turns AND the placement-drag/commit
// shift) used to DROP every face whose image no longer fit the frame-aligned
// window. A quarter-turn SWAPS two axes' spans and any move re-places `min`
// inside its 12-cell frame, so a fat face (> 20-cell span) that encoded at
// its staged position vanished at unlucky ones — the user's "a valid
// zeppelin suddenly misses a face after rotations … the size doesn't
// inherently change" hole, persisted into the BUILT file (urgent-fix.md).
// The law now: NEVER drop — split the image (same splitFace as generation)
// and re-spell every piece in the source record's clothes.
const areaMag = (v: GP3) => Math.hypot(v[0]!, v[1]!, v[2]!);
const rotG = (ax: 0 | 1 | 2, pivot: number) => (g: GP3): GP3 => {
  const q: GP3 = [g[0]!, g[1]!, g[2]!];
  const o = (ax + 1) % 3, p = (ax + 2) % 3;
  const a = g[o]! - pivot, b = g[p]! - pivot;
  q[o] = pivot - b!; q[p] = pivot + a!;
  return q;
};

const BIG: SphereSpec = {
  rx: 12, ry: 8, rz: 12, profile: 'cylinder', noseShoulder: 0.35, tailShoulder: 0.6,
};

describe('transformSkinTris NEVER DROPS (urgent-fix.md)', () => {
  const base = sphereSkinTris(BIG, { slot: 51, material: 0 });

  test('the repro spec carries fat faces (non-vacuous premise)', () => {
    const fat = base.filter(t => {
      const g = decodeSkinTri(t);
      return [0, 1, 2].some(ax =>
        Math.max(g[0]![ax]!, g[1]![ax]!, g[2]![ax]!) - Math.min(g[0]![ax]!, g[1]![ax]!, g[2]![ax]!) > 20);
    });
    expect(fat.length).toBeGreaterThan(0);           // 32 measured 2026-10-23
  });

  test('every whole-cell shift keeps ALL coverage and every piece stores', () => {
    const want = signedAreaSum(base);
    for (const d of [1, 2, 3, 4, 5, 6]) {
      for (const step of [[0, 0, d], [d, 0, 0], [0, d, 0], [d, d, 0]] as GP3[]) {
        const out = shiftSkinTris(base, step);
        expect(out.length, `shift ${step}`).toBeGreaterThanOrEqual(base.length);
        expect(out.every(Boolean), `shift ${step}: no undefined`).toBe(true);
        for (const t of out) expect(encodeSkinTri(decodeSkinTri(t), OPT), 'piece stores').not.toBeNull();
        const got = signedAreaSum(out);
        for (const ax of [0, 1, 2] as const) {
          // a SPLIT face's rounded midpoints move its pieces ≤ ~1 cell ⇒ per-
          // face area drift ≤ ~perim/4 cells² (measured: 6 cells² over the 32
          // fat faces). DROPPING one fat face instead moves the sum by HUNDREDS.
          expect(Math.abs(got[ax]! - want[ax]!), `shift ${step} area ax${ax}`)
            .toBeLessThan(areaMag(want) * 0.01 + 64);
        }
      }
    }
  }, 120_000);

  test('every quarter-turn keeps ALL coverage (the ⟲X/⟲Y/⟲Z ghost buttons)', () => {
    const want = signedAreaSum(base);
    for (const ax of [0, 1, 2] as const) {
      for (const pivot of [7, 11]) {                // the measured killers
        const out = transformSkinTris(base, rotG(ax, pivot));
        expect(out.length, `rot${ax}@${pivot}`).toBeGreaterThanOrEqual(base.length);
        for (const t of out) expect(encodeSkinTri(decodeSkinTri(t), OPT), 'piece stores').not.toBeNull();
        const got = signedAreaSum(out);
        for (const a2 of [0, 1, 2] as const)
          expect(Math.abs(got[a2]! - want[a2]!), `rot${ax}@${pivot} area`)
            .toBeLessThan(areaMag(want) * 0.01 + 64);
      }
    }
  }, 120_000);

  test('a face that already encodes after the map stays BYTE-IDENTICAL', () => {
    // the thin craft: no fat faces ⇒ a shift is a pure relabel, no splitting
    const slim = sphereSkinTris({ rx: 2, ry: 2, rz: 2 }, { slot: 3, material: 1 });
    const moved = shiftSkinTris(slim, [12, 0, 0]);
    expect(moved.length).toBe(slim.length);
    for (let i = 0; i < slim.length; i++) {
      const a = decodeSkinTri(slim[i]!), b = decodeSkinTri(moved[i]!);
      for (let v = 0; v < 3; v++) expect(b[v], `v${v}`).toEqual([a[v]![0] + 12, a[v]![1], a[v]![2]]);
      expect(moved[i]!.colors).toEqual(slim[i]!.colors);
    }
  });

  test('a split piece re-wears the SOURCE record’s colours[5]/material/smooth', () => {
    // distinct per-slot colours (a hullify-style prism record): the pieces of
    // a dropped face must carry all five slots VERBATIM, not a uniform slot
    const rec = {
      colors: [51, 0, 4, 5, 6], material: 3, smooth: 1,
      frame_x: 0, frame_y: 0, frame_z: 0,
      v0_x: 0, v0_y: 0, v0_z: 0, v1_x: 30, v1_y: 0, v1_z: 0, v2_x: 0, v2_y: 30, v2_z: 0,
    } as unknown as Triangle;
    const out = transformSkinTris([rec], g => [g[0] + 3, g[1], g[2]]);
    expect(out.length).toBeGreaterThan(1);          // premise: it had to split
    for (const t of out) {
      expect(t.colors).toEqual([51, 0, 4, 5, 6]);
      expect(t.material).toBe(3);
      expect(t.smooth).toBe(1);
      expect(encodeSkinTri(decodeSkinTri(t), OPT)).not.toBeNull();
    }
  });

  test('shift round-trip restores the exact vertices (split pieces included)', () => {
    const out = shiftSkinTris(shiftSkinTris(base, [1, 0, 5]), [-1, 0, -5]);
    expect(out.length).toBeGreaterThanOrEqual(base.length);
    const want = signedAreaSum(base), got = signedAreaSum(out);
    for (const ax of [0, 1, 2] as const)
      expect(Math.abs(got[ax]! - want[ax]!)).toBeLessThan(areaMag(want) * 0.01 + 64);
  }, 120_000);

  test('the mirror twin of a fat face is complete (no undefined in the list)', () => {
    // the balloonfin.mirror() class: x → 2c − x moves `min` within its frame,
    // so encode succeeds on one side and fails on the other. splitFace-else-
    // drop is now the law there too; here: a hand-built fat pair.
    const T: [GP3, GP3, GP3] = [[0, 0, 0], [30, 0, 0], [0, 30, 0]];
    const enc = encodeSkinTri(T, OPT);
    const mir = (g: GP3): GP3 => [24 - g[0]!, g[1]!, g[2]!];
    const twin: [GP3, GP3, GP3] = [mir(T[0]), mir(T[2]), mir(T[1])];
    const twinEnc = encodeSkinTri(twin, OPT);
    // at least one side must be non-encodable for the pin to be non-vacuous
    expect(enc === null || twinEnc === null, 'a side violates the window').toBe(true);
    const list = [enc, twinEnc].flatMap(t => t ? [t] : (splitFace(t === enc ? T : twin, OPT) ?? []));
    expect(list.every(Boolean), 'no undefined/null pushed').toBe(true);
    for (const t of list) expect(encodeSkinTri(decodeSkinTri(t), OPT)).not.toBeNull();
  });
});
