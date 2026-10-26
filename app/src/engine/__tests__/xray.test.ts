// P7.1 (docs/TEST-PYRAMID.md Phase 1): the X-ray occlusion census LAW,
// pinned headless on synthetic geometry. This is the law wire.spec's
// BLOCKED/EXPOSED legs measured over real truck-sized scenes (page-thread
// minutes); the pixels (surge-from-cursor, overlay restore) stay e2e.
// NOTE the first run's fixtures were degenerate: a single big quad at
// depth 3 fully covers the whole target projection → EVERY triangle is
// cut → the v1.11 'fully in the way: LEAVE it' law fires → cuts 0. The
// occlusion tests therefore use SUBDIVIDED walls (a partial occluder) and
// the LEFT test uses the fully-covering quad — the regimes are the law.
import { describe, expect, test } from 'vitest';
import { Box3, BufferAttribute, Matrix4, Mesh, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three';
import { xrayCutsPure, xrayPlanPure, type XrayCam, type XrayMesh } from '../xray';

/** 50° perspective at (0,0,6) looking down −z at the origin (800×600) */
function perspCam(): XrayCam {
  const cam = new PerspectiveCamera(50, 800 / 600, 0.1, 100);
  cam.position.set(0, 0, 6);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return { inv: new Matrix4().copy(cam.matrixWorld).invert(), W: 800, H: 600, fovDeg: 50 };
}
function orthoCam(): XrayCam {
  const cam = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  cam.position.set(0, 0, 6);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return {
    inv: new Matrix4().copy(cam.matrixWorld).invert(), W: 800, H: 600, fovDeg: 50,
    ortho: { left: -5, right: 5, top: 5, bottom: -5, zoom: 1 },
  };
}
/** an axis-facing square wall (size×size, subdivided seg×seg) at (x,y,z) */
function wall(size: number, at: [number, number, number], seg = 1): XrayMesh {
  const g = new PlaneGeometry(size, size, seg, seg);
  const mesh = new Mesh(g);
  mesh.position.set(...at);
  mesh.updateMatrixWorld(true);
  const pos = g.getAttribute('position') as BufferAttribute;
  const idx = g.getIndex();
  return { ref: mesh, matrixWorld: mesh.matrixWorld, pos, idx,
    count: idx ? idx.count : pos.count, box: new Box3().setFromObject(mesh) };
}
const boxAt = (x: number, y = 0, s = 0.5) =>
  new Box3(new Vector3(x - s, y - s, -s), new Vector3(x + s, y + s, s));
const PARTS = [boxAt(-1.5), boxAt(1.5)];
const RUN = [new Vector3(-1.5, 0, 0), new Vector3(1.5, 0, 0)];

describe('xray census — the BLOCKED/EXPOSED law (perspective)', () => {
  test('a subdivided wall BETWEEN camera and cable occludes → cuts 1', () => {
    // centre triangles cover the targets, the corner columns fall outside
    // the projected target union → a PARTIAL occluder (kept + cut)
    expect(xrayCutsPure(perspCam(), PARTS, RUN, [wall(6, [0, 0, 3], 6)]))
      .toBe(1);
  });
  test('a wall BESIDE the sight-line cuts nothing (the EXPOSED law)', () => {
    expect(xrayCutsPure(perspCam(), PARTS, RUN, [wall(6, [12, 0, 3], 6)])).toBe(0);
  });
  test('a wall BEHIND the targets cuts nothing (depth: near plane > far)', () => {
    expect(xrayCutsPure(perspCam(), PARTS, RUN, [wall(6, [0, 0, -3], 6)])).toBe(0);
  });
  test('a mesh FULLY in the way is LEFT, not cut (v1.11 law)', () => {
    // one quad projecting INSIDE the (large) target rect: every triangle
    // occludes → keep 0 → the mesh is left whole → not in the plan
    const BIG = [boxAt(0, 0, 3)];
    const run = [new Vector3(-3, 0, 0), new Vector3(3, 0, 0)];
    expect(xrayPlanPure(perspCam(), BIG, run, [wall(3, [0, 0, 3])])).toHaveLength(0);
  });
  test('a PARTIAL occluder splits keep/drop over every triangle exactly once', () => {
    const plan = xrayPlanPure(perspCam(), PARTS, RUN, [wall(3, [0.9, 0, 3], 6)]);
    expect(plan).toHaveLength(1);
    const { keep, drop } = plan[0]!;
    const tris = 6 * 6 * 2;
    expect(keep.length / 3 + drop.length / 9).toBe(tris);   // every triangle exactly once
    expect(keep.length).toBeGreaterThan(0);
    expect(drop.length).toBeGreaterThan(0);
  });
  test('occlusion of the cable SEGMENT (not the parts) counts (segment targets)', () => {
    // parts ABOVE/BELOW the run: their rects are far in y; only the run's
    // projected rect crosses the little wall — the segments are targets too.
    // (seg 4: the corner GRID rows stay clear of the thin band, so the wall
    // is a partial occluder — a seg-2 one crosses it everywhere and the
    // 'fully in the way' law LEAVES it.)
    const parts = [boxAt(0, 4), boxAt(0, -4)];
    const run = [new Vector3(-4, 0, 0), new Vector3(4, 0, 0)];
    expect(xrayCutsPure(perspCam(), parts, run, [wall(1, [0, 0, 3], 4)])).toBe(1);
  });
  test('no targets → nothing is cut (an unresolvable cable keeps its geometry)', () => {
    expect(xrayPlanPure(perspCam(), [], [], [wall(6, [0, 0, 3], 6)])).toHaveLength(0);
  });
  test('plan order follows the candidate order (deterministic overlays)', () => {
    const a = wall(6, [0, 0, 2], 6);
    const b = wall(6, [0, 0, 4], 6);
    const plan = xrayPlanPure(perspCam(), PARTS, RUN, [a, b]);
    expect(plan.map(p => p.mesh.ref)).toEqual([a.ref, b.ref]);
  });
  test('meshes without a usable geometry are skipped, never crash', () => {
    const bad = { ...wall(6, [0, 0, 3], 6), pos: null as unknown as BufferAttribute, count: 0 };
    expect(() => xrayPlanPure(perspCam(), PARTS, RUN, [bad, wall(6, [0, 0, 3], 6)])).not.toThrow();
    expect(xrayCutsPure(perspCam(), PARTS, RUN, [bad, wall(6, [0, 0, 3], 6)])).toBe(1);
  });
});

describe('xray census — orthographic projection (v1.9.2 dual-projection law)', () => {
  test('a wall covering the parts occludes in ortho too', () => {
    expect(xrayCutsPure(orthoCam(), PARTS, RUN, [wall(6, [0, 0, 3], 6)])).toBe(1);
  });
  test('ortho: a wall outside the frustum sheet cuts nothing', () => {
    expect(xrayCutsPure(orthoCam(), PARTS, RUN, [wall(6, [20, 0, 3], 6)])).toBe(0);
  });
});
