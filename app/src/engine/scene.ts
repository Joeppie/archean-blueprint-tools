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
  Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, Group, HemisphereLight, InstancedMesh,
  LineBasicMaterial, LineSegments, LinearSRGBColorSpace, Matrix3, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera, PerspectiveCamera,
  AdditiveBlending, BackSide, Plane, PlaneGeometry, PMREMGenerator, Quaternion, Raycaster,
  RepeatWrapping, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Texture, TextureLoader,
  TorusGeometry, Vector2, Vector3, WebGLRenderer,
  type Camera, type MeshStandardMaterialParameters,
} from 'three';
import backdropManifest from '../assets/backdrops/manifest.json';
import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPartBoxes, displayQuat, fileToViewQuat, occStandLocal, qMul, standInBox, type PartBox } from './compparts';
import type { FileQuat, Vec3D } from './format';
import type { LoadedModel, ModelAtlas, NodeRec } from './models';
import { droppedParts, unityBake } from './models';
import { buildAtlasPreview } from './thumbs';
import { envIntensity, nodeMaterialSpec, pbr, srgbHexToLinear, type PbrSpec } from './materials';
import { propellerSurface, type PropellerData } from './propeller';

/** The generated propeller blade's material: the client raytraces it as a
 *  neutral NON-metallic grey — `ReverseGamma(vec3(0.5))` in the shader, i.e.
 *  written in sRGB (dev propellerGeometry agrees). */
const PROP_GEN_SPEC: PbrSpec = { color: srgbHexToLinear(0x808080), metal: 0, rough: 0.65, opacity: 1 };
import { buildPipes, checkLeads, pipeAt, surgePaths, type PipeNetwork } from './pipes';
import { pipeLabel } from './wireops';
import { buildCompProxies, buildSolids, type ProxyBox, type SolidBatch } from './build';
import { hullVertex } from './hullfit';
import type { FilePalette } from './palette';
import type { Block, Blueprint, BlueprintComponent, Triangle } from './format';
import { CELL, CELLS_PER_FRAME, isLegacyFile } from './format';
import { getBlockEdges, getBlockFaces, getBlockPoints } from './blockshapes';
import { blockCells, blockMirrorTwin, cellOverlapSkip, mirrorBlockCell, mirrorAxisIdx,
  blockFromCell, rotateTypeAbout, rotatedBlock, setBlockGeom, type MirrorAxis, type PlaceSpec } from './blocks';
import { transformSkinTris } from './latsphere';
import { gridPlan, pxPerMeter } from './grid';
import {
  captureJrefs, eulerZYX, flattenComponents, jointNodeAxis, jointNodeSlide,
  masterJointState, subBlockBBox, subJointPose, subMasterEntries,
  type JRef, type SubBBox, type FlatEntry,
} from './subgrid';
import { pipeSockets } from './sockets';
import {
  compPaintDiff, craftMirrorMask, hasMirrorX, mirrorDelta, mirrorQuat, symAllowed,
  symTwinIndex, type TwinPair,
} from './sym';
import { massModel, type MassModel } from './mass';
import { Highlight } from './highlight';
import { flightReport } from './flight';
import { buildTunnel, createSolve, FLOWS, scanAnalysis, solveStep, streamlines,
  type ScanReport, type Solve, type Tunnel, type V3 as AeroV3 } from './aero';

/** a constrained subgrid joint handle (ring = angle master, arrow = slide) —
 *  the "UI at that place" (todo): you turn the HINGE, the panel rides */
interface HingeHandle {
  mesh: Mesh; kind: 'angle' | 'slide'; jref: JRef; ci: number; radius: number;
}

/** player-interactive components get a short floating label (legacy INTERACT);
 *  an in-game alias (components[].alias) always wins and renders in BLUE */
const INTERACT: Record<string, string> = {
  Dashboard: 'dash', PushButton: 'button', ToggleButton: 'toggle', ArrowButton: 'arrow',
  Keyboard: 'keyboard', Numpad: 'numpad', Led: 'led', Buzzer: 'buzzer', Beacon: 'beacon',
  NavInstrument: 'nav', MiniNavInstrument: 'nav', HudController: 'hud',
  PilotSeat: 'seat', ToiletSeat: 'toilet', OwnerPad: 'pad',
  Computer: 'computer', MiniComputer: 'computer', Volume: 'volume',
};

export interface PickHit {
  kind: 'block' | 'comp' | 'sub' | 'none';
  ci?: number; sub?: number; point?: [number, number, number];
}
export interface SceneStats { blocks: number; tris: number; hullTris: number; comps: number; subs: number; draws: number; ok: boolean;
  /** 'lite' = the heavy-craft tier (painted stand-ins, no real-model fan-out) */
  tier: 'full' | 'lite';
  /** scene rebuilds so far — an e2e mutation pin asserts this bumps, i.e.
   *  the edit actually REPAINTED the merged mesh (not just wrote the data) */
  loads: number }

/** renderer kinds carried in userData.kind (pick routes on these) */
type Kind = 'block' | 'wire' | 'occ' | 'pipe' | 'pipe-end' | 'comp' | 'sub' | 'ground';

export interface ViewOptions {
  grid: boolean; occ: boolean; hull: boolean; wire: boolean; pipes: boolean; subs: boolean;
  mirror: boolean; com: boolean;
  /** labels on interactive/aliased parts — OFF by default (legacy user rule:
   *  opt-in per session, NOT persisted) */
  labels: boolean;
}
export const DEFAULT_OPTS: ViewOptions = { grid: true, occ: false, hull: true, wire: false, pipes: true, subs: true, mirror: true, com: true, labels: false };

/** v1.9.2 SKY BACKDROPS (user: "The ground being solid and not se through is
 *  unacceptable … use an equi backdrop from a free site … mars and earth and
 *  none as options"; then "the backdrops sohuldnt be the entire planet, but a
 *  skybox+ground" and "it shouldnt orthographically project our skybox into
 *  being a cube"): SURFACE panoramas — real sky above, terrain below — drawn
 *  on a BackSide SPHERE DOME that rides the eye. NOT scene.background: three's
 *  orthographic background fakes a perspective direction field and corners
 *  the panorama into cube walls; geometry is projection-honest.
 *  v1.9.4 (we: "Add goegap call it desert, kloofendal… call it sky … Keep
 *  the images in their own folder, with attribution and a URL to them. Make
 *  the code enumerate them automatically when doing a build"): the set is
 *  MANIFEST-DRIVEN — every panorama lives in src/assets/backdrops next to
 *  manifest.json (name, source URL, author, license), vite enumerates the
 *  folder at BUILD time via import.meta.glob, and the View menu, the
 *  tooltips and the e2e pin all follow the manifest. Adding a backdrop =
 *  drop a 2:1 JPG + one manifest entry, no code (see that folder's
 *  README.md + NOTICE.md §2 for the attributions). 'none' = flat sky. */
export type Backdrop = string;              // 'none' or a manifest name
export interface BackdropMeta {
  name: string; file: string; source: string; author: string; license: string;
  note?: string;
}
const BACKDROP_FILE: Record<string, string> = import.meta.glob(
  '../assets/backdrops/*.jpg', { eager: true, query: '?url', import: 'default' });
export const BACKDROPS: readonly BackdropMeta[] = backdropManifest.backdrops;
/** every menu name, 'none' first — the View menu and the e2e pin enumerate
 *  THIS, so a new manifest entry appears without touching code */
export const backdropNames = (): string[] => ['none', ...BACKDROPS.map(b => b.name)];
/** the fresh-profile backdrop (v1.9.4, we: "make sky backdrop default") —
 *  a MANIFEST field, validated; an explicit stored pick always wins */
export const backdropDefault = (): string => {
  const d = (backdropManifest as { default?: string }).default;
  return d && backdropNames().includes(d) ? d : 'none';
};
const backdropUrl = (b: string): string | null => {
  if (b === 'none') return null;
  const m = BACKDROPS.find(x => x.name === b);
  return m ? BACKDROP_FILE[`../assets/backdrops/${m.file}`] ?? null : null;
};
const BACKDROP_KEY = 'archean-app-backdrop';
const ORTHO_KEY = 'archean-app-ortho';
const SKY_HEX = 0x8fb4d8;
/** the perspective vertical FOV — ONE constant, so the ortho ↔ persp
 *  framing swap (setProjection) round-trips exactly */
const PERSP_FOV = 55;

const DEG = Math.PI / 180;
const STAND_IN_HEX = 0x88aaff;          // legacy colliderProxy stand-in tint
const GOLD = 0xffc94d;                  // selection outline (legacy golden box)
const Q_ID: FileQuat = { w: 1, x: 0, y: 0, z: 0 };

/** a part's own .ini joint node + its captured BASE transform (the authored
 *  chain), so the data-driven joint pose re-applies from base on every edit */
interface JointPose {
  node: Group;
  /** .ini angular_x/y/z key (undefined = no angular joint) */
  axis?: 'x' | 'y' | 'z';
  /** .ini linear_x/y/z key (undefined = no slide) */
  slide?: 'x' | 'y' | 'z';
  /** THE PLATE LAW (v1.9.0, subgrid.jointNodeAxis): the node-local rotation
   *  axis whose WORLD line equals the subgrid PANEL's in-game-pinned axis
   *  R(q)·qAxle·ê — the raw .ini key inside the content basis is the v1.9
   *  rudder bug (plate rolls ⟂ panel). null = no angular joint. */
  axisV: Vector3 | null;
  /** THE PLATE LAW slide direction (world line = panel slide law). */
  slideV: Vector3 | null;
  baseP: Vector3;
  baseQ: Quaternion;
}
/** joint-state pose (data.angle DEGREES / data.pos metres — the same fields
 *  the panel/hinge UI write): ANGLE multiplies about the node origin (the
 *  Aileron flap rule, generalised to every type whose manifest carries a
 *  joints[0].axis), POS translates ALONG the slide. The directions are the
 *  PLATE-LAW vectors (JointPose.axisV/slideV) so the part's plate turns
 *  about the SAME world line as its subgrid panel — v1.9.0 THE PLATE LAW.
 *  Types without the field (Lamp/SpotLight whose angle = the light aim) are
 *  skipped. */
function applyJointPoses(jrefs: JointPose[], c: BlueprintComponent) {
  const d = c.data ?? {};
  const angle = typeof d['angle'] === 'number' ? (d['angle'] as number) : null;
  const pos = typeof d['pos'] === 'number' ? (d['pos'] as number) : null;
  for (const j of jrefs) {
    j.node.position.copy(j.baseP);
    j.node.quaternion.copy(j.baseQ);
    if (angle !== null && j.axisV)
      j.node.quaternion.multiply(new Quaternion().setFromAxisAngle(j.axisV, angle * DEG));
    if (pos !== null && j.slideV)
      j.node.position.addScaledVector(j.slideV, pos);
  }
}
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
  /** v1.9.2 DUAL PROJECTION (user: "under view also add a mode for
   *  orthogonal"): TWO cameras, ONE orbit rig — setProjection swaps
   *  controls.object / gizmo.camera and hands the SAME framing over (the
   *  ortho frustum inherits the perspective view height; back, the eye
   *  distance is re-derived from the ortho zoom). PERSP_FOV is the shared
   *  law, so the swap round-trips. Everything downstream (raycasts,
   *  project(), lookAt, fly glide) is projection-agnostic three.js. */
  private persp = new PerspectiveCamera(PERSP_FOV, 1, 0.05, 4000);
  private orthoCam = new OrthographicCamera(-1, 1, 1, -1, 0.05, 4000);
  private camera: PerspectiveCamera | OrthographicCamera = this.persp;
  private orthoOn = localStorage.getItem(ORTHO_KEY) === '1';
  /** v1.9.2 backdrop state: the flat sky colour of 'none', the engine-owned
   *  texture cache (NEVER disposed by a scene load), and the live choice
   *  (persisted — the mirror-axis precedent) */
  private skyColor = new Color(SKY_HEX);
  private backdropNow: Backdrop =
    backdropNames().includes(localStorage.getItem(BACKDROP_KEY) ?? '')
      ? (localStorage.getItem(BACKDROP_KEY) as Backdrop) : backdropDefault();
  private backdrops = new Map<Backdrop, Texture>();
  /** the panorama dome (lazy: only exists while a backdrop is shown) —
   *  engine-owned geometry, NEVER disposed by a scene load */
  private skyDome: Mesh | null = null;
  private skyDomeGeo: SphereGeometry | null = null;
  private skyDomeMat: MeshBasicMaterial | null = null;
  private controls: OrbitControls | null = null;
  private root = new Group();
  /** placed components (stand-in group + real-model sibling), keyed by ci */
  private compRoots = new Map<number, Object3D[]>();
  /** per-type LoadedModel of every real root currently in the scene — the
   *  cache liveDataEdit rebuilds from (no async refetch mid-slider-drag) */
  private liveGeo = new Map<string, LoadedModel>();
  /** writeback undo for the DISPLAY pose (junction flat / toggle yaw-180 /
   *  wheel droop on palette-bearing files): file quat = qView · undo (RAW
   *  product — no mirror since the v0.180 de-mirror), undo = dispQ0⁻¹·viewQ0
   *  captured at build — the legacy userData.wheelUndo right-multiplier, so
   *  inspector deltas applied on the LEFT (qd·q0) strip exactly
   *  (rawFromView parity). */
  private rotUndo = new Map<number, FileQuat>();
  private rotBase = new Map<number, { q: Vector4like }>();
  private batch: SolidBatch | null = null;
  private bp: Blueprint | null = null;
  private atlasRef: ModelAtlas | null = null;
  private needRender = false;
  private loadSeq = 0;                  // async real-model loads die with their load()
  private loadCount = 0;                // scene rebuilds so far (stats().loads —
                                        //  e2e proof a mutation repainted the mesh)
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
  /** ONE load-time hologram material + the count of real models still
   *  streaming (the uniform only breathes while that count > 0, so the
   *  on-demand render loop goes back to sleep once loading finishes) */
  private holo: ShaderMaterial | null = null;
  private holoPending = 0;

  // ---------- view-option groups (visibility targets) ----------
  private groundGroup = new Group();
  /** BLOCKS-place ghost preview (game constructor ghost): its own scene
   *  child (disposeScene never eats it), position = moff so raw-file child
   *  coords land at world; Editor re-aims it on every hover */
  private ghostGroup = new Group();
  private ghostSpec: (PlaceSpec & { valid: boolean; complement: boolean }) | null = null;
  /** v1.6 TOOLS ▸ Spheroid PLACEMENT ghost: a generated BLOCK CLUSTER (the
   *  dialog OK'd its material/colour/fill/size, THEN the spheroid appears as
   *  a translucent cluster you can MOVE like a block — same widget, CELL
   *  snap — while the viewport label offers ✕ Cancel / ✔ Build. Own scene
   *  child (disposeScene never eats it), children keep RAW-FILE metres. */
  private clusterGroup = new Group();
  private clusterBlocks: Block[] = [];
  /** v1.6.1: a TOOL skin placement (Spheroid ▸ SKIN) — hull TRIANGLES
   *  ghosted as flat translucent faces (a skin never "collides": skins
   *  overlap blocks by design, so a tri-only cluster is always valid) */
  private clusterTris: Triangle[] = [];
  /** v1.9 BALLOON: lattice point-sets (g coords) that RIDE the ghost's
   *  quarter-turns — the commit recovers the exact affine map from the
   *  probe tetrahedron and turns the tool's components/cables/subgrids
   *  with the skin. Not rendered, only carried. */
  private clusterRides: [number, number, number][][] = [];
  private clusterOffset: [number, number, number] = [0, 0, 0];
  /** v1.7.2: quarter-turns applied to the ghost since staging (⟲ buttons) */
  private clusterTurns = 0;
  private clusterHex = 0x7dffcf;
  private clusterValid = true;
  /** live widget gesture: the committed offset + the proxy centre at press */
  private clusterBase: { off: [number, number, number]; center: Vector3 } | null = null;
  /** BLOCKS-edit selection highlight (v1.4): a golden overlay on the picked
   *  block (+ its dim SIMILAR TWIN, identified regardless of ⇄) — the block
   *  analogue of the component outline. Own scene child at moff, like ghostGroup. */
  private blockHlGroup = new Group();
  private blockHlSpec: { bi: number; twin: number; issues: string[]; info: boolean } | null = null;
  /** bi|twin|geometry+paint fingerprint — the v1.6 staleness guard */
  private blockHlSig = '';
  /** 2026-10-20 TRIANGLE selection feedback: the selected hull triangle's prism
   *  glows GOLD + outlined (the "triangles refuse to select properly" fix —
   *  selecting one used to update the panel while the 3D view showed
   *  nothing). Own scene child at moff, like ghostGroup. */
  private triHlGroup = new Group();
  private triHlSpec = -1;
  /** CATALOG placement ghost (v1.4 box → v1.5.6 REAL MODEL): the held part
   *  rendered translucent at the hovered surface (+ the ⇄ mirrored twin), the
   *  component analogue of the block constructor ghost — "you should not just
   *  show the bounding box but the actual component as a ghost, so we can
   *  see how it would land and what it is". yaw = the smear-drag heading
   *  about the world ŷ (the part's BACK, +z, points along the drag — "drag
   *  towards where the back of it should be, like smearing on"). Own scene
   *  child at moff. */
  private compHlGroup = new Group();
  private compHlSpec: { type: string; point: [number, number, number]; yaw: number; mirror: boolean } | null = null;
  /** per-type translucent model templates shared by every ghost holder (the
   *  holders CLONE them — geometry/materials are never disposed per update) */
  private ghostCache = new Map<string, Group>();
  private ghostPending = new Set<string>();
  /** smear-drag state (v1.5.6): anchor = the last point the yaw was taken
   *  from; orbit controls are OFF while it lives (the gesture is the tool) */
  private placeDrag: { anchor: [number, number, number]; yaw: number } | null = null;
  private hullMeshes: Mesh[] = [];
  private wireLine: LineSegments | null = null;
  private occMeshes: Mesh[] = [];
  private pipeMeshes: Object3D[] = [];
  // ---- cable power-surge (legacy v0.14x): selecting a part sends a
  // travelling glow along every connected pipe; on arrival the far part
  // blips. Pulses/blips render additive with depthTest OFF — they shine
  // THROUGH the hull — and the on-demand loop wakes only while alive.
  private pipeNet: PipeNetwork = { segs: [], joints: [], plugs: [], ends: [], links: [],
    polys: [], radii: [], piOf: [], pipes: 0, stale: 0 };
  // ---- cable HOVER (v1.10.1, user: "on mouse-over of a cable, it should
  // tell us where things are going … propeller[9].lv <-> Computer[0].lv"):
  // the file pipe index under the cursor + a gold overlay riding its drawn
  // polyline. The flat list is kept from the last pipe build for the label.
  private pipeHoverPi = -1;
  private pipeHlGroup = new Group();
  private pipeHoverInfo: { pi: number; label: string } | null = null;
  private flatMap: FlatEntry[] = [];
  private surgeGroup = new Group();
  private surgeGeo = new SphereGeometry(0.055, 10, 8);
  private surges: { pts: Vector3[]; cum: number[]; total: number; to: number;
    mesh: Mesh; t0: number; dur: number }[] = [];
  private flashes: { grp: Group; mat: MeshBasicMaterial; color: number;
    t0: number; dur: number }[] = [];
  /** cumulative ARRIVAL blips (0x9fe0ff) since the current selection began —
   *  e2e-safe: pins never race the 620 ms live-flash window */
  private flashArrivals = 0;
  // ---- floating labels on interactive/aliased parts (legacy v0.15x):
  // sprites at the part's TOP, never parented to the part mesh (GPU
  // quads under a negative-determinant parent render MIRRORED text)
  private labels: { sp: Sprite; ci: number; dy: number }[] = [];
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
  /** v1.5.21 SETTABLE mirror axis (user: "mirror axes should be settable.
   *  Game is not hardcoded x."): the plane block twins, ⇄ twin placement and
   *  the overlay's SESSION sheet ride. Default x = the corpus convention. */
  private mirAxis: MirrorAxis =
    (['x', 'y', 'z'] as string[]).includes(localStorage.getItem('archean-app-mirror-axis') ?? '')
      ? (localStorage.getItem('archean-app-mirror-axis') as MirrorAxis) : 'x';
  /** the part boxes of the last load (re-sizes the mirror sheets on a
   *  mirror-axis change without a full reload) */
  private lastPartBoxes: PartBox[] = [];

  // ---------- adaptive ground grid (engine/grid.ts, v1.5.21) ----------
  private gridLines: LineSegments | null = null;
  private gridStepNow = 0;
  /** the build footprint the grid fits (FILE coords — groundGroup rides
   *  root's moff, so raw-file child coords land at world) */
  private gridBox: { cx: number; cz: number; hx: number; hz: number; yTop: number } | null = null;
  private gridY = 0;
  /** the ±X/±Z end labels of the pad axis markers (rebuilt with the grid) */
  private axisLabels: Sprite[] = [];

  // ---------- hover COORD READOUT (v1.5.23, replaces the v1.5.22 ruler) ---
  /** Blender-style: a black crosshair snaps onto the grid CORNER under the
   *  cursor (v1.5.24: the Shift vertical-grid experiment was REMOVED by the
   *  user — "Just remove this shift-grid"; the raytraced corner readout is
   *  what stays). COORDINATE LAW (FORMAT line 30, checked 2026-10-22): x lateral,
   *  y = UP, z longitudinal (nose = −z) — the flat plane is x–z, NOT x–y. */
  private coordGroup = new Group();
  private coordSnap: { x: number; y: number; z: number; step: number } | null = null;
  private coordHoverLast: { x: number; y: number } | null = null;


  // ---------- mass & CoM ----------
  private comMarker: Group | null = null;
  /** hi-def: the FULL game meshes (prim.v) instead of the decimated twins.
   *  THE DEFAULT since the user's v0.182 call (2026-10-19): the app used to
   *  default to the lv/li decimated twins, which read as "low poly" next to
   *  the legacy viewer's full meshes — the low-poly twins are now the OPT-IN
   *  (localStorage 'archean-app-hidef' = '0') for weak GPUs. */
  private hiDef = localStorage.getItem('archean-app-hidef') !== '0';
  private symRotBases = new Map<number, Map<number, FileQuat>>();     // ci → twin display quat at edit start

  // ---------- selection ----------
  lastPick: PickHit = { kind: 'none' };
  private selCi = -1;
  private selSub = -1;
  /** outline boxes (self + twins) + the incandescent X-ray overlay */
  private hl = new Highlight(this.scene);
  /** hover preview (wire-mode candidate lists): an ACCENT-coloured glow that
   *  rides beside the selection — leaving a hover never disturbs what the
   *  user is actually editing */
  private hoverHl = new Highlight(this.scene, 0x7dffcf);
  /** v1.8.0 UNIFORM MIRROR RULE: a mirror-conflicting FAUX-MIRROR twin gets a
   *  RED outline box (never silent gold) beside the golden selection */
  private warnHl = new Highlight(this.scene, 0xff4d4d);
  /** the selected component's conflicted twin pairs (red box + ⚠ popup) */
  private compWarn: { j: number; issues: string[]; info: boolean }[] = [];
  private hoverCi = -1;
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
  /** BLOCK widget (v1.5, user: "the gizmo doesnt show when selecting blocks
   *  … move arrows cell-snapped, rotation arrows that move in 90°
   *  increments"): the SAME TransformControls re-attached to the selected
   *  block. A block carries no free pos/quat (its `type` encodes shape +
   *  orientation and its footprint lives on the 0.25 m lattice), so the
   *  widget snaps TRANSLATION to whole lattice CELLS and ROTATION to quarter
   *  turns ALWAYS, and a gesture commits as a cell shift and/or N ×
   *  rotatedBlock turns — the discrete edits of the panel's cx/⟲X/Y/Z rows.
   *  mirror = the reported ⇄ state; v1.7.1: the block's SIMILAR TWIN
   *  (blockMirrorTwin) ALWAYS moves/turns in unison (mirrored) — ⇄ gates
   *  only twin PLACEMENT. -1 detaches. */
  private blockGizBi = -1;
  private blockGizMirror = false;
  /** gesture base: the block's cell + the proxy centre at mouseDown */
  private blockBase: { cell: [number, number, number]; center: Vector3 } | null = null;
  /** view options saved at a BLOCK-widget drag start (v1.8.1 wireframe hint) */
  private wireDragOpts: { hull: boolean; wire: boolean } | null = null;
  /** block-side writes (gizmo commits): the Editor mirrors the bp blocks into
   *  the raw doc + dirty + the debounced merged-hull reload (it owns the doc) */
  onBlockEdit: ((bis: number[]) => void) | null = null;

  attach(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    // devicePixelRatio floored at 1, capped 2.5 (legacy onResize rule)
    this.renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio, 1), 2.5));
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.invalidate());
    // v1.9.2 PERF (audit, viewperf.mjs): the DECORATION meshes (wire edges,
    // occupancy boxes, cable/pipe meshes + end dots) are drawn on LAYER 1.
    // The cameras enable that bit so they render, but every Raycaster
    // defaults to layer 0 ONLY — so all three pick scans (pickNdc, pickCell,
    // pickPlacePoint) stop raycasting them. Those kinds are never a legal
    // pick result anyway (the pick loops accept block/ground/comp/sub), and
    // three's Raycaster IGNORES visibility — on the giant craft the cable
    // and wire meshes were eating part of the measured 145 ms hover raycast
    // for hits every caller throws away.
    this.persp.layers.enable(1);
    this.orthoCam.layers.enable(1);
    // legacy lighting rig (view3d r0.178): sky blue, hemi fill, warm sun.
    // FOG DISABLED (user rule 2026-10-22: "that is harmful") — it washed
    // out the far side of large hulls: exactly the zeppelin-scale shapes
    // the Sphere skin tool produces, hiding what the user must judge.
    this.scene.background = this.skyColor;
    // a persisted SKY BACKDROP (View menu) re-applies here; the texture
    // cache is engine-owned, so it survives every scene load (v1.9.2)
    if (this.backdropNow !== 'none') this.setBackdrop(this.backdropNow);
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
      // v1.5.1 SECOND trap, same family: the MODE GATE (view mode → off) used
      // to persist this key, so merely closing a tab while in VIEW poisoned
      // every later session with a dead gizmo (user: "I DO NOT SEE the gizmo
      // … just the menu that allows me to select which gizmo SHOULD show").
      // The ⚙ gizmo row is therefore SESSION-only now (default ON); drop the
      // legacy key so an old poisoned value can never bite again.
      localStorage.removeItem('archean-app-gizmo');
      this.gizmoEnabled = true;
      // 'off' NEVER survives a load (v1.5.1 user report: "GIZMO DOES NOT SHOW
      // FOR EITHER BLOCKS OR COMPONENTS" — the modebox ⊘ persisted 'off' and
      // silently killed every widget in every mode forever). ⊘ is a SESSION
      // hide; the persisted master switch is the labeled ⚙ gizmo row.
      const m = localStorage.getItem('archean-app-gizmo-mode');
      this.gizmoMode = m === 'translate' || m === 'rotate' ? m : 'rotate';
      const listen = (t: string, f: (e: { value?: boolean }) => void) =>
        (g.addEventListener as unknown as (t: string, f: (e: { value?: boolean }) => void) => void)(t, f);
      listen('objectChange', () => {
        if (this.blockGizBi >= 0) this.blockGizmoDrag();
        else if (this.clusterBase) this.clusterGhostDrag();
        else this.gizmoWriteback();
      });
      listen('mouseDown', () => {
        if (this.blockGizBi >= 0) this.captureBlockGesture();
        else if (this.gizmoCi >= 0) this.captureGesture(this.gizmoCi);
        else if (this.clusterBlocks.length || this.clusterTris.length) this.captureClusterGesture();
      });
      listen('dragging-changed', e => {
        if (this.controls) this.controls.enabled = !e.value;
        if (!e.value) this.commitBlockGesture();          // no-op without a block gesture
        if (!e.value) this.commitClusterGesture();        // idem for a cluster gesture
      });
      this.scene.add(g.getHelper(), this.gizmoProxy);
      g.enabled = false;
      g.getHelper().visible = false;
    }
    this.scene.add(new HemisphereLight(0xcfe8ff, 0x444422, 1.1));
    this.scene.add(this.hingeGroup);
    this.hingeGroup.visible = false;
    canvas.addEventListener('pointerdown', this.onHingeDown, { capture: true });
    this.hingeCanvas = canvas;
    const sun = new DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(-6, 10, -4);
    this.scene.add(sun);
    this.surgeGroup.raycast = () => {};
    this.scene.add(this.root);
    this.root.add(this.pipeHlGroup);             // cable hover overlay rides moff WITH the cables
    this.pipeHlGroup.raycast = () => {};
    this.scene.add(this.subGroup);
    this.scene.add(this.surgeGroup);
    this.scene.add(this.ghostGroup);
    this.scene.add(this.coordGroup);             // hover coord readout (v1.5.23)
    this.scene.add(this.clusterGroup);
    this.scene.add(this.blockHlGroup);
    this.scene.add(this.triHlGroup);
    this.scene.add(this.compHlGroup);
    const loop = () => {
      this.controls?.update();                    // damping fires change→invalidate
      this.flushLiveEdits();                      // per-component geometry rebuilds (data sliders)
      this.stepFly();
      this.pulseSelection();
      this.stepHolo();
      this.stepSurges(performance.now());
      this.stepLabels();
      this.pumpWind();
      if (this.needRender && this.renderer) {
        this.needRender = false;
        this.rideSkyDome();                       // the sky follows the eye
        this.syncGrid();                          // zoom-adaptive cell + ruler ticks
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // a persisted ORTHO choice (View menu) restores BEFORE the first
    // resize/load fit, so the very first framing happens in the ortho
    // frustum (v1.9.2)
    this.applyProjection();
    this.resize();
  }

  resize() {
    const c = this.renderer?.domElement as HTMLCanvasElement | null;
    if (!c || !this.renderer) return;
    const w = c.clientWidth || 1, h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    // the ortho frustum keeps its VERTICAL view height; only the horizontal
    // half re-derives from the new aspect (OrbitControls wheels ortho via zoom)
    const o = this.orthoCam, halfH = (o.top - o.bottom) / 2;
    if (halfH > 0) {
      o.left = -halfH * (w / h); o.right = halfH * (w / h);
      o.updateProjectionMatrix();
    }
    this.hl.setResolution(w, h);                 // fat lines live in screen px
    this.hoverHl.setResolution(w, h);
    this.warnHl.setResolution(w, h);
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

  /** the LOAD-TIME paint for the occupancy boxes (the REAL volume each part
   *  reserves): a cool additive HOLOGRAM instead of opaque painted PBR — a
   *  fresnel rim + a faint face wash, no sun/env to blow out. The opaque
   *  periwinkle stand-ins flashed near-white while the real models streamed
   *  (user 2026-10-19: "a different colour or alpha that makes the loading
   *  feel cooler or snappier — possibly a really simple shader"). ONE
   *  material for every load box; uPulse breathes ONLY while real models
   *  are still streaming (see stepHolo), then freezes — the on-demand
   *  render loop never wakes for this once loading is done (PERF.md). */
  private holoMaterial(): ShaderMaterial {
    if (!this.holo) {
      this.holo = new ShaderMaterial({
        uniforms: { uColor: { value: new Color(0x5fd4ff) }, uPulse: { value: 1 } },
        transparent: true, depthWrite: false, blending: AdditiveBlending,
        vertexShader: /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`,
        fragmentShader: /* glsl */`
uniform vec3 uColor;
uniform float uPulse;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
  gl_FragColor = vec4(uColor * (0.22 + 1.15 * rim) * uPulse, 0.13 + 0.5 * rim);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      });
      this.shared.add(this.holo);
    }
    return this.holo;
  }

  /** hologram breath (0.82..1.10) while parts stream in — the ONLY wake the
   *  load boxes ever get; the last landing freezes uPulse at 1 and the
   *  on-demand loop sleeps again */
  private stepHolo() {
    const h = this.holo;
    if (!h || this.holoPending <= 0) return;
    h.uniforms.uPulse!.value = 0.82 + 0.28 * (0.5 + 0.5 * Math.sin(performance.now() / 320));
    this.invalidate();
  }

  // ------------------------------------------------------------------ load

  load(bp: Blueprint, atlas: ModelAtlas | null = null, keepView = false) {
    this.loadCount++;                   // stats().loads — mutation-repaint proof
    // A same-craft rebuild (⚙ decimated-twin swap, block edit) must keep the
    // camera + selection (user report v0.182: rebuilds "reset the view").
    // Only a craft swap re-frames. (The old "real models" toggle that forced
    // a rebuild here is REMOVED — see ensureRealSelected, v0.183 user rule.)
    const keep = keepView && !!this.bp && !!this.controls && !!this.camera;
    const camP = keep ? this.camera!.position.clone() : null;
    const camT = keep ? this.controls!.target.clone() : null;
    const selCi = this.selCi, selSub = this.selSub;
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
    // never touched (view-only). view == file frame (v0.180) → moff is raw.
    {
      const fs = bp.data.components;
      const min = (f: 'frame_x' | 'frame_y' | 'frame_z') =>
        fs.length ? Math.min(...fs.map(c => ((c[f] as number | undefined) ?? 0) | 0)) : 0;
      this.moff = { x: -3 * min('frame_x'), y: -3 * min('frame_y'), z: -3 * min('frame_z') };
      this.root.position.set(this.moff.x, this.moff.y, this.moff.z);
      this.subGroup.position.set(this.moff.x, this.moff.y, this.moff.z);
      this.ghostGroup.position.set(this.moff.x, this.moff.y, this.moff.z);
      this.blockHlGroup.position.set(this.moff.x, this.moff.y, this.moff.z);
      this.syncClusterGroupPos();
      this.triHlGroup.position.set(this.moff.x, this.moff.y, this.moff.z);
      this.compHlGroup.position.set(this.moff.x, this.moff.y, this.moff.z);
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
      wire.layers.set(1);                    // draw-only, never raycast (see attach)
      this.wireLine = wire;
      this.root.add(wire);
    }

    // occupancy (type-255) boxes: translucent, OFF, ONE shared unit box +
    // material scaled per mesh (a giant = 2 400 of these; see HEAVY comment).
    // THESE are the occupancy boxes — the same ProxyBox list also paints the
    // initial per-part stand-ins (buildComponents), so what a part sits ON at
    // load is exactly what the menu's transparent overlay shows (user
    // 2026-10-19: "the initial occupancy boxes do not match the actual
    // occupancy boxes" — the old stand-ins drew manifest COLLIDER boxes at
    // the part origin, off the reserved cells by half a cell (FluidPort) to
    // a metre (PilotSeat, SolarPanel) across ISW-241).
    const occMat = this.occMaterial();
    const proxies = buildCompProxies(bp);
    for (const box of proxies) {
      const m = new Mesh(this.unitBox, occMat);
      m.position.set(box.min.x + box.size.x / 2, box.min.y + box.size.y / 2, box.min.z + box.size.z / 2);
      m.scale.set(box.size.x, box.size.y, box.size.z);
      m.userData = { kind: 'occ', ci: box.ci };
      m.layers.set(1);                       // draw-only, never raycast (see attach)
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
    this.buildComponents(bp, this.heavy ? null : atlas, new Map(proxies.map(b => [b.ci, b])));
    this.buildSubgrids(bp);

    const parts = buildPartBoxes(bp, atlas?.manifest ?? null);
    this.updateCoM();
    this.addGround(bp, parts);
    this.buildMirrorPlane(parts);
    this.coordGroup.position.set(this.moff.x, this.moff.y, this.moff.z);
    this.coordHoverClear();      // readout re-arms on the next pointer move
    this.applyViewOptions();
    if (camP && camT) {                    // same-craft rebuild: camera stays put
      this.camera!.position.copy(camP);
      this.controls!.target.copy(camT);
      this.controls!.update();
    } else this.fit(parts);
    if (selCi >= 0) this.select(selCi);
    else if (selSub >= 0) this.selectSub(selSub);
    else this.select(-1);
    if (this.windOn) this.startTunnel();          // rebuild the tunnel on the fresh bp
    this.invalidate();
  }

  /** USER rule (v0.183): the SELECTED component always rides its REAL game
   *  model; everything else rides what the scene already shows. The old
   *  "real game models" checkbox (a full load() rebuild that reset the camera
   *  and nulled the manifest — mis-oriented stand-ins + a view reset, the
   *  v0.182 user report) is REMOVED with this rule: there is nothing to
   *  toggle, so there is nothing to reset. On the LITE tier (heavy craft)
   *  nothing streams at load, so selecting a part streams+builds JUST that
   *  part's real model on demand (the load fan-out is unchanged otherwise). */
  private ensureRealSelected(ci: number) {
    if (ci < 0 || !this.bp || !this.heavy || !this.atlasRef) return;
    const c = this.bp.data.components[ci];
    const roots = this.compRoots.get(ci);
    if (!c || c.type === 'Build' || !roots?.length) return;
    if (roots.some(o => (o.userData as { real?: boolean })?.real)) return;
    const seq = this.loadSeq;
    void this.atlasRef.geoFor(c.type).then(model => {
      if (!model || seq !== this.loadSeq || this.selCi !== ci) return;
      this.liveGeo.set(c.type, model);
      const g0 = roots[0]!;
      if (!g0.parent) return;
      const real = this.buildReal(c, model);
      real.position.copy(g0.position);
      real.quaternion.copy(g0.quaternion);
      Object.assign(real.userData, { kind: 'comp', ci, real: true });   // keep jrefs
      this.root.add(real);
      this.pushRoot(ci, real);
      g0.visible = false;                 // stand-in retires (kept for dispose symmetry)
      this.scene.updateMatrixWorld(true);
      if (this.selCi === ci) { this.paintSelection(); this.syncGizmo(); }
      this.invalidate();
    });
  }

  /** cables: merged CYLINDER/BOX bars + elbow spheres with the file's
   *  per-segment colours (XenonViewer buildPipes port — the game draws round
   *  hoses with a black collar at each end, item ducts are the only square
   *  species), the socket-plugs, and instanced connector endpoint markers
   *  (cyan = a-end, green = b-end, MeshBasic). Ends sit on the LIVE sockets
   *  when the cached route drifted (sockets.ts). */
  private buildPipesMesh(bp: Blueprint) {
    const flat = flattenComponents(bp);
    const net = buildPipes(bp.data.pipes, pipeSockets(bp.data.pipes, flat, this.atlasRef?.manifest ?? null));
    this.pipeNet = net;
    this.flatMap = flat;                          // cable labels resolve flat → top
    this.clearPipeHover();                        // net indices die with the rebuild
    this.clearSurges();                            // paths change on rebuild
    if (!net.segs.length) return;

    // unit templates (dev scene.js): cable = cylinder, box duct = 2r×L×2r,
    // elbow/plug caps = sphere/cylinder; one merged mesh per material pass
    const CYL = new CylinderGeometry(1, 1, 1, 14);
    const BOX = new BoxGeometry(2, 1, 2);
    const SPH = new SphereGeometry(1, 12, 8);
    const Y = new Vector3(0, 1, 0);
    const paintGeo = (g: BufferGeometry, c: readonly [number, number, number]) => {
      const n = g.attributes.position!.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set(c, i * 3);
      g.setAttribute('color', new BufferAttribute(col, 3));
      return g;
    };
    /** bar a→b of the unit template, dev barGeometry's compose exactly */
    const barGeo = (unit: 'cyl' | 'box', a: readonly number[], b: readonly number[], r: number) => {
      const dir = new Vector3(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
      const L = dir.length();
      if (L < 1e-6) return null;
      const g = (unit === 'box' ? BOX : CYL).clone();
      const q = new Quaternion().setFromUnitVectors(Y, dir.normalize());
      g.applyMatrix4(new Matrix4().compose(
        new Vector3((a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2), q,
        new Vector3(r, L, r)));
      return g;
    };
    const plain: BufferGeometry[] = [], metal: BufferGeometry[] = [];
    for (const s of net.segs) {
      const g = barGeo(s.box ? 'box' : 'cyl', s.a, s.b, s.half);
      if (g) (s.metal ? metal : plain).push(paintGeo(g, s.color));
    }
    for (const j of net.joints) {
      const g = SPH.clone();
      g.applyMatrix4(new Matrix4().makeScale(j.radius, j.radius, j.radius));
      g.translate(j.at[0], j.at[1], j.at[2]);
      plain.push(paintGeo(g, j.color));
    }
    const addMesh = (geos: BufferGeometry[], mat: MeshStandardMaterial, kind: Kind) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      if (!merged) return;
      merged.computeVertexNormals();               // dev: per-vertex normals
      const m = new Mesh(merged, mat);
      m.userData.kind = kind satisfies Kind;
      m.layers.set(1);                       // draw-only, never raycast (see attach)
      this.pipeMeshes.push(m);
      this.root.add(m);
    };
    const matPlain = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
    const matMetal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 1 });
    addMesh(plain, matPlain, 'pipe');
    addMesh(metal, matMetal, 'pipe');

    // the client's BLACK COLLARS at every cable end (not serialised in the
    // file — dev scene.js says so): short fat sleeves coaxial with the cable,
    // round like the hose, square for the box ducts
    const collar: BufferGeometry[] = [];
    for (const p of net.plugs) {
      const r = p.half * 1.8, h = Math.max(0.03, p.half * 3);
      const g = (p.box ? new BoxGeometry(2 * r, h, 2 * r) : new CylinderGeometry(r, r, h, 14)).clone();
      const dir = new Vector3(p.axis[0], p.axis[1], p.axis[2]);
      const q = new Quaternion().setFromUnitVectors(Y, dir);
      // hug the cable side: centre the collar INWARD from the tip
      g.applyMatrix4(new Matrix4().compose(
        new Vector3(p.at[0] - p.axis[0] * h * 0.35, p.at[1] - p.axis[1] * h * 0.35, p.at[2] - p.axis[2] * h * 0.35),
        q, new Vector3(1, 1, 1)));
      collar.push(g);
    }
    if (collar.length) {
      const merged = mergeGeometries(collar, false);
      collar.forEach(g => g.dispose());
      if (merged) {
        const m = new Mesh(merged, new MeshStandardMaterial({ color: 0x141419, roughness: 0.85, metalness: 0 }));
        m.userData.kind = 'pipe' satisfies Kind;
        m.layers.set(1);                     // draw-only, never raycast (see attach)
        this.pipeMeshes.push(m);
        this.root.add(m);
      }
    }

    const sph = new SphereGeometry(0.03, 8, 6);
    const mkEnds = (color: number, end: (e: (typeof net.ends)[number]) => readonly [number, number, number]) => {
      const im = new InstancedMesh(sph, new MeshBasicMaterial({ color }), net.ends.length);
      const m4 = new Matrix4();
      net.ends.forEach((e, i) => {
        const v = end(e);
        im.setMatrixAt(i, m4.makeTranslation(v[0], v[1], v[2]));
      });
      im.instanceMatrix.needsUpdate = true;
      im.userData.kind = 'pipe-end' satisfies Kind;
      im.layers.set(1);                      // draw-only, never raycast (see attach)
      this.pipeMeshes.push(im);
      this.root.add(im);
    };
    mkEnds(0x33ddff, e => e.a);
    mkEnds(0x33ff88, e => e.b);
  }

  /** Re-run ONLY the cable pass (no scene reload): a moved part's cached
   *  pipe route re-anchors to its live socket. Cheap enough to run on the
   *  Editor's edit-debounce — merges ≤ a few thousand short bars. */
  rebuildPipes() {
    if (!this.bp) return;
    for (const m of this.pipeMeshes) {
      m.traverse(o => {
        const mm = o as Mesh;
        if (mm.geometry && !this.shared.has(mm.geometry)) mm.geometry.dispose();
        const mat = mm.material as MeshStandardMaterial | undefined;
        if (mat && !this.shared.has(mat)) mat.dispose();
      });
      m.removeFromParent();
    }
    this.pipeMeshes = [];
    this.buildPipesMesh(this.bp);
    this.invalidate();
  }

  /** test hook: the live cable network summary (round vs square cross-
   *  sections, per-kind MAJORITY style, the socket-anchored ends). The
   *  per-kind sample is the corpus-majority segment, not the first: the
   *  first bar of a run is often the black sheath stub. */
  pipeInfo() {
    const net = this.pipeNet;
    interface Sample { n: number; cols: Map<string, number>; metal: number; box: number;
      radius: number; half: number }
    const per = new Map<string, Sample>();
    for (const s of net.segs) {
      let p = per.get(s.kind);
      if (!p) per.set(s.kind, p = { n: 0, cols: new Map(), metal: 0, box: 0,
        radius: s.radius, half: 0 });
      p.n++;
      p.half += s.half;
      const key = `${s.color[0]},${s.color[1]},${s.color[2]}`;
      p.cols.set(key, (p.cols.get(key) ?? 0) + 1);
      if (s.metal) p.metal++;
      if (s.box) p.box++;
    }
    const style: Record<string, { r: number; g: number; b: number; box: boolean;
      metal: boolean; radius: number; half: number }> = {};
    for (const [kind, p] of per) {
      const top = [...p.cols.entries()].sort((a, b) => b[1] - a[1])[0]![0].split(',').map(Number);
      style[kind] = {
        r: top[0]!, g: top[1]!, b: top[2]!,
        box: p.box * 2 > p.n, metal: p.metal > 0, radius: p.radius, half: p.half / p.n,
      };
    }
    return {
      pipes: net.pipes, segs: net.segs.length, joints: net.joints.length,
      plugs: net.plugs.length, stale: net.stale,
      round: net.segs.filter(s => !s.box).length,
      square: net.segs.filter(s => s.box).length,
      metal: net.segs.filter(s => s.metal).length,
      kinds: [...new Set(net.segs.map(s => s.kind))].sort(),
      style,
      leads: checkLeads(net),
      ends: net.ends.map(e => ({ a: [...e.a], b: [...e.b] })),
    };
  }

  // ---------- cable hover (v1.10.1) ----------

  /** HOVER A CABLE with the cursor (client px, throttled by the Viewport's
   *  pointer pass): the drawn polyline closest to the sight ray (pipes.ts
   *  pipeAt — the net lives in FILE coords, so the world ray is shifted by
   *  −moff first). Answers the file pipe index + the endpoint label
   *  ("Propeller[9].lowvoltage ↔ Computer[0].data_port.001") and gold-
   *  lights the cable; null (or a miss) clears it. */
  pipeHoverMove(clientX: number, clientY: number): { pi: number; label: string } | null {
    if (!this.bp || !this.renderer || !this.opts.pipes || !this.pipeNet.polys.length) {
      this.clearPipeHover();
      return null;
    }
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const mo = this.moffV();
    const hit = pipeAt(this.pipeNet,
      [ray.ray.origin.x - mo.x, ray.ray.origin.y - mo.y, ray.ray.origin.z - mo.z],
      [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z]);
    if (!hit) { this.clearPipeHover(); return null; }
    const pi = this.pipeNet.piOf[hit.i] ?? -1;
    if (pi < 0 || !this.bp.data.pipes?.[pi]) { this.clearPipeHover(); return null; }
    if (pi !== this.pipeHoverPi) this.applyPipeHover(pi);
    return this.pipeHoverInfo;
  }

  /** gold-light a cable from OUTSIDE the viewport (the WIRE panel's cable
   *  list hover): the same overlay, no raycast, no cursor chip. */
  setPipeHover(pi: number | null) {
    if (pi == null || pi < 0) { this.clearPipeHover(); return; }
    if (pi !== this.pipeHoverPi) this.applyPipeHover(pi);
  }

  pipeHoverState(): { pi: number; label: string } | null { return this.pipeHoverInfo; }

  clearPipeHover() {
    if (this.pipeHoverPi < 0 && !this.pipeHoverInfo) return;
    this.pipeHoverPi = -1;
    this.pipeHoverInfo = null;
    this.clearGroup(this.pipeHlGroup);
    this.invalidate();
  }

  /** the overlay: gold additive bars + elbow knobs along the run's drawn
   *  polyline (additive + depthTest OFF — visible THROUGH the hull, the
   *  surge-material idiom), rebuilt only when the hovered cable changes. */
  private applyPipeHover(pi: number) {
    this.pipeHoverPi = pi;
    this.clearGroup(this.pipeHlGroup);
    const netIdx = this.pipeNet.piOf.indexOf(pi);
    const poly = netIdx >= 0 ? this.pipeNet.polys[netIdx] ?? null : null;
    if (!poly || poly.length < 2 || !this.bp) { this.pipeHoverInfo = null; return; }
    const half = (this.pipeNet.radii[netIdx] ?? 0.02) * 1.7 + 0.008;
    const mat = new MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.85,
      blending: AdditiveBlending, depthTest: false, depthWrite: false });
    const Y = new Vector3(0, 1, 0);
    for (let k = 1; k < poly.length; k++) {
      const a = poly[k - 1]!, b = poly[k]!;
      const dir = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const L = dir.length();
      if (L < 1e-6) continue;
      const bar = new Mesh(new CylinderGeometry(half, half, L, 8), mat);
      bar.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      bar.quaternion.setFromUnitVectors(Y, dir.normalize());
      this.pipeHlGroup.add(bar);
      const knob = new Mesh(new SphereGeometry(half * 1.15, 8, 6), mat);
      knob.position.set(b[0], b[1], b[2]);
      this.pipeHlGroup.add(knob);
    }
    this.pipeHlGroup.traverse(o => { o.renderOrder = 18; o.raycast = () => {}; o.layers.set(1); });
    this.pipeHoverInfo = { pi, label: pipeLabel(this.bp, pi, this.flatMap) ?? '' };
    this.invalidate();
  }

  /** client-space point at the middle of a cable's drawn path — what the
   *  e2e aims the mouse at to prove the hover label. */
  pipeScreenPoint(pi: number): { x: number; y: number } | null {
    const netIdx = this.pipeNet.piOf.indexOf(pi);
    const poly = netIdx >= 0 ? this.pipeNet.polys[netIdx] : undefined;
    if (!poly?.length || !this.renderer || !this.camera) return null;
    const mo = this.moffV();
    const mid = poly[Math.max(0, Math.floor(poly.length / 2) - 1)] ?? poly[0]!;
    const v = new Vector3(mid[0] + mo.x, mid[1] + mo.y, mid[2] + mo.z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** every non-Build component: a group at the DISPLAY pose — the painted
   *  OCCUPANCY box immediately, the real game model when it loads. The
   *  initial box is the part's OWN entry of the SAME ProxyBox list the
   *  translucent type-255 overlay draws (the menu's "occupancy boxes"),
   *  placed through qDisp⁻¹ (occStandLocal) so it covers exactly that cell
   *  volume, world-aligned like the overlay, yet rides the part's live
   *  moves under the group — and hides with it when the real model lands.
   *  (Was: manifest-collider boxes centred at the part origin — a DIFFERENT
   *  volume than the reserved cells; the C-basis it needed disappears with
   *  it. Parts with no occupancy record ride buildCompProxies' 0.3 m origin
   *  dot, exactly like the overlay does.) */
  private buildComponents(bp: Blueprint, atlas: ModelAtlas | null, proxies: Map<number, ProxyBox>) {
    const seq = this.loadSeq;
    bp.data.components.forEach((c, ci) => {
      if (c.type === 'Build') return;                        // construction-site ghost
      const qFile = c.orientation ?? Q_ID;
      const qView = fileToViewQuat(qFile);
      const qDisp = displayQuat(c.type, qView, qFile, this.legacy);
      const g = new Group();
      g.position.set(c.position.x + this.moff.x, c.position.y + this.moff.y, c.position.z + this.moff.z);
      g.quaternion.set(qDisp.x, qDisp.y, qDisp.z, qDisp.w);
      // no mirror root since v0.180: the display frame IS the file frame
      g.userData = { kind: 'comp', ci };
      // writeback undo (legacy wheelUndo semantics): undo = dispQ0⁻¹·viewQ0
      // (a PRODUCT, not an inverse — applyDisplayPose stores exactly this
      // right-multiplier), so file = qDisp · undo = the ORIGINAL view
      // quaternion (raw law v1.5.11) and slider deltas qd·qDisp strip to
      // qd·qView0.
      this.rotUndo.set(ci, qMul(qInv(qDisp), qView));
      this.root.add(g);
      this.pushRoot(ci, g);

      const pb = proxies.get(ci)!;
      // the load box IS the occupancy box, painted with the load hologram
      // (cool cyan fresnel — not opaque paint that reads white until the
      // real model lands)
      const stand = new Mesh(this.unitBox, this.holoMaterial());
      const sl = occStandLocal(
        [pb.min.x + pb.size.x / 2, pb.min.y + pb.size.y / 2, pb.min.z + pb.size.z / 2],
        [g.position.x, g.position.y, g.position.z], qDisp);
      stand.position.set(sl.pos[0]!, sl.pos[1]!, sl.pos[2]!);
      stand.quaternion.set(sl.quat.x, sl.quat.y, sl.quat.z, sl.quat.w);
      stand.scale.set(pb.size.x, pb.size.y, pb.size.z);   // shared unit box (geo count)
      g.add(stand);
      this.maybeLabel(c, ci, g);         // INTERACT type or an in-game alias

      if (!atlas) return;               // LITE tier (heavy craft): no fan-out
      this.holoPending++;               // hologram breathes until this lands
      void atlas.geoFor(c.type).then(model => {
        this.holoPending--;
        if (seq !== this.loadSeq || !model || !g.parent) return;   // stale/load-swapped
        this.liveGeo.set(c.type, model);
        const real = this.buildReal(c, model);
        real.position.copy(g.position);
        real.quaternion.copy(g.quaternion);
        // FIELDS, never a wholesale replace: buildReal stored userData.jrefs
        // (the live joint-pose handle) and a re-assignment SILENCED every
        // data.angle edit (v1.9.0 PLATE-LAW follow-up).
        Object.assign(real.userData, { kind: 'comp', ci, real: true });
        g.visible = false;               // stand-in retires (kept for dispose symmetry)
        this.root.add(real);
        this.pushRoot(ci, real);
        const lab = this.labels.find(l => l.ci === ci);   // labels ride the VISIBLE model
        if (lab) {
          real.updateWorldMatrix(true, false);
          const top = new Box3().setFromObject(real).max.y;
          lab.dy = top - real.position.y + 0.18;
          lab.sp.position.set(real.position.x, top + 0.18, real.position.z);
        }
        this.invalidate();
      });
    });
  }

  private pushRoot(ci: number, o: Object3D) {
    const lst = this.compRoots.get(ci);
    if (lst) lst.push(o); else this.compRoots.set(ci, [o]);
  }

  /** real game model: the .ini node tree over the raw glTF vertices, hung under
   *  the engine's PART-CONTENT BASIS C = Rx(−90) [file (x,y,z) → content
   *  (x,z,−y)] — XenonViewer's rule (its catalog node tables are C-transformed
   *  .ini chains over raw verts; FORMAT §Per-asset gltf VERTEX SPACE). The
   *  part's collider boxes live in THIS basis too (ISW local-box audit
   *  2026-10-19: dev content fits the manifest colliders untransformed, the
   *  pre-fix "file-frame" content was uniformly C-rotated from them).
   *  Decimated twins (lv/li) by default — the legacy "low" display look. */
  private buildReal(c: BlueprintComponent, model: LoadedModel, noRaycast = false): Group {
    const { geo, info } = model;
    // The Dashboard's geometry is GENERATED by the game from `data` (its
    // glTF is only the editor template) — XenonViewer buildDashboard port
    // (built in the shared frame directly, NOT under the content basis).
    // Units are CENTIMETRES: corner-pivoted board origin→(size_x/100,
    // size_y/100, 0.01), plane local X·Y normal +z, elements z 0.01..0.02,
    // colours 0..255 LINEAR with metallic/roughness read straight off 0..255
    // (NOT the blocks' 0..7 / 0|1 scales). Buttons = painted faceplates.
    if (c.type === 'Dashboard') return this.buildDashboard(c, model, noRaycast);
    const root = new Group();
    // engine content basis: node chain + raw glTF verts live under this
    const basis = new Group();
    basis.rotation.order = 'ZYX';
    basis.rotation.x = -Math.PI / 2;          // C: file (x,y,z) → content (x,z,−y)
    root.add(basis);
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
    const link = (n: NodeRec) => (nodes.get(n.parent ?? '') ?? basis).add(nodes.get(n.name)!);
    for (const n of [...info.joints, ...info.targets, ...info.renderables]) link(n);

    const drop = droppedParts(c);
    for (const r of info.renderables) {
      if (drop.has(r.name)) continue;
      const nd = geo[r.name];
      if (!nd) continue;
      const rg = nodes.get(r.name)!;
      // Propeller: the game GENERATES the blade surface from
      // data.blades/radius/width/twist/pitch (the gltf is a frozen 0.88 m
      // template) — swap the `prop` prims for the data-driven soup.
      const gen = c.type === 'Propeller' && r.name === 'prop'
        ? propellerSurface((c.data ?? {}) as PropellerData) : null;
      // the soup is authored Y-up (dev propellerGeometry in glTF space); the
      // atlas prims arrive engine-baked (C⁻¹) — speak the same space
      const prims = gen ? [{ material: 'prop', v: unityBake(gen.v), i: gen.i }] : nd.prims;
      const byMat = new Map<string, BufferGeometry[]>();
      for (const prim of prims) {
        const v = this.hiDef ? prim.v : (prim.lv ?? prim.v);   // decimated twins (the generated soup has none)
        const i = this.hiDef ? prim.i : (prim.li ?? prim.i);
        const gg = new BufferGeometry();
        gg.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
        gg.setIndex(i);
        gg.computeVertexNormals();
        // (de-mirror v0.180: baked text prims render RAW — the old
        // TEXT_MIRROR_X in-plane flip countered the removed world mirror)
        const arr = byMat.get(prim.material) ?? [];
        byMat.set(prim.material, [...arr, gg]);
      }
      for (const [mname, geos] of byMat) {
        const gg = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
        if (!gg) continue;
        // NO userData.kind on the child meshes: pick walks UP to the owning
        // group, whose userData carries {kind:'comp', ci}
        const spec = gen
          ? PROP_GEN_SPEC                                   // client raytracing grey (sRGB 0.5 in the shader)
          : nodeMaterialSpec(c, mname, info.materials, this.palette, this.legacy);
        const m = new Mesh(gg, this.mat(spec));
        rg.add(m);
      }
    }
    // JOINT-STATE pose on the part's OWN model (was: Aileron only): every
    // .ini joint node rides its master's data — data.angle in DEGREES about
    // the .ini angular axis, data.pos in metres along the linear axis. The
    // node's BASE transform stays untouched (it's the authored chain); the
    // pose multiplies on top (rotation about the node origin) so a data edit
    // re-applies from the same base — the live path in applyJointPoses.
    const jrefs: JointPose[] = [];
    for (const j of info.joints) {
      const node = nodes.get(j.name);
      if (!node) continue;
      // THE PLATE LAW (v1.9.0): the axle node sits under the
      // content basis C, so its LOCAL axes are NOT the panel's world lines.
      // Conjugate C out (subgrid.jointNodeAxis/Slide) so the part's plate
      // turns about the SAME axis the (in-game-pinned) panel law uses —
      // jointChain composes the identical eulerZYX(jn.rotation) baseQ.
      const rot = j.rotation ?? [0, 0, 0];
      const bq = eulerZYX(rot[0]!, rot[1]!, rot[2]!);
      jrefs.push({
        node, axis: j.axis, slide: j.slide,
        axisV: j.axis ? new Vector3(...jointNodeAxis(bq, j.axis)) : null,
        slideV: j.slide ? new Vector3(...jointNodeSlide(bq, j.slide)) : null,
        baseP: node.position.clone(), baseQ: node.quaternion.clone(),
      });
    }
    if (jrefs.length) applyJointPoses(jrefs, c);
    if (jrefs.length) (root.userData as { jrefs?: JointPose[] }).jrefs = jrefs;
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

  /** Label text: 5 px/cm monospace grid on a RAW canvas (de-mirror v0.180):
   *  the game authors dashboard text readable from the plate's +z face with
   *  a non-mirrored canvas (FORMAT §Chirality vs in-game truth — the game's
   *  own cockpit screenshots; the legacy pre-mirror only compensated our
   *  removed world mirror). The pixel pass lights glyphs in mainColor on
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
        // the dev's connector keeps its RAW glTF verts at (w/2,h/2,0) —
        // undo the atlas bake for this one glTF piece (the board/elements
        // are data-generated in the shared frame, unaffected)
        m.rotation.x = -Math.PI / 2;
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
      // the mast tip = the extreme body vertex along the model's DOMINANT
      // spread axis (baked Beacon: mast runs along +ẑ; reading max-Y would
      // land the lens on a base corner)
      let top: [number, number, number] | null = null;
      let ax = 0;
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      const verts: [number, number, number][] = [];
      for (const prim of nd.prims) {
        if (prim.material !== 'body') continue;
        // the tip MUST come from the SAME twin the render shows (full v vs
        // decimated lv): a full mast + lv-derived tip floated the lens off
        // the point (solo Beacon 9000003006 pair, 2026-10-19)
        const v = (this.hiDef ? prim.v : prim.lv) ?? prim.v;
        for (let k = 0; k + 2 < v.length; k += 3) {
          const p: [number, number, number] = [v[k]!, v[k + 1]!, v[k + 2]!];
          verts.push(p);
          for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a]!, p[a]!); mx[a] = Math.max(mx[a]!, p[a]!); }
        }
      }
      if (verts.length) {
        ax = [0, 1, 2].reduce((b, a) => (mx[a]! - mn[a]!) > (mx[b]! - mn[b]!) ? a : b, 0);
        top = verts.reduce((b, p) => (p[ax]! > b[ax]! ? p : b), verts[0]!);
      }
      if (!top) continue;
      // a discreet flush TIP light, not a balloon: the XenonViewer (game)
      // draws no lens at all (the flash is procedural), so the recognisability
      // sphere must stay small against the 0.25 m housing (user: beacon
      // "doesnt look like in XenonViewer", solo Beacon 9000003006)
      const lens = new Mesh(new SphereGeometry(0.04, 12, 10),
        new MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222 }));
      lens.material.envMapIntensity = 0;
      lens.position.set(top[0], top[1], top[2]);
      lens.position.setComponent(ax as 0 | 1 | 2, top[ax]! + 0.012);   // flush on the tip
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
      // v1.9 BALLOON fins: a triangle-only Build (the fin panels) renders
      // too — the dev reader carries nested `triangles` recursively, so
      // they are first-class subgrid content (FORMAT §Subgrids).
      const nestedTris = (c.data?.['triangles'] as Blueprint['data']['triangles'] | undefined) ?? [];
      if (c.type !== 'Build'
        || (!c.data?.['blocks'] && !nested.length && !nestedTris.length)) return;
      const g = new Group();
      g.userData = { kind: 'sub', sub: bi, subn: ++sn };
      this.subGroup.add(g);
      this.subGroups.set(bi, g);

      const blocks = (c.data?.['blocks'] as Blueprint['data']['blocks'] | undefined) ?? [];
      // blocks AND the nested hull skin through ONE colour-bucket pass
      // (buildSolids reads data.blocks + data.triangles + data.colors;
      // the nested triangles are parent-frame ABSOLUTE like the blocks)
      const solids = buildSolids({
        data: { blocks, triangles: nestedTris, colors: bp.data.colors ?? null },
      } as unknown as Blueprint);
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
        const q = displayQuat(sc.type, fileToViewQuat(sc.orientation ?? Q_ID), sc.orientation ?? Q_ID, this.legacy);
        bg.translate(box.center[0], box.center[1], box.center[2]);
        bg.rotateX(-Math.PI / 2);      // under content basis C (BAKED-FILE colliders)
        bg.applyMatrix4(new Matrix4().compose(
          new Vector3(sc.position.x, sc.position.y, sc.position.z),
          new Quaternion(q.x, q.y, q.z, q.w),
          new Vector3(1, 1, 1),
        ));   // no baked mirror since v0.180 — winding stays as authored
        const lst = merged.get(key);
        if (lst) lst.geos.push(bg); else merged.set(key, { spec, geos: [bg] });
      } : null;
      for (const sc of nested) {
        if (sc.type === 'Build') continue;
        if (mergeStands) { mergeStands(sc); continue; }   // heavy tier: merged paint
        const qFile = sc.orientation ?? Q_ID;
        const m = new Group();
        m.position.set(sc.position.x, sc.position.y, sc.position.z);
        const qDisp = displayQuat(sc.type, fileToViewQuat(qFile), qFile, this.legacy);
        m.quaternion.set(qDisp.x, qDisp.y, qDisp.z, qDisp.w);
        const box = standInBox(sc, manifest?.[sc.type]);
        const basis = new Group();               // colliders are BAKED-FILE frame
        basis.rotation.order = 'ZYX';
        basis.rotation.x = -Math.PI / 2;         // (same C law as buildComponents)
        m.add(basis);
        const stand = new Mesh(this.unitBox,
          this.sharedMat(nodeMaterialSpec(sc, 'color1', undefined, this.palette, this.legacy, STAND_IN_HEX)));
        stand.position.set(box.center[0], box.center[1], box.center[2]);
        stand.scale.set(box.size[0], box.size[1], box.size[2]);
        basis.add(stand);
        g.add(m);
        const mp = manifest?.[sc.type] ? this.atlasRef : null;
        if (mp && this.atlasRef) {
          const seq = this.loadSeq;
          void this.atlasRef.geoFor(sc.type).then(model => {
            if (seq !== this.loadSeq || !model || !g.children.includes(m)) return;
            this.liveGeo.set(sc.type, model);
            const real = this.buildReal(sc, model, true);
            real.position.copy(m.position);
            real.quaternion.copy(m.quaternion);
            Object.assign(real.userData, { real: true, noRaycast: true });   // keep jrefs
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
      this.subJrefs.set(bi, captureJrefs(masters.get(bi) ?? [], bb, manifest, c.orientation ?? null,
        [c.position.x, c.position.y, c.position.z]));
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
        jrefs.map(r => masterJointState(r.mc)));
      g.position.set(pose.p[0] + this.moff.x, pose.p[1] + this.moff.y, pose.p[2] + this.moff.z);
      g.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    }
    this.invalidate();
  }

  /** green ground + grid just under the lowest rendered geometry (ground=true:
   *  nothing of a craft renders below ground — part boxes may ride below the
   *  file box, the 3481322297 truck builds down to y=−1.5) */
  // ---------- wind tunnel (engine/aero.ts — the Archean shape-field model) ----------
  /** active tunnel + multigrid solve, stepped across frames (bounded cost) */
  private wind: { tun: Tunnel; solve: Solve } | null = null;
  private windOn = false;
  private windFlow: AeroV3 = [...FLOWS.nose!] as AeroV3;
  private windMesh: LineSegments | null = null;
  private windFrame = 0;
  private windReport: ScanReport | null = null;
  private windStats = { lines: 0, segments: 0, vMax: 0 };

  /** toggle / retarget the wind tunnel. `flow` is a FILE-space direction
   *  (FLOWS.nose = wind coming at the nose). The solve is progressive:
   *  preview streamlines appear within a few frames and refine as the
   *  multigrid converges (the wiki's bounded cost, metronomically paced
   *  inside the on-demand loop — never a synchronous freeze). */
  setWindTunnel(on: boolean, flow?: AeroV3) {
    if (flow) this.windFlow = [...flow] as AeroV3;
    this.windOn = on;
    if (!on) { this.clearWind(); this.invalidate(); return; }
    this.startTunnel();
  }

  private startTunnel() {
    this.clearWind();
    if (!this.bp) return;
    const tun = buildTunnel(this.bp, this.windFlow);
    if (!tun) return;
    this.wind = { tun, solve: createSolve(tun) };
    this.windReport = scanAnalysis(tun);
    this.invalidate();
  }

  /** per-frame solve slice + progressive streamline refresh */
  private pumpWind() {
    const w = this.wind;
    if (!w) return;
    if (w.solve.done && this.windMesh) return;
    if (this.windFrame++ % 2) return;
    const st = solveStep(w.solve, 3);
    if (st.done) {
      const sl = streamlines(w.solve);
      this.setWindLines(sl.positions, sl.colors);
      this.windStats = { lines: sl.lines, segments: sl.segments, vMax: sl.vMax };
      this.windReport = scanAnalysis(w.tun);
      this.invalidate();
      return;
    }
    // progressive: first preview lines at iter ≥ 6, refined every 18 sweeps
    if (w.solve.iters >= 6 && (w.solve.iters - 6) % 18 < 3) {
      const sl = streamlines(w.solve, this.windMesh ? undefined : 160);
      this.setWindLines(sl.positions, sl.colors);
      this.windStats = { lines: sl.lines, segments: sl.segments, vMax: sl.vMax };
      this.invalidate();
    }
  }

  private setWindLines(positions: Float32Array, colors: Float32Array) {
    this.clearWindMesh();
    if (!positions.length) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('color', new BufferAttribute(colors, 3));
    const m = new LineBasicMaterial({ vertexColors: true, transparent: true,
      opacity: 0.85, blending: AdditiveBlending, depthWrite: false });
    const mesh = new LineSegments(g, m);
    mesh.raycast = () => { };                     // never a pick target
    mesh.renderOrder = 990;
    mesh.userData.windlines = true;
    this.windMesh = mesh;
    this.root.add(mesh);
  }

  private clearWindMesh() {
    if (!this.windMesh) return;
    this.root.remove(this.windMesh);
    this.windMesh.geometry.dispose();
    (this.windMesh.material as MeshBasicMaterial).dispose();
    this.windMesh = null;
  }

  private clearWind() {
    this.wind = null;
    this.windReport = null;
    this.windStats = { lines: 0, segments: 0, vMax: 0 };
    this.clearWindMesh();
  }

  /** live wind-tunnel state (UI panel + e2e pins) */
  windState(): { on: boolean; running: boolean; converged: boolean; iters: number;
    res: number; lines: number; segments: number; vMax: number; voxel: number;
    solid: number; flow: AeroV3; report: ScanReport | null } {
    const w = this.wind;
    return {
      on: this.windOn,
      running: !!w && !w.solve.done,
      converged: !!w?.solve.converged,
      iters: w?.solve.iters ?? 0,
      res: w?.solve.res ?? 0,
      lines: this.windStats.lines,
      segments: this.windStats.segments,
      vMax: this.windStats.vMax,
      voxel: w?.tun.voxel ?? 0,
      solid: w?.tun.solidCount ?? 0,
      flow: [...this.windFlow] as AeroV3,
      report: this.windReport,
    };
  }

  /** The ground pad (v1.5.21): the green sheet AND the grid now FIT THE
   *  BUILD (the old fixed 28 m GridHelper patch drowned tiny crafts and
   *  vanished under the giant). The height rule is unchanged (the ground
   *  pin): just below the lowest rendered geometry, nothing of a craft
   *  renders below it. The grid lines themselves are zoom-adaptive —
   *  drawn by syncGrid() from engine/grid.ts's plan on every rendered
   *  frame whose step changed. */
  private addGround(bp: Blueprint, parts: PartBox[]) {
    let y = bp.box_min.y;
    let yTop = bp.box_max.y;
    let x0 = bp.box_min.x, x1 = bp.box_max.x, z0 = bp.box_min.z, z1 = bp.box_max.z;
    for (const p of parts) {
      y = Math.min(y, p.center[1] - p.size[1] / 2);
      yTop = Math.max(yTop, p.center[1] + p.size[1] / 2);
      x0 = Math.min(x0, p.center[0] - p.size[0] / 2); x1 = Math.max(x1, p.center[0] + p.size[0] / 2);
      z0 = Math.min(z0, p.center[2] - p.size[2] / 2); z1 = Math.max(z1, p.center[2] + p.size[2] / 2);
    }
    y -= 0.05;
    this.groundGroup = new Group();                  // fresh per load (dispose-safe)
    this.gridStepNow = 0;                            // force a grid rebuild on frame 1
    if (this.gridLines) { this.gridLines.geometry.dispose(); (this.gridLines.material as LineBasicMaterial).dispose(); this.gridLines = null; }
    this.gridY = y;
    this.gridBox = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2,
      hx: Math.max((x1 - x0) / 2, 2), hz: Math.max((z1 - z0) / 2, 2), yTop };
    const plane = new Mesh(new PlaneGeometry(this.gridPad(), this.gridPad()), this.flatMat(0x3d5a34));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(this.gridBox.cx, y, this.gridBox.cz);
    plane.userData.kind = 'ground' satisfies Kind;
    // THE PAD IS SEE-THROUGH NOW (v1.9.2 user rule: "The ground being solid
    // and not se through is unacceptable"): the OLD opaque green sheet ate
    // the sky and read as a billiard table under every craft. The mesh
    // stays (invisible) as the PICK PAD — three's Raycaster ignores
    // visibility, so the coord readout, the pad-plane fallback and the
    // ground-kind placement rules behave EXACTLY as before, and the
    // ground-height rule (just under the lowest geometry) is untouched.
    // What you SEE of the pad now is the grid lines + axis marks — over
    // whatever backdrop the View menu draws.
    plane.visible = false;
    this.groundGroup.add(plane);
    this.root.add(this.groundGroup);
  }
  /** the green sheet: covers the build comfortably, minimum 120 m patch */
  private gridPad(): number {
    const g = this.gridBox;
    return 2 * Math.max(60, g ? g.hx + 30 : 0, g ? g.hz + 30 : 0);
  }

  /** v1.5.21 ADAPTIVE GRID (user: "grid needs to fit build comfortably.
   *  Probably granularity depending on zoom 1x or 5, 10, depending"): the
   *  ladder is planned by engine/grid.ts from the projected px scale (1×,
   *  5×, 10× of the 0.25 m cell …) and the build footprint. Runs on every
   *  frame that ACTUALLY renders (orbit damping fires change→invalidate, so
   *  zoom is caught without timers); a frame whose chosen cell is unchanged
   *  pays only the plan's arithmetic. Lines ride the WORLD lattice (every
   *  k·step), so at the finest step the grid is exactly the block cell. */
  private syncGrid() {
    if (!this.gridBox || !this.controls || !this.renderer || !this.groundGroup.visible) return;
    const h = this.renderer.domElement.clientHeight || 1;
    const plan = gridPlan(this.gridBox.hx, this.gridBox.hz, this.pxPerM(h));
    if (plan.step === this.gridStepNow && this.gridLines) return;
    this.gridStepNow = plan.step;
    if (this.gridLines) {
      this.groundGroup.remove(this.gridLines);
      this.gridLines.geometry.dispose();
      (this.gridLines.material as LineBasicMaterial).dispose();
      this.gridLines = null;
    }
    const { step, halfX, halfZ } = plan;
    const { cx, cz } = this.gridBox, y = this.gridY + 0.002;
    const pos: number[] = [], col: number[] = [];
    const cMinor = new Color(0x2c4429), cMajor = new Color(0x41703c);
    const line = (ax: number, x: number, major: boolean) => {
      const c = major ? cMajor : cMinor;
      if (ax === 0) { pos.push(x, y, cz - halfZ, x, y, cz + halfZ); }
      else { pos.push(cx - halfX, y, x, cx + halfX, y, x); }
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    // whole-cell indices k with k·step inside the span; majors every 5th
    for (let k = Math.ceil((cx - halfX) / step); k * step <= cx + halfX; k++)
      line(0, k * step, ((k % 5) + 5) % 5 === 0);
    for (let k = Math.ceil((cz - halfZ) / step); k * step <= cz + halfZ; k++)
      line(1, k * step, ((k % 5) + 5) % 5 === 0);
    // WORLD-AXIS MARKERS ON THE PAD (v1.5.24, user: "I still need an
    // indicator IN THE GRID for the major axis lines to get an
    // understanding for X and Z, + and −"): Blender-style — the x = 0 and
    // z = 0 grid lines ride in FULL COLOUR (x-axis RED, z-axis BLUE — the
    // y-up file law, FORMAT line 30) across the whole visible span, with
    // +/− end labels.
    const axY = y + 0.0015;
    const cAxX = new Color(0xc23b3b), cAxZ = new Color(0x3b5fc2);
    pos.push(cx - halfX, axY, 0, cx + halfX, axY, 0);
    col.push(cAxX.r, cAxX.g, cAxX.b, cAxX.r, cAxX.g, cAxX.b);
    pos.push(0, axY, cz - halfZ, 0, axY, cz + halfZ);
    col.push(cAxZ.r, cAxZ.g, cAxZ.b, cAxZ.r, cAxZ.g, cAxZ.b);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    this.gridLines = new LineSegments(geo,
      new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    this.groundGroup.add(this.gridLines);
    // +/− end labels for the two axis lines
    for (const l of this.axisLabels) { l.material.map?.dispose(); l.material.dispose(); this.groundGroup.remove(l); }
    const lbl = (t: string, css: string, lx: number, lz: number) => {
      const sp = this.makeAxisLabel(t, css);
      sp.position.set(lx, y + 0.03, lz);
      this.groundGroup.add(sp);
      return sp;
    };
    const maj = step * 5;
    const inX = Math.max(cx + halfX - maj, cx), inZ = Math.max(cz + halfZ - maj, cz);
    this.axisLabels = [
      lbl('+x', '#ff8080', inX, 0), lbl('\u2212x', '#ff8080', Math.min(cx - halfX + maj, cx), 0),
      lbl('+z', '#8ab0ff', 0, inZ), lbl('\u2212z', '#8ab0ff', 0, Math.min(cz - halfZ + maj, cz)),
    ];
    // the hover COORD READOUT snaps on the SAME ladder: a rung change
    // re-snaps a live readout (its step field rides to the chip)
    if (this.coordSnap && plan.step !== this.coordSnap.step) {
      const c = this.coordHoverLast;
      if (c) this.coordHoverMove(c.x, c.y);
    }
  }
  /** live grid plan for the pins (testid hook __ARCHEAN__.grid()): the
   *  chosen cell + the covered half-spans in file coords */
  /** the current pad axis-marker labels (pin hook axis()) */
  axisMarks(): string[] { return this.axisLabels.map(l => l.userData.t as string); }
  /** small BLACK-chip label in a fixed colour for the axis ends */
  private makeAxisLabel(text: string, css: string): Sprite {
    const cv = document.createElement('canvas');
    const ctx0 = cv.getContext('2d')!;
    ctx0.font = 'bold 40px monospace';
    const w = Math.max(56, Math.ceil(ctx0.measureText(text).width) + 20);
    cv.width = w; cv.height = 52;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = 'rgba(8,12,16,0.78)';
    ctx.fillRect(0, 0, w, 52);
    ctx.font = 'bold 40px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = css;
    ctx.fillText(text, 10, 28);
    const sp = new Sprite(new SpriteMaterial({
      map: new CanvasTexture(cv), depthTest: false, transparent: true }));
    sp.scale.set(w / 52 * 0.26, 0.26, 1);
    sp.renderOrder = 10;
    sp.raycast = () => {};
    sp.userData = { t: text };
    return sp;
  }
  gridInfo(): { step: number; major: number; halfX: number; halfZ: number; cx: number; cz: number; y: number } | null {
    if (!this.gridBox) return null;
    const h = this.renderer?.domElement.clientHeight || 1;
    const plan = gridPlan(this.gridBox.hx, this.gridBox.hz, this.pxPerM(h));
    return { step: this.gridStepNow || plan.step, major: plan.step * 5,
      halfX: plan.halfX, halfZ: plan.halfZ, cx: this.gridBox.cx, cz: this.gridBox.cz, y: this.gridY };
  }

  // ------------------------------------------------ hover COORD READOUT
  /** Blender-style grid-corner readout (v1.5.23, user: "a small black label
   *  to indicate grid position on the corners of the displayed grid under
   *  cursor … for a ad-hoc vertical grid also black to be visible only when
   *  pressing shift, that is the most coplanar for our horizontal grid
   *  (either x or z) … so that when pressing shift, you can also see
   *  coordinates for that, and get the full x-y-z of a chosen location").
   *  Convention (checked, FORMAT §world maths): x lateral, y UP, z
   *  longitudinal (nose = −z) — the FLAT plane is x–z. Returns the snapped
   *  file-space point for the black chip, or null when the ray misses the
   *  pad. The vertical plane is the one most parallel to the screen: the
   *  normal (x̂ or ẑ) whose |camera-view component| is LARGER. */
  coordHoverMove(clientX: number, clientY: number)
    : { x: number; y: number; z: number; step: number } | null {
    const g = this.gridBox;
    if (!g || !this.renderer) { this.coordHoverClear(); return null; }
    const step = this.gridStepNow || 0.25;
    const snap = (v: number) => Math.round(v / step) * step;
    // RAYTRACE WHAT LANDS ON (user v1.5.24): pickCell answers the first
    // VISIBLE surface under the cursor — block face, part, subgrid, the
    // ground — in raw FILE metres (wireframe stays click-through, matching
    // what you see). Off-craft/horizon misses fall back to the pad plane.
    const hit = this.pickCell(clientX, clientY);
    let fx: number, fy: number, fz: number;
    if (hit) {
      fx = hit.point[0]!; fy = hit.point[1]!; fz = hit.point[2]!;
    } else {
      const r = this.renderer.domElement.getBoundingClientRect();
      const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1,
        -((clientY - r.top) / r.height) * 2 + 1);
      const ray = new Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const mo = this.moffV();
      const p = new Vector3();
      const pad = new Plane(new Vector3(0, 1, 0), -(this.gridY + mo.y));
      if (!ray.ray.intersectPlane(pad, p)) { this.coordHoverClear(); return null; }
      fx = p.x - mo.x; fy = this.gridY; fz = p.z - mo.z;
    }
    const sx = snap(fx), sy = snap(fy), sz = snap(fz);
    const prev = this.coordSnap;
    const info = { x: sx, y: sy, z: sz, step };
    this.coordSnap = info;
    this.coordHoverLast = { x: clientX, y: clientY };
    if (!prev || prev.x !== sx || prev.y !== sy || prev.z !== sz || prev.step !== step)
      this.buildCoordMarks(info);
    return info;
  }

  coordHoverState() { return this.coordSnap; }
  coordHoverClear() {
    this.coordSnap = null;
    this.coordHoverLast = null;
    this.clearGroup(this.coordGroup);
  }
  /** dispose helper for the readout group */
  private clearGroup(grp: Group) {
    for (const o of [...grp.children]) {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      (m.material as MeshBasicMaterial)?.dispose?.();
      grp.remove(o);
    }
  }
  /** BLACK marks (v1.5.24 full 3D): the corner crosshair on the pad AND a
   *  pin at the measured point — a black 3-D cross at the snapped (x, y, z)
   *  with a thin connector down to the pad, so the height reads in place. */
  private buildCoordMarks(info: { x: number; y: number; z: number; step: number }) {
    this.clearGroup(this.coordGroup);
    const arm = Math.max(info.step * 0.9, 0.12);
    const cMajor = new Color(0x000000);
    const pos: number[] = [], col: number[] = [];
    const seg = (a: [number, number, number], b: [number, number, number], c: Color) => {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    seg([info.x - arm, this.gridY + 0.003, info.z], [info.x + arm, this.gridY + 0.003, info.z], cMajor);
    seg([info.x, this.gridY + 0.003, info.z - arm], [info.x, this.gridY + 0.003, info.z + arm], cMajor);
    if (info.y > this.gridY + 1e-6) {
      const m = Math.max(info.step * 0.6, 0.09);
      seg([info.x, this.gridY, info.z], [info.x, info.y, info.z], new Color(0x30343a));
      seg([info.x - m, info.y, info.z], [info.x + m, info.y, info.z], cMajor);
      seg([info.x, info.y - m, info.z], [info.x, info.y + m, info.z], cMajor);
      seg([info.x, info.y, info.z - m], [info.x, info.y, info.z + m], cMajor);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    const lines = new LineSegments(geo, new LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
    lines.renderOrder = 31;
    lines.raycast = () => {};
    this.coordGroup.add(lines);
  }

  /** legacy fit: d = max(1.85r, 3.6), eye (0.6d, max(.34d,1.4), .72d) (fog off;
   *  frames over the UNION of file box, built solids and part boxes,
   *  so geometry that rides outside the file bbox still frames (whole craft).
   *  All in ANCHORED coords (moff shifts the rendered groups; frame with it). */
  private fit(parts: PartBox[]) {
    const bp = this.bp!;
    const mn = [bp.box_min.x, bp.box_min.y, bp.box_min.z];
    const mx = [bp.box_max.x, bp.box_max.y, bp.box_max.z];
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
    // (persp.aspect tracks the canvas shape for BOTH projections, v1.9.2)
    const d = this.persp.aspect < 1 ? d0 / Math.max(this.persp.aspect, 0.4) : d0;
    this.controls?.target.copy(c);
    this.camera.position.set(c.x + d * 0.6, c.y + Math.max(d * 0.34, 1.4), c.z - d * 0.72);
    this.persp.near = this.orthoCam.near = Math.max(0.05, r / 400);
    this.persp.far = this.orthoCam.far = Math.max(300, r * 10);
    this.frameC = c.clone(); this.frameD = d;      // presets ride this framing
    this.camera.lookAt(c);
    // ORTHO FRAMING (v1.9.2): the same fit distance owns the view height —
    // the portrait aspect pullback rides d, so a phone-framed craft fits
    // the ortho sheet exactly like the perspective one
    if (this.orthoOn) {
      this.orthoCam.zoom = 1;
      this.setOrthoFrustum(Math.max(d, 0.1) * Math.tan((PERSP_FOV * DEG) / 2), this.persp.aspect);
      this.gridStepNow = 0;
    }
    this.controls?.update();
  }

  // ------------------------------------------------------------ view options

  setOption(key: keyof ViewOptions, on: boolean) {
    this.opts = { ...this.opts, [key]: on };
    if ((key === 'hull' && on && this.opts.wire) || (key === 'wire' && on && this.opts.hull))
      this.opts = { ...this.opts, [key === 'hull' ? 'wire' : 'hull']: false };   // mutually exclusive (legacy)
    this.applyViewOptions();
    if (key === 'grid' && on) this.gridStepNow = 0;   // re-draw the pad on re-enable
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
    for (const l of this.labels) l.sp.visible = this.opts.labels;
  }
  getOptions(): ViewOptions { return { ...this.opts }; }

  // ---------- symmetry twins ----------

  setSymOn(on: boolean) {
    this.symOn = on;
    localStorage.setItem('archean-app-sym', on ? '1' : '0');
    this.paintSelection();
    this.invalidate();
  }
  symState(): { on: boolean; mirrorX: boolean; axes: MirrorAxis[]; active: boolean } {
    const mask = craftMirrorMask(this.bp?.data.components ?? [], this.symIdx);
    return {
      on: this.symOn,
      mirrorX: hasMirrorX(this.symIdx),
      axes: (['x', 'y', 'z'] as MirrorAxis[]).filter(a => (mask & (1 << mirrorAxisIdx(a))) !== 0),
      active: this.selCi >= 0 && this.twinPairsFor(this.selCi).length > 0,
    };
  }
  /** v1.5.21 SETTABLE MIRROR AXIS (⚙ row): the SESSION plane for ⇄ twin
   *  placement and block twin identity. The game is not hardcoded x — the
   *  per-component `mirrorAxis` field and non-x twin pairs are additionally
   *  detected and sheeted by buildMirrorPlane. */
  setMirrorAxis(a: MirrorAxis) {
    if (a === this.mirAxis) return;
    this.mirAxis = a;
    localStorage.setItem('archean-app-mirror-axis', a);
    this.buildMirrorPlane(this.lastPartBoxes);
    this.invalidate();
  }
  get mirrorAxis(): MirrorAxis { return this.mirAxis; }
  /** live pairs that PROPAGATE for comp i, while the pair is still aligned
   *  (drift > 5 cm auto-disables — a drifted pair is a FAUX-MIRROR: red ⚠,
   *  no propagation). v1.8.0 UNIFORM MIRROR RULE (user: the rule applies to
   *  components and to color/material/rotation too, ALWAYS): the ⇄ widget
   *  toggle never gates propagation — symOn is indicator state only. */
  private twinPairsFor(ci: number): TwinPair[] {
    return symAllowed(this.symIdx, true, this.bp?.data.components ?? [], ci);
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
      this.liveDataEdit(j);                       // the twin's own joint node rides too
    }
  }
  onDataEdit: ((ci: number, key: string) => void) | null = null;

  // ---------- mass & CoM ----------

  /** the orange CoM marker (sphere + equator ring) at the RAW-space centre of
   *  mass, displayed through the view mirror (physics itself is file-space).
   *  v1.7.1: the GAME's mass model (engine/mass.ts) — hull skin, struts,
   *  beams, tank fluids and subgrid content all ride the marker live. */
  private updateCoM(): MassModel | null {
    if (!this.bp) return null;
    const mm = massModel(this.bp, this.atlasRef?.manifest ?? null);
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
    this.comMarker.position.set(mm.com[0] + this.moff.x, mm.com[1] + this.moff.y, mm.com[2] + this.moff.z);
    this.comMarker.visible = this.opts.com && mm.total > 0;
    return mm;
  }
  flightReportData() {
    // lazy import avoided: flight.ts is cheap and pure — direct
    return this.bp ? flightReport(this.bp, this.atlasRef?.manifest ?? null) : null;
  }
    massReport(): (MassModel & { comVisible: boolean }) | null {
    const mm = this.updateCoM();
    return mm ? { ...mm, comVisible: this.opts.com } : null;
  }
  setHiDef(on: boolean) {
    if (on === this.hiDef || !this.bp) return;
    this.hiDef = on;
    localStorage.setItem('archean-app-hidef', on ? '1' : '0');
    this.load(this.bp, this.atlasRef, true);   // rebuild the meshes, keep camera
  }
  get hiDefOn() { return this.hiDef; }

  /** v1.5.21 MIRROR SHEETS (was the x-only sheet): one gold plane per axis
   *  the craft mirrors on — the geometric twin-pair masks ∪ per-component
   *  `mirrorAxis` fields (craftMirrorMask, the legacy viewer's mask ∪
   *  mirrorAxis precedent) ∪ the SESSION axis (⚙ row, so the plane you
   *  BUILD against is visible while placing the twin). Each sheet sits at
   *  FILE coord 0 on its axis (the dev viewer's scale[mirrorAxis−1] = −1
   *  mirrors about 0); the session axis's sheet is solid gold, purely
   *  detected ones are faint. */
  private buildMirrorPlane(parts: PartBox[]) {
    this.lastPartBoxes = parts;
    if (this.mirrorPlane) {
      this.root.remove(this.mirrorPlane);
      this.mirrorPlane.traverse(o => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        (m.material as MeshStandardMaterial)?.dispose?.();
      });
      this.mirrorPlane = null;
    }
    const bp = this.bp;
    if (!bp) return;
    const mask = craftMirrorMask(bp.data.components, this.symIdx) | (1 << mirrorAxisIdx(this.mirAxis));
    const lo = [bp.box_min.x, bp.box_min.y, bp.box_min.z];
    const hi = [bp.box_max.x, bp.box_max.y, bp.box_max.z];
    for (const p of parts)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k]!, p.center[k]! - p.size[k]! / 2);
        hi[k] = Math.max(hi[k]!, p.center[k]! + p.size[k]! / 2);
      }
    for (let k = 0; k < 3; k++)
      if (!isFinite(lo[k]!) || !isFinite(hi[k]!)) { lo[k] = -4; hi[k] = 4; }
    const span = (ax: number) => Math.max(hi[ax]! - lo[ax]!, 1) * 1.15;
    const mid = (ax: number) => (hi[ax]! + lo[ax]!) / 2;
    const g = new Group();
    for (let a = 0; a < 3; a++) {
      if (!(mask & (1 << a))) continue;
      const session = a === mirrorAxisIdx(this.mirAxis);
      let rotX = 0, rotY = 0, w = 0, h = 0;
      if (a === 0) { rotY = Math.PI / 2; w = span(2); h = span(1); }      // normal x: width z, height y
      else if (a === 1) { rotX = -Math.PI / 2; w = span(0); h = span(2); } // normal y: width x, height z
      else { w = span(0); h = span(1); }                                   // normal z: width x, height y
      const s = new Group();
      s.rotation.set(rotX, rotY, 0);
      s.position.set(a === 0 ? 0 : mid(0), a === 1 ? 0 : mid(1), a === 2 ? 0 : mid(2));
      const sheet = new Mesh(new PlaneGeometry(w, h),
        new MeshStandardMaterial({ color: 0xffc94d, transparent: true, opacity: session ? 0.10 : 0.05,
          roughness: 1, side: DoubleSide, depthWrite: false }));
      sheet.material.envMapIntensity = 0;
      const edges = new LineSegments(new BufferGeometry().setFromPoints([
        new Vector3(-w / 2, -h / 2, 0), new Vector3(w / 2, -h / 2, 0),
        new Vector3(w / 2, h / 2, 0), new Vector3(-w / 2, h / 2, 0), new Vector3(-w / 2, -h / 2, 0),
      ]), new LineBasicMaterial({ color: GOLD, transparent: true, opacity: session ? 0.6 : 0.3 }));
      s.add(sheet, edges);
      g.add(s);
    }
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

  /** live selection for pins (v1.5 view-lock pin: a VIEW-mode click must
   *  leave this at {-1,-1}) */
  selectionState(): { ci: number; sub: number } { return { ci: this.selCi, sub: this.selSub }; }

  select(ci: number) {
    this.selCi = ci;
    this.selSub = -1;
    this.ensureRealSelected(ci);        // the SELECTED part always rides its real model
    this.paintSelection();
    this.syncGizmo();
    this.buildHingeUI(-1);            // components own the TGC gizmo; hinge UI is for SUBGRIDS
    this.startSurges(ci);             // cable power-surge: fires on EVERY selection
    this.onSelection?.({ ci: this.selCi, sub: this.selSub });
    this.invalidate();
  }
  selectSub(bi: number) {
    this.selSub = bi;
    this.selCi = -1;
    this.clearSurges();
    this.paintSelection();
    this.syncGizmo();               // v0.170: subgrids get NO gizmo — they ride their masters
    this.buildHingeUI(bi);          // …but the joint line gets a constrained ring/arrow handle
    this.onSelection?.({ ci: this.selCi, sub: this.selSub });
    this.invalidate();
  }
  get selection() { return { ci: this.selCi, sub: this.selSub }; }

  /** list-hover preview: glow the VISIBLE roots of ci (boxes + x-ray).
   *  previewHover(-1)/clear restores the pure selection state. */
  previewHover(ci: number) {
    if (ci === this.hoverCi) return;
    this.hoverCi = ci;
    this.scene.updateMatrixWorld(true);
    if (ci < 0) { this.hoverHl.clearBoxes(); this.hoverHl.clearXray(); }
    else {
      const roots = this.compRoots.get(ci) ?? [];
      const vis = roots.filter(o => o.visible);
      const pick = vis.length ? vis : roots;
      this.hoverHl.setBoxes(pick);
      this.hoverHl.setXray(pick, 0.22);
    }
    this.invalidate();
  }

  get hoverActive(): number { return this.hoverCi; }

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
    // FAUX-MIRROR screen (v1.8.0): every INDEXED pair that does not ride the
    // selection — drifted off the mirror plane, or its PAINT differs — is a
    // mirror conflict: the twin gets the red box, and the popup names it.
    this.compWarn = [];
    const faux: Object3D[] = [];
    if (this.selCi >= 0 && this.bp) {
      const comps = this.bp.data.components;
      const live = new Set(this.twinPairsFor(this.selCi).map(p => p.j));
      for (const { j } of this.symIdx.get(this.selCi) ?? []) {
        const issues: string[] = [];
        if (!live.has(j)) issues.push('drift: pair off the mirror plane');
        const paint = compPaintDiff(comps[this.selCi]?.colors, comps[j]?.colors);
        issues.push(...paint);
        if (!issues.length) continue;
        // v1.8.1: a pair PAINTED apart is INFORMATIONAL (blue popup only, the
        // twin box stays gold); a drifted pair is a conflict (red) even with
        // a paint diff riding along.
        const info = paint.length > 0 && issues.length === paint.length;
        this.compWarn.push({ j, issues, info });
        if (info) continue;                       // blue popup only, no red box
        const rs = this.compRoots.get(j) ?? [];
        const v = rs.filter(o => o.visible);
        faux.push(...(v.length ? v : rs));
      }
    }
    if (faux.length) this.warnHl.setBoxes(faux);
    else this.warnHl.clearBoxes();
    this.hl.setBoxes([...self, ...twins]);
    this.hl.setXray(this.selCi >= 0 ? [...xray, ...twins] : []);
  }

  /** the selection breathes (legacy incandescent pulse): the on-demand loop
   *  wakes ONLY while a selection lives */
  private pulseSelection() {
    if (this.hl.pulse(performance.now())) this.needRender = true;
  }

  // ---------- cable power-surge + arrival blips (legacy startSurges) ----------

  /** source blip / arrival blip: an X-ray flash over the part's VISIBLE
   *  meshes, world-pinned (matrixWorld copy) into the surge layer — the
   *  part itself is not re-touched (x-ray overlays excluded). */
  private buildFlash(ci: number, color = 0x9fe0ff, dur = 620) {
    const roots = this.compRoots.get(ci);
    if (!roots?.length) return;
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.6,
      blending: AdditiveBlending, depthTest: false, depthWrite: false, side: DoubleSide });
    const grp = new Group();
    grp.raycast = () => {};
    const vis = roots.filter(o => o.visible);
    for (const o of vis.length ? vis : roots) o.traverse(x => {
      const m = x as Mesh;
      if (!m.isMesh || !m.visible || m.userData.noXray) return;
      m.updateWorldMatrix(true, false);
      const ov = new Mesh(m.geometry, mat);
      ov.matrixAutoUpdate = false;
      ov.matrix.copy(m.matrixWorld);
      ov.renderOrder = 16;
      ov.raycast = () => {};
      grp.add(ov);
    });
    this.scene.add(grp);
    this.flashes.push({ grp, mat, color, t0: performance.now(), dur });
    if (color === 0x9fe0ff) this.flashArrivals++;
  }

  /** selecting a component lights every cable it owns: a bolt travels the
   *  EXACT drawn polyline away from the picked socket; the far component
   *  blips on arrival. Degenerate runs never surge (surgePaths). */
  private startSurges(ci: number) {
    this.clearSurges();
    this.flashArrivals = 0;                    // arrivals count per selection
    if (!this.bp || ci < 0) return;
    this.buildFlash(ci, 0xffb347, 500);          // source blip: origin unmistakable
    for (const p of surgePaths(this.pipeNet, ci)) {
      const pts = p.pts.map(v => new Vector3(v[0]!, v[1]!, v[2]!));
      const mesh = new Mesh(this.surgeGeo, new MeshBasicMaterial({
        color: 0xaef3ff, transparent: true, opacity: 0.95,
        blending: AdditiveBlending, depthTest: false, depthWrite: false }));
      mesh.renderOrder = 17;
      mesh.raycast = () => {};
      mesh.position.copy(pts[0]!);
      this.surgeGroup.add(mesh);
      this.surges.push({ pts, cum: p.cum, total: p.total, to: p.to, mesh,
        t0: performance.now(), dur: Math.min(1600, Math.max(550, p.total * 300)) });
    }
    if (this.surges.length) this.invalidate();
  }

  /** the loop's surge ticker: lerp along the polyline, arrival blips, and the
   *  on-demand wake ONLY while an animation lives (perf rule) */
  private stepSurges(now: number) {
    if (!this.surges.length && !this.flashes.length) return;
    this.surges = this.surges.filter(s => {
      const u = (now - s.t0) / s.dur;
      if (u < 1) {
        let d = u * s.total, k = 1;
        while (k < s.cum.length - 1 && s.cum[k]! < d) k++;
        const t = (d - s.cum[k - 1]!) / Math.max(1e-6, s.cum[k]! - s.cum[k - 1]!);
        s.mesh.position.lerpVectors(s.pts[k - 1]!, s.pts[k]!, Math.min(1, Math.max(0, t)));
        return true;
      }
      s.mesh.removeFromParent();
      (s.mesh.material as MeshBasicMaterial).dispose();
      this.buildFlash(s.to);
      return false;
    });
    this.flashes = this.flashes.filter(f => {
      if (now - f.t0 < f.dur) {
        f.mat.opacity = 0.6 * Math.pow(1 - (now - f.t0) / f.dur, 2);
        return true;
      }
      this.scene.remove(f.grp);
      f.mat.dispose();
      return false;
    });
    this.needRender = true;
  }

  private clearSurges() {
    for (const s of this.surges) {
      s.mesh.removeFromParent();
      (s.mesh.material as MeshBasicMaterial).dispose();
    }
    this.surges = [];
    for (const f of this.flashes) {
      this.scene.remove(f.grp);
      f.mat.dispose();
    }
    this.flashes = [];
  }

  // ---------- floating labels ----------

  /** the legacy canvas chip: dark plate + monospace text, gold for an
   *  INTERACT type, BLUE for the player-authored alias (alias always wins) */
  private makeLabel(text: string, blue: boolean): Sprite {
    const cv = document.createElement('canvas');
    let ctx = cv.getContext('2d')!;
    ctx.font = 'bold 44px monospace';
    const w = Math.max(72, Math.ceil(ctx.measureText(text).width) + 28);
    cv.width = w;
    cv.height = 64;
    ctx = cv.getContext('2d')!;
    ctx.fillStyle = 'rgba(8,12,16,0.72)';
    ctx.fillRect(0, 0, w, 64);
    ctx.font = 'bold 44px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = blue ? '#7fd0ff' : '#ffd479';
    ctx.fillText(text, 14, 34);
    const sp = new Sprite(new SpriteMaterial({
      map: new CanvasTexture(cv), depthTest: false, transparent: true }));
    sp.scale.set(w / 64 * 0.3, 0.3, 1);
    sp.renderOrder = 10;
    sp.raycast = () => {};                       // labels are never pick targets
    return sp;
  }

  /** a label above an INTERACT/aliased part, riding its CURRENT top; the
   *  real model arrival re-measures dy (labels ride the VISIBLE model) */
  private maybeLabel(c: BlueprintComponent, ci: number, root: Group) {
    const alias = (c.alias ?? '').trim();
    const text = alias || INTERACT[c.type];
    if (!text) return;
    const sp = this.makeLabel(text, !!alias);
    root.updateWorldMatrix(true, false);
    const top = new Box3().setFromObject(root).max.y;
    sp.position.set(root.position.x, top + 0.18, root.position.z);
    sp.userData = { isLabel: true, ci };
    sp.visible = this.opts.labels;
    this.root.add(sp);
    this.labels.push({ sp, ci, dy: top - root.position.y + 0.18 });
  }

  /** labels follow dragged/moved parts every frame (legacy loop rule): they
   *  ride the VISIBLE root's position; no invalidate (movers already do) */
  private stepLabels() {
    if (!this.opts.labels || !this.labels.length) return;
    for (const l of this.labels) {
      const roots = this.compRoots.get(l.ci);
      if (!roots?.length) continue;
      const o = roots.find(r => r.visible) ?? roots[0]!;
      l.sp.position.set(o.position.x, o.position.y + l.dy, o.position.z);
    }
  }

  private clearLabels() {
    for (const { sp } of this.labels) {
      sp.removeFromParent();
      sp.material.map?.dispose();
      sp.material.dispose();
    }
    this.labels = [];
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
      k === 'fit' ? new Vector3(c.x + d * 0.6, c.y + Math.max(d * 0.34, 1.4), c.z - d * 0.72)
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

  // ------------------------------------------------- projection + backdrop
  /** active projection — the e2e pin hook */
  projection(): 'perspective' | 'orthographic' {
    return this.camera === this.orthoCam ? 'orthographic' : 'perspective';
  }
  /** eye + orbit target + the ortho zoom — the parallel-projection pins */
  viewState(): { proj: 'perspective' | 'orthographic'; eye: [number, number, number];
    target: [number, number, number]; zoom: number } {
    const p = this.camera.position, t = this.controls?.target ?? new Vector3();
    return { proj: this.projection(), eye: [p.x, p.y, p.z],
      target: [t.x, t.y, t.z], zoom: this.orthoCam.zoom };
  }
  /** View menu row: persist + swap the orbit rig's camera */
  setProjection(ortho: boolean) {
    if (ortho === this.orthoOn) return;
    this.orthoOn = ortho;
    localStorage.setItem(ORTHO_KEY, ortho ? '1' : '0');
    this.applyProjection();
  }
  /** THE FRAMING TRANSFER (v1.9.2): persp→ortho inherits the current view
   *  HEIGHT (d·tan(fov/2)); ortho→persp re-derives the eye distance from the
   *  ortho zoom. Both halves use PERSP_FOV, so a round-trip is exact.
   *  OrbitControls stores its camera as `object`, TransformControls exposes a
   *  proper `camera` setter — the ONE rig keeps its target and state. */
  private applyProjection() {
    const want = this.orthoOn ? this.orthoCam : this.persp;
    if (want === this.camera) return;
    const tgt = this.controls?.target ?? new Vector3();
    const c = this.renderer?.domElement as HTMLCanvasElement | null;
    const aspect = (c && c.clientHeight) ? c.clientWidth / c.clientHeight : 1;
    if (this.orthoOn) {
      const d = Math.max(this.persp.position.distanceTo(tgt), 0.1);
      const o = this.orthoCam;
      o.zoom = 1; o.near = this.persp.near; o.far = this.persp.far;
      this.setOrthoFrustum(d * Math.tan((PERSP_FOV * DEG) / 2), aspect);
      o.position.copy(this.persp.position);
      o.quaternion.copy(this.persp.quaternion);
    } else {
      const halfH = ((this.orthoCam.top - this.orthoCam.bottom) / 2) / this.orthoCam.zoom;
      const d = Math.max(halfH / Math.tan((PERSP_FOV * DEG) / 2), 0.1);
      const dir = this.orthoCam.position.clone().sub(tgt);
      if (dir.lengthSq() < 1e-9) dir.set(0.6, 0.34, -0.72);
      this.persp.position.copy(tgt).addScaledVector(dir.normalize(), d);
      this.persp.quaternion.copy(this.orthoCam.quaternion);
      this.persp.aspect = aspect;
      this.persp.updateProjectionMatrix();
    }
    want.updateMatrixWorld();
    this.camera = want;
    if (this.controls) { this.controls.object = want; this.controls.update(); }
    if (this.gizmo) this.gizmo.camera = want as Camera;
    this.gridStepNow = 0;                        // the px scale changed — re-plan
    if (this.coordSnap) this.coordHoverClear();  // a stale snapped chip never lies
    this.invalidate();
  }
  private setOrthoFrustum(halfH: number, aspect: number) {
    const o = this.orthoCam;
    o.top = halfH; o.bottom = -halfH;
    o.left = -halfH * aspect; o.right = halfH * aspect;
    o.updateProjectionMatrix();
  }
  /** screen px per world metre for the ACTIVE projection (grid ladder +
   *  coord snap): perspective rides the orbit distance, ortho the frustum
   *  height over the OrbitControls zoom. */
  private pxPerM(canvasH: number): number {
    if (this.camera === this.orthoCam)
      return (canvasH * this.orthoCam.zoom) / (this.orthoCam.top - this.orthoCam.bottom);
    const d = this.controls ? this.persp.position.distanceTo(this.controls.target) : 10;
    return pxPerMeter(canvasH, PERSP_FOV, d);
  }
  /** world → client px (both projections) — the ortho parallelism pin */
  screenPoint(x: number, y: number, z: number): [number, number] | null {
    const c = this.renderer?.domElement as HTMLCanvasElement | null;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const p = new Vector3(x + this.moff.x, y + this.moff.y, z + this.moff.z).project(this.camera);
    return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height];
  }
  /** THE PIXEL PROBE (e2e-only): force one fresh frame, then read the pixel
   *  at normalized canvas coords (u,v ∈ 0..1, v from the TOP) straight off
   *  the framebuffer. The see-through-ground and backdrop pins assert this —
   *  pixels, not intent (the v1.5.1 lesson). Legal without
   *  preserveDrawingBuffer because we read BEFORE returning to the event
   *  loop (the same task as the draw); three's readRenderTargetPixels
   *  refuses the default framebuffer in r186, so this goes through the
   *  raw context. */
  probePixel(u: number, v: number): [number, number, number] | null {
    const r = this.renderer;
    if (!r) return null;
    r.render(this.scene, this.camera);           // read BEFORE the buffer dies
    const w = r.domElement.width, h = r.domElement.height;
    const x = Math.min(Math.max(Math.floor(u * w), 0), w - 1);
    const y = Math.min(Math.max(Math.floor((1 - v) * h), 0), h - 1);
    const buf = new Uint8Array(4);
    try {
      const gl = r.getContext();
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    } catch { return null; }
    return [buf[0]!, buf[1]!, buf[2]!];
  }
  /** View menu row: swap the SKY DOME (v1.9.2). 'none' restores the flat
   *  sky colour; the panoramas load once and live in the engine cache. THE
   *  DOME IS GEOMETRY (BackSide sphere riding the eye), never
   *  scene.background — three's ortho background derives per-pixel view
   *  directions from the projection matrix and stretches the panorama into
   *  CUBE WALLS in ortho (user: "it shouldnt orthographically project our
   *  skybox into being a cube"); a sphere is honest in both projections. */
  setBackdrop(b: Backdrop) {
    this.backdropNow = b;
    localStorage.setItem(BACKDROP_KEY, b);
    const showDome = (tex: Texture | null) => {
      if (!tex) {
        if (this.skyDome) this.skyDome.visible = false;
        this.scene.background = this.skyColor;
        this.invalidate();
        return;
      }
      if (!this.skyDome) {
        const geo = this.skyDomeGeo = new SphereGeometry(1, 64, 40);
        const mat = this.skyDomeMat = new MeshBasicMaterial({
          side: BackSide, depthWrite: false,
          // background semantics: painted FIRST (renderOrder below), ignoring
          // depth — so it can never occlude grid lines or craft geometry
          // however far the user dollies, and needs no far-plane chasing
          depthTest: false,
        });
        const dome = this.skyDome = new Mesh(geo, mat);
        dome.renderOrder = -1000;              // always the first thing drawn
        dome.raycast = () => { };              // never a pick target…
        dome.layers.set(1);                    // …belt & braces (draw layer)
        this.scene.add(dome);
      }
      this.skyDomeMat!.map = tex;
      this.skyDomeMat!.needsUpdate = true;
      this.skyDome.visible = true;
      // the flat sky stays as the (never-seen) clear fallback mid-load
      this.scene.background = this.skyColor;
      this.rideSkyDome();
      this.invalidate();
    };
    if (b === 'none') { showDome(null); return; }
    const cached = this.backdrops.get(b);
    if (cached) { showDome(cached); return; }
    const url = backdropUrl(b);
    if (!url) return;
    new TextureLoader().load(url, (tex) => {
      tex.colorSpace = SRGBColorSpace;         // a photo, not albedo
      tex.wrapS = RepeatWrapping;              // the 0°/360° seam stays shut
      this.backdrops.set(b, tex);
      if (this.backdropNow === b) showDome(tex);
    });
  }
  /** the dome rides the EYE (a fixed modest radius suffices: depthTest false
   *  + renderOrder -1000 make it the first thing painted, and a sphere around
   *  the camera covers every ray in EITHER projection — perspective and
   *  orthographic alike see a dome, never the cube walls three's background
   *  shader fakes for an ortho camera) */
  private rideSkyDome() {
    const d = this.skyDome;
    if (!d || !d.visible) return;
    d.position.copy(this.camera.position);
    d.scale.setScalar(30);
  }
  /** live backdrop state — the e2e pin hook (ready = texture actually set;
   *  dome = the panorama is rendered as geometry right now) */
  backdropState(): { current: Backdrop; ready: boolean; dome: boolean } {
    return { current: this.backdropNow,
      ready: this.backdropNow === 'none' || this.backdrops.has(this.backdropNow),
      dome: this.skyDome?.visible === true };
  }
  /** PERF GAUGE (tools/viewperf.mjs): render n frames synchronously and
   *  return ms/frame. A 1-px readPixels at the end FLUSHES the GPU queue,
   *  so the number is the real frame cost — not rAF pacing (which caps at
   *  60 fps on a healthy machine and would hide every scenario delta). */
  timeRender(n: number): number {
    if (!this.renderer) return 0;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return (performance.now() - t0) / n;
  }


  // -------------------------------------------------------------- gizmo ops

  setGizmoEnabled(on: boolean) {
    this.gizmoEnabled = on;
    // NO localStorage write (v1.5.1): every caller includes the MODE GATE,
    // which flips this off in VIEW constantly — persisting it poisoned the
    // user's storage with a "chosen" off. The ⚙ row is a session toggle.
    this.syncGizmo();
    this.hingeGroup.visible = on && this.hingeHandles.length > 0;   // hinge UI is an EDIT-mode handle too
    this.invalidate();
  }
  setGizmoMode(m: 'off' | 'translate' | 'rotate') {
    this.gizmoMode = m;
    // 'off' is SESSION-only (v1.5.1): persist the last REAL mode so a reload
    // lands on a visible widget (⊘ hides now, never forever).
    if (m !== 'off') localStorage.setItem('archean-app-gizmo-mode', m);
    this.syncGizmo();
    this.invalidate();
  }
  /** Shift = 15° / 0.25 m snap (legacy) — shared by the TGC gizmo AND the hinge handles */
  setGizmoSnap(on: boolean) {
    this.snapOn = on;
    const g = this.gizmo;
    if (!g) return;
    g.setTranslationSnap(on ? 0.25 : null);
    g.setRotationSnap(on ? 15 * DEG : null);
  }
  gizmoState(): { mode: 'off' | 'translate' | 'rotate'; ci: number; shown: boolean } {
    const g = this.gizmo;
    return {
      mode: !this.gizmoEnabled || this.gizmoCi < 0 ? 'off' : this.gizmoMode, ci: this.gizmoCi,
      // v1.5.1: the ACTUAL widget visibility (helper on-screen), so pins
      // cannot pass on intent alone — the ⊘-persisted "no gizmo anywhere" trap
      shown: !!g && g.enabled === true && g.getHelper().visible === true,
    };
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
    if (!show) {
      g.detach(); g.enabled = false; g.getHelper().visible = false; this.gizmoCi = -1;
      this.syncBlockGizmo();                    // a SELECTED BLOCK may own the widget (v1.5)
      return;
    }
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
    // restore the COMPONENT snap contract (Shift 15° / 0.25 m — the BLOCK
    // widget always snaps CELL/90°, so re-attaching must undo its snap setup)
    g.setTranslationSnap(this.snapOn ? 0.25 : null);
    g.setRotationSnap(this.snapOn ? 15 * DEG : null);
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
        p0: new Vector3(t.position.x, t.position.y, t.position.z),
        cpre: this.gizmoCentre(j).sub(mo),                 // twin's OWN pivot (v0.167)
        q0: q ? new Quaternion(q.x, q.y, q.z, q.w) : new Quaternion(),
        q0p: q ? { w: q.w, x: q.x, y: q.y, z: q.z } : { ...Q_ID },
      };
    });
    this.gBase.set(ci, {
      p0: new Vector3(c.position.x, c.position.y, c.position.z),
      pp0: this.gizmo ? this.gizmoProxy.position.clone() : new Vector3(),
      q0: this.gizmo ? this.gizmoProxy.quaternion.clone() : new Quaternion(),
      twins,
    });
  }

  /** writeback (legacy applyGizmo* semantics): the gizmo's rigid motion
   *  X ↦ c + R·(X − c) + t orbits the FILE origin about the pivot, the proxy
   *  quaternion IS the new display pose, and the saved quaternion strips the
   *  display-pose undo (junction stays file-exact). */
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
    comp.position = { x: origin.x, y: origin.y, z: origin.z };
    const t = quatMul({ x: q.x, y: q.y, z: q.z, w: q.w }, undo);
    const fileQ: FileQuat = { w: t.w, x: t.x, y: t.y, z: t.z };   // one law (v1.5.11)
    comp.orientation = fileQ;
    for (const o of this.compRoots.get(ci) ?? []) {
      o.position.set(origin.x + this.moff.x, origin.y + this.moff.y, origin.z + this.moff.z);
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
      tcomp.position = { x: originT.x, y: originT.y, z: originT.z };
      const tUndo = this.rotUndo.get(tb.j);
      if (tUndo) {
        const tt = quatMul({ x: qj.x, y: qj.y, z: qj.z, w: qj.w }, tUndo);
        tcomp.orientation = { w: tt.w, x: tt.x, y: tt.y, z: tt.z };   // one law (v1.5.11)
      }
      for (const o of this.compRoots.get(tb.j) ?? []) {
        o.position.set(originT.x + this.moff.x, originT.y + this.moff.y, originT.z + this.moff.z);
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

  // -------------------------------------------------------- BLOCK widget
  /** Attach the constructor widget to a SELECTED BLOCK (the Edit mode's
   *  ✎ Edit flavor — the block analogue of the component gizmo). bi < 0 detaches. */
  setBlockGizmo(bi: number, mirror = false) {
    if (this.blockGizBi === bi && this.blockGizMirror === mirror) return;
    this.blockGizBi = bi;
    this.blockGizMirror = mirror;
    this.blockBase = null;
    this.syncGizmo();
    this.invalidate();
  }
  /** live state for the __ARCHEAN__ hook + pins: which block owns the widget
   *  and where its start cell currently is */
  blockGizmoState(): { bi: number; mode: 'off' | 'translate' | 'rotate';
    mirror: boolean; cell: [number, number, number]; shown: boolean } | null {
    const b = this.blockGizBi >= 0 && this.bp ? this.bp.data.blocks[this.blockGizBi] : undefined;
    if (!b) return null;
    const c = blockCells(b);
    const g = this.gizmo;
    return {
      bi: this.blockGizBi,
      mode: !this.gizmoEnabled || this.gizmoMode === 'off' ? 'off' : this.gizmoMode,
      mirror: this.blockGizMirror, cell: [c.x, c.y, c.z],
      // the widget is ACTUALLY on-screen AND attached to THIS block's proxy
      shown: !!g && g.enabled === true && g.getHelper().visible === true &&
        (g as unknown as { object?: unknown }).object === this.gizmoProxy,
    };
  }
  /** bbox CENTRE of a block in SCENE space (the overlay groups keep raw-file
   *  coords inside an moff-positioned parent — the proxy lives in world) */
  private blockCentre(b: Block): Vector3 {
    const c = blockCells(b);
    return new Vector3(
      (c.x + (b.size_x + 1) / 2 - 6) * CELL + this.moff.x,
      (c.y + (b.size_y + 1) / 2 - 6) * CELL + this.moff.y,
      (c.z + (b.size_z + 1) / 2 - 6) * CELL + this.moff.z);
  }
  /** (Re)attach the widget to the block: WORLD axes (the lattice is world-
   *  aligned) and CELL translation + QUARTER-TURN rotation snaps ALWAYS. */
  private syncBlockGizmo() {
    const g = this.gizmo;
    if (!g || this.gizmoCi >= 0) return;              // a component owns the widget
    const b = this.blockGizBi >= 0 && this.bp ? this.bp.data.blocks[this.blockGizBi] : undefined;
    if (!b || b.type === 255 || !this.gizmoEnabled || this.gizmoMode === 'off') {
      this.syncClusterGizmo();                        // v1.6: a placement cluster may own it
      return;
    }
    this.gizmoProxy.position.copy(this.blockCentre(b));
    this.gizmoProxy.quaternion.identity();
    g.attach(this.gizmoProxy);
    g.setMode(this.gizmoMode === 'translate' ? 'translate' : 'rotate');
    g.setSpace('world');
    g.setTranslationSnap(CELL);
    g.setRotationSnap(Math.PI / 2);
    g.enabled = true;
    g.getHelper().visible = true;
  }
  /** gesture base = the block's CURRENT cell + the freshly re-centred proxy,
   *  so multi-grip sweeps keep shifting from wherever the block now is */
  private captureBlockGesture() {
    const b = this.blockGizBi >= 0 && this.bp ? this.bp.data.blocks[this.blockGizBi] : undefined;
    if (!b) return;
    // v1.8.1 (user: "when moving blocks, wireframe must be visible for all
    // blocks"): the WHOLE hull goes wireframe for the gesture's duration
    this.showHullWireframe(true);
    const c = blockCells(b);
    this.blockBase = { cell: [c.x, c.y, c.z], center: this.gizmoProxy.position.clone() };
  }
  /** LIVE feedback while dragging: the golden highlight group RIDES the
   *  widget (orbits the block centre) — the merged solid catches up at the
   *  COMMIT rebuild, so the overlay is the drag ghost (same trick as the
   *  constructor ghost). The ⇄ twin overlay does not ride a one-block drag. */
  private blockGizmoDrag() {
    const base = this.blockBase;
    if (!base) return;
    const q = this.gizmoProxy.quaternion;
    const cFile = base.center.clone()
      .sub(new Vector3(this.moff.x, this.moff.y, this.moff.z));
    this.blockHlGroup.quaternion.copy(q);
    this.blockHlGroup.position.copy(
      this.gizmoProxy.position.clone().sub(cFile.applyQuaternion(q)));
    this.blockHlGroup.children.forEach((o, i) => { o.visible = i < 2; });
    this.invalidate();
  }
  /** DROP = COMMIT: a whole-cell shift (translate) or an N×90° turn (rotate)
   *  about the dominant world axis of the gesture quaternion. A colliding
   *  footprint REFUSES the gesture (the widget snaps back — the red-ghost
   *  contract). Both are the panel's discrete edits, driven by the widget. */
  private commitBlockGesture() {
    this.showHullWireframe(false);            // solids come back at the commit
    const base = this.blockBase;
    this.blockBase = null;
    if (!base) return;
    if (this.gizmoMode === 'translate') {
      const d = this.gizmoProxy.position.clone().sub(base.center);
      this.blockGizmoShift([Math.round(d.x / CELL), Math.round(d.y / CELL), Math.round(d.z / CELL)]);
    } else {
      const q = this.gizmoProxy.quaternion;
      const s2 = Math.sqrt(Math.max(0, 1 - q.w * q.w));
      if (s2 > 1e-6) {
        const ax: [number, number, number] = [q.x / s2, q.y / s2, q.z / s2];
        const dom = ax[0] * ax[0] >= ax[1] * ax[1] && ax[0] * ax[0] >= ax[2] * ax[2] ? 0
          : ax[1] * ax[1] >= ax[2] * ax[2] ? 1 : 2;
        const dir = ax[dom] >= 0 ? 1 : -1;
        const n = Math.round(dir * 2 * Math.acos(Math.max(-1, Math.min(1, q.w))) / (Math.PI / 2));
        if (((n % 4) + 4) % 4 !== 0) this.blockGizmoRotate((['x', 'y', 'z'] as const)[dom]!, n);
      }
    }
    // the overlay + widget re-land on the (possibly moved) block
    this.blockHlGroup.quaternion.identity();
    this.blockHlGroup.position.set(this.moff.x, this.moff.y, this.moff.z);
    for (const o of this.blockHlGroup.children) o.visible = true;
    this.syncBlockGizmo();
    this.invalidate();
  }
  /** v1.8.1 (user: "when moving blocks, wireframe must be visible for all
   *  blocks"): while the BLOCK widget DRAGS a block, every block's lattice
   *  shows — the merged wireframe goes visible and the hull solids step
   *  aside (the legacy hull⇄wire pair), so the block being placed reads
   *  against ALL other blocks instead of hiding inside a solid skin. The
   *  user's own hull/wire choice is restored at the commit (a wire already
   *  showing is left untouched). */
  private showHullWireframe(on: boolean) {
    if (on) {
      if (this.wireDragOpts || !this.wireLine) return;
      this.wireDragOpts = { hull: this.opts.hull, wire: this.opts.wire };
      if (!this.opts.wire) {
        this.opts = { ...this.opts, hull: false, wire: true };
        this.applyViewOptions();
      }
    } else if (this.wireDragOpts) {
      this.opts = { ...this.opts, hull: this.wireDragOpts.hull, wire: this.wireDragOpts.wire };
      this.wireDragOpts = null;
      this.applyViewOptions();
    }
    this.invalidate();
  }

  /** VALIDATED whole-cell shift of the block owning the widget (+ its SIMILAR
   *  TWIN to the mirrored cell — v1.7.1: ALWAYS, the user's edits mirror to
   *  the identified twin). false = the footprint collides (refused).
   *  PUBLIC: the e2e pins and a future keyboard nudge drive this exact path. */
  blockGizmoShift(step: [number, number, number]): boolean {
    const bp = this.bp;
    const bi = this.blockGizBi;
    const b = bi >= 0 && bp ? bp.data.blocks[bi] : undefined;
    if (!bp || !b) return false;
    if (step[0] === 0 && step[1] === 0 && step[2] === 0) return true;
    const c = blockCells(b);
    const cell: [number, number, number] = [c.x + step[0], c.y + step[1], c.z + step[2]];
    const size: [number, number, number] = [b.size_x, b.size_y, b.size_z];
    const twin = blockMirrorTwin(bp, bi, this.mirAxis);
    const tw = twin >= 0 ? bp.data.blocks[twin] : undefined;
    if (cellOverlapSkip(bp, cell, size, [bi, twin])) return false;
    let tcell: [number, number, number] | null = null;
    if (tw) {
      const ma = mirrorAxisIdx(this.mirAxis);
      tcell = [cell[0], cell[1], cell[2]];
      tcell[ma] = mirrorBlockCell(cell[ma]!, size[ma]!);
      if (cellOverlapSkip(bp, tcell, [tw.size_x, tw.size_y, tw.size_z], [bi, twin])) return false;
    }
    setBlockGeom(b, cell, size, b.type);
    if (tw && tcell) setBlockGeom(tw, tcell, [tw.size_x, tw.size_y, tw.size_z], tw.type);
    this.afterBlockGizmoEdit(twin);
    return true;
  }
  /** n × +90° right-hand turns about a WORLD axis (negative wraps) — the
   *  panel's ⟲X/Y/Z geometry (rotatedBlock: type turns, the two perpendicular
   *  footprints exchange, the bbox CENTRE stays frozen), SIMILAR TWIN in
   *  unison (v1.7.1: ALWAYS, mirrored). */
  blockGizmoRotate(axis: 'x' | 'y' | 'z', n90: number): boolean {
    const bp = this.bp;
    const bi = this.blockGizBi;
    const b = bi >= 0 && bp ? bp.data.blocks[bi] : undefined;
    if (!bp || !b) return false;
    const n = ((Math.round(n90) % 4) + 4) % 4;
    if (n === 0) return true;
    const twin = blockMirrorTwin(bp, bi, this.mirAxis);
    const tw = twin >= 0 ? bp.data.blocks[twin] : undefined;
    const turn = (x: Block): Block => {
      let r = x;
      for (let k = 0; k < n; k++) r = rotatedBlock(r, axis, false);
      return r;
    };
    const nb = turn(b);
    const nc = blockCells(nb);
    setBlockGeom(b, [nc.x, nc.y, nc.z], [nb.size_x, nb.size_y, nb.size_z], nb.type);
    if (tw) {
      const ntb = turn(tw);
      const ntc = blockCells(ntb);
      setBlockGeom(tw, [ntc.x, ntc.y, ntc.z], [ntb.size_x, ntb.size_y, ntb.size_z], ntb.type);
    }
    this.afterBlockGizmoEdit(twin);
    return true;
  }
  /** overlay rebuild + the doc/dirty/reload mirror (the Editor owns the doc) */
  private afterBlockGizmoEdit(twin: number) {
    this.blockHlSpec = null;                  // force a geometry rebuild
    if (this.blockGizBi >= 0 && this.bp)      // twin IDENTIFIED always (v1.7.1)
      this.setBlockHighlight(this.blockGizBi,
        blockMirrorTwin(this.bp, this.blockGizBi, this.mirAxis));
    this.onBlockEdit?.(twin >= 0 ? [this.blockGizBi, twin] : [this.blockGizBi]);
  }
  /** WORLD bbox of a component's REAL (node-tree) model, [min,max]; null
   *  while only the stand-in box or nothing is shown (matrix-pair pins
   *  measure the generated/data-driven surface through this) */
  compRealBox(ci: number): { min: [number, number, number]; max: [number, number, number] } | null {
    const roots = (this.compRoots.get(ci) ?? []).filter(o => (o.userData as { real?: boolean })?.real && o.visible);
    if (!roots.length) return null;
    this.scene.updateMatrixWorld(true);
    const b = new Box3();
    for (const o of roots) b.expandByObject(o);
    return b.isEmpty() ? null : { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
  }
  /** the ring/arrow axis TGC picked for the LIVE drag ('X'|'Y'|'Z'|'E'…|null)
   *  — pins assert a real-pointer grip landed on the DRAWN ring at its
   *  CURRENT (rotated) position: proof the handle plane follows the live pose */
  gizmoDragAxis(): string | null {
    return this.gizmo?.axis ?? null;
  }
  /** client-px grab point ON the drawn rotate ring of `axis`, at sweep-angle
   *  `deg` around the circle (0 = the point whose tangential drag rotates
   *  about the live axis). Derived from the CURRENT proxy pose and TGC's own
   *  handle scale, so a re-grip aims where the ring ACTUALLY IS after the
   *  last grip (ring-drag continuity backlog pin). */
  ringScreenPoint(axis: 'x' | 'y' | 'z', deg = 0): { x: number; y: number } | null {
    const g = this.gizmo, renderer = this.renderer, cam = this.camera;
    if (!g || !renderer || !this.gizmoEnabled || this.gizmoMode !== 'rotate' || this.gizmoCi < 0) return null;
    const e = cam.getWorldPosition(new Vector3()).sub(this.gizmoProxy.getWorldPosition(new Vector3())).normalize();
    const q = this.gizmoProxy.getWorldQuaternion(new Quaternion());
    const A = new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    const n = A.applyQuaternion(q);                       // ring-plane normal, LIVE pose
    if (Math.abs(n.dot(e)) > 0.95) return null;           // edge-on: aim another view
    const u = e.clone().addScaledVector(n, -e.dot(n)).normalize();  // in-plane ⊥ n
    const v = new Vector3().crossVectors(n, u);           // tangential at deg 0
    // TGC's per-frame handle scale (TransformControls.updateMatrixWorld):
    // factor * size/4, size = 1; the ring's pick torus radius is 0.5 UNIT
    const dist = cam.getWorldPosition(new Vector3()).distanceTo(this.gizmoProxy.getWorldPosition(new Vector3()));
    // TGC's OWN handle-scale factor for BOTH projections (r186
    // TransformControls.updateMatrixWorld: ortho uses the frustum height
    // over zoom, never a distance) — the grab point lands on the DRAWN ring
    const oc = cam as OrthographicCamera;
    const factor = (cam as { isOrthographicCamera?: boolean }).isOrthographicCamera
      ? (oc.top - oc.bottom) / oc.zoom
      : dist * Math.min(1.9 * Math.tan(Math.PI * ((cam as { fov?: number }).fov ?? PERSP_FOV) / 360), 7);
    const r = factor / 4 * 0.5;
    const t = deg * DEG;
    const p = this.gizmoProxy.getWorldPosition(new Vector3())
      .addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r);
    p.project(cam);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
  }

  // ------------------------------------------------ hinge UI (subgrid handles)
  // A selected SUBGRID gets no free gizmo (v0.170 — it rides its masters), but
  // it does get a UI AT the joint line: one ring per angle master (turning it
  // writes the master's data.angle in DEGREES) and one arrow per slide master
  // (data.pos in metres). The motion is constrained to and ATTACHED to the
  // captured hinge — you manipulate the hinge, never the panel directly.
  // Writes mirror the panel joint sliders: master data + propagateJoint twin
  // unison (v0.176) + onDataEdit doc mirror. Shift snaps 15° / 0.25 m.
  private hingeGroup = new Group();
  private hingeCanvas: HTMLCanvasElement | null = null;
  private hingeHandles: HingeHandle[] = [];
  private hingeDrag: {
    h: HingeHandle; plane: Plane; axis: Vector3; pivot: Vector3;
    last: Vector3; acc: number; base: number;
  } | null = null;
  private snapOn = false;

  /** client-space grab point of handle i (test hook: where to press to turn it) */
  hingeScreenPoint(i: number): { x: number; y: number } | null {
    const h = this.hingeHandles[i];
    if (!h || !this.renderer) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    let p: Vector3;
    if (h.kind === 'angle') {
      const a = h.jref.axis0;
      const av = new Vector3(a[0], a[1], a[2]);
      const u = new Vector3(1, 0, 0);
      if (Math.abs(av.x) > 0.9) u.set(0, 1, 0);
      u.cross(av).normalize().multiplyScalar(h.radius * 0.95);          // ⟂ axis, on the ring
      p = new Vector3(h.jref.pivot0[0], h.jref.pivot0[1], h.jref.pivot0[2])
        .add(this.moffV()).add(u);
    } else {
      const s = h.jref.slide0;
      const pos = typeof h.jref.mc.data?.['pos'] === 'number' ? (h.jref.mc.data['pos'] as number) : 0;
      p = new Vector3(h.jref.pivot0[0] + s[0] * (pos + 0.3), h.jref.pivot0[1] + s[1] * (pos + 0.3),
        h.jref.pivot0[2] + s[2] * (pos + 0.3)).add(this.moffV());
    }
    p.project(this.camera);
    return { x: rect.left + (p.x * 0.5 + 0.5) * rect.width, y: rect.top + (-p.y * 0.5 + 0.5) * rect.height };
  }

  hingeInfo(): { bi: number; handles: { ci: number; key: string; value: number }[] } | null {
    if (this.selSub < 0 || !this.hingeHandles.length) return null;
    return {
      bi: this.selSub,
      handles: this.hingeHandles.map(h => ({
        ci: h.ci, key: h.kind === 'angle' ? 'angle' : 'pos',
        value: typeof h.jref.mc.data?.[h.kind === 'angle' ? 'angle' : 'pos'] === 'number'
          ? (h.jref.mc.data[h.kind === 'angle' ? 'angle' : 'pos'] as number) : 0,
      })),
    };
  }

  private moffV() { return new Vector3(this.moff.x, this.moff.y, this.moff.z); }

  /** (re)build the joint handles for the selected subgrid (none = hidden) */
  private buildHingeUI(bi: number) {
    this.hingeGroup.clear();
    this.hingeHandles = [];
    if (bi < 0) { this.hingeGroup.visible = false; return; }
    const jrefs = this.subJrefs.get(bi) ?? [];
    const g = this.subGroups.get(bi);
    const box = new Box3();
    if (g) { this.scene.updateMatrixWorld(true); box.setFromObject(g); }
    const size = box.isEmpty() ? 1 : box.getSize(new Vector3()).length();
    const radius = Math.max(0.3, Math.min(1.2, size * 0.28));
    for (const jref of jrefs) {
      if (jref.top < 0) continue;                       // nested master: no file handle row
      const d = jref.mc.data ?? {};
      const kind: 'angle' | 'slide' | null =
        typeof d['angle'] === 'number' ? 'angle' : typeof d['pos'] === 'number' ? 'slide' : null;
      if (!kind || !this.atlasRef?.manifest[jref.mc.type]?.joints?.length) continue;
      const mat = new MeshBasicMaterial({ color: 0xffc850, transparent: true, opacity: 0.9, depthTest: false });
      let mesh: Mesh;
      if (kind === 'angle') {
        mesh = new Mesh(new TorusGeometry(radius, Math.max(0.02, radius * 0.055), 10, 40), mat);
        const a = jref.axis0;
        mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(a[0], a[1], a[2]));
        mesh.position.set(jref.pivot0[0] + this.moff.x, jref.pivot0[1] + this.moff.y, jref.pivot0[2] + this.moff.z);
      } else {
        const s = jref.slide0;
        mesh = new Mesh(new BoxGeometry(0.09, 0.09, 0.5), mat);
        const av = new Vector3(s[0], s[1], s[2]);
        mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), av);
        const pos = typeof d['pos'] === 'number' ? (d['pos'] as number) : 0;
        mesh.position.set(jref.pivot0[0] + s[0] * pos + this.moff.x, jref.pivot0[1] + s[1] * pos + this.moff.y,
          jref.pivot0[2] + s[2] * pos + this.moff.z);
      }
      mesh.renderOrder = 997;
      const hi = this.hingeHandles.length;
      this.hingeHandles.push({ mesh, kind, jref, ci: jref.top, radius });
      mesh.userData = { hinge: hi };
      this.hingeGroup.add(mesh);
    }
    this.hingeGroup.visible = this.hingeHandles.length > 0 && this.gizmoEnabled;
  }

  /** commit a handle edit like the panel slider: self data verbatim + twin
   *  unison + group replay (syncSubJoints) + doc mirror */
  private applyHinge(h: (typeof this.hingeHandles)[number], v: number) {
    const key = h.kind === 'angle' ? 'angle' : 'pos';
    const mc = h.jref.mc;
    const old = typeof mc.data?.[key] === 'number' ? (mc.data[key] as number) : 0;
    if (v === old) return;
    mc.data = { ...mc.data, [key]: v };
    this.propagateJoint(h.ci, key, v - old);
    this.onDataEdit?.(h.ci, key);
    this.liveDataEdit(h.ci);                             // master's own joint node rides live
    if (h.kind === 'slide') {                            // arrow rides the slide
      const s = h.jref.slide0;
      h.mesh.position.set(h.jref.pivot0[0] + s[0] * v + this.moff.x,
        h.jref.pivot0[1] + s[1] * v + this.moff.y, h.jref.pivot0[2] + s[2] * v + this.moff.z);
    }
    this.syncSubJoints();
    this.invalidate();
  }

  private hingeRay(ev: PointerEvent) {
    if (!this.renderer) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const rc = new Raycaster();
    rc.setFromCamera(new Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    return rc;
  }

  private onHingeDown = (ev: PointerEvent) => {
    if (!this.hingeGroup.visible || !this.hingeHandles.length) return;
    const rc = this.hingeRay(ev);
    if (!rc) return;
    const hit = rc.intersectObjects(this.hingeGroup.children, false)[0];
    if (!hit) return;
    const hi = (hit.object.userData as { hinge?: number }).hinge;
    const h = hi != null ? this.hingeHandles[hi] : undefined;
    if (!h) return;
    const pivot = new Vector3(h.jref.pivot0[0], h.jref.pivot0[1], h.jref.pivot0[2]).add(this.moffV());
    const axis = h.kind === 'angle'
      ? new Vector3(...h.jref.axis0)
      : new Vector3(...h.jref.slide0);
    // drag plane faces the camera; angle turns about axis, slides read along axis
    const n = new Vector3();
    this.camera.getWorldDirection(n);
    const plane = new Plane().setFromNormalAndCoplanarPoint(n, pivot);
    const p0 = new Vector3();
    if (!rc.ray.intersectPlane(plane, p0)) return;
    const key = h.kind === 'angle' ? 'angle' : 'pos';
    this.hingeDrag = {
      h, plane, axis, pivot, last: p0, acc: 0,
      base: typeof h.jref.mc.data?.[key] === 'number' ? (h.jref.mc.data[key] as number) : 0,
    };
    if (this.controls) this.controls.enabled = false;
    this.renderer?.domElement.setPointerCapture(ev.pointerId);
    addEventListener('pointermove', this.onHingeMove);
    addEventListener('pointerup', this.onHingeUp);
  };

  private onHingeMove = (ev: PointerEvent) => {
    const dr = this.hingeDrag;
    if (!dr) return;
    const rc = this.hingeRay(ev);
    if (!rc) return;
    const p = new Vector3();
    if (!rc.ray.intersectPlane(dr.plane, p)) return;
    if (dr.h.kind === 'angle') {
      // signed angle swept about the hinge axis between consecutive samples
      const v0 = dr.last.clone().sub(dr.pivot);
      const v1 = p.clone().sub(dr.pivot);
      for (const v of [v0, v1]) v.addScaledVector(dr.axis, -v.dot(dr.axis));   // into the ring plane
      const dTheta = Math.atan2(new Vector3().crossVectors(v0, v1).dot(dr.axis), v0.dot(v1));
      dr.acc += dTheta;
      let deg = dr.base + dr.acc / DEG;
      if (this.snapOn) deg = Math.round(deg / 15) * 15;
      this.applyHinge(dr.h, +deg.toFixed(6));
    } else {
      dr.acc += p.clone().sub(dr.last).dot(dr.axis);
      let m = dr.base + dr.acc;
      if (this.snapOn) m = Math.round(m / 0.25) * 0.25;
      this.applyHinge(dr.h, +m.toFixed(6));
    }
    dr.last.copy(p);
  };

  private onHingeUp = () => {
    this.hingeDrag = null;
    if (this.controls) this.controls.enabled = true;
    removeEventListener('pointermove', this.onHingeMove);
    removeEventListener('pointerup', this.onHingeUp);
  };

  // -------------------------------------------------------------- editing

  /** live position ride: stand-in AND real-model siblings follow the file
   *  position (raw == view frame, v0.180); master parts ride subgrids too. */
  moveComp(ci: number) {
    const c = this.bp?.data.components[ci];
    if (!c) return;
    for (const o of this.compRoots.get(ci) ?? [])
      o.position.set(c.position.x + this.moff.x, c.position.y + this.moff.y, c.position.z + this.moff.z);
    this.updateCoM();
    this.syncSubJoints();                            // rigid master-riding (v0.172)
    if (this.selCi === ci) { this.paintSelection(); this.syncGizmo(); }
    this.invalidate();
  }

  /** inspector rotation sliders: absolute WORLD-axis degree deltas composed
   *  as q = qd·q0 (q0 captured by beginRotEdit when the inspector opens),
   *  Euler YXZ exactly like legacy liveRot. Writes the FILE quaternion
   *  (junction display pose stripped through the build-time undo)
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
    const file: FileQuat = { w: t.w, x: t.x, y: t.y, z: t.z };   // one law (v1.5.11)
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
      this.bp.data.components[j]!.orientation = { w: tt.w, x: tt.x, y: tt.y, z: tt.z };  // one law
      this.onEdit?.(j);
    }
    this.syncSubJoints();
    if (this.selCi === ci) { this.paintSelection(); this.syncGizmo(); }
    this.invalidate();
    return file;
  }

  /** ⟲ reset: the caller has already restored bp+doc (edit.resetComponent);
   *  rebuild the display pose (fresh junction/toggle rule + fresh undo) and
   *  ride proxy + real siblings onto it (v0.152: the view MUST repaint). */
  refreshComp(ci: number) {
    const c = this.bp?.data.components[ci];
    if (!c) return;
    const qFile = c.orientation ?? Q_ID;
    const qView = fileToViewQuat(qFile);
    const qDisp = displayQuat(c.type, qView, qFile, this.legacy);
    this.rotUndo.set(ci, qMul(qInv(qDisp), qView));
    this.rotBase.delete(ci);
    for (const o of this.compRoots.get(ci) ?? []) {
      o.position.set(c.position.x + this.moff.x, c.position.y + this.moff.y, c.position.z + this.moff.z);
      o.quaternion.set(qDisp.x, qDisp.y, qDisp.z, qDisp.w);
    }
    this.syncSubJoints();
    if (this.selCi === ci) { this.paintSelection(); this.syncGizmo(); }
    this.invalidate();
  }

  /** data-field edits (the subgrid joint sliders land here via master parts)
   *  + the part's OWN joint pose re-applied on its live model (Aileron flap,
   *  hinge/pivot hardware, LinearTrack slide — applyJointPoses) */
  dataEdited() {
    this.syncSubJoints();
    for (const [ci] of this.liveEdits) this.applyLiveJointPose(ci);
    this.invalidate();
  }

  // ---------- LIVE data edits (real-time component re-render) ----------
  /** DATA-panel slider stream (pitch/twist/blades/radius/width on a
   *  Propeller, dashboard size, angle/pos on a joint, reverse/mudguard/state
   *  conditionals…): the panel writes bp.data VERBATIM then calls this; the
   *  component's real model is REBUILT IN PLACE from the fresh data — the
   *  same generated surfaces buildReal makes at load (propeller.ts soup,
   *  buildDashboard, the drop-table conditionals), so the mesh follows the
   *  slider every frame with NO full scene reload. One rebuild per frame per
   *  component at most (the slider's input storm coalesces here). */
  private liveEdits = new Map<number, Promise<void>>();

  liveDataEdit(ci: number) {
    if (!this.bp || this.heavy) return;
    if (!this.compRoots.get(ci)?.some(o => (o.userData as { real?: boolean })?.real)) return;
    const prev = this.liveEdits.get(ci) ?? Promise.resolve();
    this.liveEdits.set(ci, prev.then(() => this.rebuildRealInPlace(ci)));
  }

  /** every JOINT-STATE field edit routes the part's own joint node here */
  private applyLiveJointPose(ci: number) {
    const c = this.bp?.data.components[ci];
    if (!c) return;
    for (const o of this.compRoots.get(ci) ?? []) {
      const jrefs = (o.userData as { jrefs?: JointPose[] }).jrefs;
      if (jrefs) applyJointPoses(jrefs, c);
    }
  }

  private flushLiveEdits() {
    if (!this.liveEdits.size) return;
    const pend = [...this.liveEdits.keys()];
    this.liveEdits.clear();
    for (const ci of pend) void this.rebuildRealInPlace(ci);
  }

  /** dispose ONE component's real roots, rebuild from bp.data, re-attach at
   *  the live pose (the stand-in stays retired), re-bind selection + gizmo */
  private rebuildRealInPlace(ci: number) {
    const c = this.bp?.data.components[ci];
    const model = c ? this.liveGeo.get(c.type) : undefined;
    if (!c || !model) return;
    const roots = this.compRoots.get(ci);
    if (!roots) return;
    const old = roots.filter(o => (o.userData as { real?: boolean })?.real);
    if (!old.length) return;
    const pose = old[0]!;
    for (const o of old) {
      this.root.remove(o);
      o.traverse(x => {
        const m = x as Mesh;
        if (m.isMesh) { m.geometry.dispose(); if (!this.shared.has(m.material)) (m.material as MeshStandardMaterial).dispose(); }
      });
      const k = roots.indexOf(o);
      if (k >= 0) roots.splice(k, 1);
    }
    const real = this.buildReal(c, model, !!(pose.userData as { noRaycast?: boolean }));
    real.position.copy(pose.position);
    real.quaternion.copy(pose.quaternion);
    Object.assign(real.userData, { kind: 'comp', ci, real: true });      // keep jrefs
    this.root.add(real);
    roots.push(real);
    if (this.selCi === ci || this.hoverCi === ci) { this.scene.updateMatrixWorld(true); this.paintSelection(); this.syncGizmo(); }
    this.invalidate();
  }

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
      // v2.0.0 (user: "if wireframe is on … you click through blocks"): the
      // hull solids hidden ⇒ block/triangle meshes are NOT pickable.
      if (kind === 'block' && !this.opts.hull) continue;
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
      loads: this.loadCount,
    };
  }

  get blueprint(): Blueprint | null { return this.bp; }

  /** e2e pin: components whose REAL model has not swapped in yet (the
   *  collider-sized stand-in box is still what raycasts/clicks see — the
   *  v0.182 basis fix moved those boxes onto the part's true footprint, so
   *  pixel-tuned scene tests must wait for the atlas fan-out to land) */
  get pendingReal(): number {
    let n = 0;
    this.compRoots.forEach(l => { if (l.length === 1) n++; });
    return n;
  }

  /** e2e/selftest pin (legacy selftest surges=true): the LIVE surge state —
   *  one pulse per connected pipe, each with a real target and length, all
   *  additive + depthTest OFF (visible THROUGH the hull) */
  surgeState() {
    return {
      surges: this.surges.map(s => ({
        to: s.to, total: Math.round(s.total * 1000) / 1000, dur: Math.round(s.dur),
      })),
      flashes: this.flashes.length,
      arrivals: this.flashArrivals,
      sourceBlip: this.flashes.some(f => f.color === 0xffb347),
      additiveNoDepth: this.surges.length > 0 && this.surges.every(s => {
        const m = s.mesh.material as MeshBasicMaterial;
        return m.blending === AdditiveBlending && m.depthTest === false
          && m.depthWrite === false;
      }),
      links: this.pipeNet.links.length,
    };
  }

  /** e2e pin: label chips exist and follow the labels option; alias chips
   *  (blue) counted separately from INTERACT-type chips */
  labelState() {
    return {
      total: this.labels.length,
      shown: this.labels.filter(l => l.sp.visible).length,
      aliased: this.labels.filter(l =>
        ((this.bp?.data.components[l.ci]?.alias ?? '') as string).trim() !== '').length,
      on: this.opts.labels,
    };
  }

  /** re-run the whole load with the CURRENT bp (block/wire edits mutate bp
   *  outside the engine; the merged geometry is rebuilt wholesale) */
  reload() { if (this.bp) this.load(this.bp, this.atlasRef, true); }

  /** Edit workspace: raycast for the placement/select cell. The hit face's
   *  WORLD normal (view frame == raw file frame since the v0.180 de-mirror;
   *  the face's LOCAL normal is carried through the hit object's normal
   *  matrix — component/subgrid parents carry rotations) picks the adjacent
   *  cell where a new block would land. `kind` splits the merged hull/block
   *  bucket: bi >= 0 means a real block face (complementable), a bucket hit
   *  with no owning block is a HULL TRIANGLE prism. `cell` uses the exact
   *  cell-boundary lattice (cellIndex: cell c covers [(c−6)·CELL, (c−5)·CELL))
   *  — the old +5.5 floor sat half a cell off and the retired −pz mirror
   *  flipped z placement across the fuselage (pre-v0.180 leftovers). */
  pickCell(clientX: number, clientY: number):
    { bi: number; ci: number; point: [number, number, number]; cell: [number, number, number];
      nrm: [number, number, number]; kind: 'block' | 'tri' | 'comp' | 'sub' | 'ground' } | null {
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
      if (kind !== 'block' && kind !== 'ground' && kind !== 'comp' && kind !== 'sub') continue;
      // v2.0.0: hidden hull solids are click-through (wireframe mode)
      if (kind === 'block' && !this.opts.hull) continue;
      // the component behind a comp hit (blocks-mode click → selection)
      const ci = kind === 'comp' ? (o!.userData.ci as number) : -1;
      // display anchoring off → RAW FILE metres (view == file frame, v0.180)
      const p: [number, number, number] =
        [h.point.x - this.moff.x, h.point.y - this.moff.y, h.point.z - this.moff.z];
      const nrm3 = h.face
        ? h.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(h.object.matrixWorld)).normalize()
        : new Vector3(0, 1, 0);
      const nrm: [number, number, number] = [nrm3.x, nrm3.y, nrm3.z];
      // the cell adjacent to the hit face: nudge the point 0.6 cell along
      // the normal so the face-boundary coordinate lands in the next cell
      const cell = [0, 1, 2].map(a =>
        Math.floor((p[a]! + nrm[a]! * CELL * 0.6) / CELL + 6)) as [number, number, number];
      let bi = -1;
      if (kind === 'block') {
        // which merged block owns the face: nudge the hit cell-coords INTO
        // the surface along −normal (a hair, so glued neighbours on the far
        // side never claim it); nearest-centre breaks exact-edge ties
        const q = [0, 1, 2].map(a => p[a]! / CELL + 6 - Math.sign(nrm[a]!) * 1e-6);
        const bl = this.bp.data.blocks;
        let bd = Infinity;
        for (let i = 0; i < bl.length; i++) {
          const b = bl[i]!;
          if (b.type === 255) continue;
          const c0 = [((b.frame_x ?? 0) * 12 + b.pos_x), ((b.frame_y ?? 0) * 12 + b.pos_y), ((b.frame_z ?? 0) * 12 + b.pos_z)];
          if (q[0]! < c0[0]! || q[0]! >= c0[0]! + b.size_x + 1
            || q[1]! < c0[1]! || q[1]! >= c0[1]! + b.size_y + 1
            || q[2]! < c0[2]! || q[2]! >= c0[2]! + b.size_z + 1) continue;
          const dx = q[0]! - (c0[0]! + (b.size_x + 1) / 2), dy = q[1]! - (c0[1]! + (b.size_y + 1) / 2),
            dz = q[2]! - (c0[2]! + (b.size_z + 1) / 2);
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bd) { bd = d; bi = i; }
        }
      }
      return { bi, ci, point: p, cell, nrm, kind: kind === 'block' && bi < 0 ? 'tri' : kind };
    }
    return null;
  }

  // ---------------------------------------------------- placement ghost
  /** The translucent block preview under the cursor in BLOCKS-place mode
   *  (the game's constructor ghost: KSP-yellow brush, mint-green logical
   *  continuation on Shift, red when the footprint collides). Lives in its
   *  OWN scene group (never under root — disposeScene must not eat it),
   *  positioned by moff so raw-file child coords render at world position. */
  setPlaceGhost(g: (PlaceSpec & { valid: boolean; complement: boolean }) | null) {
    if (!g && !this.ghostSpec) return;
    this.ghostSpec = g;
    for (const o of this.ghostGroup.children) {
      (o as Mesh).geometry?.dispose();
      ((o as Mesh).material as MeshBasicMaterial)?.dispose();
    }
    this.ghostGroup.clear();
    if (g) {
      const origin = [(g.cell[0] - 6) * CELL, (g.cell[1] - 6) * CELL, (g.cell[2] - 6) * CELL] as
        [number, number, number];
      const size = [(g.size[0] + 1) * CELL, (g.size[1] + 1) * CELL, (g.size[2] + 1) * CELL] as
        [number, number, number];
      const pts = getBlockPoints(g.type, origin, size);
      const pos: number[] = [];
      for (const v of pts) pos.push(v[0], v[1], v[2]);
      const idx: number[] = [];
      for (const f of getBlockFaces(g.type)) idx.push(f[0]!, f[1]!, f[2]!, f[3]!, f[4]!, f[5]!);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const hex = !g.valid ? 0xff4d4d : g.complement ? 0x7dffcf : 0xffc94d;
      const solid = new Mesh(geo, new MeshBasicMaterial({
        color: hex, transparent: true, opacity: 0.42, depthTest: false, side: DoubleSide,
      }));
      solid.renderOrder = 30;
      const ep: number[] = [];
      for (const [a, b] of getBlockEdges(g.type))
        ep.push(...pts[a]!, ...pts[b]!);
      const eg = new BufferGeometry();
      eg.setAttribute('position', new BufferAttribute(new Float32Array(ep), 3));
      const wire = new LineSegments(eg, new LineBasicMaterial({
        color: hex, transparent: true, opacity: 0.95, depthTest: false,
      }));
      wire.renderOrder = 31;
      this.ghostGroup.add(solid, wire);
    }
    this.invalidate();
  }
  get placeGhostState() { return this.ghostSpec; }

  // ------------------------------------------------- cluster placement ghost
  /** v1.6 TOOLS ▸ Spheroid: preview a generated block CLUSTER translucent,
   *  movable on the BLOCK widget (CELL snap) with a Cancel/Build label.
   *  Children keep RAW-FILE metres (the group rides moff + the cell offset),
   *  so a commit only has to shift the block records. null clears. */
  setClusterGhost(blocks: Block[] | null, hex = 0x7dffcf, tris: Triangle[] | null = null,
    rides: [number, number, number][][] | null = null) {
    this.clusterBlocks = blocks ? blocks.slice() : [];
    this.clusterTris = tris ? tris.slice() : [];
    this.clusterRides = rides ? rides.map(r => r.map(p => [p[0], p[1], p[2]] as [number, number, number])) : [];
    this.clusterHex = hex;
    this.clusterOffset = [0, 0, 0];
    this.clusterTurns = 0;
    this.clusterBase = null;
    this.rebuildClusterMesh();
    this.clusterCheckValid();
    this.syncGizmo();                        // the widget lands on the cluster
    this.invalidate();
  }
  /** (re)build the translucent solid+wire mesh of clusterBlocks+clusterTris
   *  (RAW-FILE metres; the group rides moff + the cell offset). */
  private rebuildClusterMesh() {
    for (const o of this.clusterGroup.children) {
      (o as Mesh).geometry?.dispose();
      ((o as unknown as { material?: { dispose?: () => void } }).material)?.dispose?.();
    }
    this.clusterGroup.clear();
    if (this.clusterBlocks.length || this.clusterTris.length) {
      const pos: number[] = [], idx: number[] = [], ep: number[] = [];
      for (const b of this.clusterBlocks) {
        const c = blockCells(b);
        const origin: [number, number, number] =
          [(c.x - 6) * CELL, (c.y - 6) * CELL, (c.z - 6) * CELL];
        const size: [number, number, number] =
          [(b.size_x + 1) * CELL, (b.size_y + 1) * CELL, (b.size_z + 1) * CELL];
        const base = pos.length / 3;
        const pts = getBlockPoints(b.type, origin, size);
        for (const v of pts) pos.push(v[0], v[1], v[2]);
        for (const f of getBlockFaces(b.type)) idx.push(f[0]! + base, f[1]! + base, f[2]! + base, f[3]! + base, f[4]! + base, f[5]! + base);
        for (const [a, e] of getBlockEdges(b.type)) ep.push(...pts[a]!, ...pts[e]!);
      }
      // skin triangles: decode the frame + 0..31 window to lattice points
      const triG = (t: Triangle, i: number, ax: 0 | 1 | 2) =>
        (t[`v${i}_${'xyz'[ax]!}`] as number) + CELLS_PER_FRAME * (t[`frame_${'xyz'[ax]!}`] as number);
      for (const t of this.clusterTris) {
        const base = pos.length / 3;
        for (let i = 0; i < 3; i++) {
          const g: [number, number, number] = [triG(t, i, 0), triG(t, i, 1), triG(t, i, 2)];
          pos.push((g[0] - 6) * CELL, (g[1] - 6) * CELL, (g[2] - 6) * CELL);
        }
        idx.push(base, base + 1, base + 2);
        ep.push(...pos.slice(base * 3, base * 3 + 3), ...pos.slice(base * 3 + 3, base * 3 + 6),
          ...pos.slice(base * 3 + 6, base * 3 + 9), ...pos.slice(base * 3 + 6, base * 3 + 9),
          ...pos.slice(base * 3 + 3, base * 3 + 6), ...pos.slice(base * 3, base * 3 + 3));
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const solid = new Mesh(geo, new MeshBasicMaterial({
        color: this.clusterHex, transparent: true, opacity: 0.38, depthTest: false, side: DoubleSide,
      }));
      solid.renderOrder = 30;
      const eg = new BufferGeometry();
      eg.setAttribute('position', new BufferAttribute(new Float32Array(ep), 3));
      const wire = new LineSegments(eg, new LineBasicMaterial({
        color: this.clusterHex, transparent: true, opacity: 0.9, depthTest: false,
      }));
      wire.renderOrder = 31;
      this.clusterGroup.add(solid, wire);
    }
    this.syncClusterGroupPos();
  }
  /** g-coordinate bbox [min,max] of the cluster data (NO cell offset) */
  private clusterBBoxG(): [[number, number, number], [number, number, number]] | null {
    if (!this.clusterBlocks.length && !this.clusterTris.length) return null;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const b of this.clusterBlocks) {
      const c = blockCells(b);
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); z0 = Math.min(z0, c.z);
      x1 = Math.max(x1, c.x + b.size_x + 1); y1 = Math.max(y1, c.y + b.size_y + 1);
      z1 = Math.max(z1, c.z + b.size_z + 1);
    }
    const tg = (t: Triangle, i: number, ax: 0 | 1 | 2) =>
      (t[`v${i}_${'xyz'[ax]!}`] as number) + CELLS_PER_FRAME * (t[`frame_${'xyz'[ax]!}`] as number);
    for (const t of this.clusterTris)
      for (let i = 0; i < 3; i++) {
        x0 = Math.min(x0, tg(t, i, 0)); y0 = Math.min(y0, tg(t, i, 1)); z0 = Math.min(z0, tg(t, i, 2));
        x1 = Math.max(x1, tg(t, i, 0)); y1 = Math.max(y1, tg(t, i, 1)); z1 = Math.max(z1, tg(t, i, 2));
      }
    return [[x0, y0, z0], [x1, y1, z1]];
  }
  /** v1.7.2 QUARTER-TURN of the placement ghost about a WORLD axis through
   *  the bbox centre (user: "Add … a rotation option for the ghost preview").
   *  The lattice only stores quarter-turns (integer vertices survive ±90°
   *  exactly — FORMAT §Triangles), so ⟲x/⟲y/⟲z snap by construction: the
   *  triangles rotate about the nearest INTEGER lattice pivot (transformSkinTris
   *  re-floors the frames, colours/material/shading ride), block records
   *  rotate footprint + type (the panel ⟲ / BLOCK-widget law). The cell
   *  offset is the widget's own and stays put. */
  clusterGhostRotate(axis: 'x' | 'y' | 'z'): boolean {
    if (!this.clusterBlocks.length && !this.clusterTris.length) return false;
    const bb = this.clusterBBoxG();
    if (!bb) return false;
    const p: [number, number, number] = [
      Math.round((bb[0][0] + bb[1][0]) / 2),
      Math.round((bb[0][1] + bb[1][1]) / 2),
      Math.round((bb[0][2] + bb[1][2]) / 2),
    ];
    const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const b1 = (a + 1) % 3, c1 = (a + 2) % 3;
    const pp: number[] = p;
    // +90° right-hand about axis a, about the integer lattice pivot p
    const rot = (g: [number, number, number]): [number, number, number] => {
      const q: number[] = [g[0]!, g[1]!, g[2]!];
      q[b1] = pp[b1]! - (g[c1]! - pp[c1]!);
      q[c1] = pp[c1]! + (g[b1]! - pp[b1]!);
      return [q[0]!, q[1]!, q[2]!];
    };
    if (this.clusterTris.length)
      this.clusterTris = transformSkinTris(this.clusterTris, rot);
    if (this.clusterRides.length)
      this.clusterRides = this.clusterRides.map(r => r.map(p => rot([p[0], p[1], p[2]])));
    for (let i = 0; i < this.clusterBlocks.length; i++) {
      const b = this.clusterBlocks[i]!;
      const c = blockCells(b);
      const lo: number[] = [c.x, c.y, c.z];
      const ext: number[] = [b.size_x + 1, b.size_y + 1, b.size_z + 1];
      const nlo: number[] = [...lo];
      const next: number[] = [...ext];
      nlo[b1] = pp[b1]! + pp[c1]! - (lo[c1]! + ext[c1]!) + 1;
      nlo[c1] = pp[c1]! + lo[b1]! - pp[b1]!;
      next[b1] = ext[c1]!; next[c1] = ext[b1]!;
      const nb = blockFromCell([nlo[0]!, nlo[1]!, nlo[2]!],
        [next[0]! - 1, next[1]! - 1, next[2]! - 1],
        rotateTypeAbout(b.type, axis, false), b.colors?.[0] ?? 0);
      nb.colors = Array.isArray(b.colors) ? [...b.colors] : nb.colors;
      nb.material = b.material;
      this.clusterBlocks[i] = nb;
    }
    this.clusterTurns++;
    this.rebuildClusterMesh();
    this.clusterCheckValid();
    this.syncClusterGizmo();
    this.invalidate();
    return true;
  }
  private syncClusterGroupPos() {
    const o = this.clusterOffset;
    this.clusterGroup.position.set(
      this.moff.x + o[0] * CELL, this.moff.y + o[1] * CELL, this.moff.z + o[2] * CELL);
  }
  /** bbox centre of the cluster (WORLD incl. moff + offset) — widget pivot
   *  and the label anchor */
  private clusterCentre(): Vector3 | null {
    if (!this.clusterBlocks.length && !this.clusterTris.length) return null;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const b of this.clusterBlocks) {
      const c = blockCells(b);
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); z0 = Math.min(z0, c.z);
      x1 = Math.max(x1, c.x + b.size_x + 1); y1 = Math.max(y1, c.y + b.size_y + 1);
      z1 = Math.max(z1, c.z + b.size_z + 1);
    }
    const tg = (t: Triangle, i: number, ax: 0 | 1 | 2) =>
      (t[`v${i}_${'xyz'[ax]!}`] as number) + CELLS_PER_FRAME * (t[`frame_${'xyz'[ax]!}`] as number);
    for (const t of this.clusterTris)
      for (let i = 0; i < 3; i++) {
        x0 = Math.min(x0, tg(t, i, 0)); y0 = Math.min(y0, tg(t, i, 1)); z0 = Math.min(z0, tg(t, i, 2));
        x1 = Math.max(x1, tg(t, i, 0)); y1 = Math.max(y1, tg(t, i, 1)); z1 = Math.max(z1, tg(t, i, 2));
      }
    const o = this.clusterOffset;
    return new Vector3(
      (x0 + x1) / 2 - 6 + o[0], (y0 + y1) / 2 - 6 + o[1], (z0 + z1) / 2 - 6 + o[2]).multiplyScalar(CELL)
      .add(this.moffV());
  }
  /** red while the footprint collides with existing blocks (the constructor
   *  ghost contract — Build is refused until it is mint again) */
  private clusterCheckValid() {
    const bp = this.bp;
    this.clusterValid = true;
    // a skin (tri-only) never collides — hull skins overlap blocks by design
    if (bp && this.clusterBlocks.length) {
      const o = this.clusterOffset;
      const ex = bp.data.blocks.filter(b => b.type !== 255).map(b => {
        const c = blockCells(b);
        return [c.x, c.y, c.z, c.x + b.size_x + 1, c.y + b.size_y + 1, c.z + b.size_z + 1] as const;
      });
      outer: for (const b of this.clusterBlocks) {
        const c = blockCells(b);
        const lo: [number, number, number] = [c.x + o[0], c.y + o[1], c.z + o[2]];
        const hi: [number, number, number] = [lo[0]! + b.size_x + 1, lo[1]! + b.size_y + 1, lo[2]! + b.size_z + 1];
        for (const e of ex)
          if (lo[0] < e[3] && hi[0] > e[0] && lo[1] < e[4] && hi[1] > e[1] && lo[2] < e[5] && hi[2] > e[2]) {
            this.clusterValid = false;
            break outer;
          }
      }
    }
    const hex = this.clusterValid ? this.clusterHex : 0xff4d4d;
    for (const o of this.clusterGroup.children) {
      const m = (o as Mesh).material as MeshBasicMaterial | LineBasicMaterial;
      m.color.set(hex);
    }
  }
  /** live state for the viewport label + the e2e pins (v1.7.2: bb = the g
   *  bbox INCLUDING the cell offset, turns = quarter-turns applied) */
  clusterGhostState(): {
    blocks: number; tris: number; offset: [number, number, number]; valid: boolean; shown: boolean;
    turns: number; bb: [[number, number, number], [number, number, number]] | null;
  } | null {
    if (!this.clusterBlocks.length && !this.clusterTris.length) return null;
    const g = this.gizmo;
    const bb = this.clusterBBoxG();
    const o = this.clusterOffset;
    return {
      blocks: this.clusterBlocks.length, tris: this.clusterTris.length,
      offset: this.clusterOffset.slice() as [number, number, number],
      valid: this.clusterValid,
      turns: this.clusterTurns,
      bb: bb ? [[bb[0][0] + o[0], bb[0][1] + o[1], bb[0][2] + o[2]],
               [bb[1][0] + o[0], bb[1][1] + o[1], bb[1][2] + o[2]]] : null,
      shown: !!g && g.enabled === true && g.getHelper().visible === true &&
        (g as unknown as { object?: unknown }).object === this.gizmoProxy,
    };
  }
  /** v1.7.2: the CURRENT ghost records (after ⟲ quarter-turns) — the commit
   *  writes what the user actually ghosted, not a fresh un-rotated plan.
   *  v1.9: + the carried lattice rides (balloon components/cables ride the
   *  same turn map — the commit recovers it from the probe tetrahedron). */
  clusterGhostData(): { blocks: Block[]; triangles: Triangle[]; rides: [number, number, number][][] } {
    return {
      blocks: this.clusterBlocks.slice(), triangles: this.clusterTris.slice(),
      rides: this.clusterRides.map(r => r.map(p => [p[0], p[1], p[2]] as [number, number, number])),
    };
  }
  /** PUBLIC whole-cell nudge of the placement (keyboard, pins — the widget
   *  commit routes through the same offset math); false = now colliding */
  clusterGhostShift(step: [number, number, number]): boolean {
    if (!this.clusterBlocks.length && !this.clusterTris.length) return false;
    const o = this.clusterOffset;
    this.clusterOffset = [o[0] + step[0], o[1] + step[1], o[2] + step[2]];
    this.syncClusterGroupPos();
    this.clusterCheckValid();
    this.syncClusterGizmo();
    this.invalidate();
    return this.clusterValid;
  }
  /** screen point of the cluster centre (CLIENT px) for the label */
  clusterGhostScreenPoint(): { x: number; y: number } | null {
    const renderer = this.renderer, cam = this.camera;
    const c = this.clusterCentre();
    if (!renderer || !cam || !c) return null;
    c.project(cam);
    if (c.z > 1) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (c.x + 1) / 2 * rect.width, y: rect.top + (1 - c.y) / 2 * rect.height };
  }
  /** the BLOCK widget on the cluster: WORLD translate + CELL snap ALWAYS.
   *  A selected component or block owns the widget first. */
  private syncClusterGizmo() {
    const g = this.gizmo;
    if (!g || this.gizmoCi >= 0 || this.blockGizBi >= 0) return;
    const c = this.clusterCentre();
    if (!c || !this.gizmoEnabled) {
      if (this.clusterBlocks.length && (g as unknown as { object?: unknown }).object === this.gizmoProxy) {
        g.detach(); g.enabled = false; g.getHelper().visible = false;
      }
      return;
    }
    this.gizmoProxy.position.copy(c);
    this.gizmoProxy.quaternion.identity();
    g.attach(this.gizmoProxy);
    g.setMode('translate');
    g.setSpace('world');
    g.setTranslationSnap(CELL);
    g.setRotationSnap(null);
    g.enabled = true;
    g.getHelper().visible = true;
  }
  private captureClusterGesture() {
    this.showHullWireframe(true);            // whole hull wire while placing (v1.8.1 rule)
    this.clusterBase = { off: this.clusterOffset.slice() as [number, number, number],
      center: this.gizmoProxy.position.clone() };
  }
  private clusterGhostDrag() {
    const base = this.clusterBase;
    if (!base) return;
    const d = this.gizmoProxy.position.clone().sub(base.center);
    const q: [number, number, number] = [Math.round(d.x / CELL), Math.round(d.y / CELL), Math.round(d.z / CELL)];
    const o = base.off;
    if (q[0] !== this.clusterOffset[0] || q[1] !== this.clusterOffset[1] || q[2] !== this.clusterOffset[2]) {
      this.clusterOffset = [o[0] + q[0], o[1] + q[1], o[2] + q[2]];
      this.syncClusterGroupPos();
      this.clusterCheckValid();
      this.invalidate();
    }
  }
  private commitClusterGesture() {
    this.showHullWireframe(false);
    this.clusterBase = null;
    this.syncClusterGizmo();
    this.invalidate();
  }

  /** Build a translucent solid+wire overlay of a block shape at RAW-FILE
   *  metres into a group (the highlight groups are positioned at moff). */
  private addBlockOverlay(grp: Group, type: number, origin: [number, number, number],
    size: [number, number, number], hex: number, opacity: number) {
    const pts = getBlockPoints(type, origin, size);
    const pos: number[] = [];
    for (const v of pts) pos.push(v[0], v[1], v[2]);
    const idx: number[] = [];
    for (const f of getBlockFaces(type)) idx.push(...f);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const solid = new Mesh(geo, new MeshBasicMaterial({
      color: hex, transparent: true, opacity, depthTest: false, side: DoubleSide,
    }));
    solid.renderOrder = 29;
    const ep: number[] = [];
    for (const [a, b] of getBlockEdges(type)) ep.push(...pts[a]!, ...pts[b]!);
    const eg = new BufferGeometry();
    eg.setAttribute('position', new BufferAttribute(new Float32Array(ep), 3));
    const wire = new LineSegments(eg, new LineBasicMaterial({
      color: hex, transparent: true, opacity: Math.min(1, opacity + 0.5), depthTest: false,
    }));
    wire.renderOrder = 30;
    grp.add(solid, wire);
  }

  /** BLOCKS-edit selection highlight (v1.4): the selected block gets the
   *  golden constructor overlay, its SIMILAR TWIN a dim one (the block
   *  analogue of twin co-selection) — the twin is identified and driven by
   *  every edit regardless of ⇄ (v1.7.1; the toggle gates twin PLACEMENT).
   *  -1 clears. Survives reloads visually
   *  (raw geometry, no per-load objects) — the Editor re-issues it per edit.
   *  v1.6: the dedup key carries a GEOMETRY/PAINT FINGERPRINT too — the
   *  old {bi,twin}-only guard returned early when a panel edit (cx move,
   *  ⟲X turn, repaint) kept the same selection, so the overlay kept the
   *  block's OLD shape/pos: a golden ghost of the pre-edit block stuck on
   *  the deck until a full deselect ("blocks become translucent and don't
   *  return to previous state", user report). */
  /** 2026-10-20: TRIANGLE-selection feedback — gold translucent caps ±0.03 m over
   *  the prism + a gold outline; -1 (or a triangle that left the file)
   *  clears. depthTest off so it reads through the skin like the block
   *  overlay; ti is staled against the LIVE file so an undo-rebuild can never
   *  leave a gold ghost on a triangle that no longer exists. */
  setTriHighlight(ti: number) {
    const t = ti >= 0 && this.bp ? (this.bp.data.triangles ?? [])[ti] : undefined;
    const key = t ? ti : -1;
    if (this.triHlSpec === key) return;
    this.triHlSpec = key;
    for (const o of this.triHlGroup.children) {
      (o as Mesh).geometry?.dispose();
      ((o as Mesh).material as MeshBasicMaterial)?.dispose?.();
    }
    this.triHlGroup.clear();
    if (!t) { this.invalidate(); return; }
    const v = ([0, 1, 2] as const).map(i => { const p = hullVertex(t, i); return [p.x, p.y, p.z] as const; });
    const ux = v[1]![0] - v[0]![0], uy = v[1]![1] - v[0]![1], uz = v[1]![2] - v[0]![2];
    const wx = v[2]![0] - v[0]![0], wy = v[2]![1] - v[0]![1], wz = v[2]![2] - v[0]![2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const off = (p: readonly number[], s: number) => [p[0]! + nx * s, p[1]! + ny * s, p[2]! + nz * s];
    const A = v.map(p => off(p, 0.03)), B = v.map(p => off(p, -0.03));
    const geo = new BufferGeometry();
    const capPos: number[] = [];
    for (const p of [...A, ...B]) capPos.push(p[0]!, p[1]!, p[2]!);
    geo.setAttribute('position', new BufferAttribute(new Float32Array(capPos), 3));
    geo.setIndex([0, 1, 2, 5, 4, 3]);
    const cap = new Mesh(geo, new MeshBasicMaterial({
      color: 0xffc94d, transparent: true, opacity: 0.55, depthTest: false, side: DoubleSide,
    }));
    cap.renderOrder = 32;
    const ep: number[] = [];
    const loop = (pts: readonly (readonly number[])[]) => {
      for (let i = 0; i < 3; i++) ep.push(...pts[i]!, ...pts[(i + 1) % 3]!);
    };
    loop(A); loop(B);
    for (let i = 0; i < 3; i++) ep.push(...A[i]!, ...B[i]!);
    const eg = new BufferGeometry();
    eg.setAttribute('position', new BufferAttribute(new Float32Array(ep), 3));
    const wire = new LineSegments(eg, new LineBasicMaterial({
      color: 0xffc94d, transparent: true, opacity: 0.95, depthTest: false,
    }));
    wire.renderOrder = 33;
    this.triHlGroup.add(cap, wire);
    this.invalidate();
  }
  get triHighlightState() { return this.triHlSpec; }

  setBlockHighlight(bi: number, twin = -1, issues: readonly string[] = [], info = false) {
    const fp = (i: number): string => {
      const b = i >= 0 && this.bp ? this.bp.data.blocks[i] : undefined;
      if (!b) return '-';
      const c = blockCells(b);
      return `${b.type}|${c.x},${c.y},${c.z}|${b.size_x},${b.size_y},${b.size_z}|` +
        (Array.isArray(b.colors) ? b.colors.join(',') : '');
    };
    const sig = `${bi}|${twin}|${info ? 'i' : 'w'}|${issues.join(';')}|${fp(bi)}|${fp(twin)}`;
    if ((this.blockHlSpec?.bi ?? -1) === bi && (this.blockHlSpec?.twin ?? -1) === twin &&
      this.blockHlSig === sig) return;
    this.blockHlSpec = bi >= 0 ? { bi, twin, issues: [...issues], info } : null;
    this.blockHlSig = sig;
    for (const o of this.blockHlGroup.children) {
      (o as Mesh).geometry?.dispose();
      ((o as Mesh).material as MeshBasicMaterial)?.dispose?.();
    }
    this.blockHlGroup.clear();
    if (bi >= 0 && this.bp) {
      const addAt = (idx: number, opacity: number, hex: number) => {
        const b = this.bp!.data.blocks[idx];
        if (!b || b.type === 255 || b.type > 52) return;
        const c = blockCells(b);
        this.addBlockOverlay(this.blockHlGroup, b.type,
          [(c.x - 6) * CELL, (c.y - 6) * CELL, (c.z - 6) * CELL],
          [(b.size_x + 1) * CELL, (b.size_y + 1) * CELL, (b.size_z + 1) * CELL],
          hex, opacity);
      };
      const add = (idx: number, opacity: number) => addAt(idx, opacity, 0xffc94d);
      const addTwin = (idx: number, opacity: number, hex: number) => addAt(idx, opacity, hex);
      add(bi, 0.34);
      // v1.8.0: a mirror-conflicting FAUX-MIRROR twin rides RED; v1.8.1: a
      // face-PAINT-only divergence is INFORMATIONAL — the overlay stays gold,
      // only the blue info popup notes it (user rule).
      if (twin >= 0) addTwin(twin, 0.16, issues.length && !info ? 0xff4d4d : 0xffc94d);
    }
    this.invalidate();
  }
  get blockHighlightState() { return this.blockHlSpec; }

  /** v1.8.0 FAUX-MIRROR popup state (UNIFORM MIRROR RULE): while the current
   *  selection's mirror twin CONFLICTS (block issues, or a component pair
   *  drifted / painted apart), returns the label text + a CLIENT-px anchor at
   *  the flagged twin; null = no conflict. The Viewport renders the ⚠ card. */
  twinWarnState(): { text: string; x: number; y: number; info: boolean } | null {
    const renderer = this.renderer, cam = this.camera;
    if (!renderer || !cam || !this.bp) return null;
    const p = new Vector3();
    let text = '';
    let info = false;
    const spec = this.blockHlSpec;
    if (spec && spec.issues.length) {
      const ti = spec.twin >= 0 ? spec.twin : spec.bi;
      const b = this.bp.data.blocks[ti];
      if (!b) return null;
      const c = blockCells(b);
      p.set((c.x - 6 + (b.size_x + 1) / 2) * CELL, (c.y - 6 + (b.size_y + 1) / 2) * CELL,
        (c.z - 6 + (b.size_z + 1) / 2) * CELL).add(this.moffV());
      text = (spec.twin >= 0 ? `Block[${spec.bi}] ↔ twin Block[${spec.twin}]: `
        : `Block[${spec.bi}]: no valid mirror twin — `) + spec.issues.join(', ');
      info = spec.info;
    } else if (this.selCi >= 0 && this.compWarn.length) {
      const w = this.compWarn[0]!;
      const c = this.bp.data.components[w.j];
      if (!c) return null;
      p.set(c.position.x, c.position.y, c.position.z).add(this.moffV());
      text = `${c.type}[${this.selCi}] ↔ twin [${w.j}]: ` + w.issues.join(', ');
      info = w.info;
    } else return null;
    p.project(cam);
    if (p.z > 1) return null;                       // behind the camera
    const rect = renderer.domElement.getBoundingClientRect();
    return { text, info, x: rect.left + (p.x + 1) / 2 * rect.width,
      y: rect.top + (1 - p.y) / 2 * rect.height };
  }

  /** WORLD bboxes of the selection overlay meshes (e2e/pin hook): proves the
   *  golden overlay sits ON the block it selects — a stale ghost sits where
   *  the block USED to be, so geometry assertions (not just the {bi,twin}
   *  spec) are what pin the v1.6 fingerprint fix. */
  blockHlBoxes(): { min: [number, number, number]; max: [number, number, number] }[] {
    this.scene.updateMatrixWorld(true);
    const out: { min: [number, number, number]; max: [number, number, number] }[] = [];
    for (const o of this.blockHlGroup.children) {
      const m = o as Mesh;
      if (!m.isMesh || !m.visible) continue;
      const b = new Box3().setFromObject(m);
      if (!b.isEmpty()) out.push({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
    }
    return out;
  }

  /** CATALOG placement ghost (v1.5.6): the ACTUAL held component rendered
   *  translucent at the hovered surface — the collider BOX of v1.4 stays as
   *  the stand-in while that type's geometry streams in (it is re-issued the
   *  moment the template lands, so the box BECOMES the part under the
   *  cursor). yaw turns the part about the world ŷ (its BACK, +z, follows
   *  the smear-drag). With ⇄ the mirrored twin previews at [−x, y, z] with
   *  the SAME orientation — the exact twin identity sym.ts indexes. */
  setCompGhost(g: { type: string; point: [number, number, number]; yaw?: number } | null, mirror = false) {
    const p0 = this.compHlSpec;
    const yaw = g?.yaw ?? 0;
    if (!g && !p0) return;
    if (g && p0 && p0.type === g.type && p0.mirror === mirror && (p0.yaw ?? 0) === yaw &&
      p0.point.every((v, i) => Math.abs(v - g.point[i]!) < 1e-9)) return;
    this.compHlSpec = g ? { ...g, yaw, mirror } : null;
    for (const o of this.compHlGroup.children) {
      if (o.userData.shared) continue;    // model clones share their template's
      (o as Mesh).geometry?.dispose();    // resources — only the box stand-in
      ((o as Mesh).material as MeshBasicMaterial)?.dispose?.();   // is ours
    }
    this.compHlGroup.clear();
    if (!g) { this.invalidate(); return; }
    // collider bbox of the type (union of its colliders), else a small cube
    let lo = [-0.2, -0.2, -0.2], hi = [0.2, 0.2, 0.2];
    const cols = this.atlasRef?.manifest?.[g.type]?.colliders ?? [];
    if (cols.length) {
      lo = [...cols[0]!.min]; hi = [...cols[0]!.max];
      for (const c of cols) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, c.min[a]!); hi[a] = Math.max(hi[a]!, c.max[a]!); }
    }
    const size: [number, number, number] = [Math.max(0.1, hi[0]! - lo[0]!), Math.max(0.1, hi[1]! - lo[1]!), Math.max(0.1, hi[2]! - lo[2]!)];
    const ctr: [number, number, number] = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2,
      (lo[2]! + hi[2]!) / 2];
    const mi = mirrorAxisIdx(this.mirAxis);
    const put = (p: [number, number, number], mirrored = false) => {
      // ⇄ twin = mirrored POSITION on the SESSION mirror axis, same
      // orientation (v1.5.21 settable axis; the old hard x-flip)
      const q = p.map((v, k) => (mirrored && k === mi ? -v : v)) as [number, number, number];
      const tmpl = this.ghostCache.get(g.type);
      if (tmpl) {
        const c = tmpl.clone(true);
        c.rotation.order = 'ZYX';
        c.rotation.y = yaw;
        c.position.set(q[0], q[1], q[2]);
        this.compHlGroup.add(c);
        return;
      }
      const mat = new MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.35, depthTest: false, side: DoubleSide });
      const wmat = new LineBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.9, depthTest: false });
      const geo = new BoxGeometry(size[0], size[1], size[2]);
      const m = new Mesh(geo, mat);
      const ctrF: [number, number, number] = [q[0] + ctr[0], q[1] + ctr[1], q[2] + ctr[2]];
      m.position.set(ctrF[0], ctrF[1], ctrF[2]);
      m.renderOrder = 29;
      const eg = new BufferGeometry();
      const c8: number[] = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
        c8.push(ctrF[0] + sx * size[0] / 2, ctrF[1] + sy * size[1] / 2, ctrF[2] + sz * size[2] / 2);
      const EI = [0, 1, 2, 3, 4, 5, 6, 7,   // x-runs
        0, 2, 1, 3, 4, 6, 5, 7,             // y-runs
        0, 4, 1, 5, 2, 6, 3, 7];            // z-runs
      const ep: number[] = [];
      for (let e = 0; e < EI.length; e += 2) { ep.push(...c8.slice(EI[e]! * 3, EI[e]! * 3 + 3), ...c8.slice(EI[e + 1]! * 3, EI[e + 1]! * 3 + 3)); }
      eg.setAttribute('position', new BufferAttribute(new Float32Array(ep), 3));
      const wire = new LineSegments(eg, wmat);
      wire.renderOrder = 30;
      this.compHlGroup.add(m, wire);
    };
    put(g.point);
    if (mirror) put(g.point, true);
    this.ghostStream(g.type);
    this.invalidate();
  }
  /** stream + build the translucent template for a held type (once); when it
   *  lands, the ghost still under the cursor is re-issued so the box stand-in
   *  becomes the part without waiting for the next pointer move */
  private ghostStream(type: string) {
    if (!this.atlasRef || this.ghostCache.has(type) || this.ghostPending.has(type)) return;
    this.ghostPending.add(type);
    void this.atlasRef.geoFor(type).then(model => {
      this.ghostPending.delete(type);
      if (!model) return;
      const tmpl = buildAtlasPreview(type, model, { opacity: 0.5, depthTest: false,
        palette: this.palette, legacy: this.legacy });
      tmpl.traverse(o => { if ((o as Mesh).isMesh) (o as Mesh).renderOrder = 29; });
      this.ghostCache.set(type, tmpl);
      const s = this.compHlSpec;
      if (s && s.type === type) {
        this.compHlSpec = null;
        this.setCompGhost({ type: s.type, point: s.point, yaw: s.yaw }, s.mirror);
      }
      this.invalidate();
    }).catch(() => this.ghostPending.delete(type));
  }
  /** smear-drag (v1.5.6): a press on a placeable surface while a part is
   *  HELD captures the gesture (ORBIT OFF — the drag is the tool, as in the
   *  game's part attach); dragging re-docks the ghost on whatever surface the
   *  pointer crosses (the part rides ALONG the hull = "smearing on") and
   *  aims its BACK (+z, the nose is −z) along the file-plane travel; the
   *  release commits at the final yaw. Returns null while nothing is aimed
   *  (the press then stays a camera gesture). */
  placeDragStart(clientX: number, clientY: number): boolean {
    const s = this.compHlSpec;
    if (!s) return false;
    const p = this.pickPlacePoint(clientX, clientY);
    if (!p) return false;
    this.placeDrag = { anchor: p, yaw: s.yaw };
    if (this.controls) this.controls.enabled = false;
    return true;
  }
  placeDragMove(clientX: number, clientY: number): number | null {
    const d = this.placeDrag, s = this.compHlSpec;
    if (!d || !s) return null;
    const p = this.pickPlacePoint(clientX, clientY);
    if (p) {
      const dx = p[0] - d.anchor[0], dz = p[2] - d.anchor[2];
      if (Math.hypot(dx, dz) > 0.05) {          // a real smear, not a jitter
        d.yaw = Math.atan2(dx, dz);             // back (+z) along the travel
        d.anchor = p;
      }
      this.setCompGhost({ type: s.type, point: p, yaw: d.yaw }, s.mirror);
    }
    return d.yaw;
  }
  /** release/cancel: orbit back on; returns the committed yaw (null = no
   *  gesture was live). The GHOST stays — the Editor places or drops it. */
  placeDragEnd(): number | null {
    if (!this.placeDrag) return null;
    const y = this.placeDrag.yaw;
    this.placeDrag = null;
    if (this.controls) this.controls.enabled = true;
    return y;
  }
  /** true while the ghost shows the REAL model (not the box stand-in) — the
   *  e2e pin that placement previews the part itself (v1.5.6) */
  compGhostReal(): boolean {
    let real = false;
    this.compHlGroup.traverse(o => { if ((o as Mesh).isMesh && o.userData.shared) real = true; });
    return real;
  }
  /** WORLD bboxes of the ghost's meshes (e2b hook, like blockHlBoxes) */
  compGhostBoxes(): { min: [number, number, number]; max: [number, number, number] }[] {
    this.scene.updateMatrixWorld(true);
    const out: { min: [number, number, number]; max: [number, number, number] }[] = [];
    for (const o of this.compHlGroup.children) {
      const b = new Box3().setFromObject(o);
      if (!b.isEmpty()) out.push({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
    }
    return out;
  }
  get compGhostState() { return this.compHlSpec; }
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
      if (kind === 'block' && !this.opts.hull) continue;   // v2.0.0 click-through
      const n = h.face
        ? new Vector3(h.face.normal.x, h.face.normal.y, h.face.normal.z)
        : new Vector3(0, 1, 0);
      const px = h.point.x + n.x * 0.01 - this.moff.x;
      const py = h.point.y + n.y * 0.01 - this.moff.y;
      const pz = h.point.z + n.z * 0.01 - this.moff.z;
      return [px, py, pz];      // v1.4: RAW file z — the old −pz was a retired
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
    this.hoverHl.dispose();
    this.hoverCi = -1;
    this.clearSurges();
    this.clearLabels();
    this.selCi = this.selSub = -1;
    this.buildHingeUI(-1);
    this.clearWind();
  }

  dispose() {
    this.loadSeq++;                    // strand in-flight real-model loads
    this.disposeScene();
    this.renderer?.domElement.removeEventListener('webglcontextrestored', this.onRestore);
    this.hingeCanvas?.removeEventListener('pointerdown', this.onHingeDown, { capture: true } as EventListenerOptions);
    removeEventListener('pointermove', this.onHingeMove);
    removeEventListener('pointerup', this.onHingeUp);
    for (const h of this.hingeHandles) { h.mesh.geometry.dispose(); (h.mesh.material as MeshBasicMaterial).dispose(); }
    this.hingeHandles = [];
    this.hingeCanvas = null;
    this.unitBox.dispose();
    this.surgeGeo.dispose();
    this.clearSurges();
    this.clearLabels();
    this.occ?.dispose();
    this.occ = null;
    this.hl.dispose();
    this.hoverHl.dispose();
    this.warnHl.dispose();
    this.matCache.forEach(m => m.dispose());
    this.matCache.clear();
    for (const t of this.ghostCache.values())
      t.traverse(o => {
        const m = o as Mesh;
        if (m.isMesh) { m.geometry.dispose(); (m.material as MeshStandardMaterial).dispose(); }
      });
    this.ghostCache.clear();
    this.ghostPending.clear();
    for (const t of this.backdrops.values()) t.dispose();   // sky domes are engine-owned
    this.backdrops.clear();
    this.skyDome?.dispose();
    this.skyDomeGeo?.dispose();
    this.skyDomeMat?.dispose();
    this.skyDome = this.skyDomeGeo = null;
    this.skyDomeMat = null;
    this.placeDrag = null;
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

