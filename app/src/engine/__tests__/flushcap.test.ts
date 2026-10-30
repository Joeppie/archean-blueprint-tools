// build.ts v1.16.4 FLUSH CAP CULL pins — the render-pass attack on
// coplanar-dashboard burial (we: "the triangles must render exactly where
// the blocks they replaced were, exactly as good as the blocks — the blocks
// never obscured the dashboards"). Census on Chip's Badger (3326372833)
// from the seated eye: prism mode buried 9/13 dashboards under the +0.025 m
// cap (content sits 0..0.02 m proud of its mount); flat sheets showed 11/13
// (the 2 tri hits are dashboards on the OUTSIDE of a wall — correct). The
// law proven here: a prism cap lying IN a Dashboard board plane, overlapping
// the board rect, facing the content side, is dropped; EVERYTHING else is
// byte-stayed (back cap + all rim walls + every non-matching face).
import { afterAll, describe, expect, test } from 'vitest';
import { buildSolids, coplanarOverDash, dashPlanes } from '../build';
import { setSkinFlat, type HullFace } from '../hull';
import type { Blueprint, BlueprintComponent, Triangle } from '../format';

const wm = (g: number): number => (g - 6) * 0.25;

/** record from x-y plane lattice corners at z-row `zq` (normal ±ẑ by winding). */
const triXY = (zq: number, g: [number, number][], slot = 3): Triangle => {
  const o: Record<string, number | number[]> = {
    v0_x: g[0]![0], v0_y: g[0]![1], v0_z: zq,
    v1_x: g[1]![0], v1_y: g[1]![1], v1_z: zq,
    v2_x: g[2]![0], v2_y: g[2]![1], v2_z: zq,
    frame_x: 0, frame_y: 0, frame_z: 0, colors: [slot, slot, slot, slot, slot],
  };
  return o as unknown as Triangle;
};
const dash = (o: Partial<BlueprintComponent> & { x: number; y: number; z: number }): BlueprintComponent => {
  const { x, y, z, ...rest } = o;
  return {
    type: 'Dashboard', position: { x, y, z },
    orientation: { w: 1, x: 0, y: 0, z: 0 },
    data: { size_x: 100, size_y: 100 }, ...rest,
  } as BlueprintComponent;
};
const bpOf = (tris: Triangle[], comps: BlueprintComponent[]): Blueprint => ({
  box_min: { x: -3, y: -3, z: -3 }, box_max: { x: 3, y: 3, z: 3 },
  data: { version: 1, blocks: [], components: comps, triangles: tris },
});

// Board 1×1 m at z=0 origin (−1.5,−1.5,0), identity quat → normal +ẑ,
// rect x,y ∈ [−1.5,−0.5]. T is the right half of the board, CCW seen from
// +z ⇒ authored FRONT normal = +ẑ (faces the content side).
const D = dash({ x: wm(0), y: wm(0), z: wm(6) });
const T = triXY(6, [[0, 0], [4, 0], [4, 4]]);
const Tflip = triXY(6, [[0, 0], [4, 4], [4, 0]]);   // authored front = −ẑ

afterAll(() => setSkinFlat(false));

describe('buildSolids — the flush cap cull', () => {
  test('no dashboards: every prism keeps all 8 faces', () => {
    expect(buildSolids(bpOf([T], [])).stats.tris).toBe(8);
  });

  test('coplanar + overlapping board: content-side cap drops, 7 faces stay', () => {
    const { stats, buckets } = buildSolids(bpOf([T], [D]));
    expect(stats.tris).toBe(7);
    // all faces share slot 3 = one bucket: 7 faces × 3 verts × 3 floats
    expect([...buckets.values()][0]!.positions).toHaveLength(7 * 3 * 3);
  });

  test('which cap drops follows the content side, not the winding label', () => {
    // Tflip: front cap −ẑ (faces AWAY from content) stays; the +ẑ BACK cap goes
    expect(buildSolids(bpOf([Tflip], [D])).stats.tris).toBe(7);
  });

  test('coplanar plane but the board rect is elsewhere: verbatim 8 faces', () => {
    const far = dash({ x: wm(20), y: wm(20), z: wm(6) });
    expect(buildSolids(bpOf([T], [far])).stats.tris).toBe(8);
  });

  test('board yawed 90° (plane not parallel): verbatim 8 faces', () => {
    const s = Math.SQRT1_2;
    const turned = dash({ x: wm(0), y: wm(0), z: wm(6), orientation: { w: s, x: 0, y: s, z: 0 } });
    expect(buildSolids(bpOf([T], [turned])).stats.tris).toBe(8);
  });

  test('board 0.01 m PROUD of the skin (content still under the +0.025 cap): culled', () => {
    const raised = dash({ x: wm(0), y: wm(0), z: wm(6) + 0.01 });
    expect(buildSolids(bpOf([T], [raised])).stats.tris).toBe(7);
  });

  test('board FLOATING 0.05 m above the skin (over the cap): verbatim 8 faces', () => {
    const float = dash({ x: wm(0), y: wm(0), z: wm(6) + 0.05 });
    expect(buildSolids(bpOf([T], [float])).stats.tris).toBe(8);
  });

  test('flat sheets (v1.16.3 mode): content-side sheet culled, back sheet stays', () => {
    setSkinFlat(true);
    expect(buildSolids(bpOf([T], [D])).stats.tris).toBe(1);
    setSkinFlat(false);
  });
});

describe('dashPlanes + coplanarOverDash — the law surface', () => {
  test('identity dash: normal +ẑ, origin, metre extent', () => {
    const [p] = dashPlanes(bpOf([], [D]));
    expect(p!.n).toEqual([0, 0, 1]);
    expect(p!.o).toEqual([wm(0), wm(0), wm(6)]);
    expect([p!.w, p!.h]).toEqual([1, 1]);
  });

  test('a face IN the rect facing content hits; the same face 3 m up does not', () => {
    const planes = dashPlanes(bpOf([], [D]));
    const face: HullFace = {
      slot: 3,
      tri: [[wm(0), wm(0), wm(6)], [wm(4), wm(0), wm(6)], [wm(4), wm(4), wm(6)]],
    };
    expect(coplanarOverDash(face, planes)).toBe(true);
    const up: HullFace = {
      slot: 3,
      tri: face.tri.map(v => [v[0]!, v[1]!, v[2]! + 3] as const) as unknown as HullFace['tri'],
    };
    expect(coplanarOverDash(up, planes)).toBe(false);
  });

  test('the AWAY-facing copy of the same face never hits', () => {
    const planes = dashPlanes(bpOf([], [D]));
    const away: HullFace = {
      slot: 3,
      tri: [[wm(0), wm(0), wm(6)], [wm(4), wm(4), wm(6)], [wm(4), wm(0), wm(6)]],
    };
    expect(coplanarOverDash(away, planes)).toBe(false);
  });
});
