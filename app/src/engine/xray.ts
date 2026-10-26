// ---------- P7.1 slice: the X-ray occlusion census, headless ----------
// (docs/TEST-PYRAMID.md Phase 1 — first seam lifted out of Engine.)
// v1.11 SCREEN-SPACE occlusion law (we: "we know where the cable reaches
// closest to the camera, and what its extents in pixel space are"): the
// TARGETS are the two endpoint parts' projected boxes and every cable-run
// segment's projected rect, each with a depth span; a triangle occludes
// when its projection lands in a target rect and its nearest depth is in
// FRONT of that target's far side. Engine.xrayPlan collects the scene
// (camera, endpoint boxes, the run's polyline, the candidate meshes) and
// delegates here — this module touches ONLY THREE math, so vitest pins
// the BLOCKED/EXPOSED census law on synthetic geometry (the law wire.spec
// paid in truck-sized page-thread for).
import { Box3, Matrix4, Vector3, type Mesh } from 'three';

/** a camera at a fixed pose: the caller supplies matrixWorldInverse
 *  (pure math: `new Matrix4().copy(cam.matrixWorld).invert()` after
 *  updateMatrixWorld) plus the projection parameters and drawing-buffer size */
export interface XrayCam {
  inv: Matrix4;
  W: number;
  H: number;
  fovDeg: number;
  ortho?: { left: number; right: number; top: number; bottom: number; zoom: number };
}

/** the read-only view of a position/index attribute (structural, so plain
 *  BufferAttribute and InterleavedBufferAttribute both fit) */
export interface PosAttr {
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
}

/** one occlusion candidate: a mesh's WORLD matrix + raw geometry. `box` is
 *  the mesh-level cheap reject AABB (precomputed; `new Box3().setFromObject`). */
export interface XrayMesh {
  ref: Mesh;
  matrixWorld: Matrix4;
  pos: PosAttr;
  idx: PosAttr | null;
  count: number;
  box: Box3;
}

export interface XrayPlanResult {
  mesh: XrayMesh;
  keep: number[];
  drop: number[];
}

/**
 * The plan: for every candidate mesh, the triangle STARTS that occlude a
 * target, and the keep/drop index split the overlay builder consumes. A
 * mesh fully in the way (nothing kept) is LEFT, not cut (the v1.11 law).
 * Deterministic: outputs follow the input order.
 */
export function xrayPlanPure(
  cam: XrayCam,
  partBoxes: Box3[],
  poly: Vector3[],
  cand: XrayMesh[],
): XrayPlanResult[] {
  const OUT: XrayPlanResult[] = [];
  const { inv, W, H } = cam;
  const ortho = cam.ortho !== undefined;
  const oc = cam.ortho ?? { left: 0, right: 0, top: 0, bottom: 0, zoom: 1 };
  const tanY = Math.tan((cam.fovDeg * Math.PI) / 360);
  const tanX = tanY * (W / Math.max(1, H));
  const proj = (v: Vector3): { x: number; y: number; z: number } | null => {
    const c = v.clone().applyMatrix4(inv);
    const d = -c.z;
    if (d <= 0.02) return null;
    if (ortho) {
      const sx = ((oc.right - oc.left) / 2) / (oc.zoom || 1);
      const sy = ((oc.top - oc.bottom) / 2) / (oc.zoom || 1);
      return { x: W / 2 + (c.x / sx) * (W / 2), y: H / 2 - (c.y / sy) * (H / 2), z: d };
    }
    return { x: W / 2 + (c.x / d / tanX) * (W / 2), y: H / 2 - (c.y / d / tanY) * (H / 2), z: d };
  };
  interface Tgt { x0: number; y0: number; x1: number; y1: number; near: number; far: number }
  const tgts: Tgt[] = [];
  for (const box of partBoxes) {
    if (box.isEmpty()) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let near = Infinity, far = -Infinity, ok = true;
    for (let i = 0; i < 8; i++) {
      const p = proj(new Vector3(i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
      if (!p) { ok = false; break; }
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      near = Math.min(near, p.z); far = Math.max(far, p.z);
    }
    if (ok) tgts.push({ x0, y0, x1, y1, near, far });
  }
  const ppts = poly.map(v => proj(v));
  for (let k = 1; k < ppts.length; k++) {
    const A = ppts[k - 1], B = ppts[k];
    if (!A || !B) continue;
    tgts.push({ x0: Math.min(A.x, B.x) - 3, y0: Math.min(A.y, B.y) - 3,
      x1: Math.max(A.x, B.x) + 3, y1: Math.max(A.y, B.y) + 3,
      near: Math.min(A.z, B.z), far: Math.max(A.z, B.z) + 0.02 });
  }
  if (!tgts.length) return OUT;
  let gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity, gFar = -Infinity;
  for (const t of tgts) {
    gx0 = Math.min(gx0, t.x0); gy0 = Math.min(gy0, t.y0);
    gx1 = Math.max(gx1, t.x1); gy1 = Math.max(gy1, t.y1); gFar = Math.max(gFar, t.far);
  }
  const pInT = (px: number, py: number, ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number): boolean => {
    const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
    const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  };
  const segX = (ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number): boolean => {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  const triHitsRect = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
    t: Tgt): boolean => {
    if (Math.max(ax, bx, cx) < t.x0 || Math.min(ax, bx, cx) > t.x1
      || Math.max(ay, by, cy) < t.y0 || Math.min(ay, by, cy) > t.y1) return false;
    if (pInT(t.x0, t.y0, ax, ay, bx, by, cx, cy) || pInT(t.x1, t.y0, ax, ay, bx, by, cx, cy)
      || pInT(t.x0, t.y1, ax, ay, bx, by, cx, cy) || pInT(t.x1, t.y1, ax, ay, bx, by, cx, cy))
      return true;
    if ((ax >= t.x0 && ax <= t.x1 && ay >= t.y0 && ay <= t.y1)
      || (bx >= t.x0 && bx <= t.x1 && by >= t.y0 && by <= t.y1)
      || (cx >= t.x0 && cx <= t.x1 && cy >= t.y0 && cy <= t.y1)) return true;
    const rx: [number, number][] = [[t.x0, t.y0], [t.x1, t.y0], [t.x1, t.y1], [t.x0, t.y1]];
    const tv: [number, number][] = [[ax, ay], [bx, by], [cx, cy]];
    for (let i = 0; i < 3; i++) {
      const [p1x, p1y] = tv[i]!, [p2x, p2y] = tv[(i + 1) % 3]!;
      for (let j = 0; j < 4; j++) {
        const [q1x, q1y] = rx[j]!, [q2x, q2y] = rx[(j + 1) % 4]!;
        if (segX(p1x, p1y, p2x, p2y, q1x, q1y, q2x, q2y)) return true;
      }
    }
    return false;
  };
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (const m of cand) {
    const { pos, idx, count: n, matrixWorld, box: mb } = m;
    // mesh-level cheap reject: projected depth vs the union far plane
    {
      let mNear = Infinity, mOk = false;
      for (let i = 0; i < 8; i++) {
        const p = proj(new Vector3(i & 1 ? mb.max.x : mb.min.x,
          i & 2 ? mb.max.y : mb.min.y, i & 4 ? mb.max.z : mb.min.z));
        if (!p) continue;
        mOk = true; mNear = Math.min(mNear, p.z);
      }
      if (mOk && mNear > gFar) continue;         // fully behind every target
    }
    const cut = new Set<number>();               // triangle STARTS cut out
    for (let k = 0; k < n; k += 3) {
      const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
      a.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(matrixWorld);
      b.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(matrixWorld);
      c.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(matrixWorld);
      const pa = proj(a), pb = proj(b), pc = proj(c);
      if (!pa || !pb || !pc) continue;
      const dMin = Math.min(pa.z, pb.z, pc.z);
      if (dMin > gFar) continue;
      if (Math.max(pa.x, pb.x, pc.x) < gx0 || Math.min(pa.x, pb.x, pc.x) > gx1
        || Math.max(pa.y, pb.y, pc.y) < gy0 || Math.min(pa.y, pb.y, pc.y) > gy1) continue;
      for (const t of tgts) {
        if (dMin > t.far) continue;              // behind this target
        if (triHitsRect(pa.x, pa.y, pb.x, pb.y, pc.x, pc.y, t)) { cut.add(k); break; }
      }
    }
    if (!cut.size) continue;
    const keep: number[] = [];
    const drop: number[] = [];
    for (let k = 0; k < n; k += 3) {
      const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
      if (cut.has(k)) {
        for (const i of [i0, i1, i2])
          drop.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      } else keep.push(i0, i1, i2);
    }
    if (!keep.length) continue;                   // fully in the way: leave it
    OUT.push({ mesh: m, keep, drop });
  }
  return OUT;
}

/** the census law in one word: how many meshes an X-ray WOULD cut */
export function xrayCutsPure(cam: XrayCam, partBoxes: Box3[], poly: Vector3[], cand: XrayMesh[]): number {
  return xrayPlanPure(cam, partBoxes, poly, cand).length;
}
