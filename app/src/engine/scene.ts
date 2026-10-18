// scene.ts — the headless Three.js scene engine. Framework-free by design
// (REWRITE.md): React mounts a <Viewport> and calls into Engine; the engine
// never imports React. ALL THREE/DOM logic lives HERE — every rule (colours,
// winding, display poses, pipe anchoring, conditional parts, subgrid joins)
// comes from the pure engine modules, so this file is thin translation,
// never re-derivation.
//
// On-demand rendering is a pinned perf rule (PERF.md): draw only when
// invalidated or while controls move — plus the two live gestures we own:
// the selection pulse and the fly-to glide.
//
// Lighting (legacy v0.144 rule): PBR metal has NO diffuse term — lights-only,
// chrome renders near-black. A PMREM studio env (RoomEnvironment, baked once
// at startup, zero per-frame cost) is set as scene.environment; only specs
// with metal > 0.5 get envMapIntensity 1.25 (materials.ts envIntensity), so
// matte/painted surfaces look exactly as before.

import {
  Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight,
  DoubleSide, Fog, GridHelper, Group, HemisphereLight, InstancedMesh,
  LineBasicMaterial, LineSegments, LinearSRGBColorSpace, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, Quaternion, Raycaster,
  Scene, SphereGeometry, TorusGeometry, Vector2, Vector3, WebGLRenderer,
  type MeshStandardMaterialParameters,
} from 'three';
import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPartBoxes, displayQuat, fileToViewQuat, qMul, standInBox, type PartBox } from './compparts';
import type { FileQuat, Vec3D } from './format';
import type { LoadedModel, ModelAtlas, NodeRec } from './models';
import { droppedParts, TEXT_MIRROR_X } from './models';
import { envIntensity, nodeMaterialSpec, pbr, srgbHexToLinear, type PbrSpec } from './materials';
import { buildPipes } from './pipes';
import { buildBlocksSolids, buildCompProxies, buildSolids, type SolidBatch } from './build';
import type { FilePalette } from './palette';
import type { Blueprint, BlueprintComponent } from './format';
import { isLegacyFile } from './format';
import {
  captureJrefs, masterJointState, subBlockBBox, subJointPose, subMasterEntries,
  type JRef, type SubBBox,
} from './subgrid';
import {
  hasMirrorX, mirrorDelta, mirrorQuat, symAllowed, symTwinIndex, type TwinPair,
} from './sym';
import { calibrateCellMass, massModel, type MassModel } from './mass';
import { Highlight } from './highlight';
import { flightReport } from './flight';

export interface PickHit {
  kind: 'block' | 'comp' | 'sub' | 'none';
  ci?: number; sub?: number; point?: [number, number, number];
}
export interface SceneStats { blocks: number; tris: number; hullTris: number; comps: number; subs: number; draws: number; ok: boolean;
  /** 'lite' = the heavy-craft tier (painted stand-ins, no real-model fan-out) */
  tier: 'full' | 'lite' }

/** renderer kinds carried in userData.kind (pick routes on these) */
type Kind = 'block' | 'wire' | 'occ' | 'pipe' | 'pipe-end' | 'comp' | 'sub' | 'ground';

export interface ViewOptions {
  grid: boolean; occ: boolean; hull: boolean; wire: boolean; pipes: boolean; subs: boolean;
  mirror: boolean; com: boolean;
}
const DEFAULT_OPTS: ViewOptions = { grid: true, occ: false, hull: true, wire: false, pipes: true, subs: true, mirror: true, com: true };

const DEG = Math.PI / 180;
const STAND_IN_HEX = 0x88aaff;          // legacy colliderProxy stand-in tint
const GOLD = 0xffc94d;                  // selection outline (legacy golden box)
const Q_ID: FileQuat = { w: 1, x: 0, y: 0, z: 0 };
const qInv = (q: FileQuat): FileQuat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });

/** PERF.md's measured cliff: draw calls are what a GPU pays per frame, and
 *  one component = one stand-in + N real-model meshes. The desktop iGPU
 *  already only reaches 14 fps at ~12 k draws (the 6.3 MB giant); a phone
 *  tile GPU is 3-5x behind there, and its driver watchdog kills the WebGL
 *  context on the multi-hundred-ms first frame — the user's "Stratolaunch
 *  fails to render on my mobile phone" (3509975859, 2 370 components →
 *  9 108 geometries / 6 741 draws / 26 MB of model JSON when every part
 *  streams its real model). Above this component count the craft renders
 *  in the LITE tier: painted stand-in boxes only (the giant lands at
 *  ~2 400 draws — the budget the e2e phone pin asserts). Corpus: the giant
 *  has 2 370 components, the next craft 668, so only giants take this path. */
const HEAVY_COMPONENTS = 800;

export class Engine {
  readonly scene = new Scene();
  private renderer: WebGLRenderer | null = null;
  private camera = new PerspectiveCamera(55, 1, 0.05, 4000);
  private controls: OrbitControls | null = null;
  private root = new Group();
  /** placed components (stand-in group + real-model sibling), keyed by ci */
  private compRoots = new Map<number, Object3D[]>();
  /** writeback undo for the DISPLAY pose (droop/junction/toggle): file quat =
   *  mirror(qView · undo), undo = dispQ0⁻¹·viewQ0 captured at build — the
   *  legacy userData.wheelUndo right-multiplier, so inspector deltas applied
   *  on the LEFT (qd·q0) strip exactly (rawFromView parity). */
  private rotUndo = new Map<number, FileQuat>();
  private rotBase = new Map<number, { q: Vector4like }>();
  private batch: SolidBatch | null = null;
  private bp: Blueprint | null = null;
  private atlasRef: ModelAtlas | null = null;
  private realModelsOn = true;
  private needRender = false;
  private loadSeq = 0;                  // async real-model loads die with their load()
  private heavy = false;                // heavy-craft tier for the current load
  private legacy = false;
  private palette: FilePalette | null = null;
  /** view-space display anchoring: the craft's minimal frame at the origin
   *  (legacy moff — a multiple of 3 m, so cell indices stay exact) */
  private moff: Vec3D = { x: 0, y: 0, z: 0 };
  /** assets owned by the Engine, NOT by one scene load: shared unit box +
   *  cached stand-in materials (disposeScene must never dispose these) */
  private shared = new WeakSet<object>();
  private unitBox = new BoxGeometry(1, 1, 1);
  private matCache = new Map<string, MeshStandardMaterial>();
  private occ: MeshStandardMaterial | null = null;   // shared occ-box material

  // ---------- view-option groups (visibility targets) ----------
  private groundGroup = new Group();
  private hullMeshes: Mesh[] = [];
  private wireLine: LineSegments | null = null;
  private occMeshes: Mesh[] = [];
  private pipeMeshes: Object3D[] = [];
  private subGroup = new Group();
  private opts: ViewOptions = { ...DEFAULT_OPTS };
  private hullOpacity = 1;

  // ---------- subgrids (composite_builds kinematics) ----------
  private subGroups = new Map<number, Group>();
  private subJrefs = new Map<number, JRef[]>();
  private subCount = 0;

  // ---------- symmetry twins (engine/sym.ts) ----------
  private symIdx = new Map<number, TwinPair[]>();
  private symOn = localStorage.getItem('archean-app-sym') !== '0';   // the ⇄ switch
  private mirrorPlane: Group | null = null;

  // ---------- mass & CoM ----------
  private cellMass = 1.5;
  private comMarker: Group | null = null;
  /** hi-def: the FULL game meshes (prim.v) instead of the decimated twins */
  private hiDef = localStorage.getItem('archean-app-hidef') === '1';
  private symRotBases = new Map<number, Map<number, FileQuat>>();     // ci → twin display quat at edit start

  // ---------- selection ----------
  lastPick: PickHit = { kind: 'none' };
  private selCi = -1;
  private selSub = -1;
  /** outline boxes (self + twins) + the incandescent X-ray overlay */
  private hl = new Highlight(this.scene);
  onSelection: ((sel: { ci: number; sub: number }) => void) | null = null;
  private fly: { from: Vector3; to: Vector3; t0: number } | null = null;
  /** last fit() framing — the KSP camera-cluster presets pivot on this */
  private frameC: Vector3 | null = null;
  private frameD = 3.6;

  // ------------------------------------------------------------ gizmo (P3+)
  /** Blender-style move/rotate widget on the selection (legacy v0.150+):
   *  translate = WORLD axes (the arrows stay axis-aligned — the user rule),
   *  rotate = LOCAL rings (intrinsic, WYSIWYG). The proxy sits at the
   *  VISIBLE-geometry bbox centre (v0.167: off-origin real geometry spins IN
   *  PLACE at the rings instead of lever-swinging about the file origin), so
   *  a ring drag ORBITS the centre exactly. Shift snaps 15° / 0.25 m. */
  private gizmo: TransformControls | null = null;
  private gizmoProxy = new Group();
  private gizmoMode: 'off' | 'translate' | 'rotate' = 'rotate';
  private gizmoEnabled = true;
  private gizmoCi = -1;
  private gBase = new Map<number, {
    p0: Vector3; pp0: Vector3; q0: Quaternion;
    twins: { j: number; mask: number; p0: Vector3; cpre: Vector3; q0: Quaternion; q0p: FileQuat }[];
  }>();  // gesture bases
  /** every engine-side write: the App mirrors bp numbers into the raw doc */
  onEdit: ((ci: number) => void) | null = null;

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
    this.bakeEnv();
    // Phones recycle GPU contexts constantly (tab switches, memory
    // pressure). three re-uploads buffers on webglcontextrestored but NOT
    // the PMREM texture baked here — rebake and repaint, or the restored
    // canvas keeps a dead envMap and never looks right again.
    canvas.addEventListener('webglcontextrestored', this.onRestore);
    // gizmo (TransformControls): the helper renders in the scene; orbit
    // controls yield while an axis is dragged. Custom TGC events are untyped.
    {
      const g = this.gizmo = new TransformControls(this.camera, canvas);
      this.gizmoEnabled = localStorage.getItem('archean-app-gizmo') !== '0';    // legacy default ON
      const m = localStorage.getItem('archean-app-gizmo-mode');
      this.gizmoMode = m === 'off' || m === 'translate' || m === 'rotate' ? m : 'rotate';
      const listen = (t: string, f: (e: { value?: boolean }) => void) =>
        (g.addEventListener as unknown as (t: string, f: (e: { value?: boolean }) => void) => void)(t, f);
      listen('objectChange', () => this.gizmoWriteback());
      listen('mouseDown', () => { if (this.gizmoCi >= 0) this.captureGesture(this.gizmoCi); });
      listen('dragging-changed', e => { if (this.controls) this.controls.enabled = !e.value; });
      this.scene.add(g.getHelper(), this.gizmoProxy);
      g.enabled = false;
      g.getHelper().visible = false;
    }
    this.scene.add(new HemisphereLight(0xcfe8ff, 0x444422, 1.1));
    const sun = new DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(-6, 10, -4);
    this.scene.add(sun);
    this.scene.add(this.root);
    this.scene.add(this.subGroup);
    const loop = () => {
      this.controls?.update();                    // damping fires change→invalidate
      this.stepFly();
      this.pulseSelection();
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
    this.hl.setResolution(w, h);                 // fat lines live in screen px
    this.invalidate();
  }

  invalidate() { this.needRender = true; }

  /** PMREM studio env, baked once per GL context (legacy v0.144 rule): zero
   *  per-frame cost; only metal reads it (materials.ts envIntensity). */
  private bakeEnv() {
    if (!this.renderer) return;
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  private onRestore = () => { this.bakeEnv(); this.invalidate(); };

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

  /** material cache for the repeated stand-in/occupancy paints: a giant
   *  crafts its 2 370 boxes from a handful of colours — one material per
   *  spec, not per mesh (the legacy per-mesh materials only exist for the
   *  emissive selection highlight, which this app does not have yet) */
  private sharedMat(spec: PbrSpec): MeshStandardMaterial {
    const key = `${spec.color.join(',')}|${spec.metal}|${spec.rough}|${spec.opacity}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = this.mat(spec);
      this.matCache.set(key, m);
      this.shared.add(m);
    }
    return m;
  }

  /** one translucent occupancy-box material for the whole Engine lifetime */
  private occMaterial(): MeshStandardMaterial {
    if (!this.occ) {
      this.occ = this.flatMat(0x39404d);
      this.occ.transparent = true;
      this.occ.opacity = 0.35;
      this.shared.add(this.occ);
    }
    return this.occ;
  }

  // ------------------------------------------------------------------ load

  load(bp: Blueprint, atlas: ModelAtlas | null = null) {
    this.loadSeq++;
    this.disposeScene();
    this.bp = bp;
    this.atlasRef = atlas;
    this.legacy = isLegacyFile(bp);
    this.palette = bp.data.colors ?? null;
    this.symIdx = symTwinIndex(bp.data.components);      // load-time twin geometry

    // Display anchoring (legacy setModel): shift the craft's minimal frame to
    // the origin — Jimmy sits at x=1102 m (that is WHERE THE BUILDER STOOD).
    // A whole number of 3 m frames, so cell indices stay exact; the file is
    // never touched (view-only). view z mirrors the file → moff.z flips sign.
    {
      const fs = bp.data.components;
      const min = (f: 'frame_x' | 'frame_y' | 'frame_z') =>
        fs.length ? Math.min(...fs.map(c => ((c[f] as number | undefined) ?? 0) | 0)) : 0;
      this.moff = { x: -3 * min('frame_x'), y: -3 * min('frame_y'), z: 3 * min('frame_z') };
      this.root.position.set(this.moff.x, this.moff.y, this.moff.z);
      this.subGroup.position.set(this.moff.x, this.moff.y, this.moff.z);
    }

    this.batch = buildSolids(bp);

    // blocks + hull prisms: one merged mesh per distinct palette colour
    for (const b of this.batch.buckets.values()) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(b.normals), 3));
      g.setIndex(b.indices);
      const m = new Mesh(g, this.mat(pbr(b.color), { side: DoubleSide }));
      m.userData.kind = 'block' satisfies Kind;
      this.hullMeshes.push(m);
      this.root.add(m);
    }

    if (this.batch.wire.length) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(this.batch.wire), 3));
      const wire = new LineSegments(g, new LineBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0.55 }));
      wire.visible = this.opts.wire;         // wireframe (hull) defaults OFF (legacy)
      wire.userData.kind = 'wire' satisfies Kind;
      this.wireLine = wire;
      this.root.add(wire);
    }

    // occupancy (type-255) boxes: translucent, OFF, ONE shared unit box +
    // material scaled per mesh (a giant = 2 400 of these; see HEAVY comment)
    const occMat = this.occMaterial();
    for (const box of buildCompProxies(bp)) {
      const m = new Mesh(this.unitBox, occMat);
      m.position.set(box.min.x + box.size.x / 2, box.min.y + box.size.y / 2, box.min.z + box.size.z / 2);
      m.scale.set(box.size.x, box.size.y, box.size.z);
      m.userData = { kind: 'occ', ci: box.ci };
      m.visible = this.opts.occ;             // occupancy boxes default OFF (legacy rule)
      this.occMeshes.push(m);
      this.root.add(m);
    }

    this.buildPipesMesh(bp);
    // heavy-craft tier (PERF.md cliff, see HEAVY_COMPONENTS): above the
    // component budget the real-model fan-out takes the scene past what a
    // phone GPU survives, so the atlas never streams (this ALSO saves the
    // giant's 26 MB of per-type model JSON on metered connections)
    this.heavy = bp.data.components.reduce((n, c) => n + (c.type === 'Build' ? 0 : 1), 0) > HEAVY_COMPONENTS;
    this.buildComponents(bp, this.heavy ? null : atlas);
    this.buildSubgrids(bp);

    const parts = buildPartBoxes(bp, atlas?.manifest ?? null);
    this.cellMass = calibrateCellMass(bp, atlas?.manifest ?? null);   // total ⇒ declared
    this.updateCoM();
    this.addGround(bp, parts);
    this.buildMirrorPlane(parts);
    this.applyViewOptions();
    this.fit(parts);
    this.select(-1);
    this.invalidate();
  }

  /** real game models on/off (legacy setRealModels): rebuild the component
   *  fan-out with/without the atlas stream (the stand-ins are ALWAYS built) */
  setRealModels(on: boolean) {
    if (on === this.realModelsOn || !this.bp) return;
    this.realModelsOn = on;
    this.load(this.bp, on ? this.atlasRef : null);
  }
  get realModels() { return this.realModelsOn; }

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
      this.pipeMeshes.push(tube);
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
      this.pipeMeshes.push(im);
      this.root.add(im);
    };
    mkEnds(0x33ddff, e => e.a);
    mkEnds(0x33ff88, e => e.b);
  }

  /** every non-Build component: a mirroring group at the DISPLAY pose — the
   *  painted collider stand-in immediately, the real game model when it loads */
  private buildComponents(bp: Blueprint, atlas: ModelAtlas | null) {
    const seq = this.loadSeq;
    bp.data.components.forEach((c, ci) => {
      if (c.type === 'Build') return;                        // construction-site ghost
      const qFile = c.orientation ?? Q_ID;
      const qView = fileToViewQuat(qFile, this.legacy);
      const qDisp = displayQuat(c.type, qView, qFile);
      const g = new Group();
      g.position.set(c.position.x + this.moff.x, c.position.y + this.moff.y, -c.position.z + this.moff.z);
      g.quaternion.set(qDisp.x, qDisp.y, qDisp.z, qDisp.w);
      g.scale.z = -1;                    // raw LH local space mirrored into view
      g.userData = { kind: 'comp', ci };
      // writeback undo (legacy wheelUndo semantics): undo = dispQ0⁻¹·viewQ0
      // (a PRODUCT, not an inverse — applyDisplayPose stores exactly this
      // right-multiplier), so file = mirror(qDisp · undo) = the ORIGINAL
      // view quaternion and slider deltas qd·qDisp strip to qd·qView0.
      this.rotUndo.set(ci, qMul(qInv(qDisp), qView));
      this.root.add(g);
      this.pushRoot(ci, g);

      const box = standInBox(c, atlas?.manifest[c.type]);
      const stand = new Mesh(this.unitBox,
        this.sharedMat(nodeMaterialSpec(c, 'color1', undefined, this.palette, this.legacy, STAND_IN_HEX)));
      stand.position.set(box.center[0], box.center[1], box.center[2]);
      stand.scale.set(box.size[0], box.size[1], box.size[2]);   // shared unit box (geo count)
      g.add(stand);

      if (!atlas) return;
      void atlas.geoFor(c.type).then(model => {
        if (seq !== this.loadSeq || !model || !g.parent) return;   // stale/load-swapped
        const real = this.buildReal(c, model);
        real.position.copy(g.position);
        real.quaternion.copy(g.quaternion);
        real.scale.z = -1;
        real.userData = { kind: 'comp', ci, real: true };
        g.visible = false;               // stand-in retires (kept for dispose symmetry)
        this.root.add(real);
        this.pushRoot(ci, real);
        this.invalidate();
      });
    });
  }

  private pushRoot(ci: number, o: Object3D) {
    const lst = this.compRoots.get(ci);
    if (lst) lst.push(o); else this.compRoots.set(ci, [o]);
  }

  /** real game model: the .ini node tree (ZYX euler = placement truth, NOT
   *  the glTF authoring offsets) over the atlas geometry, decimated twins
   *  (lv/li) by default — the legacy "low" display look */
  private buildReal(c: BlueprintComponent, model: LoadedModel, noRaycast = false): Group {
    const { geo, info } = model;
    // The Dashboard's geometry is GENERATED by the game from `data` (its
    // glTF is only the editor template) — XenonViewer buildDashboard port.
    // Units are CENTIMETRES: corner-pivoted board origin→(size_x/100,
    // size_y/100, 0.01), plane local X·Y normal +z, elements z 0.01..0.02,
    // colours 0..255 LINEAR with metallic/roughness read straight off 0..255
    // (NOT the blocks' 0..7 / 0|1 scales). Buttons = painted faceplates.
    if (c.type === 'Dashboard') return this.buildDashboard(c, model, noRaycast);
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
        const v = this.hiDef ? prim.v : (prim.lv ?? prim.v);   // decimated twins by default
        const i = this.hiDef ? prim.i : (prim.li ?? prim.i);
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
        const m = new Mesh(gg, this.mat(nodeMaterialSpec(c, mname, info.materials, this.palette, this.legacy)));
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
    if (noRaycast) root.traverse(o => { o.raycast = () => {}; });   // legacy nested-real rule
    return root;
  }

  private dashMat(c: { r?: number; g?: number; b?: number } | undefined | null,
    metallic?: number, roughness?: number): MeshStandardMaterial {
    const rough = (roughness ?? 0) / 255;
    const m = new MeshStandardMaterial({
      color: new Color().setRGB((c?.r ?? 255) / 255, (c?.g ?? 255) / 255,
        (c?.b ?? 255) / 255, LinearSRGBColorSpace),
      roughness: Math.max(rough, 0.02),
      metalness: ((metallic ?? 0) / 255) * (1 - rough),
    });
    m.envMapIntensity = (metallic ?? 0) > 127 ? 1.25 : 0;
    return m;
  }

  /** Label text: 5 px/cm monospace grid on a canvas PRE-MIRRORED (x → w−x).
   *  The view chain mirrors z, so a RAW canvas reads MIRRORED from the
   *  plate's authored side — proven by the orient fixture 9000000001
   *  (legacy dashTextTex rule; the v105 canvas-mirror-less build was the
   *  re-reported regression). The pixel pass lights glyphs in mainColor on
   *  the baseColor plate, no half-tones. */
  private dashTextTex(el: Record<string, any>): CanvasTexture {
    const lines = String(el.text ?? '').split('\n');
    const ts = Math.max(1, el.textSize | 0);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round((el.size_x || 0) * 5));
    cv.height = Math.max(1, Math.round((el.size_y || 0) * 5));
    const x = cv.getContext('2d', { willReadFrequently: true })!;
    x.fillStyle = '#fff'; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.font = `${8 * ts}px monospace`;
    x.translate(cv.width, 0); x.scale(-1, 1);
    const center = (el.textAlign ?? 16) === 16;         // 16 = centred
    let y = 3;
    for (const line of lines) {
      let px = center ? Math.ceil((cv.width - line.length * 6 * ts) / 2) : 3;
      for (const ch of line) { x.fillText(ch, px, y + 9 * ts); px += 6 * ts; }
      y += 9 * ts;
    }
    const img = x.getImageData(0, 0, cv.width, cv.height), p = img.data;
    const bg = el.baseColor || { r: 255, g: 255, b: 255 };
    const fg = el.mainColor || { r: 0, g: 0, b: 0 };
    for (let i = 0; i < p.length; i += 4) {
      const lit = p[i + 3]! > 0;
      p[i] = lit ? fg.r : bg.r; p[i + 1] = lit ? fg.g : bg.g;
      p[i + 2] = lit ? fg.b : bg.b; p[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;                      // the few sRGB places
    t.magFilter = t.minFilter = NearestFilter;
    return t;
  }

  private buildDashboard(c: BlueprintComponent, model: LoadedModel, noRaycast = false): Group {
    const g = new Group();
    const d = (c.data ?? {}) as Record<string, any>;
    const w = (Number(d.size_x) || 0) / 100, h = (Number(d.size_y) || 0) / 100;
    if (w <= 0 || h <= 0) return g;
    const board = new Mesh(new BoxGeometry(w, h, 0.01),
      this.dashMat(d.color, d.metallic, d.roughness));
    board.position.set(w / 2, h / 2, 0.005);
    g.add(board);
    const dp = model.geo['dataport'];                   // the one glTF piece kept
    if (dp && !d.hideConnector) {
      const byMat = new Map<string, BufferGeometry[]>();
      for (const prim of dp.prims) {
        const v = this.hiDef ? prim.v : (prim.lv ?? prim.v);
        const i = this.hiDef ? prim.i : (prim.li ?? prim.i);
        const gg = new BufferGeometry();
        gg.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
        gg.setIndex(i);
        gg.computeVertexNormals();
        const arr = byMat.get(prim.material);
        if (arr) arr.push(gg); else byMat.set(prim.material, [gg]);
      }
      for (const [mname, geos] of byMat) {
        const gg = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
        if (!gg) continue;
        const m = new Mesh(gg, this.mat(nodeMaterialSpec(c, mname, model.info.materials,
          this.palette, this.legacy)));
        m.position.set(w / 2, h / 2, 0);                // centred behind the board
        g.add(m);
      }
    }
    for (const el of (d.elements ?? []) as Record<string, any>[]) {
      if (!el || !el.type) continue;
      const ew = (el.size_x || 0) / 100, eh = (el.size_y || 0) / 100;
      if (ew <= 0 || eh <= 0) continue;
      const ex = (el.pos_x || 0) / 100, ey = (el.pos_y || 0) / 100;
      const tex = el.type === 'Label' && el.text ? this.dashTextTex(el) : null;
      const body = this.dashMat(el.baseColor, el.baseMetallic, el.baseRoughness);
      const face = tex
        ? new MeshStandardMaterial({ map: tex, envMapIntensity: 0,
            roughness: Math.max((el.baseRoughness ?? 0) / 255, 0.02), metalness: 0 })
        : this.dashMat(el.mainColor, el.mainMetallic, el.mainRoughness);
      const m = new Mesh(new BoxGeometry(ew, eh, 0.01),
        [body, body, body, body, face, body]);          // +Z carries the text
      m.position.set(ex + ew / 2, ey + eh / 2, 0.015);
      g.add(m);
    }
    if (noRaycast) g.traverse(o => { o.raycast = () => {}; });
    return g;
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

  // --------------------------------------------------------------- subgrids
  // ONE THREE.Group per Build with nested data (doors/hatches). The group
  // BASE is the IDENTITY: nested content sits at parent-absolute coords
  // (subgrid.ts header); joint kinematics + rigid master riding compose on
  // top via syncSubJoints. Nested parts get stand-ins (pickable proxies —
  // an invisible proxy routes its click to the SUBGRID only when the ray
  // hits NO component, v0.169 rule) + real models with raycast disabled.

  private buildSubgrids(bp: Blueprint) {
    const masters = subMasterEntries(bp);
    const manifest = this.atlasRef?.manifest ?? null;
    let sn = 0;
    bp.data.components.forEach((c, bi) => {
      const nested = (c.data?.['components'] as BlueprintComponent[] | undefined) ?? [];
      if (c.type !== 'Build' || (!c.data?.['blocks'] && !nested.length)) return;
      const g = new Group();
      g.userData = { kind: 'sub', sub: bi, subn: ++sn };
      this.subGroup.add(g);
      this.subGroups.set(bi, g);

      const blocks = (c.data?.['blocks'] as Blueprint['data']['blocks'] | undefined) ?? [];
      const solids = buildBlocksSolids(blocks, this.palette, this.legacy);
      for (const b of solids.buckets.values()) {
        const gg = new BufferGeometry();
        gg.setAttribute('position', new BufferAttribute(new Float32Array(b.positions), 3));
        gg.setAttribute('normal', new BufferAttribute(new Float32Array(b.normals), 3));
        gg.setIndex(b.indices);
        const m = new Mesh(gg, this.mat(pbr(b.color), { side: DoubleSide }));
        g.add(m);                                       // pick walks up to the sub group
      }
      // heavy-craft tier: the nested parts are NOT selection targets anyway
      // (their proxies route clicks to the SUBGRID), so merge every stand-in
      // box into one mesh per paint colour — 659 individual boxes on the
      // Stratolaunch blew the phone draw budget the moment subgrids landed.
      const merged = new Map<string, { spec: PbrSpec; geos: BufferGeometry[] }>();
      const mergeStands = this.heavy ? (sc: BlueprintComponent) => {
        const spec = nodeMaterialSpec(sc, 'color1', undefined, this.palette, this.legacy, STAND_IN_HEX);
        const key = JSON.stringify([spec.color, spec.metal, spec.rough, spec.opacity]);
        const box = standInBox(sc, manifest?.[sc.type]);
        const bg = new BoxGeometry(box.size[0], box.size[1], box.size[2]);
        const q = displayQuat(sc.type, fileToViewQuat(sc.orientation ?? Q_ID, this.legacy), sc.orientation ?? Q_ID);
        bg.translate(box.center[0], box.center[1], box.center[2]);
        bg.applyMatrix4(new Matrix4().compose(
          new Vector3(sc.position.x, sc.position.y, -sc.position.z),
          new Quaternion(q.x, q.y, q.z, q.w),
          new Vector3(1, 1, -1),
        ));
        flipWinding(bg);                  // the z-mirror is BAKED now: compensate winding
        const lst = merged.get(key);
        if (lst) lst.geos.push(bg); else merged.set(key, { spec, geos: [bg] });
      } : null;
      for (const sc of nested) {
        if (sc.type === 'Build') continue;
        if (mergeStands) { mergeStands(sc); continue; }   // heavy tier: merged paint
        const qFile = sc.orientation ?? Q_ID;
        const m = new Group();
        m.position.set(sc.position.x, sc.position.y, -sc.position.z);
        const qDisp = displayQuat(sc.type, fileToViewQuat(qFile, this.legacy), qFile);
        m.quaternion.set(qDisp.x, qDisp.y, qDisp.z, qDisp.w);
        m.scale.z = -1;
        const box = standInBox(sc, manifest?.[sc.type]);
        const stand = new Mesh(this.unitBox,
          this.sharedMat(nodeMaterialSpec(sc, 'color1', undefined, this.palette, this.legacy, STAND_IN_HEX)));
        stand.position.set(box.center[0], box.center[1], box.center[2]);
        stand.scale.set(box.size[0], box.size[1], box.size[2]);
        m.add(stand);
        g.add(m);
        const mp = manifest?.[sc.type] ? this.atlasRef : null;
        if (mp && this.atlasRef) {
          const seq = this.loadSeq;
          void this.atlasRef.geoFor(sc.type).then(model => {
            if (seq !== this.loadSeq || !model || !g.children.includes(m)) return;
            const real = this.buildReal(sc, model, true);
            real.position.copy(m.position);
            real.quaternion.copy(m.quaternion);
            real.scale.z = -1;
            m.visible = false;
            g.add(real);
            this.invalidate();
          });
        }
      }
      // flush the merged stand-in paints (heavy tier): one mesh per colour
      for (const { spec, geos } of merged.values()) {
        const gg = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
        geos.forEach(x => { if (x !== gg) x.dispose(); });
        if (!gg) continue;
        g.add(new Mesh(gg, this.sharedMat(spec)));
      }
      // build-captured joint lines (v0.173-177 rules live in subgrid.ts)
      const bb: SubBBox | null = subBlockBBox(blocks);
      this.subJrefs.set(bi, captureJrefs(masters.get(bi) ?? [], bb, manifest, this.legacy));
    });
    this.subCount = sn;
    this.syncSubJoints();
  }

  /** Replay every subgrid's joint chain from the master parts' LIVE file
   *  data + pose (angle in degrees / slide in metres; master pose edits ride
   *  the whole subgrid in unison — the rigid-delta term is identity at the
   *  built pose, so the load display is bit-identical). */
  syncSubJoints() {
    if (!this.bp) return;
    for (const [bi, g] of this.subGroups) {
      const jrefs = this.subJrefs.get(bi) ?? [];
      const pose = subJointPose({ p: [0, 0, 0], q: Q_ID }, jrefs,
        jrefs.map(r => masterJointState(r.mc, this.legacy)));
      g.position.set(pose.p[0] + this.moff.x, pose.p[1] + this.moff.y, pose.p[2] + this.moff.z);
      g.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    }
    this.invalidate();
  }

  /** green ground + grid just under the lowest rendered geometry (ground=true:
   *  nothing of a craft renders below ground — part boxes may ride below the
   *  file box, the 3481322297 truck builds down to y=−1.5) */
  private addGround(bp: Blueprint, parts: PartBox[]) {
    let y = bp.box_min.y;
    for (const p of parts) y = Math.min(y, p.center[1] - p.size[1] / 2);
    y -= 0.05;
    this.groundGroup = new Group();                  // fresh per load (dispose-safe)
    const plane = new Mesh(new PlaneGeometry(120, 120), this.flatMat(0x3d5a34));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = y;
    plane.userData.kind = 'ground' satisfies Kind;
    this.groundGroup.add(plane);
    const grid = new GridHelper(28, 112, 0x223322, 0x2c4429);
    grid.position.y = y + 0.002;
    this.groundGroup.add(grid);
    this.root.add(this.groundGroup);
  }

  /** legacy fit: d = max(1.85r, 3.6), eye (0.6d, max(.34d,1.4), .72d), fog
   *  scales with r — over the UNION of file box, built solids and part boxes,
   *  so geometry that rides outside the file bbox still frames (whole craft).
   *  All in ANCHORED coords (moff shifts the rendered groups; frame with it). */
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
    this.scene.updateMatrixWorld(true);
    const subBox = new Box3().setFromObject(this.subGroup);   // subgrid content frames too
    if (!subBox.isEmpty()) { grow(subBox.min.x - this.moff.x, subBox.min.y - this.moff.y, subBox.min.z - this.moff.z);
      grow(subBox.max.x - this.moff.x, subBox.max.y - this.moff.y, subBox.max.z - this.moff.z); }
    const c = new Vector3((mn[0]! + mx[0]!) / 2 + this.moff.x, (mn[1]! + mx[1]!) / 2 + this.moff.y,
      (mn[2]! + mx[2]!) / 2 + this.moff.z);
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
    this.frameC = c.clone(); this.frameD = d;      // presets ride this framing
    this.camera.lookAt(c);
    this.controls?.update();
  }

  // ------------------------------------------------------------ view options

  setOption(key: keyof ViewOptions, on: boolean) {
    this.opts = { ...this.opts, [key]: on };
    if ((key === 'hull' && on && this.opts.wire) || (key === 'wire' && on && this.opts.hull))
      this.opts = { ...this.opts, [key === 'hull' ? 'wire' : 'hull']: false };   // mutually exclusive (legacy)
    this.applyViewOptions();
    this.invalidate();
  }
  private applyViewOptions() {
    for (const m of this.hullMeshes) m.visible = this.opts.hull;
    if (this.wireLine) this.wireLine.visible = this.opts.wire;
    for (const m of this.occMeshes) m.visible = this.opts.occ;
    for (const m of this.pipeMeshes) m.visible = this.opts.pipes;
    this.groundGroup.visible = this.opts.grid;
    this.subGroup.visible = this.opts.subs;
    if (this.mirrorPlane) this.mirrorPlane.visible = this.opts.mirror;
    if (this.comMarker) this.comMarker.visible = this.opts.com;
  }
  getOptions(): ViewOptions { return { ...this.opts }; }

  // ---------- symmetry twins ----------

  setSymOn(on: boolean) {
    this.symOn = on;
    localStorage.setItem('archean-app-sym', on ? '1' : '0');
    this.paintSelection();
    this.invalidate();
  }
  symState(): { on: boolean; mirrorX: boolean; active: boolean } {
    return {
      on: this.symOn,
      mirrorX: hasMirrorX(this.symIdx),
      active: this.selCi >= 0 && this.twinPairsFor(this.selCi).length > 0,
    };
  }
  /** live pairs that PROPAGATE for comp i (on only while the pair is still
   *  aligned — drift > 5 cm auto-disables, v0.166) */
  private twinPairsFor(ci: number): TwinPair[] {
    return symAllowed(this.symIdx, this.symOn, this.bp?.data.components ?? [], ci);
  }
  twinPairsOf(ci: number): TwinPair[] { return this.twinPairsFor(ci); }

  /** file-space POSITION write with twin propagation: the delta mirrors on
   *  the pair's mask axes; twins' own poses stay intact (v0.160: twins are
   *  separate components, not pose-mirrored); occ/type-255 mirrors ride at
   *  save via each twin's own committed delta. */
  setFilePosAxis(ci: number, ax: 'x' | 'y' | 'z', v: number) {
    const comps = this.bp?.data.components;
    const comp = comps?.[ci];
    if (!comp) return;
    const twins = this.twinPairsFor(ci);                 // evaluated PRE-move
    const old = { ...comp.position };
    comp.position[ax] = v;
    this.moveComp(ci);
    const d: Vec3D = { x: 0, y: 0, z: 0 };
    d[ax] = v - old[ax];
    for (const { j, mask } of twins) {
      const t = comps![j]!;
      const md = mirrorDelta(d, mask);
      t.position.x += md.x; t.position.y += md.y; t.position.z += md.z;
      this.moveComp(j);
      this.onEdit?.(j);                                  // doc mirror for the twin
    }
    this.onEdit?.(ci);                                   // doc mirror for self
    this.onSelection?.({ ci: this.selCi, sub: this.selSub });   // drift ⇒ ⇄ repaint
  }

  /** JOINT-STATE edit (data.angle DEGREES / data.pos m) on a kinematic
   *  master propagates the SAME delta to its live twins (v0.176): the
   *  twins' captured joint axes already encode the mirror, so EQUAL values
   *  ARE the symmetric motion (XYQ doors are authored 24.3°/24.3°). */
  propagateJoint(ci: number, key: string, delta: number) {
    const comps = this.bp?.data.components;
    const c = comps?.[ci];
    if (!c || !delta || !this.atlasRef?.manifest[c.type]?.joints?.length) return;
    for (const { j } of this.twinPairsFor(ci)) {
      const t = comps![j]!;
      if (t.type !== c.type) continue;
      const cur = typeof t.data?.[key] === 'number' ? (t.data[key] as number) : 0;
      t.data = { ...t.data, [key]: cur + delta };
      this.onDataEdit?.(j, key);
    }
  }
  onDataEdit: ((ci: number, key: string) => void) | null = null;

  // ---------- mass & CoM ----------

  /** the orange CoM marker (sphere + equator ring) at the RAW-space centre of
   *  mass, displayed through the view mirror (physics itself is file-space) */
  private updateCoM(): MassModel | null {
    if (!this.bp) return null;
    const mm = massModel(this.bp, this.atlasRef?.manifest ?? null, this.cellMass);
    if (!this.comMarker) {
      const g = new Group();
      const m = new Mesh(new SphereGeometry(0.07, 16, 12),
        new MeshBasicMaterial({ color: 0xff8800 }));
      const ring = new Mesh(new TorusGeometry(0.13, 0.012, 8, 32),
        new MeshBasicMaterial({ color: 0xff8800 }));
      ring.rotation.x = Math.PI / 2;
      g.add(m, ring);
      g.renderOrder = 998;
      this.comMarker = g;
      this.scene.add(g);
    }
    this.comMarker.position.set(mm.com[0] + this.moff.x, mm.com[1] + this.moff.y, -mm.com[2] + this.moff.z);
    this.comMarker.visible = this.opts.com && mm.total > 0;
    return mm;
  }
  flightReportData() {
    // lazy import avoided: flight.ts is cheap and pure — direct
    return this.bp ? flightReport(this.bp, this.atlasRef?.manifest ?? null, this.cellMass) : null;
  }
    massReport(): (MassModel & { comVisible: boolean }) | null {
    const mm = this.updateCoM();
    return mm ? { ...mm, comVisible: this.opts.com } : null;
  }
  setHiDef(on: boolean) {
    if (on === this.hiDef || !this.bp) return;
    this.hiDef = on;
    localStorage.setItem('archean-app-hidef', on ? '1' : '0');
    this.load(this.bp, this.realModelsOn ? this.atlasRef : null);   // rebuild the meshes
  }
  get hiDefOn() { return this.hiDef; }

  /** the striped x-symmetry sheet (v0.161) at FILE x = 0 — view x = moff.x.
   *  Shown only when the craft actually carries x-mirror pairs. */
  private buildMirrorPlane(parts: PartBox[]) {
    if (this.mirrorPlane) {
      this.root.remove(this.mirrorPlane);
      this.mirrorPlane.traverse(o => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        (m.material as MeshStandardMaterial)?.dispose?.();
      });
      this.mirrorPlane = null;
    }
    if (!hasMirrorX(this.symIdx)) return;
    let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of parts) {
      y0 = Math.min(y0, p.center[1] - p.size[1] / 2); y1 = Math.max(y1, p.center[1] + p.size[1] / 2);
      z0 = Math.min(z0, p.center[2] - p.size[2] / 2); z1 = Math.max(z1, p.center[2] + p.size[2] / 2);
    }
    if (!isFinite(y0)) return;
    const h = Math.max(y1 - y0, 1) * 1.15, w = Math.max(z1 - z0, 1) * 1.15;
    const g = new Group();
    const sheet = new Mesh(new PlaneGeometry(w, h),
      new MeshStandardMaterial({ color: 0xffc94d, transparent: true, opacity: 0.10,
        roughness: 1, side: DoubleSide, depthWrite: false }));
    sheet.material.envMapIntensity = 0;
    sheet.rotation.y = Math.PI / 2;                       // normal = x
    const edges = new LineSegments(new BufferGeometry().setFromPoints([
      new Vector3(0, -h / 2, -w / 2), new Vector3(0, -h / 2, w / 2),
      new Vector3(0, h / 2, w / 2), new Vector3(0, h / 2, -w / 2), new Vector3(0, -h / 2, -w / 2),
    ]), new LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6 }));
    g.add(sheet, edges);
    g.position.set(this.moff.x, (y0 + y1) / 2, (z0 + z1) / 2);
    this.mirrorPlane = g;
    this.root.add(g);
  }

  /** dims the whole hull skin: block solids + prism plates AND the wireframe
   *  overlay (legacy applyHullOpacity; per-material base opacity is cached) */
  setHullOpacity(v: number) {
    this.hullOpacity = v;
    for (const m of this.hullMeshes) {
      const mm = m.material as MeshStandardMaterial;
      const base = (mm.userData.baseOpacity as number | undefined) ?? mm.opacity;
      mm.userData.baseOpacity = base;
      mm.opacity = base * v;
      mm.transparent = base < 1 || v < 1;
    }
    if (this.wireLine) (this.wireLine.material as LineBasicMaterial).opacity = 0.55 * v;
    this.invalidate();
  }
  getHullOpacity() { return this.hullOpacity; }

  // -------------------------------------------------------------- selection

  select(ci: number) {
    this.selCi = ci;
    this.selSub = -1;
    this.paintSelection();
    this.syncGizmo();
    this.onSelection?.({ ci: this.selCi, sub: this.selSub });
    this.invalidate();
  }
  selectSub(bi: number) {
    this.selSub = bi;
    this.selCi = -1;
    this.paintSelection();
    this.syncGizmo();               // v0.170: subgrids get NO gizmo — they ride their masters
    this.onSelection?.({ ci: this.selCi, sub: this.selSub });
    this.invalidate();
  }
  get selection() { return { ci: this.selCi, sub: this.selSub }; }

  /** selection visuals (engine/highlight): golden outline boxes on the
   *  VISIBLE geometry of self AND the live symmetry twins (v0.164
   *  co-selection — twins dim via the shared pulse), plus the X-ray glow
   *  that reads THROUGH the hull. Subgrids get the box only. */
  private paintSelection() {
    this.scene.updateMatrixWorld(true);
    const self: Object3D[] = [];
    const twins: Object3D[] = [];
    let xray: Object3D[] = [];
    if (this.selCi >= 0) {
      const roots = this.compRoots.get(this.selCi) ?? [];
      const vis = roots.filter(o => o.visible);
      const pick = vis.length ? vis : roots;
      self.push(...pick);
      xray = pick;
      for (const { j } of this.twinPairsFor(this.selCi)) {
        const rs = this.compRoots.get(j) ?? [];
        const v = rs.filter(o => o.visible);
        twins.push(...(v.length ? v : rs));
      }
    } else if (this.selSub >= 0) {
      const g = this.subGroups.get(this.selSub);
      if (g) self.push(g);
    }
    this.hl.setBoxes([...self, ...twins]);
    this.hl.setXray(this.selCi >= 0 ? [...xray, ...twins] : []);
  }

  /** the selection breathes (legacy incandescent pulse): the on-demand loop
   *  wakes ONLY while a selection lives */
  private pulseSelection() {
    if (this.hl.pulse(performance.now())) this.needRender = true;
  }

  /** camera fly: glides the orbit pivot onto the part (manual triggers only —
   *  canvas click / list double-click; never on load or list single-click). */
  flyTo(ci: number) {
    const o = this.compRoots.get(ci)?.[0];
    if (!o || !this.controls) return;
    const box = new Box3();
    this.scene.updateMatrixWorld(true);
    const vis = (this.compRoots.get(ci) ?? []).filter(x => x.visible);
    for (const v of vis.length ? vis : [o]) box.expandByObject(v);
    if (box.isEmpty()) return;
    this.fly = { from: this.controls.target.clone(), to: box.getCenter(new Vector3()), t0: performance.now() };
  }
  private stepFly() {
    if (!this.fly || !this.controls) return;
    const k = Math.min(1, (performance.now() - this.fly.t0) / 380);
    const e = 1 - Math.pow(1 - k, 3);                // ease-out cubic
    const next = this.fly.from.clone().lerp(this.fly.to, e);
    this.camera.position.add(next.clone().sub(this.controls.target));
    this.controls.target.copy(next);
    if (k >= 1) this.fly = null;
    this.invalidate();
  }

  /** KSP camera-cluster presets: 'fit' re-applies the load framing;
   * top/front/side snap the eye onto an axis through the framed centre at
   * the fit distance (a hair of tilt keeps OrbitControls' up-vector sane).
   * View space: nose = −z, up = +y, right = +x. */
  viewPreset(k: 'fit' | 'top' | 'front' | 'side') {
    if (!this.controls || !this.frameC) return;
    const c = this.frameC, d = Math.max(this.frameD, 3.6);
    const p =
      k === 'fit' ? new Vector3(c.x + d * 0.6, c.y + Math.max(d * 0.34, 1.4), c.z + d * 0.72)
        : k === 'top' ? new Vector3(c.x, c.y + d, c.z + d * 0.002)
          : k === 'front' ? new Vector3(c.x, c.y + d * 0.002, c.z - d)
            : new Vector3(c.x + d, c.y + d * 0.002, c.z);
    this.fly = null;
    this.camera.position.copy(p);
    this.controls.target.copy(c);
    this.camera.lookAt(c);
    this.controls.update();
    this.invalidate();
  }
  /** eye position — the camera-preset e2e pins */
  camPos(): [number, number, number] {
    const p = this.camera.position;
    return [p.x, p.y, p.z];
  }

  // -------------------------------------------------------------- gizmo ops

  setGizmoEnabled(on: boolean) {
    this.gizmoEnabled = on;
    localStorage.setItem('archean-app-gizmo', on ? '1' : '0');
    this.syncGizmo();
    this.invalidate();
  }
  setGizmoMode(m: 'off' | 'translate' | 'rotate') {
    this.gizmoMode = m;
    localStorage.setItem('archean-app-gizmo-mode', m);
    this.syncGizmo();
    this.invalidate();
  }
  /** Shift = 15° / 0.25 m snap (legacy) */
  setGizmoSnap(on: boolean) {
    const g = this.gizmo;
    if (!g) return;
    g.setTranslationSnap(on ? 0.25 : null);
    g.setRotationSnap(on ? 15 * DEG : null);
  }
  gizmoState(): { mode: 'off' | 'translate' | 'rotate'; ci: number } {
    return { mode: !this.gizmoEnabled || this.gizmoCi < 0 ? 'off' : this.gizmoMode, ci: this.gizmoCi };
  }
  /** the live pivot in PRE-MOFF VIEW space (pins compare against (x, y, −z)
   *  of the part's file position) */
  gizmoPivot(): [number, number, number] | null {
    if (this.gizmoCi < 0) return null;
    const p = this.gizmoProxy.position;
    return [p.x - this.moff.x, p.y - this.moff.y, p.z - this.moff.z];
  }

  /** centre of the VISIBLE geometry (world incl. moff) = the gizmo pivot */
  private gizmoCentre(ci: number): Vector3 {
    const roots = this.compRoots.get(ci) ?? [];
    const vis = roots.filter(o => o.visible);
    const box = new Box3();
    this.scene.updateMatrixWorld(true);
    for (const o of vis.length ? vis : roots) box.expandByObject(o);
    return box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
  }

  private syncGizmo() {
    const g = this.gizmo;
    if (!g) return;
    const show = this.gizmoEnabled && this.gizmoMode !== 'off' && this.selCi >= 0;
    if (!show) { g.detach(); g.enabled = false; g.getHelper().visible = false; this.gizmoCi = -1; return; }
    const roots = this.compRoots.get(this.selCi) ?? [];
    const o = roots.find(r => r.visible) ?? roots[0];
    if (!o) { g.detach(); this.gizmoCi = -1; return; }
    const rebind = this.selCi !== this.gizmoCi;
    this.gizmoCi = this.selCi;
    this.gizmoProxy.position.copy(this.gizmoCentre(this.selCi));
    this.gizmoProxy.quaternion.copy(o.quaternion);
    if (rebind) this.captureGesture(this.selCi);        // base = the pose JUST placed
    g.attach(this.gizmoProxy);
    g.setMode(this.gizmoMode === 'translate' ? 'translate' : 'rotate');   // 'off' never reaches here
    // v0.158 SPACE IS PER-MODE: translate = WORLD (arrows stay axis-aligned),
    // rotate = LOCAL (intrinsic rings, the pinned WYSIWYG model)
    g.setSpace(this.gizmoMode === 'translate' ? 'world' : 'local');
    g.enabled = true;
    g.getHelper().visible = true;
  }

  /** gesture base: the committed file origin (view, pre-moff) + the proxy's
   *  CURRENT centre — rebased on attach AND every mouseDown so multi-grip
   *  sweeps keep rotating wherever the part currently is. */
  private captureGesture(ci: number) {
    const c = this.bp?.data.components[ci];
    if (!c) return;
    const mo = new Vector3(this.moff.x, this.moff.y, this.moff.z);
    const twins = this.twinPairsFor(ci).map(({ j, mask }) => {
      const t = this.bp!.data.components[j]!;
      const oj = (this.compRoots.get(j) ?? []).find(r => r.visible) ?? this.compRoots.get(j)?.[0];
      const q = oj?.quaternion;
      return {
        j, mask,
        p0: new Vector3(t.position.x, t.position.y, -t.position.z),
        cpre: this.gizmoCentre(j).sub(mo),                 // twin's OWN pivot (v0.167)
        q0: q ? new Quaternion(q.x, q.y, q.z, q.w) : new Quaternion(),
        q0p: q ? { w: q.w, x: q.x, y: q.y, z: q.z } : { ...Q_ID },
      };
    });
    this.gBase.set(ci, {
      p0: new Vector3(c.position.x, c.position.y, -c.position.z),
      pp0: this.gizmo ? this.gizmoProxy.position.clone() : new Vector3(),
      q0: this.gizmo ? this.gizmoProxy.quaternion.clone() : new Quaternion(),
      twins,
    });
  }

  /** writeback (legacy applyGizmo* semantics): the gizmo's rigid motion
   *  X ↦ c + R·(X − c) + t orbits the FILE origin about the pivot, the proxy
   *  quaternion IS the new display pose, and the saved quaternion strips the
   *  display-pose undo (droop/junction stay file-exact). */
  private gizmoWriteback() {
    const ci = this.gizmoCi;
    const b = this.gBase.get(ci);
    const comp = this.bp?.data.components[ci];
    const undo = this.rotUndo.get(ci);
    if (!b || !comp || !undo) return;
    const q = this.gizmoProxy.quaternion;
    // the gizmo's motion RELATIVE to the gesture base: X ↦ c + dq·(X−c) + t
    // (the ABSOLUTE q would also rotate during a pure translate)
    const dq = q.clone().multiply(b.q0.clone().invert());
    const dp = this.gizmoProxy.position.clone().sub(b.pp0);
    const cpre = b.pp0.clone().sub(new Vector3(this.moff.x, this.moff.y, this.moff.z));
    const off = new Vector3(b.p0.x - cpre.x, b.p0.y - cpre.y, b.p0.z - cpre.z).applyQuaternion(dq);
    const origin = new Vector3(cpre.x + off.x + dp.x, cpre.y + off.y + dp.y, cpre.z + off.z + dp.z);
    comp.position = { x: origin.x, y: origin.y, z: -origin.z };
    const t = quatMul({ x: q.x, y: q.y, z: q.z, w: q.w }, undo);
    const fileQ: FileQuat = this.legacy
      ? { w: t.w, x: -t.x, y: -t.y, z: t.z }
      : { w: t.w, x: t.x, y: t.y, z: -t.z };
    comp.orientation = fileQ;
    for (const o of this.compRoots.get(ci) ?? []) {
      o.position.set(origin.x + this.moff.x, origin.y + this.moff.y, -origin.z + this.moff.z);
      o.quaternion.copy(q);
    }
    // twins ride the SAME gesture: mirrored delta translate + mirrored-twin
    // spin, each orbiting its OWN captured centre (v0.164/167)
    const dqp = { w: dq.w, x: dq.x, y: dq.y, z: dq.z };
    for (const tb of b.twins) {
      const m = mirrorQuat(dqp, tb.mask);
      const mq = new Quaternion(m.x, m.y, m.z, m.w);
      const mdp = mirrorDelta({ x: dp.x, y: dp.y, z: dp.z }, tb.mask);
      const off = tb.p0.clone().sub(tb.cpre).applyQuaternion(mq);
      const originT = new Vector3(tb.cpre.x + off.x + mdp.x, tb.cpre.y + off.y + mdp.y, tb.cpre.z + off.z + mdp.z);
      const qj = mq.clone().multiply(tb.q0);
      const tcomp = this.bp!.data.components[tb.j]!;
      tcomp.position = { x: originT.x, y: originT.y, z: -originT.z };
      const tUndo = this.rotUndo.get(tb.j);
      if (tUndo) {
        const tt = quatMul({ x: qj.x, y: qj.y, z: qj.z, w: qj.w }, tUndo);
        tcomp.orientation = this.legacy
          ? { w: tt.w, x: -tt.x, y: -tt.y, z: tt.z }
          : { w: tt.w, x: tt.x, y: tt.y, z: -tt.z };
      }
      for (const o of this.compRoots.get(tb.j) ?? []) {
        o.position.set(originT.x + this.moff.x, originT.y + this.moff.y, -originT.z + this.moff.z);
        o.quaternion.copy(qj);
      }
      this.onEdit?.(tb.j);
    }
    this.updateCoM();
    this.syncSubJoints();
    if (this.selCi === ci) this.paintSelection();
    this.onEdit?.(ci);
    this.invalidate();
  }

  /** synthetic gesture for pins + the future keyboard nudge (world VIEW
   *  axis, degrees): exercises the exact TGC writeback path (orbit + pose) */
  gizmoRotateViewDeg(axis: 'x' | 'y' | 'z', deg: number) {
    if (this.gizmoCi < 0) return;
    this.captureGesture(this.gizmoCi);
    const v = axis === 'x' ? new Vector3(1, 0, 0) : axis === 'y' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    this.gizmoProxy.quaternion.premultiply(new Quaternion().setFromAxisAngle(v, deg * DEG));
    this.gizmoWriteback();
  }
  gizmoTranslateView(ax: 'x' | 'y' | 'z', m: number) {
    if (this.gizmoCi < 0) return;
    this.captureGesture(this.gizmoCi);
    this.gizmoProxy.position[ax] += m;
    this.gizmoWriteback();
  }

  // -------------------------------------------------------------- editing

  /** live position ride: stand-in AND real-model siblings follow the file
   *  position (view z-flip); master parts ride their subgrids too. */
  moveComp(ci: number) {
    const c = this.bp?.data.components[ci];
    if (!c) return;
    for (const o of this.compRoots.get(ci) ?? [])
      o.position.set(c.position.x + this.moff.x, c.position.y + this.moff.y, -c.position.z + this.moff.z);
    this.updateCoM();
    this.syncSubJoints();                            // rigid master-riding (v0.172)
    if (this.selCi === ci) { this.paintSelection(); this.syncGizmo(); }
    this.invalidate();
  }

  /** inspector rotation sliders: absolute WORLD-axis degree deltas composed
   *  as q = qd·q0 (q0 captured by beginRotEdit when the inspector opens),
   *  Euler YXZ exactly like legacy liveRot. Writes the FILE quaternion
   *  (droop/junction display pose stripped through the build-time undo)
   *  into bp — the caller mirrors it into the doc. Returns it. */
  beginRotEdit(ci: number) {
    const o = this.compRoots.get(ci)?.[0];
    if (o) this.rotBase.set(ci, { q: { x: o.quaternion.x, y: o.quaternion.y, z: o.quaternion.z, w: o.quaternion.w } });
    // twin bases for the SLIDER session: each twin's display quaternion at
    // edit start — the mirrored delta is applied ABSOLUTELY (sliders write
    // qd·q0 for self, so twins get md·twinQ0, never accumulating)
    const bases = new Map<number, FileQuat>();
    for (const { j } of this.twinPairsFor(ci)) {
      const oj = (this.compRoots.get(j) ?? []).find(r => r.visible) ?? this.compRoots.get(j)?.[0];
      if (oj) bases.set(j, { w: oj.quaternion.w, x: oj.quaternion.x, y: oj.quaternion.y, z: oj.quaternion.z });
    }
    this.symRotBases.set(ci, bases);
  }
  setCompQuatDelta(ci: number, pitch: number, yaw: number, roll: number): FileQuat | null {
    const base = this.rotBase.get(ci);
    const undo = this.rotUndo.get(ci);
    if (!base || !undo || !this.bp) return null;
    const twins = this.twinPairsFor(ci);
    const dq = quatFromEulerYXZ(pitch * DEG, yaw * DEG, roll * DEG);
    const q = quatMul(dq, base.q);                   // qd·q0 (intrinsic-free world deltas)
    const t = quatMul(q, undo);                      // strip the display pose
    const file: FileQuat = this.legacy
      ? { w: t.w, x: -t.x, y: -t.y, z: t.z }
      : { w: t.w, x: t.x, y: t.y, z: -t.z };
    for (const o of this.compRoots.get(ci) ?? []) o.quaternion.set(q.x, q.y, q.z, q.w);
    this.bp.data.components[ci]!.orientation = file;
    // MIRROR-TWIN MOTION (v0.165/166): twins take md = det(S)·S·dq applied
    // ABSOLUTELY to their base pose at edit start — spin along a mirror
    // normal PRESERVED, tangential spins FLIP (both wheels roll together;
    // a steered pair yaws symmetrically; the red-axis stays correct)
    for (const { j, mask } of twins) {
      const b = this.symRotBases.get(ci)?.get(j);
      const tUndo = this.rotUndo.get(j);
      if (!b || !tUndo) continue;
      const md = mirrorQuat(dq, mask);
      const qj = quatMul(md, b);
      for (const o of this.compRoots.get(j) ?? []) o.quaternion.set(qj.x, qj.y, qj.z, qj.w);
      const tt = quatMul(qj, tUndo);
      this.bp.data.components[j]!.orientation = this.legacy
        ? { w: tt.w, x: -tt.x, y: -tt.y, z: tt.z }
        : { w: tt.w, x: tt.x, y: tt.y, z: -tt.z };
      this.onEdit?.(j);
    }
    this.syncSubJoints();
    if (this.selCi === ci) { this.paintSelection(); this.syncGizmo(); }
    this.invalidate();
    return file;
  }

  /** ⟲ reset: the caller has already restored bp+doc (edit.resetComponent);
   *  rebuild the display pose (fresh droop/junction rule + fresh undo) and
   *  ride proxy + real siblings onto it (v0.152: the view MUST repaint). */
  refreshComp(ci: number) {
    const c = this.bp?.data.components[ci];
    if (!c) return;
    const qFile = c.orientation ?? Q_ID;
    const qView = fileToViewQuat(qFile, this.legacy);
    const qDisp = displayQuat(c.type, qView, qFile);
    this.rotUndo.set(ci, qMul(qInv(qDisp), qView));
    this.rotBase.delete(ci);
    for (const o of this.compRoots.get(ci) ?? []) {
      o.position.set(c.position.x + this.moff.x, c.position.y + this.moff.y, -c.position.z + this.moff.z);
      o.quaternion.set(qDisp.x, qDisp.y, qDisp.z, qDisp.w);
    }
    this.syncSubJoints();
    if (this.selCi === ci) { this.paintSelection(); this.syncGizmo(); }
    this.invalidate();
  }

  /** data-field edits (the subgrid joint sliders land here via master parts) */
  dataEdited() { this.syncSubJoints(); this.invalidate(); }

  // ------------------------------------------------------------------ pick

  pickAt(clientX: number, clientY: number): PickHit {
    const c = this.renderer?.domElement as HTMLCanvasElement | null;
    if (!c) return (this.lastPick = { kind: 'none' });
    const rect = c.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return (this.lastPick = this.pickNdc(ndc));
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

  /** v0.169 routing: a SUBGRID wins over a component ONLY on VISIBLE content
   *  closer than any component; invisible nested-part proxies (world-invisible
   *  once the real model loads) route only when the ray hits NO component —
   *  you select what you can SEE. Blocks are informational (never select). */
  private pickNdc(ndc: Vector2): PickHit {
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects([this.root, this.subGroup], true);
    let firstComp: { d: number; ci: number; p: [number, number, number] } | null = null;
    let firstSubVis: { d: number; sub: number; p: [number, number, number] } | null = null;
    let firstSubAny: { d: number; sub: number; p: [number, number, number] } | null = null;
    let firstBlock: { d: number; p: [number, number, number] } | null = null;
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && !o.userData.kind) o = o.parent;
      const kind = o?.userData.kind as Kind | undefined;
      if (!kind) continue;
      const p: [number, number, number] = [h.point.x, h.point.y, h.point.z];
      if (kind === 'comp' && !firstComp) firstComp = { d: h.distance, ci: o!.userData.ci as number, p };
      else if (kind === 'sub') {
        const rec = { d: h.distance, sub: o!.userData.sub as number, p };
        if (!firstSubAny) firstSubAny = rec;
        if (!firstSubVis && worldVisible(h.object)) firstSubVis = rec;
      }
      else if (kind === 'block' && !firstBlock) firstBlock = { d: h.distance, p };
      if (firstComp && firstSubVis) break;
    }
    if (firstSubVis && (!firstComp || firstSubVis.d < firstComp.d))
      return { kind: 'sub', sub: firstSubVis.sub, point: firstSubVis.p };
    if (firstComp) return { kind: 'comp', ci: firstComp.ci, point: firstComp.p };
    if (firstSubAny) return { kind: 'sub', sub: firstSubAny.sub, point: firstSubAny.p };
    if (firstBlock) return { kind: 'block', point: firstBlock.p };
    return { kind: 'none' };
  }

  // ------------------------------------------------------------- reporting

  stats(): SceneStats {
    return {
      blocks: this.batch?.stats.blocks ?? 0,
      tris: this.batch?.stats.tris ?? 0,
      hullTris: this.batch?.stats.hullTris ?? 0,
      comps: this.compRoots.size,
      subs: this.subCount,
      draws: this.renderer?.info.render.calls ?? 0,
      ok: this.batch !== null && (this.batch.stats.blocks > 0 || this.batch.stats.hullTris > 0),
      tier: this.heavy ? 'lite' : 'full',
    };
  }

  get blueprint(): Blueprint | null { return this.bp; }

  /** re-run the whole load with the CURRENT bp (block/wire edits mutate bp
   *  outside the engine; the merged geometry is rebuilt wholesale) */
  reload() { if (this.bp) this.load(this.bp, this.realModelsOn ? this.atlasRef : null); }

  /** BLOCKS mode: raycast for the placement/select cell. Returns the hit
   *  block index (-1 for ground/other), the FILE-space point, and the cell
   *  adjacent to the hit face (where a new block would land). */
  pickCell(clientX: number, clientY: number):
    { bi: number; point: [number, number, number]; cell: [number, number, number] } | null {
    const c = this.renderer?.domElement as HTMLCanvasElement | null;
    if (!c || !this.bp) return null;
    const rect = c.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects([this.root, this.subGroup], true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && !o.userData.kind) o = o.parent;
      const kind = o?.userData.kind as Kind | undefined;
      if (kind !== 'block' && kind !== 'ground' && kind !== 'comp') continue;
      const px = h.point.x - this.moff.x, py = h.point.y - this.moff.y, pz = h.point.z - this.moff.z;
      const file: [number, number, number] = [px, py, -pz];
      const n = h.face
        ? new Vector3(h.face.normal.x, h.face.normal.y, -h.face.normal.z)
        : new Vector3(0, 1, 0);
      const CELLW = 0.25;
      const cell = [
        Math.floor((file[0] + n.x * CELLW * 0.6) / CELLW + 5.5),
        Math.floor((file[1] + n.y * CELLW * 0.6) / CELLW + 5.5),
        Math.floor((file[2] + n.z * CELLW * 0.6) / CELLW + 5.5),
      ] as [number, number, number];
      let bi = -1;
      if (kind === 'block') {
        // which merged block: containment test on the block cell ranges
        const cc = [file[0] / CELLW + 5.5 - 1e-6, file[1] / CELLW + 5.5 - 1e-6, file[2] / CELLW + 5.5 - 1e-6];
        const bl = this.bp.data.blocks;
        for (let i = 0; i < bl.length; i++) {
          const b = bl[i]!;
          if (b.type === 255) continue;
          const c0 = [((b.frame_x ?? 0) * 12 + b.pos_x), ((b.frame_y ?? 0) * 12 + b.pos_y), ((b.frame_z ?? 0) * 12 + b.pos_z)];
          if (cc[0]! >= c0[0]! && cc[0]! < c0[0]! + b.size_x + 1
            && cc[1]! >= c0[1]! && cc[1]! < c0[1]! + b.size_y + 1
            && cc[2]! >= c0[2]! && cc[2]! < c0[2]! + b.size_z + 1) { bi = i; break; }
        }
      }
      return { bi, point: file, cell };
    }
    return null;
  }
  get manifest() { return this.atlasRef?.manifest ?? null; }

  /** PLACE mode (KSP part pickup): the surface point under the cursor in
   *  FILE space — same view→file map as pickCell. Any visible hull/part/
   *  subgrid/ground surface counts; the point rides the face normal by a
   *  hair so the new part sits ON the surface it was clicked on. */
  pickPlacePoint(clientX: number, clientY: number): [number, number, number] | null {
    const c = this.renderer?.domElement as HTMLCanvasElement | null;
    if (!c || !this.bp) return null;
    const rect = c.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects([this.root, this.subGroup], true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && !o.userData.kind) o = o.parent;
      const kind = o?.userData.kind as Kind | undefined;
      if (kind !== 'block' && kind !== 'comp' && kind !== 'sub' && kind !== 'ground') continue;
      const n = h.face
        ? new Vector3(h.face.normal.x, h.face.normal.y, -h.face.normal.z)
        : new Vector3(0, 1, 0);
      const px = h.point.x + n.x * 0.01 - this.moff.x;
      const py = h.point.y + n.y * 0.01 - this.moff.y;
      const pz = h.point.z + n.z * 0.01 - this.moff.z;
      return [px, py, -pz];
    }
    return null;
  }
  /** test/UI hooks: world-ish VIEW pose (pre-moff, file-convention friendly) */
  compViewPos(ci: number): Vec3D | null {
    const c = this.bp?.data.components[ci];
    return c ? { x: c.position.x, y: c.position.y, z: c.position.z } : null;
  }
  subPose(bi: number): { p: [number, number, number]; quat: [number, number, number, number] } | null {
    const g = this.subGroups.get(bi);
    if (!g) return null;
    return {
      p: [g.position.x - this.moff.x, g.position.y - this.moff.y, g.position.z - this.moff.z],
      quat: [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w],
    };
  }
  subInfo(bi: number): { subn: number } | null {
    const g = this.subGroups.get(bi);
    return g ? { subn: g.userData.subn as number } : null;
  }
  get moffView(): Vec3D { return { ...this.moff }; }

  private disposeScene() {
    this.root.traverse(o => {
      const m = o as Mesh;
      // Engine-owned shared assets (unit box, cached materials) survive
      // load swaps — disposing them here would poison the next craft
      if (m.geometry && !this.shared.has(m.geometry)) m.geometry.dispose?.();
      const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => { if (!this.shared.has(x)) x.dispose(); });
      else if (mat && !this.shared.has(mat)) mat.dispose();
    });
    this.root.clear();
    this.subGroup.clear();
    this.subGroups.clear();
    this.subJrefs.clear();
    this.subCount = 0;
    this.compRoots.clear();
    this.rotUndo.clear();
    this.rotBase.clear();
    this.symRotBases.clear();
    this.gBase.clear();
    if (this.gizmo) { this.gizmo.detach(); this.gizmoCi = -1; }
    this.hullMeshes = [];
    this.wireLine = null;
    this.occMeshes = [];
    this.pipeMeshes = [];
    this.batch = null;
    this.hl.clearBoxes();
    this.hl.clearXray();
    this.selCi = this.selSub = -1;
  }

  dispose() {
    this.loadSeq++;                    // strand in-flight real-model loads
    this.disposeScene();
    this.renderer?.domElement.removeEventListener('webglcontextrestored', this.onRestore);
    this.unitBox.dispose();
    this.occ?.dispose();
    this.occ = null;
    this.hl.dispose();
    this.matCache.forEach(m => m.dispose());
    this.matCache.clear();
    this.gizmo?.dispose();
    this.gizmo = null;
    this.renderer?.dispose();
    this.renderer = null;
  }
}

// ---------- tiny quaternion helpers (plain objects, no THREE allocation) ----

interface Vector4like { x: number; y: number; z: number; w: number }
const quatFromEulerYXZ = (px: number, py: number, rz: number): Vector4like => {
  // THREE Euler order 'YXZ': intrinsic Y then X then Z → q = qy∘qx∘qz
  const c = (h: number) => Math.cos(h / 2), s = (h: number) => Math.sin(h / 2);
  const qy = { x: 0, y: s(py), z: 0, w: c(py) };
  const qx = { x: s(px), y: 0, z: 0, w: c(px) };
  const qz = { x: 0, y: 0, z: s(rz), w: c(rz) };
  return quatMul(qy, quatMul(qx, qz));
};
const quatMul = (a: Vector4like, b: Vector4like): Vector4like => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

/** world-visibility chain (legacy v0.169: an invisible proxy GROUP with a
 *  visible box inside still counts as world-INVISIBLE) */
function worldVisible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

// Bake the view z-mirror into a geometry: negative determinant flips the
// rasteriser's face selection, so swap the winding back (normals recomputed).
function flipWinding(gg: BufferGeometry) {
  const gi = gg.getIndex();
  if (gi) {
    const a = gi.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]!; a[i + 1] = a[i + 2]!; a[i + 2] = t; }
    gi.needsUpdate = true;
  }
  gg.computeVertexNormals();
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
