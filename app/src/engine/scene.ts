// scene.ts — the headless Three.js scene engine. Framework-free by design
// (REWRITE.md): React mounts a <Viewport> and calls into Engine; the engine
// never imports React. ALL THREE/DOM logic lives HERE — every rule (colours,
// winding, display poses, pipe anchoring, conditional parts) comes from the
// pure engine modules, so this file is thin translation, never re-derivation.
//
// On-demand rendering is a pinned perf rule (PERF.md): draw only when
// invalidated or while controls move.
//
// Lighting (legacy v0.144 rule): PBR metal has NO diffuse term — lights-only,
// chrome renders near-black. A PMREM studio env (RoomEnvironment, baked once
// at startup, zero per-frame cost) is set as scene.environment; only specs
// with metal > 0.5 get envMapIntensity 1.25 (materials.ts envIntensity), so
// matte/painted surfaces look exactly as before.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight,
  DoubleSide, Fog, GridHelper, Group, HemisphereLight, InstancedMesh,
  LineBasicMaterial, LineSegments, LinearSRGBColorSpace, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Raycaster,
  Scene, SphereGeometry, Vector2, Vector3, WebGLRenderer,
  type MeshStandardMaterialParameters,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPartBoxes, displayQuat, fileToViewQuat, standInBox, type PartBox } from './compparts';
import type { LoadedModel, ModelAtlas, NodeRec } from './models';
import { droppedParts, TEXT_MIRROR_X } from './models';
import { envIntensity, nodeMaterialSpec, pbr, srgbHexToLinear, type PbrSpec } from './materials';
import { buildPipes } from './pipes';
import { buildCompProxies, buildSolids, type SolidBatch } from './build';
import type { FilePalette } from './palette';
import type { Blueprint, BlueprintComponent } from './format';
import { isLegacyFile } from './format';

export interface PickHit { kind: 'block' | 'comp' | 'hull' | 'none'; ci?: number; point?: [number, number, number] }
export interface SceneStats { blocks: number; tris: number; hullTris: number; comps: number; draws: number; ok: boolean }

/** renderer kinds carried in userData.kind (pick routes on these) */
type Kind = 'block' | 'wire' | 'occ' | 'pipe' | 'pipe-end' | 'comp' | 'ground';

const DEG = Math.PI / 180;
const STAND_IN_HEX = 0x88aaff;          // legacy colliderProxy stand-in tint

export class Engine {
  readonly scene = new Scene();
  private renderer: WebGLRenderer | null = null;
  private camera = new PerspectiveCamera(55, 1, 0.05, 4000);
  private controls: OrbitControls | null = null;
  private root = new Group();
  private compRoots: Object3D[] = [];   // placed components (stand-in or real)
  private compCount = 0;
  private batch: SolidBatch | null = null;
  private bp: Blueprint | null = null;
  private needRender = false;
  private loadSeq = 0;                  // async real-model loads die with their load()
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
    {
      const pmrem = new PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    this.scene.add(new HemisphereLight(0xcfe8ff, 0x444422, 1.1));
    const sun = new DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(-6, 10, -4);
    this.scene.add(sun);
    this.scene.add(this.root);
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

  /** one PbrSpec → MeshStandardMaterial (palette r/g/b are LINEAR albedo —
   *  never sRGB-decode; only metal reflects the studio env) */
  private mat(spec: PbrSpec, extra?: Partial<MeshStandardMaterialParameters>): MeshStandardMaterial {
    return new MeshStandardMaterial({
      color: new Color().setRGB(spec.color[0], spec.color[1], spec.color[2], LinearSRGBColorSpace),
      metalness: spec.metal,
      roughness: spec.rough,
      envMapIntensity: envIntensity(spec.metal),
      transparent: spec.opacity < 1,
      opacity: spec.opacity,
      ...extra,
    });
  }

  /** no-env material for unlit/flat surfaces (ground, tracer-style bits) */
  private flatMat(hex: number): MeshStandardMaterial {
    const m = this.mat({ color: srgbHexToLinear(hex), metal: 0, rough: 1, opacity: 1 });
    m.envMapIntensity = 0;
    return m;
  }

  load(bp: Blueprint, atlas: ModelAtlas | null = null) {
    const seq = ++this.loadSeq;
    this.disposeScene();
    this.bp = bp;
    const legacy = isLegacyFile(bp);
    const palette: FilePalette | undefined = bp.data.colors ?? undefined;
    this.batch = buildSolids(bp);

    // blocks + hull prisms: one merged mesh per distinct palette colour
    for (const b of this.batch.buckets.values()) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(b.normals), 3));
      g.setIndex(b.indices);
      const m = new Mesh(g, this.mat(pbr(b.color), { side: DoubleSide }));
      m.userData.kind = 'block' satisfies Kind;
      this.root.add(m);
    }

    if (this.batch.wire.length) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(this.batch.wire), 3));
      const wire = new LineSegments(g, new LineBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0.55 }));
      wire.visible = false;             // wireframe (hull) defaults OFF (legacy)
      wire.userData.kind = 'wire' satisfies Kind;
      this.root.add(wire);
    }

    // occupancy (type-255) boxes: one line-style translucent mesh each, OFF
    const occMat = this.flatMat(0x39404d);
    occMat.transparent = true;
    occMat.opacity = 0.35;
    for (const box of buildCompProxies(bp)) {
      const m = new Mesh(new BoxGeometry(box.size.x, box.size.y, box.size.z), occMat.clone());
      m.position.set(box.min.x + box.size.x / 2, box.min.y + box.size.y / 2, box.min.z + box.size.z / 2);
      m.userData = { kind: 'occ', ci: box.ci };
      m.visible = false;                // occupancy boxes default OFF (legacy rule)
      this.root.add(m);
    }

    this.buildPipesMesh(bp);
    this.buildComponents(bp, atlas, legacy, palette, seq);

    const parts = buildPartBoxes(bp, atlas?.manifest ?? null);
    this.addGround(bp, parts);
    this.fit(parts);
    this.invalidate();
  }

  /** cables: ONE merged tube mesh + instanced connector endpoint spheres
   *  (cyan = a-end, green = b-end — legacy buildPipes colours, MeshBasic) */
  private buildPipesMesh(bp: Blueprint) {
    const net = buildPipes(bp.data.pipes);
    if (!net.tubes.length) return;
    const geos = net.tubes.map(t => {
      const g = new BoxGeometry(t.size[0], t.size[1], t.size[2]);
      g.applyMatrix4(new Matrix4().makeTranslation(t.center[0], t.center[1], t.center[2]));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    if (merged) {
      const tube = new Mesh(merged, this.flatMat(0x222228));
      tube.material.roughness = 0.9;
      tube.userData.kind = 'pipe' satisfies Kind;
      this.root.add(tube);
    }
    const sph = new SphereGeometry(0.035, 8, 6);
    const mkEnds = (color: number, end: (e: (typeof net.ends)[number]) => readonly [number, number, number]) => {
      const im = new InstancedMesh(sph, new MeshBasicMaterial({ color }), net.ends.length);
      const m4 = new Matrix4();
      net.ends.forEach((e, i) => {
        const v = end(e);
        im.setMatrixAt(i, m4.makeTranslation(v[0], v[1], v[2]));
      });
      im.instanceMatrix.needsUpdate = true;
      im.userData.kind = 'pipe-end' satisfies Kind;
      this.root.add(im);
    };
    mkEnds(0x33ddff, e => e.a);
    mkEnds(0x33ff88, e => e.b);
  }

  /** every non-Build component: a mirroring group at the DISPLAY pose — the
   *  painted collider stand-in immediately, the real game model when it loads */
  private buildComponents(bp: Blueprint, atlas: ModelAtlas | null, legacy: boolean,
    palette: FilePalette | undefined, seq: number) {
    bp.data.components.forEach((c, ci) => {
      if (c.type === 'Build') return;                        // construction-site ghost
      const qFile = c.orientation ?? { w: 1, x: 0, y: 0, z: 0 };
      const qDisp = displayQuat(c.type, fileToViewQuat(qFile, legacy), qFile);
      const g = new Group();
      g.position.set(c.position.x, c.position.y, -c.position.z);
      g.quaternion.set(qDisp.x, qDisp.y, qDisp.z, qDisp.w);
      g.scale.z = -1;                    // raw LH local space mirrored into view
      g.userData = { kind: 'comp', ci };

      const box = standInBox(c, atlas?.manifest[c.type]);
      const stand = new Mesh(new BoxGeometry(box.size[0], box.size[1], box.size[2]),
        this.mat(nodeMaterialSpec(c, 'color1', undefined, palette, legacy, STAND_IN_HEX)));
      stand.position.set(box.center[0], box.center[1], box.center[2]);
      g.add(stand);
      this.root.add(g);
      this.compRoots.push(g);
      this.compCount++;

      if (!atlas) return;
      void atlas.geoFor(c.type).then(model => {
        if (seq !== this.loadSeq || !model || !g.parent) return;   // stale/load-swapped
        const real = this.buildReal(c, model, palette, legacy);
        real.position.copy(g.position);
        real.quaternion.copy(g.quaternion);
        real.scale.z = -1;
        real.userData = { kind: 'comp', ci, real: true };
        g.visible = false;               // stand-in retires (kept for dispose symmetry)
        this.root.add(real);
        this.compRoots.push(real);
        this.invalidate();
      });
    });
  }

  /** real game model: the .ini node tree (ZYX euler = placement truth, NOT
   *  the glTF authoring offsets) over the atlas geometry, decimated twins
   *  (lv/li) by default — the legacy "low" display look */
  private buildReal(c: BlueprintComponent, model: LoadedModel,
    palette: FilePalette | undefined, legacy: boolean): Group {
    const { geo, info } = model;
    const root = new Group();
    const nodes = new Map<string, Group>();
    const mkNode = (n: NodeRec) => {
      const p = new Group();
      p.rotation.order = 'ZYX';
      p.position.set(...n.position);
      p.rotation.set(n.rotation[0]! * DEG, n.rotation[1]! * DEG, n.rotation[2]! * DEG);
      nodes.set(n.name, p);
    };
    // two passes: node parents may reference each other in ANY order
    for (const j of info.joints) mkNode(j);
    for (const t of info.targets) mkNode(t);
    for (const r of info.renderables) mkNode(r);
    const link = (n: NodeRec) => (nodes.get(n.parent ?? '') ?? root).add(nodes.get(n.name)!);
    for (const n of [...info.joints, ...info.targets, ...info.renderables]) link(n);

    const drop = droppedParts(c);
    for (const r of info.renderables) {
      if (drop.has(r.name)) continue;
      const nd = geo[r.name];
      if (!nd) continue;
      const rg = nodes.get(r.name)!;
      const byMat = new Map<string, BufferGeometry[]>();
      for (const prim of nd.prims) {
        const v = prim.lv ?? prim.v;               // low-poly twin by default
        const i = prim.li ?? prim.i;
        const gg = new BufferGeometry();
        gg.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
        gg.setIndex(i);
        gg.computeVertexNormals();
        if (TEXT_MIRROR_X.has(prim.material)) flipGeomX(gg);
        const arr = byMat.get(prim.material) ?? [];
        byMat.set(prim.material, [...arr, gg]);
      }
      for (const [mname, geos] of byMat) {
        const gg = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
        if (!gg) continue;
        // NO userData.kind on the child meshes: pick walks UP to the owning
        // group, whose userData carries {kind:'comp', ci}
        const m = new Mesh(gg, this.mat(nodeMaterialSpec(c, mname, info.materials, palette, legacy)));
        rg.add(m);
      }
    }
    // aileron: the SAVED flap deflection, data.angle in DEGREES (.ini joint
    // limits ±45° — a radian reading would exceed the physical joint)
    const joint = nodes.get('joint');
    if (joint && c.type === 'Aileron') {
      const angle = c.data?.['angle'];
      if (typeof angle === 'number') joint.rotateX(angle * DEG);
    }
    // Beacon: the game's flashing red lens is procedural (the gltf carries no
    // lens material); a static emissive tip keeps the part readable.
    if (c.type === 'Beacon') this.addBeaconLenses(info, geo, nodes, root);
    return root;
  }

  private addBeaconLenses(info: LoadedModel['info'], geo: LoadedModel['geo'],
    nodes: Map<string, Group>, root: Group) {
    for (const r of info.renderables) {
      const nd = geo[r.name];
      if (!nd) continue;
      let top: [number, number, number] | null = null;
      for (const prim of nd.prims) {
        if (prim.material !== 'body') continue;
        const v = prim.lv ?? prim.v;
        for (let k = 1; k + 1 < v.length; k += 3)
          if (!top || v[k]! > top[1]) top = [v[k - 1]!, v[k]!, v[k + 1]!];
      }
      if (!top) continue;
      const lens = new Mesh(new SphereGeometry(0.055, 12, 10),
        new MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222 }));
      lens.material.envMapIntensity = 0;
      lens.position.set(top[0], top[1] + 0.03, top[2]);
      (nodes.get(r.name) ?? root).add(lens);
    }
  }

  /** green ground + grid just under the lowest rendered geometry (ground=true:
   *  nothing of a craft renders below ground — part boxes may ride below the
   *  file box, the 3481322297 truck builds down to y=−1.5) */
  private addGround(bp: Blueprint, parts: PartBox[]) {
    let y = bp.box_min.y;
    for (const p of parts) y = Math.min(y, p.center[1] - p.size[1] / 2);
    y -= 0.05;
    const plane = new Mesh(new PlaneGeometry(120, 120), this.flatMat(0x3d5a34));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    plane.userData.kind = 'ground' satisfies Kind;
    this.root.add(plane);
    const grid = new GridHelper(28, 112, 0x223322, 0x2c4429);
    grid.position.y = y + 0.002;
    this.root.add(grid);
  }

  /** legacy fit: d = max(1.85r, 3.6), eye (0.6d, max(.34d,1.4), .72d), fog
   *  scales with r — over the UNION of file box, built solids and part boxes,
   *  so geometry that rides outside the file bbox still frames (whole craft) */
  private fit(parts: PartBox[]) {
    const bp = this.bp!;
    const mn = [bp.box_min.x, bp.box_min.y, -bp.box_max.z];
    const mx = [bp.box_max.x, bp.box_max.y, -bp.box_min.z];
    const grow = (x: number, y: number, z: number) => {
      mn[0] = Math.min(mn[0]!, x); mn[1] = Math.min(mn[1]!, y); mn[2] = Math.min(mn[2]!, z);
      mx[0] = Math.max(mx[0]!, x); mx[1] = Math.max(mx[1]!, y); mx[2] = Math.max(mx[2]!, z);
    };
    for (const b of this.batch?.buckets.values() ?? [])
      for (let i = 0; i < b.positions.length; i += 3) grow(b.positions[i]!, b.positions[i + 1]!, b.positions[i + 2]!);
    for (const p of parts)
      grow(p.center[0] - p.size[0] / 2, p.center[1] - p.size[1] / 2, p.center[2] - p.size[2] / 2),
        grow(p.center[0] + p.size[0] / 2, p.center[1] + p.size[1] / 2, p.center[2] + p.size[2] / 2);
    const c = new Vector3((mn[0]! + mx[0]!) / 2, (mn[1]! + mx[1]!) / 2, (mn[2]! + mx[2]!) / 2);
    const r = Math.max((mx[0]! - mn[0]!) / 2, (mx[1]! - mn[1]!) / 2, (mx[2]! - mn[2]!) / 2, 0.5);
    const d0 = Math.max(1.85 * r, 3.6);
    // fov is VERTICAL: on portrait screens the horizontal view narrows — pull
    // back by the aspect deficit so the whole craft stays framed on phones
    const d = this.camera.aspect < 1 ? d0 / Math.max(this.camera.aspect, 0.4) : d0;
    this.controls?.target.copy(c);
    this.camera.position.set(c.x + d * 0.6, c.y + Math.max(d * 0.34, 1.4), c.z + d * 0.72);
    this.camera.near = Math.max(0.05, r / 400);
    this.camera.far = Math.max(300, r * 10);
    if (this.scene.fog) {
      (this.scene.fog as { near: number }).near = Math.max(30, r * 2.5);
      (this.scene.fog as { far: number }).far = Math.max(80, r * 7);
    }
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
    if (!this.renderer) return (this.lastPick = { kind: 'none' });
    const probes: readonly (readonly [number, number])[] =
      [[0, 0], [0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]];
    for (const [dx, dy] of probes) {
      const hit = this.pickNdc(new Vector2(dx * 2, -dy * 2));
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
      const kind = o?.userData.kind as Kind | undefined;
      const p: [number, number, number] = [h.point.x, h.point.y, h.point.z];
      if (kind === 'comp') return { kind: 'comp', ci: o?.userData.ci as number, point: p };
      if (kind === 'block') return { kind: 'block', point: p };
    }
    return { kind: 'none' };
  }

  stats(): SceneStats {
    return {
      blocks: this.batch?.stats.blocks ?? 0,
      tris: this.batch?.stats.tris ?? 0,
      hullTris: this.batch?.stats.hullTris ?? 0,
      comps: this.compCount,
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
    this.compRoots = [];
    this.compCount = 0;
    this.batch = null;
  }

  dispose() {
    this.loadSeq++;                    // strand in-flight real-model loads
    this.disposeScene();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

// In-plane counter-mirror for baked text prims (legacy flipGeomX): the glyphs
// are authored readable from the plate's +normal side, so through our view
// z-mirror they need mirroring about their OWN bbox centre (the orient
// fixture 9000000001 pins both direction and centre), winding restored.
function flipGeomX(gg: BufferGeometry) {
  gg.computeBoundingBox();
  const bb = gg.boundingBox;
  if (!bb) return;
  const cx = (bb.min.x + bb.max.x) / 2;
  gg.applyMatrix4(new Matrix4().makeTranslation(2 * cx, 0, 0)
    .multiply(new Matrix4().makeScale(-1, 1, 1)));
  const gi = gg.getIndex();
  if (gi) {
    const a = gi.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]!; a[i + 1] = a[i + 2]!; a[i + 2] = t; }
    gi.needsUpdate = true;
  }
  gg.computeVertexNormals();
}
