// highlight.ts — the selection visuals: the golden fat outline boxes
// (self + symmetry twins, legacy selEdges v0.164: a 1 px box vanished on
// HiDPI) and the incandescent X-RAY overlay (legacy v0.14x: additive glow
// meshes sharing the part's geometry, depthTest OFF so the selection reads
// THROUGH the hull). Lives beside the Engine; owns only its own
// materials/overlays, never the scene graph semantics.

import { AdditiveBlending, Box3, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const GOLD = 0xffc94d;

export class Highlight {
  /** the selection breathes; the caller's loop calls pulse() while mounted */
  private mats: LineMaterial[] = [];
  private boxes: LineSegments2[] = [];
  private xray: { mesh: Mesh; base: number }[] = [];
  private xrayMat: MeshBasicMaterial | null = null;

  private sceneRoot: Object3D;
  /** hover previews ride a SECOND instance in a distinct colour (the
   *  selection's gold pulse is never replaced, only supplemented) */
  private color: number;
  constructor(sceneRoot: Object3D, color = GOLD) {
    this.sceneRoot = sceneRoot; this.color = color;
  }

  get active() { return this.boxes.length > 0 || this.xray.length > 0; }

  /** outline box around every given object's CURRENT world bbox (+0.07 m) */
  setBoxes(targets: readonly Object3D[]) {
    this.clearBoxes();
    for (const t of targets) {
      const bb = new Box3().setFromObject(t);
      if (bb.isEmpty()) continue;
      bb.expandByScalar(0.07);
      const { min, max } = bb;
      const pts = [
        min.x, min.y, min.z, max.x, min.y, min.z, max.x, min.y, min.z, max.x, max.y, min.z,
        max.x, max.y, min.z, min.x, max.y, min.z, min.x, max.y, min.z, min.x, min.y, min.z,
        min.x, min.y, max.z, max.x, min.y, max.z, max.x, min.y, max.z, max.x, max.y, max.z,
        max.x, max.y, max.z, min.x, max.y, max.z, min.x, max.y, max.z, min.x, min.y, max.z,
        min.x, min.y, min.z, min.x, min.y, max.z, max.x, min.y, min.z, max.x, min.y, max.z,
        max.x, min.y, max.z, max.x, min.y, min.z, min.x, max.y, min.z, min.x, max.y, max.z,
      ];
      const lg = new LineSegmentsGeometry();
      lg.setPositions(pts);
      const mat = new LineMaterial({ color: this.color, linewidth: 3.5, transparent: true, depthTest: false });
      const box = new LineSegments2(lg, mat);
      box.renderOrder = 999;
      this.sceneRoot.add(box);
      this.boxes.push(box);
      this.mats.push(mat);
    }
  }
  setResolution(w: number, h: number) { for (const m of this.mats) m.resolution.set(w, h); }
  clearBoxes() {
    for (const b of this.boxes) { this.sceneRoot.remove(b); b.geometry.dispose(); }
    for (const m of this.mats) m.dispose();
    this.boxes = []; this.mats = [];
  }

  /** X-ray glow: one additive child overlay per visible mesh of the target
   *  trees. Added as CHILDREN they inherit the part's live transform — no
   *  per-frame matrix sync (the legacy per-frame copy was for the proxy-
   *  edited poses of the old viewer). */
  setXray(roots: readonly Object3D[], opacity = 0.35) {
    this.clearXray();
    if (!roots.length) return;
    this.xrayMat = new MeshBasicMaterial({
      color: this.color, transparent: true, opacity, blending: AdditiveBlending,
      depthTest: false, depthWrite: false, side: 2,
    });
    for (const root of roots) {
      root.traverse(o => {
        const m = o as Mesh;
        if (!(m as Mesh).isMesh || !m.visible || (m as Mesh).userData.noXray) return;
        const overlay = new Mesh(m.geometry, this.xrayMat!);
        overlay.renderOrder = 998;
        overlay.raycast = () => {};
        overlay.userData.noXray = true;
        // inherit the mesh's LOCAL transform by parenting at the mesh itself
        m.add(overlay);
        this.xray.push({ mesh: overlay, base: opacity });
      });
    }
  }
  clearXray() {
    for (const { mesh } of this.xray) mesh.removeFromParent();
    this.xray = [];
    this.xrayMat?.dispose();
    this.xrayMat = null;
  }

  /** the incandescent breath (legacy): opacity + intensity ride one sine */
  pulse(now: number) {
    if (!this.active) return false;
    const k = 0.5 + 0.5 * Math.sin(now / 260);
    this.mats.forEach((m, i) => { m.opacity = 0.62 + 0.33 * k * (i ? 0.8 : 1); });
    if (this.xrayMat) this.xrayMat.opacity = (0.18 + 0.34 * k);
    return true;
  }

  dispose() { this.clearBoxes(); this.clearXray(); }
}
