// thumbs.ts — the PLACE catalog's LIVE 3D previews (user 2026-10-20: "can we
// do a preview render of each icon? … an animated 3D version rather than the
// pregenerated png? Generate these one-by-one when opening the place
// component page"). Rows request a still of their part; jobs run STRICTLY
// ONE AT A TIME (one geometry per frame) so a freshly opened catalog trickles
// atlas files in instead of bursting 100 fetches + builds at the network and
// the main thread. Hovering a row spins that part until the pointer leaves.
//
// All previews share ONE hidden offscreen WebGLRenderer (one GL context for
// the whole catalog), which renders the part and blits it into each row's 2D
// canvas. The geometry builder here is ALSO what the scene's placement ghost
// uses (buildAtlasPreview) — the ghost and the catalog icon are the same
// look, by construction.

import {
  Box3, BufferAttribute, BufferGeometry, Color, DirectionalLight, Group,
  HemisphereLight, LinearSRGBColorSpace, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { geoLiteFor, type LoadedModel } from './models';
import { droppedParts } from './models';
import { nodeMaterialSpec } from './materials';
import type { FilePalette } from './palette';
import type { BlueprintComponent } from './format';

const DEG = Math.PI / 180;
/** backing pixels of the shared offscreen renderer (rows blit it scaled) */
const SIZE = 48;
/** resting turntable angle of a still (a readable three-quarter view) */
const REST_YAW = -0.65;

/** the fresh-part paint of a catalog placement (newcraft.ts newComponent) */
const DEFAULT_PAINT = {
  color1: { r: 255, g: 255, b: 255, metallic: 0, opacity: 15, roughness: 0 },
  color2: { r: 204, g: 204, b: 204, metallic: 1, opacity: 15, roughness: 7 },
};

export interface PreviewOpts {
  /** 1 = opaque icon; <1 = the translucent placement ghost */
  opacity: number;
  /** the ghost draws through the hull; icons keep depth */
  depthTest?: boolean;
  palette?: FilePalette | null;
  legacy?: boolean;
}

/** Assemble a component's atlas geometry over the .ini node chain, under the
 *  engine CONTENT BASIS C = Rx(−90) (scene.ts buildReal's rule, FORMAT
 *  §Component VERTEX SPACE — thumbnails and ghosts speak the same space as
 *  the scene). Decimated twins (lv/li) only; conditional parts resolved at
 *  DEFAULT data (droppedParts). Every mesh is marked userData.shared — the
 *  template's geometry/materials outlive any single holder that shows it,
 *  and they never raycast. */
export function buildAtlasPreview(type: string, model: LoadedModel,
  opts: PreviewOpts): Group {
  const { geo, info } = model;
  const comp = { type, data: {}, colors: DEFAULT_PAINT } as unknown as BlueprintComponent;
  const root = new Group();
  const basis = new Group();
  basis.rotation.order = 'ZYX';
  basis.rotation.x = -Math.PI / 2;          // C: file (x,y,z) → content (x,z,−y)
  root.add(basis);
  const nodes = new Map<string, Group>();
  const mkNode = (n: { name: string; position: [number, number, number]; rotation: [number, number, number] }) => {
    const p = new Group();
    p.rotation.order = 'ZYX';
    p.position.set(n.position[0], n.position[1], n.position[2]);
    p.rotation.set(n.rotation[0]! * DEG, n.rotation[1]! * DEG, n.rotation[2]! * DEG);
    nodes.set(n.name, p);
  };
  // node parents may reference each other in ANY order: two passes (buildReal)
  for (const n of [...info.joints, ...info.targets, ...info.renderables]) mkNode(n);
  for (const n of [...info.joints, ...info.targets, ...info.renderables])
    (nodes.get(n.parent ?? '') ?? basis).add(nodes.get(n.name)!);
  const drop = droppedParts(comp);
  for (const r of info.renderables) {
    if (drop.has(r.name)) continue;
    const nd = geo[r.name];
    if (!nd) continue;
    const rg = nodes.get(r.name)!;
    for (const prim of nd.prims) {
      const v = prim.lv ?? prim.v;
      const i = prim.li ?? prim.i;
      if (!v?.length || !i?.length) continue;
      const gg = new BufferGeometry();
      gg.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
      gg.setIndex(i as number[]);
      gg.computeVertexNormals();
      const spec = nodeMaterialSpec(comp, prim.material, info.materials,
        opts.palette ?? null, opts.legacy ?? false);
      const m = new MeshStandardMaterial({
        color: new Color().setRGB(spec.color[0], spec.color[1], spec.color[2], LinearSRGBColorSpace),
        metalness: spec.metal,
        roughness: spec.rough,
        transparent: opts.opacity < 1,
        opacity: opts.opacity,
        depthTest: opts.depthTest ?? true,
        side: opts.opacity < 1 ? 2 : 0,     // DoubleSide for the see-through ghost
      });
      m.envMapIntensity = 0;
      const mesh = new Mesh(gg, m);
      mesh.userData.shared = true;
      mesh.raycast = () => {};
      rg.add(mesh);
    }
  }
  root.userData.shared = true;
  return root;
}

// ---------------------------------------------------------------- renderer

let renderer: WebGLRenderer | null = null;
let glDead = false;
let scene: Scene;
let camera: PerspectiveCamera;
let inScene: Group | null = null;

function ensureRenderer(): WebGLRenderer | null {
  if (glDead) return null;
  if (renderer) return renderer;
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = SIZE;
    renderer = new WebGLRenderer({ canvas: cv, alpha: true, antialias: true,
      preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    scene = new Scene();
    camera = new PerspectiveCamera(25, 1, 0.01, 100);
    camera.position.set(0, 0.45, 3.1);
    camera.lookAt(0, 0, 0);
    scene.add(new HemisphereLight(0xcfe8ff, 0x444422, 1.3));
    const sun = new DirectionalLight(0xfff2dd, 2.4);
    sun.position.set(-6, 10, -4);
    scene.add(sun);
    const fill = new DirectionalLight(0xbfd4ff, 0.8);
    fill.position.set(5, 3, 6);
    scene.add(fill);
  } catch { glDead = true; return null; }
  return renderer;
}

/** per-type centered + unit-scaled wrapper (drawn at any yaw) */
const fits = new Map<string, Promise<Group | null>>();
export function thumbFit(type: string): Promise<Group | null> {
  if (!fits.has(type)) {
    fits.set(type, geoLiteFor(type).then(model => {
      if (!model) return null;
      const g = buildAtlasPreview(type, model, { opacity: 1 });
      g.updateMatrixWorld(true);
      const b = new Box3().setFromObject(g);
      if (b.isEmpty()) return null;
      const s = b.getSize(new Vector3());
      g.position.sub(b.getCenter(new Vector3()));
      const wrap = new Group();
      wrap.scale.setScalar(0.85 / Math.max(s.x, s.y, s.z));
      wrap.add(g);
      wrap.userData.shared = true;
      return wrap;
    }).catch(() => null).then(r => { if (!r) fits.delete(type); return r; }));
  }
  return fits.get(type)!;
}

function drawTo(el: HTMLImageElement | HTMLCanvasElement, wrap: Group, yaw: number) {
  const r = ensureRenderer();
  if (!r) return;
  wrap.rotation.y = yaw;
  if (inScene !== wrap) {
    if (inScene) scene.remove(inScene);
    scene.add(wrap);
    inScene = wrap;
  }
  r.render(scene, camera);
  // the rows are <img> (a catalog full of <canvas> elements would steal the
  // viewport's "first canvas" identity the e2e scene probes rely on)
  if (el instanceof HTMLImageElement) el.src = r.domElement.toDataURL('image/png');
  else {
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.drawImage(r.domElement, 0, 0, el.width, el.height);
  }
}

// ------------------------------------------------------------------ queue

const queue: { el: HTMLImageElement; type: string }[] = [];
let pumping = false;

/** polite scheduling: an idle slice (or a beat of setTimeout when the page
 *  is perpetually busy — rAF-only would starve scene interaction; the
 *  blockplace timing pins caught this), never a synchronous chain */
function idleThen(fn: () => void) {
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 2000 });
  else setTimeout(fn, 120);
}

/** enqueue a still preview for `canvas`; returns a cancel (row unmount).
 *  "one-by-one": each job renders, then the next waits for the NEXT idle
 *  slice — a freshly opened catalog trickles in instead of bursting. */
export function requestThumb(el: HTMLImageElement, type: string): () => void {
  const job = { el, type };
  queue.push(job);
  if (queue.length === 1) idleThen(pump);
  return () => { const i = queue.indexOf(job); if (i >= 0) queue.splice(i, 1); };
}

function pump() {
  if (pumping) return;
  const job = queue.shift();
  if (!job) return;
  pumping = true;
  void thumbFit(job.type).then(w => {
    if (w && job.el.isConnected) drawTo(job.el, w, REST_YAW);
  }).finally(() => {
    pumping = false;
    if (queue.length) idleThen(pump);
  });
}

// ------------------------------------------------------------------ spins

const spins = new Map<HTMLImageElement, { type: string; raf: number; yaw: number }>();

/** hover animation: turn the part until stopSpin (one hovered row at a time
 *  in practice; the map keeps it correct if the pointer moves fast) */
export function startSpin(el: HTMLImageElement, type: string) {
  if (spins.has(el)) return;
  const st = { type, raf: 0, yaw: REST_YAW };
  spins.set(el, st);
  const step = () => {
    if (!spins.has(el)) return;
    st.yaw += 0.05;
    void thumbFit(type).then(w => {
      if (w && spins.has(el) && el.isConnected) drawTo(el, w, st.yaw);
      if (spins.has(el)) st.raf = requestAnimationFrame(step);
    });
  };
  st.raf = requestAnimationFrame(step);
}

export function stopSpin(el: HTMLImageElement) {
  const st = spins.get(el);
  if (!st) return;
  spins.delete(el);
  cancelAnimationFrame(st.raf);
  void thumbFit(st.type).then(w => { if (w && el.isConnected) drawTo(el, w, st.yaw); });
}
