// scene.ts — the headless Three.js scene engine. Framework-free by design
// (REWRITE.md): React mounts a <Viewport> and calls into Engine; the engine
// never imports React. On-demand rendering is a pinned perf rule (PERF.md):
// draw only when invalidated, while controls move, or while flow runs (P4).
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight,
  DoubleSide, Fog, GridHelper, Group, HemisphereLight, LineBasicMaterial, LineSegments,
  LinearSRGBColorSpace, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera,
  PlaneGeometry, Raycaster, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PartBox } from './compparts';
import { buildCompProxies, buildSolids, type SolidBatch } from './build';
import type { Blueprint } from './format';

export interface PickHit { kind: 'block' | 'comp' | 'hull' | 'none'; ci?: number; point?: [number, number, number] }
export interface SceneStats { blocks: number; tris: number; hullTris: number; comps: number; draws: number; ok: boolean }

export class Engine {
  readonly scene = new Scene();
  private renderer: WebGLRenderer | null = null;
  private camera = new PerspectiveCamera(55, 1, 0.05, 4000);
  private controls: OrbitControls | null = null;
  private root = new Group();
  private compMeshes: Mesh[] = [];
  private parts: PartBox[] = [];
  private batch: SolidBatch | null = null;
  private bp: Blueprint | null = null;
  private needRender = false;
  lastPick: PickHit = { kind: 'none' };

  attach(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    // devicePixelRatio floored at 1, capped 2.5 (legacy onResize rule)
    this.renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio, 1), 2.5));
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.invalidate());
    // legacy lighting rig (view3d r0.178): sky blue + fog, hemi fill, warm sun
    this.scene.background = new Color(0x8fb4d8);
    this.scene.fog = new Fog(0x8fb4d8, 40, 90);
    this.scene.add(new HemisphereLight(0xcfe8ff, 0x444422, 1.1));
    const sun = new DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(-6, 10, -4);
    this.scene.add(sun);    this.scene.add(this.root);
    const loop = () => {
      this.controls?.update();                    // damping fires change→invalidate
      if (this.needRender && this.renderer) {
        this.needRender = false;
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.resize();
  }

  resize() {
    const c = this.renderer?.domElement as HTMLCanvasElement | null;
    if (!c || !this.renderer) return;
    const w = c.clientWidth || 1, h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate() { this.needRender = true; }

  load(bp: Blueprint, parts: PartBox[] = []) {
    this.bp = bp;
    this.parts = parts;
    this.disposeScene();
    this.batch = buildSolids(bp);

    for (const b of this.batch.buckets.values()) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(b.normals), 3));
      g.setIndex(b.indices);
      const c = b.color;
      const mat = new MeshStandardMaterial({
        // palette r/g/b are LINEAR albedo — do NOT sRGB-decode (legacy rule)
        color: new Color().setRGB(c.r / 255, c.g / 255, c.b / 255, LinearSRGBColorSpace),
        roughness: c.roughness / 7,
        metalness: c.metallic * (1 - c.roughness / 7),
        transparent: c.opacity < 15,
        opacity: c.opacity < 15 ? (c.opacity + 1) / 16 : 1,
        side: DoubleSide,
      });
      const m = new Mesh(g, mat);
      m.userData.kind = 'block';
      this.root.add(m);
    }

    if (this.batch.wire.length) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(this.batch.wire), 3));
      const wire = new LineSegments(g, new LineBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0.55 }));
      wire.visible = false;             // wireframe (hull) defaults OFF (legacy)
      wire.userData.kind = 'wire';
      this.root.add(wire);
    }

    const proxyMat = new MeshStandardMaterial({ color: 0x39404d, transparent: true, opacity: 0.35, roughness: 0.9 });
    for (const box of buildCompProxies(bp)) {
      const m = new Mesh(new BoxGeometry(box.size.x, box.size.y, box.size.z), proxyMat.clone());
      m.position.set(box.min.x + box.size.x / 2, box.min.y + box.size.y / 2, box.min.z + box.size.z / 2);
      m.userData = { kind: 'comp', ci: box.ci };
      m.visible = false;              // occupancy boxes default OFF (legacy conndef rule)
      this.compMeshes.push(m);
      this.root.add(m);
    }

    // component collider proxies (legacy low-poly look): grey boxes, pickable
    const partMat = new MeshStandardMaterial({ color: 0x8a93a3, roughness: 0.7, metalness: 0.15 });
    for (const box of parts) {
      const m = new Mesh(new BoxGeometry(box.size[0], box.size[1], box.size[2]), partMat);
      m.position.set(box.center[0], box.center[1], box.center[2]);
      m.userData = { kind: 'comp', ci: box.ci };
      this.root.add(m);
    }

    this.addGround(bp);
    this.fit();
    this.invalidate();
  }

  /** green ground + grid just under the lowest rendered geometry (ground=true) */
  private addGround(bp: Blueprint) {
    const y = Math.min(bp.box_min.y, ...this.compMeshes.map(m => m.position.y - 0.15)) - 0.05;
    const plane = new Mesh(new PlaneGeometry(120, 120),
      new MeshStandardMaterial({ color: 0x3d5a34, roughness: 1 }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    plane.userData.kind = 'ground';
    this.root.add(plane);
    const grid = new GridHelper(28, 112, 0x223322, 0x2c4429);
    grid.position.y = y + 0.002;
    this.root.add(grid);
  }

  /** legacy fit: d = max(1.85r, 3.6), eye (0.6d, max(.34d,1.4), .72d), fog
   *  scales with r — over the UNION of file box, built solids and part boxes,
   *  so geometry that rides outside the file bbox still frames (whole craft) */
  private fit() {
    const bp = this.bp!;
    const mn = [bp.box_min.x, bp.box_min.y, -bp.box_max.z];
    const mx = [bp.box_max.x, bp.box_max.y, -bp.box_min.z];
    const grow = (x: number, y: number, z: number) => {
      mn[0] = Math.min(mn[0]!, x); mn[1] = Math.min(mn[1]!, y); mn[2] = Math.min(mn[2]!, z);
      mx[0] = Math.max(mx[0]!, x); mx[1] = Math.max(mx[1]!, y); mx[2] = Math.max(mx[2]!, z);
    };
    for (const b of this.batch?.buckets.values() ?? [])
      for (let i = 0; i < b.positions.length; i += 3) grow(b.positions[i]!, b.positions[i + 1]!, b.positions[i + 2]!);
    for (const p of this.parts)
      grow(p.center[0] - p.size[0] / 2, p.center[1] - p.size[1] / 2, p.center[2] - p.size[2] / 2),
        grow(p.center[0] + p.size[0] / 2, p.center[1] + p.size[1] / 2, p.center[2] + p.size[2] / 2);
    const c = new Vector3((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
    const r = Math.max((mx[0] - mn[0]) / 2, (mx[1] - mn[1]) / 2, (mx[2] - mn[2]) / 2, 0.5);
    const d0 = Math.max(1.85 * r, 3.6);
    // fov is VERTICAL: on portrait screens the horizontal view narrows — pull
    // back by the aspect deficit so the whole craft stays framed on phones
    const d = this.camera.aspect < 1 ? d0 / Math.max(this.camera.aspect, 0.4) : d0;
    this.controls?.target.copy(c);
    this.camera.position.set(c.x + d * 0.6, c.y + Math.max(d * 0.34, 1.4), c.z + d * 0.72);
    this.camera.near = Math.max(0.05, r / 400);
    this.camera.far = Math.max(300, r * 10);
    if (this.scene.fog) { (this.scene.fog as { near: number }).near = Math.max(30, r * 2.5); (this.scene.fog as { far: number }).far = Math.max(80, r * 7); }
    this.camera.lookAt(c);
    this.controls?.update();
  }

  pickAt(clientX: number, clientY: number): PickHit {
    const c = this.renderer?.domElement as HTMLCanvasElement | null;
    if (!c) return (this.lastPick = { kind: 'none' });
    const rect = c.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return this.pickNdc(ndc);
  }

  /** headless-safe probe: cast at the centre + 4 offsets, first solid hit wins */
  pickProbe(): PickHit {
    const c = this.renderer?.domElement as HTMLCanvasElement | null;
    if (!c) return (this.lastPick = { kind: 'none' });
    for (const [dx, dy] of [[0, 0], [0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]]) {
      const ndc = new Vector2(dx * 2, -dy * 2);
      const hit = this.pickNdc(ndc);
      if (hit.kind !== 'none') return (this.lastPick = hit);
    }
    return (this.lastPick = { kind: 'none' });
  }

  private pickNdc(ndc: Vector2): PickHit {
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects([this.root], true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && !o.userData.kind) o = o.parent;
      const kind = o?.userData.kind as string | undefined;
      if (kind === 'comp') return { kind: 'comp', ci: o!.userData.ci as number, point: [h.point.x, h.point.y, h.point.z] };
      if (kind === 'block') return { kind: 'block', point: [h.point.x, h.point.y, h.point.z] };
    }
    return { kind: 'none' };
  }

  stats(): SceneStats {
    return {
      blocks: this.batch?.stats.blocks ?? 0,
      tris: this.batch?.stats.tris ?? 0,
      hullTris: this.batch?.stats.hullTris ?? 0,
      comps: this.compMeshes.length,
      draws: this.renderer?.info.render.calls ?? 0,
      ok: this.batch !== null && (this.batch.stats.blocks > 0 || this.batch.stats.hullTris > 0),
    };
  }

  get blueprint(): Blueprint | null { return this.bp; }

  private disposeScene() {
    this.root.traverse(o => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose());
      else mat?.dispose();
    });
    this.root.clear();
    this.compMeshes = [];
    this.batch = null;
  }

  dispose() {
    this.disposeScene();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
